import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  serverTimestamp,
  Timestamp,
  and,
  updateDoc,
  where,
  or,
  writeBatch,
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { auth, db, functions as firebaseFunctions } from './firebase'
import { useAuth } from './AuthContext'
import { debugLog } from './src/utils/debugLog.js'
import {
  SCHOOL_TIME_ZONE,
  formatCreditTransactionActionTypeLabel,
  formatCreditTransactionCreatedAtDisplay,
  formatCreditTransactionDeltaCountDisplay,
  formatDate,
  formatLessonSessionNumber,
  formatGroupStudentStartDate,
  formatStudentPackageDetailAmountPaid,
  formatStudentPackageDetailMemo,
  formatStudentPackageDetailStatusLabel,
  formatStudentPackageDetailTypeLabel,
  formatTime,
  getCalendarDays,
  getLessonStorageDateString,
  getNextStudentPackageStatus,
  getStorageDateStringFromDate,
  getStudentName,
  getTeacherName,
  getGroupLessonGroupId,
  getGroupWeeklyClassCountFromWeekdaysDoc,
  getTodayStorageDateString,
  groupLessonNextSortKey,
  isActiveGroupClassRow,
  isClassClosureCancelledGroupLesson,
  isCancelledOrDeletedGroupLesson,
  isNoDeductionCancelledGroupLesson,
  isGroupStudentRowActive,
  isGroupStudentStartedByYmd,
  isSameStorageDate,
  iterateYmdRangeInclusive,
  jsDateToGroupWeekdayCode,
  lessonTimeInputValue,
  makeStudentKey,
  normalizeGroupWeekdaysFromDoc,
  normalizeText,
  parseLegacyLessonToDate,
  parseRequiredNonNegativeIntField,
  parseYmdToLocalDate,
  privateLessonNextSortKey,
  sanitizePhoneForTel,
} from './src/features/dashboard/dashboardViewUtils.js'
import CalendarSection from './src/features/dashboard/sections/CalendarSection.jsx'
import TodaySchedulePanel from './src/features/dashboard/components/TodaySchedulePanel.jsx'
import GroupsSection from './src/features/dashboard/sections/GroupsSection.jsx'
import PrivateLessonSlotsSection from './src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'
import LessonRequestsSection from './src/features/dashboard/sections/LessonRequestsSection.jsx'
import TeacherPrivateLessonRequestsSection from './src/features/dashboard/sections/TeacherPrivateLessonRequestsSection.jsx'
import StudentsSection from './src/features/dashboard/sections/StudentsSection.jsx'
import DailyMaterialsSection from './src/features/dashboard/sections/DailyMaterialsSection.jsx'
import TeacherManagementSection from './src/features/dashboard/sections/TeacherManagementSection.jsx'
import PostStudentCreateModal from './src/features/dashboard/modals/PostStudentCreateModal.jsx'
import StudentModal from './src/features/dashboard/modals/StudentModal.jsx'
import StudentPackageEditModal from './src/features/dashboard/modals/StudentPackageEditModal.jsx'
import StudentPackageHistoryModal from './src/features/dashboard/modals/StudentPackageHistoryModal.jsx'
import StudentPackageModal from './src/features/dashboard/modals/StudentPackageModal.jsx'
import PostGroupReEnrollModal from './src/features/dashboard/modals/PostGroupReEnrollModal.jsx'
import PostGroupScheduleRebuildModal from './src/features/dashboard/modals/PostGroupScheduleRebuildModal.jsx'
import PostPrivateLessonScheduleModal from './src/features/dashboard/modals/PostPrivateLessonScheduleModal.jsx'
import GroupModal from './src/features/dashboard/modals/GroupModal.jsx'
import GroupStudentAddModal from './src/features/dashboard/modals/GroupStudentAddModal.jsx'
import GroupStudentManageModal from './src/features/dashboard/modals/GroupStudentManageModal.jsx'
import GroupLessonModal from './src/features/dashboard/modals/GroupLessonModal.jsx'
import GroupLessonSeriesModal from './src/features/dashboard/modals/GroupLessonSeriesModal.jsx'
import GroupLessonPurgeModal from './src/features/dashboard/modals/GroupLessonPurgeModal.jsx'
import GroupLessonAttendanceModal from './src/features/dashboard/modals/GroupLessonAttendanceModal.jsx'
import PrivateLessonModal from './src/features/dashboard/modals/PrivateLessonModal.jsx'
import PrivateLessonEditModal from './src/features/dashboard/modals/PrivateLessonEditModal.jsx'
import useStudentsSectionViewModel from './src/features/dashboard/hooks/useStudentsSectionViewModel.js'
import useGroupsSectionViewModel from './src/features/dashboard/hooks/useGroupsSectionViewModel.js'
import useCalendarSectionViewModel from './src/features/dashboard/hooks/useCalendarSectionViewModel.js'
import useGroupScheduleRebuildFlow from './src/features/dashboard/hooks/useGroupScheduleRebuildFlow.js'
import useGroupLessonManagementFlow from './src/features/dashboard/hooks/useGroupLessonManagementFlow.js'
import useGroupAttendanceFlow from './src/features/dashboard/hooks/useGroupAttendanceFlow.js'
import useGroupReservationFlow from './src/features/dashboard/hooks/useGroupReservationFlow.js'
import useGroupManagementFlow from './src/features/dashboard/hooks/useGroupManagementFlow.js'
import useGroupStudentAddFlow from './src/features/dashboard/hooks/useGroupStudentAddFlow.js'
import useGroupStudentManagementFlow from './src/features/dashboard/hooks/useGroupStudentManagementFlow.js'
import usePrivateLessonFlow, {
  validatePrivateLessonFormFields as validatePrivateLessonFormFieldsShared,
} from './src/features/dashboard/hooks/usePrivateLessonFlow.js'
import useStudentManagementFlow from './src/features/dashboard/hooks/useStudentManagementFlow.js'
import useStudentPackageAdminFlow from './src/features/dashboard/hooks/useStudentPackageAdminFlow.js'
import useStudentPackageFlow from './src/features/dashboard/hooks/useStudentPackageFlow.js'
import { normalizeGroupCourseType } from './src/features/group-booking/groupCourseTypes.js'
import {
  assertSameAcademy,
  isValidOperationalAcademyId,
  requireCurrentAcademyId,
} from './src/features/dashboard/academyScope.js'
import {
  buildStudentGroupAccessPayloadFromGroupStudent,
  deleteStudentGroupAccessBatch,
} from './src/features/group-booking/studentGroupAccessClient.js'
import { buildPrivateLessonReservationId } from './src/features/private-booking/privateBookingModel.js'
import {
  addStudentPrivateSlotAccessBatch,
  removeStudentPrivateSlotAccessBatch,
} from './src/features/private-booking/studentPrivateAccessSummaryClient.js'
import {
  buildPrivateWeeklyBulkSlotPlan,
  normalizePrivateWeeklySlotWeekdays,
  parsePrivateWeeklySlotTimeList,
} from './src/features/booking/privateWeeklySlotBulk.js'
import {
  isTeacherBlockingScheduleRow,
  privateSchedulesOverlap,
} from './src/features/booking/privateScheduleOverlap.js'
import {
  computePrivateTeacherPackageUsage,
  findActivePrivatePackageForTeacher,
  isActivePrivatePackageForTeacher,
} from './src/features/dashboard/privatePackageHelpers.js'
import {
  canViewBillingFields,
  stripBillingFieldsForRestrictedViewer,
} from './src/features/dashboard/billingPermissions.js'

/** 운영 화면에서는 false 유지. 예전 수업 데이터 일괄 변환이 필요할 때만 true로 잠시 켜세요. */
const ENABLE_LEGACY_LESSON_MIGRATION_BUTTON = false

/** 운영에서는 false. groupClassId 백필 도구 버튼을 켤 때만 true. */
const ENABLE_GROUP_LEGACY_BACKFILL_TOOL = false

const GROUP_BACKFILL_BATCH_SIZE = 400
const TODAY_RESERVATION_QUERY_CHUNK_SIZE = 10
const RESERVATION_NOTIFICATION_EVENT_TYPES = [
  'private_slot_reserved',
  'private_slot_cancelled',
]
const PRIVATE_SLOT_MANAGEMENT_LABEL = '1:1 예약 시간 관리'
const ADMIN_GROUP_MANAGEMENT_LABEL = '단체반 관리'
const TEACHER_GROUP_MANAGEMENT_LABEL = '내 단체반 관리'
const TEACHER_PRIVATE_LESSON_REQUESTS_LABEL = '내 1:1 관리'

function isDashboardAdminProfile(profile) {
  return canViewBillingFields(profile)
}

function isDashboardTeacherProfile(profile) {
  return String(profile?.role || '').trim().toLowerCase() === 'teacher'
}

