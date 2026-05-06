import { arrayRemove, arrayUnion, doc, serverTimestamp } from 'firebase/firestore'
import { buildStudentGroupAccessSummaryId } from './bookingModel.js'

export function buildStudentGroupAccessSummaryRef(db, { academyId, studentId }) {
  return doc(
    db,
    'studentGroupAccessSummary',
    buildStudentGroupAccessSummaryId({ academyId, studentId })
  )
}

export function addStudentGroupClassAccessBatch(batch, db, { academyId, studentId, groupClassId }) {
  const summaryRef = buildStudentGroupAccessSummaryRef(db, { academyId, studentId })
  batch.set(
    summaryRef,
    {
      academyId: String(academyId || '').trim(),
      studentId: String(studentId || '').trim(),
      groupClassIds: arrayUnion(String(groupClassId || '').trim()),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
  return summaryRef
}

export function removeStudentGroupClassAccessBatch(batch, db, { academyId, studentId, groupClassId }) {
  const summaryRef = buildStudentGroupAccessSummaryRef(db, { academyId, studentId })
  batch.set(
    summaryRef,
    {
      academyId: String(academyId || '').trim(),
      studentId: String(studentId || '').trim(),
      groupClassIds: arrayRemove(String(groupClassId || '').trim()),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
  return summaryRef
}
