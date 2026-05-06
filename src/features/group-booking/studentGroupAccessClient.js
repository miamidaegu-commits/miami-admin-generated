import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import {
  buildStudentGroupAccessDoc,
  buildStudentGroupAccessId,
} from './bookingModel.js'
import {
  addStudentGroupClassAccessBatch,
  removeStudentGroupClassAccessBatch,
} from './studentGroupAccessSummaryClient.js'

export function buildStudentGroupAccessRef(db, { academyId, groupClassId, studentId }) {
  return doc(
    db,
    'studentGroupAccess',
    buildStudentGroupAccessId({ academyId, groupClassId, studentId })
  )
}

export function buildStudentGroupAccessPayloadFromGroupStudent(groupStudent, overrides = {}) {
  return {
    academyId: String(overrides.academyId ?? groupStudent?.academyId ?? '').trim(),
    groupClassId: String(
      overrides.groupClassId ?? groupStudent?.groupClassId ?? groupStudent?.classID ?? ''
    ).trim(),
    groupStudentId: String(overrides.groupStudentId ?? groupStudent?.id ?? '').trim(),
    studentId: String(overrides.studentId ?? groupStudent?.studentId ?? '').trim(),
    packageId: String(overrides.packageId ?? groupStudent?.packageId ?? '').trim(),
    status: overrides.status ?? groupStudent?.status,
    studentStatus: overrides.studentStatus ?? groupStudent?.studentStatus,
  }
}

function shouldIncludeInStudentSummary(payload) {
  const data = buildStudentGroupAccessDoc(payload)
  return data.status === 'active' && data.studentStatus === 'active'
}

function syncStudentGroupAccessSummaryBatch(batch, db, payload) {
  if (shouldIncludeInStudentSummary(payload)) {
    addStudentGroupClassAccessBatch(batch, db, payload)
    return
  }
  removeStudentGroupClassAccessBatch(batch, db, payload)
}

export function setStudentGroupAccessBatch(batch, db, payload, options = {}) {
  const accessRef = buildStudentGroupAccessRef(db, payload)
  const data = buildStudentGroupAccessDoc(payload)
  const accessDoc = {
    ...data,
    updatedAt: serverTimestamp(),
  }
  if (options.preserveCreatedAt !== true) {
    accessDoc.createdAt = serverTimestamp()
  }

  batch.set(accessRef, accessDoc, { merge: true })
  syncStudentGroupAccessSummaryBatch(batch, db, data)

  return accessRef
}

export function updateStudentGroupAccessBatch(batch, db, payload) {
  const accessRef = buildStudentGroupAccessRef(db, payload)
  const data = buildStudentGroupAccessDoc(payload)
  batch.set(
    accessRef,
    {
      ...data,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
  syncStudentGroupAccessSummaryBatch(batch, db, data)
  return accessRef
}

export function deleteStudentGroupAccessBatch(batch, db, payload) {
  const accessRef = buildStudentGroupAccessRef(db, payload)
  batch.delete(accessRef)
  removeStudentGroupClassAccessBatch(batch, db, buildStudentGroupAccessDoc(payload))
  return accessRef
}

export async function writeStudentGroupAccess(db, payload) {
  const batch = writeBatch(db)
  updateStudentGroupAccessBatch(batch, db, payload)
  await batch.commit()
}
