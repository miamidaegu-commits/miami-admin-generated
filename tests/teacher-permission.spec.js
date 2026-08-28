import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { BASE_URL } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';
import { buildTeacherPrivateLessonRequestPlans } from '../src/features/dashboard/teacherPrivateLessonRequestPlanning.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const EXPECTED_ADMIN_CREDENTIAL_PROJECT_ID = 'miami-e2e';
const LOGIN_ATTEMPT_TIMEOUT_MS = 15000;
const CANONICAL_TEACHER_GROUP_CLASS_FIXTURE_ID =
  'e2e-teacher-permission-canonical-group-class';

function hasServiceAccount() {
  return Boolean(
    String(process.env.MIAMI_E2E_SERVICE_ACCOUNT_KEY_B64 || '').trim() ||
      fs.existsSync(SERVICE_ACCOUNT_PATH)
  );
}

function parseAdminServiceAccountJson(rawJson) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(rawJson);
  } catch {
    throw new Error('E2E Admin credential JSON is malformed.');
  }
  if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) {
    throw new Error('E2E Admin credential must be a JSON object.');
  }
  if (serviceAccount.project_id !== EXPECTED_ADMIN_CREDENTIAL_PROJECT_ID) {
    throw new Error('E2E Admin credential project mismatch.');
  }
  for (const fieldName of ['client_email', 'private_key']) {
    if (!String(serviceAccount[fieldName] || '').trim()) {
      throw new Error(`E2E Admin credential is missing ${fieldName}.`);
    }
  }
  return serviceAccount;
}

function readBase64AdminServiceAccount(encodedCredential) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encodedCredential
    )
  ) {
    throw new Error('E2E Admin credential Base64 is malformed.');
  }
  return parseAdminServiceAccountJson(
    Buffer.from(encodedCredential, 'base64').toString('utf8')
  );
}

function resolveAdminServiceAccount() {
  const encodedCredential = String(
    process.env.MIAMI_E2E_SERVICE_ACCOUNT_KEY_B64 || ''
  ).trim();
  if (encodedCredential) {
    return readBase64AdminServiceAccount(encodedCredential);
  }
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    return parseAdminServiceAccountJson(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  }
  return null;
}

function getAdminApp() {
  const existing = admin.apps.find((app) => app?.name === 'teacher-permission-e2e');
  if (existing) return existing;

  const serviceAccount = resolveAdminServiceAccount();
  if (!serviceAccount) {
    throw new Error('E2E Admin credential is required.');
  }

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    'teacher-permission-e2e'
  );
}

function getDb() {
  return getAdminApp().firestore();
}

async function findLessonRequestsBySubject(subject) {
  const snap = await getDb()
    .collection('lessonRequests')
    .where('subject', '==', subject)
    .get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((request) => request.academyId === DEFAULT_E2E_ACADEMY_ID);
}

async function countPrivateLessonSlotsByDateTime(date, time) {
  const snap = await getDb()
    .collection('privateLessonSlots')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .get();
  return snap.docs.filter((docSnap) => {
    const slot = docSnap.data() || {};
    return slot.date === date && slot.time === time;
  }).length;
}

async function findGroupClassesByName(name) {
  const snap = await getDb()
    .collection('groupClasses')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('name', '==', name)
    .get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

async function deleteGroupClassArtifacts(groupClassId) {
  if (!groupClassId) return;
  const db = getDb();
  const lessonSnap = await db
    .collection('groupLessons')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('groupClassId', '==', groupClassId)
    .get();
  const refs = [
    db.collection('groupClasses').doc(groupClassId),
    ...lessonSnap.docs.map((docSnap) => docSnap.ref),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
}

async function createTeacherLessonRequestHistory({
  requestId,
  teacherName,
  studentName,
  date,
  time,
  subject,
  approvalStatus = 'pending',
  rejectionReason = '',
}) {
  await getDb()
    .collection('lessonRequests')
    .doc(requestId)
    .set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacherUID: `e2e-teacher-history-${requestId}`,
      teacherName,
      teacher: teacherName,
      studentID: `e2e-student-history-${requestId}`,
      studentId: `e2e-student-history-${requestId}`,
      studentName,
      student: studentName,
      date,
      time,
      subject,
      repeatWeekly: true,
      repeatWeeks: 4,
      approvalStatus,
      rejectionReason,
      createdAt: admin.firestore.Timestamp.now(),
    });
}

