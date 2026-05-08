import { arrayRemove, arrayUnion, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import {
  buildStudentPrivateAccessSummaryId,
  normalizePrivateTeacherKey,
} from './privateBookingModel.js'

export function buildStudentPrivateAccessSummaryRef(db, { academyId, studentId }) {
  return doc(
    db,
    'studentPrivateAccessSummary',
    buildStudentPrivateAccessSummaryId({ academyId, studentId })
  )
}

export function addStudentPrivateTeacherAccessBatch(
  batch,
  db,
  { academyId, studentId, teacher, packageId }
) {
  const summaryRef = buildStudentPrivateAccessSummaryRef(db, { academyId, studentId })
  batch.set(
    summaryRef,
    {
      academyId: String(academyId || '').trim(),
      studentId: String(studentId || '').trim(),
      teacherKeys: arrayUnion(normalizePrivateTeacherKey(teacher)),
      activePackageIds: arrayUnion(String(packageId || '').trim()),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
  return summaryRef
}

export function removeStudentPrivateTeacherAccessBatch(
  batch,
  db,
  { academyId, studentId, teacher, packageId, removeTeacher }
) {
  const summaryRef = buildStudentPrivateAccessSummaryRef(db, { academyId, studentId })
  const patch = {
    academyId: String(academyId || '').trim(),
    studentId: String(studentId || '').trim(),
    activePackageIds: arrayRemove(String(packageId || '').trim()),
    updatedAt: serverTimestamp(),
  }
  if (removeTeacher === true) {
    patch.teacherKeys = arrayRemove(normalizePrivateTeacherKey(teacher))
  }
  batch.set(summaryRef, patch, { merge: true })
  return summaryRef
}

export function addStudentPrivateSlotAccessBatch(batch, db, { academyId, studentId, slotId }) {
  const summaryRef = buildStudentPrivateAccessSummaryRef(db, { academyId, studentId })
  const normalizedSlotId = String(slotId || '').trim()
  batch.set(
    summaryRef,
    {
      academyId: String(academyId || '').trim(),
      studentId: String(studentId || '').trim(),
      allowedSlotIds: arrayUnion(normalizedSlotId),
      allowedPrivateLessonSlotIds: arrayUnion(normalizedSlotId),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
  return summaryRef
}

export function removeStudentPrivateSlotAccessBatch(batch, db, { academyId, studentId, slotId }) {
  const summaryRef = buildStudentPrivateAccessSummaryRef(db, { academyId, studentId })
  const normalizedSlotId = String(slotId || '').trim()
  batch.set(
    summaryRef,
    {
      academyId: String(academyId || '').trim(),
      studentId: String(studentId || '').trim(),
      allowedSlotIds: arrayRemove(normalizedSlotId),
      allowedPrivateLessonSlotIds: arrayRemove(normalizedSlotId),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
  return summaryRef
}

export function setStudentPrivateSlotBookingPilotEnabled(
  db,
  { academyId, studentId, enabled }
) {
  const summaryRef = buildStudentPrivateAccessSummaryRef(db, { academyId, studentId })
  return setDoc(
    summaryRef,
    {
      academyId: String(academyId || '').trim(),
      studentId: String(studentId || '').trim(),
      privateSlotBookingPilotEnabled: enabled === true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}