function getNotificationEventCreatedAtMillis(event) {
  const raw = event?.createdAt
  if (raw?.toMillis) return raw.toMillis()
  if (raw instanceof Date) return raw.getTime()
  const parsed = Date.parse(String(raw || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatReservationNotificationMessage(event) {
  const studentName = String(event?.studentName || '').trim() || '학생'
  const date = String(event?.date || '').trim() || '-'
  const time = String(event?.time || '').trim() || '-'
  if (event?.type === 'private_slot_cancelled') {
    return `${studentName} 학생이 ${date} ${time} 1:1 수업 예약을 취소했습니다.`
  }
  return `${studentName} 학생이 ${date} ${time} 1:1 수업을 예약했습니다.`
}

function getPrivateReservationStudentLabel(reservation, student = null) {
  return (
    String(reservation?.studentName || '').trim() ||
    String(student?.name || '').trim() ||
    String(reservation?.studentId || '').trim() ||
    '-'
  )
}

function getPrivateReservationTeacherLabel(reservation, slot = null) {
  return (
    String(reservation?.teacherName || '').trim() ||
    String(reservation?.teacher || '').trim() ||
    String(slot?.teacherName || '').trim() ||
    String(slot?.teacher || '').trim() ||
    '-'
  )
}

function getPrivateReservationSubjectLabel(reservation, slot = null) {
  return (
    String(reservation?.subject || '').trim() ||
    String(slot?.subject || '').trim() ||
    '1:1 수업'
  )
}

function ReservationNotificationsPanel({ events, loading }) {
  const rows = Array.isArray(events) ? events : []

  return (
    <section
      className="activity-section"
      data-testid="reservation-notifications-panel"
      style={{ marginBottom: 20 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          예약 알림
        </h2>
        <span style={{ fontSize: 12, opacity: 0.65 }}>최근 20개</span>
      </div>

      {loading ? (
        <p style={{ margin: 0, opacity: 0.72, fontSize: 14 }}>예약 알림을 불러오는 중입니다.</p>
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.72, fontSize: 14 }}>최근 예약 알림이 없습니다.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((event) => (
            <div
              key={event.id}
              data-testid="reservation-notification-row"
              style={{
                border: '1px solid #2e3240',
                borderRadius: 8,
                background: '#151922',
                padding: '10px 12px',
                color: '#f5f7fb',
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {formatReservationNotificationMessage(event)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const EMPTY_TEACHER_FORM = {
  id: '',
  name: '',
  teacherKey: '',
  status: 'active',
}

function chunkArray(values, size) {
  const out = []
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size))
  }
  return out
}

function isVisibleGroupLessonForActiveViews(lesson) {
  return !isClassClosureCancelledGroupLesson(lesson)
}

function getShortIdentity(value) {
  const text = String(value || '').trim()
  return text.length > 10 ? text.slice(0, 10) : text
}

function getTeacherRecordKey(teacher) {
  return normalizeText(teacher?.teacherKey || teacher?.teacherName || teacher?.name || '')
}

function getTeacherDisplayName(teacher) {
  return String(teacher?.name || teacher?.displayName || teacher?.teacherName || '').trim()
}

function buildTeacherOptionLabel({ displayName, teacherKey, teacherEmail, teacherUid, duplicateName }) {
  const base = String(displayName || teacherKey || teacherEmail || teacherUid || '').trim()
  if (!base) return ''
  const identity =
    String(teacherKey || '').trim() ||
    String(teacherEmail || '').trim() ||
    getShortIdentity(teacherUid)
  if (!duplicateName || !identity || identity === base) return base
  return `${base} · ${identity}`
}

function buildPrivateSlotTeacherFields(optionOrValue) {
  const option =
    optionOrValue && typeof optionOrValue === 'object'
      ? optionOrValue
      : { value: String(optionOrValue || '').trim() }
  const teacherUid = String(option.teacherUid || '').trim()
  const teacherKey = normalizeText(option.teacherKey || option.value || '')
  const teacherName = String(option.displayName || option.label || teacherKey || teacherUid).trim()
  const teacherEmail = String(option.teacherEmail || '').trim()
  const teacher = teacherKey || teacherUid
  return {
    teacher,
    teacherName,
    teacherKey: teacherKey || teacher,
    teacherUid,
    teacherEmail,
  }
}

function buildPrivateTemplateTeacherFields(template) {
  const teacherUid = String(
    template?.teacherUid || template?.teacherUID || template?.teacherId || template?.teacherID || ''
  ).trim()
  const teacherKey = normalizeText(template?.teacherKey || template?.teacher || template?.teacherName || '')
  const teacherName = String(template?.teacherName || template?.teacher || teacherKey || teacherUid).trim()
  const teacherEmail = String(template?.teacherEmail || '').trim()
  const teacher = String(template?.teacher || teacherKey || teacherUid).trim()
  return {
    teacher,
    teacherName,
    teacherKey: teacherKey || teacher,
    teacherUid,
    teacherUID: teacherUid,
    teacherId: String(template?.teacherId || '').trim() || teacherUid,
    teacherEmail,
  }
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
}

function addDaysToStorageYmd(ymd, days) {
  const base = parseYmdToLocalDate(ymd)
  if (!base) return ''
  base.setDate(base.getDate() + days)
  return getStorageDateStringFromDate(base)
}

function generatePrivateFixedAssignmentDates({ template, startDate, endDate }) {
  if (!template || !isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return []
  const templateStart = isYmd(template.effectiveStartDate) ? String(template.effectiveStartDate) : ''
  const templateEnd = isYmd(template.effectiveEndDate) ? String(template.effectiveEndDate) : ''
  const clippedStart = templateStart && templateStart > startDate ? templateStart : startDate
  const clippedEnd = templateEnd && templateEnd < endDate ? templateEnd : endDate
  if (clippedEnd < clippedStart) return []

  const weekday = Number(template.weekday)
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return []
  let nextDate = clippedStart
  const start = parseYmdToLocalDate(nextDate)
  if (!start) return []
  const offset = (weekday - start.getDay() + 7) % 7
  nextDate = addDaysToStorageYmd(clippedStart, offset)

  const dates = []
  while (nextDate && nextDate <= clippedEnd && dates.length <= 370) {
    dates.push(nextDate)
    nextDate = addDaysToStorageYmd(nextDate, 7)
  }
  return dates
}

function formatPrivatePackageAssignmentOption(pkg, availableCount) {
  const title = String(pkg?.title || '개인 수강권').trim()
  const total = Number(pkg?.totalCount ?? 0)
  const safeAvailable = Math.max(0, Number(availableCount ?? 0) || 0)
  const teacherDisplay = String(pkg?.teacherName || '').trim()
  const teacherKey = String(pkg?.teacherKey || pkg?.teacher || '').trim()
  const teacherScope =
    teacherDisplay && teacherKey && teacherDisplay !== teacherKey
      ? `${teacherDisplay} · ${teacherKey}`
      : teacherDisplay || teacherKey || '선생님 미지정'
  const startDate = String(pkg?.registrationStartDate || pkg?.startDate || '').trim()
  const topUpLabel =
    Number(pkg?.topUpCount || 0) > 0 || pkg?.lastTopUpAt ? ' · 추가 등록 포함' : ''
  const prefix = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? `${startDate} 시작`
    : title
  return `${prefix} · ${teacherScope} 전용 · 총 ${Number.isFinite(total) ? total : 0}회 · 새 배정 가능 ${safeAvailable}회${topUpLabel}`
}

function getPrivateSlotTeacherDisplay(slot) {
  const displayName = String(slot?.teacherName || slot?.teacher || '').trim()
  const identity =
    String(slot?.teacherKey || '').trim() ||
    String(slot?.teacherEmail || '').trim() ||
    getShortIdentity(slot?.teacherUid)
  if (!displayName) return identity || '-'
  if (!identity || identity === displayName) return displayName
  return `${displayName} · ${identity}`
}

function getPrivateTeacherIdentityKeys(row) {
  const seen = new Set()
  const out = []
  ;[
    row?.teacherUid,
    row?.teacherUID,
    row?.teacherId,
    row?.teacherID,
    row?.teacherKey,
    row?.teacher,
    row?.teacherName,
    row?.displayName,
    row?.name,
  ].forEach((value) => {
    const key = normalizeText(value || '')
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  })
  return out
}

function privateTeacherIdentitiesOverlap(a, b) {
  const left = getPrivateTeacherIdentityKeys(a)
  const right = new Set(getPrivateTeacherIdentityKeys(b))
  return left.some((key) => right.has(key))
}

function normalizePrivateSlotEligibleStudentIds(values, privateStudents) {
  const allowedIds = new Set(privateStudents.map((student) => String(student.id || '').trim()))
  const out = []
  const seen = new Set()
  const source = Array.isArray(values) ? values : []
  source.forEach((value) => {
    const studentId = String(value || '').trim()
    if (!studentId || seen.has(studentId) || !allowedIds.has(studentId)) return
    seen.add(studentId)
    out.push(studentId)
  })
  return out
}

async function fetchAllDocumentsInCollection(dbInstance, collectionName, academyId) {
  const scopedAcademyId = requireCurrentAcademyId(academyId)
  const col = collection(dbInstance, collectionName)
  const pageSize = 500
  const out = []
  let lastDoc = null
  while (true) {
    const q = lastDoc
      ? query(
          col,
          where('academyId', '==', scopedAcademyId),
          orderBy(documentId()),
          startAfter(lastDoc),
          limit(pageSize)
        )
      : query(
          col,
          where('academyId', '==', scopedAcademyId),
          orderBy(documentId()),
          limit(pageSize)
        )
    const snap = await getDocs(q)
    if (snap.empty) break
    snap.docs.forEach((d) => out.push(d))
    if (snap.docs.length < pageSize) break
    lastDoc = snap.docs[snap.docs.length - 1]
  }
  return out
}

/** Firestore 기준으로 private 패키지의 usedCount / remainingCount 재계산 */
async function recomputePrivatePackageUsage(packageId, academyId) {
  const scopedAcademyId = requireCurrentAcademyId(academyId)
  const pid = String(packageId || '').trim()
  if (!pid) return

  const pkgRef = doc(db, 'studentPackages', pid)
  const pkgSnap = await getDoc(pkgRef)
  if (!pkgSnap.exists()) return

  const pkg = pkgSnap.data()
  assertSameAcademy(pkg, scopedAcademyId, '수강권')
  if (pkg.packageType !== 'private') return

  const packageTeacher = normalizeText(pkg.teacher || '')
  if (!packageTeacher) return

  const snap = await getDocs(
    query(
      collection(db, 'lessons'),
      where('academyId', '==', scopedAcademyId),
      where('packageId', '==', pid),
      where('teacher', '==', packageTeacher)
    )
  )

  const today = getTodayStorageDateString()
  let usedCount = 0
  snap.docs.forEach((lessonDoc) => {
    const data = lessonDoc.data()
    const dateStr = getLessonStorageDateString(data)
    if (!dateStr || dateStr > today) return
    if (data.isDeductCancelled === true) return
    usedCount += 1
  })

  const reservationSnap = await getDocs(
    query(
      collection(db, 'privateLessonReservations'),
      where('academyId', '==', scopedAcademyId),
      where('deductionPackageId', '==', pid)
    )
  ).catch((error) => {
    console.warn('privateLessonReservations usage lookup skipped:', error)
    return null
  })
  if (reservationSnap) {
    reservationSnap.docs.forEach((reservationDoc) => {
      const data = reservationDoc.data()
      if (data.deductionApplied !== true) return
      if (data.status !== 'completed' && data.status !== 'no_show') return
      usedCount += 1
    })
  }

  const totalRaw = Number(pkg.totalCount ?? 0)
  const total = Number.isFinite(totalRaw) ? totalRaw : 0
  const remainingCount = Math.max(0, total - usedCount)
  const status = getNextStudentPackageStatus(pkg.status, remainingCount)

  await updateDoc(pkgRef, {
    usedCount,
    remainingCount,
    status,
    updatedAt: serverTimestamp(),
  })
}


/**
 * groupClassId + date + time 기준 중복은 건너뜀.
 */
async function createGroupLessonsInDateRange({
  academyId,
  groupClassId,
  groupClassName,
  teacher,
  time,
  subject,
  groupCourseType,
  weekdays,
  maxStudents,
  startYmd,
  endYmd,
  existingLessons,
}) {
  const scopedAcademyId = requireCurrentAcademyId(academyId)
  const weekdaySet = new Set(normalizeGroupWeekdaysFromDoc(weekdays))
  const timeStr = String(time || '').trim()
  const subjectStr = String(subject || '').trim()
  const courseType = normalizeGroupCourseType(groupCourseType)
  const teacherNorm = normalizeText(teacher || '')
  const capacity = Number(maxStudents)
  const cap = Number.isFinite(capacity) && capacity >= 0 ? capacity : 0

  let created = 0
  let skippedDup = 0

  if (weekdaySet.size === 0 || !timeStr || !subjectStr) return { created, skippedDup }

  const prior = Array.isArray(existingLessons) ? existingLessons : []
  const commitBatchSize = 20
  let batch = writeBatch(db)
  let pendingWrites = 0

  async function commitPendingWrites() {
    if (pendingWrites === 0) return
    await batch.commit()
    batch = writeBatch(db)
    pendingWrites = 0
  }

  for (const dateStr of iterateYmdRangeInclusive(startYmd, endYmd)) {
    const dt = parseYmdToLocalDate(dateStr)
    if (!dt || !weekdaySet.has(jsDateToGroupWeekdayCode(dt))) continue

    const dup = prior.some(
      (gl) =>
        getGroupLessonGroupId(gl) === String(groupClassId) &&
        String(gl.date || '') === dateStr &&
        String(gl.time || '').trim() === timeStr
    )
    if (dup) {
      skippedDup += 1
      continue
    }

    const lessonRef = doc(collection(db, 'groupLessons'))
    batch.set(lessonRef, {
      academyId: scopedAcademyId,
      groupClassId,
      groupClassName: groupClassName || '',
      teacher: teacherNorm,
      date: dateStr,
      time: timeStr,
      subject: subjectStr,
      ...(courseType ? { groupCourseType: courseType } : {}),
      completed: false,
      countedStudentIDs: [],
      attendanceAppliedAt: null,
      bookingMode: 'fixed',
      capacity: cap,
      bookedCount: 0,
      isBookable: false,
      generationKind: 'recurring',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    created += 1
    pendingWrites += 1
    if (pendingWrites >= commitBatchSize) {
      await commitPendingWrites()
    }
  }

  await commitPendingWrites()

  return { created, skippedDup }
}

function buildGroupPackageCoverageLessons({
  groupClassId,
  registrationStartDate,
  registrationWeeks,
  groupLessons,
  groupClasses,
}) {
  const gid = String(groupClassId || '').trim()
  const start = String(registrationStartDate || '').trim()
  const weeks = Number.parseInt(String(registrationWeeks ?? ''), 10)
  if (!gid || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !parseYmdToLocalDate(start)) {
    return {
      selectedLessons: [],
      computedTotalCount: 0,
      coverageStartDate: '',
      coverageEndDate: '',
      weeklyClassCount: 1,
      targetCount: 0,
    }
  }

  const groupClass = groupClasses.find((g) => String(g.id || '') === gid) || null
  const weeklyClassCount = getGroupWeeklyClassCountFromWeekdaysDoc(groupClass?.weekdays)
  const safeWeeks = Number.isInteger(weeks) && weeks > 0 ? weeks : 0
  const targetCount = weeklyClassCount * safeWeeks
  if (targetCount <= 0) {
    return {
      selectedLessons: [],
      computedTotalCount: 0,
      coverageStartDate: '',
      coverageEndDate: '',
      weeklyClassCount,
      targetCount,
    }
  }

  const sorted = [...groupLessons]
    .filter((gl) => {
      if (isCancelledOrDeletedGroupLesson(gl)) return false
      if (getGroupLessonGroupId(gl) !== gid) return false
      const dateStr = String(gl.date || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
      return dateStr >= start
    })
    .sort((a, b) => {
      const ad = String(a.date || '').trim()
      const bd = String(b.date || '').trim()
      if (ad !== bd) return ad.localeCompare(bd)
      return String(a.time || '').trim().localeCompare(String(b.time || '').trim())
    })

  const selectedLessons = sorted.slice(0, targetCount)
  const coverageStartDate =
    selectedLessons.length > 0 ? String(selectedLessons[0].date || '').trim() : ''
  const coverageEndDate =
    selectedLessons.length > 0
      ? String(selectedLessons[selectedLessons.length - 1].date || '').trim()
      : ''

  return {
    selectedLessons,
    computedTotalCount: selectedLessons.length,
    coverageStartDate,
    coverageEndDate,
    weeklyClassCount,
    targetCount,
  }
}

export default function Dashboard() {
  const { user, userProfile, currentAcademyId } = useAuth()
  const navigate = useNavigate()
  const [teacherDirectoryMemberships, setTeacherDirectoryMemberships] = useState([])
  const [teacherRecords, setTeacherRecords] = useState([])
  const [teachersLoading, setTeachersLoading] = useState(false)
  const [teacherForm, setTeacherForm] = useState(EMPTY_TEACHER_FORM)
  const [teacherFormErrors, setTeacherFormErrors] = useState({})
  const [isTeacherFormSubmitting, setIsTeacherFormSubmitting] = useState(false)
  const [busyTeacherId, setBusyTeacherId] = useState('')
  const [lessons, setLessons] = useState([])
  const [privateStudents, setPrivateStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [privateStudentsLoading, setPrivateStudentsLoading] = useState(true)
  const [migrating, setMigrating] = useState(false)
  const [busyGroupLegacyBackfill, setBusyGroupLegacyBackfill] = useState(false)
  const [busyLessonId, setBusyLessonId] = useState(null)
  const privatePackageUsageSyncInFlightRef = useRef(new Set())
  const [busyDeletingStudentId, setBusyDeletingStudentId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [showOnlySelectedDate, setShowOnlySelectedDate] = useState(true)
  const [calendarMonth, setCalendarMonth] = useState(
  () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
)
  const [activeSection, setActiveSection] = useState('calendar')
  const [groupClasses, setGroupClasses] = useState([])
  const [groupClassesLoading, setGroupClassesLoading] = useState(true)
  const [busyGroupId, setBusyGroupId] = useState(null)
  const [groupClosureModal, setGroupClosureModal] = useState(null)
  const [groupClosureForm, setGroupClosureForm] = useState({
    closedFromDate: '',
    closedReason: '',
    cancelFutureLessons: true,
  })
  const [groupClosureErrors, setGroupClosureErrors] = useState({})
  const [selectedGroupClass, setSelectedGroupClass] = useState(null)
  const [groupStudents, setGroupStudents] = useState([])
  const [groupStudentsLoading, setGroupStudentsLoading] = useState(false)
  const [busyRemovingGroupStudentId, setBusyRemovingGroupStudentId] = useState(null)
  const [groupLessons, setGroupLessons] = useState([])

  const [groupLessonsLoading, setGroupLessonsLoading] = useState(false)
  const [groupLessonReservations, setGroupLessonReservations] = useState([])
  const [groupLessonReservationsLoading, setGroupLessonReservationsLoading] = useState(false)
  const [groupLessonNoDeductionCancelModal, setGroupLessonNoDeductionCancelModal] = useState(null)
  const [groupLessonNoDeductionCancelForm, setGroupLessonNoDeductionCancelForm] = useState({
    cancelledReason: 'holiday',
    cancellationNote: '',
  })
  const [groupLessonNoDeductionCancelErrors, setGroupLessonNoDeductionCancelErrors] = useState({})
  const [todayDashboardGroupLessons, setTodayDashboardGroupLessons] = useState([])
  const [todayDashboardGroupLessonsLoading, setTodayDashboardGroupLessonsLoading] = useState(false)
  const [todayGroupLessonReservations, setTodayGroupLessonReservations] = useState([])
  const [todayGroupLessonReservationsLoading, setTodayGroupLessonReservationsLoading] = useState(false)
  const [privateLessonSlots, setPrivateLessonSlots] = useState([])
  const [privateLessonSlotsLoading, setPrivateLessonSlotsLoading] = useState(false)
  const [privateAvailabilityTemplates, setPrivateAvailabilityTemplates] = useState([])
  const [privateAvailabilityTemplatesLoading, setPrivateAvailabilityTemplatesLoading] =
    useState(false)
  const [privateLessonReservations, setPrivateLessonReservations] = useState([])
  const [privateLessonReservationsLoading, setPrivateLessonReservationsLoading] = useState(false)
  const [busyPrivateReservationOutcomeId, setBusyPrivateReservationOutcomeId] = useState('')
  const [reservationNotificationEvents, setReservationNotificationEvents] = useState([])
  const [reservationNotificationEventsLoading, setReservationNotificationEventsLoading] =
    useState(false)
  const [privateSlotForm, setPrivateSlotForm] = useState({
    teacher: '',
    date: '',
    time: '',
    durationMinutes: '60',
    eligibleStudentIds: [],
    repeatWeekly: false,
    repeatWeeks: '1',
    repeatEndDate: '',
  })
  const [privateSlotFormErrors, setPrivateSlotFormErrors] = useState({})
  const [privateSlotCreateResult, setPrivateSlotCreateResult] = useState(null)
  const [busyPrivateSlotActionId, setBusyPrivateSlotActionId] = useState('')
  const [privateAvailabilityTemplateForm, setPrivateAvailabilityTemplateForm] = useState({
    teacher: '',
    weekday: '1',
    time: '',
    durationMinutes: '60',
    status: 'active',
  })
  const [privateAvailabilityBulkForm, setPrivateAvailabilityBulkForm] = useState({
    teacher: '',
    weekdays: ['1'],
    timesText: '',
    durationMinutes: '60',
    status: 'active',
    effectiveStartDate: '',
    effectiveEndDate: '',
  })
  const [privateAvailabilityTemplateErrors, setPrivateAvailabilityTemplateErrors] = useState({})
  const [privateAvailabilityBulkErrors, setPrivateAvailabilityBulkErrors] = useState({})
  const [privateAvailabilityBulkResult, setPrivateAvailabilityBulkResult] = useState(null)
  const [busyPrivateAvailabilityTemplateId, setBusyPrivateAvailabilityTemplateId] = useState('')
  const [privateFixedSlotAssignmentForm, setPrivateFixedSlotAssignmentForm] = useState({
    teacher: '',
    templateId: '',
    studentId: '',
    packageId: '',
    subject: '1:1 수업',
    startDate: '',
    endDate: '',
  })
  const [privateFixedSlotAssignmentErrors, setPrivateFixedSlotAssignmentErrors] = useState({})
  const [privateFixedSlotAssignmentPreview, setPrivateFixedSlotAssignmentPreview] = useState(null)
  const [busyPrivateFixedSlotAssignment, setBusyPrivateFixedSlotAssignment] = useState(false)
  const [busyFixedPrivateLessonCancelId, setBusyFixedPrivateLessonCancelId] = useState('')
  const [studentSummaryGroupStudents, setStudentSummaryGroupStudents] = useState([])
  const [studentSummaryGroupLessons, setStudentSummaryGroupLessons] = useState([])

  const [busyDeletingPrivateLessonId, setBusyDeletingPrivateLessonId] = useState(null)
  const [studentPackages, setStudentPackages] = useState([])
  const [studentPrivateBookingStats, setStudentPrivateBookingStats] = useState([])
  const [studentPrivateBookingStatsLoading, setStudentPrivateBookingStatsLoading] =
    useState(false)

  useEffect(() => {
    if (userProfile?.role !== 'admin' || !isValidOperationalAcademyId(currentAcademyId)) {
      setTeacherDirectoryMemberships([])
      return
    }
    const unsubscribeUsers = onSnapshot(
      query(
        collection(db, 'academyMemberships'),
        where('academyId', '==', currentAcademyId)
      ),
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        setTeacherDirectoryMemberships(rows)
      },
      (error) => {
        console.error('academyMemberships 선생님 목록 불러오기 실패:', error)
        setTeacherDirectoryMemberships([])
      }
    )
    return () => unsubscribeUsers()
  }, [currentAcademyId, userProfile?.role])

  useEffect(() => {
    if (userProfile?.role !== 'admin' || !isValidOperationalAcademyId(currentAcademyId)) {
      setTeacherRecords([])
      setTeachersLoading(false)
      return
    }

    setTeachersLoading(true)
    const unsubscribeTeachers = onSnapshot(
      query(
        collection(db, 'teachers'),
        where('academyId', '==', currentAcademyId)
      ),
      (snapshot) => {
        const rows = snapshot.docs
          .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
          .sort((a, b) => {
            const statusCompare = String(a.status || 'active').localeCompare(
              String(b.status || 'active')
            )
            if (statusCompare !== 0) return statusCompare
            return String(a.name || a.teacherName || '').localeCompare(
              String(b.name || b.teacherName || ''),
              'ko'
            )
          })
        setTeacherRecords(rows)
        setTeachersLoading(false)
      },
      (error) => {
        console.error('teachers 목록 불러오기 실패:', error)
        setTeacherRecords([])
        setTeachersLoading(false)
      }
    )
    return () => unsubscribeTeachers()
  }, [currentAcademyId, userProfile?.role])

  const teacherSelectOptions = useMemo(() => {
    const membershipByTeacherKey = new Map()
    for (const membership of teacherDirectoryMemberships) {
      const role = String(membership?.role || '').trim().toLowerCase()
      if (!(role === 'teacher' || role === 'admin' || role === 'owner')) continue
      const teacherKey = normalizeText(membership.teacherName || '')
      if (!teacherKey || membershipByTeacherKey.has(teacherKey)) continue
      membershipByTeacherKey.set(teacherKey, membership)
    }
    const activeTeachers = teacherRecords.filter(
      (teacher) => String(teacher?.status || 'active') !== 'inactive'
    )
    const nameCounts = new Map()
    activeTeachers.forEach((teacher) => {
      const name = getTeacherDisplayName(teacher)
      if (!name) return
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
    })
    teacherDirectoryMemberships.forEach((membership) => {
      const role = String(membership?.role || '').trim().toLowerCase()
      if (!(role === 'teacher' || role === 'admin' || role === 'owner')) return
      const name = String(membership?.displayName || membership?.teacherName || '').trim()
      if (!name) return
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
    })
    const map = new Map()
    for (const teacher of teacherRecords) {
      if (String(teacher?.status || 'active') === 'inactive') continue
      const rawName = getTeacherDisplayName(teacher)
      const teacherKey = getTeacherRecordKey(teacher)
      const membership = teacherKey ? membershipByTeacherKey.get(teacherKey) : null
      const teacherUid = String(teacher?.teacherUid || teacher?.uid || membership?.uid || '').trim()
      const teacherEmail = String(teacher?.teacherEmail || teacher?.email || membership?.email || '').trim()
      const value = teacherUid || teacherKey || rawName
      if (!value) continue
      if (!map.has(value)) {
        const displayName = rawName || teacherKey || teacherEmail || value
        map.set(value, {
          value,
          label: buildTeacherOptionLabel({
            displayName,
            teacherKey,
            teacherEmail,
            teacherUid,
            duplicateName: nameCounts.get(displayName) > 1,
          }),
          displayName,
          teacherKey,
          teacherUid,
          teacherEmail,
        })
      }
    }
    for (const u of teacherDirectoryMemberships) {
      const rawName = String(u?.displayName || u?.teacherName || '').trim()
      if (!rawName) continue
      const role = String(u?.role || '').trim().toLowerCase()
      if (!(role === 'teacher' || role === 'admin' || role === 'owner')) continue
      const teacherKey = normalizeText(u?.teacherName || rawName)
      const teacherUid = String(u?.uid || '').trim()
      const teacherEmail = String(u?.email || '').trim()
      const value = teacherUid || teacherKey || rawName
      if (!value || map.has(value)) continue
      map.set(value, {
        value,
        label: buildTeacherOptionLabel({
          displayName: rawName,
          teacherKey,
          teacherEmail,
          teacherUid,
          duplicateName: nameCounts.get(rawName) > 1,
        }),
        displayName: rawName,
        teacherKey,
        teacherUid,
        teacherEmail,
      })
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  }, [teacherDirectoryMemberships, teacherRecords])

  const teacherManagementTeachers = useMemo(() => {
    const membershipByTeacherKey = new Map()
    for (const membership of teacherDirectoryMemberships) {
      const role = String(membership?.role || '').trim().toLowerCase()
      if (role !== 'teacher') continue
      const teacherKey = normalizeText(membership.teacherName || '')
      if (!teacherKey || membershipByTeacherKey.has(teacherKey)) continue
      membershipByTeacherKey.set(teacherKey, membership)
    }

    return teacherRecords.map((teacher) => {
      const teacherKey = normalizeText(
        teacher.teacherKey || teacher.teacherName || teacher.name || ''
      )
      const membership = teacherKey ? membershipByTeacherKey.get(teacherKey) : null
      return {
        ...teacher,
        teacherMembershipId: membership?.id || '',
        teacherMembershipUid: membership?.uid || '',
        countEditPermissionEnabled:
          membership?.permissions?.canEditStudentPackageCounts === true,
        lessonDeductionPermissionEnabled:
          membership?.permissions?.canManageOwnLessonDeductions === true,
      }
    })
  }, [teacherDirectoryMemberships, teacherRecords])

  const validateTeacherForm = (form) => {
    const name = String(form.name || '').trim()
    const teacherKey = normalizeText(form.teacherKey || name)
    const status = form.status === 'inactive' ? 'inactive' : 'active'
    const errors = {}

    if (!name) errors.name = '선생님 이름을 입력해 주세요.'
    if (!teacherKey) errors.teacherKey = 'teacherKey를 입력하거나 이름을 입력해 주세요.'

    const duplicate = teacherRecords.find((teacher) => {
      if (teacher.id === form.id) return false
      const existingKey = normalizeText(
        teacher.teacherKey || teacher.teacherName || teacher.name || ''
      )
      return existingKey && existingKey === teacherKey
    })
    if (duplicate) errors.teacherKey = '이미 같은 teacherKey를 사용하는 선생님이 있습니다.'

    return {
      ok: Object.keys(errors).length === 0,
      errors,
      value: { name, teacherKey, status },
    }
  }

  const resetTeacherForm = () => {
    setTeacherForm(EMPTY_TEACHER_FORM)
    setTeacherFormErrors({})
  }

  const submitTeacherForm = async () => {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 선생님을 관리할 수 있습니다.')
      return
    }

    let scopedAcademyId
    try {
      scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    } catch (error) {
      alert(error.message)
      return
    }

    const result = validateTeacherForm(teacherForm)
    setTeacherFormErrors(result.errors)
    if (!result.ok) return

    setIsTeacherFormSubmitting(true)
    try {
      const payload = {
        academyId: scopedAcademyId,
        name: result.value.name,
        teacherName: result.value.teacherKey,
        teacherKey: result.value.teacherKey,
        status: result.value.status,
        updatedAt: serverTimestamp(),
      }

      if (teacherForm.id) {
        await updateDoc(doc(db, 'teachers', teacherForm.id), payload)
      } else {
        await addDoc(collection(db, 'teachers'), {
          ...payload,
          createdAt: serverTimestamp(),
        })
      }

      resetTeacherForm()
    } catch (error) {
      console.error('선생님 저장 실패:', error)
      alert(error.message || '선생님 저장에 실패했습니다.')
    } finally {
      setIsTeacherFormSubmitting(false)
    }
  }

  const editTeacher = (teacher) => {
    setTeacherForm({
      id: teacher.id,
      name: String(teacher.name || '').trim(),
      teacherKey: normalizeText(teacher.teacherKey || teacher.teacherName || teacher.name || ''),
      status: teacher.status === 'inactive' ? 'inactive' : 'active',
    })
    setTeacherFormErrors({})
    setActiveSection('teachers')
  }

  const updateTeacherStatus = async (teacher, status) => {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 선생님을 관리할 수 있습니다.')
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      if (String(teacher.academyId || '').trim() !== scopedAcademyId) {
        throw new Error('선생님 문서가 현재 학원에 속하지 않습니다.')
      }

      setBusyTeacherId(teacher.id)
      await updateDoc(doc(db, 'teachers', teacher.id), {
        status: status === 'inactive' ? 'inactive' : 'active',
        updatedAt: serverTimestamp(),
      })
      if (teacherForm.id === teacher.id) {
        setTeacherForm((prev) => ({
          ...prev,
          status: status === 'inactive' ? 'inactive' : 'active',
        }))
      }
    } catch (error) {
      console.error('선생님 상태 변경 실패:', error)
      alert(error.message || '선생님 상태 변경에 실패했습니다.')
    } finally {
      setBusyTeacherId('')
    }
  }

  const updateTeacherCountEditPermission = async (teacher, enabled) => {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 선생님 권한을 관리할 수 있습니다.')
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      if (String(teacher.academyId || '').trim() !== scopedAcademyId) {
        throw new Error('선생님 문서가 현재 학원에 속하지 않습니다.')
      }
      if (!teacher.teacherMembershipId) {
        throw new Error('선생님 로그인 연결 정보를 찾을 수 없습니다.')
      }

      setBusyTeacherId(`${teacher.id}__count_edit_permission`)
      await updateDoc(doc(db, 'academyMemberships', teacher.teacherMembershipId), {
        'permissions.canEditStudentPackageCounts': enabled === true,
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error('선생님 수강권 횟수 수정 권한 변경 실패:', error)
      alert(error.message || '선생님 권한 변경에 실패했습니다.')
      throw error
    } finally {
      setBusyTeacherId('')
    }
  }

  const updateTeacherLessonDeductionPermission = async (teacher, enabled) => {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 선생님 권한을 관리할 수 있습니다.')
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      if (String(teacher.academyId || '').trim() !== scopedAcademyId) {
        throw new Error('선생님 문서가 현재 학원에 속하지 않습니다.')
      }
      if (!teacher.teacherMembershipId) {
        throw new Error('선생님 로그인 연결 정보를 찾을 수 없습니다.')
      }

      setBusyTeacherId(`${teacher.id}__lesson_deduction_permission`)
      await updateDoc(doc(db, 'academyMemberships', teacher.teacherMembershipId), {
        'permissions.canManageOwnLessonDeductions': enabled === true,
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error('선생님 수업 차감 관리 권한 변경 실패:', error)
      alert(error.message || '선생님 권한 변경에 실패했습니다.')
      throw error
    } finally {
      setBusyTeacherId('')
    }
  }

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId)) {
      setLessons([])
      setPrivateStudents([])
      setLoading(false)
      setPrivateStudentsLoading(false)
      return
    }
    if (!userProfile?.role) return

    setLoading(true)
    setPrivateStudentsLoading(true)

    const roleKey = String(userProfile.role).trim().toLowerCase()
    const teacherNameRaw = userProfile.teacherName
    const isAdminProfile = isDashboardAdminProfile(userProfile)

    debugLog('[Dashboard] userProfile.role normalized:', roleKey)

    let active = true
    let lessonsLoaded = false
    let studentsLoaded = false
    let initialStudentsReadStarted = false
    let lessonsByTeacherNameRows = []
    let lessonsByLegacyTeacherRows = []

    const markLessonsLoaded = () => {
      if (!active) return
      lessonsLoaded = true
      if (studentsLoaded) setLoading(false)
    }

    const markStudentsLoaded = () => {
      if (!active) return
      studentsLoaded = true
      setPrivateStudentsLoading(false)
      if (lessonsLoaded) setLoading(false)
    }

    const applyStudentSnapshot = (snapshot, label) => {
      if (!active) return
      const rows = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }))
      debugLog(`[Dashboard] privateStudents(${label}) snapshot row count:`, rows.length)
      setPrivateStudents(rows)
      markStudentsLoaded()
    }

    const startInitialStudentsRead = (studentsQuery, label) => {
      if (initialStudentsReadStarted) return
      initialStudentsReadStarted = true
      getDocs(studentsQuery)
        .then((snapshot) => applyStudentSnapshot(snapshot, `${label} initial`))
        .catch((error) => {
          if (!active) return
          console.warn(`privateStudents(${label}) 초기 조회 실패:`, error)
        })
    }

    const mergeTeacherLessons = () => {
      const map = new Map()
      for (const row of lessonsByTeacherNameRows) map.set(row.id, row)
      for (const row of lessonsByLegacyTeacherRows) map.set(row.id, row)
      setLessons(Array.from(map.values()))
    }

    let unsubscribeLessons = () => {}
    let unsubscribeLessonsLegacy = () => {}
    let unsubscribeStudents = () => {}

    if (isAdminProfile) {
      const studentsQuery = query(
        collection(db, 'privateStudents'),
        where('academyId', '==', currentAcademyId)
      )
      startInitialStudentsRead(studentsQuery, 'admin')

      unsubscribeLessons = onSnapshot(
        query(
          collection(db, 'lessons'),
          where('academyId', '==', currentAcademyId)
        ),
        (snapshot) => {
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          setLessons(rows)
          markLessonsLoaded()
        },
        (error) => {
          console.error('lessons(admin) 불러오기 실패:', error)
          setLessons([])
          markLessonsLoaded()
        }
      )

      unsubscribeStudents = onSnapshot(
        studentsQuery,
        (snapshot) => applyStudentSnapshot(snapshot, 'admin'),
        (error) => {
          console.error('privateStudents(admin) 불러오기 실패:', error)
          setPrivateStudents([])
          markStudentsLoaded()
        }
      )
    } else if (
      roleKey === 'teacher' &&
      teacherNameRaw != null &&
      String(teacherNameRaw).length > 0
    ) {
      const studentsQuery = query(
        collection(db, 'privateStudents'),
        where('academyId', '==', currentAcademyId),
        where('teacher', '==', teacherNameRaw)
      )
      startInitialStudentsRead(studentsQuery, 'teacher')

      unsubscribeLessons = onSnapshot(
        query(
          collection(db, 'lessons'),
          where('academyId', '==', currentAcademyId),
          where('teacherName', '==', teacherNameRaw)
        ),
        (snapshot) => {
          lessonsByTeacherNameRows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          mergeTeacherLessons()
          markLessonsLoaded()
        },
        (error) => {
          console.error('lessons(teacherName) 불러오기 실패:', error)
          lessonsByTeacherNameRows = []
          mergeTeacherLessons()
          markLessonsLoaded()
        }
      )

      unsubscribeLessonsLegacy = onSnapshot(
        query(
          collection(db, 'lessons'),
          where('academyId', '==', currentAcademyId),
          where('teacher', '==', teacherNameRaw)
        ),
        (snapshot) => {
          lessonsByLegacyTeacherRows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          mergeTeacherLessons()
          markLessonsLoaded()
        },
        (error) => {
          console.error('lessons(legacy teacher) 불러오기 실패:', error)
          lessonsByLegacyTeacherRows = []
          mergeTeacherLessons()
          markLessonsLoaded()
        }
      )

      unsubscribeStudents = onSnapshot(
        studentsQuery,
        (snapshot) => applyStudentSnapshot(snapshot, 'teacher'),
        (error) => {
          console.error('privateStudents(teacher) 불러오기 실패:', error)
          setPrivateStudents([])
          markStudentsLoaded()
        }
      )
    } else {
      setLessons([])
      setPrivateStudents([])
      setLoading(false)
      setPrivateStudentsLoading(false)
    }

    return () => {
      active = false
      unsubscribeLessons()
      unsubscribeLessonsLegacy()
      unsubscribeStudents()
    }
  }, [
    currentAcademyId,
    user?.uid,
    userProfile?.membershipRole,
    userProfile?.role,
    userProfile?.teacherName,
  ])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId)) {
      setGroupClasses([])
      setGroupClassesLoading(false)
      return
    }
    if (!userProfile?.role) return

    const role = userProfile.role
    const teacherName = String(userProfile.teacherName ?? '').trim()

    let ref
    if (isDashboardAdminProfile(userProfile)) {
      ref = query(
        collection(db, 'groupClasses'),
        where('academyId', '==', currentAcademyId)
      )
    } else if (role === 'teacher' && teacherName) {
      const queryByTeacher = query(
        collection(db, 'groupClasses'),
        where('academyId', '==', currentAcademyId),
        where('teacher', '==', teacherName)
      )
      const queryByTeacherName = query(
        collection(db, 'groupClasses'),
        where('academyId', '==', currentAcademyId),
        where('teacherName', '==', teacherName)
      )

      setGroupClassesLoading(true)
      const rowsByTeacher = new Map()
      const rowsByTeacherName = new Map()
      const mergeRows = () => {
        const rowsById = new Map([...rowsByTeacher, ...rowsByTeacherName])
        setGroupClasses([...rowsById.values()])
        setGroupClassesLoading(false)
      }
      const unsubTeacher = onSnapshot(
        queryByTeacher,
        (snapshot) => {
          rowsByTeacher.clear()
          snapshot.docs.forEach((docItem) => {
            rowsByTeacher.set(docItem.id, { id: docItem.id, ...docItem.data() })
          })
          mergeRows()
        },
        (error) => {
          console.error('teacher groupClasses 불러오기 실패:', error)
          setGroupClasses([])
          setGroupClassesLoading(false)
        }
      )
      const unsubTeacherName = onSnapshot(
        queryByTeacherName,
        (snapshot) => {
          rowsByTeacherName.clear()
          snapshot.docs.forEach((docItem) => {
            rowsByTeacherName.set(docItem.id, { id: docItem.id, ...docItem.data() })
          })
          mergeRows()
        },
        (error) => {
          console.error('teacherName groupClasses 불러오기 실패:', error)
          setGroupClasses([])
          setGroupClassesLoading(false)
        }
      )
      return () => {
        unsubTeacher()
        unsubTeacherName()
      }
    } else {
      setGroupClasses([])
      setGroupClassesLoading(false)
      return
    }

    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
        setGroupClasses(rows)
        setGroupClassesLoading(false)
      },
      (error) => {
        console.error('groupClasses 불러오기 실패:', error)
        setGroupClasses([])
        setGroupClassesLoading(false)
      }
    )
    return () => unsubscribe()
  }, [currentAcademyId, user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId) || !userProfile?.role) {
      setReservationNotificationEvents([])
      setReservationNotificationEventsLoading(false)
      return
    }

    const isAdminProfile = isDashboardAdminProfile(userProfile)
    const isTeacherProfile = isDashboardTeacherProfile(userProfile)
    const teacherName = String(userProfile.teacherName || '').trim()
    if (!isAdminProfile && (!isTeacherProfile || !teacherName)) {
      setReservationNotificationEvents([])
      setReservationNotificationEventsLoading(false)
      return
    }

    setReservationNotificationEventsLoading(true)
    const mergeAndSetRows = (snapshots) => {
      const byId = new Map()
      snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((docItem) => {
          const row = { id: docItem.id, ...docItem.data() }
          if (!RESERVATION_NOTIFICATION_EVENT_TYPES.includes(row.type)) return
          byId.set(docItem.id, row)
        })
      })
      const rows = Array.from(byId.values())
        .sort(
          (a, b) =>
            getNotificationEventCreatedAtMillis(b) - getNotificationEventCreatedAtMillis(a)
        )
        .slice(0, 20)
      setReservationNotificationEvents(rows)
      setReservationNotificationEventsLoading(false)
    }

    const baseConstraints = [
      where('academyId', '==', currentAcademyId),
      where('type', 'in', RESERVATION_NOTIFICATION_EVENT_TYPES),
    ]

    if (isAdminProfile) {
      const unsubscribe = onSnapshot(
        query(
          collection(db, 'notificationEvents'),
          ...baseConstraints,
          orderBy('createdAt', 'desc'),
          limit(20)
        ),
        (snapshot) => mergeAndSetRows([snapshot]),
        (error) => {
          console.error('notificationEvents(admin) 불러오기 실패:', error)
          setReservationNotificationEvents([])
          setReservationNotificationEventsLoading(false)
        }
      )
      return () => unsubscribe()
    }

    let teacherSnapshot = null
    let teacherNameSnapshot = null
    const maybeMergeTeacherRows = () => {
      if (!teacherSnapshot || !teacherNameSnapshot) return
      mergeAndSetRows([teacherSnapshot, teacherNameSnapshot])
    }
    const queryOptions = [orderBy('createdAt', 'desc'), limit(20)]
    const unsubscribeTeacher = onSnapshot(
      query(
        collection(db, 'notificationEvents'),
        ...baseConstraints,
        where('teacher', '==', teacherName),
        ...queryOptions
      ),
      (snapshot) => {
        teacherSnapshot = snapshot
        maybeMergeTeacherRows()
      },
      (error) => {
        console.error('notificationEvents(teacher) 불러오기 실패:', error)
        teacherSnapshot = { docs: [] }
        maybeMergeTeacherRows()
      }
    )
    const unsubscribeTeacherName = onSnapshot(
      query(
        collection(db, 'notificationEvents'),
        ...baseConstraints,
        where('teacherName', '==', teacherName),
        ...queryOptions
      ),
      (snapshot) => {
        teacherNameSnapshot = snapshot
        maybeMergeTeacherRows()
      },
      (error) => {
        console.error('notificationEvents(teacherName) 불러오기 실패:', error)
        teacherNameSnapshot = { docs: [] }
        maybeMergeTeacherRows()
      }
    )
    return () => {
      unsubscribeTeacher()
      unsubscribeTeacherName()
    }
  }, [currentAcademyId, user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId)) {
      setStudentPackages([])
      return
    }
    if (!userProfile?.role) {
      setStudentPackages([])
      return
    }

    if (userProfile.role === 'admin') {
      const unsubscribe = onSnapshot(
        query(
          collection(db, 'studentPackages'),
          where('academyId', '==', currentAcademyId)
        ),
        (snapshot) => {
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          setStudentPackages(rows)
        },
        (error) => {
          console.error('studentPackages 불러오기 실패:', error)
          setStudentPackages([])
        }
      )
      return () => unsubscribe()
    }

    if (userProfile.role === 'teacher') {
      const teacherKey = normalizeText(userProfile.teacherName || '')
      if (!teacherKey) {
        setStudentPackages([])
        return
      }
      let teacherSnapshot = null
      let teacherNameSnapshot = null
      const mergeTeacherPackageRows = () => {
        if (!teacherSnapshot || !teacherNameSnapshot) return
        const rowsById = new Map()
        ;[teacherSnapshot, teacherNameSnapshot].forEach((snapshot) => {
          snapshot.docs.forEach((docItem) => {
            rowsById.set(docItem.id, {
              id: docItem.id,
              ...stripBillingFieldsForRestrictedViewer(docItem.data()),
            })
          })
        })
        setStudentPackages([...rowsById.values()])
      }
      const unsubscribeTeacher = onSnapshot(
        query(
          collection(db, 'studentPackages'),
          where('academyId', '==', currentAcademyId),
          where('teacher', '==', teacherKey)
        ),
        (snapshot) => {
          teacherSnapshot = snapshot
          mergeTeacherPackageRows()
        },
        (error) => {
          console.error('studentPackages(teacher) 불러오기 실패:', error)
          teacherSnapshot = { docs: [] }
          mergeTeacherPackageRows()
        }
      )
      const unsubscribeTeacherName = onSnapshot(
        query(
          collection(db, 'studentPackages'),
          where('academyId', '==', currentAcademyId),
          where('teacherName', '==', teacherKey)
        ),
        (snapshot) => {
          teacherNameSnapshot = snapshot
          mergeTeacherPackageRows()
        },
        (error) => {
          console.error('studentPackages(teacherName) 불러오기 실패:', error)
          teacherNameSnapshot = { docs: [] }
          mergeTeacherPackageRows()
        }
      )
      return () => {
        unsubscribeTeacher()
        unsubscribeTeacherName()
      }
    }

    setStudentPackages([])
  }, [currentAcademyId, user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId)) {
      setStudentPrivateBookingStats([])
      setStudentPrivateBookingStatsLoading(false)
      return
    }
    if (userProfile?.role !== 'admin') {
      setStudentPrivateBookingStats([])
      setStudentPrivateBookingStatsLoading(false)
      return
    }

    setStudentPrivateBookingStatsLoading(true)
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'studentPrivateBookingStats'),
        where('academyId', '==', currentAcademyId)
      ),
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
        setStudentPrivateBookingStats(rows)
        setStudentPrivateBookingStatsLoading(false)
      },
      (error) => {
        console.error('studentPrivateBookingStats 불러오기 실패:', error)
        setStudentPrivateBookingStats([])
        setStudentPrivateBookingStatsLoading(false)
      }
    )
    return () => unsubscribe()
  }, [currentAcademyId, user?.uid, userProfile?.role])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId) || !userProfile?.role) {
      return
    }

    const scopedAcademyId = String(currentAcademyId || '').trim()
    const privatePackagesById = new Map(
      studentPackages
        .filter(
          (pkg) =>
            String(pkg.academyId || '').trim() === scopedAcademyId &&
            pkg.packageType === 'private' &&
            String(pkg.id || '').trim()
        )
        .map((pkg) => [String(pkg.id), pkg])
    )
    if (privatePackagesById.size === 0) return

    const today = getTodayStorageDateString()
    const expectedUsedByPackageId = new Map()

    lessons.forEach((lesson) => {
      if (String(lesson.academyId || '').trim() !== scopedAcademyId) return
      const packageId = String(lesson.packageId || '').trim()
      if (!privatePackagesById.has(packageId)) return
      const dateStr = getLessonStorageDateString(lesson)
      if (!dateStr || dateStr > today) return
      if (lesson.isDeductCancelled === true) return
      expectedUsedByPackageId.set(packageId, (expectedUsedByPackageId.get(packageId) || 0) + 1)
    })

    privateLessonReservations.forEach((reservation) => {
      if (String(reservation.academyId || '').trim() !== scopedAcademyId) return
      const packageId = String(reservation.deductionPackageId || '').trim()
      if (!privatePackagesById.has(packageId)) return
      if (reservation.deductionApplied !== true) return
      const status = String(reservation.status || '').trim()
      if (status !== 'completed' && status !== 'no_show') return
      expectedUsedByPackageId.set(packageId, (expectedUsedByPackageId.get(packageId) || 0) + 1)
    })

    privatePackagesById.forEach((pkg, packageId) => {
      const expectedUsed = expectedUsedByPackageId.get(packageId) || 0
      const totalRaw = Number(pkg.totalCount ?? 0)
      const total = Number.isFinite(totalRaw) ? totalRaw : 0
      const expectedRemaining = Math.max(0, total - expectedUsed)
      const currentUsed = Number(pkg.usedCount ?? 0)
      const currentRemaining = Number(pkg.remainingCount ?? 0)
      if (currentUsed === expectedUsed && currentRemaining === expectedRemaining) return
      if (privatePackageUsageSyncInFlightRef.current.has(packageId)) return

      privatePackageUsageSyncInFlightRef.current.add(packageId)
      recomputePrivatePackageUsage(packageId, scopedAcademyId)
        .catch((error) => {
          console.error('private package usage sync failed:', error)
        })
        .finally(() => {
          privatePackageUsageSyncInFlightRef.current.delete(packageId)
        })
    })
  }, [
    currentAcademyId,
    lessons,
    privateLessonReservations,
    studentPackages,
    user?.uid,
    userProfile?.role,
  ])

  useEffect(() => {
    if (activeSection !== 'groups') {
      setSelectedGroupClass(null)
    }
  }, [activeSection])

  useEffect(() => {
    const canUseTeacherGroupSection =
      isDashboardTeacherProfile(userProfile) && normalizeText(userProfile?.teacherName || '')
    const canUseTeacherPrivateRequestsSection = canUseTeacherGroupSection
    const canUseTeacherPackageCountSection =
      canUseTeacherGroupSection && userProfile?.canEditStudentPackageCounts === true
    if (
      !isDashboardAdminProfile(userProfile) &&
      ((activeSection === 'students' && !canUseTeacherPackageCountSection) ||
        ['privateSlots', 'lessonRequests', 'teachers', 'dailyMaterials'].includes(activeSection) ||
        (activeSection === 'groups' && !canUseTeacherGroupSection) ||
        (activeSection === 'teacherPrivateRequests' && !canUseTeacherPrivateRequestsSection))
    ) {
      setActiveSection('calendar')
    }
  }, [
    activeSection,
    userProfile?.canEditStudentPackageCounts,
    userProfile?.membershipRole,
    userProfile?.role,
    userProfile?.teacherName,
  ])

  useEffect(() => {
    if (!selectedGroupClass?.id || !isValidOperationalAcademyId(currentAcademyId)) {
      setGroupStudents([])
      setGroupStudentsLoading(false)
      return
    }

    setGroupStudentsLoading(true)
    const groupClassId = selectedGroupClass.id
    const q = query(
      collection(db, 'groupStudents'),
      where('academyId', '==', currentAcademyId),
      where('groupClassId', '==', groupClassId)
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
        setGroupStudents(rows)
        setGroupStudentsLoading(false)
      },
      (error) => {
        console.error('groupStudents 불러오기 실패:', error)
        setGroupStudents([])
        setGroupStudentsLoading(false)
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, selectedGroupClass?.id])

  useEffect(() => {
    if (!selectedGroupClass?.id) return
    const stillThere = groupClasses.some((g) => g.id === selectedGroupClass.id)
    if (!stillThere) setSelectedGroupClass(null)
  }, [groupClasses, selectedGroupClass?.id])

  useEffect(() => {
    if (!selectedGroupClass?.id || !isValidOperationalAcademyId(currentAcademyId)) {
      setGroupLessons([])
      setGroupLessonsLoading(false)
      return
    }

    setGroupLessonsLoading(true)
    const groupClassId = selectedGroupClass.id
    const q = query(
      collection(db, 'groupLessons'),
      and(
        where('academyId', '==', currentAcademyId),
        or(where('groupClassId', '==', groupClassId), where('groupClassID', '==', groupClassId))
      )
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        })).filter(isVisibleGroupLessonForActiveViews)
        setGroupLessons(rows)
        setGroupLessonsLoading(false)
      },
      (error) => {
        console.error('groupLessons 불러오기 실패:', error)
        setGroupLessons([])
        setGroupLessonsLoading(false)
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, selectedGroupClass?.id])

  useEffect(() => {
    if (!selectedGroupClass?.id || !isValidOperationalAcademyId(currentAcademyId)) {
      setGroupLessonReservations([])
      setGroupLessonReservationsLoading(false)
      return
    }

    setGroupLessonReservationsLoading(true)
    const q = query(
      collection(db, 'groupLessonReservations'),
      where('academyId', '==', currentAcademyId),
      where('groupClassId', '==', selectedGroupClass.id),
      where('status', 'in', ['active', 'cancelled'])
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
        setGroupLessonReservations(rows)
        setGroupLessonReservationsLoading(false)
      },
      (error) => {
        console.error('groupLessonReservations 불러오기 실패:', error)
        setGroupLessonReservations([])
        setGroupLessonReservationsLoading(false)
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, selectedGroupClass?.id])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId)) {
      setPrivateLessonSlots([])
      setPrivateLessonSlotsLoading(false)
      return
    }
    if (!userProfile?.role) return

    const role = userProfile.role
    const teacherName = normalizeText(userProfile.teacherName || '')
    let ref
    if (role === 'admin') {
      ref = query(
        collection(db, 'privateLessonSlots'),
        where('academyId', '==', currentAcademyId)
      )
    } else if (role === 'teacher' && teacherName) {
      ref = query(
        collection(db, 'privateLessonSlots'),
        where('academyId', '==', currentAcademyId),
        where('teacher', '==', teacherName)
      )
    } else {
      setPrivateLessonSlots([])
      setPrivateLessonSlotsLoading(false)
      return
    }

    setPrivateLessonSlotsLoading(true)
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
        rows.sort((a, b) =>
          `${a.date || ''} ${a.time || ''} ${a.teacher || ''}`.localeCompare(
            `${b.date || ''} ${b.time || ''} ${b.teacher || ''}`,
            'ko'
          )
        )
        setPrivateLessonSlots(rows)
        setPrivateLessonSlotsLoading(false)
      },
      (error) => {
        console.error('privateLessonSlots 불러오기 실패:', error)
        setPrivateLessonSlots([])
        setPrivateLessonSlotsLoading(false)
      }
    )
    return () => unsubscribe()
  }, [currentAcademyId, user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    const isAdminProfile = isDashboardAdminProfile(userProfile)
    if (!isAdminProfile || !isValidOperationalAcademyId(currentAcademyId)) {
      setPrivateAvailabilityTemplates([])
      setPrivateAvailabilityTemplatesLoading(false)
      return
    }

    setPrivateAvailabilityTemplatesLoading(true)
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'privateLessonAvailabilityTemplates'),
        where('academyId', '==', currentAcademyId)
      ),
      (snapshot) => {
        const rows = snapshot.docs
          .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
          .sort((a, b) => {
            const aKey = `${a.teacher || a.teacherName || ''} ${a.weekday || ''} ${a.time || ''}`
            const bKey = `${b.teacher || b.teacherName || ''} ${b.weekday || ''} ${b.time || ''}`
            return aKey.localeCompare(bKey, 'ko')
          })
        setPrivateAvailabilityTemplates(rows)
        setPrivateAvailabilityTemplatesLoading(false)
      },
      (error) => {
        console.error('privateLessonAvailabilityTemplates 불러오기 실패:', error)
        setPrivateAvailabilityTemplates([])
        setPrivateAvailabilityTemplatesLoading(false)
      }
    )
    return () => unsubscribe()
  }, [currentAcademyId, userProfile])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId)) {
      setPrivateLessonReservations([])
      setPrivateLessonReservationsLoading(false)
      return
    }
    if (!userProfile?.role) return

    const isAdminProfile = isDashboardAdminProfile(userProfile)
    const teacherName = normalizeText(userProfile.teacherName || '')
    if (isAdminProfile) {
      setPrivateLessonReservationsLoading(true)
      const unsubscribe = onSnapshot(
        query(
          collection(db, 'privateLessonReservations'),
          where('academyId', '==', currentAcademyId),
          where('status', 'in', [
            'active',
            'reserved',
            'confirmed',
            'booked',
            'completed',
            'no_show',
            'cancelled',
            'canceled',
          ])
        ),
        (snapshot) => {
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          setPrivateLessonReservations(rows)
          setPrivateLessonReservationsLoading(false)
        },
        (error) => {
          console.error('privateLessonReservations 불러오기 실패:', error)
          setPrivateLessonReservations([])
          setPrivateLessonReservationsLoading(false)
        }
      )
      return () => unsubscribe()
    } else if (isDashboardTeacherProfile(userProfile) && teacherName) {
      setPrivateLessonReservationsLoading(true)
      let teacherSnapshot = null
      let teacherNameSnapshot = null
      const mergeTeacherRows = () => {
        if (!teacherSnapshot || !teacherNameSnapshot) return
        const byId = new Map()
        const snapshots = [teacherSnapshot, teacherNameSnapshot]
        snapshots.forEach((snapshot) => {
          snapshot.docs.forEach((docItem) => {
            byId.set(docItem.id, { id: docItem.id, ...docItem.data() })
          })
        })
        setPrivateLessonReservations(Array.from(byId.values()))
        setPrivateLessonReservationsLoading(false)
      }
      const queryBase = [
        where('academyId', '==', currentAcademyId),
        where('status', '==', 'active'),
      ]
      const unsubscribeTeacher = onSnapshot(
        query(
          collection(db, 'privateLessonReservations'),
          ...queryBase,
          where('teacher', '==', teacherName)
        ),
        (snapshot) => {
          teacherSnapshot = snapshot
          mergeTeacherRows()
        },
        (error) => {
          console.error('privateLessonReservations(teacher) 불러오기 실패:', error)
          teacherSnapshot = { docs: [] }
          mergeTeacherRows()
        }
      )
      const unsubscribeTeacherName = onSnapshot(
        query(
          collection(db, 'privateLessonReservations'),
          ...queryBase,
          where('teacherName', '==', teacherName)
        ),
        (snapshot) => {
          teacherNameSnapshot = snapshot
          mergeTeacherRows()
        },
        (error) => {
          console.error('privateLessonReservations(teacherName) 불러오기 실패:', error)
          teacherNameSnapshot = { docs: [] }
          mergeTeacherRows()
        }
      )
      return () => {
        unsubscribeTeacher()
        unsubscribeTeacherName()
      }
    } else {
      setPrivateLessonReservations([])
      setPrivateLessonReservationsLoading(false)
      return
    }
  }, [currentAcademyId, user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    if (!user?.uid || !isValidOperationalAcademyId(currentAcademyId)) {
      setStudentSummaryGroupStudents([])
      setStudentSummaryGroupLessons([])
      return
    }
    if (!userProfile?.role) {
      setStudentSummaryGroupStudents([])
      setStudentSummaryGroupLessons([])
      return
    }

    const role = userProfile.role
    const teacherName = String(userProfile.teacherName ?? '').trim()

    if (role === 'admin') {
      let active = true
      const unsubGs = onSnapshot(
        query(
          collection(db, 'groupStudents'),
          where('academyId', '==', currentAcademyId)
        ),
        (snapshot) => {
          if (!active) return
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          setStudentSummaryGroupStudents(rows)
        },
        (error) => {
          if (!active) return
          console.error('studentSummary groupStudents 불러오기 실패:', error)
          setStudentSummaryGroupStudents([])
        }
      )
      getDocs(
        query(
          collection(db, 'groupLessons'),
          where('academyId', '==', currentAcademyId)
        )
      )
        .then((snapshot) => {
          if (!active) return
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          })).filter(isVisibleGroupLessonForActiveViews)
          setStudentSummaryGroupLessons(rows)
        })
        .catch((error) => {
          if (!active) return
          console.error('studentSummary groupLessons 불러오기 실패:', error)
          setStudentSummaryGroupLessons([])
        })
      return () => {
        active = false
        unsubGs()
      }
    }

    if (role === 'teacher' && teacherName) {
      let active = true
      const ids = groupClasses.map((g) => g.id).filter(Boolean)
      if (ids.length === 0) {
        setStudentSummaryGroupStudents([])
        setStudentSummaryGroupLessons([])
        return
      }

      const chunks = []
      for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10))
      }

      const chunkMapsGs = new Map()
      const chunkMapsGl = new Map()

      const mergeGs = () => {
        const byId = new Map()
        for (let i = 0; i < chunks.length; i++) {
          const m = chunkMapsGs.get(i)
          if (!m) continue
          for (const row of m.values()) {
            byId.set(row.id, row)
          }
        }
        setStudentSummaryGroupStudents(Array.from(byId.values()))
      }

      const mergeGl = () => {
        const byId = new Map()
        for (let i = 0; i < chunks.length; i++) {
          const m = chunkMapsGl.get(i)
          if (!m) continue
          for (const row of m.values()) {
            byId.set(row.id, row)
          }
        }
        setStudentSummaryGroupLessons(Array.from(byId.values()))
      }

      const unsubs = []

      chunks.forEach((chunk, chunkIndex) => {
        const qGs = query(
          collection(db, 'groupStudents'),
          where('academyId', '==', currentAcademyId),
          where('groupClassId', 'in', chunk)
        )
        unsubs.push(
          onSnapshot(
            qGs,
            (snapshot) => {
              if (!active) return
              const m = new Map()
              snapshot.docs.forEach((docItem) => {
                m.set(docItem.id, { id: docItem.id, ...docItem.data() })
              })
              chunkMapsGs.set(chunkIndex, m)
              mergeGs()
            },
            (error) => {
              if (!active) return
              console.error('studentSummary groupStudents 불러오기 실패:', error)
              chunkMapsGs.set(chunkIndex, new Map())
              mergeGs()
            }
          )
        )

        const qGl = query(
          collection(db, 'groupLessons'),
          and(
            where('academyId', '==', currentAcademyId),
            or(where('groupClassId', 'in', chunk), where('groupClassID', 'in', chunk))
          )
        )
        getDocs(qGl)
          .then((snapshot) => {
            if (!active) return
            const m = new Map()
            snapshot.docs.forEach((docItem) => {
              const row = { id: docItem.id, ...docItem.data() }
              if (isVisibleGroupLessonForActiveViews(row)) {
                m.set(docItem.id, row)
              }
            })
            chunkMapsGl.set(chunkIndex, m)
            mergeGl()
          })
          .catch((error) => {
            if (!active) return
            console.error('studentSummary groupLessons 불러오기 실패:', error)
            chunkMapsGl.set(chunkIndex, new Map())
            mergeGl()
          })
      })

      return () => {
        active = false
        unsubs.forEach((u) => u())
      }
    }

    setStudentSummaryGroupStudents([])
    setStudentSummaryGroupLessons([])
	  }, [currentAcademyId, user?.uid, userProfile?.role, userProfile?.teacherName, groupClasses])

  const todayYmd = getTodayStorageDateString()

  const activeGroupClassIds = useMemo(() => {
    return new Set(
      groupClasses
        .filter(isActiveGroupClassRow)
        .map((groupClass) => String(groupClass.id || '').trim())
        .filter(Boolean)
    )
  }, [groupClasses])

  const studentSummaryTodayGroupLessons = useMemo(() => {
    return studentSummaryGroupLessons.filter((lesson) => {
      if (String(lesson.academyId || '').trim() !== String(currentAcademyId || '').trim()) return false
      if (!isVisibleGroupLessonForActiveViews(lesson)) return false
      const groupClassId = getGroupLessonGroupId(lesson)
      if (!groupClassId || !activeGroupClassIds.has(groupClassId)) return false
      return String(lesson.date || '').trim() === todayYmd
    })
  }, [activeGroupClassIds, currentAcademyId, studentSummaryGroupLessons, todayYmd])

  useEffect(() => {
    const role = String(userProfile?.role || '').trim().toLowerCase()
    const teacherName = String(userProfile?.teacherName || '').trim()

    if (
      !user?.uid ||
      !isValidOperationalAcademyId(currentAcademyId) ||
      role !== 'teacher' ||
      !teacherName
    ) {
      setTodayDashboardGroupLessons([])
      setTodayDashboardGroupLessonsLoading(false)
      return
    }

    const groupClassIds = groupClasses
      .filter(isActiveGroupClassRow)
      .map((groupClass) => String(groupClass.id || '').trim())
      .filter(Boolean)
    if (groupClassIds.length === 0) {
      setTodayDashboardGroupLessons([])
      setTodayDashboardGroupLessonsLoading(false)
      return
    }

    let active = true
    setTodayDashboardGroupLessonsLoading(true)
    const chunks = chunkArray(groupClassIds, TODAY_RESERVATION_QUERY_CHUNK_SIZE)

    Promise.allSettled(
      chunks.map((chunk) =>
        getDocs(
          query(
            collection(db, 'groupLessons'),
            where('academyId', '==', currentAcademyId),
            where('groupClassId', 'in', chunk)
          )
        )
      )
    )
      .then((results) => {
        if (!active) return
        const byId = new Map()
        results.forEach((result) => {
          if (result.status !== 'fulfilled') {
            console.error('today teacher groupLessons 불러오기 실패:', result.reason)
            return
          }
          result.value.docs.forEach((docItem) => {
            const lesson = { id: docItem.id, ...docItem.data() }
            const lessonAcademyId = String(lesson.academyId || '').trim()
            const lessonTeacher = String(lesson.teacher || lesson.teacherName || '').trim()
            if (lessonAcademyId !== String(currentAcademyId || '').trim()) return
            if (!isVisibleGroupLessonForActiveViews(lesson)) return
            if (String(lesson.date || '').trim() !== todayYmd) return
            if (lessonTeacher && lessonTeacher !== teacherName) return
            byId.set(docItem.id, lesson)
          })
        })
        setTodayDashboardGroupLessons(Array.from(byId.values()))
        setTodayDashboardGroupLessonsLoading(false)
      })
      .catch((error) => {
        if (!active) return
        console.error('today teacher groupLessons 불러오기 실패:', error)
        setTodayDashboardGroupLessons([])
        setTodayDashboardGroupLessonsLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    currentAcademyId,
    groupClasses,
    todayYmd,
    user?.uid,
    userProfile?.role,
    userProfile?.teacherName,
  ])

  const todayGroupLessons = useMemo(() => {
    const role = String(userProfile?.role || '').trim().toLowerCase()
    return role === 'teacher' ? todayDashboardGroupLessons : studentSummaryTodayGroupLessons
  }, [studentSummaryTodayGroupLessons, todayDashboardGroupLessons, userProfile?.role])

  useEffect(() => {
    const role = String(userProfile?.role || '').trim().toLowerCase()
    if (
      !user?.uid ||
      !isValidOperationalAcademyId(currentAcademyId) ||
      !(role === 'admin' || role === 'teacher')
    ) {
      setTodayGroupLessonReservations([])
      setTodayGroupLessonReservationsLoading(false)
      return
    }

    const lessonIds = todayGroupLessons.map((lesson) => String(lesson.id || '').trim()).filter(Boolean)
    if (lessonIds.length === 0) {
      setTodayGroupLessonReservations([])
      setTodayGroupLessonReservationsLoading(false)
      return
    }

    setTodayGroupLessonReservationsLoading(true)
    const chunks = chunkArray(lessonIds, TODAY_RESERVATION_QUERY_CHUNK_SIZE)
    const chunkMaps = new Map()
    const unsubs = []

    const mergeRows = () => {
      if (chunkMaps.size < chunks.length) return
      const byId = new Map()
      for (const chunkMap of chunkMaps.values()) {
        for (const row of chunkMap.values()) byId.set(row.id, row)
      }
      setTodayGroupLessonReservations(Array.from(byId.values()))
      setTodayGroupLessonReservationsLoading(false)
    }

    chunks.forEach((chunk, chunkIndex) => {
      const q = query(
        collection(db, 'groupLessonReservations'),
        where('academyId', '==', currentAcademyId),
        where('lessonId', 'in', chunk),
        where('status', '==', 'active')
      )

      unsubs.push(
        onSnapshot(
          q,
          (snapshot) => {
            const rows = new Map()
            snapshot.docs.forEach((docItem) => {
              rows.set(docItem.id, { id: docItem.id, ...docItem.data() })
            })
            chunkMaps.set(chunkIndex, rows)
            mergeRows()
          },
          (error) => {
            console.error('today groupLessonReservations 불러오기 실패:', error)
            chunkMaps.set(chunkIndex, new Map())
            mergeRows()
          }
        )
      )
    })

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe())
    }
  }, [currentAcademyId, todayGroupLessons, user?.uid, userProfile?.role])
	
  const studentIdLookup = useMemo(() => {
    const map = new Map()
    const duplicatedKeys = new Set()

    for (const student of privateStudents) {
      const key = makeStudentKey(student.name, student.teacher)
      if (!key) continue

      if (map.has(key)) {
        duplicatedKeys.add(key)
      } else {
        map.set(key, student.id)
      }
    }

    // 이름+선생님 조합이 중복되면 자동 연결하지 않음
    duplicatedKeys.forEach((key) => map.set(key, null))
    return map
  }, [privateStudents])

  const studentById = useMemo(() => {
    const map = new Map()
    privateStudents.forEach((student) => {
      map.set(student.id, student)
    })
    return map
  }, [privateStudents])

  const {
    groupLessonModal,
    groupLessonForm,
    setGroupLessonForm,
    groupLessonFormErrors,
    busyGroupLessonId,
    setBusyGroupLessonId,
    groupLessonSeriesModalOpen,
    groupLessonSeriesForm,
    setGroupLessonSeriesForm,
    groupLessonSeriesFormErrors,
    busyGroupLessonSeries,
    groupLessonPurgeModalOpen,
    groupLessonPurgeFromDate,
    setGroupLessonPurgeFromDate,
    groupLessonPurgeFormErrors,
    busyGroupLessonPurge,
    openGroupLessonAddModal,
    openGroupLessonEditModal,
    closeGroupLessonModal,
    submitGroupLessonModal,
    openGroupLessonSeriesModal,
    closeGroupLessonSeriesModal,
    submitGroupLessonSeriesModal,
    openGroupLessonPurgeModal,
    closeGroupLessonPurgeModal,
    submitGroupLessonPurgeFromDate,
    isGroupLessonModalSubmitting,
    isGroupLessonSeriesSubmitting,
  } = useGroupLessonManagementFlow({
    activeSection,
    userProfile,
    currentAcademyId,
    selectedGroupClass,
    groupLessons,
    createGroupLessonsInDateRange,
  })

  const {
    groupStudentAddModalOpen,
    groupStudentForm,
    setGroupStudentForm,
    groupStudentFormErrors,
    busyGroupStudentId: busyAddingGroupStudentId,
    groupStudentEligiblePackages,
    groupStudentSelectedPackagePreview,
    openGroupStudentAddModal,
    closeGroupStudentAddModal,
    submitGroupStudentAdd,
    isGroupStudentModalSubmitting,
  } = useGroupStudentAddFlow({
    activeSection,
    userProfile,
    currentAcademyId,
    selectedGroupClass,
    studentPackages,
    groupStudents,
    groupLessons,
  })

  const {
    groupStudentManageModal,
    groupStudentManageForm,
    groupStudentManageFormErrors,
    busyGroupStudentManageId,
    openGroupStudentManageModal,
    closeGroupStudentManageModal,
    submitGroupStudentManageModal,
    updateGroupStudentManageField,
    addGroupStudentManageExcludedDate,
    removeGroupStudentManageExcludedDate,
    isGroupStudentManageSubmitting,
  } = useGroupStudentManagementFlow({
    userProfile,
    currentAcademyId,
  })

  const {
    groupLessonAttendanceModal,
    busyGroupAttendanceStudentId,
    closeGroupLessonAttendanceModal,
    isPastGroupLesson,
    openGroupLessonAttendanceModal,
    openCalendarGroupLessonAttendance,
    applyGroupLessonAttendanceDeduction,
    applyGroupLessonAttendanceUndo,
    releaseGroupLessonFixedSeat,
    restoreGroupLessonFixedSeat,
  } = useGroupAttendanceFlow({
    activeSection,
    userProfile,
    currentAcademyId,
    groupClasses,
    selectedGroupClass,
    setSelectedGroupClass,
    groupLessons,
    studentSummaryGroupStudents,
    studentPackages,
    addCreditTransaction,
  })

  const {
    groupReservationModal,
    busyGroupReservationId,
    canManageGroupReservations,
    openGroupLessonReservationAddModal,
    openGroupLessonReservationViewModal,
    closeGroupLessonReservationModal,
    reserveGroupLessonSeat,
    cancelGroupLessonSeat,
  } = useGroupReservationFlow({
    activeSection,
    userProfile,
    currentAcademyId,
  })

  const {
    sortedGroupClasses,
    sortedGroupStudentsForSelectedClass,
    sortedGroupLessonsForSelectedClass,
    groupLessonSeriesPlannedCount,
    groupLessonForAttendanceModal,
    groupLessonAttendanceModalRows,
    groupLessonSeatAvailabilityById,
  } = useGroupsSectionViewModel({
    groupClasses,
    groupStudents,
    groupLessons,
    selectedGroupClass,
    studentPackages,
    groupLessonSeriesForm,
    groupLessonSeriesModalOpen,
    groupLessonAttendanceModal,
    groupLessonReservations,
  })

  const studentsSectionViewModel = useStudentsSectionViewModel({
    privateStudents,
    studentPackages,
    lessons,
    privateLessonReservations,
    studentSummaryGroupStudents,
    studentSummaryGroupLessons,
    groupClasses,
    userProfile,
  })

  const isAdmin = isDashboardAdminProfile(userProfile)
  const canViewPaymentFields = canViewBillingFields(userProfile)
  const teacherGroupClassKey = normalizeText(userProfile?.teacherName || '')
  const canManageOwnGroupClasses =
    !isAdmin && isDashboardTeacherProfile(userProfile) && Boolean(teacherGroupClassKey)
  const canUseStudentPackageCountSection =
    canManageOwnGroupClasses && userProfile?.canEditStudentPackageCounts === true
  const canAddStudent = isAdmin
  const canEditStudent = isAdmin
  const canDeleteStudent = isAdmin
  const canEditLesson = isAdmin
  const canDeleteLesson = isAdmin
  const canManageAttendance = isAdmin
  const canManagePrivateLessonDeductions =
    isAdmin ||
    (canManageOwnGroupClasses && userProfile?.canManageOwnLessonDeductions === true)
  const canCreateLessonDirectly = isAdmin
  const requiresLessonApproval = userProfile?.requiresLessonApproval === true
  const canUseDirectLessonCreation = canCreateLessonDirectly && !requiresLessonApproval
  const canManageGroupClasses = isAdmin || canManageOwnGroupClasses
  const canDeleteGroupClasses = isAdmin
  const showPrivateLessonAddInCalendar = isAdmin
  const busyGroupStudentId = busyRemovingGroupStudentId || busyAddingGroupStudentId

  const todayGroupLessonById = useMemo(() => {
    return new Map(todayGroupLessons.map((lesson) => [lesson.id, lesson]))
  }, [todayGroupLessons])

  const privateStudentById = useMemo(() => {
    return new Map(privateStudents.map((student) => [student.id, student]))
  }, [privateStudents])

  const privateSlotById = useMemo(() => {
    return new Map(privateLessonSlots.map((slot) => [slot.id, slot]))
  }, [privateLessonSlots])

  const todayScheduleItems = useMemo(() => {
    const scopedAcademyId = String(currentAcademyId || '').trim()
    const privateLessonItems = lessons
      .filter(
        (lesson) =>
          String(lesson.academyId || '').trim() === scopedAcademyId &&
          getLessonStorageDateString(lesson) === todayYmd
      )
      .map((lesson) => ({
        id: `private-lesson-${lesson.id}`,
        date: getLessonStorageDateString(lesson) || todayYmd,
        time: lessonTimeInputValue(lesson) || '-',
        typeLabel: '1:1 수업',
        sourceKind: 'privateLesson',
        sessionLabel: formatLessonSessionNumber(lesson),
        isDeductCancelled: lesson.isDeductCancelled === true,
        isLastLesson:
          lesson.isDeductCancelled !== true &&
          (() => {
            const pkg = lesson.packageId
              ? studentPackages.find((p) => p.id === lesson.packageId)
              : null
            return Boolean(
              pkg &&
                pkg.packageType === 'private' &&
                Number(pkg.remainingCount ?? 0) === 1
            )
          })(),
        studentLabel: getStudentName(lesson),
        teacherLabel: getTeacherName(lesson),
        title: String(lesson.subject || '').trim() || '1:1 수업',
        statusLabel: lesson.isDeductCancelled === true ? '차감취소' : '수업 예정',
      }))

    const groupLessonItems = todayGroupLessons.map((lesson) => {
      const className = String(lesson.groupClassName || '').trim()
      const subject = String(lesson.subject || '').trim()
      return {
        id: `group-lesson-${lesson.id}`,
        date: String(lesson.date || '').trim() || todayYmd,
        time: String(lesson.time || '').trim() || '-',
        typeLabel: '단체반 수업',
        sourceKind: 'groupLesson',
        studentLabel: '-',
        teacherLabel: String(lesson.teacher || lesson.teacherName || '').trim() || '-',
        title: [className, subject].filter(Boolean).join(' · ') || '단체반 수업',
        statusLabel: isNoDeductionCancelledGroupLesson(lesson) ? '휴강 · 차감 없음' : '수업 예정',
      }
    })

    const groupReservationItems = todayGroupLessonReservations
      .filter((reservation) => reservation.status === 'active')
      .map((reservation) => {
        const lesson = todayGroupLessonById.get(reservation.lessonId) || null
        if (!lesson) return null
        const student = privateStudentById.get(String(reservation.studentId || '').trim()) || null
        const className = String(lesson.groupClassName || '').trim()
        const subject = String(lesson.subject || '').trim()
        return {
          id: `group-reservation-${reservation.id}`,
          date: String(lesson.date || reservation.date || '').trim() || todayYmd,
          time: String(lesson.time || reservation.time || '').trim() || '-',
          typeLabel: '단체반 예약',
          sourceKind: 'groupReservation',
          studentLabel:
            String(reservation.studentName || '').trim() ||
            String(student?.name || '').trim() ||
            '-',
          teacherLabel:
            String(reservation.teacher || lesson.teacher || lesson.teacherName || '').trim() || '-',
          title: [className, subject].filter(Boolean).join(' · ') || '단체반 수업',
          statusLabel: '예약 완료',
        }
      })
      .filter(Boolean)

    const approvedPrivateLessonReservationKeys = new Set()
    lessons
      .filter(
        (lesson) =>
          String(lesson.academyId || '').trim() === scopedAcademyId &&
          getLessonStorageDateString(lesson) === todayYmd
      )
      .forEach((lesson) => {
        const reservationId = String(lesson.reservationId || '').trim()
        const slotId = String(lesson.slotId || '').trim()
        if (reservationId) approvedPrivateLessonReservationKeys.add(`reservationId:${reservationId}`)
        if (slotId) approvedPrivateLessonReservationKeys.add(`slotId:${slotId}`)
        const base = [
          todayYmd,
          String(lessonTimeInputValue(lesson) || lesson.time || '').trim(),
          normalizeText(getTeacherName(lesson)),
        ]
        const studentKeys = [
          normalizeText(lesson.studentId || lesson.studentID || ''),
          normalizeText(getStudentName(lesson)),
        ].filter(Boolean)
        studentKeys.forEach((studentKey) => {
          approvedPrivateLessonReservationKeys.add([base[0], base[1], studentKey, base[2]].join('__'))
        })
      })

    const privateReservationItems = privateLessonReservations
      .filter((reservation) => {
        if (reservation.status !== 'active') return false
        const slot = privateSlotById.get(String(reservation.slotId || '').trim()) || null
        const reservationDate = String(reservation.date || slot?.date || '').trim()
        if (reservationDate !== todayYmd) return false
        const reservationId = String(reservation.id || reservation.reservationId || '').trim()
        const slotId = String(reservation.slotId || '').trim()
        if (
          (reservationId &&
            approvedPrivateLessonReservationKeys.has(`reservationId:${reservationId}`)) ||
          (slotId && approvedPrivateLessonReservationKeys.has(`slotId:${slotId}`))
        ) {
          return false
        }
        const duplicateKey = [
          reservationDate,
          String(reservation.time || slot?.time || '').trim(),
          normalizeText(
            reservation.studentName || reservation.student || reservation.studentId || ''
          ),
          normalizeText(
            reservation.teacherName ||
              reservation.teacher ||
              slot?.teacherName ||
              slot?.teacher ||
              ''
          ),
        ].join('__')
        return !approvedPrivateLessonReservationKeys.has(duplicateKey)
      })
      .map((reservation) => {
        const student = privateStudentById.get(String(reservation.studentId || '').trim()) || null
        const slot = privateSlotById.get(String(reservation.slotId || '').trim()) || null
        return {
          id: `private-reservation-${reservation.id}`,
          date: String(reservation.date || slot?.date || '').trim() || todayYmd,
          time: String(reservation.time || slot?.time || '').trim() || '-',
          typeLabel: '1:1 예약',
          sourceKind: 'privateReservation',
          studentLabel: getPrivateReservationStudentLabel(reservation, student),
          teacherLabel: getPrivateReservationTeacherLabel(reservation, slot),
          title: getPrivateReservationSubjectLabel(reservation, slot),
          statusLabel: '예약됨',
        }
      })

    return [
      ...privateLessonItems,
      ...groupLessonItems,
      ...groupReservationItems,
      ...privateReservationItems,
    ].sort((a, b) => {
      const aKey = `${a.time || ''} ${a.typeLabel || ''} ${a.studentLabel || ''} ${a.title || ''}`
      const bKey = `${b.time || ''} ${b.typeLabel || ''} ${b.studentLabel || ''} ${b.title || ''}`
      return aKey.localeCompare(bKey, 'ko')
    })
  }, [
    currentAcademyId,
    lessons,
    privateLessonReservations,
    privateSlotById,
    privateStudentById,
    studentPackages,
    todayGroupLessonById,
    todayGroupLessonReservations,
    todayGroupLessons,
    todayYmd,
  ])

  const todayScheduleSummary = useMemo(() => {
    const items = Array.isArray(todayScheduleItems) ? todayScheduleItems : []
    return {
      privateLessonCount: items.filter(
        (item) =>
          item.sourceKind === 'privateLesson' || item.sourceKind === 'privateReservation'
      ).length,
      groupLessonCount: items.filter((item) => item.sourceKind === 'groupLesson').length,
      deductCancelledCount: items.filter((item) => item.isDeductCancelled === true).length,
      lastLessonCount: items.filter((item) => item.isLastLesson === true).length,
    }
  }, [todayScheduleItems])

  const todaySchedulePanelItems = useMemo(() => {
    if (activeSection !== 'groups') return todayScheduleItems
    return todayScheduleItems.filter((item) => item.sourceKind === 'groupLesson')
  }, [activeSection, todayScheduleItems])

  const todaySchedulePanelSummary = useMemo(() => {
    if (activeSection !== 'groups') return todayScheduleSummary
    return {
      groupLessonCount: todaySchedulePanelItems.filter(
        (item) => item.sourceKind === 'groupLesson'
      ).length,
    }
  }, [activeSection, todaySchedulePanelItems, todayScheduleSummary])

  const todayScheduleLoading =
    loading ||
    groupClassesLoading ||
    todayDashboardGroupLessonsLoading ||
    todayGroupLessonReservationsLoading ||
    privateLessonReservationsLoading

  const {
    studentPackageModalStudent,
    studentPackageForm,
    setStudentPackageForm,
    studentPackageFormErrors,
    busyStudentPackageSubmit,
    openStudentPackageModal,
    closeStudentPackageModal,
    submitStudentPackageModal,
    nextGroupLessonDateByGroupId,
    studentPackageGroupAutoSummary,
    studentPackageModalActiveSameScopeDuplicates,
    postPrivateLessonScheduleModalData,
    postPrivateLessonScheduleForm,
    setPostPrivateLessonScheduleForm,
    postPrivateLessonScheduleErrors,
    busyPostPrivateLessonSchedule,
    closePostPrivateLessonScheduleModal,
    submitPostPrivateLessonSchedule,
    createPrivateLessonsForPackage,
    postGroupReEnrollModalData,
    postGroupReEnrollStartDate,
    setPostGroupReEnrollStartDate,
    postGroupReEnrollErrors,
    busyPostGroupReEnroll,
    closePostGroupReEnrollModal,
    submitPostGroupReEnroll,
    postGroupReEnrollMinStartYmd,
  } = useStudentPackageFlow({
    activeSection,
    userProfile,
    currentAcademyId,
    privateStudents,
    groupClasses,
    studentPackages,
    lessons,
    privateLessonReservations,
    studentSummaryGroupLessons,
    buildGroupPackageCoverageLessons,
    addCreditTransaction,
    recomputePrivatePackageUsage,
    validatePrivateLessonFormFields: (form) =>
      validatePrivateLessonFormFieldsShared(form, { isAdmin }),
  })

  const {
    openStudentAddModal,
    closeStudentModal,
    submitStudentModal,
    openStudentEditModal,
    postStudentCreateModalStudent,
    closePostStudentCreateModal,
    selectPostStudentCreatePrivatePackage,
    selectPostStudentCreateGroupPackage,
    studentModal,
    studentForm,
    setStudentForm,
    studentFormErrors,
    busyStudentId: busyStudentFlowId,
    isStudentModalSubmitting,
  } = useStudentManagementFlow({
    activeSection,
    userProfile,
    currentAcademyId,
    formatLocalYmd,
    studentDocFieldToYmdString,
    teacherSelectOptions,
    openStudentPackageModal,
  })

  const {
    studentPackageEditModalPackage,
    studentPackageEditForm,
    setStudentPackageEditForm,
    studentPackageEditFormErrors,
    busyStudentPackageActionId,
    studentPackageHistoryModalPackage,
    studentPackageHistoryRows,
    studentPackageHistoryLoading,
    openStudentPackageEditModal,
    canEditStudentPackageCountsForPackage,
    studentPackageEditMode,
    closeStudentPackageEditModal,
    submitStudentPackageEditModal,
    endStudentPackage,
    openStudentPackageHistoryModal,
    closeStudentPackageHistoryModal,
  } = useStudentPackageAdminFlow({
    userProfile,
    currentAcademyId,
    addCreditTransaction,
    studentDocFieldToYmdString,
  })

  function openExistingStudentPackageFromAddModal(pkg) {
    if (!pkg?.id) return
    closeStudentPackageModal()
    openStudentPackageEditModal(pkg)
  }

  function goToFixedPrivateAssignmentFromPackageModal() {
    closeStudentPackageModal()
    setActiveSection('privateSlots')
  }

  function goToFixedPrivateAssignmentFromPostPrivateLessonScheduleModal() {
    closePostPrivateLessonScheduleModal()
    setActiveSection('privateSlots')
  }

  const {
    postGroupScheduleRebuildModalData,
    postGroupScheduleRebuildFromDate,
    setPostGroupScheduleRebuildFromDate,
    postGroupScheduleRebuildErrors,
    busyPostGroupScheduleRebuild,
    postGroupScheduleRebuildEffectiveFromYmd,
    openPostGroupScheduleRebuildModal,
    closePostGroupScheduleRebuildModal,
    submitPostGroupScheduleRebuild,
  } = useGroupScheduleRebuildFlow({
    userProfile,
    currentAcademyId,
    fetchGroupLessonsForClassIdMerge,
    createGroupLessonsInDateRange,
  })

  const {
    privateLessonModalOpen,
    privateLessonForm,
    setPrivateLessonForm,
    privateLessonFormErrors,
    busyPrivateLessonAdd,
    privateLessonEditModal,
    privateLessonEditForm,
    setPrivateLessonEditForm,
    privateLessonEditFormErrors,
    busyPrivateLessonEditId,
    privateLessonEligiblePackages,
    privateLessonSelectedPackagePreview,
    openPrivateLessonModal,
    closePrivateLessonModal,
    submitPrivateLessonModal,
    openPrivateLessonEditModal,
    closePrivateLessonEditModal,
    submitPrivateLessonEditModal,
    isPrivateLessonModalSubmitting,
    isPrivateLessonEditSubmitting,
  } = usePrivateLessonFlow({
    selectedDate,
    getStorageDateStringFromDate,
    userProfile,
    currentAcademyId,
    showPrivateLessonAddInCalendar,
    canEditLesson,
    sortedPrivateStudents: studentsSectionViewModel.sortedPrivateStudents,
    studentPackages,
    createPrivateLessonsForPackage,
    recomputePrivatePackageUsage,
  })

  const busyPrivateLessonCrudId = busyDeletingPrivateLessonId || busyPrivateLessonEditId

  const selectedDateString = useMemo(
    () => getStorageDateStringFromDate(selectedDate),
    [selectedDate]
  )

  const {
    groupModal,
    groupForm,
    setGroupForm,
    groupFormErrors,
    setGroupFormErrors,
    openGroupAddModal,
    openGroupEditModal,
    closeGroupModal,
    submitGroupModal,
    isGroupModalSubmitting,
  } = useGroupManagementFlow({
    activeSection,
    userProfile,
    currentAcademyId,
    busyGroupId,
    setBusyGroupId,
    selectedDateString,
    groupLessons,
    createGroupLessonsInDateRange,
    openPostGroupScheduleRebuildModal,
  })

  const selectedDateDisplayString = useMemo(
    () =>
      new Intl.DateTimeFormat('ko-KR', {
        timeZone: SCHOOL_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
      }).format(selectedDate),
    [selectedDate]
  )

  const { lessonsCountByDate, lessonsPreviewByDate, displayedLessons } =
    useCalendarSectionViewModel({
      lessons,
      privateLessonReservations,
      privateLessonSlots,
      studentSummaryGroupLessons,
      groupClasses,
      selectedDateString,
      showOnlySelectedDate,
      userProfile,
    })

  const calendarDays = useMemo(
    () => getCalendarDays(calendarMonth),
    [calendarMonth]
  )

  const calendarMonthLabel = useMemo(

    () =>
      new Intl.DateTimeFormat('ko-KR', {
        timeZone: SCHOOL_TIME_ZONE,
        year: 'numeric',
        month: 'long',
      }).format(calendarMonth),
    [calendarMonth]
  )

  function getMatchedStudentId(lesson) {
  if (lesson.studentId) return lesson.studentId

  const key = makeStudentKey(
    getStudentName(lesson),
    getTeacherName(lesson)
  )

  return studentIdLookup.get(key) || null
}
  function getMatchedStudent(lesson) {
    const studentId = getMatchedStudentId(lesson)
    if (!studentId) return null
    return studentById.get(studentId) || null
  }
  

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  async function handleMigrateLessons() {
    if (!isAdmin) {
      alert('관리자만 예전 수업 데이터 변환을 실행할 수 있습니다.')
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      setMigrating(true)

      const snapshot = await getDocs(
        query(
          collection(db, 'lessons'),
          where('academyId', '==', scopedAcademyId)
        )
      )
      const batch = writeBatch(db)
      let changedCount = 0

      snapshot.docs.forEach((lessonDoc) => {
        const data = lessonDoc.data()
        const patch = {}

        // legacy date/time -> startAt Timestamp
        if (!data.startAt && data.date) {
          const parsed = parseLegacyLessonToDate(data.date, data.time)
          if (parsed) {
            patch.startAt = Timestamp.fromDate(parsed)
          }
        }

        // 이름 필드 표준화
        if (!data.studentName && data.student) {
          patch.studentName = data.student
        }

        if (!data.teacherName && data.teacher) {
          patch.teacherName = data.teacher
        }

        // studentId 자동 연결
        if (!data.studentId && data.student && data.teacher) {
          const matchedId = studentIdLookup.get(makeStudentKey(data.student, data.teacher))
          if (matchedId) {
            patch.studentId = matchedId
          }
        }

        if (Object.keys(patch).length > 0) {
          patch.updatedAt = serverTimestamp()
          batch.update(lessonDoc.ref, patch)
          changedCount += 1
        }
      })

      if (changedCount === 0) {
        alert(
          '변환할 수업이 없습니다. 이미 날짜·시간과 학생 연결이 맞춰져 있을 수 있습니다.'
        )
        return
      }

      await batch.commit()
      alert(`수업 ${changedCount}건의 정보를 보완했습니다.`)
    } catch (error) {
      console.error('lesson migration 실패:', error)
      alert(`수업 데이터 변환에 실패했습니다: ${error.message}`)
    } finally {
      setMigrating(false)
    }
  }

  async function handleGroupLegacyBackfill() {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 실행할 수 있습니다.')
      return
    }
    if (
      !window.confirm(
        '그룹 레거시 데이터 보정을 실행할까요?\n\n' +
          '· groupLessons: groupClassId 보강, generationKind(seriesID 기준)\n' +
          '· groupStudents: groupClassId(classID 기준), 기본 운영 필드\n\n' +
          '한 번 실행하면 대부분의 문서가 갱신됩니다. 계속할까요?'
      )
    ) {
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      setBusyGroupLegacyBackfill(true)

      const glDocs = await fetchAllDocumentsInCollection(db, 'groupLessons', scopedAcademyId)
      const gsDocs = await fetchAllDocumentsInCollection(db, 'groupStudents', scopedAcademyId)

      const glOps = []
      for (const docSnap of glDocs) {
        const data = docSnap.data()
        const patch = {}
        const hasCanonicalGid =
          data.groupClassId != null && String(data.groupClassId).trim() !== ''
        const hasLegacyGid =
          data.groupClassID != null && String(data.groupClassID).trim() !== ''
        if (!hasCanonicalGid && hasLegacyGid) {
          patch.groupClassId = String(data.groupClassID).trim()
        }
        const genMissing =
          data.generationKind == null || String(data.generationKind).trim() === ''
        if (genMissing && data.seriesID != null && String(data.seriesID).trim() !== '') {
          patch.generationKind = 'recurring'
        }
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = serverTimestamp()
          glOps.push({ ref: docSnap.ref, patch })
        }
      }

      const gsOps = []
      for (const docSnap of gsDocs) {
        const data = docSnap.data()
        const patch = {}
        const hasCanonicalGid =
          data.groupClassId != null && String(data.groupClassId).trim() !== ''
        const hasClassId = data.classID != null && String(data.classID).trim() !== ''
        if (!hasCanonicalGid && hasClassId) {
          patch.groupClassId = String(data.classID).trim()
        }
        if (data.studentStatus == null || String(data.studentStatus).trim() === '') {
          patch.studentStatus = 'active'
        }
        if (data.excludedDates == null) {
          patch.excludedDates = []
        }
        if (data.breakStartDate == null) {
          patch.breakStartDate = ''
        }
        if (data.breakEndDate == null) {
          patch.breakEndDate = ''
        }
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = serverTimestamp()
          gsOps.push({ ref: docSnap.ref, patch })
        }
      }

      let glCommitted = 0
      for (let i = 0; i < glOps.length; i += GROUP_BACKFILL_BATCH_SIZE) {
        const batch = writeBatch(db)
        const chunk = glOps.slice(i, i + GROUP_BACKFILL_BATCH_SIZE)
        for (const { ref, patch } of chunk) {
          batch.update(ref, patch)
        }
        await batch.commit()
        glCommitted += chunk.length
      }

      let gsCommitted = 0
      for (let i = 0; i < gsOps.length; i += GROUP_BACKFILL_BATCH_SIZE) {
        const batch = writeBatch(db)
        const chunk = gsOps.slice(i, i + GROUP_BACKFILL_BATCH_SIZE)
        for (const { ref, patch } of chunk) {
          batch.update(ref, patch)
        }
        await batch.commit()
        gsCommitted += chunk.length
      }

      alert(
        `그룹 레거시 보정 완료.\n\n` +
          `groupLessons: 스캔 ${glDocs.length}건 · 업데이트 ${glCommitted}건\n` +
          `groupStudents: 스캔 ${gsDocs.length}건 · 업데이트 ${gsCommitted}건`
      )
    } catch (error) {
      console.error('그룹 레거시 보정 실패:', error)
      alert(`그룹 레거시 보정 실패: ${error.message}`)
    } finally {
      setBusyGroupLegacyBackfill(false)
    }
  }

  async function handleDeductionToggle(lesson) {
    const adminUser = userProfile?.role === 'admin'
    const lessonTeacher = normalizeText(getTeacherName(lesson))
    const myTeacher = normalizeText(userProfile?.teacherName || '')
    const teacherCanManageOwnLesson =
      !adminUser &&
      userProfile?.role === 'teacher' &&
      userProfile?.canManageOwnLessonDeductions === true &&
      myTeacher &&
      lessonTeacher &&
      lessonTeacher === myTeacher

    if (!(adminUser || teacherCanManageOwnLesson)) {
      alert('출결 관리 권한이 없습니다.')
      return
    }

    const studentId = getMatchedStudentId(lesson)
    const resolvedStudentId = String(lesson.studentId || '').trim() || studentId || ''
    const currentlyCancelled = Boolean(lesson.isDeductCancelled)
    const fallbackPackage =
      adminUser && !String(lesson.packageId || '').trim() && resolvedStudentId
        ? findActivePrivatePackageForTeacher({
            studentPackages,
            academyId: currentAcademyId,
            studentId: resolvedStudentId,
            teacher: getTeacherName(lesson),
            requireRemaining: currentlyCancelled,
          })
        : null
    const packageId = String(lesson.packageId || fallbackPackage?.id || '').trim()
    const usePackagePath = Boolean(packageId)

    if (!usePackagePath) {
      alert(
        '이 수업은 연결된 개인 수강권이 없어 차감할 수 없습니다. 먼저 같은 선생님의 개인 수강권을 연결해 주세요.'
      )
      return
    }

    let nextCancelled
    let nextMemo

    if (currentlyCancelled) {
      nextCancelled = false
      nextMemo = ''
    } else {
      const input = window.prompt('차감취소 메모를 입력하세요.', lesson.deductMemo || '')
      if (input === null) return
      nextCancelled = true
      nextMemo = input.trim()
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(lesson, scopedAcademyId, '수업')
      setBusyLessonId(lesson.id)

      const batch = writeBatch(db)
      const lessonRef = doc(db, 'lessons', lesson.id)
      const lessonSnap = await getDoc(lessonRef)
      if (!lessonSnap.exists()) throw new Error('수업을 찾을 수 없습니다.')
      assertSameAcademy(lessonSnap.data(), scopedAcademyId, '수업')

      if (usePackagePath) {
        const pkgRef = doc(db, 'studentPackages', packageId)
        const pkgSnap = await getDoc(pkgRef)
        if (!pkgSnap.exists()) throw new Error('연결된 수강권을 찾을 수 없습니다.')
        const selectedPackage =
          studentPackages.find((p) => p.id === packageId) ||
          fallbackPackage ||
          { id: packageId, ...pkgSnap.data() }
        assertSameAcademy(selectedPackage, scopedAcademyId, '수강권')
        assertSameAcademy(pkgSnap.data(), scopedAcademyId, '수강권')
        if (selectedPackage.packageType !== 'private') {
          alert('개인 수강권이 아닙니다.')
          return
        }
        if (!resolvedStudentId) {
          alert(
            '이 수업은 학생 정보와 연결되어 있지 않아 차감할 수 없습니다. 관리자에게 문의해 주세요.'
          )
          return
        }
        const pkgSid = String(selectedPackage.studentId || '').trim()
        if (pkgSid !== resolvedStudentId) {
          alert('수업의 학생과 수강권의 학생이 일치하지 않습니다.')
          return
        }
        const pkgTeacherKeys = getPrivateTeacherIdentityKeys(selectedPackage)
        const lessonTeacherKeys = getPrivateTeacherIdentityKeys(lesson)
        if (
          pkgTeacherKeys.length === 0 ||
          lessonTeacherKeys.length === 0 ||
          !privateTeacherIdentitiesOverlap(selectedPackage, lesson)
        ) {
          alert('수업 담당 선생님과 수강권 담당 선생님이 일치하지 않습니다.')
          return
        }
        const pkgTeacher = pkgTeacherKeys[0]
        if (!adminUser) {
          const myT = normalizeText(userProfile?.teacherName || '')
          if (!myT || !pkgTeacherKeys.includes(myT)) {
            alert('본인 담당 수강권만 차감 처리할 수 있습니다.')
            return
          }
        }
        if (currentlyCancelled) {
          let activeReservationSnapshot = null
          try {
            activeReservationSnapshot = await getDocs(
              query(
                collection(db, 'privateLessonReservations'),
                where('academyId', '==', scopedAcademyId),
                where('studentId', '==', resolvedStudentId),
                where('status', '==', 'active')
              )
            )
          } catch (error) {
            console.warn('차감복구 전 보충 예약 확인 실패:', error)
            alert('이미 보충 예약으로 사용되어 차감복구할 수 없습니다.')
            return
          }
          const activeReservationById = new Map()
          privateLessonReservations.forEach((reservation) => {
            const reservationId = String(reservation.id || reservation.reservationId || '').trim()
            if (reservationId) activeReservationById.set(reservationId, reservation)
          })
          activeReservationSnapshot.docs.forEach((docSnap) => {
            activeReservationById.set(docSnap.id, { id: docSnap.id, ...docSnap.data() })
          })
          const activeReservationsUsingPackage = Array.from(activeReservationById.values()).filter((reservation) => {
            if (String(reservation.academyId || '').trim() !== scopedAcademyId) return false
            if (String(reservation.status || '').trim() !== 'active') return false
            if (String(reservation.studentId || '').trim() !== resolvedStudentId) return false
            if (String(reservation.packageId || reservation.deductionPackageId || '').trim() !== packageId) {
              return false
            }
            if (getPrivateTeacherIdentityKeys(reservation).length === 0 || lessonTeacherKeys.length === 0) {
              return true
            }
            return privateTeacherIdentitiesOverlap(reservation, lesson)
          })
          if (activeReservationsUsingPackage.length > 0) {
            alert('이미 보충 예약으로 사용되어 차감복구할 수 없습니다.')
            return
          }
          const rawRemaining = Number(pkgSnap.data()?.remainingCount ?? selectedPackage.remainingCount ?? 0)
          const remainingCount = Number.isFinite(rawRemaining) ? rawRemaining : 0
          if (remainingCount <= activeReservationsUsingPackage.length) {
            alert('이미 보충 예약으로 사용되어 차감복구할 수 없습니다.')
            return
          }
        }

        const lessonPatch = {
          isDeductCancelled: nextCancelled,
          deductMemo: nextMemo,
          updatedAt: serverTimestamp(),
        }
        if (!String(lesson.packageId || '').trim()) {
          lessonPatch.studentId = resolvedStudentId
          lessonPatch.studentName = getStudentName(lesson)
          lessonPatch.teacherName = normalizeText(getTeacherName(lesson))
          lessonPatch.packageId = packageId
          lessonPatch.packageType = 'private'
          lessonPatch.packageTitle = String(selectedPackage.title || '고정 1:1')
          lessonPatch.billingType = 'private'
        }
        batch.update(lessonRef, lessonPatch)
        if (adminUser) {
          const packageDataForCount = pkgSnap.data()
          const usedBefore = Number(packageDataForCount.usedCount ?? selectedPackage.usedCount ?? 0)
          const remainingBefore = Number(
            packageDataForCount.remainingCount ?? selectedPackage.remainingCount ?? 0
          )
          const totalBefore = Number(packageDataForCount.totalCount ?? selectedPackage.totalCount ?? 0)
          const safeUsedBefore = Number.isFinite(usedBefore) ? Math.max(0, usedBefore) : 0
          const safeRemainingBefore = Number.isFinite(remainingBefore)
            ? Math.max(0, remainingBefore)
            : 0
          const safeTotalBefore = Number.isFinite(totalBefore) ? Math.max(0, totalBefore) : 0
          const usedAfter = nextCancelled
            ? Math.max(0, safeUsedBefore - 1)
            : safeUsedBefore + 1
          const remainingAfter = nextCancelled
            ? Math.min(safeTotalBefore, safeRemainingBefore + 1)
            : Math.max(0, safeRemainingBefore - 1)
          batch.update(pkgRef, {
            usedCount: usedAfter,
            remainingCount: remainingAfter,
            status: getNextStudentPackageStatus(packageDataForCount.status, remainingAfter),
            updatedAt: serverTimestamp(),
          })
        }
      }

      await batch.commit()

      if (usePackagePath) {
        await recomputePrivatePackageUsage(packageId, currentAcademyId)
        const pkgForLog = studentPackages.find((p) => p.id === packageId)
        if (pkgForLog) {
          const datePart = [lesson.date, lesson.time, lesson.subject]
            .filter(Boolean)
            .join(' ')
          try {
            await addCreditTransaction({
              studentId: resolvedStudentId,
              studentName: String(pkgForLog.studentName || '').trim() || '-',
              teacher: normalizeText(pkgForLog.teacher || ''),
              packageId,
              packageType: pkgForLog.packageType || 'private',
              sourceType: 'lesson',
              sourceId: lesson.id,
              actionType: nextCancelled
                ? 'private_deduct_cancel'
                : 'private_deduct_restore',
              deltaCount: nextCancelled ? 1 : -1,
              memo: datePart ? `개인 수업 ${datePart}` : '개인 수업 차감 토글',
            })
          } catch (creditError) {
            console.warn('creditTransactions 기록 실패(차감 처리는 반영됨):', creditError)
          }
        }
      }
    } catch (error) {
      console.error('차감 처리 실패:', error)
      alert(`차감 처리 실패: ${error.message}`)
    } finally {
      setBusyLessonId(null)
    }
  }

  function formatLocalYmd(d) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function studentDocFieldToYmdString(value) {
    if (value == null || value === '') return ''
    if (typeof value === 'string') return value.trim()
    if (typeof value.toDate === 'function') {
      return formatLocalYmd(value.toDate())
    }
    return ''
  }

  function formatStudentFirstRegisteredForTable(value) {
    const ymd = studentDocFieldToYmdString(value)
    return ymd || '-'
  }

  function formatStudentPackageCellSummary(count, remainingTotal) {
    const c = Number(count) || 0
    if (c <= 0) return '단체 수강권 등록 필요'
    const rem = Number(remainingTotal) || 0
    return `${c}개 / 남은 ${rem}회`
  }

  async function fetchGroupLessonsForClassIdMerge(gid) {
    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    const id = String(gid || '').trim()
    if (!id) return []
    const [a, b] = await Promise.all([
      getDocs(
        query(
          collection(db, 'groupLessons'),
          where('academyId', '==', scopedAcademyId),
          where('groupClassId', '==', id)
        )
      ),
      getDocs(
        query(
          collection(db, 'groupLessons'),
          where('academyId', '==', scopedAcademyId),
          where('groupClassID', '==', id)
        )
      ),
    ])
    const byId = new Map()
    for (const snap of [a, b]) {
      snap.docs.forEach((docItem) => {
        byId.set(docItem.id, { id: docItem.id, ...docItem.data() })
      })
    }
    return Array.from(byId.values())
  }

  async function addCreditTransaction(payload) {
    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      const extraFields = {}
      if (payload.registrationRound != null) {
        extraFields.registrationRound = Number(payload.registrationRound) || null
      }
      if (payload.roundNumber != null) {
        extraFields.roundNumber = Number(payload.roundNumber) || null
      }
      if (payload.paymentDate !== undefined) {
        extraFields.paymentDate = String(payload.paymentDate ?? '').trim()
      }
      if (payload.amountPaid !== undefined) {
        extraFields.amountPaid = Number(payload.amountPaid ?? 0) || 0
      }
      if (payload.registrationLabel !== undefined) {
        extraFields.registrationLabel = String(payload.registrationLabel ?? '').trim()
      }
      if (payload.registrationMemo !== undefined) {
        extraFields.registrationMemo = String(payload.registrationMemo ?? '').trim()
      }
      await addDoc(collection(db, 'creditTransactions'), {
        academyId: scopedAcademyId,
        studentId: String(payload.studentId ?? ''),
        studentName: String(payload.studentName ?? ''),
        teacher: normalizeText(payload.teacher ?? ''),
        packageId: String(payload.packageId ?? ''),
        packageType: String(payload.packageType ?? ''),
        packageTitle: String(payload.packageTitle ?? ''),
        groupClassName: String(payload.groupClassName ?? ''),
        sourceType: String(payload.sourceType ?? ''),
        sourceId: String(payload.sourceId ?? ''),
        actionType: String(payload.actionType ?? ''),
        deltaCount: Number(payload.deltaCount ?? 0),
        memo: String(payload.memo ?? ''),
        actorUid: user?.uid || '',
        actorRole: userProfile?.role || '',
        createdAt: serverTimestamp(),
        ...extraFields,
      })
    } catch (error) {
      console.error('creditTransactions 기록 실패:', error)
      throw error
    }
  }

  function openStudentPackageReRegisterModal(pkg) {
    if (userProfile?.role !== 'admin') return
    if (!pkg?.id) return
    const sid = String(pkg.studentId || '').trim()
    if (!sid) {
      alert('수강권에 연결된 학생 정보가 없습니다.')
      return
    }
    const pt = pkg.packageType
    if (pt !== 'private' && pt !== 'group' && pt !== 'openGroup') {
      alert('유형을 확인할 수 없어 재등록할 수 없습니다.')
      return
    }

    const fromList = privateStudents.find((s) => s.id === sid)
    const studentObj = fromList
      ? fromList
      : {
          id: sid,
          name: String(pkg.studentName || '').trim() || '-',
          teacher: normalizeText(pkg.teacher || ''),
        }

    openStudentPackageModal(studentObj, pt, pkg)
  }

  async function handleDeleteStudent(student) {
    if (!(userProfile?.role === 'admin' || userProfile?.canDeleteStudent === true)) {
      alert('학생 삭제 권한이 없습니다.')
      return
    }

    const label = `${student.name || ''} (${student.teacher || ''})`.trim()
    if (!window.confirm(`이 학생을 삭제할까요?\n${label}`)) return

    try {
      assertSameAcademy(student, currentAcademyId, '학생')
      setBusyDeletingStudentId(student.id)
      await deleteDoc(doc(db, 'privateStudents', student.id))
    } catch (error) {
      console.error('학생 삭제 실패:', error)
      alert(`학생 삭제 실패: ${error.message}`)
    } finally {
      setBusyDeletingStudentId(null)
    }
  }

  function handleDeleteGroup(group) {
    if (userProfile?.role !== 'admin') {
      alert('그룹 관리 권한이 없습니다.')
      return
    }
    const todayYmd = getTodayStorageDateString()
    setGroupClosureModal({ group })
    setGroupClosureForm({
      closedFromDate: todayYmd,
      closedReason: '',
      cancelFutureLessons: true,
    })
    setGroupClosureErrors({})
  }

  async function submitGroupClosure() {
    const group = groupClosureModal?.group
    if (userProfile?.role !== 'admin' || !group?.id) {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    const closedFromDate = String(groupClosureForm.closedFromDate || '').trim()
    const closedReason = String(groupClosureForm.closedReason || '').trim()
    const cancelFutureLessons = groupClosureForm.cancelFutureLessons !== false
    const errors = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closedFromDate)) {
      errors.closedFromDate = '종료 기준일을 YYYY-MM-DD 형식으로 입력해 주세요.'
    }
    if (!closedReason) {
      errors.closedReason = '종료 사유를 입력해 주세요.'
    }
    if (Object.keys(errors).length > 0) {
      setGroupClosureErrors(errors)
      return
    }

    const label = `${group.name || ''} (${group.teacher || ''})`.trim()
    if (
      !window.confirm(
        `반 운영을 종료할까요?\n${label}\n\n` +
          '선택한 날짜 이후의 예정 수업만 취소됩니다. 과거 수업 기록은 유지됩니다.'
      )
    ) {
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(group, scopedAcademyId, '그룹')
      setBusyGroupId(group.id)
      const relatedLessons = await fetchGroupLessonsForClassIdMerge(group.id)
      const futureLessons = cancelFutureLessons ? relatedLessons.filter((lesson) => {
        if (isCancelledOrDeletedGroupLesson(lesson)) return false
        const lessonDate = String(lesson.date || '').trim()
        return /^\d{4}-\d{2}-\d{2}$/.test(lessonDate) && lessonDate >= closedFromDate
      }) : []
      const lessonIds = new Set(futureLessons.map((lesson) => String(lesson.id || '').trim()))
      const activeReservationSnap = cancelFutureLessons
        ? await getDocs(
            query(
              collection(db, 'groupLessonReservations'),
              where('academyId', '==', scopedAcademyId),
              where('groupClassId', '==', group.id),
              where('status', '==', 'active')
            )
          )
        : null
      const activeReservations = activeReservationSnap
        ? activeReservationSnap.docs
            .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
            .filter((reservation) => lessonIds.has(String(reservation.lessonId || '').trim()))
        : []
      const lessonById = new Map(futureLessons.map((lesson) => [String(lesson.id || ''), lesson]))
      const groupRef = doc(db, 'groupClasses', group.id)
      const now = serverTimestamp()
      const ops = [
        {
          type: 'update',
          ref: groupRef,
          data: {
            status: 'closed',
            closedFromDate,
            closedReason,
            closedAt: now,
            closedByUid: user?.uid || '',
            updatedAt: now,
          },
        },
      ]

      futureLessons.forEach((lesson) => {
        ops.push({
          type: 'update',
          ref: doc(db, 'groupLessons', lesson.id),
          data: {
            status: 'cancelled',
            groupClassDeleted: true,
            cancellationType: 'class_closure',
            cancelledReason: 'group_class_closed',
            cancelledFromDate: closedFromDate,
            cancelledAt: now,
            cancelledByUid: user?.uid || '',
            noDeduction: true,
            updatedAt: now,
          },
        })
      })
      activeReservations.forEach((reservation) => {
        const lesson = lessonById.get(String(reservation.lessonId || '')) || {}
        ops.push({
          type: 'update',
          ref: doc(db, 'groupLessonReservations', reservation.id),
          data: {
            status: 'cancelled',
            cancellationType: 'class_closure',
            cancelledReason: 'group_class_closed',
            cancelledAt: now,
            cancelledByUid: user?.uid || '',
            noDeduction: true,
            date: reservation.date || lesson.date || '',
            time: reservation.time || lesson.time || '',
            subject: reservation.subject || lesson.subject || '',
            updatedAt: now,
          },
        })
      })
      for (const chunk of chunkArray(ops, 450)) {
        const batch = writeBatch(db)
        chunk.forEach((op) => {
          batch.update(op.ref, op.data)
        })
        await batch.commit()
      }

      setSelectedGroupClass((prev) => {
        if (prev?.id !== group.id) return prev
        return {
          ...prev,
          status: 'closed',
          closedFromDate,
          closedReason,
        }
      })
      setGroupClosureModal(null)
      alert(`반 운영을 종료했습니다. 선택한 날짜 이후 예정 수업 ${futureLessons.length}건을 취소했습니다.`)
    } catch (error) {
      console.error('반 운영 종료 실패:', error)
      alert(`반 운영 종료 실패: ${error.message}`)
    } finally {
      setBusyGroupId(null)
    }
  }

  function getGroupStudentDisplayName(row) {
    return row.studentName || row.name || '-'
  }

  async function handleRemoveGroupStudent(row) {
    if (!canDeleteStudent) {
      alert('학생 삭제 권한이 없습니다.')
      return
    }

    const label = getGroupStudentDisplayName(row)
    if (!window.confirm(`이 학생을 이 반에서 제거할까요?\n${label}`)) return

    try {
      assertSameAcademy(row, currentAcademyId, '그룹 학생')
      setBusyRemovingGroupStudentId(row.id)
      const batch = writeBatch(db)
      batch.delete(doc(db, 'groupStudents', row.id))
      deleteStudentGroupAccessBatch(
        batch,
        db,
        buildStudentGroupAccessPayloadFromGroupStudent(row)
      )
      await batch.commit()
    } catch (error) {
      console.error('그룹 학생 제거 실패:', error)
      alert(`그룹 학생 제거 실패: ${error.message}`)
    } finally {
      setBusyRemovingGroupStudentId(null)
    }
  }

  function openGroupLessonNoDeductionCancelModal(lesson) {
    if (userProfile?.role !== 'admin') {
      alert('수업 수정 권한이 없습니다.')
      return
    }
    if (!lesson?.id) return
    setGroupLessonNoDeductionCancelModal({ lesson })
    setGroupLessonNoDeductionCancelForm({
      cancelledReason: 'holiday',
      cancellationNote: '',
    })
    setGroupLessonNoDeductionCancelErrors({})
  }

  async function submitGroupLessonNoDeductionCancel() {
    const lesson = groupLessonNoDeductionCancelModal?.lesson
    if (userProfile?.role !== 'admin' || !lesson?.id) {
      alert('수업 수정 권한이 없습니다.')
      return
    }
    const cancelledReason = String(groupLessonNoDeductionCancelForm.cancelledReason || '').trim()
    const cancellationNote = String(groupLessonNoDeductionCancelForm.cancellationNote || '').trim()
    const allowedReasons = ['holiday', 'teacher_unavailable', 'academy_closed', 'other']
    const errors = {}
    if (!allowedReasons.includes(cancelledReason)) {
      errors.cancelledReason = '휴강 사유를 선택해 주세요.'
    }
    if (Object.keys(errors).length > 0) {
      setGroupLessonNoDeductionCancelErrors(errors)
      return
    }
    const label = `${lesson.date || ''} ${lesson.time || ''} ${lesson.subject || ''}`.trim()
    if (
      !window.confirm(
        `이 수업을 휴강 처리할까요?\n${label}\n\n` +
          '이 수업은 휴강 처리되며 수강권이 차감되지 않습니다.'
      )
    ) {
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(lesson, scopedAcademyId, '그룹 수업')
      setBusyGroupLessonId(lesson.id)
      const now = serverTimestamp()
      const activeReservationSnap = await getDocs(
        query(
          collection(db, 'groupLessonReservations'),
          where('academyId', '==', scopedAcademyId),
          where('lessonId', '==', lesson.id),
          where('status', '==', 'active')
        )
      )
      const ops = [
        {
          ref: doc(db, 'groupLessons', lesson.id),
          data: {
            status: 'cancelled',
            cancellationType: 'no_deduction',
            cancelledReason,
            cancellationNote,
            noDeduction: true,
            cancelledAt: now,
            cancelledByUid: user?.uid || '',
            updatedAt: now,
          },
        },
      ]
      activeReservationSnap.docs.forEach((docItem) => {
        const reservation = { id: docItem.id, ...docItem.data() }
        ops.push({
          ref: doc(db, 'groupLessonReservations', reservation.id),
          data: {
            status: 'cancelled',
            cancellationType: 'no_deduction',
            cancelledReason,
            cancellationNote,
            noDeduction: true,
            cancelledAt: now,
            cancelledByUid: user?.uid || '',
            date: reservation.date || lesson.date || '',
            time: reservation.time || lesson.time || '',
            subject: reservation.subject || lesson.subject || '',
            updatedAt: now,
          },
        })
      })
      for (const chunk of chunkArray(ops, 450)) {
        const batch = writeBatch(db)
        chunk.forEach((op) => batch.update(op.ref, op.data))
        await batch.commit()
      }
      setGroupLessonNoDeductionCancelModal(null)
      alert(`휴강 처리했습니다. 활성 예약 ${activeReservationSnap.docs.length}건을 차감 없이 취소했습니다.`)
    } catch (error) {
      console.error('휴강 처리 실패:', error)
      alert(`휴강 처리 실패: ${error.message}`)
    } finally {
      setBusyGroupLessonId(null)
    }
  }

  async function handleDeleteGroupLesson(lesson) {
    if (!(userProfile?.role === 'admin' || userProfile?.canDeleteLesson === true)) {
      alert('수업 삭제 권한이 없습니다.')
      return
    }

    const label = `${lesson.date || ''} ${lesson.time || ''} ${lesson.subject || ''}`.trim()
    if (!window.confirm(`이 수업 일정을 삭제할까요?\n${label}`)) return

    try {
      assertSameAcademy(lesson, currentAcademyId, '그룹 수업')
      setBusyGroupLessonId(lesson.id)
      await deleteDoc(doc(db, 'groupLessons', lesson.id))
    } catch (error) {
      console.error('그룹 수업 삭제 실패:', error)
      alert(`그룹 수업 삭제 실패: ${error.message}`)
    } finally {
      setBusyGroupLessonId(null)
    }
  }

  function validatePrivateSlotForm() {
    const errors = {}
    const isAdminUser = isAdmin
    const teacher = isAdminUser
      ? String(privateSlotForm.teacher || '').trim()
      : String(userProfile?.teacherName || '').trim()
    const teacherOption = isAdminUser
      ? teacherSelectOptions.find((option) => option.value === teacher) || null
      : null
    const teacherFields = buildPrivateSlotTeacherFields(teacherOption || teacher)
    const date = String(privateSlotForm.date || '').trim()
    const time = String(privateSlotForm.time || '').trim()
    const durationMinutes = Number.parseInt(String(privateSlotForm.durationMinutes || ''), 10)
    const repeatWeekly = privateSlotForm.repeatWeekly === true
    const repeatWeeks = Number.parseInt(String(privateSlotForm.repeatWeeks || ''), 10)
    const repeatEndDate = String(privateSlotForm.repeatEndDate || '').trim()

    if (!teacherFields.teacher) errors.teacher = '선생님을 선택해주세요.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseYmdToLocalDate(date)) {
      errors.date = '날짜를 선택해주세요.'
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      errors.time = '시간을 선택해주세요.'
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 240) {
      errors.durationMinutes = '10~240분 사이로 입력해주세요.'
    }
    if (repeatWeekly) {
      if (repeatEndDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(repeatEndDate) || !parseYmdToLocalDate(repeatEndDate)) {
          errors.repeatEndDate = '반복 종료일을 선택해주세요.'
        } else if (date && repeatEndDate < date) {
          errors.repeatEndDate = '반복 종료일은 시작일 이후여야 합니다.'
        }
      } else if (!Number.isInteger(repeatWeeks) || repeatWeeks < 1 || repeatWeeks > 52) {
        errors.repeatWeeks = '1~52주 사이로 입력해주세요.'
      }
    }

    const dates =
      Object.keys(errors).length === 0
        ? buildWeeklyPrivateSlotDates({
            date,
            repeatWeekly,
            repeatWeeks,
            repeatEndDate,
          })
        : []
    if (dates.length > 52) {
      errors.repeatWeeks = '반복 생성은 최대 52개까지 가능합니다.'
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value: {
        teacher,
        teacherFields,
        dates,
        time,
        durationMinutes,
        eligibleStudentIds: [],
      },
    }
  }

  function addDaysToYmd(date, days) {
    const base = parseYmdToLocalDate(date)
    if (!base) return ''
    base.setDate(base.getDate() + days)
    return getStorageDateStringFromDate(base)
  }

  function buildWeeklyPrivateSlotDates({ date, repeatWeekly, repeatWeeks, repeatEndDate }) {
    if (!repeatWeekly) return [date]
    const dates = []
    if (repeatEndDate) {
      let nextDate = date
      while (nextDate && nextDate <= repeatEndDate && dates.length <= 52) {
        dates.push(nextDate)
        nextDate = addDaysToYmd(nextDate, 7)
      }
      return dates
    }
    const totalWeeks = Number.isInteger(repeatWeeks) ? repeatWeeks : 1
    for (let index = 0; index < totalWeeks; index += 1) {
      dates.push(addDaysToYmd(date, index * 7))
    }
    return dates.filter(Boolean)
  }

  async function privateSlotExists({ academyId, teacherFields, date, time }) {
    const fields = [
      ['teacherKey', teacherFields.teacherKey],
      ['teacherUid', teacherFields.teacherUid],
      ['teacher', teacherFields.teacher],
    ].filter(([, value]) => String(value || '').trim())
    const snaps = await Promise.all(
      fields.map(([field, value]) =>
        getDocs(
          query(
            collection(db, 'privateLessonSlots'),
            where('academyId', '==', academyId),
            where(field, '==', value),
            where('date', '==', date),
            where('time', '==', time)
          )
        )
      )
    )
    return snaps.some((snap) => !snap.empty)
  }

  async function createPrivateSlot() {
    if (!isAdmin) {
      alert('1:1 수업 시간 생성 권한이 없습니다.')
      return
    }
    const result = validatePrivateSlotForm()
    setPrivateSlotFormErrors(result.errors)
    setPrivateSlotCreateResult(null)
    if (!result.valid) return

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      const { dates, time, durationMinutes, eligibleStudentIds, teacherFields } = result.value
      setBusyPrivateSlotActionId('__add__')
      const existingFlags = await Promise.all(
        dates.map((date) =>
          privateSlotExists({
            academyId: scopedAcademyId,
            teacherFields,
            date,
            time,
          })
        )
      )

      const batch = writeBatch(db)
      let createdCount = 0
      let skippedDuplicateCount = 0
      dates.forEach((date, index) => {
        if (existingFlags[index]) {
          skippedDuplicateCount += 1
          return
        }
        const [year, month, day] = date.split('-').map(Number)
        const [hour, minute] = time.split(':').map(Number)
        const startAt = Timestamp.fromDate(new Date(year, month - 1, day, hour, minute))
        const slotRef = doc(collection(db, 'privateLessonSlots'))
        const slotPayload = {
          academyId: scopedAcademyId,
          teacher: teacherFields.teacher,
          teacherName: teacherFields.teacherName,
          teacherKey: teacherFields.teacherKey,
          teacherUid: teacherFields.teacherUid,
          teacherEmail: teacherFields.teacherEmail,
          date,
          time,
          subject: '1:1 수업',
          capacity: 1,
          reservedCount: 0,
          startAt,
          durationMinutes,
          status: 'open',
          reservedStudentId: '',
          reservationId: '',
          createdByUid: user?.uid || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          reservedAt: null,
          cancelledAt: null,
        }
        if (eligibleStudentIds.length > 0) {
          slotPayload.eligibleStudentIds = eligibleStudentIds
        }
        batch.set(slotRef, slotPayload)
        eligibleStudentIds.forEach((studentId) => {
          addStudentPrivateSlotAccessBatch(batch, db, {
            academyId: scopedAcademyId,
            studentId,
            slotId: slotRef.id,
          })
        })
        createdCount += 1
      })
      if (createdCount > 0) await batch.commit()
      setPrivateSlotCreateResult({
        createdCount,
        skippedDuplicateCount,
        requestedCount: dates.length,
      })
      setPrivateSlotForm((prev) => ({
        ...prev,
        date: '',
        time: '',
        durationMinutes: prev.durationMinutes || '60',
        eligibleStudentIds: [],
        repeatWeekly: false,
        repeatWeeks: prev.repeatWeeks || '1',
        repeatEndDate: '',
      }))
    } catch (error) {
      console.error('1:1 수업 시간 생성 실패:', error)
      alert(`1:1 수업 시간 생성 실패: ${error.message}`)
    } finally {
      setBusyPrivateSlotActionId('')
    }
  }

  function validatePrivateAvailabilityTemplateForm() {
    const errors = {}
    const teacher = String(privateAvailabilityTemplateForm.teacher || '').trim()
    const teacherOption = teacherSelectOptions.find((option) => option.value === teacher) || null
    const teacherFields = buildPrivateSlotTeacherFields(teacherOption || teacher)
    const weekday = Number.parseInt(String(privateAvailabilityTemplateForm.weekday || ''), 10)
    const time = String(privateAvailabilityTemplateForm.time || '').trim()
    const durationMinutes = Number.parseInt(
      String(privateAvailabilityTemplateForm.durationMinutes || ''),
      10
    )
    const status = String(privateAvailabilityTemplateForm.status || 'active').trim()
    if (!teacherFields.teacher) errors.teacher = '선생님을 선택해주세요.'
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) {
      errors.weekday = '월요일부터 토요일까지만 선택할 수 있습니다.'
    }
    if (!/^\d{2}:\d{2}$/.test(time)) errors.time = '시간을 선택해주세요.'
    if (!Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 240) {
      errors.durationMinutes = '10~240분 사이로 입력해주세요.'
    }
    if (!['active', 'inactive'].includes(status)) errors.status = '상태를 선택해주세요.'
    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value: { teacher, teacherFields, weekday, time, durationMinutes, status },
    }
  }

  function validatePrivateAvailabilityBulkForm() {
    const errors = {}
    const teacher = String(privateAvailabilityBulkForm.teacher || '').trim()
    const teacherOption = teacherSelectOptions.find((option) => option.value === teacher) || null
    const teacherFields = buildPrivateSlotTeacherFields(teacherOption || teacher)
    const weekdays = normalizePrivateWeeklySlotWeekdays(privateAvailabilityBulkForm.weekdays)
    const { times, invalidTimes } = parsePrivateWeeklySlotTimeList(
      privateAvailabilityBulkForm.timesText
    )
    const durationMinutes = Number.parseInt(
      String(privateAvailabilityBulkForm.durationMinutes || ''),
      10
    )
    const status = String(privateAvailabilityBulkForm.status || 'active').trim()
    const effectiveStartDate = String(privateAvailabilityBulkForm.effectiveStartDate || '').trim()
    const effectiveEndDate = String(privateAvailabilityBulkForm.effectiveEndDate || '').trim()
    if (!teacherFields.teacher) errors.teacher = '선생님을 선택해주세요.'
    if (weekdays.length === 0) errors.weekdays = '요일을 하나 이상 선택해주세요.'
    if (times.length === 0) errors.timesText = '시작 시간을 하나 이상 입력해주세요.'
    if (invalidTimes.length > 0) {
      errors.timesText = `올바른 HH:mm 시간이 아닙니다: ${invalidTimes.join(', ')}`
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 180) {
      errors.durationMinutes = '10~180분 사이로 입력해주세요.'
    }
    if (!['active', 'inactive'].includes(status)) errors.status = '상태를 선택해주세요.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveStartDate)) {
      errors.effectiveStartDate = '시작일을 선택해주세요.'
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDate)) {
      errors.effectiveEndDate = '종료일을 선택해주세요.'
    }
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(effectiveStartDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDate) &&
      effectiveEndDate < effectiveStartDate
    ) {
      errors.effectiveEndDate = '종료일은 시작일 이후여야 합니다.'
    }

    const value = {
      teacher,
      teacherFields,
      weekdays,
      times,
      durationMinutes,
      status,
      effectiveStartDate,
      effectiveEndDate,
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value,
    }
  }

  function buildPrivateAvailabilityBulkPlan(value) {
    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    return buildPrivateWeeklyBulkSlotPlan({
      academyId: scopedAcademyId,
      teacherFields: value.teacherFields,
      weekdays: value.weekdays,
      times: value.times,
      durationMinutes: value.durationMinutes,
      status: value.status,
      effectiveStartDate: value.effectiveStartDate,
      effectiveEndDate: value.effectiveEndDate,
      existingTemplates: privateAvailabilityTemplates,
    })
  }

  function previewPrivateAvailabilityBulkTemplates() {
    const result = validatePrivateAvailabilityBulkForm()
    setPrivateAvailabilityBulkErrors(result.errors)
    if (!result.valid) return
    try {
      const plan = buildPrivateAvailabilityBulkPlan(result.value)
      setPrivateAvailabilityBulkResult({
        mode: 'preview',
        createdCount: plan.createdRows.length,
        skippedDuplicateCount: plan.skippedDuplicateRows.length,
        skippedOverlapCount: plan.skippedOverlapRows.length,
        errorCount: plan.errorRows.length,
        requestedCount: plan.requestedRows.length,
        effectiveStartDate: result.value.effectiveStartDate,
        effectiveEndDate: result.value.effectiveEndDate,
      })
    } catch (error) {
      console.error('기본 1:1 슬롯 미리보기 실패:', error)
      alert(`기본 1:1 슬롯 미리보기 실패: ${error.message}`)
    }
  }

  async function createPrivateAvailabilityBulkTemplates() {
    if (!isAdmin) {
      alert('기본 1:1 슬롯 일괄 등록은 관리자만 설정할 수 있습니다.')
      return
    }
    const result = validatePrivateAvailabilityBulkForm()
    setPrivateAvailabilityBulkErrors(result.errors)
    if (!result.valid) return

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      const plan = buildPrivateAvailabilityBulkPlan(result.value)
      setBusyPrivateAvailabilityTemplateId('__bulk__')

      for (let index = 0; index < plan.createdRows.length; index += 400) {
        const batch = writeBatch(db)
        plan.createdRows.slice(index, index + 400).forEach((row) => {
          const templateRef = doc(collection(db, 'privateLessonAvailabilityTemplates'))
          batch.set(templateRef, {
            academyId: scopedAcademyId,
            teacher: row.teacher,
            teacherName: row.teacherName,
            teacherKey: row.teacherKey,
            teacherUid: row.teacherUid,
            teacherEmail: row.teacherEmail,
            weekday: row.weekday,
            time: row.time,
            durationMinutes: row.durationMinutes,
            status: row.status,
            effectiveStartDate: row.effectiveStartDate,
            effectiveEndDate: row.effectiveEndDate,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        })
        await batch.commit()
      }

      setPrivateAvailabilityBulkResult({
        mode: 'created',
        createdCount: plan.createdRows.length,
        skippedDuplicateCount: plan.skippedDuplicateRows.length,
        skippedOverlapCount: plan.skippedOverlapRows.length,
        errorCount: plan.errorRows.length,
        requestedCount: plan.requestedRows.length,
        effectiveStartDate: result.value.effectiveStartDate,
        effectiveEndDate: result.value.effectiveEndDate,
      })
      setPrivateAvailabilityBulkForm((prev) => ({
        ...prev,
        timesText: '',
        durationMinutes: prev.durationMinutes || '60',
        status: 'active',
      }))
    } catch (error) {
      console.error('기본 1:1 슬롯 일괄 등록 실패:', error)
      alert(`기본 1:1 슬롯 일괄 등록 실패: ${error.message}`)
    } finally {
      setBusyPrivateAvailabilityTemplateId('')
    }
  }

  function buildPrivateFixedSlotAssignmentPlan() {
    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    const errors = {}
    const templateId = String(privateFixedSlotAssignmentForm.templateId || '').trim()
    const studentId = String(privateFixedSlotAssignmentForm.studentId || '').trim()
    const packageId = String(privateFixedSlotAssignmentForm.packageId || '').trim()
    const subject = String(privateFixedSlotAssignmentForm.subject || '').trim() || '1:1 수업'
    const startDate = String(privateFixedSlotAssignmentForm.startDate || '').trim()
    const endDate = String(privateFixedSlotAssignmentForm.endDate || '').trim()
    const today = getTodayStorageDateString()

    const template =
      privateAvailabilityTemplates.find((row) => String(row.id || '').trim() === templateId) || null
    if (!template) errors.templateId = '선택한 기본 슬롯이 없습니다'
    if (!studentId) errors.studentId = '학생을 선택해 주세요'
    if (!packageId) errors.packageId = '개인 수강권을 선택해 주세요'
    if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) {
      errors.dateRange = '시작일/종료일을 확인해 주세요'
    }

    const student = privateStudents.find((row) => String(row.id || '').trim() === studentId) || null
    if (studentId && !student) errors.studentId = '선택한 학생을 찾을 수 없습니다'

    const selectedPackage =
      studentPackages.find((row) => String(row.id || '').trim() === packageId) || null
    if (packageId && !selectedPackage) errors.packageId = '선택한 개인 수강권을 찾을 수 없습니다'

    let dates = []
    if (template && isYmd(startDate) && isYmd(endDate) && endDate >= startDate) {
      dates = generatePrivateFixedAssignmentDates({ template, startDate, endDate })
      if (dates.length === 0) errors.dateRange = '기간 안에 생성할 수업이 없습니다'
    }

    const pastDates = dates.filter((date) => date < today)
    if (pastDates.length > 0) {
      errors.dateRange = '과거 날짜에는 고정 1:1 수업을 생성할 수 없습니다'
    }

    const blockingReasons = []
    const conflictDetails = []
    const duplicateDetails = []
    let balance = null
    let availableAssignmentCount = 0
    const teacherFields = template ? buildPrivateTemplateTeacherFields(template) : null
    const durationMinutes = Number(template?.durationMinutes || 0)
    const safeDurationMinutes =
      Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.floor(durationMinutes) : 60

    if (template && student && selectedPackage && teacherFields) {
      try {
        assertSameAcademy(template, scopedAcademyId, '기본 슬롯')
        assertSameAcademy(student, scopedAcademyId, '학생')
        assertSameAcademy(selectedPackage, scopedAcademyId, '수강권')
      } catch (error) {
        errors.academy = error.message
      }

      const packageMatchesTeacher = isActivePrivatePackageForTeacher({
        pkg: selectedPackage,
        academyId: scopedAcademyId,
        studentId,
        teacher: teacherFields.teacher,
        teacherKey: teacherFields.teacherKey,
        teacherUid: teacherFields.teacherUid,
      })
      if (!packageMatchesTeacher) {
        errors.packageId = '선택한 학생/선생님에 연결된 개인 수강권을 선택해 주세요'
      }

      const blockingRows = [
        ...lessons.map((lesson) => ({ source: 'lessons', row: lesson })),
        ...privateLessonReservations.map((reservation) => ({
          source: 'privateLessonReservations',
          row: reservation,
        })),
        ...privateLessonSlots.map((slot) => ({ source: 'privateLessonSlots', row: slot })),
      ].filter(({ row }) => isTeacherBlockingScheduleRow(row))

      dates.forEach((date) => {
        const candidate = {
          academyId: scopedAcademyId,
          ...teacherFields,
          date,
          time: String(template.time || '').trim(),
          durationMinutes: safeDurationMinutes,
        }
        const duplicate = lessons.find((lesson) => {
          const lessonStudentId = String(lesson.studentId || lesson.studentID || '').trim()
          return (
            lessonStudentId === studentId &&
            String(lesson.date || '').trim() === date &&
            String(lesson.time || '').trim() === candidate.time &&
            isTeacherBlockingScheduleRow(lesson) &&
            privateSchedulesOverlap(candidate, lesson)
          )
        })
        if (duplicate) duplicateDetails.push(`${date} ${candidate.time}`)

        const conflict = blockingRows.find(({ row }) => privateSchedulesOverlap(candidate, row))
        if (conflict) {
          conflictDetails.push({
            date,
            time: candidate.time,
            source: conflict.source,
            id: conflict.row.id || '',
          })
        }
      })

      balance = computePrivateTeacherPackageUsage({
        privatePackage: selectedPackage,
        privateLessons: lessons,
        privateReservations: privateLessonReservations,
        academyId: scopedAcademyId,
        studentId,
        teacher: teacherFields.teacher,
        teacherKey: teacherFields.teacherKey,
        teacherUid: teacherFields.teacherUid,
        teacherUID: teacherFields.teacherUID,
        teacherId: teacherFields.teacherId,
      })
      availableAssignmentCount = Math.max(0, Number(balance.makeupAvailableCount) || 0)
      if (dates.length > 0 && availableAssignmentCount < dates.length) {
        const fixedAllocated = Math.max(0, Number(balance.futureFixedAllocatedCount) || 0)
        const activeReservations = Math.max(0, Number(balance.activeFutureReservationCount) || 0)
        const capacityMessage = [
          '수강권 새 배정 가능 횟수가 부족합니다.',
          `필요 ${dates.length}회 · 새 배정 가능 ${availableAssignmentCount}회`,
          `현재 고정 예정 ${fixedAllocated}회 · 예약 ${activeReservations}회`,
        ].join(' ')
        blockingReasons.push(capacityMessage)
        errors.packageId = capacityMessage
      }
    }

    if (conflictDetails.length > 0) {
      blockingReasons.push('이미 같은 시간에 수업이 있습니다')
    }
    if (duplicateDetails.length > 0) {
      blockingReasons.push('이미 같은 학생에게 같은 날짜/시간 고정수업이 있습니다')
    }

    const uniqueBlockingReasons = Array.from(new Set(blockingReasons))
    const valid = Object.keys(errors).length === 0 && uniqueBlockingReasons.length === 0
    return {
      valid,
      errors,
      template,
      teacherFields,
      student,
      selectedPackage,
      subject,
      dates,
      durationMinutes: safeDurationMinutes,
      blockingReasons: uniqueBlockingReasons,
      conflictDetails,
      duplicateDetails: Array.from(new Set(duplicateDetails)),
      balance,
      availableAssignmentCount,
    }
  }

  function previewPrivateFixedSlotAssignment() {
    try {
      const plan = buildPrivateFixedSlotAssignmentPlan()
      setPrivateFixedSlotAssignmentErrors(plan.errors)
      setPrivateFixedSlotAssignmentPreview({
        mode: 'preview',
        dates: plan.dates,
        blockingReasons: plan.blockingReasons,
        conflictDetails: plan.conflictDetails,
        duplicateDetails: plan.duplicateDetails,
        availableAssignmentCount: plan.availableAssignmentCount,
        requestedCount: plan.dates.length,
        canCreate: plan.valid,
      })
    } catch (error) {
      console.error('고정 1:1 수업 배정 미리보기 실패:', error)
      alert(`고정 1:1 수업 배정 미리보기 실패: ${error.message}`)
    }
  }

  async function createPrivateFixedSlotAssignment() {
    if (!isAdmin) {
      alert('고정 1:1 수업 배정은 관리자만 생성할 수 있습니다.')
      return
    }
    const plan = buildPrivateFixedSlotAssignmentPlan()
    setPrivateFixedSlotAssignmentErrors(plan.errors)
    setPrivateFixedSlotAssignmentPreview({
      mode: 'preview',
      dates: plan.dates,
      blockingReasons: plan.blockingReasons,
      conflictDetails: plan.conflictDetails,
      duplicateDetails: plan.duplicateDetails,
      availableAssignmentCount: plan.availableAssignmentCount,
      requestedCount: plan.dates.length,
      canCreate: plan.valid,
    })
    if (!plan.valid) return

    try {
      setBusyPrivateFixedSlotAssignment(true)
      const batch = writeBatch(db)
      const batchId = `fixed-private-assignment-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`
      const studentName = String(plan.student?.name || plan.student?.studentName || '').trim() || '-'
      const packageTitle = String(plan.selectedPackage?.title || '고정 1:1').trim()
      plan.dates.forEach((date) => {
        const lessonRef = doc(collection(db, 'lessons'))
        const start = parseLegacyLessonToDate(date, plan.template.time)
        batch.set(lessonRef, {
          academyId: requireCurrentAcademyId(currentAcademyId),
          teacher: plan.teacherFields.teacher,
          teacherName: plan.teacherFields.teacherName,
          teacherKey: plan.teacherFields.teacherKey,
          teacherUid: plan.teacherFields.teacherUid,
          teacherUID: plan.teacherFields.teacherUID,
          teacherId: plan.teacherFields.teacherId,
          student: studentName,
          studentName,
          studentId: plan.student.id,
          studentID: plan.student.id,
          date,
          time: String(plan.template.time || '').trim(),
          subject: plan.subject,
          durationMinutes: plan.durationMinutes,
          completed: false,
          completedAt: null,
          isDeductCancelled: false,
          deductMemo: '',
          packageId: plan.selectedPackage.id,
          packageType: 'private',
          packageTitle,
          billingType: 'private',
          sourceType: 'fixed-private-slot-assignment',
          privateLessonAvailabilityTemplateId: plan.template.id,
          fixedPrivateAssignmentBatchId: batchId,
          seriesID: batchId,
          createdBy: String(userProfile?.name || user?.email || user?.uid || '').trim(),
          createdByUID: user?.uid || '',
          createdByUid: user?.uid || '',
          ...(start ? { startAt: Timestamp.fromDate(start) } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      })
      await batch.commit()
      setPrivateFixedSlotAssignmentPreview({
        mode: 'created',
        dates: plan.dates,
        blockingReasons: [],
        conflictDetails: [],
        duplicateDetails: [],
        availableAssignmentCount: plan.availableAssignmentCount - plan.dates.length,
        requestedCount: plan.dates.length,
        canCreate: false,
      })
      setPrivateFixedSlotAssignmentForm((prev) => ({
        ...prev,
        packageId: '',
      }))
    } catch (error) {
      console.error('고정 1:1 수업 배정 생성 실패:', error)
      alert(`고정 1:1 수업 배정 생성 실패: ${error.message}`)
    } finally {
      setBusyPrivateFixedSlotAssignment(false)
    }
  }

  async function createPrivateAvailabilityTemplate() {
    if (!isAdmin) {
      alert('주간 기본 슬롯은 관리자만 설정할 수 있습니다.')
      return
    }
    const result = validatePrivateAvailabilityTemplateForm()
    setPrivateAvailabilityTemplateErrors(result.errors)
    if (!result.valid) return

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      const { teacherFields, weekday, time, durationMinutes, status } = result.value
      setBusyPrivateAvailabilityTemplateId('__add__')
      await addDoc(collection(db, 'privateLessonAvailabilityTemplates'), {
        academyId: scopedAcademyId,
        teacher: teacherFields.teacher,
        teacherName: teacherFields.teacherName,
        teacherKey: teacherFields.teacherKey,
        teacherUid: teacherFields.teacherUid,
        teacherEmail: teacherFields.teacherEmail,
        weekday,
        time,
        durationMinutes,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setPrivateAvailabilityTemplateForm((prev) => ({
        ...prev,
        time: '',
        durationMinutes: prev.durationMinutes || '60',
        status: 'active',
      }))
    } catch (error) {
      console.error('주간 기본 슬롯 생성 실패:', error)
      alert(`주간 기본 슬롯 생성 실패: ${error.message}`)
    } finally {
      setBusyPrivateAvailabilityTemplateId('')
    }
  }

  async function updatePrivateAvailabilityTemplateStatus(template, status) {
    if (!isAdmin || !template?.id) return
    const nextStatus = status === 'active' ? 'active' : 'inactive'
    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(template, scopedAcademyId, '주간 기본 슬롯')
      setBusyPrivateAvailabilityTemplateId(template.id)
      await updateDoc(doc(db, 'privateLessonAvailabilityTemplates', template.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error('주간 기본 슬롯 상태 변경 실패:', error)
      alert(`주간 기본 슬롯 상태 변경 실패: ${error.message}`)
    } finally {
      setBusyPrivateAvailabilityTemplateId('')
    }
  }

  async function updatePrivateSlotEligibility(slot, nextEligibleStudentIds) {
    if (!isAdmin) {
      alert('대상 학생 수정 권한이 없습니다.')
      return
    }
    if (!slot?.id) return

    const nextIds = normalizePrivateSlotEligibleStudentIds(nextEligibleStudentIds, privateStudents)
    const previousIds = normalizePrivateSlotEligibleStudentIds(slot.eligibleStudentIds, privateStudents)
    const previousSet = new Set(previousIds)
    const nextSet = new Set(nextIds)
    const addedIds = nextIds.filter((studentId) => !previousSet.has(studentId))
    const removedIds = previousIds.filter((studentId) => !nextSet.has(studentId))

    if (addedIds.length === 0 && removedIds.length === 0) return

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(slot, scopedAcademyId, '1:1 수업 시간')
      setBusyPrivateSlotActionId(slot.id)
      const batch = writeBatch(db)
      batch.update(doc(db, 'privateLessonSlots', slot.id), {
        eligibleStudentIds: nextIds,
        updatedAt: serverTimestamp(),
      })
      addedIds.forEach((studentId) => {
        addStudentPrivateSlotAccessBatch(batch, db, {
          academyId: scopedAcademyId,
          studentId,
          slotId: slot.id,
        })
      })
      removedIds.forEach((studentId) => {
        removeStudentPrivateSlotAccessBatch(batch, db, {
          academyId: scopedAcademyId,
          studentId,
          slotId: slot.id,
        })
      })
      await batch.commit()
    } catch (error) {
      console.error('1:1 수업 대상 학생 수정 실패:', error)
      alert(`1:1 수업 대상 학생 수정 실패: ${error.message}`)
    } finally {
      setBusyPrivateSlotActionId('')
    }
  }

  async function cancelPrivateSlotOrReservation(slot, reservation) {
    if (!isAdmin) {
      alert('1:1 수업 관리 권한이 없습니다.')
      return
    }
    if (!slot?.id) return

    const label = `${slot.date || ''} ${slot.time || ''} ${slot.teacher || ''}`.trim()
    if (!window.confirm(`${reservation ? '이 예약을 취소할까요?' : '이 수업 시간을 취소할까요?'}\n${label}`)) {
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(slot, scopedAcademyId, '1:1 수업 시간')
      setBusyPrivateSlotActionId(slot.id)

      if (reservation?.id) {
        const studentId = String(reservation.studentId || '').trim()
        if (!studentId) throw new Error('예약 학생 정보가 없습니다.')
        const callable = httpsCallable(firebaseFunctions, 'adminCancelPrivateLessonReservation')
        await callable({
          academyId: scopedAcademyId,
          slotId: slot.id,
          studentId,
        })
      } else {
        const slotRef = doc(db, 'privateLessonSlots', slot.id)
        await updateDoc(slotRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
    } catch (error) {
      console.error('1:1 수업 예약 취소 실패:', error)
      alert(`1:1 수업 예약 취소 실패: ${error.message}`)
    } finally {
      setBusyPrivateSlotActionId('')
    }
  }

  async function markPrivateReservationOutcome(reservation, outcome) {
    if (!isAdmin) {
      alert('예약 처리 권한이 없습니다.')
      return
    }
    if (!reservation?.id) return
    const isNoShow = outcome === 'no_show'
    const label = [
      reservation.date,
      reservation.time,
      reservation.studentName || reservation.studentId,
      reservation.subject,
    ]
      .filter(Boolean)
      .join(' ')
    const actionLabel = isNoShow ? '노쇼 처리' : '완료 처리'
    if (
      !window.confirm(
        `${actionLabel}하고 수강권 1회를 차감할까요?\n${label || '1:1 예약'}`
      )
    ) {
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(reservation, scopedAcademyId, '1:1 예약')
      setBusyPrivateReservationOutcomeId(`${reservation.id}:${outcome}`)
      const callable = httpsCallable(firebaseFunctions, 'markPrivateReservationOutcome')
      await callable({
        academyId: scopedAcademyId,
        reservationId: reservation.id,
        outcome,
      })
    } catch (error) {
      console.error('1:1 예약 처리 실패:', error)
      alert(`1:1 예약 처리 실패: ${error.message || '알 수 없는 오류'}`)
    } finally {
      setBusyPrivateReservationOutcomeId('')
    }
  }

  async function reversePrivateReservationOutcome(reservation) {
    if (!isAdmin) {
      alert('예약 처리 취소 권한이 없습니다.')
      return
    }
    if (!reservation?.id) return
    const reason = window.prompt('완료/노쇼 처리를 취소하는 이유를 입력해 주세요.')
    if (reason == null) return
    const trimmedReason = String(reason || '').trim()
    if (!trimmedReason) return
    if (trimmedReason.length < 2) {
      alert('취소 사유를 2자 이상 입력해 주세요.')
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(reservation, scopedAcademyId, '1:1 예약')
      setBusyPrivateReservationOutcomeId(`${reservation.id}:reverse`)
      const callable = httpsCallable(firebaseFunctions, 'reversePrivateReservationOutcome')
      await callable({
        academyId: scopedAcademyId,
        reservationId: reservation.id,
        reason: trimmedReason,
      })
    } catch (error) {
      console.error('1:1 예약 처리 취소 실패:', error)
      alert(`1:1 예약 처리 취소 실패: ${error.message || '알 수 없는 오류'}`)
    } finally {
      setBusyPrivateReservationOutcomeId('')
    }
  }

  const busyStudentId = busyDeletingStudentId || busyStudentFlowId

  const isStudentPackageModalSubmitting = busyStudentPackageSubmit

  debugLog('[permission check]', {
    hasUid: Boolean(user?.uid),
    role: userProfile?.role,
    hasTeacherName: Boolean(userProfile?.teacherName),
    canAddStudentRaw: userProfile?.canAddStudent,
    canCreateLessonDirectlyRaw: userProfile?.canCreateLessonDirectly,
    canEditLessonRaw: userProfile?.canEditLesson,
    canDeleteLessonRaw: userProfile?.canDeleteLesson,
    canManageAttendanceRaw: userProfile?.canManageAttendance,
    canEditStudentRaw: userProfile?.canEditStudent,
    canDeleteStudentRaw: userProfile?.canDeleteStudent,
    canAddStudent,
    canCreateLessonDirectly,
    showPrivateLessonAddInCalendar,
    canEditLesson,
    canDeleteLesson,
    canManageAttendance,
    canEditStudent,
    canDeleteStudent,
  })

  async function handleDeletePrivateLesson(lesson) {
    if (!canDeleteLesson) {
      alert('수업 삭제 권한이 없습니다.')
      return
    }

    const label = `${getLessonStorageDateString(lesson)} ${lessonTimeInputValue(lesson)} ${lesson.subject || ''}`.trim()
    if (!window.confirm(`이 개인 수업을 삭제할까요?\n${label || lesson.id}`)) return

    const packageIdBeforeDelete = String(lesson.packageId || '').trim()

    try {
      assertSameAcademy(lesson, currentAcademyId, '개인 수업')
      setBusyDeletingPrivateLessonId(lesson.id)
      await deleteDoc(doc(db, 'lessons', lesson.id))
      if (packageIdBeforeDelete) {
        await recomputePrivatePackageUsage(packageIdBeforeDelete, currentAcademyId)
      }
    } catch (error) {
      console.error('개인 수업 삭제 실패:', error)
      alert(`개인 수업 삭제 실패: ${error.message}`)
    } finally {
      setBusyDeletingPrivateLessonId(null)
    }
  }

  async function cancelFixedPrivateLessonOccurrence(lesson, cancellationType) {
    const type = String(cancellationType || '').trim()
    const isSeatRelease = type === 'seat_released'
    if (!isAdmin) {
      alert('고정 1:1 수업 취소 권한이 없습니다.')
      return
    }
    if (!lesson?.id) return
    const label = `${getLessonStorageDateString(lesson)} ${lessonTimeInputValue(lesson)} ${lesson.subject || ''}`.trim()
    const message = isSeatRelease
      ? '이 고정 1:1 수업을 취소하고 같은 시간대를 다른 학생이 예약할 수 있게 공개할까요?\n' +
        `${label || lesson.id}\n\n` +
        '기존 학생은 해당 1회 수업 배정에서 제외됩니다.'
      : '이 고정 1:1 수업을 취소할까요?\n' +
        `${label || lesson.id}\n\n` +
        '이 시간은 다른 학생에게 공개되지 않습니다.'
    if (!window.confirm(message)) return
    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(lesson, scopedAcademyId, '고정 1:1 수업')
      setBusyFixedPrivateLessonCancelId(lesson.id)
      const callable = httpsCallable(firebaseFunctions, 'cancelFixedPrivateLessonOccurrence')
      await callable({
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        cancellationType: isSeatRelease ? 'seat_released' : 'lesson_cancelled',
      })
    } catch (error) {
      console.error('고정 1:1 수업 취소 실패:', error)
      alert(`고정 1:1 수업 취소 실패: ${error.message}`)
    } finally {
      setBusyFixedPrivateLessonCancelId('')
    }
  }

  const calendarSectionProps = {
    month: {
      view: 'month',
      setCalendarMonth,
      calendarMonthLabel,
      calendarDays,
      lessonsCountByDate,
      lessonsPreviewByDate,
      calendarMonth,
      selectedDate,
      setSelectedDate,
      setShowOnlySelectedDate,
    },
    lessons: {
      view: 'lessons',
      activeSection,
      showOnlySelectedDate,
      selectedDateString,
      selectedDateDisplayString,
      setSelectedDate,
      setShowOnlySelectedDate,
      showPrivateLessonAddInCalendar,
      openPrivateLessonModal,
      loading,
      isPrivateLessonModalSubmitting,
      sortedPrivateStudentsLength: studentsSectionViewModel.sortedPrivateStudents.length,
      enableLegacyLessonMigrationButton: ENABLE_LEGACY_LESSON_MIGRATION_BUTTON,
      enableGroupLegacyBackfillTool: ENABLE_GROUP_LEGACY_BACKFILL_TOOL,
      isAdmin,
      handleMigrateLessons,
      migrating,
      handleGroupLegacyBackfill,
      busyGroupLegacyBackfill,
      displayedLessons,
      allPrivateLessons: lessons,
      privateLessonReservations,
      getMatchedStudent,
      getMatchedStudentId,
      studentPackages,
      handleDeductionToggle,
      canManageAttendance,
      canManagePrivateLessonDeductions,
      busyLessonId,
      busyPrivateLessonCrudId,
      busyFixedPrivateLessonCancelId,
      busyPrivateLessonAdd,
      busyPrivateReservationOutcomeId,
      openPrivateLessonEditModal,
      handleDeletePrivateLesson,
      onCancelFixedPrivateLesson: cancelFixedPrivateLessonOccurrence,
      onMarkPrivateReservationOutcome: markPrivateReservationOutcome,
      onReversePrivateReservationOutcome: reversePrivateReservationOutcome,
      canEditLesson,
      canDeleteLesson,
      onOpenCalendarGroupLessonAttendance: openCalendarGroupLessonAttendance,
      onOpenGroupLessonNoDeductionCancel: openGroupLessonNoDeductionCancelModal,
      openStudentPackageEditModal,
      canEditStudentPackageCountsForPackage,
    },
  }

  const studentsSectionProps = {
    ...studentsSectionViewModel,
    loading: privateStudentsLoading,
    currentAcademyId,
    privateStudents,
    studentPrivateBookingStats,
    isAdmin,
    groupClasses,
    studentSummaryGroupLessons,
    studentSummaryGroupStudents,
    studentPackages,
    busyStudentId,
    busyStudentPackageSubmit,
    busyStudentPackageActionId,
    canAddStudent,
    canEditStudent,
    canDeleteStudent,
    canViewPaymentFields,
    openStudentAddModal,
    openStudentEditModal,
    handleDeleteStudent,
    openStudentPackageModal,
    openStudentPackageEditModal,
    canEditStudentPackageCountsForPackage,
    endStudentPackage,
    openStudentPackageHistoryModal,
    openStudentPackageReRegisterModal,
    formatStudentFirstRegisteredForTable,
    formatStudentPackageCellSummary,
  }

  const groupsSectionProps = {
    sectionTitle: isAdmin ? ADMIN_GROUP_MANAGEMENT_LABEL : TEACHER_GROUP_MANAGEMENT_LABEL,
    canManageGroupClasses,
    canDeleteGroupClasses,
    busyGroupId,
    groupClassesLoading,
    openGroupAddModal,
    sortedGroupClasses,
    setSelectedGroupClass,
    selectedGroupClass,
    openGroupEditModal,
    handleDeleteGroup,
    canAddStudent,
    openGroupStudentAddModal,
    busyGroupStudentId,
    groupStudentsLoading,
    canUseDirectLessonCreation,
    busyGroupLessonId,
    busyGroupLessonSeries,
    groupLessonsLoading,
    openGroupLessonAddModal,
    openGroupLessonSeriesModal,
    isAdmin,
    canViewPaymentFields,
    openGroupLessonPurgeModal,
    busyGroupLessonPurge,
    sortedGroupStudentsForSelectedClass,
    handleRemoveGroupStudent,
    sortedGroupLessonsForSelectedClass,
    groupLessonReservations,
    groupLessonReservationsLoading,
    groupLessonSeatAvailabilityById,
    groupReservationModal,
    busyGroupReservationId,
    canManageGroupReservations: isAdmin,
    openGroupLessonReservationAddModal,
    openGroupLessonReservationViewModal,
    closeGroupLessonReservationModal,
    reserveGroupLessonSeat,
    cancelGroupLessonSeat,
    busyGroupAttendanceStudentId,
    canManageAttendance,
    openGroupLessonAttendanceModal,
    canEditLesson,
    openGroupLessonEditModal,
    openGroupLessonNoDeductionCancelModal,
    canDeleteLesson,
    handleDeleteGroupLesson,
    getGroupStudentDisplayName,
    openGroupStudentManageModal,
    busyGroupStudentManageId,
    requiresLessonApproval: userProfile?.requiresLessonApproval === true,
  }

  const privateFixedSlotAssignmentPackageOptions = useMemo(() => {
    const studentId = String(privateFixedSlotAssignmentForm.studentId || '').trim()
    const templateId = String(privateFixedSlotAssignmentForm.templateId || '').trim()
    if (!studentId || !templateId || !isValidOperationalAcademyId(currentAcademyId)) return []
    const template =
      privateAvailabilityTemplates.find((row) => String(row.id || '').trim() === templateId) || null
    if (!template) return []
    const teacherFields = buildPrivateTemplateTeacherFields(template)
    return studentPackages
      .filter((pkg) =>
        isActivePrivatePackageForTeacher({
          pkg,
          academyId: currentAcademyId,
          studentId,
          teacher: teacherFields.teacher,
          teacherKey: teacherFields.teacherKey,
          teacherUid: teacherFields.teacherUid,
        })
      )
      .map((pkg) => {
        const balance = computePrivateTeacherPackageUsage({
          privatePackage: pkg,
          privateLessons: lessons,
          privateReservations: privateLessonReservations,
          academyId: currentAcademyId,
          studentId,
          teacher: teacherFields.teacher,
          teacherKey: teacherFields.teacherKey,
          teacherUid: teacherFields.teacherUid,
          teacherUID: teacherFields.teacherUID,
          teacherId: teacherFields.teacherId,
        })
        const availableCount = Math.max(0, Number(balance.makeupAvailableCount) || 0)
        return {
          id: String(pkg.id || '').trim(),
          label: formatPrivatePackageAssignmentOption(pkg, availableCount),
          availableCount,
        }
      })
      .filter((option) => option.id)
      .sort((a, b) => b.availableCount - a.availableCount || a.label.localeCompare(b.label, 'ko'))
  }, [
    currentAcademyId,
    lessons,
    privateAvailabilityTemplates,
    privateFixedSlotAssignmentForm.studentId,
    privateFixedSlotAssignmentForm.templateId,
    privateLessonReservations,
    studentPackages,
  ])

  const privateLessonSlotsSectionProps = {
    canManagePrivateSlots: isAdmin,
    teacherSelectOptions,
    privateSlotForm,
    setPrivateSlotForm,
    privateSlotFormErrors,
    privateSlotCreateResult,
    privateAvailabilityBulkForm,
    setPrivateAvailabilityBulkForm,
    privateAvailabilityBulkErrors,
    privateAvailabilityBulkResult,
    previewPrivateAvailabilityBulkTemplates,
    createPrivateAvailabilityBulkTemplates,
    privateAvailabilityTemplateForm,
    setPrivateAvailabilityTemplateForm,
    privateAvailabilityTemplateErrors,
    createPrivateAvailabilityTemplate,
    updatePrivateAvailabilityTemplateStatus,
    privateAvailabilityTemplates,
    privateAvailabilityTemplatesLoading,
    busyPrivateAvailabilityTemplateId,
    privateStudents,
    privateFixedSlotAssignmentForm,
    setPrivateFixedSlotAssignmentForm,
    privateFixedSlotAssignmentErrors,
    privateFixedSlotAssignmentPreview,
    privateFixedSlotAssignmentPackageOptions,
    previewPrivateFixedSlotAssignment,
    createPrivateFixedSlotAssignment,
    busyPrivateFixedSlotAssignment,
    createPrivateSlot,
    updatePrivateSlotEligibility,
    isPrivateSlotSubmitting: busyPrivateSlotActionId === '__add__',
    privateLessonSlots,
    privateLessonSlotsLoading,
    privateLessonReservations,
    privateLessonReservationsLoading,
    busyPrivateSlotActionId,
    cancelPrivateSlotOrReservation,
    privateFixedLessons: lessons,
    busyFixedPrivateLessonCancelId,
    onCancelFixedPrivateLesson: cancelFixedPrivateLessonOccurrence,
    isAdmin,
  }

  const studentModalProps = {
    studentModal,
    studentForm,
    setStudentForm,
    studentFormErrors,
    isAdmin,
    teacherSelectOptions,
    isStudentModalSubmitting,
    closeStudentModal,
    submitStudentModal,
  }

  const postStudentCreateModalProps = {
    postStudentCreateModalStudent,
    closePostStudentCreateModal,
    selectPostStudentCreatePrivatePackage,
    selectPostStudentCreateGroupPackage,
  }

  const studentPackageModalProps = {
    studentPackageModalStudent,
    studentPackageForm,
    setStudentPackageForm,
    studentPackageFormErrors,
    canViewPaymentFields,
    sortedGroupClasses,
    nextGroupLessonDateByGroupId,
    studentPackageGroupAutoSummary,
    studentPackageModalActiveSameScopeDuplicates,
    openExistingStudentPackageFromAddModal,
    goToFixedPrivateAssignmentFromPackageModal,
    isStudentPackageModalSubmitting,
    closeStudentPackageModal,
    submitStudentPackageModal,
  }

  const studentPackageEditModalProps = {
    studentPackageEditModalPackage,
    studentPackageEditForm,
    setStudentPackageEditForm,
    studentPackageEditFormErrors,
    busyStudentPackageActionId,
    studentPackageEditMode,
    canViewPaymentFields,
    closeStudentPackageEditModal,
    submitStudentPackageEditModal,
  }

  const studentPackageHistoryModalProps = {
    studentPackageHistoryModalPackage,
    studentPackageHistoryLoading,
    studentPackageHistoryRows,
    closeStudentPackageHistoryModal,
  }

  const postGroupReEnrollModalProps = {
    postGroupReEnrollModalData,
    postGroupReEnrollStartDate,
    setPostGroupReEnrollStartDate,
    postGroupReEnrollMinStartYmd,
    postGroupReEnrollErrors,
    closePostGroupReEnrollModal,
    busyPostGroupReEnroll,
    submitPostGroupReEnroll,
  }

  const postPrivateLessonScheduleModalProps = {
    postPrivateLessonScheduleModalData,
    postPrivateLessonScheduleForm,
    setPostPrivateLessonScheduleForm,
    postPrivateLessonScheduleErrors,
    closePostPrivateLessonScheduleModal,
    submitPostPrivateLessonSchedule,
    goToFixedPrivateAssignmentFromPostPrivateLessonScheduleModal,
    busyPostPrivateLessonSchedule,
  }

  const groupModalProps = {
    groupModal,
    groupForm,
    setGroupForm,
    groupFormErrors,
    setGroupFormErrors,
    teacherSelectOptions: isAdmin
      ? teacherSelectOptions
      : [{ value: teacherGroupClassKey, label: userProfile?.teacherName || teacherGroupClassKey }],
    lockTeacherSelect: !isAdmin,
    closeGroupModal,
    submitGroupModal,
    isGroupModalSubmitting,
  }

  const postGroupScheduleRebuildModalProps = {
    postGroupScheduleRebuildModalData,
    postGroupScheduleRebuildFromDate,
    postGroupScheduleRebuildEffectiveFromYmd,
    setPostGroupScheduleRebuildFromDate,
    postGroupScheduleRebuildErrors,
    closePostGroupScheduleRebuildModal,
    busyPostGroupScheduleRebuild,
    submitPostGroupScheduleRebuild,
  }

  const groupStudentAddModalProps = {
    selectedGroupClass,
    isAdmin,
    canViewPaymentFields,
    groupStudentForm,
    setGroupStudentForm,
    groupStudentFormErrors,
    groupStudentEligiblePackages,
    groupStudentSelectedPackagePreview,
    closeGroupStudentAddModal,
    submitGroupStudentAdd,
    isGroupStudentModalSubmitting,
  }

  const groupLessonModalProps = {
    groupLessonModal,
    selectedGroupClass,
    groupLessonForm,
    setGroupLessonForm,
    groupLessonFormErrors,
    closeGroupLessonModal,
    submitGroupLessonModal,
    isGroupLessonModalSubmitting,
  }

  const groupLessonSeriesModalProps = {
    selectedGroupClass,
    groupLessonSeriesForm,
    setGroupLessonSeriesForm,
    groupLessonSeriesFormErrors,
    groupLessonSeriesPlannedCount,
    closeGroupLessonSeriesModal,
    submitGroupLessonSeriesModal,
    isGroupLessonSeriesSubmitting,
  }

  const groupLessonPurgeModalProps = {
    selectedGroupClass,
    groupLessonPurgeFromDate,
    setGroupLessonPurgeFromDate,
    groupLessonPurgeFormErrors,
    closeGroupLessonPurgeModal,
    submitGroupLessonPurgeFromDate,
    busyGroupLessonPurge,
  }

  const groupStudentManageModalProps = {
    groupStudent: groupStudentManageModal,
    studentPackages,
    form: groupStudentManageForm,
    formErrors: groupStudentManageFormErrors,
    onFieldChange: updateGroupStudentManageField,
    onAddExcludedDate: addGroupStudentManageExcludedDate,
    onRemoveExcludedDate: removeGroupStudentManageExcludedDate,
    onClose: closeGroupStudentManageModal,
    onSave: submitGroupStudentManageModal,
    isSubmitting: isGroupStudentManageSubmitting,
  }

  const groupLessonAttendanceModalProps = {
    selectedGroupClass,
    groupLessonForAttendanceModal,
    groupLessonAttendanceModalRows,
    groupLessonSeatAvailability:
      groupLessonForAttendanceModal?.id
        ? groupLessonSeatAvailabilityById[groupLessonForAttendanceModal.id] || null
        : null,
    isPastLesson: isPastGroupLesson(groupLessonForAttendanceModal),
    isAdmin,
    busyGroupAttendanceStudentId,
    applyGroupLessonAttendanceDeduction,
    applyGroupLessonAttendanceUndo,
    releaseGroupLessonFixedSeat,
    restoreGroupLessonFixedSeat,
    closeGroupLessonAttendanceModal,
  }

  const privateLessonModalProps = {
    isAdmin,
    canViewPaymentFields,
    privateLessonForm,
    setPrivateLessonForm,
    privateLessonFormErrors,
    sortedPrivateStudents: studentsSectionViewModel.sortedPrivateStudents,
    privateLessonEligiblePackages,
    privateLessonSelectedPackagePreview,
    closePrivateLessonModal,
    submitPrivateLessonModal,
    isPrivateLessonModalSubmitting,
  }

  const privateLessonEditModalProps = {
    privateLessonEditModal,
    privateLessonEditForm,
    setPrivateLessonEditForm,
    privateLessonEditFormErrors,
    closePrivateLessonEditModal,
    submitPrivateLessonEditModal,
    isPrivateLessonEditSubmitting,
  }

  const teacherManagementSectionProps = {
    currentAcademyId,
    teachers: teacherManagementTeachers,
    teachersLoading,
    teacherForm,
    setTeacherForm,
    teacherFormErrors,
    isTeacherFormSubmitting,
    submitTeacherForm,
    editTeacher,
    cancelTeacherEdit: resetTeacherForm,
    updateTeacherStatus,
    updateTeacherCountEditPermission,
    updateTeacherLessonDeductionPermission,
    busyTeacherId,
    lessons,
    privateLessonReservations,
    privateLessonSlots,
    privateStudents,
    studentPackages,
    studentPrivateBookingStats,
    rosterDataLoading:
      loading ||
      privateLessonReservationsLoading ||
      privateLessonSlotsLoading ||
      privateStudentsLoading ||
      studentPrivateBookingStatsLoading,
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">⬡</span>
          <span className="logo-text">Miami Admin</span>
        </div>

        <nav className="sidebar-nav">
  {[
    { key: 'calendar', label: '캘린더' },
    ...(isAdmin || canUseStudentPackageCountSection ? [{ key: 'students', label: '학생 관리' }] : []),
    ...(canManageOwnGroupClasses
      ? [{ key: 'teacherPrivateRequests', label: TEACHER_PRIVATE_LESSON_REQUESTS_LABEL }]
      : []),
    ...(isAdmin || canManageOwnGroupClasses
      ? [{ key: 'groups', label: isAdmin ? ADMIN_GROUP_MANAGEMENT_LABEL : TEACHER_GROUP_MANAGEMENT_LABEL }]
      : []),
    ...(isAdmin ? [{ key: 'privateSlots', label: PRIVATE_SLOT_MANAGEMENT_LABEL }] : []),
    ...(isAdmin ? [{ key: 'lessonRequests', label: '수업 요청 관리' }] : []),
    ...(isAdmin ? [{ key: 'teachers', label: '선생님 관리' }] : []),
    ...(isAdmin ? [{ key: 'dailyMaterials', label: '오늘의 영상 관리' }] : []),
  ].map((item) => (
    <button
      key={item.key}
      type="button"
      onClick={() => setActiveSection(item.key)}
      className={`nav-item ${activeSection === item.key ? 'active' : ''}`}
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span className="nav-dot" />
      {item.label}
    </button>
  ))}
</nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{user?.email?.[0]?.toUpperCase() || 'U'}</div>
            <div className="user-info">
              <span className="user-email">{user?.email || '-'}</span>
              <span className="user-role">{userProfile?.role || 'user'}</span>
            </div>
          </div>

          <button className="btn-signout" onClick={handleSignOut}>
            로그아웃
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="main-header">
          <div>
          <h1 className="page-title">
	  {activeSection === 'calendar'
	    ? '캘린더'
	    : activeSection === 'students'
	    ? '학생 관리'
	    : activeSection === 'groups'
	    ? isAdmin
        ? ADMIN_GROUP_MANAGEMENT_LABEL
        : TEACHER_GROUP_MANAGEMENT_LABEL
      : activeSection === 'teacherPrivateRequests'
      ? TEACHER_PRIVATE_LESSON_REQUESTS_LABEL
	    : activeSection === 'teachers'
	    ? '선생님 관리'
	    : activeSection === 'lessonRequests'
	    ? '수업 요청 관리'
	    : activeSection === 'dailyMaterials'
	    ? '오늘의 영상 관리'
	    : PRIVATE_SLOT_MANAGEMENT_LABEL}
</h1>
            <p className="page-sub" data-testid="dashboard-welcome-subtitle">
              {userProfile?.teacherName
                ? `${userProfile.teacherName} 님 환영합니다`
                : `${user?.email || '사용자'} 님, 환영합니다`}
            </p>
	          </div>
	          </header>

          <div style={{ marginBottom: 20 }}>
            <TodaySchedulePanel
              items={todaySchedulePanelItems}
              summary={todaySchedulePanelSummary}
              loading={todayScheduleLoading}
              showStudent={activeSection !== 'groups'}
              title={activeSection === 'groups' ? '오늘의 단체반 일정' : '오늘의 일정'}
            />
          </div>

          {activeSection === 'calendar' ? (
            <ReservationNotificationsPanel
              events={reservationNotificationEvents}
              loading={reservationNotificationEventsLoading}
            />
          ) : null}
	
	          {activeSection === 'calendar' && (
            <CalendarSection {...calendarSectionProps.month} />
          )}
          {activeSection === 'students' && (isAdmin || canUseStudentPackageCountSection) ? (
            <StudentsSection {...studentsSectionProps} />
          ) : null}
          {activeSection === 'groups' && (isAdmin || canManageOwnGroupClasses) ? (
            <GroupsSection {...groupsSectionProps} />
          ) : null}
          {activeSection === 'teacherPrivateRequests' && canManageOwnGroupClasses ? (
            <TeacherPrivateLessonRequestsSection
              currentAcademyId={currentAcademyId}
              user={user}
              userProfile={userProfile}
              privateStudents={privateStudents}
            />
          ) : null}
	          {activeSection === 'privateSlots' && isAdmin ? (
	            <PrivateLessonSlotsSection {...privateLessonSlotsSectionProps} />
	          ) : null}
	          {activeSection === 'lessonRequests' && isAdmin ? (
	            <LessonRequestsSection
	              currentAcademyId={currentAcademyId}
	              user={user}
	              userProfile={userProfile}
	            />
	          ) : null}
	          {activeSection === 'dailyMaterials' && isAdmin ? (
	            <DailyMaterialsSection currentAcademyId={currentAcademyId} user={user} />
	          ) : null}
	          {activeSection === 'teachers' && isAdmin ? (
	            <TeacherManagementSection {...teacherManagementSectionProps} />
	          ) : null}

	        {activeSection !== 'privateSlots' &&
          activeSection !== 'teacherPrivateRequests' &&
          activeSection !== 'lessonRequests' &&
          activeSection !== 'dailyMaterials' &&
          activeSection !== 'teachers' ? (
	          <CalendarSection {...calendarSectionProps.lessons} />
	        ) : null}

      </main>

      {activeSection === 'students' && isAdmin && studentModal ? (
        <StudentModal {...studentModalProps} />
      ) : null}
      {activeSection === 'students' && isAdmin && postStudentCreateModalStudent ? (
        <PostStudentCreateModal {...postStudentCreateModalProps} />
      ) : null}
      {activeSection === 'students' && isAdmin && studentPackageModalStudent ? (
        <StudentPackageModal {...studentPackageModalProps} />
      ) : null}
      {studentPackageEditModalPackage ? (
        <StudentPackageEditModal {...studentPackageEditModalProps} />
      ) : null}

      {activeSection === 'students' && isAdmin && postGroupReEnrollModalData ? (
        <PostGroupReEnrollModal {...postGroupReEnrollModalProps} />
      ) : null}

      {activeSection === 'students' && isAdmin && postPrivateLessonScheduleModalData ? (
        <PostPrivateLessonScheduleModal {...postPrivateLessonScheduleModalProps} />
      ) : null}

      {activeSection === 'students' && isAdmin && studentPackageHistoryModalPackage ? (
        <StudentPackageHistoryModal {...studentPackageHistoryModalProps} />
      ) : null}

      {activeSection === 'groups' && (isAdmin || canManageOwnGroupClasses) && groupModal ? (
        <GroupModal {...groupModalProps} />
      ) : null}

      {activeSection === 'groups' && isAdmin && postGroupScheduleRebuildModalData ? (
        <PostGroupScheduleRebuildModal {...postGroupScheduleRebuildModalProps} />
      ) : null}

      {activeSection === 'groups' &&
      isAdmin &&
      groupStudentAddModalOpen &&
      selectedGroupClass ? (
        <GroupStudentAddModal {...groupStudentAddModalProps} />
      ) : null}

      {activeSection === 'groups' && isAdmin && groupStudentManageModal ? (
        <GroupStudentManageModal {...groupStudentManageModalProps} />
      ) : null}

      {activeSection === 'groups' && isAdmin && groupLessonModal && selectedGroupClass ? (
        <GroupLessonModal {...groupLessonModalProps} />
      ) : null}

      {activeSection === 'groups' && isAdmin && groupLessonSeriesModalOpen && selectedGroupClass ? (
        <GroupLessonSeriesModal {...groupLessonSeriesModalProps} />
      ) : null}

      {activeSection === 'groups' && isAdmin && groupLessonPurgeModalOpen && selectedGroupClass ? (
        <GroupLessonPurgeModal {...groupLessonPurgeModalProps} />
      ) : null}

      {groupLessonAttendanceModal &&
      isAdmin &&
      selectedGroupClass &&
      groupLessonForAttendanceModal ? (
        <GroupLessonAttendanceModal {...groupLessonAttendanceModalProps} />
      ) : null}

      {isAdmin && groupClosureModal?.group ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-closure-modal-title"
          data-testid="group-closure-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 80,
          }}
        >
          <div
            style={{
              width: 'min(520px, 100%)',
              borderRadius: 16,
              border: '1px solid #2e3240',
              background: '#151922',
              color: 'white',
              padding: 20,
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          >
            <h2 id="group-closure-modal-title" style={{ marginTop: 0 }}>반 운영 종료</h2>
            <p style={{ opacity: 0.75, fontSize: 14 }}>
              선택한 날짜 이후의 예정 수업만 취소됩니다. 과거 수업 기록은 유지됩니다.
            </p>
            <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>
              종료 기준일
              <input
                type="date"
                value={groupClosureForm.closedFromDate}
                onChange={(event) =>
                  setGroupClosureForm((prev) => ({
                    ...prev,
                    closedFromDate: event.target.value,
                  }))
                }
              />
            </label>
            {groupClosureErrors.closedFromDate ? (
              <p style={{ color: '#f4a7a7', fontSize: 13 }}>{groupClosureErrors.closedFromDate}</p>
            ) : null}
            <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>
              종료 사유
              <textarea
                value={groupClosureForm.closedReason}
                onChange={(event) =>
                  setGroupClosureForm((prev) => ({
                    ...prev,
                    closedReason: event.target.value,
                  }))
                }
                rows={3}
                placeholder="예: 과정 종료, 반 통합"
              />
            </label>
            {groupClosureErrors.closedReason ? (
              <p style={{ color: '#f4a7a7', fontSize: 13 }}>{groupClosureErrors.closedReason}</p>
            ) : null}
            <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
              <label>
                <input
                  type="radio"
                  name="groupClosureCancelFutureLessons"
                  checked={groupClosureForm.cancelFutureLessons === true}
                  onChange={() =>
                    setGroupClosureForm((prev) => ({ ...prev, cancelFutureLessons: true }))
                  }
                />{' '}
                선택한 날짜 이후 예정 수업 취소
              </label>
              <label>
                <input
                  type="radio"
                  name="groupClosureCancelFutureLessons"
                  checked={groupClosureForm.cancelFutureLessons === false}
                  onChange={() =>
                    setGroupClosureForm((prev) => ({ ...prev, cancelFutureLessons: false }))
                  }
                />{' '}
                반만 비활성화하고 예정 수업은 유지
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" onClick={() => setGroupClosureModal(null)}>
                취소
              </button>
              <button
                type="button"
                onClick={submitGroupClosure}
                disabled={Boolean(busyGroupId)}
                style={{
                  background: '#4a2a2a',
                  color: 'white',
                  border: '1px solid #553333',
                  borderRadius: 8,
                  padding: '8px 12px',
                }}
              >
                {busyGroupId ? '처리 중...' : '운영 종료'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAdmin && groupLessonNoDeductionCancelModal?.lesson ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-lesson-no-deduction-cancel-title"
          data-testid="group-lesson-no-deduction-cancel-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 85,
          }}
        >
          <div
            style={{
              width: 'min(520px, 100%)',
              borderRadius: 16,
              border: '1px solid #2e3240',
              background: '#151922',
              color: 'white',
              padding: 20,
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          >
            <h2 id="group-lesson-no-deduction-cancel-title" style={{ marginTop: 0 }}>
              휴강 처리
            </h2>
            <p style={{ opacity: 0.75, fontSize: 14 }}>
              이 수업은 휴강 처리되며 수강권이 차감되지 않습니다.
            </p>
            <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>
              휴강 사유
              <select
                value={groupLessonNoDeductionCancelForm.cancelledReason}
                onChange={(event) =>
                  setGroupLessonNoDeductionCancelForm((prev) => ({
                    ...prev,
                    cancelledReason: event.target.value,
                  }))
                }
              >
                <option value="holiday">공휴일</option>
                <option value="teacher_unavailable">선생님 사정</option>
                <option value="academy_closed">학원 사정</option>
                <option value="other">기타</option>
              </select>
            </label>
            {groupLessonNoDeductionCancelErrors.cancelledReason ? (
              <p style={{ color: '#f4a7a7', fontSize: 13 }}>
                {groupLessonNoDeductionCancelErrors.cancelledReason}
              </p>
            ) : null}
            <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>
              학생 안내 문구 (선택)
              <textarea
                value={groupLessonNoDeductionCancelForm.cancellationNote}
                onChange={(event) =>
                  setGroupLessonNoDeductionCancelForm((prev) => ({
                    ...prev,
                    cancellationNote: event.target.value,
                  }))
                }
                rows={3}
                placeholder="예: 공휴일로 휴강합니다."
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" onClick={() => setGroupLessonNoDeductionCancelModal(null)}>
                취소
              </button>
              <button
                type="button"
                onClick={submitGroupLessonNoDeductionCancel}
                disabled={Boolean(busyGroupLessonId)}
                style={{
                  background: '#3a321f',
                  color: '#ffe8b8',
                  border: '1px solid #665533',
                  borderRadius: 8,
                  padding: '8px 12px',
                }}
              >
                {busyGroupLessonId ? '처리 중...' : '휴강 처리'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'calendar' && isAdmin && privateLessonModalOpen ? (
        <PrivateLessonModal {...privateLessonModalProps} />
      ) : null}

      {activeSection === 'calendar' && isAdmin && privateLessonEditModal ? (
        <PrivateLessonEditModal {...privateLessonEditModalProps} />
      ) : null}

    </div>
  )
}