function futureYmd(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function makePlanningSlots(count) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    time: `1${index}:00`,
    subject: `slot ${index + 1}`,
  }));
}

test('fixed 1:1 planning: 8 lessons 주2는 4,4로 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: 8,
    weeklyFrequency: 2,
    normalizedSlots: makePlanningSlots(2),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([4, 4]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([true, true]);
});

test('fixed 1:1 planning: 5 lessons 주2는 3,2로 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: 5,
    weeklyFrequency: 2,
    normalizedSlots: makePlanningSlots(2),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([3, 2]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([true, true]);
});

test('fixed 1:1 planning: 10 lessons 주3은 4,4,2로 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: 10,
    weeklyFrequency: 3,
    normalizedSlots: makePlanningSlots(3),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([4, 4, 2]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([true, true, true]);
});

test('fixed 1:1 planning: paidLessons가 없으면 슬롯마다 비반복 1회 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: '',
    weeklyFrequency: 3,
    normalizedSlots: makePlanningSlots(3),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([1, 1, 1]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([false, false, false]);
});

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

test('teacher mutation guards are admin-only in source and rules', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const rulesSource = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

  const groupReservationGuard = sourceBlock(
    functionsSource,
    'function canManageGroupReservations',
    'function canManageGroupAttendance'
  );
  expect(groupReservationGuard).toContain('return role === "owner" || role === "admin";');
  expect(groupReservationGuard).not.toContain('teacher');

  const groupAttendanceGuard = sourceBlock(
    functionsSource,
    'function canManageGroupAttendance',
    'function groupLessonReservationDocId'
  );
  expect(groupAttendanceGuard).toContain('return role === "owner" || role === "admin";');
  expect(groupAttendanceGuard).not.toContain('canManageAttendance === true');

  const fixedPrivateCancel = sourceBlock(
    functionsSource,
    'exports.cancelFixedPrivateLessonOccurrence',
    'exports.adminClosePrivateLessonSlot'
  );
  expect(fixedPrivateCancel).toContain('actorRole === "teacher"');
  expect(fixedPrivateCancel).toContain('Fixed private lesson actions require admin permission.');

  for (const [functionName, nextFunctionName] of [
    ['exports.adminClosePrivateLessonSlot', 'exports.adminReopenPrivateLessonSlot'],
    ['exports.adminReopenPrivateLessonSlot', 'exports.adminCancelPrivateLessonReservation'],
    ['exports.adminCancelPrivateLessonReservation', 'exports.updateStudentPrivateCancelAllowance'],
    ['exports.updateTeacherStudentPackageCounts', 'exports.reversePrivateReservationOutcome'],
  ]) {
    expect(sourceBlock(functionsSource, functionName, nextFunctionName)).toContain('requireAcademyAdmin');
  }
  expect(sourceBlock(functionsSource, 'function canMarkPrivateReservationOutcome', 'function canManageGroupReservations')).toContain('requireAcademyAdmin');
  const privateOutcomeActorGuard = sourceBlock(
    functionsSource,
    'function buildPrivateLessonOutcomeActorFromMembership',
    'function buildPrivateLessonOutcomeUpdated'
  );
  expect(privateOutcomeActorGuard).toContain('membership.status !== "active"');
  expect(privateOutcomeActorGuard).toContain('!(role === "owner" || role === "admin")');
  expect(privateOutcomeActorGuard).toContain('"permission-denied"');

  const markPrivateOutcome = sourceBlock(
    functionsSource,
    'exports.markPrivateReservationOutcome',
    'exports.updateTeacherStudentPackageCounts'
  );
  const markGuardIndex = markPrivateOutcome.indexOf('await guardAcademyWrite({');
  const markMembershipIndex = markPrivateOutcome.indexOf(
    'const membershipSnap = await transaction.get('
  );
  const markActorIndex = markPrivateOutcome.indexOf(
    'buildPrivateLessonOutcomeActorFromMembership'
  );
  const markWriterIndex = markPrivateOutcome.indexOf(
    'applyPrivateReservationOutcomeWithDeductionInTransaction'
  );
  expect(markPrivateOutcome).toContain(
    'writeSurfaceId: "markPrivateReservationOutcome"'
  );
  expect(markGuardIndex).toBeGreaterThanOrEqual(0);
  expect(markMembershipIndex).toBeGreaterThan(markGuardIndex);
  expect(markActorIndex).toBeGreaterThan(markMembershipIndex);
  expect(markWriterIndex).toBeGreaterThan(markActorIndex);

  const reversePrivateOutcome = sourceBlock(
    functionsSource,
    'exports.reversePrivateReservationOutcome',
    'exports.bootstrapAdmin'
  );
  const reverseGuardIndex = reversePrivateOutcome.indexOf('await guardAcademyWrite({');
  const reverseWriterIndex = reversePrivateOutcome.indexOf(
    'reversePrivateReservationOutcomeInTransaction'
  );
  expect(reversePrivateOutcome).toContain(
    'writeSurfaceId: "reversePrivateReservationOutcome"'
  );
  expect(reverseGuardIndex).toBeGreaterThanOrEqual(0);
  expect(reverseWriterIndex).toBeGreaterThan(reverseGuardIndex);

  const studentPackagesRules = sourceBlock(
    rulesSource,
    'match /studentPackages/{packageId}',
    'match /creditTransactions/{txId}'
  );
  expect(studentPackagesRules).toContain('allow update: if sameAcademyOnUpdate() &&\n        isAcademyAdmin(resource.data.academyId);');
  expect(studentPackagesRules).not.toContain('canTeacherUpdateStudentPackageUsage');
  expect(studentPackagesRules).not.toContain('validTeacherStudentPackageCountUpdate');

  const privateSlotsRules = sourceBlock(
    rulesSource,
    'match /privateLessonSlots/{slotId}',
    'match /privateLessonAvailabilityTemplates/{templateId}'
  );
  expect(privateSlotsRules).toContain('isAcademyAdmin(request.resource.data.academyId)');
  expect(privateSlotsRules).toContain('isAcademyAdmin(resource.data.academyId)');
  expect(privateSlotsRules).not.toContain('privateSlotBelongsToTeacher(request.resource.data)');

  const groupClassesRules = sourceBlock(
    rulesSource,
    'match /groupClasses/{groupClassId}',
    'match /groupStudents/{groupStudentId}'
  );
  expect(groupClassesRules).toContain('allow create: if sameAcademyOnCreate() &&\n        isAcademyAdmin(request.resource.data.academyId);');
  expect(groupClassesRules).toContain('allow update: if sameAcademyOnUpdate() &&\n        isAcademyAdmin(resource.data.academyId);');
  expect(groupClassesRules).not.toContain('validTeacherGroupClassShape');
});

