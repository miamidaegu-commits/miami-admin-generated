import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_STUDENT_EMAIL,
  TEST_STUDENT_PASSWORD,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const DEFAULT_E2E_ACADEMY_TIMEZONE = 'Asia/Seoul';
const PERMISSION_KEYS = [
  'canManageAttendance',
  'canAddStudent',
  'canEditStudent',
  'canDeleteStudent',
  'canEditLesson',
  'canDeleteLesson',
  'canCreateLessonDirectly',
  'requiresLessonApproval',
];

const USER_SPECS = [
  {
    key: 'admin',
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    displayName: 'Admin E2E',
    claims: { role: 'admin' },
    role: 'admin',
    teacherName: '',
    permissions: {
      canManageAttendance: true,
      canAddStudent: true,
      canEditStudent: true,
      canDeleteStudent: true,
      canEditLesson: true,
      canDeleteLesson: true,
      canCreateLessonDirectly: true,
      requiresLessonApproval: false,
    },
  },
  {
    key: 'teacher',
    email: TEST_TEACHER_EMAIL,
    password: TEST_TEACHER_PASSWORD,
    displayName: 'Teacher E2E',
    claims: { role: 'teacher' },
    role: 'teacher',
    teacherName: 'teacher',
    permissions: {
      canManageAttendance: false,
      canAddStudent: false,
      canEditStudent: false,
      canDeleteStudent: false,
      canEditLesson: false,
      canDeleteLesson: false,
      canCreateLessonDirectly: false,
      requiresLessonApproval: false,
    },
  },
  {
    key: 'student',
    email: TEST_STUDENT_EMAIL,
    password: TEST_STUDENT_PASSWORD,
    displayName: 'Student E2E',
    claims: { role: 'student' },
    role: 'student',
    teacherName: '',
    permissions: {},
  },
];

export function hasE2EServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

export function initializeDefaultAdminApp() {
  const existing = admin.apps.find((app) => app?.name === '[DEFAULT]');
  if (existing) return existing;

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export async function ensureE2EUserFixtures() {
  initializeDefaultAdminApp();
  const auth = admin.auth();
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const seededUsers = [];

  for (const spec of USER_SPECS) {
    const userRecord = await createOrUpdateAuthUser(auth, spec);
    await auth.setCustomUserClaims(userRecord.uid, spec.claims);
    seededUsers.push({ spec, userRecord });

    await db.collection('users').doc(userRecord.uid).set(
      {
        uid: userRecord.uid,
        email: spec.email,
        displayName: spec.displayName,
        accountScope: 'global',
        role: spec.role,
        isActive: true,
        teacherName: spec.teacherName,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  const adminSeed = seededUsers.find(({ spec }) => spec.key === 'admin');
  await db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID).set(
    {
      id: DEFAULT_E2E_ACADEMY_ID,
      name: DEFAULT_E2E_ACADEMY_NAME,
      slug: DEFAULT_E2E_ACADEMY_ID,
      ownerUid: adminSeed?.userRecord.uid || '',
      status: 'active',
      plan: 'starter',
      timezone: DEFAULT_E2E_ACADEMY_TIMEZONE,
      locale: 'ko-KR',
      source: 'e2e-user-fixture',
      updatedAt: now,
    },
    { merge: true }
  );

  for (const { spec, userRecord } of seededUsers) {
    const role = spec.key === 'admin' ? 'owner' : spec.role;
    const studentId = role === 'student' ? `student_${userRecord.uid}` : '';
    await db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${userRecord.uid}`).set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: userRecord.uid,
        email: spec.email,
        displayName: spec.displayName,
        role,
        teacherName: spec.teacherName,
        studentId,
        status: 'active',
        permissions: buildMembershipPermissions(spec.permissions),
        source: 'e2e-user-fixture',
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

async function createOrUpdateAuthUser(auth, spec) {
  try {
    const existingUser = await auth.getUserByEmail(spec.email);
    return auth.updateUser(existingUser.uid, {
      email: spec.email,
      password: spec.password,
      displayName: spec.displayName,
      disabled: false,
    });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }

  return auth.createUser({
    email: spec.email,
    password: spec.password,
    displayName: spec.displayName,
    disabled: false,
  });
}

function buildMembershipPermissions(permissions = {}) {
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, permissions[key] === true]));
}
