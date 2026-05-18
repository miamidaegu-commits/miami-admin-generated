import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { buildStudentGroupAccessSummaryId } from './bookingModel.js'
import { normalizeGroupCourseType } from './groupCourseTypes.js'

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

function isActiveGroupPackageWithCourseType(pkg) {
  const packageType = String(pkg?.packageType || '').trim()
  if (packageType !== 'group' && packageType !== 'openGroup') return false
  const status = String(pkg?.status ?? 'active').trim().toLowerCase()
  if (status !== 'active') return false
  return Boolean(normalizeGroupCourseType(pkg?.groupCourseType))
}

export async function syncStudentGroupCourseTypeAccessSummary(db, { academyId, studentId }) {
  const scopedAcademyId = String(academyId || '').trim()
  const scopedStudentId = String(studentId || '').trim()
  if (!scopedAcademyId || !scopedStudentId) return []

  const packagesSnap = await getDocs(
    query(
      collection(db, 'studentPackages'),
      where('academyId', '==', scopedAcademyId),
      where('studentId', '==', scopedStudentId)
    )
  )
  const courseTypes = new Set()
  packagesSnap.docs.forEach((docSnap) => {
    const pkg = docSnap.data()
    if (!isActiveGroupPackageWithCourseType(pkg)) return
    courseTypes.add(normalizeGroupCourseType(pkg.groupCourseType))
  })

  const summaryRef = buildStudentGroupAccessSummaryRef(db, {
    academyId: scopedAcademyId,
    studentId: scopedStudentId,
  })
  const payload = {
    academyId: scopedAcademyId,
    studentId: scopedStudentId,
    groupCourseTypes: Array.from(courseTypes.values()),
    updatedAt: serverTimestamp(),
  }
  await setDoc(summaryRef, payload, { merge: true })
  return payload.groupCourseTypes
}