test('production helper callables are locked down in source', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const studentsSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/StudentsSection.jsx'),
    'utf8'
  );
  const teacherManagementSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/TeacherManagementSection.jsx'),
    'utf8'
  );
  const permissionTestSource = fs.readFileSync(
    path.join(process.cwd(), 'tests/teacher-permission.spec.js'),
    'utf8'
  );

  const runtimeProjectGuards = sourceBlock(
    functionsSource,
    'const PRODUCTION_PROJECT_ID',
    'function getHostedAppUrl'
  );
  expect(runtimeProjectGuards).toContain('"daegu-miami-production"');
  expect(runtimeProjectGuards).toContain('"miami-e2e"');
  expect(runtimeProjectGuards).toContain('function requireE2eTestProject');
  expect(runtimeProjectGuards).toContain('ALLOW_PRODUCTION_BOOTSTRAP_ADMIN');

  const autoDeductHelper = sourceBlock(
    functionsSource,
    'exports.runAutoDeductPendingLessonsForTest',
    'exports.markPrivateReservationOutcome'
  );
  expect(autoDeductHelper).toContain('requireE2eTestProject();');

  const bootstrapAdminHelper = sourceBlock(
    functionsSource,
    'exports.bootstrapAdmin',
    'exports.setUserRole'
  );
  expect(bootstrapAdminHelper).toContain('requireProductionBootstrapAdminAllowed(callerEmail);');
  expect(bootstrapAdminHelper).toContain('callerEmail !== OWNER_EMAIL');

  const setUserRoleHelper = sourceBlock(
    functionsSource,
    'exports.setUserRole',
    'exports.linkStudentAccount'
  );
  expect(setUserRoleHelper).toContain('requireAcademyOwner(db, academyId, callerUid);');
  expect(setUserRoleHelper).toContain('requireProductionSetUserRoleAllowed(request.auth);');
  expect(setUserRoleHelper).toContain('["admin", "teacher", "student"].includes(role)');
  expect(setUserRoleHelper).toContain('role === "owner"');
  expect(setUserRoleHelper).toContain('targetMembershipRole === "owner"');
  expect(setUserRoleHelper).toContain('targetClaimsRole === "owner"');
  expect(setUserRoleHelper).not.toContain('callerRole !== "admin"');

  for (const invitationSource of [studentsSectionSource, teacherManagementSectionSource]) {
    expect(invitationSource).toContain(
      "return String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim().replace(/\\/+$/, '')"
    );
    expect(invitationSource).not.toContain('VITE_FIREBASE_PROJECT_ID');
    expect(invitationSource).not.toContain('INVITATION_APP_URL_BY_PROJECT_ID');
    expect(invitationSource).not.toContain('daegu-miami-production');
    expect(invitationSource).not.toContain('https://daegumiami.com');
    expect(invitationSource).not.toContain('https://miami-e2e.web.app');
    expect(invitationSource).not.toContain('window.location.origin');
  }

  expect(studentsSectionSource).toContain("if (!STUDENT_INVITATION_APP_URL) return ''");
  expect(studentsSectionSource).toContain(
    '`예약 페이지: ${STUDENT_INVITATION_APP_URL}`'
  );
  expect(studentsSectionSource).toContain(
    'if (!studentAccountInvitationMessage) return'
  );
  expect(studentsSectionSource).toContain(
    'disabled={!studentAccountInvitationMessage || studentAccountLinkBusy}'
  );

  expect(teacherManagementSectionSource).toContain(
    "if (!TEACHER_INVITATION_APP_URL) return ''"
  );
  expect(teacherManagementSectionSource).toContain(
    '`로그인 페이지: ${TEACHER_INVITATION_APP_URL}`'
  );
  expect(teacherManagementSectionSource).toContain('if (!invitationMessage) return');
  expect(teacherManagementSectionSource).toContain(
    'disabled={!invitationMessage || inviteBusy}'
  );

  const credentialResolverSource = sourceBlock(
    permissionTestSource,
    'function resolveAdminServiceAccount()',
    'function getAdminApp()'
  );
  const base64SourceIndex = credentialResolverSource.indexOf(
    'process.env.MIAMI_E2E_SERVICE_ACCOUNT_KEY_B64'
  );
  const repositoryFallbackIndex = credentialResolverSource.indexOf(
    'fs.existsSync(SERVICE_ACCOUNT_PATH)'
  );
  expect(base64SourceIndex).toBeGreaterThanOrEqual(0);
  expect(repositoryFallbackIndex).toBeGreaterThan(base64SourceIndex);
  expect(permissionTestSource).toContain("Buffer.from(encodedCredential, 'base64')");
  expect(permissionTestSource).toContain(
    "serviceAccount.project_id !== EXPECTED_ADMIN_CREDENTIAL_PROJECT_ID"
  );
  expect(permissionTestSource).toContain("['client_email', 'private_key']");
  expect(credentialResolverSource).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
  expect(credentialResolverSource).not.toContain('applicationDefault(');
  expect(credentialResolverSource).not.toContain('console.');
});

