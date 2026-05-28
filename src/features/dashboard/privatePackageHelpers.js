import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { normalizeText } from './dashboardViewUtils.js'

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeTeacherKey(value) {
  return normalizeText(value || '')
}

function normalizePackageStatus(pkg) {
  return normalizeId(pkg?.status || 'active').toLowerCase()
}

function uniqueTeacherKeys(...values) {
  const keys = new Set()
  values.flat().forEach((value) => {
    const key = normalizeTeacherKey(value)
    if (key) keys.add(key)
  })
  return Array.from(keys.values())
}

function getPackageTeacherKeys(pkg) {
  return uniqueTeacherKeys(
    pkg?.teacher,
    pkg?.teacherName,
    pkg?.teacherKey,
    pkg?.teacherUid
  )
}

function teacherValuesMatch(pkg, teacherValues) {
  const packageKeys = getPackageTeacherKeys(pkg)
  const requestedKeys = uniqueTeacherKeys(teacherValues)
  if (requestedKeys.length === 0) return false
  return requestedKeys.some((key) => packageKeys.includes(key))
}

export function isActivePrivatePackageForTeacher({
  pkg,
  academyId,
  studentId,
  teacher,
  teacherKey,
  teacherUid,
  requireRemaining = false,
}) {
  if (!pkg) return false
  const packageType = normalizeId(pkg.packageType || 'private')
  if (packageType && packageType !== 'private') return false
  if (normalizeId(pkg.academyId) !== normalizeId(academyId)) return false
  if (normalizeId(pkg.studentId) !== normalizeId(studentId)) return false
  if (!teacherValuesMatch(pkg, [teacher, teacherKey, teacherUid])) return false

  const status = normalizePackageStatus(pkg)
  if (['inactive', 'expired', 'ended', 'cancelled', 'canceled'].includes(status)) return false
  if (requireRemaining && Number(pkg.remainingCount ?? 0) <= 0) return false
  return true
}

export function findActivePrivatePackageForTeacher({
  studentPackages,
  academyId,
  studentId,
  teacher,
  teacherKey,
  teacherUid,
  requireRemaining = false,
}) {
  const candidates = (Array.isArray(studentPackages) ? studentPackages : [])
    .filter((pkg) =>
      isActivePrivatePackageForTeacher({
        pkg,
        academyId,
        studentId,
        teacher,
        teacherKey,
        teacherUid,
        requireRemaining,
      })
    )
    .sort((a, b) => {
      const ar = Number(a.remainingCount ?? 0)
      const br = Number(b.remainingCount ?? 0)
      if (ar !== br) return ar - br
      const at = a.createdAt?.toMillis?.() || Number(a.createdAt?.seconds || 0) * 1000 || 0
      const bt = b.createdAt?.toMillis?.() || Number(b.createdAt?.seconds || 0) * 1000 || 0
      return at - bt
    })

  return candidates.length === 1 ? candidates[0] : null
}

export async function fetchActivePrivatePackagesForTeacher({
  db,
  academyId,
  studentId,
  teacher,
  teacherKey,
  teacherUid,
  requireRemaining = false,
}) {
  const snap = await getDocs(
    query(
      collection(db, 'studentPackages'),
      where('academyId', '==', normalizeId(academyId)),
      where('studentId', '==', normalizeId(studentId))
    )
  )

  return snap.docs
    .map((docItem) => ({ id: docItem.id, ref: docItem.ref, ...docItem.data() }))
    .filter((pkg) =>
      isActivePrivatePackageForTeacher({
        pkg,
        academyId,
        studentId,
        teacher,
        teacherKey,
        teacherUid,
        requireRemaining,
      })
    )
}

function toCount(value) {
  const count = Number(value ?? 0)
  return Number.isFinite(count) ? count : 0
}

function getRowDate(row) {
  return normalizeId(row?.date || row?.lessonDate || row?.scheduleDate)
}

function getKstTodayString(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function getKstDateTimeMillis(dateValue, timeValue) {
  const date = normalizeId(dateValue)
  const time = normalizeId(timeValue || '23:59')
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!dateMatch || !timeMatch) return null
  return Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]) - 9,
    Number(timeMatch[2]),
    0,
    0
  )
}

