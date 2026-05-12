import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const {
  STUDENT_ACCOUNT_PERMISSIONS,
  assertSafeStudentAccountLink,
  normalizeEmail,
  validateAcademyId,
} = require('../functions/linkStudentAccountSafety.cjs');

const HOSTED_APP_URL = 'https://miami-e2e.web.app';
const STUDENT_PASSWORD_SETUP_ACTION_SETTINGS = {
  url: HOSTED_APP_URL,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function requiredString(args, key) {
  const value = String(args[key] || '').trim();
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function optionalString(args, key) {
  return String(args[key] || '').trim();
}

function loadServiceAccount(serviceAccountPath) {
  const resolved = path.resolve(repoRoot, serviceAccountPath || 'serviceAccountKey.json');
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing service account key: ${resolved}`);
  }
  return require(resolved);
}

async function getAuthUserByEmail({ auth, email }) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    return null;
  }
}

async function createAuthUser({ auth, email, displayName, password }) {
  const create = {
    email,
    disabled: false,
  };
  if (displayName) create.displayName = displayName;
  if (password) create.password = password;

  const userRecord = await auth.createUser(create);
  return { action: 'created', userRecord };
}

async function updateAuthUser({ auth, uid, email, displayName, password }) {
  const update = {
    email,
    disabled: false,
  };
  if (displayName) update.displayName = displayName;
  if (password) update.password = password;

  const userRecord = await auth.updateUser(uid, update);
  return { action: 'updated', userRecord };
}

async function setMergeWithTimestamps(ref, data) {
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : null;
  await ref.set(
    {
      ...data,
      createdAt: existing?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function createStudentAccessSummaryDocsIfMissing(db, { academyId, studentId }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const groupSummaryRef = db
    .collection('studentGroupAccessSummary')
    .doc(`${academyId}__${studentId}`);
  const privateSummaryRef = db
    .collection('studentPrivateAccessSummary')
    .doc(`${academyId}__${studentId}`);
  const [groupSummarySnap, privateSummarySnap] = await Promise.all([
    groupSummaryRef.get(),
    privateSummaryRef.get(),
  ]);
  const writes = [];

  if (!groupSummarySnap.exists) {
    writes.push(
      groupSummaryRef.create({
        academyId,
        studentId,
        groupClassIds: [],
        groupCourseTypes: [],
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  if (!privateSummarySnap.exists) {
    writes.push(
      privateSummaryRef.create({
        academyId,
        studentId,
        teacherKeys: [],
        activePackageIds: [],
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  await Promise.all(writes);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const academyId = requiredString(args, 'academy-id');
  const studentId = requiredString(args, 'student-id');
  const email = normalizeEmail(requiredString(args, 'email'));
  const displayName = optionalString(args, 'display-name');
  const password = optionalString(args, 'password');
  const shouldPrintPasswordResetLink = Boolean(
    args['print-password-reset-link'] || args['password-reset-link']
  );
  const serviceAccount = loadServiceAccount(optionalString(args, 'service-account'));

  validateAcademyId(academyId);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const auth = admin.auth();
  const db = admin.firestore();

  const academySnap = await db.collection('academies').doc(academyId).get();
  if (!academySnap.exists) {
    throw new Error(`Academy not found: academies/${academyId}`);
  }

  const studentSnap = await db.collection('privateStudents').doc(studentId).get();
  if (!studentSnap.exists) {
    throw new Error(`Student not found: privateStudents/${studentId}`);
  }

  const studentData = studentSnap.data() || {};
  if (String(studentData.academyId || '').trim() !== academyId) {
    throw new Error(`privateStudents/${studentId} does not belong to academy ${academyId}`);
  }

  const resolvedDisplayName = displayName || String(studentData.name || '').trim() || email;
  const existingAuthUser = await getAuthUserByEmail({ auth, email });
  const existingUid = existingAuthUser?.uid || '';
  const membershipId = existingUid ? `${academyId}_${existingUid}` : '';

  const [
    userSnap,
    sameMembershipSnap,
    linkedStudentMembershipSnap,
  ] = await Promise.all([
    existingUid
      ? db.collection('users').doc(existingUid).get()
      : Promise.resolve(null),
    membershipId
      ? db.collection('academyMemberships').doc(membershipId).get()
      : Promise.resolve(null),
    db
      .collection('academyMemberships')
      .where('academyId', '==', academyId)
      .where('studentId', '==', studentId)
      .get(),
  ]);

  const safety = assertSafeStudentAccountLink({
    uid: existingUid || '__new_auth_user__',
    targetStudentId: studentId,
    authCustomClaims: existingAuthUser?.customClaims || null,
    userProfile: userSnap?.exists ? userSnap.data() || {} : null,
    sameAcademyMembership: sameMembershipSnap?.exists ? sameMembershipSnap.data() || {} : null,
    matchingStudentMemberships: linkedStudentMembershipSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data() || {},
    })),
  });

  const { action, userRecord } = existingAuthUser
    ? await updateAuthUser({
        auth,
        uid: existingAuthUser.uid,
        email,
        displayName: resolvedDisplayName,
        password,
      })
    : await createAuthUser({
        auth,
        email,
        displayName: resolvedDisplayName,
        password,
      });
  const uid = userRecord.uid;

  await setMergeWithTimestamps(db.collection('users').doc(uid), {
    uid,
    email,
    displayName: resolvedDisplayName,
    accountScope: 'global',
    role: 'student',
    isActive: true,
    teacherName: '',
    lastSelectedAcademyId: academyId,
  });

  const resolvedMembershipId = `${academyId}_${uid}`;
  await setMergeWithTimestamps(db.collection('academyMemberships').doc(resolvedMembershipId), {
    academyId,
    uid,
    email,
    displayName: resolvedDisplayName,
    role: 'student',
    studentId,
    teacherName: '',
    status: 'active',
    permissions: STUDENT_ACCOUNT_PERMISSIONS,
  });

  await createStudentAccessSummaryDocsIfMissing(db, { academyId, studentId });

  const passwordResetLink = shouldPrintPasswordResetLink
    ? await auth.generatePasswordResetLink(email, STUDENT_PASSWORD_SETUP_ACTION_SETTINGS)
    : '';

  console.log(JSON.stringify({
    ok: true,
    authUser: action,
    uid,
    email,
    academyId,
    studentId,
    membershipId: resolvedMembershipId,
    alreadyLinked: safety.alreadyLinked,
    passwordSet: Boolean(password),
    ...(passwordResetLink ? { passwordResetLink } : {}),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
