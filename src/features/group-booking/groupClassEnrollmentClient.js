import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import {
  buildStudentGroupAccessPayloadFromGroupStudent,
  setStudentGroupAccessBatch,
} from './studentGroupAccessClient.js'

function parseYmdToTimestamp(ymd) {
  const dateStr = String(ymd || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('등록 시작일 형식이 올바르지 않습니다.')
  }
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    throw new Error('유효한 등록 시작일을 선택해주세요.')
  }
  return Timestamp.fromDate(date)
}

export async function enrollStudentInGroupClassFromPackage({
  db,
  academyId,
  studentId,
  studentName,
  teacher,
  groupClassId,
  packageId,
  packageType = 'group',
  startDateYmd,
  paidLessons = 0,
  attendanceCount = 0,
  endPreviousActiveEnrollments = true,
}) {
  const scopedAcademyId = String(academyId || '').trim()
  const scopedStudentId = String(studentId || '').trim()
  const scopedGroupClassId = String(groupClassId || '').trim()
  const scopedPackageId = String(packageId || '').trim()
  const teacherNorm = String(teacher || '').trim()

  if (!scopedAcademyId) throw new Error('academyId is required.')
  if (!scopedStudentId) throw new Error('studentId is required.')
  if (!scopedGroupClassId) throw new Error('groupClassId is required.')
  if (!scopedPackageId) throw new Error('packageId is required.')

  const startTimestamp = parseYmdToTimestamp(startDateYmd)
  const snap = await getDocs(
    query(
      collection(db, 'groupStudents'),
      where('academyId', '==', scopedAcademyId),
      where('studentId', '==', scopedStudentId)
    )
  )

  const batch = writeBatch(db)
  const existingActive = snap.docs.find((docItem) => {
    const row = docItem.data() || {}
    return (
      String(row.groupClassId || row.classID || '').trim() === scopedGroupClassId &&
      String(row.status || 'active').trim() === 'active' &&
      String(row.packageId || '').trim() === scopedPackageId
    )
  })

  if (endPreviousActiveEnrollments) {
    snap.forEach((docItem) => {
      const row = docItem.data() || {}
      if (String(row.groupClassId || row.classID || '').trim() !== scopedGroupClassId) return
      if (String(row.status || 'active').trim() !== 'active') return
      if (existingActive && docItem.id === existingActive.id) return
      batch.update(doc(db, 'groupStudents', docItem.id), {
        status: 'inactive',
        updatedAt: serverTimestamp(),
      })
      setStudentGroupAccessBatch(
        batch,
        db,
        buildStudentGroupAccessPayloadFromGroupStudent(
          { id: docItem.id, ...row },
          { status: 'inactive' }
        )
      )
    })
  }

  if (existingActive) {
    batch.update(doc(db, 'groupStudents', existingActive.id), {
      studentName: String(studentName || '').trim() || '-',
      name: String(studentName || '').trim() || '-',
      teacher: teacherNorm,
      packageId: scopedPackageId,
      packageType: String(packageType || 'group').trim(),
      paidLessons: Number(paidLessons || 0),
      attendanceCount: Number(attendanceCount || 0),
      startDate: startTimestamp,
      status: 'active',
      studentStatus: 'active',
      updatedAt: serverTimestamp(),
    })
    setStudentGroupAccessBatch(
      batch,
      db,
      buildStudentGroupAccessPayloadFromGroupStudent(
        {
          id: existingActive.id,
          ...existingActive.data(),
          studentId: scopedStudentId,
          groupClassId: scopedGroupClassId,
          packageId: scopedPackageId,
          status: 'active',
          studentStatus: 'active',
        },
        { groupStudentId: existingActive.id }
      )
    )
    await batch.commit()
    return { groupStudentId: existingActive.id, created: false }
  }

  const newGroupStudentRef = doc(collection(db, 'groupStudents'))
  const newGroupStudentPayload = {
    academyId: scopedAcademyId,
    groupClassId: scopedGroupClassId,
    classID: scopedGroupClassId,
    studentId: scopedStudentId,
    studentName: String(studentName || '').trim() || '-',
    name: String(studentName || '').trim() || '-',
    teacher: teacherNorm,
    packageId: scopedPackageId,
    packageType: String(packageType || 'group').trim(),
    paidLessons: Number(paidLessons || 0),
    attendanceCount: Number(attendanceCount || 0),
    startDate: startTimestamp,
    status: 'active',
    studentStatus: 'active',
    excludedDates: [],
    breakStartDate: '',
    breakEndDate: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  batch.set(newGroupStudentRef, newGroupStudentPayload)
  setStudentGroupAccessBatch(
    batch,
    db,
    buildStudentGroupAccessPayloadFromGroupStudent(
      { id: newGroupStudentRef.id, ...newGroupStudentPayload },
      { groupStudentId: newGroupStudentRef.id }
    )
  )
  await batch.commit()
  return { groupStudentId: newGroupStudentRef.id, created: true }
}
