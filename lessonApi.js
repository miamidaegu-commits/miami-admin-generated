import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { requireCurrentAcademyId } from './src/features/dashboard/academyScope.js'

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatLegacyDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatLegacyTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeTeacherName(value) {
  return String(value || '').trim().toLowerCase()
}

export async function createLesson({
  academyId,
  studentId,
  studentName,
  teacherName,
  subject,
  startDate,
  seriesID = null,
}) {
  const scopedAcademyId = requireCurrentAcademyId(academyId)
  const teacherKey = normalizeTeacherName(teacherName)
  const payload = {
    academyId: scopedAcademyId,
    studentId,
    studentName,
    teacherName: teacherKey,
    startAt: Timestamp.fromDate(startDate),
    student: studentName,
    teacher: teacherKey,
    date: formatLegacyDate(startDate),
    time: formatLegacyTime(startDate),
    subject: subject || '',
    seriesID,
    isDeductCancelled: false,
    deductMemo: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  return addDoc(collection(db, 'lessons'), payload)
}
