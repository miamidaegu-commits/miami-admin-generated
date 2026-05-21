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

function normalizePackageStatus(pkg) {
  return normalizeId(pkg?.status || 'active').toLowerCase()
}

export function isActivePrivatePackageForTeacher({
  pkg,
  academyId,
  studentId,
  teacher,
  requireRemaining = false,
}) {
  if (!pkg) return false
  const packageType = normalizeId(pkg.packageType || 'private')
  if (packageType && packageType !== 'private') return false
  if (normalizeId(pkg.academyId) !== normalizeId(academyId)) return false
  if (normalizeId(pkg.studentId) !== normalizeId(studentId)) return false
  if (normalizeText(pkg.teacher || pkg.teacherName || '') !== normalizeText(teacher)) return false

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
  requireRemaining = false,
}) {
  const candidates = (Array.isArray(studentPackages) ? studentPackages : [])
    .filter((pkg) =>
      isActivePrivatePackageForTeacher({
        pkg,
        academyId,
        studentId,
        teacher,
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
        requireRemaining,
      })
    )
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
