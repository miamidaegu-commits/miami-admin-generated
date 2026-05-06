import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore';
import {
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

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const BACKFILL_SCRIPT = path.join(process.cwd(), 'scripts/backfill-academy-id.mjs');
const PERMISSION_KEYS = [
  'canAddStudent',
  'canEditStudent',
  'canDeleteStudent',
  'canManageAttendance',
  'canEditLesson',
  'canDeleteLesson',
  'canCreateLessonDirectly',
  'requiresLessonApproval',
];

let initialized = false;

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function getFirebaseClientConfig() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
}

function initializeAdmin() {
  if (initialized) return;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  initialized = true;
}

async function getUserByEmail(email) {
  initializeAdmin();
  return admin.auth().getUserByEmail(email);
}

async function readDoc(ref) {
  const snap = await ref.get();
  return snap.exists ? snap.data() || {} : null;
}

async function restoreDoc(ref, data) {
  if (data) {
    await ref.set(data);
  } else {
    await ref.delete().catch(() => {});
  }
}

async function runAcademyBackfill() {
  await execFileAsync(
    process.execPath,
    [
      BACKFILL_SCRIPT,
      '--write',
      `--academy-id=${DEFAULT_E2E_ACADEMY_ID}`,
      `--academy-name=${DEFAULT_E2E_ACADEMY_NAME}`,
    ],
    {
      cwd: process.cwd(),
      timeout: 120000,
      env: {
        ...process.env,
        E2E_FIREBASE_PROJECT_ID:
          process.env.E2E_FIREBASE_PROJECT_ID ||
          process.env.VITE_FIREBASE_PROJECT_ID ||
          'miami-e2e',
      },
    }
  );
}

