import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const RUN_TEACHER_ACCOUNT_LINKING_CALLABLE_E2E =
  process.env.RUN_TEACHER_ACCOUNT_LINKING_CALLABLE_E2E === '1';
const TEACHER_PERMISSIONS = {
  canManageAttendance: false,
  canAddStudent: false,
  canEditStudent: false,
  canDeleteStudent: false,
  canEditLesson: false,
  canDeleteLesson: false,
  canCreateLessonDirectly: false,
  requiresLessonApproval: true,
};

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  if (admin.apps.find((app) => app?.name === '[DEFAULT]')) return;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
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
}

function expectProvisioningLogsDoNotContainPasswordResetLink(logs) {
  for (const log of logs) {
    expect(log).not.toHaveProperty('passwordResetLink');
    expect(log).not.toHaveProperty('resetLink');
    expect(log).not.toHaveProperty('oobCode');
    expect(JSON.stringify(log)).not.toContain('mode=resetPassword');
  }
}

async function ensureAdminFixture({ auth, db }) {
  const adminUser = await auth.getUserByEmail(ADMIN_EMAIL);
  const nowTs = admin.firestore.FieldValue.serverTimestamp();
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
    db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID).set(
      {
        id: DEFAULT_E2E_ACADEMY_ID,
        name: DEFAULT_E2E_ACADEMY_NAME,
        slug: DEFAULT_E2E_ACADEMY_ID,
        status: 'active',
        timezone: 'Asia/Seoul',
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('users').doc(adminUser.uid).set(
      {
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${adminUser.uid}`).set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        displayName: 'Admin E2E',
        role: 'owner',
        teacherName: '',
        status: 'active',
        permissions,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
  ]);
}

async function ensureTeacherLoginFixture({ auth, db }) {
  const teacherUser = await auth.getUserByEmail(TEST_TEACHER_EMAIL);
  await Promise.all([
    auth.setCustomUserClaims(teacherUser.uid, { role: 'teacher' }),
    db.collection('users').doc(teacherUser.uid).set(
      {
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        role: 'teacher',
        isActive: true,
        teacherName: 'teacher',
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`).set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        displayName: 'Teacher E2E',
        role: 'teacher',
        teacherName: 'teacher',
        status: 'active',
        permissions: TEACHER_PERMISSIONS,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);
}

async function createTeacherDoc({ db, teacherId, name, teacherKey, status = 'active' }) {
  await db.collection('teachers').doc(teacherId).set({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    name,
    teacherName: teacherKey,
    teacherKey,
    status,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function verifyTeacherAccountWrites({ auth, db, email, teacherId, teacherKey }) {
  const authUser = await auth.getUserByEmail(email);
  const uid = authUser.uid;
  const membershipId = `${DEFAULT_E2E_ACADEMY_ID}_${uid}`;
  const [userSnap, membershipSnap, logSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('academyMemberships').doc(membershipId).get(),
    db.collection('accountProvisioningLogs').where('email', '==', email).get(),
  ]);

  expect(userSnap.exists).toBe(true);
  expect(membershipSnap.exists).toBe(true);

  const userData = userSnap.data() || {};
  const membership = membershipSnap.data() || {};
  expect(userData.email).toBe(email);
  expect(userData.role).toBe('teacher');
  expect(userData.teacherName).toBe(teacherKey);
  expect(userData.lastSelectedAcademyId).toBe(DEFAULT_E2E_ACADEMY_ID);
  expect(membership.academyId).toBe(DEFAULT_E2E_ACADEMY_ID);
  expect(membership.uid).toBe(uid);
  expect(membership.role).toBe('teacher');
  expect(membership.status).toBe('active');
  expect(membership.teacherName).toBe(teacherKey);
  expect(membership.permissions || {}).toMatchObject(TEACHER_PERMISSIONS);

  const matchingLogs = logSnap.docs
    .map((docSnap) => docSnap.data() || {})
    .filter((row) => row.teacherId === teacherId && row.teacherKey === teacherKey && row.uid === uid);
  expect(matchingLogs.length).toBeGreaterThan(0);
  expectProvisioningLogsDoNotContainPasswordResetLink(matchingLogs);
  for (const log of matchingLogs) {
    expect(log.academyId).toBe(DEFAULT_E2E_ACADEMY_ID);
    expect(typeof log.actorUid).toBe('string');
    expect(log.actorUid.length).toBeGreaterThan(0);
    expect(log.uid).toBe(uid);
    expect(log.email).toBe(email);
    expect(log.membershipId).toBe(membershipId);
    expect(typeof log.alreadyLinked).toBe('boolean');
    expect(['created', 'updated']).toContain(log.action);
    expect(log.result).toBe('success');
  }

  return { uid, membershipId };
}

test('admin creates a teacher login invitation through dashboard UI', async ({ page }) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for live account-link smoke.');
  test.skip(
    !RUN_TEACHER_ACCOUNT_LINKING_CALLABLE_E2E,
    'linkTeacherAccount is not currently deployed in miami-e2e; set RUN_TEACHER_ACCOUNT_LINKING_CALLABLE_E2E=1 to run the live callable submit flow.'
  );
  test.setTimeout(120000);
  initializeAdmin();

  const db = admin.firestore();
  const auth = admin.auth();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const teacherId = `e2e-ui-link-teacher-${unique}`;
  const teacherName = `초대선생님 ${unique}`;
  const teacherKey = `teacher-${unique}`;
  const email = `e2e-ui-teacher-link-${unique}@example.com`;
  const protectedEmail = `e2e-ui-teacher-protected-${unique}@example.com`;
  let linkedUid = '';
  let protectedUid = '';

  await ensureAdminFixture({ auth, db });
  await createTeacherDoc({ db, teacherId, name: teacherName, teacherKey });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '선생님 관리');

    const teacherRow = page
      .getByTestId('teacher-management-row')
      .filter({ hasText: teacherName })
      .first();
    await expect(teacherRow).toBeVisible({ timeout: 15000 });
    await expect(teacherRow.getByTestId('teacher-invite-open-button')).toHaveText('로그인 초대');
    await teacherRow.getByTestId('teacher-invite-open-button').click();

    const modal = page.getByTestId('teacher-invite-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: '선생님 로그인 초대' })).toBeVisible();
    await expect(modal).toContainText(teacherName);
    await expect(modal).toContainText(`teacherKey: ${teacherKey}`);
    await expect(modal.getByTestId('teacher-invite-display-name-input')).toHaveValue(teacherName);
    await modal.getByTestId('teacher-invite-email-input').fill(email);
    await modal.getByTestId('teacher-invite-submit-button').click();

    const success = modal.getByTestId('teacher-invite-success');
    await expect(success).toBeVisible({ timeout: 30000 });
    await expect(success).toContainText('초대 링크 준비 완료');

    const invitationMessage = modal.getByTestId('teacher-invite-invitation-message');
    await expect(modal.getByTestId('teacher-invite-invitation-section')).toContainText(
      '선생님에게 보낼 안내문'
    );
    await expect(invitationMessage).toContainText(`로그인 이메일: ${email}`);
    await expect(invitationMessage).toContainText('로그인 페이지: https://miami-e2e.web.app');
    await expect(invitationMessage).toContainText('비밀번호 설정 링크: https://');

    const messageText = await invitationMessage.innerText();
    const resetLink = messageText.match(/비밀번호 설정 링크:\s*(https?:\/\/\S+)/)?.[1] || '';
    expect(resetLink).toMatch(/^https?:\/\//);
    expect(messageText).not.toContain('uid:');
    expect(messageText).not.toContain('membershipId:');
    expect(messageText).not.toContain('teacherId:');

    await modal.getByTestId('teacher-invite-copy-button').click();
    await expect(modal.getByTestId('teacher-invite-copy-button')).toHaveText('복사 완료');

    await expect
      .poll(async () => {
        await verifyTeacherAccountWrites({ auth, db, email, teacherId, teacherKey });
        return true;
      }, { timeout: 30000 })
      .toBe(true);

    linkedUid = (await auth.getUserByEmail(email)).uid;

    const protectedUser = await auth.createUser({
      email: protectedEmail,
      displayName: 'Protected Teacher Link Probe',
      password: '123456',
      disabled: false,
    });
    protectedUid = protectedUser.uid;
    await Promise.all([
      auth.setCustomUserClaims(protectedUid, { role: 'admin' }),
      db.collection('users').doc(protectedUid).set({
        uid: protectedUid,
        email: protectedEmail,
        role: 'admin',
        isActive: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }),
    ]);

    await modal.getByTestId('teacher-invite-email-input').fill(protectedEmail);
    await modal.getByTestId('teacher-invite-display-name-input').fill('Protected Teacher Link Probe');
    await modal.getByTestId('teacher-invite-submit-button').click();
    await expect(modal.getByTestId('teacher-invite-error')).toContainText(
      '이미 다른 권한으로 연결된 이메일은 사용할 수 없습니다.',
      { timeout: 30000 }
    );
  } finally {
    const resolvedUid = linkedUid || (await getAuthUserByEmail(auth, email))?.uid || '';
    await Promise.all([
      db.collection('teachers').doc(teacherId).delete().catch(() => {}),
      resolvedUid ? db.collection('users').doc(resolvedUid).delete().catch(() => {}) : Promise.resolve(),
      resolvedUid
        ? db
            .collection('academyMemberships')
            .doc(`${DEFAULT_E2E_ACADEMY_ID}_${resolvedUid}`)
            .delete()
            .catch(() => {})
        : Promise.resolve(),
      protectedUid ? db.collection('users').doc(protectedUid).delete().catch(() => {}) : Promise.resolve(),
      deleteAuthUserByEmail(auth, email).catch(() => null),
      deleteAuthUserByEmail(auth, protectedEmail).catch(() => null),
      deleteProvisioningLogs(db, email).catch(() => {}),
      deleteProvisioningLogs(db, protectedEmail).catch(() => {}),
    ]);
  }
});

test('admin can open teacher login invitation UI for an active teacher', async ({ page }) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for live account-link smoke.');
  initializeAdmin();

  const db = admin.firestore();
  const auth = admin.auth();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const teacherId = `e2e-ui-link-teacher-modal-${unique}`;
  const teacherName = `초대선생님 ${unique}`;
  const teacherKey = `teacher-modal-${unique}`;

  await ensureAdminFixture({ auth, db });
  await createTeacherDoc({ db, teacherId, name: teacherName, teacherKey });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '선생님 관리');

    const teacherRow = page
      .getByTestId('teacher-management-row')
      .filter({ hasText: teacherName })
      .first();
    await expect(teacherRow).toBeVisible({ timeout: 15000 });
    await teacherRow.getByTestId('teacher-invite-open-button').click();

    const modal = page.getByTestId('teacher-invite-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: '선생님 로그인 초대' })).toBeVisible();
    await expect(modal).toContainText(teacherName);
    await expect(modal).toContainText(`teacherKey: ${teacherKey}`);
    await expect(modal.getByTestId('teacher-invite-display-name-input')).toHaveValue(teacherName);
    await expect(modal.getByTestId('teacher-invite-email-input')).toBeVisible();
    await modal.getByTestId('teacher-invite-email-input').fill(
      `e2e-ui-teacher-modal-${unique}@example.com`
    );
    await expect(modal.getByTestId('teacher-invite-submit-button')).toBeEnabled();
  } finally {
    await db.collection('teachers').doc(teacherId).delete().catch(() => {});
  }
});

test('non-admin dashboard users cannot see teacher invite UI', async ({ page }) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for live account-link smoke.');
  initializeAdmin();

  const db = admin.firestore();
  const auth = admin.auth();
  await ensureAdminFixture({ auth, db });
  await ensureTeacherLoginFixture({ auth, db });

  await page.goto(`${BASE_URL}login/`);
  await page
    .getByLabel(/Email|이메일/i)
    .or(page.locator('input[type="email"]'))
    .first()
    .fill(TEST_TEACHER_EMAIL);
  await page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(TEST_TEACHER_PASSWORD);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: '선생님 관리', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('teacher-invite-open-button')).toHaveCount(0);
});
