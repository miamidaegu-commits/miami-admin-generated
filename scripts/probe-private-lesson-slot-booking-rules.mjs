import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { initializeApp as initializeClientApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
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
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
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
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const ACADEMY_ID = 'academy_e2e_default';
const STUDENT_EMAIL = 'student@example.com';
const PASSWORD = '123456';
const TEACHER = 'teacher';
const db = admin.firestore();
let failures = 0;

function reservationId({ slotId, studentId }) {
  return `${ACADEMY_ID}__${slotId}__${studentId}`;
}

function print(result) {
  console.log(JSON.stringify(result));
  if (!result.ok) failures += 1;
}

async function expectDenied(name, fn) {
  try {
    await fn();
    print({ name, ok: false, expected: 'permission-denied', actual: 'allowed' });
  } catch (error) {
    print({
      name,
      ok: error?.code === 'permission-denied',
      expected: 'permission-denied',
      code: error?.code || null,
      message: error?.message || String(error),
    });
  }
}

async function expectAllowed(name, fn) {
  try {
    const detail = await fn();
    print({ name, ok: true, ...(detail || {}) });
  } catch (error) {
    print({ name, ok: false, code: error?.code || null, message: error?.message || String(error) });
  }
}

async function main() {
  const unique = `${Date.now()}`;
  const studentUser = await admin.auth().getUserByEmail(STUDENT_EMAIL);
  const studentId = `probe-private-slot-student-${unique}`;
  const slotId = `probe-private-slot-${unique}`;
  const slotOnlyId = `probe-private-slot-only-${unique}`;
  const createOnlyId = `probe-private-create-only-${unique}`;
  const updateOnlyId = `probe-private-update-only-${unique}`;
  const studentMembershipRef = db.collection('academyMemberships').doc(`${ACADEMY_ID}_${studentUser.uid}`);
  const originalMembership = (await studentMembershipRef.get()).data() || null;
  const nowTs = admin.firestore.Timestamp.now();
  const refsToDelete = [
    db.collection('privateStudents').doc(studentId),
    db.collection('studentPrivateAccessSummary').doc(`${ACADEMY_ID}__${studentId}`),
    db.collection('privateLessonSlots').doc(slotId),
    db.collection('privateLessonSlots').doc(slotOnlyId),
    db.collection('privateLessonSlots').doc(createOnlyId),
    db.collection('privateLessonSlots').doc(updateOnlyId),
    db.collection('privateLessonReservations').doc(reservationId({ slotId, studentId })),
    db.collection('privateLessonReservations').doc(reservationId({ slotId: createOnlyId, studentId })),
    db.collection('privateLessonReservations').doc(reservationId({ slotId: updateOnlyId, studentId })),
  ];

  await Promise.all([
    db.collection('privateStudents').doc(studentId).set({
      academyId: ACADEMY_ID,
      name: `Probe Private ${unique}`,
      teacher: TEACHER,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    studentMembershipRef.set(
      {
        academyId: ACADEMY_ID,
        uid: studentUser.uid,
        email: STUDENT_EMAIL,
        role: 'student',
        studentId,
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
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('studentPrivateAccessSummary').doc(`${ACADEMY_ID}__${studentId}`).set({
      academyId: ACADEMY_ID,
      studentId,
      teacherKeys: [TEACHER],
      activePackageIds: [`probe-private-package-${unique}`],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    ...[slotId, slotOnlyId, createOnlyId, updateOnlyId].map((id, index) =>
      db.collection('privateLessonSlots').doc(id).set({
        academyId: ACADEMY_ID,
        teacher: TEACHER,
        date: `2099-03-${String(10 + index).padStart(2, '0')}`,
        time: '09:00',
        startAt: admin.firestore.Timestamp.fromDate(new Date(`2099-03-${String(10 + index).padStart(2, '0')}T09:00:00`)),
        durationMinutes: 50,
        status: 'open',
        reservedStudentId: '',
        reservationId: '',
        createdByUid: studentUser.uid,
        createdAt: nowTs,
        updatedAt: nowTs,
        reservedAt: null,
        cancelledAt: null,
      })
    ),
  ]);

  const app = initializeClientApp(firebaseConfig, `private-slot-probe-${unique}`);
  const auth = getAuth(app);
  const creds = await signInWithEmailAndPassword(auth, STUDENT_EMAIL, PASSWORD);
  const clientDb = getFirestore(app);

  try {
    await expectAllowed('paired_private_slot_reserve_allowed', async () => {
      const rid = reservationId({ slotId, studentId });
      await runTransaction(clientDb, async (transaction) => {
        const slotRef = doc(clientDb, 'privateLessonSlots', slotId);
        const reservationRef = doc(clientDb, 'privateLessonReservations', rid);
        const slotSnap = await transaction.get(slotRef);
        if (!slotSnap.exists()) throw new Error('slot missing');
        const slot = slotSnap.data();
        transaction.set(reservationRef, {
          academyId: ACADEMY_ID,
          slotId,
          studentId,
          teacher: TEACHER,
          date: slot.date,
          time: slot.time,
          status: 'active',
          source: 'student',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          cancelledAt: null,
        });
        transaction.update(slotRef, {
          status: 'reserved',
          reservedStudentId: studentId,
          reservationId: rid,
          reservedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          cancelledAt: null,
        });
      });
      return { slotId };
    });

    await expectDenied('forged_slot_only_status_update_denied', async () => {
      await updateDoc(doc(clientDb, 'privateLessonSlots', slotOnlyId), {
        status: 'reserved',
        reservedStudentId: studentId,
        reservationId: reservationId({ slotId: slotOnlyId, studentId }),
        reservedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await expectDenied('reservation_create_without_paired_slot_update_denied', async () => {
      await setDoc(
        doc(clientDb, 'privateLessonReservations', reservationId({ slotId: createOnlyId, studentId })),
        {
          academyId: ACADEMY_ID,
          slotId: createOnlyId,
          studentId,
          teacher: TEACHER,
          date: '2099-03-12',
          time: '09:00',
          status: 'active',
          source: 'student',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          cancelledAt: null,
        }
      );
    });

    const updateOnlyReservationId = reservationId({ slotId: updateOnlyId, studentId });
    await db.collection('privateLessonReservations').doc(updateOnlyReservationId).set({
      academyId: ACADEMY_ID,
      slotId: updateOnlyId,
      studentId,
      teacher: TEACHER,
      date: '2099-03-13',
      time: '09:00',
      status: 'active',
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
      cancelledAt: null,
    });
    await db.collection('privateLessonSlots').doc(updateOnlyId).set(
      {
        status: 'reserved',
        reservedStudentId: studentId,
        reservationId: updateOnlyReservationId,
        reservedAt: nowTs,
        updatedAt: nowTs,
      },
      { merge: true }
    );

    await expectDenied('reservation_update_without_paired_slot_update_denied', async () => {
      await updateDoc(doc(clientDb, 'privateLessonReservations', updateOnlyReservationId), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } finally {
    await signOut(auth).catch(() => {});
    await deleteApp(app).catch(() => {});
    await Promise.all(refsToDelete.map((ref) => ref.delete().catch(() => {})));
    if (originalMembership) {
      await studentMembershipRef.set(originalMembership);
    } else {
      await studentMembershipRef.delete().catch(() => {});
    }
  }

  if (creds.user.uid !== studentUser.uid) {
    throw new Error('Signed in unexpected user');
  }
  if (failures > 0) throw new Error(`${failures} private slot rule probe case(s) failed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