async function readGroupClassIdsAsTeacher({ teacherEmail, teacherPassword, academyId, teacherName }) {
  const app = initializeApp(getFirebaseClientConfig(), `rollout-teacher-read-${Date.now()}`);
  const auth = getAuth(app);

  try {
    await signInWithEmailAndPassword(auth, teacherEmail, teacherPassword);
    const db = getFirestore(app);
    const snap = await getDocs(
      query(
        collection(db, 'groupClasses'),
        where('academyId', '==', academyId),
        where('teacher', '==', teacherName)
      )
    );
    return snap.docs.map((docSnap) => docSnap.id);
  } finally {
    await signOut(auth).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

test.describe.configure({ mode: 'serial' });

test('stale academy_default selection is healed to the first real active academy membership', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 admin membership 검증을 실행합니다.');

  initializeAdmin();
  const db = admin.firestore();
  const adminUser = await getUserByEmail(ADMIN_EMAIL);
  const adminRef = db.collection('users').doc(adminUser.uid);
  const membershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${adminUser.uid}`);
  const academyRef = db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID);

  const originalAdmin = await readDoc(adminRef);
  const originalMembership = await readDoc(membershipRef);

  try {
    await academyRef.set(
      {
        id: DEFAULT_E2E_ACADEMY_ID,
        name: DEFAULT_E2E_ACADEMY_NAME,
        slug: DEFAULT_E2E_ACADEMY_ID,
        status: 'active',
        timezone: 'Asia/Seoul',
      },
      { merge: true }
    );
    await adminRef.set(
      {
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        lastSelectedAcademyId: 'academy_default',
      },
      { merge: true }
    );
    await membershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: adminUser.uid,
        role: 'owner',
        status: 'active',
        teacherName: '',
        permissions: Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true])),
      },
      { merge: true }
    );

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    await expect
      .poll(async () => {
        const snap = await adminRef.get();
        return snap.data()?.lastSelectedAcademyId || '';
      }, { timeout: 10000 })
      .toBe(DEFAULT_E2E_ACADEMY_ID);
  } finally {
    await restoreDoc(adminRef, originalAdmin);
    await restoreDoc(membershipRef, originalMembership);
  }
});

test('teacher membership missing permissions is repaired by backfill before runtime access', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 admin backfill 검증을 실행합니다.');
  test.setTimeout(180000);

  initializeAdmin();
  const db = admin.firestore();
  const teacherUser = await getUserByEmail(TEST_TEACHER_EMAIL);
  const teacherRef = db.collection('users').doc(teacherUser.uid);
  const membershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`);
  const unique = `e2e-backfill-perms-${Date.now()}-${testInfo.workerIndex}`;
  const groupRef = db.collection('groupClasses').doc(unique);
  const lessonRef = db.collection('groupLessons').doc(`${unique}-lesson`);

  const originalTeacher = await readDoc(teacherRef);
  const originalMembership = await readDoc(membershipRef);

  try {
    await db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID).set(
      {
        id: DEFAULT_E2E_ACADEMY_ID,
        name: DEFAULT_E2E_ACADEMY_NAME,
        slug: DEFAULT_E2E_ACADEMY_ID,
        status: 'active',
        timezone: 'Asia/Seoul',
      },
      { merge: true }
    );

    await teacherRef.set(
      {
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        displayName: 'Teacher E2E',
        role: 'teacher',
        isActive: true,
        teacherName: 'teacher',
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        canManageAttendance: true,
        canAddStudent: false,
        canEditStudent: false,
        canDeleteStudent: false,
        canEditLesson: false,
        canDeleteLesson: false,
        canCreateLessonDirectly: false,
        requiresLessonApproval: false,
      },
      { merge: true }
    );

    await membershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: teacherUser.uid,
        role: 'teacher',
        status: 'active',
        teacherName: 'teacher',
        permissions: admin.firestore.FieldValue.delete(),
      },
      { merge: true }
    );

    await groupRef.set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: unique,
      teacher: ' Teacher ',
      maxStudents: 8,
      time: '18:00',
      subject: 'rollout',
      weekdays: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await lessonRef.set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: groupRef.id,
      groupClassName: unique,
      teacher: 'TEACHER',
      date: '2099-01-01',
      time: '18:00',
      subject: 'rollout',
      countedStudentIDs: [],
      attendanceAppliedAt: null,
      bookingMode: 'fixed',
      capacity: 8,
      bookedCount: 0,
      isBookable: false,
      generationKind: 'manual',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await runAcademyBackfill();

    const repairedMembership = await readDoc(membershipRef);
    for (const key of PERMISSION_KEYS) {
      expect(repairedMembership.permissions).toHaveProperty(key);
    }
    expect(repairedMembership.permissions.canManageAttendance).toBe(true);
    expect(repairedMembership.teacherName).toBe('teacher');

    const repairedGroup = await readDoc(groupRef);
    const repairedLesson = await readDoc(lessonRef);
    expect(repairedGroup.teacher).toBe('teacher');
    expect(repairedLesson.teacher).toBe('teacher');

    const readableGroupIds = await readGroupClassIdsAsTeacher({
      teacherEmail: TEST_TEACHER_EMAIL,
      teacherPassword: TEST_TEACHER_PASSWORD,
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacherName: 'teacher',
    });
    expect(readableGroupIds).toContain(groupRef.id);
  } finally {
    await lessonRef.delete().catch(() => {});
    await groupRef.delete().catch(() => {});
    await restoreDoc(teacherRef, originalTeacher);
    await restoreDoc(membershipRef, originalMembership);
  }
});

test('user with no active academy membership sees empty operational data', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 membership 제거 검증을 실행합니다.');

  initializeAdmin();
  const db = admin.firestore();
  const adminUser = await getUserByEmail(ADMIN_EMAIL);
  const membershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${adminUser.uid}`);
  const originalMembership = await readDoc(membershipRef);

  try {
    await membershipRef.delete();

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');
    await expect(page.getByText('등록된 반이 없습니다. 위에서 반을 만들 수 있습니다.')).toBeVisible();
    await expect(page.getByTestId('group-row')).toHaveCount(0);
  } finally {
    await restoreDoc(membershipRef, originalMembership);
  }
});
