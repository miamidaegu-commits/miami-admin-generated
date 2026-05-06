import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = '123456';
const ACADEMY_ID = 'academy_e2e_default';
const ACADEMY_NAME = 'Miami E2E Academy';
const SERVICE_ACCOUNT_PATH = path.join(repoRoot, 'serviceAccountKey.json');
const FIREBASE_VERSION = '10.12.2';
const HOSTED_APP_URL = 'https://miami-e2e.web.app';

function loadEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }

  return env;
}

function firebaseConfigFromEnv(env) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

function printResult(name, ok, detail = {}) {
  const payload = { name, ok, ...detail };
  assertSafeProbeOutput(payload);
  console.log(JSON.stringify(payload));
}

function sanitizeCallableResultForLog(result = {}) {
  const { passwordResetLink, resetLink, link, oobCode, ...safe } = result || {};
  return {
    ...safe,
    passwordResetLinkReturned: typeof passwordResetLink === 'string' && passwordResetLink.trim().length > 0,
    resetLinkReturned: typeof resetLink === 'string' && resetLink.trim().length > 0,
  };
}

function assertSafeProbeOutput(payload) {
  const raw = JSON.stringify(payload);
  assert.equal(
    /"(passwordResetLink|resetLink|link|oobCode)"\s*:/.test(raw),
    false,
    'probe output must not contain reset-link fields'
  );
  assert.equal(raw.includes('passwordResetLinkUrl'), false);
  assert.equal(raw.includes('oobCode='), false);
  assert.equal(raw.includes('https://'), false);
}

function assertNonEmptyUrl(value, label) {
  assert.equal(typeof value, 'string', `${label} should be a string`);
  assert.ok(value.trim(), `${label} should not be empty`);
  const parsed = new URL(value);
  assert.ok(['http:', 'https:'].includes(parsed.protocol), `${label} should be an HTTP URL`);
  return parsed.href;
}

async function getAuthUserByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function deleteAuthUserByEmail(auth, email) {
  const user = await getAuthUserByEmail(auth, email);
  if (!user) return null;
  await auth.deleteUser(user.uid);
  return user.uid;
}

async function deleteProvisioningLogs(db, email) {
  const snap = await db.collection('accountProvisioningLogs').where('email', '==', email).get();
  const batch = db.batch();
  snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  if (!snap.empty) await batch.commit();
  return snap.size;
}

async function findProvisioningLogs(db, { email, studentId, uid }) {
  const snap = await db.collection('accountProvisioningLogs').where('email', '==', email).get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((row) => row.studentId === studentId && row.uid === uid);
}

function assertProvisioningLogsDoNotContainPasswordResetLink(logs) {
  for (const log of logs) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(log, 'passwordResetLink'),
      false,
      'accountProvisioningLogs must not persist passwordResetLink'
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(log, 'resetLink'),
      false,
      'accountProvisioningLogs must not persist resetLink'
    );
  }
}

