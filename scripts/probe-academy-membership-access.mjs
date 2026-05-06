import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { initializeApp as initializeClientApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const serviceAccount = require(path.join(repoRoot, 'serviceAccountKey.json'));

function loadEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

const env = loadEnvFile(path.join(repoRoot, '.env.e2e'));
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

if (firebaseConfig.projectId !== 'miami-e2e') {
  throw new Error(`Expected miami-e2e Firebase config, received ${String(firebaseConfig.projectId || '')}`);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const adminDb = admin.firestore();
const ACADEMY_ID = 'academy_e2e_default';
const ADMIN_EMAIL = 'admin@example.com';
const STUDENT_EMAIL = 'student@example.com';
const PASSWORD = '123456';

let failures = 0;

function print(result) {
  console.log(JSON.stringify(result));
  if (!result.ok) failures += 1;
}

function printExpectedDenied(name, error) {
  const denied = error?.code === 'permission-denied';
  print({
    name,
    ok: denied,
    expected: 'permission-denied',
    code: error?.code || null,
    message: error?.message || String(error),
  });
}

async function expectAllowed(name, fn) {
  try {
    const value = await fn();
    print({ name, ok: true, ...value });
  } catch (error) {
    print({
      name,
      ok: false,
      code: error?.code || null,
      message: error?.message || String(error),
    });
  }
}

async function expectDenied(name, fn) {
  try {
    const value = await fn();
    print({
      name,
      ok: false,
      expected: 'permission-denied',
      actual: 'allowed',
      ...value,
    });
  } catch (error) {
    printExpectedDenied(name, error);
  }
}

async function signInClient(email) {
  const app = initializeClientApp(firebaseConfig, `membership-probe-${email}-${Date.now()}`);
  const auth = getAuth(app);
  const creds = await signInWithEmailAndPassword(auth, email, PASSWORD);
  return {
    app,
    auth,
    db: getFirestore(app),
    user: creds.user,
  };
}

async function closeClient(client) {
  await signOut(client.auth).catch(() => {});
  await deleteApp(client.app).catch(() => {});
}

async function activeMembershipsByUid(db, uid) {
  return getDocs(query(
    collection(db, 'academyMemberships'),
    where('uid', '==', uid),
    where('status', '==', 'active')
  ));
}

async function membershipsByAcademy(db) {
  return getDocs(query(
    collection(db, 'academyMemberships'),
    where('academyId', '==', ACADEMY_ID)
  ));
}

async function main() {
  const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const expectedAdminMembershipId = `${ACADEMY_ID}_${adminUser.uid}`;
  const adminMembershipSnap = await adminDb
    .collection('academyMemberships')
    .doc(expectedAdminMembershipId)
    .get();
  const adminMembership = adminMembershipSnap.exists ? adminMembershipSnap.data() : null;

  print({
    name: 'admin_membership_document_shape',
    ok:
      adminMembershipSnap.exists &&
      adminMembership?.uid === adminUser.uid &&
      adminMembership?.academyId === ACADEMY_ID &&
      ['owner', 'admin'].includes(String(adminMembership?.role || '').toLowerCase()) &&
      adminMembership?.status === 'active',
    membershipId: expectedAdminMembershipId,
    exists: adminMembershipSnap.exists,
    uidMatches: adminMembership?.uid === adminUser.uid,
    academyId: adminMembership?.academyId || null,
    role: adminMembership?.role || null,
    status: adminMembership?.status || null,
  });

  const adminClient = await signInClient(ADMIN_EMAIL);
  const studentClient = await signInClient(STUDENT_EMAIL);

  try {
    await expectAllowed('admin_query_own_active_memberships_by_uid', async () => {
      const snap = await activeMembershipsByUid(adminClient.db, adminClient.user.uid);
      return { size: snap.size, ids: snap.docs.map((docItem) => docItem.id) };
    });

    await expectAllowed('student_query_own_active_memberships_by_uid', async () => {
      const snap = await activeMembershipsByUid(studentClient.db, studentClient.user.uid);
      return { size: snap.size, ids: snap.docs.map((docItem) => docItem.id) };
    });

    await expectDenied('admin_unscoped_academy_memberships_query_denied', async () => {
      const snap = await getDocs(collection(adminClient.db, 'academyMemberships'));
      return { size: snap.size };
    });

    await expectAllowed('admin_query_memberships_by_academy', async () => {
      const snap = await membershipsByAcademy(adminClient.db);
      return { size: snap.size, ids: snap.docs.map((docItem) => docItem.id) };
    });

    await expectDenied('student_query_memberships_by_academy_denied', async () => {
      const snap = await membershipsByAcademy(studentClient.db);
      return { size: snap.size };
    });
  } finally {
    await closeClient(adminClient);
    await closeClient(studentClient);
  }

  if (failures > 0) {
    throw new Error(`${failures} membership access probe case(s) failed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
