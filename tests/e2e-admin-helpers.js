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
    teacher,
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

export async function createAdminSeededStudentPackage(params = {}) {
  const db = getDb();
  const academyId = String(params.academyId || DEFAULT_E2E_ACADEMY_ID).trim();
  const packageRef = params.packageId
    ? db.collection('studentPackages').doc(String(params.packageId))
    : db.collection('studentPackages').doc();
  const now = timestampNow();
  const packageType = String(params.packageType || 'private').trim();
  const teacher = String(params.teacher || params.teacherName || 'teacher').trim();
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
    totalCount,
    usedCount,
    remainingCount,
    status: String(params.status || 'active').trim(),
    startDate: String(params.startDate || '').trim(),
    expiresAt: String(params.expiresAt || '2099-01-01').trim(),
    createdAt: now,
    updatedAt: now,
  });

  return {
    packageId: packageRef.id,
    studentId: String(params.studentId || '').trim(),
    teacher,
  };
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

  await requestRef.set({
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
    createdAt: timestampNow(),
    rejectionReason: '',
    seriesID: String(params.seriesID || ''),
  });

  return {
    requestId: requestRef.id,
    studentId,
    studentName,
    teacherName,
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
    completed: params.completed === true,
    isDeductCancelled: params.isDeductCancelled === true,
    deductMemo: String(params.deductMemo || ''),
    sessionNumber:
      Number.isInteger(Number(params.sessionNumber)) && Number(params.sessionNumber) > 0
        ? Number(params.sessionNumber)
        : null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    lessonId: lessonRef.id,
    studentId,
    studentName,
    teacher,
  };
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
      sessionNumber: lesson.sessionNumber || null,
      isDeductCancelled: lesson.isDeductCancelled === true,
    }));
}
