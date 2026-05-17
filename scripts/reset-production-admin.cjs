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

async function getExistingUserDoc(db, uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function createOrUpdateAdmin(auth, password) {
  try {
    const existing = await auth.getUserByEmail(ADMIN_EMAIL);
    const updated = await auth.updateUser(existing.uid, {
      email: ADMIN_EMAIL,
      password,
      displayName: "Miami Daegu Admin",
      disabled: false,
      emailVerified: true,
    });
    return { action: "update", userRecord: updated };
  } catch (error) {
    if (error && error.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const created = await auth.createUser({
    email: ADMIN_EMAIL,
    password,
    displayName: "Miami Daegu Admin",
    disabled: false,
    emailVerified: true,
  });

  return { action: "create", userRecord: created };
}

async function run() {
  const password = String(process.env.ADMIN_PASSWORD || "");

  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD is required. Example: ADMIN_PASSWORD='new-password' npm run reset:production:admin"
    );
  }

  initializeFirebase();

  const auth = admin.auth();
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;
  const { action, userRecord } = await createOrUpdateAdmin(auth, password);
  const existingUserDoc = await getExistingUserDoc(db, userRecord.uid);
  const academyId =
    process.env.PRODUCTION_ACADEMY_ID != null
      ? String(process.env.PRODUCTION_ACADEMY_ID).trim()
      : String(existingUserDoc.academyId || "").trim();

  await auth.setCustomUserClaims(userRecord.uid, {
    role: "admin",
    academyId,
  });

  await db.collection("users").doc(userRecord.uid).set(
    {
      uid: userRecord.uid,
      email: ADMIN_EMAIL,
      displayName: "Miami Daegu Admin",
      role: "admin",
      academyId,
      isActive: true,
      teacherName: "",
      canManageAttendance: true,
      canAddStudent: true,
      canEditStudent: true,
      canDeleteStudent: true,
      canEditLesson: true,
      canDeleteLesson: true,
      canCreateLessonDirectly: true,
      requiresLessonApproval: false,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existingUserDoc.createdAt || FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(
    `[${action.toUpperCase()}] admin auth user ${ADMIN_EMAIL} (${userRecord.uid})`
  );
  console.log(`[MERGE] users/${userRecord.uid} role=admin isActive=true`);
}

run().catch((error) => {
  console.error("Failed to reset production admin.");
  console.error(error);
  process.exitCode = 1;
});