function getRowStartMillis(row) {
  const value = row?.startAt
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  if (value && typeof value.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return getKstDateTimeMillis(getRowDate(row), row?.time || row?.startTime || row?.scheduleTime)
}

function isFutureAllocation(row, now) {
  const startMillis = getRowStartMillis(row)
  if (startMillis !== null && Number.isFinite(startMillis)) return startMillis >= now
  const date = getRowDate(row)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getKstTodayString(now)
}

function isNoDeductionPrivateLesson(row) {
  const status = normalizeId(row?.status).toLowerCase()
  const cancellationType = normalizeId(row?.cancellationType).toLowerCase()
  const cancelledReason = normalizeId(row?.cancelledReason).toLowerCase()
  if (row?.isDeductCancelled === true || row?.noDeduction === true) return true
  if (status === 'cancelled' || status === 'canceled') return true
  if (cancellationType === 'no_deduction' || cancellationType === 'class_closure') return true
  return ['holiday', 'teacher_unavailable', 'academy_closed'].includes(cancelledReason)
}

function rowMatchesPackageScope({
  row,
  privatePackage,
  academyId,
  studentId,
  teacher,
  teacherKey,
  teacherUid,
  packageIdFields = ['packageId'],
}) {
  if (normalizeId(row?.academyId) !== normalizeId(academyId)) return false
  const rowStudentId = normalizeId(row?.studentId || row?.studentID)
  if (rowStudentId !== normalizeId(studentId)) return false
  const packageId = normalizeId(privatePackage?.id)
  const rowPackageIds = packageIdFields.map((key) => normalizeId(row?.[key])).filter(Boolean)
  if (rowPackageIds.length > 0) return rowPackageIds.includes(packageId)
  return teacherValuesMatch(privatePackage, [
    teacher,
    teacherKey,
    teacherUid,
    row?.teacher,
    row?.teacherName,
    row?.teacherKey,
    row?.teacherUid,
  ])
}

export function computePrivateTeacherPackageUsage({
  privatePackage,
  package: packageAlias,
  privateLessons = [],
  privateReservations = [],
  teacher,
  teacherKey,
  teacherUid,
  studentId,
  academyId,
  now = Date.now(),
}) {
  const pkg = privatePackage || packageAlias
  if (!pkg) {
    return {
      totalCount: 0,
      usedDeductedCount: 0,
      futureFixedAllocatedCount: 0,
      activeFutureReservationAllocatedCount: 0,
      noDeductionReleasedCount: 0,
      makeupAvailableCount: 0,
      remainingCount: 0,
    }
  }

  const totalCount = Math.max(0, toCount(pkg.totalCount))
  const usedDeductedCount = Math.max(0, toCount(pkg.usedCount))
  const remainingCount = Math.max(0, toCount(pkg.remainingCount))
  const rawAvailableCount =
    totalCount > 0 ? Math.min(remainingCount, Math.max(0, totalCount - usedDeductedCount)) : remainingCount

  let futureFixedAllocatedCount = 0
  let noDeductionReleasedCount = 0
  ;(Array.isArray(privateLessons) ? privateLessons : []).forEach((lesson) => {
    if (
      !rowMatchesPackageScope({
        row: lesson,
        privatePackage: pkg,
        academyId,
        studentId,
        teacher,
        teacherKey,
        teacherUid,
      })
    ) {
      return
    }
    if (isNoDeductionPrivateLesson(lesson)) {
      noDeductionReleasedCount += 1
      return
    }
    if (isFutureAllocation(lesson, now)) futureFixedAllocatedCount += 1
  })

  let activeFutureReservationAllocatedCount = 0
  ;(Array.isArray(privateReservations) ? privateReservations : []).forEach((reservation) => {
    if (normalizeId(reservation?.status).toLowerCase() !== 'active') return
    if (
      !rowMatchesPackageScope({
        row: reservation,
        privatePackage: pkg,
        academyId,
        studentId,
        teacher,
        teacherKey,
        teacherUid,
        packageIdFields: ['packageId', 'deductionPackageId'],
      })
    ) {
      return
    }
    if (isFutureAllocation(reservation, now)) activeFutureReservationAllocatedCount += 1
  })

  const allocationAvailableCount =
    rawAvailableCount - futureFixedAllocatedCount - activeFutureReservationAllocatedCount
  const releasedAvailableCount = noDeductionReleasedCount - activeFutureReservationAllocatedCount
  const makeupAvailableCount = Math.max(
    0,
    allocationAvailableCount,
    releasedAvailableCount
  )

  return {
    totalCount,
    usedDeductedCount,
    futureFixedAllocatedCount,
    activeFutureReservationAllocatedCount,
    noDeductionReleasedCount,
    makeupAvailableCount,
    remainingCount,
  }
}

export function buildFixedPrivatePackagePayload({
  academyId,
  studentId,
  studentName,
  teacher,
  totalCount,
}) {
  const safeTotal = Math.max(0, Math.floor(Number(totalCount || 0)))
  return {
    academyId: normalizeId(academyId),
    studentId: normalizeId(studentId),
    studentName: normalizeId(studentName) || '-',
    teacher: normalizeText(teacher || ''),
    packageType: 'private',
    groupClassId: null,
    groupClassName: null,
    title: '고정 1:1',
    totalCount: safeTotal,
    usedCount: 0,
    remainingCount: safeTotal,
    status: safeTotal > 0 ? 'active' : 'exhausted',
    privatePackageMode: 'regular',
    sourceType: 'fixedPrivateLesson',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

export async function ensurePrivatePackageForFixedLessons({
  db,
  academyId,
  studentId,
  studentName,
  teacher,
  totalCount,
}) {
  const existing = await fetchActivePrivatePackagesForTeacher({
    db,
    academyId,
    studentId,
    teacher,
  })
  if (existing.length === 1) {
    return {
      created: false,
      packageRef: existing[0].ref,
      packageId: existing[0].id,
      packageData: existing[0],
    }
  }

  if (existing.length > 1) {
    throw new Error('같은 선생님의 활성 개인 수강권이 여러 개 있어 자동 연결할 수 없습니다.')
  }

  const packageRef = doc(collection(db, 'studentPackages'))
  return {
    created: true,
    packageRef,
    packageId: packageRef.id,
    packageData: buildFixedPrivatePackagePayload({
      academyId,
      studentId,
      studentName,
      teacher,
      totalCount,
    }),
  }
}