async function loginAsDashboardUser(page, email, password) {
  await page.goto(`${BASE_URL}login/`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const emailInput = page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first();
    const passwordInput = page
      .getByLabel(/Password|비밀번호/i)
      .or(page.locator('input[type="password"]'))
      .first();
    const invalidCredentials = page.getByText('Invalid email or password.');
    const inactiveAccount = page.getByText('비활성 계정입니다');
    const welcomeMessage = page.getByTestId('dashboard-welcome-subtitle');
    const calendarButton = page.getByRole('button', { name: '캘린더', exact: true });

    const hasLoginForm = await emailInput.isVisible({ timeout: LOGIN_ATTEMPT_TIMEOUT_MS }).catch(() => false);
    if (!hasLoginForm) {
      if (attempt < 3) {
        await page.goto(`${BASE_URL}login/`);
        continue;
      }
      break;
    }
    await emailInput.fill(email);
    await passwordInput.fill(password);
    await page.getByRole('button', { name: /Sign In|로그인/i }).click();

    const outcome = await expect
      .poll(
        async () => {
          if (await invalidCredentials.isVisible().catch(() => false)) return 'invalid';
          if (await inactiveAccount.isVisible().catch(() => false)) return 'inactive';
          const welcomeText = ((await welcomeMessage.textContent().catch(() => '')) || '').trim();
          const hasWelcome = /님,?\s환영합니다/.test(welcomeText);
          const hasCalendarNav = await calendarButton.isVisible().catch(() => false);
          return /\/dashboard/.test(page.url()) && hasWelcome && hasCalendarNav
            ? 'dashboard'
            : 'waiting';
        },
        { timeout: LOGIN_ATTEMPT_TIMEOUT_MS }
      )
      .toBe('dashboard')
      .then(() => 'dashboard')
      .catch(() => 'retry');

    if (outcome === 'dashboard') return;
    if (attempt < 3) await page.goto(`${BASE_URL}login/`);
  }

  const bodyText = (await page.locator('body').textContent().catch(() => '')) || '';
  const welcomeText = ((await page.getByTestId('dashboard-welcome-subtitle').textContent().catch(() => '')) || '').trim();
  throw new Error(
    [
      'Dashboard login failed.',
      `URL: ${page.url()}`,
      `Welcome: ${welcomeText || '(empty)'}`,
      `Body: ${bodyText}`,
    ].join('\n')
  );
}

