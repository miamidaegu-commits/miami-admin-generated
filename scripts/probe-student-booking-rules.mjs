import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import admin from 'firebase-admin';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [emulatorHostname, emulatorPortRaw] = EMULATOR_HOST.split(':');
const emulatorPort = Number(emulatorPortRaw || 8080);

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'miami-e2e',
  });
}

const adminDb = admin.firestore();
const clientApp = initializeApp({
  apiKey: 'demo-api-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'miami-e2e',
  appId: 'demo-app-id',
}, `probe-${Date.now()}`);
const clientDb = getFirestore(clientApp);

connectFirestoreEmulator(clientDb, emulatorHostname, emulatorPort, {
  mockUserToken: {
    sub: 'student-probe-uid',
    user_id: 'student-probe-uid',
    email: 'student@example.com',
    role: 'student',
  },
});

const ACADEMY_ID = 'academy_e2e_default';
const STUDENT_UID = 'student-probe-uid';

function reservationId({ lessonId, studentId }) {
  return `${ACADEMY_ID}__${lessonId}__${studentId}`;
}

async function seedBase({ suffix, studentId, groupClassId, lessonId, bookedCount = 0 }) {
  const now = admin.firestore.Timestamp.now();

  await adminDb.collection('academyMemberships').doc(`${ACADEMY_ID}_${STUDENT_UID}`).set({
    academyId: ACADEMY_ID,
    uid: STUDENT_UID,
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
    subject: `Lesson ${suffix}`,
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
  const suffix = `${Date.now()}`;
  const studentId = `student-${suffix}`;

  const firstGroupClassId = `group-first-${suffix}`;
  const firstLessonId = `lesson-first-${suffix}`;
  const firstReservationId = reservationId({ lessonId: firstLessonId, studentId });
  await seedBase({
    suffix: `first-${suffix}`,
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

  if (unexpectedProbeFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
