const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const serviceAccountPath = path.join(__dirname, "..", "serviceAccountKey.json");
const expectedProjectId =
  process.env.E2E_FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  "miami-e2e";

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(`Missing service account key: ${serviceAccountPath}`);
}

const serviceAccount = require(serviceAccountPath);

if (serviceAccount.project_id !== expectedProjectId) {
  throw new Error(
    [
      `serviceAccountKey.json project_id mismatch.`,
      `Expected: ${expectedProjectId}`,
      `Received: ${serviceAccount.project_id || "(missing)"}`,
      "Replace serviceAccountKey.json with the E2E Firebase service account or set E2E_FIREBASE_PROJECT_ID intentionally.",
    ].join(" ")
  );
}

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const auth = admin.auth();
const db = admin.firestore();
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;

const USERS = [
  {
    key: "admin",
    email: "admin@example.com",
    password: "123456",
    displayName: "Admin E2E",
    claims: { role: "admin" },
    firestoreData: {
      email: "admin@example.com",
      displayName: "Admin E2E",
      role: "admin",
      isActive: true,
      teacherName: "",
      canManageAttendance: true,
      canAddStudent: true,
      canEditLesson: true,
      canDeleteLesson: true,
      canCreateLessonDirectly: true,
      requiresLessonApproval: false,
    },
  },
  {
    key: "teacher",
    email: "teacher@example.com",
    password: "123456",
    displayName: "Teacher E2E",
    claims: { role: "teacher" },
    firestoreData: {
      email: "teacher@example.com",
      displayName: "Teacher E2E",
      role: "teacher",
      isActive: true,
      teacherName: "teacher",
      canManageAttendance: false,
      canAddStudent: false,
      canEditLesson: false,
      canDeleteLesson: false,
      canCreateLessonDirectly: false,
      requiresLessonApproval: false,
    },
  },
];

async function createOrUpdateAuthUser(userSpec) {
  const { email, password, displayName } = userSpec;

  try {
    const existingUser = await auth.getUserByEmail(email);
    const updatedUser = await auth.updateUser(existingUser.uid, {
      email,
      password,
      displayName,
      disabled: false,
    });

    return { action: "update", userRecord: updatedUser };
  } catch (error) {
    if (error && error.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const createdUser = await auth.createUser({
    email,
    password,
    displayName,
    disabled: false,
  });

  return { action: "create", userRecord: createdUser };
}

async function seedUser(userSpec) {
  const { action, userRecord } = await createOrUpdateAuthUser(userSpec);
  const { uid, email } = userRecord;

  await auth.setCustomUserClaims(uid, userSpec.claims);

  await db.collection("users").doc(uid).set(
    {
      uid,
      ...userSpec.firestoreData,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  console.log(
    `[${action.toUpperCase()}] ${userSpec.key} auth user ${email} (${uid})`
  );
  console.log(
    `[MERGE] users/${uid} role=${userSpec.firestoreData.role} teacherName="${userSpec.firestoreData.teacherName}"`
  );
  console.log(
    `[FINAL] ${userSpec.key} email=${userSpec.email} password=${userSpec.password}`
  );

  return {
    key: userSpec.key,
    action,
    uid,
    email: userSpec.email,
    password: userSpec.password,
  };
}

async function run() {
  console.log(
    `Seeding E2E users into Firebase project: ${serviceAccount.project_id || "(unknown project)"}`
  );

  const results = [];

  for (const userSpec of USERS) {
    results.push(await seedUser(userSpec));
  }

  console.log("");
  console.log("Summary");
  for (const result of results) {
    console.log(
      `- ${result.key}: ${result.action} uid=${result.uid} email=${result.email} password=${result.password}`
    );
  }
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error("Failed to seed E2E users.");
    console.error(error);
    process.exitCode = 1;
  });
