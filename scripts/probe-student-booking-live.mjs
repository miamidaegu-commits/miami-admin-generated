import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { initializeApp as initializeClientApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'firebase/firestore';

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

function reservationId({ lessonId, studentId }) {
  return `${ACADEMY_ID}__${lessonId}__${studentId}`;
}

async function seedBase({ suffix, uid, studentId, groupClassId, lessonId, bookedCount = 0 }) {
  const now = admin.firestore.Timestamp.now();

  await adminDb.collection('academyMemberships').doc(`${ACADEMY_ID}_${uid}`).set({
    academyId: ACADEMY_ID,
    uid,
    email: 'student@example.com',
    displayName: 'Student Probe',
    role: 'student',
    studentId,
    teacherName: '',
    status: 'active',
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
    updatedAt: now,
  }, { merge: true });

  await adminDb.collection('studentGroupAccessSummary').doc(`${ACADEMY_ID}__${studentId}`).set({
    academyId: ACADEMY_ID,
    studentId,
    groupClassIds: [groupClassId],
    createdAt: now,
    updatedAt: now,
  });

  await adminDb.collection('studentGroupAccess').doc(`${ACADEMY_ID}__${groupClassId}__${studentId}`).set({
    academyId: ACADEMY_ID,
    groupClassId,
    groupStudentId: `gs-${suffix}`,
    studentId,
    packageId: `pkg-${suffix}`,
    status: 'active',
    studentStatus: 'active',
    createdAt: now,
    updatedAt: now,
  });

  await adminDb.collection('groupLessons').doc(lessonId).set({
    academyId: ACADEMY_ID,
    groupClassId,
    teacher: 'teacher',
    date: '2026-05-10',
    time: '10:00',
    subject: `Live Probe ${suffix}`,
    capacity: 3,
    bookedCount,
    isBookable: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function readState(lessonId, reservationDocId) {
  const [lessonSnap, reservationSnap] = await Promise.all([
    adminDb.collection('groupLessons').doc(lessonId).get(),
    adminDb.collection('groupLessonReservations').doc(reservationDocId).get(),
  ]);

  return {
    bookedCount: lessonSnap.exists ? lessonSnap.data()?.bookedCount ?? null : null,
    reservationExists: reservationSnap.exists,
    reservationStatus: reservationSnap.exists ? reservationSnap.data()?.status ?? null : null,
  };
}

let unexpectedProbeFailures = 0;

async function runCase(name, fn, lessonId, reservationDocId) {
  try {
    await fn();
    const state = await readState(lessonId, reservationDocId);
    console.log(JSON.stringify({ name, ok: true, ...state }));
  } catch (error) {
    const state = await readState(lessonId, reservationDocId);
    console.log(JSON.stringify({
      name,
      ok: false,
      code: error?.code || null,
      message: error?.message || String(error),
      ...state,
    }));
  }
}

async function runExpectedDeniedCase(name, fn, lessonId, reservationDocId, expectedBookedCount) {
  try {
    await fn();
    unexpectedProbeFailures += 1;
    const state = await readState(lessonId, reservationDocId);
    console.log(JSON.stringify({
      name,
      ok: false,
      expected: 'permission-denied',
      actual: 'allowed',
      bookedCountUnchanged: state.bookedCount === expectedBookedCount,
      ...state,
    }));
  } catch (error) {
    const state = await readState(lessonId, reservationDocId);
    const denied = error?.code === 'permission-denied';
    const unchanged = state.bookedCount === expectedBookedCount;
    if (!denied || !unchanged) {
      unexpectedProbeFailures += 1;
    }
    console.log(JSON.stringify({
      name,
      ok: denied && unchanged,
      expected: 'permission-denied',
      code: error?.code || null,
      message: error?.message || String(error),
      bookedCountUnchanged: unchanged,
      ...state,
    }));
  }
}

async function main() {
  const authUser = await admin.auth().getUserByEmail('student@example.com');
  console.log(JSON.stringify({
    name: 'auth_user',
    ok: true,
    uid: authUser.uid,
    email: authUser.email,
    disabled: authUser.disabled,
  }));

  const clientApp = initializeClientApp(firebaseConfig, `live-probe-${Date.now()}`);
  const auth = getAuth(clientApp);
  const creds = await signInWithEmailAndPassword(auth, 'student@example.com', '123456');
  console.log(JSON.stringify({
    name: 'auth_sign_in',
    ok: true,
    uid: creds.user.uid,
    email: creds.user.email,
    projectId: firebaseConfig.projectId,
  }));

  const clientDb = getFirestore(clientApp);
  const uid = creds.user.uid;
  const suffix = `${Date.now()}`;
  const studentId = `student-live-${suffix}`;

  const firstGroupClassId = `group-first-${suffix}`;
  const firstLessonId = `lesson-first-${suffix}`;
  const firstReservationId = reservationId({ lessonId: firstLessonId, studentId });
  await seedBase({
    suffix: `first-${suffix}`,
    uid,
    studentId,
    groupClassId: firstGroupClassId,
    lessonId: firstLessonId,
    bookedCount: 0,
  });

  await runCase(
    'first_reserve_pair',
    async () => {
      await runTransaction(clientDb, async (transaction) => {
        const lessonRef = doc(clientDb, 'groupLessons', firstLessonId);
        const reservationRef = doc(clientDb, 'groupLessonReservations', firstReservationId);
        await transaction.get(lessonRef);
        transaction.set(reservationRef, {
          academyId: ACADEMY_ID,
          lessonId: firstLessonId,
          groupClassId: firstGroupClassId,
          studentId,
          status: 'active',
          source: 'student',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          cancelledAt: null,
        });
        transaction.update(lessonRef, {
          bookedCount: 1,
          updatedAt: serverTimestamp(),
        });
      });
    },
    firstLessonId,
    firstReservationId
  );

  await runExpectedDeniedCase(
    'negative_direct_booked_count_only_plus_one_after_active_reservation',
    async () => {
      await runTransaction(clientDb, async (transaction) => {
        const lessonRef = doc(clientDb, 'groupLessons', firstLessonId);
        const lessonSnap = await transaction.get(lessonRef);
        transaction.update(lessonRef, {
          bookedCount: lessonSnap.data().bookedCount + 1,
          updatedAt: serverTimestamp(),
        });
      });
    },
    firstLessonId,
    firstReservationId,
    1
  );

  const capacityOnlyGroupClassId = `group-capacity-only-${suffix}`;
  const capacityOnlyLessonId = `lesson-capacity-only-${suffix}`;
  const capacityOnlyReservationId = reservationId({ lessonId: capacityOnlyLessonId, studentId });
  await seedBase({
    suffix: `capacity-only-${suffix}`,
    uid,
    studentId,
    groupClassId: capacityOnlyGroupClassId,
    lessonId: capacityOnlyLessonId,
    bookedCount: 2,
  });
  await adminDb.collection('groupLessonReservations').doc(capacityOnlyReservationId).set({
    academyId: ACADEMY_ID,
    lessonId: capacityOnlyLessonId,
    groupClassId: capacityOnlyGroupClassId,
    studentId,
    status: 'active',
    source: 'student',
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    cancelledAt: null,
  });

  await runExpectedDeniedCase(
    'negative_direct_booked_count_only_plus_one_to_capacity',
    async () => {
      await runTransaction(clientDb, async (transaction) => {
        const lessonRef = doc(clientDb, 'groupLessons', capacityOnlyLessonId);
        transaction.update(lessonRef, {
          bookedCount: 3,
          updatedAt: serverTimestamp(),
        });
      });
    },
    capacityOnlyLessonId,
    capacityOnlyReservationId,
    2
  );

  const createOnlyGroupClassId = `group-create-only-${suffix}`;
  const createOnlyLessonId = `lesson-create-only-${suffix}`;
  const createOnlyReservationId = reservationId({ lessonId: createOnlyLessonId, studentId });
  await seedBase({
    suffix: `create-only-${suffix}`,
    uid,
    studentId,
    groupClassId: createOnlyGroupClassId,
    lessonId: createOnlyLessonId,
    bookedCount: 0,
  });

  await runExpectedDeniedCase(
    'negative_reservation_create_without_booked_count_pair',
    async () => {
      await runTransaction(clientDb, async (transaction) => {
        const reservationRef = doc(clientDb, 'groupLessonReservations', createOnlyReservationId);
        transaction.set(reservationRef, {
          academyId: ACADEMY_ID,
          lessonId: createOnlyLessonId,
          groupClassId: createOnlyGroupClassId,
          studentId,
          status: 'active',
          source: 'student',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          cancelledAt: null,
        });
      });
    },
    createOnlyLessonId,
    createOnlyReservationId,
    0
  );

  const updateOnlyGroupClassId = `group-update-only-${suffix}`;
  const updateOnlyLessonId = `lesson-update-only-${suffix}`;
  const updateOnlyReservationId = reservationId({ lessonId: updateOnlyLessonId, studentId });
  await seedBase({
    suffix: `update-only-${suffix}`,
    uid,
    studentId,
    groupClassId: updateOnlyGroupClassId,
    lessonId: updateOnlyLessonId,
    bookedCount: 0,
  });
  await adminDb.collection('groupLessonReservations').doc(updateOnlyReservationId).set({
    academyId: ACADEMY_ID,
    lessonId: updateOnlyLessonId,
    groupClassId: updateOnlyGroupClassId,
    studentId,
    status: 'cancelled',
    source: 'student',
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    cancelledAt: admin.firestore.Timestamp.now(),
  });

  await runExpectedDeniedCase(
    'negative_reservation_update_without_booked_count_pair',
    async () => {
      await runTransaction(clientDb, async (transaction) => {
        const reservationRef = doc(clientDb, 'groupLessonReservations', updateOnlyReservationId);
        await transaction.get(reservationRef);
        transaction.update(reservationRef, {
          status: 'active',
          cancelledAt: null,
          updatedAt: serverTimestamp(),
        });
      });
    },
    updateOnlyLessonId,
    updateOnlyReservationId,
    0
  );

  const reGroupClassId = `group-rereserve-${suffix}`;
  const reLessonId = `lesson-rereserve-${suffix}`;
  const reReservationId = reservationId({ lessonId: reLessonId, studentId });
  await seedBase({
    suffix: `rereserve-${suffix}`,
    uid,
    studentId,
    groupClassId: reGroupClassId,
    lessonId: reLessonId,
    bookedCount: 0,
  });
  await adminDb.collection('groupLessonReservations').doc(reReservationId).set({
    academyId: ACADEMY_ID,
    lessonId: reLessonId,
    groupClassId: reGroupClassId,
    studentId,
    status: 'cancelled',
    source: 'student',
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    cancelledAt: admin.firestore.Timestamp.now(),
  });

  await runCase(
    'rereserve_pair',
    async () => {
      await runTransaction(clientDb, async (transaction) => {
        const lessonRef = doc(clientDb, 'groupLessons', reLessonId);
        const reservationRef = doc(clientDb, 'groupLessonReservations', reReservationId);
        await transaction.get(lessonRef);
        await transaction.get(reservationRef);
        transaction.update(reservationRef, {
          status: 'active',
          cancelledAt: null,
          updatedAt: serverTimestamp(),
        });
        transaction.update(lessonRef, {
          bookedCount: 1,
          updatedAt: serverTimestamp(),
        });
      });
    },
    reLessonId,
    reReservationId
  );

  const cancelGroupClassId = `group-cancel-${suffix}`;
  const cancelLessonId = `lesson-cancel-${suffix}`;
  const cancelReservationId = reservationId({ lessonId: cancelLessonId, studentId });
  await seedBase({
    suffix: `cancel-${suffix}`,
    uid,
    studentId,
    groupClassId: cancelGroupClassId,
    lessonId: cancelLessonId,
    bookedCount: 1,
  });
  await adminDb.collection('groupLessonReservations').doc(cancelReservationId).set({
    academyId: ACADEMY_ID,
    lessonId: cancelLessonId,
    groupClassId: cancelGroupClassId,
    studentId,
    status: 'active',
    source: 'student',
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    cancelledAt: null,
  });

  await runCase(
    'cancel_pair',
    async () => {
      await runTransaction(clientDb, async (transaction) => {
        const lessonRef = doc(clientDb, 'groupLessons', cancelLessonId);
        const reservationRef = doc(clientDb, 'groupLessonReservations', cancelReservationId);
        await transaction.get(lessonRef);
        await transaction.get(reservationRef);
        transaction.update(reservationRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.update(lessonRef, {
          bookedCount: 0,
          updatedAt: serverTimestamp(),
        });
      });
    },
    cancelLessonId,
    cancelReservationId
  );

  await signOut(auth);
  await deleteApp(clientApp);

  if (unexpectedProbeFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