async function ensureE2EAdminFixture({ auth, db }) {
  const adminUser = await auth.getUserByEmail(ADMIN_EMAIL);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const permissions = {
    canManageAttendance: true,
    canAddStudent: true,
    canEditStudent: true,
    canDeleteStudent: true,
    canEditLesson: true,
    canDeleteLesson: true,
    canCreateLessonDirectly: true,
    requiresLessonApproval: false,
  };

  await Promise.all([
    db.collection('academies').doc(ACADEMY_ID).set(
      {
        id: ACADEMY_ID,
        name: ACADEMY_NAME,
        slug: ACADEMY_ID,
        status: 'active',
        timezone: 'Asia/Seoul',
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('users').doc(adminUser.uid).set(
      {
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        lastSelectedAcademyId: ACADEMY_ID,
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('academyMemberships').doc(`${ACADEMY_ID}_${adminUser.uid}`).set(
      {
        academyId: ACADEMY_ID,
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        displayName: 'Admin E2E',
        role: 'owner',
        teacherName: '',
        status: 'active',
        permissions,
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);

  return adminUser;
}

async function verifyLinkedState({ auth, db, email, studentId }) {
  const authUser = await auth.getUserByEmail(email);
  const uid = authUser.uid;
  const membershipId = `${ACADEMY_ID}_${uid}`;
  const [userSnap, membershipSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('academyMemberships').doc(membershipId).get(),
  ]);
  const logs = await findProvisioningLogs(db, { email, studentId, uid });

  assert.equal(userSnap.exists, true, 'users/{uid} should exist');
  assert.equal(membershipSnap.exists, true, 'academyMemberships/{academyId_uid} should exist');
  assertProvisioningLogsDoNotContainPasswordResetLink(logs);

  const userData = userSnap.data() || {};
  const membership = membershipSnap.data() || {};
  assert.equal(userData.email, email);
  assert.equal(userData.role, 'student');
  assert.equal(membership.role, 'student');
  assert.equal(membership.status, 'active');
  assert.equal(membership.studentId, studentId);
  assert.equal(membership.uid, uid);
  assert.ok(logs.length > 0, 'accountProvisioningLogs should contain a success entry');
  for (const log of logs) {
    assert.equal(log.academyId, ACADEMY_ID);
    assert.equal(log.actorUid && typeof log.actorUid === 'string', true);
    assert.equal(log.studentId, studentId);
    assert.equal(log.uid, uid);
    assert.equal(log.email, email);
    assert.equal(log.membershipId, membershipId);
    assert.equal(typeof log.alreadyLinked, 'boolean');
    assert.equal(log.passwordSet, false);
    assert.ok(['created', 'updated'].includes(log.action), 'log action should be created/updated');
    assert.equal(log.result, 'success');
  }

  return {
    uid,
    membershipId,
    userRole: userData.role,
    membershipRole: membership.role,
    membershipStatus: membership.status,
    studentId: membership.studentId,
    logCount: logs.length,
  };
}

async function verifyAccessSummaries({ db, academyId, studentId, expected }) {
  const summaryId = `${academyId}__${studentId}`;
  const [groupSnap, privateSnap] = await Promise.all([
    db.collection('studentGroupAccessSummary').doc(summaryId).get(),
    db.collection('studentPrivateAccessSummary').doc(summaryId).get(),
  ]);

  assert.equal(groupSnap.exists, true, 'studentGroupAccessSummary doc should exist');
  assert.equal(privateSnap.exists, true, 'studentPrivateAccessSummary doc should exist');

  const groupSummary = groupSnap.data() || {};
  const privateSummary = privateSnap.data() || {};
  assert.equal(groupSummary.academyId, academyId);
  assert.equal(groupSummary.studentId, studentId);
  assert.equal(privateSummary.academyId, academyId);
  assert.equal(privateSummary.studentId, studentId);

  if (expected) {
    assert.deepEqual(groupSummary.groupClassIds || [], expected.groupClassIds);
    assert.deepEqual(privateSummary.teacherKeys || [], expected.teacherKeys);
    assert.deepEqual(privateSummary.activePackageIds || [], expected.activePackageIds);
  }

  return {
    summaryId,
    groupClassIds: groupSummary.groupClassIds || [],
    teacherKeys: privateSummary.teacherKeys || [],
    activePackageIds: privateSummary.activePackageIds || [],
  };
}

async function callLinkStudentAccountInBrowser({ page, firebaseConfig, data }) {
  const result = await page.evaluate(
    async ({ firebaseConfig: config, firebaseVersion, adminEmail, adminPassword, payload }) => {
      const [{ deleteApp, initializeApp }, authModule, functionsModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-functions.js`),
      ]);

      const app = initializeApp(config, `link-student-account-probe-${Date.now()}`);
      const auth = authModule.getAuth(app);
      try {
        const credentials = await authModule.signInWithEmailAndPassword(
          auth,
          adminEmail,
          adminPassword
        );
        await credentials.user.getIdToken(true);
        const callable = functionsModule.httpsCallable(
          functionsModule.getFunctions(app, 'us-central1'),
          'linkStudentAccount'
        );
        const callableResult = await callable(payload);
        return { ok: true, data: callableResult.data };
      } catch (error) {
        return {
          ok: false,
          code: error?.code || '',
          message: error?.message || String(error),
        };
      } finally {
        await authModule.signOut(auth).catch(() => {});
        await deleteApp(app).catch(() => {});
      }
    },
    {
      firebaseConfig,
      firebaseVersion: FIREBASE_VERSION,
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
      payload: data,
    }
  );

  if (!result.ok) {
    const error = new Error(result.message || 'Callable failed.');
    error.code = result.code;
    throw error;
  }

  return result.data;
}

async function expectCallableRejected({ page, firebaseConfig, data, expectedCode }) {
  try {
    await callLinkStudentAccountInBrowser({ page, firebaseConfig, data });
  } catch (error) {
    assert.equal(error.code, expectedCode);
    return {
      code: error.code,
      message: error.message,
    };
  }
  throw new Error(`Expected callable rejection with ${expectedCode}`);
}

async function main() {
  const env = loadEnvFile(path.join(repoRoot, '.env.e2e'));
  const firebaseConfig = firebaseConfigFromEnv(env);
  assert.equal(firebaseConfig.projectId, 'miami-e2e');
  printResult('client_config_project', true, { projectId: firebaseConfig.projectId });

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  assert.equal(serviceAccount.project_id, 'miami-e2e');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const adminAuth = admin.auth();
  const db = admin.firestore();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const studentId = `e2e-link-live-student-${unique}`;
  const studentName = `E2E Link Live ${unique}`;
  const email = `e2e-link-live-${unique}@example.com`;
  const protectedEmail = `e2e-link-protected-${unique}@example.com`;
  const protectedPassword = '123456';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let linkedUid = '';
  let protectedUid = '';
  let cleanupOk = true;

  try {
    await ensureE2EAdminFixture({ auth: adminAuth, db });
    printResult('admin_fixture_ready', true, { academyId: ACADEMY_ID });

    await db.collection('privateStudents').doc(studentId).set({
      academyId: ACADEMY_ID,
      name: studentName,
      teacher: 'teacher',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    printResult('private_student_ready', true, { studentId });

    await page.goto('about:blank');

    const firstCall = await callLinkStudentAccountInBrowser({
      page,
      firebaseConfig,
      data: {
        academyId: ACADEMY_ID,
        studentId,
        email,
        displayName: studentName,
      },
    });
    assert.equal(firstCall?.ok, true);
    assert.equal(firstCall?.email, email);
    assert.equal(firstCall?.studentId, studentId);
    assert.equal(firstCall?.passwordSet, false);
    const firstResetLink = assertNonEmptyUrl(firstCall?.passwordResetLink, 'passwordResetLink');
    assert.ok(
      firstCall.passwordResetLink.includes(encodeURIComponent(HOSTED_APP_URL)) ||
        firstCall.passwordResetLink.includes(HOSTED_APP_URL),
      'passwordResetLink should include hosted app return URL'
    );
    printResult('callable_first_link', true, {
      ...sanitizeCallableResultForLog(firstCall),
      passwordResetLinkValid: true,
      passwordResetLinkHost: new URL(firstResetLink).host,
    });

    const firstVerification = await verifyLinkedState({
      auth: adminAuth,
      db,
      email,
      studentId,
    });
    linkedUid = firstVerification.uid;
    printResult('writes_after_first_link', true, firstVerification);

    const emptySummaryVerification = await verifyAccessSummaries({
      db,
      academyId: ACADEMY_ID,
      studentId,
      expected: {
        groupClassIds: [],
        teacherKeys: [],
        activePackageIds: [],
      },
    });
    printResult('empty_access_summaries_after_first_link', true, emptySummaryVerification);

    const summaryId = `${ACADEMY_ID}__${studentId}`;
    const preservedAccess = {
      groupClassIds: [`preserved-group-${unique}`],
      teacherKeys: [`preserved-teacher-${unique}`],
      activePackageIds: [`preserved-package-${unique}`],
    };
    await Promise.all([
      db.collection('studentGroupAccessSummary').doc(summaryId).set(
        {
          groupClassIds: preservedAccess.groupClassIds,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.collection('studentPrivateAccessSummary').doc(summaryId).set(
        {
          teacherKeys: preservedAccess.teacherKeys,
          activePackageIds: preservedAccess.activePackageIds,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);
    printResult('seeded_existing_access_summaries', true, {
      summaryId,
      ...preservedAccess,
    });

    const secondCall = await callLinkStudentAccountInBrowser({
      page,
      firebaseConfig,
      data: {
        academyId: ACADEMY_ID,
        studentId,
        email,
        displayName: studentName,
      },
    });
    assert.equal(secondCall?.ok, true);
    assert.equal(secondCall?.alreadyLinked, true);
    assert.equal(secondCall?.uid, linkedUid);
    assertNonEmptyUrl(secondCall?.passwordResetLink, 'idempotent passwordResetLink');
    printResult('callable_idempotent_rerun', true, {
      ...sanitizeCallableResultForLog(secondCall),
      passwordResetLinkValid: true,
    });

    const preservedSummaryVerification = await verifyAccessSummaries({
      db,
      academyId: ACADEMY_ID,
      studentId,
      expected: preservedAccess,
    });
    printResult('access_summaries_preserved_after_idempotent_rerun', true, {
      ...preservedSummaryVerification,
      preserved: true,
    });

    const secondVerification = await verifyLinkedState({
      auth: adminAuth,
      db,
      email,
      studentId,
    });
    assert.ok(secondVerification.logCount >= 2, 'idempotent rerun should add a second audit log');
    printResult('writes_after_idempotent_rerun', true, secondVerification);

    const protectedUser = await adminAuth.createUser({
      email: protectedEmail,
      displayName: 'Protected Link Probe',
      password: protectedPassword,
      disabled: false,
    });
    protectedUid = protectedUser.uid;
    await Promise.all([
      adminAuth.setCustomUserClaims(protectedUid, { role: 'admin' }),
      db.collection('users').doc(protectedUid).set({
        uid: protectedUid,
        email: protectedEmail,
        role: 'admin',
        isActive: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
    ]);

    const rejection = await expectCallableRejected({
      page,
      firebaseConfig,
      data: {
        academyId: ACADEMY_ID,
        studentId,
        email: protectedEmail,
        displayName: 'Protected Link Probe',
      },
      expectedCode: 'functions/failed-precondition',
    });
    printResult('protected_role_email_rejected', true, rejection);
  } catch (error) {
    printResult('probe_failed', false, {
      message: error?.message || String(error),
      stack: error?.stack || '',
    });
    process.exitCode = 1;
  } finally {
    try {
      await browser.close().catch(() => {});

      const resolvedLinkedUid = linkedUid || (await getAuthUserByEmail(adminAuth, email))?.uid || '';
      if (resolvedLinkedUid) {
        await Promise.all([
          db.collection('users').doc(resolvedLinkedUid).delete().catch(() => {}),
          db.collection('academyMemberships').doc(`${ACADEMY_ID}_${resolvedLinkedUid}`).delete().catch(() => {}),
          db.collection('studentGroupAccessSummary').doc(`${ACADEMY_ID}__${studentId}`).delete().catch(() => {}),
          db.collection('studentPrivateAccessSummary').doc(`${ACADEMY_ID}__${studentId}`).delete().catch(() => {}),
        ]);
      }
      if (protectedUid) {
        await Promise.all([
          db.collection('users').doc(protectedUid).delete().catch(() => {}),
          db.collection('academyMemberships').doc(`${ACADEMY_ID}_${protectedUid}`).delete().catch(() => {}),
        ]);
      }

      const [deletedLinkedUid, deletedProtectedUid, linkedLogsDeleted, protectedLogsDeleted] =
        await Promise.all([
          deleteAuthUserByEmail(adminAuth, email).catch(() => null),
          deleteAuthUserByEmail(adminAuth, protectedEmail).catch(() => null),
          deleteProvisioningLogs(db, email),
          deleteProvisioningLogs(db, protectedEmail),
          db.collection('privateStudents').doc(studentId).delete().catch(() => {}),
        ]);

      printResult('cleanup', true, {
        studentId,
        deletedLinkedUid,
        deletedProtectedUid,
        linkedLogsDeleted,
        protectedLogsDeleted,
      });
    } catch (error) {
      cleanupOk = false;
      printResult('cleanup', false, {
        message: error?.message || String(error),
        stack: error?.stack || '',
      });
    }
  }

  if (!cleanupOk) process.exitCode = 1;
}

main().catch((error) => {
  printResult('probe_unhandled_failure', false, {
    message: error?.message || String(error),
    stack: error?.stack || '',
  });
  process.exitCode = 1;
});
