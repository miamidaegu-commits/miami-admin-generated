import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const EXPECTED_PROJECT_ID = 'miami-e2e';
const DEFAULT_E2E_ACADEMY_ID = 'academy_e2e_default';

function getAdminApp() {
  const existing = admin.apps.find((app) => app?.name === 'e2e-admin-helper');
  if (existing) return existing;

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`Missing service account key: ${SERVICE_ACCOUNT_PATH}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `E2E admin helpers require ${EXPECTED_PROJECT_ID}, received ${serviceAccount.project_id || '(missing)'}.`
    );
  }

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    'e2e-admin-helper'
  );
}

function getDb() {
  return getAdminApp().firestore();
}

function timestampNow() {
  return admin.firestore.Timestamp.now();
}

function parseLegacyLessonDateTime(date, time) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  const [hour = 0, minute = 0] = String(time || '00:00').split(':').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
}

async function deleteKnownAcademyDoc(db, collectionName, docId, academyId) {
  const id = String(docId || '').trim();
  if (!id) return;

  const docRef = db.collection(collectionName).doc(id);
  const snap = await docRef.get();
  if (!snap.exists) return;

  const data = snap.data() || {};
  if (String(data.academyId || '').trim() !== academyId) {
    throw new Error(
      `Refusing to delete ${collectionName}/${id}: academyId ${data.academyId || '(missing)'} does not match ${academyId}.`
    );
  }

  await docRef.delete();
}

function formatCleanupError(error) {
  return error?.message || String(error);
}

function logAdminCleanupWarnings(label, results) {
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`${label}[${index}] cleanup warning: ${formatCleanupError(result.reason)}`);
    }
  });
}

async function cleanupKnownAcademyDocs(label, db, collectionName, docIds, academyId) {
  const ids = Array.from(
    new Set(
      (Array.isArray(docIds) ? docIds : [docIds])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  const results = await Promise.allSettled(
    ids.map((id) => deleteKnownAcademyDoc(db, collectionName, id, academyId))
  );
  logAdminCleanupWarnings(label, results);
  return results;
}

export async function createAdminSeededPrivateStudent(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const studentRef = params.studentId
    ? db.collection('privateStudents').doc(String(params.studentId))
    : db.collection('privateStudents').doc();
  const now = timestampNow();
  const name = String(params.name || `E2E 개인진행 학생 ${Date.now()}`).trim();
  const teacher = String(params.teacher || 'teacher').trim();

  await studentRef.set({
    academyId,
    name,
    studentName: String(params.studentName || name).trim(),
    teacher,
    teacherName: String(params.teacherName || teacher).trim(),
    status: String(params.status || 'active').trim(),
    phone: String(params.phone || '010-9999-0000').trim(),
    carNumber: String(params.carNumber || '').trim(),
    learningPurpose: String(params.learningPurpose || 'E2E private progress').trim(),
    firstRegisteredAt: String(params.firstRegisteredAt || '').trim(),
    note: String(params.note || 'E2E private progress without package').trim(),
    paidLessons:
      Number.isInteger(Number(params.paidLessons)) && Number(params.paidLessons) >= 0
        ? Number(params.paidLessons)
        : 0,
    attendanceCount:
      Number.isInteger(Number(params.attendanceCount)) && Number(params.attendanceCount) >= 0
        ? Number(params.attendanceCount)
        : 0,
    createdAt: now,
    updatedAt: now,
  });

  return {
    studentId: studentRef.id,
    studentName: name,
    teacher,
  };
}

export async function getAdminSeededPrivateStudent({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentId,
}) {
  const db = getDb();
  const id = String(studentId || '').trim();
  if (!id) return null;

  const snap = await db.collection('privateStudents').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (String(data.academyId || '').trim() !== String(academyId || '').trim()) return null;
  return {
    id: snap.id,
    ...data,
  };
}

export async function getAdminPrivateStudentByName({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentName,
}) {
  const db = getDb();
  const name = String(studentName || '').trim();
  if (!name) return null;

  const snap = await db
    .collection('privateStudents')
    .where('academyId', '==', String(academyId || '').trim())
    .where('name', '==', name)
    .limit(1)
    .get();
  const docSnap = snap.docs[0];
  return docSnap ? { id: docSnap.id, ...docSnap.data() } : null;
}

export async function createAdminSeededStudentUser(params = {}) {
  const auth = admin.auth(getAdminApp());
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const email = String(params.email || `e2e-student-${Date.now()}@example.com`).trim();
  const password = String(params.password || '123456').trim();
  const studentId = String(params.studentId || '').trim();
  const displayName = String(params.displayName || params.studentName || studentId || email).trim();
  const now = timestampNow();
  const user = await auth.createUser({
    email,
    password,
    displayName,
  });
  await auth.setCustomUserClaims(user.uid, {
    role: 'student',
    academyId,
    studentId,
  });
  await Promise.all([
    db.collection('users').doc(user.uid).set({
      uid: user.uid,
      email,
      displayName,
      role: 'student',
      isActive: true,
      lastSelectedAcademyId: academyId,
      updatedAt: now,
      createdAt: now,
    }),
    db.collection('academyMemberships').doc(`${academyId}_${user.uid}`).set({
      academyId,
      uid: user.uid,
      email,
      displayName,
      role: 'student',
      studentId,
      teacherName: '',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    }),
  ]);
  return {
    uid: user.uid,
    email,
    studentId,
  };
}

export async function cleanupAdminSeededStudentUser({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  uid,
}) {
  const userId = String(uid || '').trim();
  if (!userId) return;
  const auth = admin.auth(getAdminApp());
  const db = getDb();
  await Promise.all([
    auth.deleteUser(userId).catch(() => {}),
    db.collection('users').doc(userId).delete().catch(() => {}),
    db.collection('academyMemberships').doc(`${String(academyId || '').trim()}_${userId}`).delete().catch(() => {}),
  ]);
}

export async function createAdminSeededStudentPackage(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const packageRef = params.packageId
    ? db.collection('studentPackages').doc(String(params.packageId))
    : db.collection('studentPackages').doc();
  const now = timestampNow();
  const packageType = String(params.packageType || 'private').trim();
  const teacher = String(params.teacher || params.teacherName || 'teacher').trim();
  const teacherKey = String(params.teacherKey || teacher).trim();
  const totalCount =
    Number.isInteger(Number(params.totalCount)) && Number(params.totalCount) >= 0
      ? Number(params.totalCount)
      : 0;
  const remainingCount =
    Number.isInteger(Number(params.remainingCount)) && Number(params.remainingCount) >= 0
      ? Number(params.remainingCount)
      : totalCount;
  const usedCount =
    Number.isInteger(Number(params.usedCount)) && Number(params.usedCount) >= 0
      ? Number(params.usedCount)
      : Math.max(totalCount - remainingCount, 0);

  await packageRef.set({
    academyId,
    studentId: String(params.studentId || '').trim(),
    studentName: String(params.studentName || '').trim(),
    title: String(params.title || `E2E ${packageType} package ${Date.now()}`).trim(),
    packageType,
    teacher,
    teacherName: String(params.teacherName || teacher).trim(),
    ...(packageType === 'private'
      ? {
          teacherKey,
          teacherDisplayName: String(params.teacherDisplayName || params.teacherName || teacher).trim(),
          teacherUid: String(params.teacherUid || '').trim(),
          teacherEmail: String(params.teacherEmail || '').trim(),
        }
      : {}),
    totalCount,
    usedCount,
    remainingCount,
    status: String(params.status || 'active').trim(),
    startDate: String(params.startDate || '').trim(),
    ...(params.registrationStartDate !== undefined
      ? { registrationStartDate: String(params.registrationStartDate || '').trim() }
      : {}),
    ...(params.registrationWeeks !== undefined
      ? { registrationWeeks: Number(params.registrationWeeks) || null }
      : {}),
    ...(params.weeklyFrequency !== undefined
      ? { weeklyFrequency: Number(params.weeklyFrequency) || null }
      : {}),
    ...(params.privatePackageMode !== undefined
      ? { privatePackageMode: String(params.privatePackageMode || '').trim() }
      : {}),
    expiresAt: String(params.expiresAt || '2099-01-01').trim(),
    ...(params.paymentDate !== undefined
      ? { paymentDate: String(params.paymentDate || '').trim() }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  return {
    packageId: packageRef.id,
    studentId: String(params.studentId || '').trim(),
    teacher,
  };
}

export async function createAdminSeededPrivateAvailabilityTemplate(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const templateRef = params.templateId
    ? db.collection('privateLessonAvailabilityTemplates').doc(String(params.templateId))
    : db.collection('privateLessonAvailabilityTemplates').doc();
  const now = timestampNow();
  const teacherKey = String(params.teacherKey || params.teacher || 'teacher').trim();
  await templateRef.set({
    academyId,
    teacher: teacherKey,
    teacherName: String(params.teacherName || teacherKey).trim(),
    teacherKey,
    weekday: Number(params.weekday || 1),
    time: String(params.time || '13:00').trim(),
    durationMinutes: Number(params.durationMinutes || 60),
    status: String(params.status || 'active').trim(),
    useForFixedAssignment: params.useForFixedAssignment === true,
    openForStudentBooking: params.openForStudentBooking !== false,
    createdAt: now,
    updatedAt: now,
  });
  return { templateId: templateRef.id };
}

export async function cleanupAdminSeededPrivateAvailabilityTemplate({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  templateId,
}) {
  await deleteKnownAcademyDoc(
    getDb(),
    'privateLessonAvailabilityTemplates',
    String(templateId || '').trim(),
    String(academyId || '').trim()
  );
}

export async function getAdminSeededPrivatePackagesForStudent({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentId,
}) {
  const db = getDb();
  const snap = await db
    .collection('studentPackages')
    .where('academyId', '==', String(academyId || '').trim())
    .where('studentId', '==', String(studentId || '').trim())
    .where('packageType', '==', 'private')
    .get();
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
}

export async function getAdminSeededStudentPackage({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  packageId,
}) {
  const db = getDb();
  const id = String(packageId || '').trim();
  if (!id) return null;

  const snap = await db.collection('studentPackages').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (String(data.academyId || '').trim() !== String(academyId || '').trim()) return null;
  return {
    id: snap.id,
    ...data,
  };
}

export async function getAdminSeededLesson({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  lessonId,
}) {
  const db = getDb();
  const id = String(lessonId || '').trim();
  if (!id) return null;

  const snap = await db.collection('lessons').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (String(data.academyId || '').trim() !== String(academyId || '').trim()) return null;
  return {
    id: snap.id,
    ...data,
  };
}

export async function getAdminGroupStudentById({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  groupStudentId,
}) {
  const db = getDb();
  const id = String(groupStudentId || '').trim();
  if (!id) return null;

  const snap = await db.collection('groupStudents').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (String(data.academyId || '').trim() !== String(academyId || '').trim()) return null;
  return {
    id: snap.id,
    ...data,
  };
}

export async function getAdminSeededStudentPrivateAccessSummary({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentId,
}) {
  const db = getDb();
  const id = `${String(academyId || '').trim()}__${String(studentId || '').trim()}`;
  const snap = await db.collection('studentPrivateAccessSummary').doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function setAdminSeededStudentPrivateAccessSummary({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentId,
  teacherKeys = [],
  activePackageIds = [],
  privateSlotBookingPilotEnabled,
}) {
  const db = getDb();
  const id = `${String(academyId || '').trim()}__${String(studentId || '').trim()}`;
  const now = timestampNow();
  const payload = {
    academyId: String(academyId || '').trim(),
    studentId: String(studentId || '').trim(),
    teacherKeys,
    activePackageIds,
    createdAt: now,
    updatedAt: now,
  };
  if (privateSlotBookingPilotEnabled !== undefined) {
    payload.privateSlotBookingPilotEnabled = privateSlotBookingPilotEnabled === true;
  }
  await db.collection('studentPrivateAccessSummary').doc(id).set(
    payload,
    { merge: true }
  );
  return { summaryId: id };
}

export async function createAdminSeededTeacher({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  teacherId,
  teacherKey,
  teacherName,
  teacherUid = '',
  teacherEmail = '',
}) {
  const db = getDb();
  const now = timestampNow();
  const key = String(teacherKey || '').trim();
  const id = String(teacherId || `e2e-teacher-${key}`).trim();
  await db.collection('teachers').doc(id).set({
    academyId: String(academyId || '').trim(),
    name: String(teacherName || key).trim(),
    teacherName: key,
    teacherKey: key,
    teacherUid: String(teacherUid || '').trim(),
    teacherEmail: String(teacherEmail || '').trim(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return { teacherId: id, teacherKey: key, teacherName: String(teacherName || key).trim() };
}

export async function cleanupAdminSeededTeacher({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  teacherId,
}) {
  await deleteKnownAcademyDoc(
    getDb(),
    'teachers',
    String(teacherId || '').trim(),
    String(academyId || '').trim()
  );
}

export async function cleanupAdminSeededStudentPrivateAccessSummary({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentId,
}) {
  const id = `${String(academyId || '').trim()}__${String(studentId || '').trim()}`;
  await deleteKnownAcademyDoc(
    getDb(),
    'studentPrivateAccessSummary',
    id,
    String(academyId || '').trim()
  );
}

export async function cleanupAdminSeededCreditTransactionsForStudent({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentId,
}) {
  const db = getDb();
  const snap = await db
    .collection('creditTransactions')
    .where('academyId', '==', String(academyId || '').trim())
    .where('studentId', '==', String(studentId || '').trim())
    .get();
  await Promise.all(snap.docs.map((docSnap) => docSnap.ref.delete().catch(() => {})));
}

export async function cleanupAdminTempStudentData({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  studentId,
  studentName,
  packageId,
  packageIds = [],
  createdPackageIds = [],
  groupStudentId,
  groupStudentIds = [],
  allowStudentNameLookup = false,
  cleanupPackagesByStudent = false,
  cleanupGroupStudentsByStudent = false,
} = {}) {
  const db = getDb();
  const scopedAcademyId = String(academyId || '').trim();
  const studentIds = new Set(
    [studentId]
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );

  if (allowStudentNameLookup === true && studentName) {
    const snap = await db
      .collection('privateStudents')
      .where('academyId', '==', scopedAcademyId)
      .where('name', '==', String(studentName || '').trim())
      .get();
    snap.docs.forEach((docSnap) => studentIds.add(docSnap.id));
  }

  const exactPackageIds = new Set(
    [packageId, ...(Array.isArray(packageIds) ? packageIds : []), ...(Array.isArray(createdPackageIds) ? createdPackageIds : [])]
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  const exactGroupStudentIds = new Set(
    [groupStudentId, ...(Array.isArray(groupStudentIds) ? groupStudentIds : [])]
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );

  if (cleanupPackagesByStudent === true) {
    for (const currentStudentId of studentIds) {
      const snap = await db
        .collection('studentPackages')
        .where('academyId', '==', scopedAcademyId)
        .where('studentId', '==', currentStudentId)
        .get();
      snap.docs.forEach((docSnap) => exactPackageIds.add(docSnap.id));
    }
  }

  if (cleanupGroupStudentsByStudent === true) {
    for (const currentStudentId of studentIds) {
      const snap = await db
        .collection('groupStudents')
        .where('academyId', '==', scopedAcademyId)
        .where('studentId', '==', currentStudentId)
        .get();
      snap.docs.forEach((docSnap) => exactGroupStudentIds.add(docSnap.id));
    }
  }

  const summaryIds = Array.from(studentIds).flatMap((currentStudentId) => [
    currentStudentId,
    `${scopedAcademyId}__${currentStudentId}`,
  ]);

  const results = await Promise.allSettled([
    cleanupKnownAcademyDocs(
      'cleanupTempStudentData.privateStudents',
      db,
      'privateStudents',
      Array.from(studentIds),
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempStudentData.studentPackages',
      db,
      'studentPackages',
      Array.from(exactPackageIds),
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempStudentData.groupStudents',
      db,
      'groupStudents',
      Array.from(exactGroupStudentIds),
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempStudentData.studentGroupAccessSummary',
      db,
      'studentGroupAccessSummary',
      summaryIds,
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempStudentData.studentPrivateAccessSummary',
      db,
      'studentPrivateAccessSummary',
      summaryIds,
      scopedAcademyId
    ),
  ]);
  logAdminCleanupWarnings('cleanupTempStudentData', results);
}

export async function cleanupAdminSeededTempGroupAttendanceSetup({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  packageId,
  groupStudentId,
  studentId,
  creditTransactionId,
  creditTransactionIds = [],
  cleanupCreditTransactionsByPackage = false,
  skipCreditTransactionCleanup = false,
  groupLessonId = '',
}) {
  const db = getDb();
  const scopedAcademyId = String(academyId || '').trim();
  const exactCreditTransactionIds = [
    creditTransactionId,
    ...(Array.isArray(creditTransactionIds) ? creditTransactionIds : []),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  await Promise.allSettled([
    cleanupKnownAcademyDocs(
      'cleanupTempGroupAttendanceSetup.groupStudents',
      db,
      'groupStudents',
      groupStudentId,
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempGroupAttendanceSetup.studentPackages',
      db,
      'studentPackages',
      packageId,
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempGroupAttendanceSetup.privateStudents',
      db,
      'privateStudents',
      studentId,
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempGroupAttendanceSetup.creditTransactions',
      db,
      'creditTransactions',
      exactCreditTransactionIds,
      scopedAcademyId
    ),
  ]);

  if (
    packageId &&
    skipCreditTransactionCleanup !== true &&
    cleanupCreditTransactionsByPackage === true &&
    exactCreditTransactionIds.length === 0
  ) {
    const snap = await db
      .collection('creditTransactions')
      .where('academyId', '==', scopedAcademyId)
      .where('packageId', '==', String(packageId || '').trim())
      .get();
    const filteredIds = snap.docs
      .filter((docSnap) => {
        const data = docSnap.data() || {};
        if (groupLessonId && String(data.sourceId || '') !== String(groupLessonId)) return false;
        if (studentId && String(data.studentId || '') !== String(studentId)) return false;
        return true;
      })
      .map((docSnap) => docSnap.id);
    await cleanupKnownAcademyDocs(
      'cleanupTempGroupAttendanceSetup.creditTransactionsByPackage',
      db,
      'creditTransactions',
      filteredIds,
      scopedAcademyId
    );
  }
}

export async function createAdminSeededTempGroupAttendanceSetup(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupClassId = String(params.groupClassId || '').trim();
  const studentId = String(params.studentId || '').trim();
  const packageId = String(params.packageId || '').trim();
  const groupStudentId = String(params.groupStudentId || '').trim();
  const lessonDate = String(params.lessonDate || '').trim();
  const packageTitle = String(params.tempPackageTitle || params.packageTitle || '').trim();
  const totalCount =
    Number.isInteger(Number(params.totalCount)) && Number(params.totalCount) >= 0
      ? Number(params.totalCount)
      : 4;

  if (!groupClassId) throw new Error('groupClassId is required for group attendance setup.');
  if (!studentId) throw new Error('studentId is required for group attendance setup.');
  if (!packageId) throw new Error('packageId is required for group attendance setup.');
  if (!groupStudentId) throw new Error('groupStudentId is required for group attendance setup.');
  if (!lessonDate) throw new Error('lessonDate is required for group attendance setup.');

  const [groupClassSnap, studentSnap] = await Promise.all([
    db.collection('groupClasses').doc(groupClassId).get(),
    db.collection('privateStudents').doc(studentId).get(),
  ]);

  if (!groupClassSnap.exists) throw new Error(`Group class not found by id: ${groupClassId}`);
  if (!studentSnap.exists) throw new Error(`Student not found by id: ${studentId}`);

  const groupClass = groupClassSnap.data() || {};
  const student = studentSnap.data() || {};
  if (String(groupClass.academyId || '').trim() !== academyId) {
    throw new Error(`Group class academyId does not match ${academyId}: ${groupClassId}`);
  }
  if (String(student.academyId || '').trim() !== academyId) {
    throw new Error(`Student academyId does not match ${academyId}: ${studentId}`);
  }

  const now = timestampNow();
  const startDate = admin.firestore.Timestamp.fromDate(new Date(`${lessonDate}T00:00:00`));
  const teacher = String(groupClass.teacher || groupClass.teacherName || 'teacher').trim().toLowerCase();
  const studentName = String(student.name || student.studentName || params.studentName || '').trim();
  const groupName = String(groupClass.name || params.groupName || '').trim();

  await Promise.all([
    db.collection('studentPackages').doc(packageId).set({
      academyId,
      studentId,
      studentName,
      teacher,
      packageType: 'group',
      groupClassId,
      groupClassName: groupName,
      title: packageTitle,
      totalCount,
      usedCount: 0,
      remainingCount: totalCount,
      status: 'active',
      registrationStartDate: lessonDate,
      registrationWeeks: 1,
      coverageEndDate: '',
      expiresAt: '',
      amountPaid: 0,
      memo: 'E2E temporary package for group attendance test',
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('groupStudents').doc(groupStudentId).set({
      academyId,
      groupClassId,
      classID: groupClassId,
      studentId,
      studentName,
      name: studentName,
      teacher,
      packageId,
      packageType: 'group',
      paidLessons: totalCount,
      attendanceCount: 0,
      startDate,
      status: 'active',
      studentStatus: 'active',
      excludedDates: [],
      breakStartDate: '',
      breakEndDate: '',
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  return {
    packageId,
    groupStudentId,
    studentId,
    studentName,
  };
}

export async function setAdminSeededTempGroupAttendanceState({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  groupLessonId,
  studentId,
  packageId,
  groupStudentId,
  deducted,
  syncGuardStudentId = '',
  totalCount = 4,
}) {
  const db = getDb();
  const scopedAcademyId = String(academyId || '').trim();
  const lessonId = String(groupLessonId || '').trim();
  const scopedStudentId = String(studentId || '').trim();
  const scopedPackageId = String(packageId || '').trim();
  const scopedGroupStudentId = String(groupStudentId || '').trim();
  const normalizedTotalCount = Number(totalCount);

  if (!lessonId) throw new Error('groupLessonId is required for attendance state setup.');
  if (!scopedStudentId) throw new Error('studentId is required for attendance state setup.');
  if (!scopedPackageId) throw new Error('packageId is required for attendance state setup.');
  if (!scopedGroupStudentId) throw new Error('groupStudentId is required for attendance state setup.');

  const isDeducted = deducted === true;
  const countedStudentIDs = [
    String(syncGuardStudentId || '').trim(),
    isDeducted ? scopedStudentId : '',
  ].filter(Boolean);
  const now = timestampNow();
  const batch = db.batch();

  batch.set(
    db.collection('groupLessons').doc(lessonId),
    {
      academyId: scopedAcademyId,
      countedStudentIDs,
      attendanceAppliedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
  batch.set(
    db.collection('studentPackages').doc(scopedPackageId),
    {
      academyId: scopedAcademyId,
      usedCount: isDeducted ? 1 : 0,
      remainingCount: isDeducted ? Math.max(0, normalizedTotalCount - 1) : normalizedTotalCount,
      status: 'active',
      updatedAt: now,
    },
    { merge: true }
  );
  batch.set(
    db.collection('groupStudents').doc(scopedGroupStudentId),
    {
      academyId: scopedAcademyId,
      attendanceCount: isDeducted ? 1 : 0,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();
}

export async function cleanupAdminSeededTempCalendarGroupLessonSetup({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  groupClassId,
  groupLessonId,
  groupLessonIds = [],
}) {
  const db = getDb();
  const scopedAcademyId = String(academyId || '').trim();
  const lessonIds = [
    groupLessonId,
    ...(Array.isArray(groupLessonIds) ? groupLessonIds : []),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  await Promise.allSettled([
    cleanupKnownAcademyDocs(
      'cleanupTempCalendarGroupLessonSetup.groupLessons',
      db,
      'groupLessons',
      lessonIds,
      scopedAcademyId
    ),
    cleanupKnownAcademyDocs(
      'cleanupTempCalendarGroupLessonSetup.groupClasses',
      db,
      'groupClasses',
      groupClassId,
      scopedAcademyId
    ),
  ]);
}

export async function getAdminSeededGroupAttendanceState({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  groupClassId,
  groupLessonId,
  groupStudentId,
  packageId,
  studentId,
}) {
  const db = getDb();
  const scopedAcademyId = String(academyId || '').trim();

  async function readDoc(collectionName, docId) {
    const normalizedDocId = String(docId || '').trim();
    if (!normalizedDocId) {
      return { exists: false };
    }

    const snap = await db.collection(collectionName).doc(normalizedDocId).get();
    const data = snap.exists ? snap.data() || {} : {};
    return {
      exists: snap.exists,
      academyId: data.academyId || '',
      studentId: data.studentId || '',
      packageId: data.packageId || '',
      groupClassId: data.groupClassId || data.groupClassID || data.classID || '',
      countedStudentIDs: Array.isArray(data.countedStudentIDs) ? data.countedStudentIDs : [],
      usedCount: data.usedCount ?? null,
      remainingCount: data.remainingCount ?? null,
      attendanceCount: data.attendanceCount ?? null,
      status: data.status || '',
      studentStatus: data.studentStatus || '',
      updatedAtType: data.updatedAt?.toDate ? 'timestamp' : typeof data.updatedAt,
    };
  }

  const [groupClass, groupLesson, studentPackage, groupStudent, privateStudent] = await Promise.all([
    readDoc('groupClasses', groupClassId),
    readDoc('groupLessons', groupLessonId),
    readDoc('studentPackages', packageId),
    readDoc('groupStudents', groupStudentId),
    readDoc('privateStudents', studentId),
  ]);

  return {
    academyId: scopedAcademyId,
    groupClass,
    groupLesson,
    studentPackage,
    groupStudent,
    privateStudent,
  };
}

export async function getAdminSeededCreditTransactionsForPackage({
  academyId = DEFAULT_E2E_ACADEMY_ID,
  packageId,
}) {
  const db = getDb();
  const snap = await db
    .collection('creditTransactions')
    .where('academyId', '==', String(academyId || '').trim())
    .where('packageId', '==', String(packageId || '').trim())
    .get();
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
}

export async function createAdminSeededLessonRequest(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const teacherEmail = String(params.teacherEmail || 'teacher@example.com').trim();
  const teacherUser = await admin.auth(getAdminApp()).getUserByEmail(teacherEmail);
  const membershipId = `${academyId}_${teacherUser.uid}`;
  const membershipSnap = await db.collection('academyMemberships').doc(membershipId).get();
  if (!membershipSnap.exists) {
    throw new Error(`Teacher membership not found: ${membershipId}`);
  }

  const membership = membershipSnap.data() || {};
  const teacherName = String(params.teacherName || membership.teacherName || '').trim();
  if (!teacherName) throw new Error(`Teacher membership has no teacherName: ${membershipId}`);

  const requestRef = params.requestId
    ? db.collection('lessonRequests').doc(String(params.requestId))
    : db.collection('lessonRequests').doc();
  const studentId = String(params.studentId || `e2e_request_student_${Date.now()}`).trim();
  const studentName = String(params.studentName || `E2E 요청학생 ${Date.now()}`).trim();

  const requestPayload = {
    academyId,
    teacherUID: teacherUser.uid,
    teacherName,
    teacher: teacherName,
    studentID: studentId,
    studentId,
    studentName,
    student: studentName,
    date: String(params.date || '').trim(),
    time: String(params.time || '10:00').trim(),
    subject: String(params.subject || 'E2E 승인 요청').trim(),
    repeatWeekly: params.repeatWeekly === true,
    repeatWeeks:
      Number.isInteger(Number(params.repeatWeeks)) && Number(params.repeatWeeks) >= 1
        ? Number(params.repeatWeeks)
        : 1,
    approvalStatus: 'pending',
    status: String(params.status || 'pending').trim(),
    createdAt: timestampNow(),
    rejectionReason: '',
    seriesID: String(params.seriesID || ''),
  };

  [
    'fixedPrivateTotalCount',
    'paidLessons',
    'totalCount',
    'lessonCount',
    'numberOfLessons',
    'recurrenceCount',
    'repeatCount',
    'count',
    'sessions',
    'durationWeeks',
  ].forEach((fieldName) => {
    if (params[fieldName] !== undefined) {
      requestPayload[fieldName] = params[fieldName];
    }
  });
  ['repeat', 'isRecurring', 'repeatEnabled'].forEach((fieldName) => {
    if (params[fieldName] !== undefined) {
      requestPayload[fieldName] = params[fieldName] === true;
    }
  });
  await requestRef.set(requestPayload);

  return {
    requestId: requestRef.id,
    studentId,
    studentName,
    teacherName,
    date: String(params.date || '').trim(),
    time: String(params.time || '10:00').trim(),
    subject: String(params.subject || 'E2E 승인 요청').trim(),
  };
}

export async function getAdminSeededLessonRequest(requestId) {
  const db = getDb();
  const requestRef = db.collection('lessonRequests').doc(String(requestId || '').trim());
  const snap = await requestRef.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    id: snap.id,
    academyId: data.academyId || null,
    approvalStatus: data.approvalStatus || null,
    status: data.status || null,
    requestStatus: data.requestStatus || null,
    studentId: data.studentId || data.studentID || null,
    studentName: data.studentName || data.student || null,
    teacherName: data.teacherName || data.teacher || null,
    date: data.date || null,
    time: data.time || null,
    subject: data.subject || null,
    repeatWeekly: data.repeatWeekly === true,
    repeatWeeks: data.repeatWeeks || null,
    fixedPrivateTotalCount: data.fixedPrivateTotalCount || null,
    raw: data,
  };
}

export async function createAdminSeededPrivateLesson(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const lessonRef = params.lessonId
    ? db.collection('lessons').doc(String(params.lessonId))
    : db.collection('lessons').doc();
  const now = timestampNow();
  const studentId = String(params.studentId || `e2e_lesson_student_${Date.now()}`).trim();
  const studentName = String(params.studentName || `E2E 수업학생 ${Date.now()}`).trim();
  const teacher = String(params.teacher || 'teacher').trim();
  const date = String(params.date || '').trim();
  const time = String(params.time || '10:00').trim();
  const startDate = parseLegacyLessonDateTime(date, time);

  await lessonRef.set({
    academyId,
    teacher,
    teacherName: String(params.teacherName || teacher).trim(),
    studentId,
    studentID: String(params.studentID || studentId).trim(),
    studentName,
    student: String(params.student || studentName).trim(),
    date,
    time,
    subject: String(params.subject || 'E2E 기존 수업').trim(),
    packageId: String(params.packageId || '').trim(),
    counted: params.counted === true,
    completed: params.completed === true,
    isDeductCancelled: params.isDeductCancelled === true,
    deductMemo: String(params.deductMemo || ''),
    sessionNumber:
      Number.isInteger(Number(params.sessionNumber)) && Number(params.sessionNumber) > 0
        ? Number(params.sessionNumber)
        : null,
    ...(startDate ? { startAt: admin.firestore.Timestamp.fromDate(startDate) } : {}),
    createdAt: now,
    updatedAt: now,
  });

  return {
    lessonId: lessonRef.id,
    studentId,
    studentName,
    teacher,
    packageId: String(params.packageId || '').trim(),
  };
}

export async function createAdminSeededPrivateReservation(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const reservationRef = params.reservationId
    ? db.collection('privateLessonReservations').doc(String(params.reservationId))
    : db.collection('privateLessonReservations').doc();
  const now = timestampNow();
  const studentId = String(params.studentId || `e2e_reservation_student_${Date.now()}`).trim();
  const studentName = String(params.studentName || `E2E 예약학생 ${Date.now()}`).trim();
  const teacher = String(params.teacher || 'teacher').trim();
  const date = String(params.date || '').trim();
  const time = String(params.time || '10:00').trim();
  const startDate = parseLegacyLessonDateTime(date, time);

  await reservationRef.set({
    academyId,
    slotId: String(params.slotId || '').trim(),
    studentId,
    studentName,
    teacher,
    teacherName: String(params.teacherName || teacher).trim(),
    packageId: String(params.packageId || '').trim(),
    deductionPackageId: String(params.deductionPackageId || params.packageId || '').trim(),
    date,
    time,
    status: String(params.status || 'active').trim(),
    ...(startDate ? { startAt: admin.firestore.Timestamp.fromDate(startDate) } : {}),
    createdAt: now,
    updatedAt: now,
  });

  return {
    reservationId: reservationRef.id,
    studentId,
    studentName,
    teacher,
    packageId: String(params.packageId || '').trim(),
  };
}

export async function cleanupAdminSeededPrivatePackageWorkflowCopyFixture(fixture = {}) {
  const academyId = String(fixture.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  await Promise.all(
    (Array.isArray(fixture.packageIds) ? fixture.packageIds : []).map((id) =>
      deleteKnownAcademyDoc(getDb(), 'studentPackages', id, academyId)
    )
  );
  await Promise.all(
    (Array.isArray(fixture.lessonIds) ? fixture.lessonIds : []).map((id) =>
      deleteKnownAcademyDoc(getDb(), 'lessons', id, academyId)
    )
  );
  await Promise.all(
    (Array.isArray(fixture.reservationIds) ? fixture.reservationIds : []).map((id) =>
      deleteKnownAcademyDoc(getDb(), 'privateLessonReservations', id, academyId)
    )
  );
  if (fixture.studentId) {
    await deleteKnownAcademyDoc(getDb(), 'privateStudents', fixture.studentId, academyId);
  }
}

export async function createAdminSeededPrivateLessonEditFixture(params = {}) {
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const unique = String(params.unique || Date.now()).trim();
  const studentName = String(params.studentName || `E2E 개인수정 ${unique}`).trim();
  const teacher = String(
    params.teacher || params.teacherName || `E2E 개인수정 선생 ${unique}`
  ).trim();
  const date = String(params.date || '').trim();
  const time = String(params.time || '11:30').trim();
  const subject = String(params.subject || `E2E 개인수정 과목 ${unique}`).trim();
  if (!date) throw new Error('date is required for private lesson edit fixture.');

  let fixture = null;
  try {
    const student = await createAdminSeededPrivateStudent({
      academyId,
      name: studentName,
      studentName,
      teacher,
      teacherName: teacher,
      status: 'active',
      paidLessons: 8,
      attendanceCount: 0,
      note: 'E2E private lesson edit fixture',
    });
    fixture = { academyId, studentId: student.studentId };

    const studentPackage = await createAdminSeededStudentPackage({
      academyId,
      studentId: student.studentId,
      studentName,
      packageType: 'private',
      teacher,
      teacherName: teacher,
      totalCount: 8,
      usedCount: 0,
      remainingCount: 8,
      status: 'active',
      title: `E2E private edit package ${unique}`,
    });
    fixture.packageId = studentPackage.packageId;

    const lesson = await createAdminSeededPrivateLesson({
      academyId,
      studentId: student.studentId,
      studentID: student.studentId,
      studentName,
      student: studentName,
      teacher,
      teacherName: teacher,
      date,
      time,
      subject,
      packageId: studentPackage.packageId,
      sessionNumber: 1,
      counted: false,
      completed: false,
    });
    fixture.lessonId = lesson.lessonId;

    return {
      ...fixture,
      studentName,
      teacher,
      date,
      time,
      subject,
    };
  } catch (error) {
    if (fixture) {
      await cleanupAdminSeededPrivateLessonEditFixture(fixture).catch(() => {});
    }
    throw error;
  }
}

export async function cleanupAdminSeededPrivateLessonEditFixture(fixture = {}) {
  const db = getDb();
  const academyId = String(fixture.academyId || DEFAULT_E2E_ACADEMY_ID).trim();

  await deleteKnownAcademyDoc(db, 'lessons', fixture.lessonId, academyId);
  await deleteKnownAcademyDoc(db, 'studentPackages', fixture.packageId, academyId);
  await deleteKnownAcademyDoc(db, 'privateStudents', fixture.studentId, academyId);
}

export async function createAdminSeededCalendarGroupLessonSetup(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupClassRef = params.groupClassId
    ? db.collection('groupClasses').doc(String(params.groupClassId))
    : db.collection('groupClasses').doc();
  const groupLessonRef = params.groupLessonId
    ? db.collection('groupLessons').doc(String(params.groupLessonId))
    : db.collection('groupLessons').doc();
  const now = timestampNow();
  const groupName = String(params.groupName || `E2E 캘린더 그룹 ${Date.now()}`).trim();
  const teacher = String(params.teacher || params.teacherName || 'teacher').trim().toLowerCase();
  const lessonDate = String(params.lessonDate || '').trim();
  const lessonTime = String(params.lessonTime || '09:00').trim();
  const lessonSubject = String(params.lessonSubject || `E2E 그룹 과목 ${Date.now()}`).trim();
  const skipPastAttendanceSync = params.skipPastAttendanceSync === true;
  const maxStudents =
    Number.isInteger(Number(params.maxStudents)) && Number(params.maxStudents) > 0
      ? Number(params.maxStudents)
      : 8;
  const weekdays = Array.isArray(params.weekdays) && params.weekdays.length > 0
    ? params.weekdays.map((value) => Number(value)).filter((value) => Number.isInteger(value))
    : [3];

  if (!lessonDate) throw new Error('lessonDate is required for calendar group lesson setup.');

  await groupClassRef.set({
    academyId,
    name: groupName,
    teacher,
    teacherName: teacher,
    status: String(params.status || 'active').trim(),
    maxStudents,
    time: lessonTime,
    subject: lessonSubject,
    groupCourseType: String(params.groupCourseType || 'general_conversation').trim(),
    weekdays,
    recurrenceMode: 'fixedWeekdays',
    createdAt: now,
    updatedAt: now,
  });

  await groupLessonRef.set({
    academyId,
    groupClassId: groupClassRef.id,
    groupClassID: groupClassRef.id,
    groupClassName: groupName,
    teacher,
    teacherName: teacher,
    date: lessonDate,
    time: lessonTime,
    subject: lessonSubject,
    groupCourseType: String(params.groupCourseType || 'general_conversation').trim(),
    completed: false,
    countedStudentIDs: skipPastAttendanceSync ? [`__e2e_sync_guard_${groupLessonRef.id}`] : [],
    attendanceAppliedAt: skipPastAttendanceSync ? now : null,
    bookingMode: 'fixed',
    capacity: maxStudents,
    bookedCount: 0,
    isBookable: false,
    generationKind: 'manual',
    createdAt: now,
    updatedAt: now,
  });

  return {
    academyId,
    groupClassId: groupClassRef.id,
    groupLessonId: groupLessonRef.id,
    groupName,
    lessonDate,
    lessonTime,
    lessonSubject,
  };
}

export async function cleanupAdminSeededCalendarGroupLessonSetup(fixture = {}) {
  const db = getDb();
  const academyId = String(fixture.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupClassId = String(fixture.groupClassId || '').trim();
  const explicitLessonIds = new Set(
    Array.isArray(fixture.groupLessonIds)
      ? fixture.groupLessonIds.map((lessonId) => String(lessonId || '').trim()).filter(Boolean)
      : []
  );

  if (fixture.groupLessonId) explicitLessonIds.add(String(fixture.groupLessonId));

  if (groupClassId) {
    const [byGroupClassId, byGroupClassID] = await Promise.all([
      db
        .collection('groupLessons')
        .where('academyId', '==', academyId)
        .where('groupClassId', '==', groupClassId)
        .get(),
      db
        .collection('groupLessons')
        .where('academyId', '==', academyId)
        .where('groupClassID', '==', groupClassId)
        .get(),
    ]);
    for (const snap of [byGroupClassId, byGroupClassID]) {
      snap.docs.forEach((docSnap) => explicitLessonIds.add(docSnap.id));
    }
  }

  for (const lessonId of explicitLessonIds) {
    await deleteKnownAcademyDoc(db, 'groupLessons', lessonId, academyId);
  }
  await deleteKnownAcademyDoc(db, 'groupClasses', groupClassId, academyId);
}

export async function cleanupAdminGroupClassByName(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupName = String(params.groupName || '').trim();
  if (!groupName) return;
  if (!groupName.startsWith('E2E 그룹 ')) {
    throw new Error(`Refusing to cleanup non-E2E group by name: ${groupName}`);
  }

  const groupSnap = await db
    .collection('groupClasses')
    .where('academyId', '==', academyId)
    .where('name', '==', groupName)
    .get();

  const groupClassIds = new Set(groupSnap.docs.map((docSnap) => docSnap.id));
  const lessonRefs = new Map();

  const byNameSnap = await db
    .collection('groupLessons')
    .where('academyId', '==', academyId)
    .where('groupClassName', '==', groupName)
    .get();
  byNameSnap.docs.forEach((docSnap) => lessonRefs.set(docSnap.id, docSnap.ref));

  for (const groupClassId of groupClassIds) {
    const [byGroupClassId, byGroupClassID] = await Promise.all([
      db
        .collection('groupLessons')
        .where('academyId', '==', academyId)
        .where('groupClassId', '==', groupClassId)
        .get(),
      db
        .collection('groupLessons')
        .where('academyId', '==', academyId)
        .where('groupClassID', '==', groupClassId)
        .get(),
    ]);
    byGroupClassId.docs.forEach((docSnap) => lessonRefs.set(docSnap.id, docSnap.ref));
    byGroupClassID.docs.forEach((docSnap) => lessonRefs.set(docSnap.id, docSnap.ref));
  }

  await Promise.all(Array.from(lessonRefs.values()).map((ref) => ref.delete()));
  await Promise.all(groupSnap.docs.map((docSnap) => docSnap.ref.delete()));
}

export async function getAdminGroupClassByName(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupName = String(params.groupName || '').trim();
  if (!groupName) return null;

  const snap = await db
    .collection('groupClasses')
    .where('academyId', '==', academyId)
    .where('name', '==', groupName)
    .limit(1)
    .get();
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  return {
    id: docSnap.id,
    ...(docSnap.data() || {}),
  };
}

export async function getAdminGroupLessonByFields(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupClassId = String(params.groupClassId || '').trim();
  const date = String(params.date || '').trim();
  const time = String(params.time || '').trim();
  const subject = String(params.subject || '').trim();
  if (!groupClassId || !date || !time || !subject) return null;

  const snap = await db
    .collection('groupLessons')
    .where('academyId', '==', academyId)
    .where('groupClassId', '==', groupClassId)
    .where('date', '==', date)
    .where('time', '==', time)
    .where('subject', '==', subject)
    .limit(1)
    .get();
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  return {
    id: docSnap.id,
    ...(docSnap.data() || {}),
  };
}

export async function getAdminGroupPackageStartDate(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupClassId = String(params.groupClassId || '').trim();
  const groupName = String(params.groupName || '').trim();
  let scopedGroupClassId = groupClassId;

  if (!scopedGroupClassId && groupName) {
    const groupSnap = await db
      .collection('groupClasses')
      .where('academyId', '==', academyId)
      .where('name', '==', groupName)
      .limit(1)
      .get();
    scopedGroupClassId = groupSnap.docs[0]?.id || '';
  }

  if (!scopedGroupClassId) {
    throw new Error(`Group class not found for package start date: ${groupName || '(missing)'}`);
  }

  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const lessonSnap = await db
    .collection('groupLessons')
    .where('academyId', '==', academyId)
    .where('groupClassId', '==', scopedGroupClassId)
    .get();

  const startDate = lessonSnap.docs
    .map((docSnap) => String((docSnap.data() || {}).date || '').trim())
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayYmd)
    .sort()[0];

  if (!startDate) {
    throw new Error(`No future lessons found for group class: ${scopedGroupClassId}`);
  }
  return startDate;
}

export async function getAdminGroupLessonIdsInRange(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupClassId = String(params.groupClassId || '').trim();
  const startDate = String(params.startDate || '').trim();
  const endDate = String(params.endDate || '').trim();
  if (!groupClassId || !startDate || !endDate) return [];

  const snap = await db
    .collection('groupLessons')
    .where('academyId', '==', academyId)
    .where('groupClassId', '==', groupClassId)
    .get();

  return snap.docs
    .filter((docSnap) => {
      const date = String((docSnap.data() || {}).date || '').trim();
      return date >= startDate && date <= endDate;
    })
    .map((docSnap) => docSnap.id)
    .sort();
}

export async function cleanupAdminGroupLessonById(params = {}) {
  await deleteKnownAcademyDoc(
    getDb(),
    'groupLessons',
    String(params.lessonId || '').trim(),
    String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim()
  );
}

export async function getAdminSeededCalendarGroupLessonState(fixture = {}) {
  const db = getDb();
  const academyId = String(fixture.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const groupClassId = String(fixture.groupClassId || '').trim();
  const groupLessonId = String(fixture.groupLessonId || '').trim();

  async function readKnownDoc(collectionName, docId) {
    if (!docId) return { exists: false };
    const snap = await db.collection(collectionName).doc(docId).get();
    const data = snap.exists ? snap.data() || {} : {};
    return {
      exists: snap.exists,
      id: docId,
      academyId: data.academyId || '',
      groupClassId: data.groupClassId || data.groupClassID || '',
      groupClassName: data.groupClassName || data.name || '',
      date: data.date || '',
      time: data.time || '',
      subject: data.subject || '',
      teacher: data.teacher || data.teacherName || '',
      groupCourseType: data.groupCourseType || '',
      belongsToAcademy: String(data.academyId || '').trim() === academyId,
    };
  }

  const [groupClass, groupLesson] = await Promise.all([
    readKnownDoc('groupClasses', groupClassId),
    readKnownDoc('groupLessons', groupLessonId),
  ]);

  return {
    academyId,
    groupClass,
    groupLesson,
  };
}

export async function cleanupAdminTempGroupStudentAddSetup(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const packageId = String(params.packageId || '').trim();
  const groupClassId = String(params.groupClassId || '').trim();
  const studentId = String(params.tempStudentId || params.studentId || '').trim();

  if (studentId && groupClassId) {
    const snap = await db
      .collection('groupStudents')
      .where('academyId', '==', academyId)
      .where('studentId', '==', studentId)
      .where('groupClassId', '==', groupClassId)
      .get();

    await Promise.all(
      snap.docs
        .filter((docSnap) => {
          const data = docSnap.data() || {};
          if (String(data.academyId || '').trim() !== academyId) return false;
          if (String(data.studentId || '').trim() !== studentId) return false;
          if (String(data.groupClassId || '').trim() !== groupClassId) return false;
          if (packageId && String(data.packageId || '').trim() !== packageId) return false;
          return true;
        })
        .map((docSnap) => docSnap.ref.delete())
    );
  }

  if (packageId) {
    const packageRef = db.collection('studentPackages').doc(packageId);
    const packageSnap = await packageRef.get();
    if (packageSnap.exists) {
      const data = packageSnap.data() || {};
      if (String(data.academyId || '').trim() !== academyId) {
        throw new Error(`Refusing to delete studentPackages/${packageId}: academyId mismatch.`);
      }
      if (studentId && String(data.studentId || '').trim() !== studentId) {
        throw new Error(`Refusing to delete studentPackages/${packageId}: studentId mismatch.`);
      }
      if (groupClassId && String(data.groupClassId || '').trim() !== groupClassId) {
        throw new Error(`Refusing to delete studentPackages/${packageId}: groupClassId mismatch.`);
      }
      await packageRef.delete();
    }
  }
}

export async function getAdminLessonsForStudentTeacher(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const studentId = String(params.studentId || '').trim();
  const teacher = String(params.teacher || '').trim();
  if (!studentId) throw new Error('studentId is required.');
  if (!teacher) throw new Error('teacher is required.');

  const snap = await db.collection('lessons').where('academyId', '==', academyId).get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((lesson) => {
      const lessonStudentId = String(lesson.studentId || lesson.studentID || '').trim();
      const lessonTeacher = String(lesson.teacher || lesson.teacherName || '').trim();
      return lessonStudentId === studentId && lessonTeacher === teacher;
    })
    .sort((a, b) => {
      const aKey = `${String(a.date || '')} ${String(a.time || '')} ${a.id}`;
      const bKey = `${String(b.date || '')} ${String(b.time || '')} ${b.id}`;
      return aKey.localeCompare(bKey);
    })
    .map((lesson) => ({
      id: lesson.id,
      date: String(lesson.date || ''),
      time: String(lesson.time || ''),
      subject: String(lesson.subject || ''),
      studentId: String(lesson.studentId || ''),
      studentID: String(lesson.studentID || ''),
      studentName: String(lesson.studentName || ''),
      teacher: String(lesson.teacher || ''),
      packageId: String(lesson.packageId || ''),
      sessionNumber: lesson.sessionNumber || null,
      isDeductCancelled: lesson.isDeductCancelled === true,
    }));
}