async function loginAsTeacher(page) {
  await loginAsDashboardUser(page, TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD);
}

async function loginAsAdmin(page) {
  await loginAsDashboardUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

async function openDashboardSectionByName(page, sectionName) {
  await page.getByRole('button', { name: sectionName, exact: true }).click();
  await expect(page.getByRole('heading', { name: sectionName, level: 1 })).toBeVisible();
}

async function getTeacherNameFromWelcome(page) {
  const welcomeText = (await page.getByTestId('dashboard-welcome-subtitle').textContent()) || '';
  const match = welcomeText.match(/(.*)\s님,?\s환영합니다/);
  return match?.[1]?.trim() || '';
}

async function getTeacherMembershipRef() {
  const userRecord = await getAdminApp().auth().getUserByEmail(TEST_TEACHER_EMAIL);
  return getDb().collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${userRecord.uid}`);
}

let restoreCanonicalTeacherScopeFixture = null;
let teacherMembershipPermissionBaselineCaptured = false;
let teacherMembershipPermissionBaseline = null;

async function ensureCanonicalTeacherOwnedGroupClassFixture() {
  if (restoreCanonicalTeacherScopeFixture) {
    throw new Error('Canonical teacher scope fixture cleanup is still pending.');
  }

  const adminApp = getAdminApp();
  const db = adminApp.firestore();
  const teacherUser = await adminApp.auth().getUserByEmail(TEST_TEACHER_EMAIL);
  const userRef = db.collection('users').doc(teacherUser.uid);
  const membershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`);
  const groupClassRef = db
    .collection('groupClasses')
    .doc(CANONICAL_TEACHER_GROUP_CLASS_FIXTURE_ID);

  const [userSnap, membershipSnap, groupClassSnap] = await Promise.all([
    userRef.get(),
    membershipRef.get(),
    groupClassRef.get(),
  ]);
  const originalUserData = userSnap.exists ? userSnap.data() || {} : null;
  const originalMembershipData = membershipSnap.exists ? membershipSnap.data() || {} : null;
  const originalGroupClassData = groupClassSnap.exists ? groupClassSnap.data() || {} : null;
  const teacherName = String(
    originalMembershipData?.teacherName ||
      originalUserData?.teacherName ||
      teacherUser.displayName ||
      'teacher'
  ).trim();

  restoreCanonicalTeacherScopeFixture = async () => {
    const restoreErrors = [];
    for (const [ref, originalData] of [
      [groupClassRef, originalGroupClassData],
      [membershipRef, originalMembershipData],
      [userRef, originalUserData],
    ]) {
      try {
        if (originalData) {
          await ref.set(originalData);
        } else {
          await ref.delete();
        }
      } catch (error) {
        restoreErrors.push(error);
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(restoreErrors, 'Canonical teacher scope fixture cleanup failed.');
    }
  };

  await userRef.set({
    ...(originalUserData || {}),
    uid: teacherUser.uid,
    email: teacherUser.email || TEST_TEACHER_EMAIL,
    role: 'teacher',
    teacherName,
    isActive: true,
    lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
  });

  await membershipRef.set({
    ...(originalMembershipData || {}),
    uid: teacherUser.uid,
    email: teacherUser.email || TEST_TEACHER_EMAIL,
    academyId: DEFAULT_E2E_ACADEMY_ID,
    role: 'teacher',
    teacherName,
    status: 'active',
  });

  await groupClassRef.set({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacherUid: teacherUser.uid,
    teacherName,
    name: 'E2E 교사 권한 단체반',
    status: 'active',
    deleted: false,
    groupClassDeleted: false,
    maxStudents: 1,
    time: '10:00',
    subject: 'E2E Teacher Permission',
    weekdays: ['월'],
  });

  const [groupClassAfterWrite, exactTeacherGroupClasses] = await Promise.all([
    groupClassRef.get(),
    db
      .collection('groupClasses')
      .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
      .where('teacherUid', '==', teacherUser.uid)
      .get(),
  ]);
  expect(
    groupClassAfterWrite.exists,
    'Canonical teacher groupClass fixture must exist before browser navigation.'
  ).toBe(true);
  expect(
    exactTeacherGroupClasses.docs.some(
      (docSnap) => docSnap.id === CANONICAL_TEACHER_GROUP_CLASS_FIXTURE_ID
    ),
    'Exact teacher groupClasses query must contain the canonical fixture before browser navigation.'
  ).toBe(true);

  const canonicalGroupClass = groupClassAfterWrite.data() || {};
  expect(canonicalGroupClass).toMatchObject({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacherUid: teacherUser.uid,
    status: 'active',
    deleted: false,
    groupClassDeleted: false,
  });
  expect(
    String(canonicalGroupClass.name || '').trim(),
    'Canonical teacher groupClass fixture must have a renderable name.'
  ).not.toBe('');
}

test.afterEach(async () => {
  const cleanupErrors = [];

  if (restoreCanonicalTeacherScopeFixture) {
    const restoreFixture = restoreCanonicalTeacherScopeFixture;
    restoreCanonicalTeacherScopeFixture = null;
    try {
      await restoreFixture();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (teacherMembershipPermissionBaselineCaptured) {
    const baseline = teacherMembershipPermissionBaseline;
    teacherMembershipPermissionBaselineCaptured = false;
    teacherMembershipPermissionBaseline = null;
    try {
      if (baseline.exists) {
        await baseline.ref.set(baseline.data);
      } else {
        await baseline.ref.delete();
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Teacher permission fixture cleanup failed.');
  }
});

async function setTeacherCountEditPermission(enabled) {
  const membershipRef = await getTeacherMembershipRef();
  if (!teacherMembershipPermissionBaselineCaptured) {
    const membershipSnapshot = await membershipRef.get();
    teacherMembershipPermissionBaseline = {
      ref: membershipRef,
      exists: membershipSnapshot.exists,
      data: membershipSnapshot.exists ? membershipSnapshot.data() || {} : null,
    };
    teacherMembershipPermissionBaselineCaptured = true;
  }
  await membershipRef.set(
    {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      email: TEST_TEACHER_EMAIL,
      role: 'teacher',
      teacherName: 'teacher',
      status: 'active',
      permissions: {
        canEditStudentPackageCounts: enabled === true,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function ensureTeacherPackageCountFixture() {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  await db.collection('teachers').doc('e2e-count-edit-teacher').set(
    {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: 'Teacher E2E',
      teacherName: 'teacher',
      teacherKey: 'teacher',
      status: 'active',
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  await db.collection('privateStudents').doc('e2e-count-edit-student').set(
    {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: 'E2E 횟수수정 학생',
      studentName: 'E2E 횟수수정 학생',
      phone: '010-0000-5100',
      teacher: 'teacher',
      teacherName: 'teacher',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection('studentPackages').doc('e2e-count-edit-own-package').set(
    {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: 'e2e-count-edit-student',
      studentName: 'E2E 횟수수정 학생',
      title: 'E2E teacher package count edit',
      packageType: 'private',
      teacher: 'teacher',
      teacherName: 'teacher',
      totalCount: 4,
      usedCount: 1,
      remainingCount: 3,
      status: 'active',
      amountPaid: 12345,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      memo: 'teacher-hidden billing memo',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection('studentPackages').doc('e2e-count-edit-other-package').set(
    {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: 'e2e-count-edit-student',
      studentName: 'E2E 횟수수정 학생',
      title: 'E2E other teacher package count edit',
      packageType: 'private',
      teacher: 'other-teacher',
      teacherName: 'other-teacher',
      totalCount: 8,
      usedCount: 2,
      remainingCount: 6,
      status: 'active',
      amountPaid: 67890,
      paymentStatus: 'unpaid',
      memo: 'other teacher-hidden billing memo',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
}

async function openTeacherCountEditStudentPackage(page) {
  await openDashboardSectionByName(page, '학생 관리');
  const searchInput = page.getByTestId('student-search-input');
  await searchInput.fill('E2E 횟수수정 학생');

  const studentRow = page
    .locator('[data-testid="student-row"][data-student-name="E2E 횟수수정 학생"]')
    .first();
  await expect(studentRow).toBeVisible({ timeout: 15000 });
  await studentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();

  const studentDetail = page
    .locator('[data-testid="student-detail-panel"][data-student-name="E2E 횟수수정 학생"]')
    .first();
  await expect(studentDetail).toBeVisible({ timeout: 15000 });

  const packageCard = studentDetail
    .getByTestId('student-package-card')
    .filter({ hasText: 'E2E teacher package count edit' })
    .first();
  await expect(packageCard).toBeVisible({ timeout: 15000 });
  return { studentDetail, packageCard };
}

test('teacher 계정은 캘린더, 1:1 수업 일정, 담당 단체반만 볼 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  if (hasServiceAccount()) {
    await setTeacherCountEditPermission(false);
  }
  await ensureCanonicalTeacherOwnedGroupClassFixture();

  await loginAsTeacher(page);

  await expect(page.getByRole('button', { name: '캘린더', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1:1 수업 일정', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '담당 단체반', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '캘린더', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '내 1:1 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '1:1 예약 시간 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '1:1 수업 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수업 요청 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '학생 추가', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수정', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '로그인 초대', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수강권 추가', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '1:1 수업 일정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1:1 수업 일정', level: 1 })).toBeVisible();
  await expect(page.getByTestId('private-teacher-weekly-board-section')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('고정 1:1 요청')).toHaveCount(0);
  await expect(page.getByText('내 1:1 요청 내역')).toHaveCount(0);
  await expect(page.getByText('유동 1:1 예약 시간')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '고정 1:1 요청하기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수업불가로 닫기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수업불가 해제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예약 취소 후 공개', exact: true })).toHaveCount(0);

  const teacherName = await getTeacherNameFromWelcome(page);
  await page.getByRole('button', { name: '담당 단체반', exact: true }).click();
  await expect(page.getByRole('heading', { name: '담당 단체반', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '담당 단체반', level: 2 })).toBeVisible();
  await expect(page.getByText('결제 횟수')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '정규반 만들기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '학생 등록', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예약 추가', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예약 취소', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '출결/차감', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이후 일정 삭제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);

  const groupRows = page.getByTestId('group-row');
  await expect.poll(async () => groupRows.count(), { timeout: 15000 }).toBeGreaterThan(0);
  const rowCount = await groupRows.count();
  for (let i = 0; i < rowCount; i += 1) {
    await expect(groupRows.nth(i).locator(':scope > span').nth(1)).toContainText(teacherName);
  }
});

test('admin can toggle teacher student package count edit permission', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore 권한 검증을 실행합니다.');

  await ensureTeacherPackageCountFixture();
  await setTeacherCountEditPermission(false);

  await loginAsAdmin(page);
  await openDashboardSectionByName(page, '선생님 관리');

  await expect
    .poll(async () => page.getByTestId('teacher-management-row').count(), { timeout: 30000 })
    .toBeGreaterThan(0);
  const teacherRow = page.locator('[data-testid="teacher-management-row"][data-teacher-key="teacher"]').first();
  await expect(teacherRow).toBeVisible({ timeout: 15000 });
  await expect(teacherRow.getByTestId('teacher-count-edit-permission-status')).toContainText(
    '횟수 수정 차단',
    { timeout: 15000 }
  );

  await teacherRow.getByTestId('teacher-count-edit-permission-toggle').click();
  await expect
    .poll(async () => {
      const snap = await (await getTeacherMembershipRef()).get();
      return snap.data()?.permissions?.canEditStudentPackageCounts;
    }, { timeout: 15000 })
    .toBe(true);
  await expect(teacherRow.getByTestId('teacher-count-edit-permission-status')).toContainText(
    '횟수 수정 허용',
    { timeout: 15000 }
  );

  await teacherRow.getByTestId('teacher-count-edit-permission-toggle').click();
  await expect
    .poll(async () => {
      const snap = await (await getTeacherMembershipRef()).get();
      return snap.data()?.permissions?.canEditStudentPackageCounts;
    }, { timeout: 15000 })
    .toBe(false);
  await expect(teacherRow.getByTestId('teacher-count-edit-permission-status')).toContainText(
    '횟수 수정 차단',
    { timeout: 15000 }
  );
});

test('teacher without count edit permission cannot open student package count editing', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore 권한 검증을 실행합니다.');

  await ensureTeacherPackageCountFixture();
  await setTeacherCountEditPermission(false);

  await loginAsTeacher(page);
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
});

test('teacher with count edit permission still cannot edit package counts directly', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore 권한 검증을 실행합니다.');

  await ensureTeacherPackageCountFixture();
  await setTeacherCountEditPermission(true);

  try {
    await loginAsTeacher(page);
    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '수강권 추가', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '수강권 회수', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '차감취소', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '차감복구', exact: true })).toHaveCount(0);
  } finally {
    await setTeacherCountEditPermission(false);
  }
});

test('teacher 1:1 화면은 주간 시간표만 읽기 전용으로 보여준다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsTeacher(page);

  await page.getByRole('button', { name: '1:1 수업 일정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1:1 수업 일정', level: 1 })).toBeVisible();
  await expect(page.getByTestId('private-teacher-weekly-board-section')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('본인에게 연결된 주간 1:1 시간표와 예약 상태를 읽기 전용으로 확인합니다.')).toBeVisible();
  await expect(page.getByText('이 화면은 읽기 전용입니다. 수업불가 닫기/해제와 예약 조작은 관리자만 할 수 있습니다.')).toBeVisible();

  await expect(page.getByRole('button', { name: '내 1:1 관리', exact: true })).toHaveCount(0);
  await expect(page.getByText('고정 1:1 요청')).toHaveCount(0);
  await expect(page.getByText('내 1:1 요청 내역')).toHaveCount(0);
  await expect(page.getByText('유동 1:1 예약 시간')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '고정 1:1 요청하기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수업불가로 닫기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수업불가 해제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예약 취소 후 공개', exact: true })).toHaveCount(0);
});

test('admin 계정은 전체 단체반 관리를 볼 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page);

  await expect(page.getByRole('button', { name: '캘린더', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1:1 예약 시간 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '수업 요청 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '선생님 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '오늘의 영상 관리', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '단체반 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '단체반 관리', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '단체반 관리', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: '정규반 만들기', exact: true })).toBeVisible();
});

test('teacher는 담당 단체반에서 본인 반을 읽기 전용으로만 볼 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await ensureCanonicalTeacherOwnedGroupClassFixture();
  await loginAsTeacher(page);

  const teacherName = await getTeacherNameFromWelcome(page);
  await page.getByRole('button', { name: '담당 단체반', exact: true }).click();
  await expect(page.getByRole('heading', { name: '담당 단체반', level: 1 })).toBeVisible();
  const todaySchedulePanel = page.getByTestId('today-schedule-panel');
  await expect(
    todaySchedulePanel.getByRole('heading', { name: '오늘의 단체반 일정', exact: true })
  ).toBeVisible();
  await expect(todaySchedulePanel.getByTestId('today-schedule-summary')).toHaveCount(0);
  await expect(todaySchedulePanel.getByText('오늘 1:1', { exact: true })).toHaveCount(0);
  await expect(todaySchedulePanel.getByText('이번 달 1:1 누적', { exact: true })).toHaveCount(0);

  await expect(page.getByRole('button', { name: '정규반 만들기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '학생 등록', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수정', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '제거', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예약 추가', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '예약 취소', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '출결/차감', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '차감취소', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '차감복구', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이후 일정 삭제', exact: true })).toHaveCount(0);

  const groupRows = page.getByTestId('group-row');
  await expect.poll(async () => groupRows.count(), { timeout: 15000 }).toBeGreaterThan(0);
  const rowCount = await groupRows.count();
  for (let i = 0; i < rowCount; i += 1) {
    await expect(groupRows.nth(i).locator(':scope > span').nth(1)).toContainText(teacherName);
  }

  await groupRows.first().click();
  const groupStudentsSection = page.getByTestId('group-students-section');
  await expect(groupStudentsSection).toBeVisible();
  await expect(groupStudentsSection).toContainText('학생 등록과 수강권 관리는 관리자에게 요청해 주세요.');
  await expect(groupStudentsSection.getByRole('button', { name: '학생 등록', exact: true })).toHaveCount(0);
  await expect(groupStudentsSection.getByRole('button', { name: '관리', exact: true })).toHaveCount(0);
  await expect(groupStudentsSection.getByRole('button', { name: '제거', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
});
