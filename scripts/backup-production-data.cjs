const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const EXPECTED_PROJECT_ID =
  process.env.PRODUCTION_FIREBASE_PROJECT_ID || "miamiacademyschedule";
const ADMIN_EMAIL = "miamidaegu@gmail.com";
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "..",
  "serviceAccountKey.prod.json"
);
const FALLBACK_SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "..",
  "serviceAccountKey.json"
);
const BACKUP_ROOT = path.resolve(
  process.env.PRODUCTION_BACKUP_DIR ||
    path.join(__dirname, "..", "backups", "production-reset")
);

const COLLECTIONS = [
  "users",
  "privateStudents",
  "groupClasses",
  "groupStudents",
  "groupLessons",
  "lessons",
  "studentPackages",
  "creditTransactions",
  "groupLessonReservations",
  "groupLessonCancelUsage",
  "privateLessonSlots",
  "privateLessonReservations",
  "studentPrivateAccessSummary",
  "lessonRequests",
];

function resolveServiceAccountPath() {
  const explicitPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (fs.existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
    return DEFAULT_SERVICE_ACCOUNT_PATH;
  }

  return FALLBACK_SERVICE_ACCOUNT_PATH;
}

function loadServiceAccount() {
  const serviceAccountPath = resolveServiceAccountPath();

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Missing production service account key: ${serviceAccountPath}`
    );
  }

  const serviceAccount = require(serviceAccountPath);

  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      [
        "Service account project_id mismatch.",
        `Expected: ${EXPECTED_PROJECT_ID}`,
        `Received: ${serviceAccount.project_id || "(missing)"}`,
        "Use the production service account for miamiacademyschedule.",
      ].join(" ")
    );
  }

  return { serviceAccount, serviceAccountPath };
}

function initializeFirebase() {
  const { serviceAccount, serviceAccountPath } = loadServiceAccount();

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: EXPECTED_PROJECT_ID,
    });
  }

  return { serviceAccount, serviceAccountPath };
}

function normalizeFirestoreValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (Buffer.isBuffer(value)) return { __type: "bytes", base64: value.toString("base64") };

  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      return { __type: "timestamp", iso: value.toDate().toISOString() };
    }

    if (
      typeof value.latitude === "number" &&
      typeof value.longitude === "number"
    ) {
      return {
        __type: "geopoint",
        latitude: value.latitude,
        longitude: value.longitude,
      };
    }

    if (typeof value.path === "string" && value.firestore) {
      return { __type: "documentReference", path: value.path };
    }

    const normalized = {};
    for (const [key, childValue] of Object.entries(value)) {
      normalized[key] = normalizeFirestoreValue(childValue);
    }
    return normalized;
  }

  return value;
}

async function backupCollection(db, collectionName, backupDir) {
  const snapshot = await db.collection(collectionName).get();
  const docs = snapshot.docs.map((doc) => ({
    id: doc.id,
    path: doc.ref.path,
    data: normalizeFirestoreValue(doc.data()),
  }));
  const outputPath = path.join(backupDir, `${collectionName}.json`);

  fs.writeFileSync(outputPath, JSON.stringify(docs, null, 2));
  console.log(`[BACKUP] ${collectionName}: ${docs.length} docs -> ${outputPath}`);

  return docs.length;
}

async function listAllAuthUsers(auth) {
  const users = [];
  let nextPageToken;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    users.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  return users;
}

async function backupAuthUsers(auth, backupDir) {
  const users = await listAllAuthUsers(auth);
  const output = users.map((user) => ({
    uid: user.uid,
    email: user.email || "",
    emailVerified: user.emailVerified === true,
    displayName: user.displayName || "",
    disabled: user.disabled === true,
    customClaims: user.customClaims || {},
    providerData: user.providerData || [],
    metadata: {
      creationTime: user.metadata.creationTime,
      lastSignInTime: user.metadata.lastSignInTime,
      lastRefreshTime: user.metadata.lastRefreshTime,
    },
  }));
  const outputPath = path.join(backupDir, "authUsers.json");

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`[BACKUP] authUsers: ${output.length} users -> ${outputPath}`);

  return output.length;
}

async function run() {
  const { serviceAccountPath } = initializeFirebase();
  const db = admin.firestore();
  const auth = admin.auth();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(BACKUP_ROOT, timestamp);
  const manifest = {
    projectId: EXPECTED_PROJECT_ID,
    createdAt: new Date().toISOString(),
    adminEmailPreservedByReset: ADMIN_EMAIL,
    serviceAccountPath,
    collections: {},
    authUsers: 0,
  };

  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`Backing up production Firebase project: ${EXPECTED_PROJECT_ID}`);
  console.log(`Backup directory: ${backupDir}`);

  for (const collectionName of COLLECTIONS) {
    manifest.collections[collectionName] = await backupCollection(
      db,
      collectionName,
      backupDir
    );
  }

  manifest.authUsers = await backupAuthUsers(auth, backupDir);

  fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log("");
  console.log("Backup complete.");
}

run().catch((error) => {
  console.error("Failed to back up production data.");
  console.error(error);
  process.exitCode = 1;
});
