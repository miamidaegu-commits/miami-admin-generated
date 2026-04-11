import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from './firebase'

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatLegacyDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatLegacyTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export async function createLesson({
  studentId,
  studentName,
  teacherName,
  subject,
  startDate,
  seriesID = null,
}) {
  const payload = {
    studentId,
    studentName,
    teacherName,
    startAt: Timestamp.fromDate(startDate),
    student: studentName,
    teacher: teacherName,
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