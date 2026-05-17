const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const EXPECTED_PROJECT_ID =
  process.env.PRODUCTION_FIREBASE_PROJECT_ID || "miamiacademyschedule";
const ADMIN_EMAIL = "miamidaegu@gmail.com";
const RESET_CONFIRMATION = "daegumiami";
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
const DRY_RUN =
  process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

const COLLECTIONS_TO_DELETE = [
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

  return serviceAccount;
}

function initializeFirebase() {
  const serviceAccount = loadServiceAccount();

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: EXPECTED_PROJECT_ID,
    });
  }
}

function assertResetAllowed() {
  if (DRY_RUN) return;

  if (process.env.ALLOW_PRODUCTION_RESET !== RESET_CONFIRMATION) {
    throw new Error(
      [
        "Refusing to reset production data.",
        `Set ALLOW_PRODUCTION_RESET=${RESET_CONFIRMATION} to execute.`,
        "Run npm run reset:production:dry first.",
      ].join(" ")
    );
  }
}

async function countCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.size;
}

async function recursiveDelete(db, ref) {
  if (typeof db.recursiveDelete === "function") {
    await db.recursiveDelete(ref);
    return;
  }

  const snapshot = await ref.get();
  const docs = snapshot.docs || (snapshot.exists ? [snapshot] : []);

  for (let index = 0; index < docs.length; index += 450) {
    const batch = db.batch();
    for (const doc of docs.slice(index, index + 450)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

async function deleteWholeCollection(db, collectionName) {
  const ref = db.collection(collectionName);
  const count = await countCollection(db, collectionName);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] ${collectionName}: would delete ${count} docs`);
    return count;
  }

  await recursiveDelete(db, ref);
  console.log(`[DELETE] ${collectionName}: deleted ${count} docs`);
  return count;
}

async function resolveAdminUid(auth) {
  try {
    const adminUser = await auth.getUserByEmail(ADMIN_EMAIL);
    return adminUser.uid;
  } catch (error) {
    if (error && error.code === "auth/user-not-found") {
      return "";
    }
    throw error;
  }
}

async function deleteNonAdminUserDocs(db, adminUid) {
  const snapshot = await db.collection("users").get();
  const docsToDelete = snapshot.docs.filter((doc) => {
    const data = doc.data() || {};
    const email = String(data.email || "").trim().toLowerCase();

    return doc.id !== adminUid && email !== ADMIN_EMAIL;
  });
  const preserved = snapshot.size - docsToDelete.length;

  if (DRY_RUN) {
    console.log(
      `[DRY-RUN] users: would delete ${docsToDelete.length} docs, preserve ${preserved}`
    );
    return docsToDelete.length;
  }

  for (const doc of docsToDelete) {
    await recursiveDelete(db, doc.ref);
  }

  console.log(
    `[DELETE] users: deleted ${docsToDelete.length} docs, preserved ${preserved}`
  );
  return docsToDelete.length;
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

async function deleteNonAdminAuthUsers(auth) {
  const users = await listAllAuthUsers(auth);
  const uidsToDelete = users
    .filter((user) => String(user.email || "").trim().toLowerCase() !== ADMIN_EMAIL)
    .map((user) => user.uid);

  if (DRY_RUN) {
    console.log(
      `[DRY-RUN] auth: would delete ${uidsToDelete.length} users, preserve ${users.length - uidsToDelete.length}`
    );
    return uidsToDelete.length;
  }

  for (let index = 0; index < uidsToDelete.length; index += 1000) {
    const chunk = uidsToDelete.slice(index, index + 1000);
    if (chunk.length === 0) continue;

    const result = await auth.deleteUsers(chunk);
    if (result.failureCount > 0) {
      const failures = result.errors
        .map((entry) => `${chunk[entry.index]}:${entry.error.message}`)
        .join(", ");
      throw new Error(`Auth deleteUsers failed: ${failures}`);
    }
  }

  console.log(
    `[DELETE] auth: deleted ${uidsToDelete.length} users, preserved ${users.length - uidsToDelete.length}`
  );
  return uidsToDelete.length;
}

async function run() {
  assertResetAllowed();
  initializeFirebase();

  const db = admin.firestore();
  const auth = admin.auth();
  const adminUid = await resolveAdminUid(auth);

  console.log(
    `${DRY_RUN ? "Dry-running" : "Resetting"} production Firebase project: ${EXPECTED_PROJECT_ID}`
  );
  console.log(`Preserving admin email: ${ADMIN_EMAIL}`);

  const summary = {
    users: await deleteNonAdminUserDocs(db, adminUid),
    authUsers: await deleteNonAdminAuthUsers(auth),
    collections: {},
  };

  for (const collectionName of COLLECTIONS_TO_DELETE) {
    summary.collections[collectionName] = await deleteWholeCollection(
      db,
      collectionName
    );
  }

  console.log("");
  console.log(DRY_RUN ? "Dry-run complete. No data was deleted." : "Reset complete.");
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error("Failed to reset production data.");
  console.error(error);
  process.exitCode = 1;
});
