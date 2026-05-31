import { useEffect, useMemo, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useNavigate } from 'react-router-dom'
import { auth, db, functions as firebaseFunctions } from './firebase'
import { useAuth } from './AuthContext'
import { debugLog } from './src/utils/debugLog.js'
import TodaySchedulePanel from './src/features/dashboard/components/TodaySchedulePanel.jsx'
import DailyMaterialStudentPanel from './src/features/public/DailyMaterialStudentPanel.jsx'
import {
  assertSameAcademy,
  isValidOperationalAcademyId,
  requireCurrentAcademyId,
} from './src/features/dashboard/academyScope.js'
import {
  formatLessonSessionNumber,
  getLessonStorageDateString,
  getTodayStorageDateString,
} from './src/features/dashboard/dashboardViewUtils.js'
import {
  buildGroupLessonReservationId,
  buildStudentGroupAccessSummaryId,
} from './src/features/group-booking/bookingModel.js'
import {
  buildPrivateLessonReservationId,
  buildStudentPrivateAccessSummaryId,
  normalizePrivateTeacherKey,
} from './src/features/private-booking/privateBookingModel.js'
import {
  buildMondaySaturdayWeekDays,
  formatKstDotDateTime,
  getBookingWindowForPrivateLesson,
  getMondayForKstDate,
  getPrivateBookingStatusLabel,
  getPrivateBookingStatus,
  getRelativeOpenLabel,
} from './src/features/booking/privateBookingWindow.js'
import {
  getGroupCourseTypeLabel,
  normalizeGroupCourseType,
} from './src/features/group-booking/groupCourseTypes.js'
import {
  buildStudentPrivateTicketSummariesFromCallablePackages,
  buildStudentTicketSummaryViewModel,
  formatStudentBookingIdentityLine,
  resolveLinkedStudentDisplayName,
} from './src/features/booking/studentTicketSummary.js'

const GROUP_CLASS_QUERY_CHUNK_SIZE = 10
function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    String(value || '').trim().toLowerCase()
  )
}

const PRIVATE_SLOT_BOOKING_OVERRIDE_ENABLED =
  import.meta.env.MODE === 'e2e' &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('privateSlotBooking') === 'enabled'

const PRIVATE_SLOT_BOOKING_ENABLED =
  isEnabledFlag(import.meta.env.VITE_PRIVATE_SLOT_BOOKING_ENABLED) ||
  PRIVATE_SLOT_BOOKING_OVERRIDE_ENABLED

const PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE = PRIVATE_SLOT_BOOKING_OVERRIDE_ENABLED
  ? { privateSlotBooking: 'enabled' }
  : {}

const PRIVATE_SLOT_RESERVE_CONFIRM_MESSAGE =
  '1:1 수업을 예약하시겠습니까?\n\n취소는 수업 시작 6시간 전까지만 가능하며, 학생 직접 취소는 최대 2회까지 가능합니다.'

const PRIVATE_RESERVATION_CANCEL_CONFIRM_MESSAGE =
  '예약을 취소하시겠습니까?\n\n학생 직접 취소는 최대 2회까지 가능하며, 이 취소도 횟수에 포함됩니다.'

function chunkValues(values, size) {
  const out = []
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size))
  }
  return out
}

function validateLessonBookingState(lesson, mode) {
  const capacity = Number(lesson?.capacity ?? 0)
  const bookedCount = Number(lesson?.bookedCount ?? 0)
  const remainingSeats = Number(lesson?.remainingSeats ?? lesson?.seatAvailability?.remainingSeats)

  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error('예약 불가 수업입니다.')
  }
  if (!Number.isFinite(bookedCount) || bookedCount < 0) {
    throw new Error('예약 수가 올바르지 않습니다.')
  }
  if (bookedCount > capacity) {
    throw new Error('예약 수가 정원을 초과했습니다.')
  }
  if (mode === 'reserve') {
    if (lesson?.isBookable !== true) throw new Error('예약 불가 수업입니다.')
    if (Number.isFinite(remainingSeats) && remainingSeats <= 0) throw new Error('정원 마감')
    if (bookedCount >= capacity) throw new Error('정원 마감')
    return
  }
  if (bookedCount <= 0) {
    throw new Error('예약 수가 올바르지 않습니다.')
  }
}

function getLessonCapacityLabel(lesson) {
  const capacity = Number(lesson?.capacity ?? 0)
  const safeCapacity = Number.isFinite(capacity) && capacity >= 0 ? capacity : 0
  const remainingSeats = Number(lesson?.remainingSeats ?? lesson?.seatAvailability?.remainingSeats)
  if (Number.isFinite(remainingSeats)) {
    return `남은 자리 ${Math.max(0, remainingSeats)}명`
  }
  const bookedCount = Number(lesson?.bookedCount ?? 0)
  const safeBooked = Number.isFinite(bookedCount) && bookedCount >= 0 ? bookedCount : 0
  return `남은 자리 ${Math.max(0, safeCapacity - safeBooked)}명`
}

function getReservationStatusLabel(reservation) {
  if (reservation?.noDeduction === true) {
    return '휴강 · 차감 없음'
  }
  return reservation?.status === 'active' ? '예약 완료' : '예약 취소'
}

function getLessonDisplayTime(lesson) {
  return String(lesson?.time || lesson?.startTime || '').trim()
}

function getLessonTeacherLabel(lesson) {
  return String(lesson?.teacherName || lesson?.teacher || '').trim() || '-'
}

function getLessonSubjectLabel(lesson) {
  return String(lesson?.subject || '').trim() || '1:1 수업'
}

function getDateTimeMs(dateValue, timeValue) {
  const date = String(dateValue || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const time = String(timeValue || '').trim()
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '23:59'
  const parsed = new Date(`${date}T${safeTime}:00`)
  const value = parsed.getTime()
  return Number.isFinite(value) ? value : null
}

function normalizePrivateAccessKey(value) {
  return normalizePrivateTeacherKey(value).toLowerCase()
}

function privateTeacherValuesMatch(values, teacherValue) {
  const teacherKey = normalizePrivateAccessKey(teacherValue)
  if (!teacherKey) return false
  return values.some((value) => normalizePrivateAccessKey(value) === teacherKey)
}

function slotMatchesPrivateTeacherAccess(slot, teacherKeys) {
  return (
    privateTeacherValuesMatch(teacherKeys, slot?.teacherUid) ||
    privateTeacherValuesMatch(teacherKeys, slot?.teacherUID) ||
    privateTeacherValuesMatch(teacherKeys, slot?.teacherId) ||
    privateTeacherValuesMatch(teacherKeys, slot?.teacherKey) ||
    privateTeacherValuesMatch(teacherKeys, slot?.teacher) ||
    privateTeacherValuesMatch(teacherKeys, slot?.teacherName) ||
    privateTeacherValuesMatch(teacherKeys, slot?.displayName) ||
    privateTeacherValuesMatch(teacherKeys, slot?.name)
  )
}

function getPrivatePackageTeacherKey(pkg) {
  return String(
    pkg?.teacherUid ||
      pkg?.teacherUID ||
      pkg?.teacherId ||
      pkg?.teacherKey ||
      pkg?.teacher ||
      pkg?.teacherName ||
      pkg?.displayName ||
      pkg?.name ||
      ''
  ).trim()
}

function isActivePrivatePackage(pkg) {
  const packageType = String(pkg?.packageType || 'private').trim()
  const status = String(pkg?.status || 'active').trim().toLowerCase()
  return (
    (!packageType || packageType === 'private') &&
    !['inactive', 'expired', 'ended', 'cancelled', 'canceled'].includes(status) &&
    Boolean(getPrivatePackageTeacherKey(pkg))
  )
}

function formatPrivateSlotOpenDisplay(slot) {
  const millis = Number(slot?.bookingOpensAtMillis)
  if (Number.isFinite(millis) && millis > 0) return formatKstDotDateTime(millis)
  const window = getBookingWindowForPrivateLesson(slot?.date, slot?.time)
  return window ? formatKstDotDateTime(window.bookingOpensAt) : ''
}

function getPrivateSlotOpenRelativeDisplay(slot) {
  if (slot?.bookingOpenRelativeLabel) return slot.bookingOpenRelativeLabel
  const millis = Number(slot?.bookingOpensAtMillis)
  if (Number.isFinite(millis) && millis > 0) return getRelativeOpenLabel(millis)
  const window = getBookingWindowForPrivateLesson(slot?.date, slot?.time)
  return window ? getRelativeOpenLabel(window.bookingOpensAt) : ''
}

function getStudentPrivateSlotStatus(slot, canUsePrivateBooking) {
  if (slot?.bookingStatus) return slot.bookingStatus
  const status = getPrivateBookingStatus({
    slot,
    hasPackage: Number(slot?.packageRemainingCount ?? 1) > 0,
    isReservedByMe: false,
  })
  return status === 'available' && !canUsePrivateBooking ? 'blocked' : status
}

function getPrivateSlotAvailableCount(slot) {
  const count = Number(slot?.makeupAvailableCount ?? slot?.packageRemainingCount ?? 0)
  return Number.isFinite(count) ? Math.max(0, count) : 0
}

function getPrivateSlotDisplayLabel(status, fallbackLabel = '') {
  if (
    [
      'available',
      'busy',
      'reserved',
      'blocked',
      'not_open',
      'closed',
      'my_reservation',
      'reserved_by_me',
      'no_ticket',
      'no_makeup',
    ].includes(status)
  ) {
    return getPrivateBookingStatusLabel(status)
  }
  return String(fallbackLabel || '').trim() || getPrivateBookingStatusLabel(status)
}

function getPrivateSlotStatusTone(status) {
  if (status === 'available') {
    return {
      border: '#427a4e',
      background: '#193323',
      badgeBorder: '#5ba765',
      badgeBackground: '#22462d',
      badgeColor: '#d9ffe0',
    }
  }
  if (status === 'not_open') {
    return {
      border: '#6f5a2e',
      background: '#282315',
      badgeBorder: '#9c7a33',
      badgeBackground: '#3a2f18',
      badgeColor: '#ffe5a8',
    }
  }
  if (status === 'closed') {
    return {
      border: '#6a3f4b',
      background: '#281d25',
      badgeBorder: '#9a5865',
      badgeBackground: '#3a242b',
      badgeColor: '#ffd6de',
    }
  }
  if (status === 'my_reservation' || status === 'reserved_by_me') {
    return {
      border: '#356b85',
      background: '#182a36',
      badgeBorder: '#4f9cbc',
      badgeBackground: '#203c4d',
      badgeColor: '#d8f5ff',
    }
  }
  if (status === 'busy' || status === 'reserved' || status === 'blocked') {
    return {
      border: '#4e4261',
      background: '#211c2b',
      badgeBorder: '#78639b',
      badgeBackground: '#30283e',
      badgeColor: '#eadfff',
    }
  }
  return {
    border: '#30384b',
    background: '#1a1f2b',
    badgeBorder: '#4a5570',
    badgeBackground: '#252d3d',
    badgeColor: '#eef3ff',
  }
}

function getPrivateSlotCardStyle(status) {
  const tone = getPrivateSlotStatusTone(status)
  return {
    border: `1px solid ${tone.border}`,
    borderRadius: 8,
    padding: 12,
    background: tone.background,
  }
}

function getPrivateSlotBadgeStyle(status) {
  const tone = getPrivateSlotStatusTone(status)
  return {
    display: 'inline-flex',
    alignItems: 'center',
    border: `1px solid ${tone.badgeBorder}`,
    borderRadius: 999,
    background: tone.badgeBackground,
    color: tone.badgeColor,
    padding: '4px 8px',
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
  }
}

function getPrivateSlotViewModeButtonStyle(isSelected) {
  return {
    padding: '8px 12px',
    borderRadius: 7,
    border: `1px solid ${isSelected ? '#6ea8ff' : 'transparent'}`,
    background: isSelected ? '#263f67' : 'transparent',
    color: isSelected ? 'white' : '#b6c0d0',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: isSelected ? 800 : 600,
    boxShadow: isSelected ? '0 0 0 1px rgba(110, 168, 255, 0.18) inset' : 'none',
  }
}

function getLessonHistoryStatusLabel(item) {
  if (item.noDeduction === true) {
    return '휴강 · 차감 없음'
  }
  if (item.status !== 'active') return '예약 취소'
  if (item.startsAtMs !== null && item.startsAtMs < Date.now()) return '지난 수업'
  return '예약 완료'
}

function validatePrivateSlotBookingState(slot, mode) {
  if (!slot?.id) throw new Error('예약 시간을 찾을 수 없습니다.')
  if (slot.status === 'cancelled') throw new Error('취소된 시간입니다.')
  if (mode === 'reserve') {
    if (slot.status !== 'open') throw new Error('이미 예약된 시간입니다.')
    if (getPrivateSlotAvailableCount(slot) <= 0) {
      throw new Error('예약 가능한 횟수가 없습니다.')
    }
    return
  }
  if (slot.status !== 'reserved') throw new Error('활성 예약 시간을 찾을 수 없습니다.')
}

function logStudentBookingEvent(type, payload) {
  debugLog(`[student-group-booking] ${type}`, payload)
}

function logStudentPrivateBookingEvent(type, payload) {
  debugLog(`[student-private-booking] ${type}`, payload)
}

export default function StudentBookingPage() {
  const navigate = useNavigate()
  const {
    currentAcademy,
    currentAcademyId,
    currentMembership,
    loading: authLoading,
    role,
    studentId,
    user,
  } = useAuth()
  const [allowedGroupClassIds, setAllowedGroupClassIds] = useState([])
  const [allowedGroupCourseTypes, setAllowedGroupCourseTypes] = useState([])
  const [accessLoading, setAccessLoading] = useState(false)
  const [accessResolved, setAccessResolved] = useState(false)
  const [accessError, setAccessError] = useState('')
  const [lessons, setLessons] = useState([])
  const [lessonsLoading, setLessonsLoading] = useState(false)
  const [lessonsError, setLessonsError] = useState('')
  const [reservations, setReservations] = useState([])
  const [reservationsLoading, setReservationsLoading] = useState(false)
  const [reservationsResolved, setReservationsResolved] = useState(false)
  const [reservationsError, setReservationsError] = useState('')
  const [busyReservationId, setBusyReservationId] = useState('')
  const [groupLessonsRefreshKey, setGroupLessonsRefreshKey] = useState(0)
  const [locallyReservedGroupLessonIds, setLocallyReservedGroupLessonIds] = useState([])
  const [allowedPrivateTeacherKeys, setAllowedPrivateTeacherKeys] = useState([])
  const [allowedPrivateSlotIds, setAllowedPrivateSlotIds] = useState([])
  const [privateSlotBookingPilotEnabled, setPrivateSlotBookingPilotEnabled] = useState(false)
  const [privateAccessLoading, setPrivateAccessLoading] = useState(false)
  const [privateAccessResolved, setPrivateAccessResolved] = useState(false)
  const [privateAccessError, setPrivateAccessError] = useState('')
  const [privateSlots, setPrivateSlots] = useState([])
  const [privateSlotsLoading, setPrivateSlotsLoading] = useState(false)
  const [privateSlotsError, setPrivateSlotsError] = useState('')
  const [privateSlotsRefreshKey, setPrivateSlotsRefreshKey] = useState(0)
  const [privateSlotViewMode, setPrivateSlotViewMode] = useState('all')
  const [privateReservations, setPrivateReservations] = useState([])
  const [privateReservationsLoading, setPrivateReservationsLoading] = useState(false)
  const [privateReservationsResolved, setPrivateReservationsResolved] = useState(false)
  const [privateReservationsError, setPrivateReservationsError] = useState('')
  const hasGroupLessonRowsRef = useRef(false)
  const [studentPrivateLessons, setStudentPrivateLessons] = useState([])
  const [studentPrivateLessonsLoading, setStudentPrivateLessonsLoading] = useState(false)
  const [studentPrivateLessonsResolved, setStudentPrivateLessonsResolved] = useState(false)
  const [studentPrivateLessonsError, setStudentPrivateLessonsError] = useState('')
  const [busyPrivateReservationId, setBusyPrivateReservationId] = useState('')
  const [dailyMaterials, setDailyMaterials] = useState([])
  const [dailyMaterialsLoading, setDailyMaterialsLoading] = useState(false)
  const [dailyMaterialsError, setDailyMaterialsError] = useState('')
  const [studentPackages, setStudentPackages] = useState([])
  const [studentPackagesLoading, setStudentPackagesLoading] = useState(false)
  const [studentPackagesResolved, setStudentPackagesResolved] = useState(false)
  const [studentPackagesError, setStudentPackagesError] = useState('')
  const [linkedPrivateStudent, setLinkedPrivateStudent] = useState(null)
  const [linkedPrivateStudentLoading, setLinkedPrivateStudentLoading] = useState(false)
  const groupAccessRefreshTimerRef = useRef(null)

  const scopedStudentId = String(studentId || currentMembership?.studentId || '').trim()
  const hasOperationalAcademy = isValidOperationalAcademyId(currentAcademyId)
  const todayDailyMaterialId = hasOperationalAcademy
    ? `${currentAcademyId}__${getTodayStorageDateString()}`
    : ''
  const canUsePrivateBooking = PRIVATE_SLOT_BOOKING_ENABLED && privateSlotBookingPilotEnabled

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setAllowedGroupClassIds([])
      setAllowedGroupCourseTypes([])
      setAccessLoading(false)
      setAccessResolved(false)
      setAccessError('')
      return
    }

    setAccessLoading(true)
    setAccessResolved(false)
    setAccessError('')

    const summaryRef = doc(
      db,
      'studentGroupAccessSummary',
      buildStudentGroupAccessSummaryId({
        academyId: currentAcademyId,
        studentId: scopedStudentId,
      })
    )

    const unsubscribe = onSnapshot(
      summaryRef,
      (snapshot) => {
        const summaryData = snapshot.exists() ? snapshot.data() : null
        const nextIds = new Set()
        const rawIds = Array.isArray(summaryData?.groupClassIds)
          ? summaryData.groupClassIds
          : []
        rawIds.forEach((value) => {
          const groupClassId = String(value || '').trim()
          if (!groupClassId) return
          nextIds.add(groupClassId)
        })
        const nextCourseTypes = new Set()
        const rawCourseTypes = Array.isArray(summaryData?.groupCourseTypes)
          ? summaryData.groupCourseTypes
          : []
        rawCourseTypes.forEach((value) => {
          const groupCourseType = normalizeGroupCourseType(value)
          if (!groupCourseType) return
          nextCourseTypes.add(groupCourseType)
        })
        setAllowedGroupClassIds(Array.from(nextIds.values()))
        setAllowedGroupCourseTypes(Array.from(nextCourseTypes.values()))
        setGroupLessonsRefreshKey((previous) => previous + 1)
        if (groupAccessRefreshTimerRef.current) {
          clearTimeout(groupAccessRefreshTimerRef.current)
        }
        groupAccessRefreshTimerRef.current = window.setTimeout(() => {
          setGroupLessonsRefreshKey((previous) => previous + 1)
          groupAccessRefreshTimerRef.current = null
        }, 750)
        setAccessLoading(false)
        setAccessResolved(true)
      },
      (error) => {
        console.error('studentGroupAccessSummary 불러오기 실패:', error)
        setAllowedGroupClassIds([])
        setAllowedGroupCourseTypes([])
        setAccessLoading(false)
        setAccessResolved(true)
        setAccessError('예약 가능한 반 권한을 확인할 수 없습니다.')
      }
    )

    return () => {
      if (groupAccessRefreshTimerRef.current) {
        clearTimeout(groupAccessRefreshTimerRef.current)
        groupAccessRefreshTimerRef.current = null
      }
      unsubscribe()
    }
  }, [currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student') {
      setDailyMaterials([])
      setDailyMaterialsLoading(false)
      setDailyMaterialsError('')
      return
    }

    setDailyMaterialsLoading(true)
    setDailyMaterialsError('')
    const today = getTodayStorageDateString()
    const q = query(
      collection(db, 'dailyMaterials'),
      where('academyId', '==', currentAcademyId),
      where('date', '==', today),
      where('status', '==', 'published'),
      where('visibility', '==', 'allStudents')
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        setDailyMaterials(rows)
        setDailyMaterialsLoading(false)
      },
      (error) => {
        console.error('오늘의 영상 불러오기 실패:', error)
        setDailyMaterials([])
        setDailyMaterialsLoading(false)
        setDailyMaterialsError('오늘의 영상을 불러오지 못했습니다.')
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, hasOperationalAcademy, role])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setAllowedPrivateTeacherKeys([])
      setAllowedPrivateSlotIds([])
      setPrivateSlotBookingPilotEnabled(false)
      setPrivateAccessLoading(false)
      setPrivateAccessResolved(false)
      setPrivateAccessError('')
      return
    }

    setPrivateAccessLoading(true)
    setPrivateAccessResolved(false)
    setPrivateAccessError('')

    const summaryRef = doc(
      db,
      'studentPrivateAccessSummary',
      buildStudentPrivateAccessSummaryId({
        academyId: currentAcademyId,
        studentId: scopedStudentId,
      })
    )
    let cancelled = false

    async function loadActivePrivatePackageTeacherKeys() {
      const packageSnapshot = await getDocs(
        query(
          collection(db, 'studentPackages'),
          where('academyId', '==', currentAcademyId),
          where('studentId', '==', scopedStudentId)
        )
      )
      const packageTeacherKeys = []
      packageSnapshot.docs.forEach((docSnap) => {
        const pkg = docSnap.data() || {}
        if (!isActivePrivatePackage(pkg)) return
        packageTeacherKeys.push(getPrivatePackageTeacherKey(pkg))
      })
      return packageTeacherKeys
    }

    const unsubscribe = onSnapshot(
      summaryRef,
      async (snapshot) => {
        const summaryData = snapshot.exists() ? snapshot.data() : null
        const teacherKeys = Array.isArray(summaryData?.teacherKeys)
          ? summaryData.teacherKeys
          : []
        const activePackageIds = Array.isArray(summaryData?.activePackageIds)
          ? summaryData.activePackageIds
          : []
        const summaryAllowedSlotIds = [
          ...(Array.isArray(summaryData?.allowedSlotIds) ? summaryData.allowedSlotIds : []),
          ...(Array.isArray(summaryData?.allowedPrivateLessonSlotIds)
            ? summaryData.allowedPrivateLessonSlotIds
            : []),
        ]
        const hasActivePrivateAccess = activePackageIds.some((value) =>
          String(value || '').trim()
        )
        let packageTeacherKeys = []
        try {
          packageTeacherKeys = await loadActivePrivatePackageTeacherKeys()
        } catch (error) {
          console.error('student private packages 불러오기 실패:', error)
        }
        if (cancelled) return
        setPrivateSlotBookingPilotEnabled(summaryData?.privateSlotBookingPilotEnabled === true)
        const nextKeys = new Set()
        if (hasActivePrivateAccess || packageTeacherKeys.length > 0) {
          ;[...teacherKeys, ...packageTeacherKeys].forEach((value) => {
            const teacherKey = String(value || '').trim()
            if (!teacherKey) return
            nextKeys.add(teacherKey)
          })
        }
        const nextSlotIds = new Set()
        summaryAllowedSlotIds.forEach((value) => {
          const slotId = String(value || '').trim()
          if (!slotId) return
          nextSlotIds.add(slotId)
        })
        setAllowedPrivateTeacherKeys(Array.from(nextKeys.values()))
        setAllowedPrivateSlotIds(Array.from(nextSlotIds.values()))
        setPrivateAccessLoading(false)
        setPrivateAccessResolved(true)
      },
      (error) => {
        console.error('studentPrivateAccessSummary 불러오기 실패:', error)
        setAllowedPrivateTeacherKeys([])
        setAllowedPrivateSlotIds([])
        setPrivateSlotBookingPilotEnabled(false)
        setPrivateAccessLoading(false)
        setPrivateAccessResolved(true)
        setPrivateAccessError('예약 가능한 1:1 선생님 권한을 확인할 수 없습니다.')
      }
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setStudentPackages([])
      setStudentPackagesLoading(false)
      setStudentPackagesResolved(false)
      setStudentPackagesError('')
      return
    }

    setStudentPackagesLoading(true)
    setStudentPackagesResolved(false)
    setStudentPackagesError('')

    const packagesQuery = query(
      collection(db, 'studentPackages'),
      where('academyId', '==', currentAcademyId),
      where('studentId', '==', scopedStudentId)
    )

    const unsubscribe = onSnapshot(
      packagesQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
        setStudentPackages(rows)
        setStudentPackagesLoading(false)
        setStudentPackagesResolved(true)
      },
      (error) => {
        console.error('studentPackages 불러오기 실패:', error)
        setStudentPackages([])
        setStudentPackagesLoading(false)
        setStudentPackagesResolved(true)
        setStudentPackagesError('내 수강권 정보를 불러오지 못했습니다.')
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setLinkedPrivateStudent(null)
      setLinkedPrivateStudentLoading(false)
      return
    }

    let cancelled = false
    setLinkedPrivateStudentLoading(true)

    getDoc(doc(db, 'privateStudents', scopedStudentId))
      .then((snapshot) => {
        if (cancelled) return
        setLinkedPrivateStudent(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null)
        setLinkedPrivateStudentLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('privateStudents 불러오기 실패:', error)
        setLinkedPrivateStudent(null)
        setLinkedPrivateStudentLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      hasGroupLessonRowsRef.current = false
      setLessons([])
      setLessonsLoading(false)
      setLessonsError('')
      return
    }
    if (allowedGroupClassIds.length === 0 && allowedGroupCourseTypes.length === 0) {
      hasGroupLessonRowsRef.current = false
      setLessons([])
      setLessonsLoading(false)
      setLessonsError('')
      return
    }

    setLessonsLoading(!hasGroupLessonRowsRef.current)
    setLessonsError('')

    let cancelled = false

    async function loadGroupLessonAvailability() {
      const listGroupLessonAvailability = httpsCallable(
        firebaseFunctions,
        'listGroupLessonAvailability'
      )
      const result = await listGroupLessonAvailability({
        academyId: currentAcademyId,
      })
      return Array.isArray(result.data?.lessons) ? result.data.lessons : []
    }

    loadGroupLessonAvailability()
      .then((rows) => {
        if (cancelled) return
        setLessons((previous) => {
          const byId = new Map(rows.map((lesson) => [String(lesson.id || '').trim(), lesson]))
          const activeReservationLessonIds = new Set(
            reservations
              .filter((reservation) => reservation.status === 'active')
              .map((reservation) => String(reservation.lessonId || '').trim())
              .filter(Boolean)
          )
          locallyReservedGroupLessonIds.forEach((lessonId) => {
            if (lessonId) activeReservationLessonIds.add(String(lessonId))
          })
          previous.forEach((lesson) => {
            const lessonId = String(lesson.id || '').trim()
            if (!lessonId || byId.has(lessonId)) return
            if (activeReservationLessonIds.has(lessonId)) {
              byId.set(lessonId, lesson)
            }
          })
          const nextLessons = Array.from(byId.values())
          hasGroupLessonRowsRef.current = nextLessons.length > 0
          return nextLessons
        })
        setLessonsLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('student groupLessons 불러오기 실패:', error)
        setLessonsError('예약 가능한 수업을 불러오지 못했습니다.')
        setLessons([])
        setLessonsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    allowedGroupClassIds,
    allowedGroupCourseTypes,
    currentAcademyId,
    groupLessonsRefreshKey,
    hasOperationalAcademy,
    locallyReservedGroupLessonIds,
    reservations,
    role,
    scopedStudentId,
  ])

  function updateGroupLessonBookedCount(lessonId, delta) {
    const scopedLessonId = String(lessonId || '').trim()
    if (!scopedLessonId) return
    setLessons((previous) =>
      previous.map((lesson) => {
        if (String(lesson.id || '').trim() !== scopedLessonId) return lesson
        const rawBookedCount = Number(lesson.bookedCount ?? 0)
        const bookedCount = Number.isFinite(rawBookedCount) ? rawBookedCount : 0
        return {
          ...lesson,
          bookedCount: Math.max(0, bookedCount + delta),
          remainingSeats: Number.isFinite(Number(lesson.remainingSeats))
            ? Math.max(0, Number(lesson.remainingSeats) - delta)
            : lesson.remainingSeats,
        }
      })
    )
  }

  async function loadDirectOpenPrivateSlotsFallback() {
    const byId = new Map()
    const teacherChunks = chunkValues(allowedPrivateTeacherKeys, GROUP_CLASS_QUERY_CHUNK_SIZE)
    const querySpecs = [
      ...teacherChunks.map((values) => ({ type: 'teacherKey', values })),
      ...teacherChunks.map((values) => ({ type: 'teacherUid', values })),
      ...teacherChunks.map((values) => ({ type: 'teacherUID', values })),
      ...teacherChunks.map((values) => ({ type: 'teacherId', values })),
      ...teacherChunks.map((values) => ({ type: 'teacher', values })),
      ...teacherChunks.map((values) => ({ type: 'teacherName', values })),
    ]

    const addOpenRow = (id, data) => {
      const {
        fixedStudentId: _fixedStudentId,
        fixedStudentName: _fixedStudentName,
        releasedByStudentId: _releasedByStudentId,
        ...safeData
      } = data || {}
      const row = {
        id,
        ...safeData,
        isReserved: false,
        isBookable: false,
        bookingStatus: 'blocked',
        bookingStatusLabel: '수업 있음',
        packageRemainingCount: 0,
        makeupAvailableCount: 0,
      }
      if (
        String(row.academyId || '').trim() !== currentAcademyId ||
        String(row.status || '').trim() !== 'open'
      ) {
        return
      }
      if (
        !allowedPrivateSlotIds.includes(id) &&
        !slotMatchesPrivateTeacherAccess(row, allowedPrivateTeacherKeys)
      ) {
        return
      }
      byId.set(id, row)
    }

    const queryResults = await Promise.allSettled(
      querySpecs.map((source) =>
        getDocs(
          query(
            collection(db, 'privateLessonSlots'),
            where('academyId', '==', currentAcademyId),
            where('status', '==', 'open'),
            where(source.type, 'in', source.values)
          )
        )
      )
    )
    queryResults.forEach((result) => {
      if (result.status !== 'fulfilled') return
      result.value.docs.forEach((docItem) => addOpenRow(docItem.id, docItem.data()))
    })

    const directResults = await Promise.allSettled(
      allowedPrivateSlotIds.map((slotId) => getDoc(doc(db, 'privateLessonSlots', slotId)))
    )
    directResults.forEach((result) => {
      if (result.status !== 'fulfilled') return
      const snapshot = result.value
      if (snapshot.exists()) addOpenRow(snapshot.id, snapshot.data())
    })

    return Array.from(byId.values())
  }

  async function loadPrivateSlotAvailability() {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setPrivateSlots([])
      setPrivateSlotsLoading(false)
      setPrivateSlotsError('')
      return []
    }
    if (!privateAccessResolved || privateAccessLoading) {
      setPrivateSlots([])
      setPrivateSlotsLoading(true)
      setPrivateSlotsError('')
      return []
    }

    setPrivateSlotsLoading(true)
    setPrivateSlotsError('')
    try {
      const listPrivateLessonSlotAvailability = httpsCallable(
        firebaseFunctions,
        'listPrivateLessonSlotAvailability'
      )
      const response = await listPrivateLessonSlotAvailability({
        academyId: currentAcademyId,
        ...PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE,
      })
      const serverRows = Array.isArray(response?.data?.slots) ? response.data.slots : []
      const rows = canUsePrivateBooking
        ? serverRows
        : serverRows.filter((row) => row?.isBusy !== true && row?.bookingStatus !== 'busy')
      if (rows.length === 0) {
        const fallbackRows = await loadDirectOpenPrivateSlotsFallback()
        if (fallbackRows.length > 0) {
          setPrivateSlots(fallbackRows)
          return fallbackRows
        }
      }
      setPrivateSlots(rows)
      return rows
    } catch (error) {
      console.error('student privateLessonSlots availability 불러오기 실패:', error)
      const fallbackRows = await loadDirectOpenPrivateSlotsFallback().catch(() => null)
      if (fallbackRows === null) {
        setPrivateSlots([])
        setPrivateSlotsError('예약 가능한 1:1 수업 시간을 불러오지 못했습니다.')
        return []
      }
      setPrivateSlots(fallbackRows)
      setPrivateSlotsError('')
      return fallbackRows
    } finally {
      setPrivateSlotsLoading(false)
    }
  }

  async function loadPrivateReservations() {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setPrivateReservations([])
      setPrivateReservationsLoading(false)
      setPrivateReservationsResolved(false)
      setPrivateReservationsError('')
      return []
    }

    setPrivateReservationsLoading(true)
    setPrivateReservationsError('')
    try {
      const reservationsQuery = query(
        collection(db, 'privateLessonReservations'),
        where('academyId', '==', currentAcademyId),
        where('studentId', '==', scopedStudentId),
        where('status', 'in', ['active', 'cancelled'])
      )
      const snapshot = await getDocs(reservationsQuery)
      const rows = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }))
      setPrivateReservations(rows)
      setPrivateReservationsResolved(true)
      return rows
    } catch (error) {
      console.error('student private reservation 불러오기 실패:', error)
      setPrivateReservations([])
      setPrivateReservationsResolved(true)
      setPrivateReservationsError('내 1:1 수업 예약을 불러오지 못했습니다.')
      return []
    } finally {
      setPrivateReservationsLoading(false)
    }
  }

  async function mergeOpenPrivateSlotById(slotId, reservation = null) {
    const scopedSlotId = String(slotId || '').trim()
    if (!scopedSlotId || !hasOperationalAcademy || role !== 'student') return null

    try {
      const snapshot = await getDoc(doc(db, 'privateLessonSlots', scopedSlotId))
      if (!snapshot.exists()) return null
      const {
        fixedStudentId: _fixedStudentId,
        fixedStudentName: _fixedStudentName,
        releasedByStudentId: _releasedByStudentId,
        ...safeData
      } = snapshot.data() || {}
      const row = {
        id: snapshot.id,
        ...safeData,
        isReserved: false,
        isBookable: false,
        bookingStatus: 'blocked',
        bookingStatusLabel: '수업 있음',
        packageRemainingCount: 0,
        makeupAvailableCount: 0,
      }
      if (
        String(row.academyId || '').trim() !== currentAcademyId ||
        String(row.status || '').trim() !== 'open'
      ) {
        return null
      }
      const reservationTeacher = String(reservation?.teacher || reservation?.teacherName || '').trim()
      const hasTeacherAccess =
        slotMatchesPrivateTeacherAccess(row, allowedPrivateTeacherKeys) ||
        (reservationTeacher &&
          (normalizePrivateAccessKey(row.teacher) === normalizePrivateAccessKey(reservationTeacher) ||
            normalizePrivateAccessKey(row.teacherName) === normalizePrivateAccessKey(reservationTeacher)))
      if (!allowedPrivateSlotIds.includes(scopedSlotId) && !hasTeacherAccess) return null

      setPrivateSlots((prev) => {
        const byId = new Map(prev.map((slot) => [slot.id, slot]))
        byId.set(row.id, row)
        return Array.from(byId.values())
      })
      return row
    } catch (error) {
      console.error('student privateLessonSlots direct refresh 실패:', error)
      return null
    }
  }

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setPrivateSlots([])
      setPrivateSlotsLoading(false)
      setPrivateSlotsError('')
      return
    }
    if (!privateAccessResolved || privateAccessLoading) {
      setPrivateSlots([])
      setPrivateSlotsLoading(true)
      setPrivateSlotsError('')
      return
    }

    setPrivateSlotsLoading(true)
    setPrivateSlotsError('')

    let cancelled = false
    async function loadDirectOpenPrivateSlotsFallbackForEffect() {
      const byId = new Map()
      const teacherChunks = chunkValues(allowedPrivateTeacherKeys, GROUP_CLASS_QUERY_CHUNK_SIZE)
      const querySpecs = [
        ...teacherChunks.map((values) => ({ type: 'teacherKey', values })),
        ...teacherChunks.map((values) => ({ type: 'teacherUid', values })),
        ...teacherChunks.map((values) => ({ type: 'teacherUID', values })),
        ...teacherChunks.map((values) => ({ type: 'teacherId', values })),
        ...teacherChunks.map((values) => ({ type: 'teacher', values })),
        ...teacherChunks.map((values) => ({ type: 'teacherName', values })),
      ]

      const addOpenRow = (id, data) => {
        const {
          fixedStudentId: _fixedStudentId,
          fixedStudentName: _fixedStudentName,
          releasedByStudentId: _releasedByStudentId,
          ...safeData
        } = data || {}
        const row = {
          id,
          ...safeData,
          isReserved: false,
          isBookable: false,
          bookingStatus: 'blocked',
          bookingStatusLabel: '수업 있음',
          packageRemainingCount: 0,
          makeupAvailableCount: 0,
        }
        if (
          String(row.academyId || '').trim() !== currentAcademyId ||
          String(row.status || '').trim() !== 'open'
        ) {
          return
        }
        if (
          !allowedPrivateSlotIds.includes(id) &&
          !slotMatchesPrivateTeacherAccess(row, allowedPrivateTeacherKeys)
        ) {
          return
        }
        byId.set(id, row)
      }

      const queryResults = await Promise.allSettled(
        querySpecs.map((source) =>
          getDocs(
            query(
              collection(db, 'privateLessonSlots'),
              where('academyId', '==', currentAcademyId),
              where('status', '==', 'open'),
              where(source.type, 'in', source.values)
            )
          )
        )
      )
      queryResults.forEach((result) => {
        if (result.status !== 'fulfilled') return
        result.value.docs.forEach((docItem) => addOpenRow(docItem.id, docItem.data()))
      })

      const directResults = await Promise.allSettled(
        allowedPrivateSlotIds.map((slotId) => getDoc(doc(db, 'privateLessonSlots', slotId)))
      )
      directResults.forEach((result) => {
        if (result.status !== 'fulfilled') return
        const snapshot = result.value
        if (snapshot.exists()) addOpenRow(snapshot.id, snapshot.data())
      })

      return Array.from(byId.values())
    }

    async function loadPrivateSlotAvailabilityForEffect() {
      let fallbackResolved = false
      let fallbackFailed = false
      let latestFallbackRows = null
      const fallbackPromise = loadDirectOpenPrivateSlotsFallbackForEffect()
        .then((fallbackRows) => {
          fallbackResolved = true
          latestFallbackRows = fallbackRows
          return fallbackRows
        })
        .catch((fallbackError) => {
          fallbackResolved = true
          fallbackFailed = true
          console.error('student privateLessonSlots fallback 불러오기 실패:', fallbackError)
          return null
        })

      try {
        const listPrivateLessonSlotAvailability = httpsCallable(
          firebaseFunctions,
          'listPrivateLessonSlotAvailability'
        )
        const response = await listPrivateLessonSlotAvailability({
          academyId: currentAcademyId,
          ...PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE,
        })
        if (cancelled) return
        const serverRows = Array.isArray(response?.data?.slots) ? response.data.slots : []
        const rows = canUsePrivateBooking
          ? serverRows
          : serverRows.filter((row) => row?.isBusy !== true && row?.bookingStatus !== 'busy')
        if (rows.length === 0 && Array.isArray(latestFallbackRows) && latestFallbackRows.length > 0) {
          setPrivateSlots(latestFallbackRows)
        } else {
          setPrivateSlots(rows)
        }
      } catch (error) {
        if (cancelled) return
        console.error('student privateLessonSlots availability 불러오기 실패:', error)
        const fallbackRows = fallbackResolved ? latestFallbackRows : await fallbackPromise
        if (cancelled) return
        if (fallbackFailed || fallbackRows === null) {
          setPrivateSlots([])
          setPrivateSlotsError('예약 가능한 1:1 수업 시간을 불러오지 못했습니다.')
        } else {
          setPrivateSlotsError('')
        }
      } finally {
        if (!cancelled) setPrivateSlotsLoading(false)
      }
    }

    loadPrivateSlotAvailabilityForEffect()

    return () => {
      cancelled = true
    }
  }, [
    allowedPrivateSlotIds,
    allowedPrivateTeacherKeys,
    currentAcademyId,
    canUsePrivateBooking,
    hasOperationalAcademy,
    privateAccessLoading,
    privateAccessResolved,
    privateSlotBookingPilotEnabled,
    privateSlotsRefreshKey,
    role,
    scopedStudentId,
  ])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setReservations([])
      setReservationsLoading(false)
      setReservationsResolved(false)
      setReservationsError('')
      return
    }

    setReservationsLoading(true)
    setReservationsResolved(false)
    setReservationsError('')

    const reservationsQuery = query(
      collection(db, 'groupLessonReservations'),
      where('academyId', '==', currentAcademyId),
      where('studentId', '==', scopedStudentId),
      where('status', 'in', ['active', 'cancelled'])
    )

    const unsubscribe = onSnapshot(
      reservationsQuery,
      (snapshot) => {
        setReservations(
          snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
        )
        setReservationsLoading(false)
        setReservationsResolved(true)
      },
      (error) => {
        console.error('student reservation 불러오기 실패:', error)
        setReservations([])
        setReservationsLoading(false)
        setReservationsResolved(true)
        setReservationsError('내 예약을 불러오지 못했습니다.')
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setPrivateReservations([])
      setPrivateReservationsLoading(false)
      setPrivateReservationsResolved(false)
      setPrivateReservationsError('')
      return
    }

    setPrivateReservationsLoading(true)
    setPrivateReservationsResolved(false)
    setPrivateReservationsError('')

    const reservationsQuery = query(
      collection(db, 'privateLessonReservations'),
      where('academyId', '==', currentAcademyId),
      where('studentId', '==', scopedStudentId),
      where('status', 'in', ['active', 'cancelled'])
    )

    const unsubscribe = onSnapshot(
      reservationsQuery,
      (snapshot) => {
        setPrivateReservations(
          snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
        )
        setPrivateReservationsLoading(false)
        setPrivateReservationsResolved(true)
      },
      (error) => {
        console.error('student private reservation 불러오기 실패:', error)
        setPrivateReservations([])
        setPrivateReservationsLoading(false)
        setPrivateReservationsResolved(true)
        setPrivateReservationsError('내 1:1 수업 예약을 불러오지 못했습니다.')
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setStudentPrivateLessons([])
      setStudentPrivateLessonsLoading(false)
      setStudentPrivateLessonsResolved(false)
      setStudentPrivateLessonsError('')
      return
    }

    setStudentPrivateLessonsLoading(true)
    setStudentPrivateLessonsResolved(false)
    setStudentPrivateLessonsError('')

    const querySpecs = [
      { field: 'studentId', label: 'studentId' },
      { field: 'studentID', label: 'studentID' },
    ]
    const sourceMaps = new Map()
    const resolvedSources = new Set()
    const unsubs = []

    const mergeRows = () => {
      const byId = new Map()
      for (let index = 0; index < querySpecs.length; index += 1) {
        const sourceMap = sourceMaps.get(index)
        if (!sourceMap) continue
        for (const row of sourceMap.values()) {
          const rowAcademyId = String(row.academyId || '').trim()
          const rowStudentId = String(row.studentId || '').trim()
          const rowLegacyStudentId = String(row.studentID || '').trim()
          const isCurrentStudentLesson =
            rowStudentId === scopedStudentId || rowLegacyStudentId === scopedStudentId
          if (rowAcademyId !== currentAcademyId || !isCurrentStudentLesson) continue
          byId.set(row.id, row)
        }
      }
      setStudentPrivateLessons(Array.from(byId.values()))
      if (resolvedSources.size === querySpecs.length) {
        setStudentPrivateLessonsLoading(false)
        setStudentPrivateLessonsResolved(true)
      }
    }

    querySpecs.forEach((spec, index) => {
      const unsubscribe = onSnapshot(
        query(
          collection(db, 'lessons'),
          where('academyId', '==', currentAcademyId),
          where(spec.field, '==', scopedStudentId)
        ),
        (snapshot) => {
          const rows = new Map()
          snapshot.docs.forEach((docItem) => {
            rows.set(docItem.id, {
              id: docItem.id,
              ...docItem.data(),
            })
          })
          sourceMaps.set(index, rows)
          resolvedSources.add(index)
          mergeRows()
        },
        (error) => {
          console.error(`student lessons ${spec.label} 불러오기 실패:`, error)
          sourceMaps.set(index, new Map())
          resolvedSources.add(index)
          setStudentPrivateLessonsError('내 예정 수업을 불러오지 못했습니다.')
          mergeRows()
        }
      )

      unsubs.push(unsubscribe)
    })

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe())
    }
  }, [currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  const lessonsById = useMemo(() => {
    const byId = new Map()
    lessons.forEach((lesson) => {
      byId.set(lesson.id, lesson)
    })
    return byId
  }, [lessons])

  const reservationByLessonId = useMemo(() => {
    const byLessonId = new Map()
    reservations.forEach((reservation) => {
      const lessonId = String(reservation.lessonId || '').trim()
      if (!lessonId) return
      byLessonId.set(lessonId, reservation)
    })
    return byLessonId
  }, [reservations])

  const privateSlotsById = useMemo(() => {
    const byId = new Map()
    privateSlots.forEach((slot) => {
      byId.set(slot.id, slot)
    })
    return byId
  }, [privateSlots])

  const privateReservationBySlotId = useMemo(() => {
    const bySlotId = new Map()
    privateReservations.forEach((reservation) => {
      const slotId = String(reservation.slotId || '').trim()
      if (!slotId) return
      bySlotId.set(slotId, reservation)
    })
    return bySlotId
  }, [privateReservations])

  const activePrivateReservationSlotIds = useMemo(() => {
    const slotIds = new Set()
    privateReservations.forEach((reservation) => {
      if (reservation.status !== 'active') return
      const slotId = String(reservation.slotId || '').trim()
      if (slotId) slotIds.add(slotId)
    })
    return slotIds
  }, [privateReservations])

  const sortedLessons = useMemo(() => {
    return [...lessons].sort((a, b) => {
      const aKey = `${a.date || ''} ${a.time || ''} ${a.subject || ''}`
      const bKey = `${b.date || ''} ${b.time || ''} ${b.subject || ''}`
      return aKey.localeCompare(bKey, 'ko')
    })
  }, [lessons])

  const sortedReservations = useMemo(() => {
    return [...reservations].sort((a, b) => {
      const lessonA = lessonsById.get(a.lessonId) || null
      const lessonB = lessonsById.get(b.lessonId) || null
      const aKey = `${lessonA?.date || ''} ${lessonA?.time || ''} ${a.lessonId || ''}`
      const bKey = `${lessonB?.date || ''} ${lessonB?.time || ''} ${b.lessonId || ''}`
      return aKey.localeCompare(bKey, 'ko')
    })
  }, [lessonsById, reservations])

  const sortedPrivateSlots = useMemo(() => {
    return privateSlots
      .filter((slot) => !activePrivateReservationSlotIds.has(String(slot.id || '').trim()))
      .filter((slot) => {
        if (privateSlotViewMode !== 'available') return true
        const bookingStatus = getStudentPrivateSlotStatus(slot, canUsePrivateBooking)
        return (
          bookingStatus === 'available' &&
          slot.isBookable === true &&
          slot.isBusy !== true &&
          String(slot.status || '').trim() === 'open'
        )
      })
      .sort((a, b) => {
        const aKey = `${a.date || ''} ${a.time || ''} ${a.teacher || ''}`
        const bKey = `${b.date || ''} ${b.time || ''} ${b.teacher || ''}`
        return aKey.localeCompare(bKey, 'ko')
      })
  }, [activePrivateReservationSlotIds, canUsePrivateBooking, privateSlotViewMode, privateSlots])

  const privateCalendarWeeks = useMemo(() => {
    const weekStarts = []
    sortedPrivateSlots.forEach((slot) => {
      const weekStart = getMondayForKstDate(slot.date)
      if (weekStart && !weekStarts.includes(weekStart)) weekStarts.push(weekStart)
    })
    weekStarts.sort((a, b) => a.localeCompare(b))
    return weekStarts.map((weekStart) => {
      const days = buildMondaySaturdayWeekDays(weekStart).map((date) => ({
        date,
        slots: sortedPrivateSlots.filter((slot) => String(slot.date || '').trim() === date),
      }))
      return {
        weekStart,
        weekEnd: days[days.length - 1]?.date || weekStart,
        days,
      }
    })
  }, [sortedPrivateSlots])

  const sortedPrivateReservations = useMemo(() => {
    return privateReservations
      .filter((reservation) => reservation.status === 'active')
      .sort((a, b) => {
        const aKey = `${a.date || ''} ${a.time || ''} ${a.slotId || ''}`
        const bKey = `${b.date || ''} ${b.time || ''} ${b.slotId || ''}`
        return aKey.localeCompare(bKey, 'ko')
      })
  }, [privateReservations])

  const todayYmd = getTodayStorageDateString()

  const sortedUpcomingPrivateLessons = useMemo(() => {
    return studentPrivateLessons
      .map((lesson) => ({
        ...lesson,
        scheduleDate: getLessonStorageDateString(lesson),
        scheduleTime: getLessonDisplayTime(lesson),
      }))
      .filter((lesson) => {
        return (
          /^\d{4}-\d{2}-\d{2}$/.test(lesson.scheduleDate) &&
          lesson.scheduleDate >= todayYmd
        )
      })
      .sort((a, b) => {
        const aKey = `${a.scheduleDate} ${a.scheduleTime || '00:00'} ${getLessonSubjectLabel(a)} ${a.id}`
        const bKey = `${b.scheduleDate} ${b.scheduleTime || '00:00'} ${getLessonSubjectLabel(b)} ${b.id}`
        return aKey.localeCompare(bKey, 'ko')
      })
  }, [studentPrivateLessons, todayYmd])

  const upcomingPrivateScheduleItems = useMemo(() => {
    const lessonItems = sortedUpcomingPrivateLessons.map((lesson) => ({
      id: `lesson-${lesson.id}`,
      source: 'lesson',
      sourceId: lesson.id,
      date: lesson.scheduleDate,
      time: lesson.scheduleTime,
      teacherLabel: getLessonTeacherLabel(lesson),
      title: getLessonSubjectLabel(lesson),
      sessionLabel: formatLessonSessionNumber(lesson),
      statusLabel: '수업 예정',
    }))

    const reservationItems = privateReservations
      .filter((reservation) => {
        if (reservation.status !== 'active') return false
        const date = String(reservation.date || '').trim()
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayYmd
      })
      .map((reservation) => ({
        id: `private-reservation-${reservation.id}`,
        source: 'privateReservation',
        sourceId: reservation.id,
        date: String(reservation.date || '').trim(),
        time: String(reservation.time || '').trim(),
        teacherLabel: String(reservation.teacher || '').trim() || '-',
        title: String(reservation.subject || '').trim() || '1:1 수업',
        sessionLabel: '',
        statusLabel: '예약 완료',
      }))

    return [...lessonItems, ...reservationItems].sort((a, b) => {
      const aKey = `${a.date || ''} ${a.time || '00:00'} ${a.title || ''} ${a.sourceId || ''}`
      const bKey = `${b.date || ''} ${b.time || '00:00'} ${b.title || ''} ${b.sourceId || ''}`
      return aKey.localeCompare(bKey, 'ko')
    })
  }, [privateReservations, sortedUpcomingPrivateLessons, todayYmd])

  const lessonHistoryItems = useMemo(() => {
    const privateLessonItems = studentPrivateLessons.map((lesson) => {
      const date = getLessonStorageDateString(lesson)
      const time = getLessonDisplayTime(lesson)
      const startsAtMs = getDateTimeMs(date, time)
      return {
        id: `private-lesson-${lesson.id}`,
        typeLabel: '1:1 수업',
        title: getLessonSubjectLabel(lesson),
        date,
        time,
        status: 'active',
        startsAtMs,
        fallbackId: lesson.id,
      }
    })

    const privateItems = privateReservations.map((reservation) => {
      const date = String(reservation.date || '').trim()
      const time = String(reservation.time || '').trim()
      const startsAtMs = getDateTimeMs(date, time)
      return {
        id: `private-${reservation.id}`,
        typeLabel: '1:1 수업',
        title: String(reservation.teacher || '').trim() || '1:1 수업',
        date,
        time,
        status: reservation.status,
        startsAtMs,
        fallbackId: reservation.slotId,
      }
    })

    const groupItems = reservations.map((reservation) => {
      const lesson = lessonsById.get(reservation.lessonId) || null
      const date = String(reservation.date || lesson?.date || '').trim()
      const time = String(reservation.time || lesson?.time || '').trim()
      const startsAtMs = getDateTimeMs(date, time)
      return {
        id: `group-${reservation.id}`,
        typeLabel: '단체반 수업',
        title: String(reservation.subject || lesson?.subject || '').trim() || '단체반 수업',
        date,
        time,
        status: reservation.status,
        cancellationType: reservation.cancellationType || lesson?.cancellationType || '',
        noDeduction: reservation.noDeduction === true || lesson?.noDeduction === true,
        startsAtMs,
        fallbackId: reservation.lessonId,
      }
    })

    return [...privateLessonItems, ...privateItems, ...groupItems].sort((a, b) => {
      const aTime = a.startsAtMs ?? Number.MAX_SAFE_INTEGER
      const bTime = b.startsAtMs ?? Number.MAX_SAFE_INTEGER
      if (aTime !== bTime) return bTime - aTime
      return `${a.typeLabel} ${a.title} ${a.fallbackId || ''}`.localeCompare(
        `${b.typeLabel} ${b.title} ${b.fallbackId || ''}`,
        'ko'
      )
    })
  }, [lessonsById, privateReservations, reservations, studentPrivateLessons])

  const lessonHistoryLoading =
    !reservationsResolved ||
    reservationsLoading ||
    !privateReservationsResolved ||
    privateReservationsLoading ||
    !studentPrivateLessonsResolved ||
    studentPrivateLessonsLoading

  const todayScheduleItems = useMemo(() => {
    const lessonItems = sortedUpcomingPrivateLessons
      .filter((lesson) => lesson.scheduleDate === todayYmd)
      .map((lesson) => ({
        id: `private-lesson-${lesson.id}`,
        time: lesson.scheduleTime || '-',
        typeLabel: '1:1 수업',
        teacherLabel: getLessonTeacherLabel(lesson),
        title: getLessonSubjectLabel(lesson),
        sessionLabel: formatLessonSessionNumber(lesson),
        statusLabel: '수업 예정',
      }))

    const privateItems = privateReservations
      .filter((reservation) => {
        if (reservation.status !== 'active') return false
        const slot = privateSlotsById.get(String(reservation.slotId || '').trim()) || null
        return String(reservation.date || slot?.date || '').trim() === todayYmd
      })
      .map((reservation) => {
        const slot = privateSlotsById.get(String(reservation.slotId || '').trim()) || null
        return {
          id: `private-reservation-${reservation.id}`,
          time: String(reservation.time || slot?.time || '').trim() || '-',
          typeLabel: '1:1 예약',
          teacherLabel: String(reservation.teacher || slot?.teacher || '').trim() || '-',
          title:
            String(reservation.subject || '').trim() ||
            String(slot?.subject || '').trim() ||
            '1:1 수업',
          statusLabel: '예약 완료',
        }
      })

    const groupItems = reservations
      .filter((reservation) => {
        if (reservation.status !== 'active') return false
        const lesson = lessonsById.get(String(reservation.lessonId || '').trim()) || null
        return String(reservation.date || lesson?.date || '').trim() === todayYmd
      })
      .map((reservation) => {
        const lesson = lessonsById.get(String(reservation.lessonId || '').trim()) || null
        const className = String(lesson?.groupClassName || '').trim()
        const subject =
          String(reservation.subject || '').trim() ||
          String(lesson?.subject || '').trim()
        return {
          id: `group-reservation-${reservation.id}`,
          time: String(reservation.time || lesson?.time || '').trim() || '-',
          typeLabel: '단체반 예약',
          teacherLabel: String(reservation.teacher || lesson?.teacher || '').trim() || '-',
          title: [className, subject].filter(Boolean).join(' · ') || '단체반 수업',
          statusLabel: '예약 완료',
        }
      })

    return [...groupItems, ...privateItems, ...lessonItems].sort((a, b) => {
      const aKey = `${a.time || ''} ${a.typeLabel || ''} ${a.title || ''}`
      const bKey = `${b.time || ''} ${b.typeLabel || ''} ${b.title || ''}`
      return aKey.localeCompare(bKey, 'ko')
    })
  }, [
    lessonsById,
    privateReservations,
    privateSlotsById,
    reservations,
    sortedUpcomingPrivateLessons,
    todayYmd,
  ])

  const upcomingPrivateScheduleLoading =
    !studentPrivateLessonsResolved ||
    studentPrivateLessonsLoading ||
    !privateReservationsResolved ||
    privateReservationsLoading

  const todayScheduleLoading =
    lessonHistoryLoading || !studentPrivateLessonsResolved || studentPrivateLessonsLoading

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  async function reserveLesson(lesson) {
    if (role !== 'student') {
      alert('학생 계정만 예약할 수 있습니다.')
      return
    }

    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    assertSameAcademy(lesson, scopedAcademyId, '그룹 수업')
    validateLessonBookingState(lesson, 'reserve')

    const groupClassId = String(lesson.groupClassId || '').trim()
    if (!groupClassId) {
      alert('수업의 그룹 정보가 올바르지 않습니다.')
      return
    }
    if (!scopedStudentId) {
      alert('학생 계정 연결 정보가 없어 예약할 수 없습니다.')
      return
    }
    const groupCourseType = normalizeGroupCourseType(lesson.groupCourseType)
    const hasGroupAccess =
      allowedGroupClassIds.includes(groupClassId) ||
      (groupCourseType && allowedGroupCourseTypes.includes(groupCourseType))
    if (!hasGroupAccess) {
      alert('예약 가능한 반 권한이 없습니다.')
      return
    }

    const reservationId = buildGroupLessonReservationId({
      academyId: scopedAcademyId,
      lessonId: lesson.id,
      studentId: scopedStudentId,
    })
    const existingReservation = reservationByLessonId.get(lesson.id) || null

    if (existingReservation?.status === 'active') {
      alert('이미 예약됨')
      return
    }

    try {
      setBusyReservationId(reservationId)
      const reserveGroupLessonSeat = httpsCallable(firebaseFunctions, 'reserveGroupLessonSeat')
      await reserveGroupLessonSeat({
        academyId: scopedAcademyId,
        lessonId: lesson.id,
      })
      logStudentBookingEvent('reserve_success', {
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        studentId: scopedStudentId,
      })
      setLocallyReservedGroupLessonIds((previous) =>
        previous.includes(lesson.id) ? previous : [...previous, lesson.id]
      )
      updateGroupLessonBookedCount(lesson.id, 1)
    } catch (error) {
      console.error('학생 그룹 수업 예약 실패:', error)
      logStudentBookingEvent('reserve_failure', {
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        studentId: scopedStudentId,
        message: error?.message || 'unknown',
      })
      alert(`예약 실패: ${error.message}`)
    } finally {
      setBusyReservationId('')
    }
  }

  async function reservePrivateSlot(slot) {
    if (!PRIVATE_SLOT_BOOKING_ENABLED) {
      alert('1:1 예약 시간은 현재 관리자만 변경할 수 있습니다.')
      return
    }
    if (!privateSlotBookingPilotEnabled) {
      alert('1:1 예약 기능은 아직 선택된 학생에게만 제공됩니다.')
      return
    }
    if (role !== 'student') {
      alert('학생 계정만 예약할 수 있습니다.')
      return
    }

    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    assertSameAcademy(slot, scopedAcademyId, '1:1 수업 시간')
    validatePrivateSlotBookingState(slot, 'reserve')

    const slotEligibleStudentIds = Array.isArray(slot.eligibleStudentIds)
      ? slot.eligibleStudentIds
      : []
    const hasProjectedBookableAccess = slot.isBookable === true
    const hasSlotAccess =
      allowedPrivateSlotIds.includes(slot.id) ||
      slotEligibleStudentIds.some((value) => String(value || '').trim() === scopedStudentId)
    const hasTeacherAccess = slotMatchesPrivateTeacherAccess(slot, allowedPrivateTeacherKeys)
    if (!hasProjectedBookableAccess && !hasTeacherAccess && !hasSlotAccess) {
      alert('예약 가능한 선생님 권한이 없습니다.')
      return
    }
    if (!scopedStudentId) {
      alert('학생 계정 연결 정보가 없어 예약할 수 없습니다.')
      return
    }

    const reservationId = buildPrivateLessonReservationId({
      academyId: scopedAcademyId,
      slotId: slot.id,
      studentId: scopedStudentId,
    })

    if (privateReservationBySlotId.get(slot.id)?.status === 'active') {
      alert('이미 예약됨')
      return
    }
    if (!window.confirm(PRIVATE_SLOT_RESERVE_CONFIRM_MESSAGE)) {
      return
    }

    try {
      setBusyPrivateReservationId(reservationId)
      const reservePrivateLessonSlot = httpsCallable(
        firebaseFunctions,
        'reservePrivateLessonSlot'
      )
      await reservePrivateLessonSlot({
        academyId: scopedAcademyId,
        slotId: slot.id,
        availabilityTemplateId: slot.availabilityTemplateId || '',
        date: slot.date || '',
        time: slot.time || '',
        ...PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE,
      })
      logStudentPrivateBookingEvent('reserve_success', {
        academyId: scopedAcademyId,
        slotId: slot.id,
        studentId: scopedStudentId,
      })
      setPrivateSlotsRefreshKey((value) => value + 1)
    } catch (error) {
      console.error('학생 1:1 수업 예약 실패:', error)
      logStudentPrivateBookingEvent('reserve_failure', {
        academyId: scopedAcademyId,
        slotId: slot.id,
        studentId: scopedStudentId,
        message: error?.message || 'unknown',
      })
      alert(`1:1 수업 예약 실패: ${error.message}`)
    } finally {
      setBusyPrivateReservationId('')
    }
  }

  async function cancelReservation(reservation) {
    if (role !== 'student') {
      alert('학생 계정만 예약을 취소할 수 있습니다.')
      return
    }
    if (!reservation?.lessonId) return

    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    const reservationId = buildGroupLessonReservationId({
      academyId: scopedAcademyId,
      lessonId: reservation.lessonId,
      studentId: scopedStudentId,
    })

    try {
      setBusyReservationId(reservationId)
      const cancelGroupLessonSeat = httpsCallable(firebaseFunctions, 'cancelGroupLessonSeat')
      await cancelGroupLessonSeat({
        academyId: scopedAcademyId,
        lessonId: reservation.lessonId,
      })
      logStudentBookingEvent('cancel_success', {
        academyId: scopedAcademyId,
        lessonId: reservation.lessonId,
        studentId: scopedStudentId,
      })
      setLocallyReservedGroupLessonIds((previous) =>
        previous.filter((lessonId) => lessonId !== reservation.lessonId)
      )
      updateGroupLessonBookedCount(reservation.lessonId, -1)
      setGroupLessonsRefreshKey((value) => value + 1)
    } catch (error) {
      console.error('학생 그룹 수업 예약 취소 실패:', error)
      logStudentBookingEvent('cancel_failure', {
        academyId: scopedAcademyId,
        lessonId: reservation.lessonId,
        studentId: scopedStudentId,
        message: error?.message || 'unknown',
      })
      alert(`예약 취소 실패: ${error.message}`)
    } finally {
      setBusyReservationId('')
    }
  }

  async function cancelPrivateReservation(reservation) {
    if (!PRIVATE_SLOT_BOOKING_ENABLED) {
      alert('1:1 예약 시간은 현재 관리자만 변경할 수 있습니다.')
      return
    }
    if (!privateSlotBookingPilotEnabled) {
      alert('1:1 예약 기능은 아직 선택된 학생에게만 제공됩니다.')
      return
    }
    if (role !== 'student') {
      alert('학생 계정만 예약을 취소할 수 있습니다.')
      return
    }
    if (!reservation?.slotId) return

    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    const reservationId = buildPrivateLessonReservationId({
      academyId: scopedAcademyId,
      slotId: reservation.slotId,
      studentId: scopedStudentId,
    })
    if (!window.confirm(PRIVATE_RESERVATION_CANCEL_CONFIRM_MESSAGE)) {
      return
    }

    try {
      setBusyPrivateReservationId(reservationId)
      const cancelPrivateLessonReservation = httpsCallable(
        firebaseFunctions,
        'cancelPrivateLessonReservation'
      )
      await cancelPrivateLessonReservation({
        academyId: scopedAcademyId,
        slotId: reservation.slotId,
        ...PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE,
      })
      logStudentPrivateBookingEvent('cancel_success', {
        academyId: scopedAcademyId,
        slotId: reservation.slotId,
        studentId: scopedStudentId,
      })
      const [, nextSlots] = await Promise.all([
        loadPrivateReservations(),
        loadPrivateSlotAvailability(),
      ])
      if (!nextSlots.some((slot) => String(slot.id || '').trim() === String(reservation.slotId))) {
        await mergeOpenPrivateSlotById(reservation.slotId, reservation)
      }
    } catch (error) {
      console.error('학생 1:1 수업 예약 취소 실패:', error)
      logStudentPrivateBookingEvent('cancel_failure', {
        academyId: scopedAcademyId,
        slotId: reservation.slotId,
        studentId: scopedStudentId,
        message: error?.message || 'unknown',
      })
      alert(`1:1 수업 예약 취소 실패: ${error.message}`)
    } finally {
      setBusyPrivateReservationId('')
    }
  }

  const pageBlockedReason = useMemo(() => {
    if (authLoading) return ''
    if (!user) return '로그인이 필요합니다.'
    if (role !== 'student') return '학생 계정만 이 페이지를 사용할 수 있습니다.'
    if (!hasOperationalAcademy) return '현재 학원 컨텍스트가 없어 예약 페이지를 열 수 없습니다.'
    if (!scopedStudentId) return '학생 계정 연결 정보가 없어 예약 페이지를 사용할 수 없습니다.'
    return ''
  }, [authLoading, hasOperationalAcademy, role, scopedStudentId, user])

  const linkedStudentName = useMemo(() => {
    const packageStudentName =
      studentPackages
        .map((pkg) => String(pkg?.studentName || '').trim())
        .find(Boolean) || ''
    return resolveLinkedStudentDisplayName({
      membershipDisplayName: currentMembership?.displayName,
      privateStudentRecord: linkedPrivateStudent,
      packageStudentName,
    })
  }, [currentMembership?.displayName, linkedPrivateStudent, studentPackages])

  const studentIdentityLine = useMemo(
    () =>
      formatStudentBookingIdentityLine({
        academyName: currentAcademy?.name || currentAcademyId || '-',
        studentName: linkedStudentName,
        email: user?.email || '',
      }),
    [currentAcademy?.name, currentAcademyId, linkedStudentName, user?.email]
  )

  const studentTicketSummary = useMemo(() => {
    if (!hasOperationalAcademy || !scopedStudentId) {
      return {
        privateSummaries: [],
        groupSummaries: [],
        hasPrivateTicket: false,
        hasGroupTicket: false,
      }
    }
    const fromPackages = buildStudentTicketSummaryViewModel({
      packages: studentPackages,
      privateLessons: studentPrivateLessons,
      privateReservations,
      groupReservations: reservations,
      academyId: currentAcademyId,
      studentId: scopedStudentId,
    })
    if (fromPackages.privateSummaries.length > 0 || fromPackages.groupSummaries.length > 0) {
      return fromPackages
    }
    const privateSummaries = buildStudentPrivateTicketSummariesFromCallablePackages(privateSlots)
    return {
      privateSummaries,
      groupSummaries: fromPackages.groupSummaries,
      hasPrivateTicket: privateSummaries.length > 0,
      hasGroupTicket: fromPackages.groupSummaries.length > 0,
    }
  }, [
    currentAcademyId,
    hasOperationalAcademy,
    privateReservations,
    privateSlots,
    reservations,
    scopedStudentId,
    studentPackages,
    studentPrivateLessons,
  ])

  const studentTicketSummaryLoading =
    !studentPackagesResolved ||
    studentPackagesLoading ||
    !privateReservationsResolved ||
    privateReservationsLoading ||
    !studentPrivateLessonsResolved ||
    studentPrivateLessonsLoading ||
    linkedPrivateStudentLoading

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(180deg, rgba(8,18,33,1) 0%, rgba(16,28,45,1) 45%, rgba(22,27,37,1) 100%)',
        color: 'white',
        padding: '32px 20px 60px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 24,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '2rem' }}>수업 예약</h1>
            <p
              data-testid="student-booking-identity-line"
              style={{ margin: '8px 0 0 0', opacity: 0.78 }}
            >
              {studentIdentityLine}
            </p>
            {scopedStudentId ? (
              <p
                data-testid="student-booking-linked-student-id"
                style={{ margin: '4px 0 0 0', opacity: 0.55, fontSize: 12 }}
              >
                학생 ID: {scopedStudentId}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSignOut}
            style={{ minWidth: 120 }}
          >
            로그아웃
          </button>
        </header>

        {pageBlockedReason ? (
          <div
            style={{
              border: '1px solid #36435c',
              borderRadius: 16,
              padding: 24,
              background: 'rgba(17, 24, 39, 0.78)',
            }}
          >
            <h2 style={{ marginTop: 0 }}>예약 페이지를 열 수 없습니다.</h2>
            <p style={{ marginBottom: 0, opacity: 0.78 }}>{pageBlockedReason}</p>
          </div>
	        ) : (
	          <div style={{ display: 'grid', gap: 20 }}>
	            <section
	              data-testid="student-ticket-summary-section"
	              style={{
	                border: '1px solid #3b4a66',
	                borderRadius: 16,
	                background: '#182235',
	                padding: 18,
	              }}
	            >
	              <h2 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>내 수강권</h2>
	              <p style={{ margin: '0 0 12px 0', opacity: 0.72, fontSize: 14 }}>
                잔여 횟수와 보충/선택예약 가능 횟수를 확인할 수 있습니다.
              </p>
	              {studentPackagesError ? (
	                <p style={{ color: '#f4a7a7', margin: 0 }}>{studentPackagesError}</p>
	              ) : null}
	              {studentTicketSummaryLoading ? (
	                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
	              ) : (
	                <div style={{ display: 'grid', gap: 12 }}>
	                  <div data-testid="student-private-ticket-summary-block">
	                    <p style={{ margin: '0 0 8px 0', fontSize: 13, opacity: 0.72 }}>개인 수강권</p>
	                    {studentTicketSummary.privateSummaries.length > 0 ? (
	                      studentTicketSummary.privateSummaries.map((summary) => (
	                        <div
	                          key={summary.id}
	                          data-testid="student-private-ticket-summary-row"
	                          style={{
	                            display: 'flex',
	                            flexDirection: 'column',
	                            gap: 4,
	                            opacity: summary.muted ? 0.62 : 1,
	                          }}
	                        >
	                          <span data-testid="student-private-ticket-summary-usage">
	                            {summary.teacherLabel} · {summary.usageText}
	                          </span>
	                          {summary.scheduleText ? (
	                            <span
	                              data-testid="student-private-ticket-summary-schedule"
	                              style={{ opacity: 0.86, fontSize: 14 }}
	                            >
	                              {summary.scheduleText}
	                            </span>
	                          ) : null}
	                          {summary.statusText ? (
	                            <span style={{ opacity: 0.72, fontSize: 13 }}>{summary.statusText}</span>
	                          ) : null}
	                        </div>
	                      ))
	                    ) : (
	                      <p
	                        data-testid="student-private-ticket-summary-empty"
	                        style={{ margin: 0, opacity: 0.78 }}
	                      >
	                        개인 수강권 등록 필요
	                      </p>
	                    )}
	                  </div>
	                  <div data-testid="student-group-ticket-summary-block">
	                    <p style={{ margin: '0 0 8px 0', fontSize: 13, opacity: 0.72 }}>단체 수강권</p>
	                    {studentTicketSummary.groupSummaries.length > 0 ? (
	                      studentTicketSummary.groupSummaries.map((summary) => (
	                        <div
	                          key={summary.id}
	                          data-testid="student-group-ticket-summary-row"
	                          style={{
	                            display: 'flex',
	                            flexDirection: 'column',
	                            gap: 4,
	                            opacity: summary.muted ? 0.62 : 1,
	                          }}
	                        >
	                          <span data-testid="student-group-ticket-summary-usage">
	                            {summary.classLabel} · {summary.usageText}
	                          </span>
	                          {summary.scheduleText ? (
	                            <span
	                              data-testid="student-group-ticket-summary-schedule"
	                              style={{ opacity: 0.86, fontSize: 14 }}
	                            >
	                              {summary.scheduleText}
	                            </span>
	                          ) : null}
	                          {summary.statusText ? (
	                            <span style={{ opacity: 0.72, fontSize: 13 }}>{summary.statusText}</span>
	                          ) : null}
	                        </div>
	                      ))
	                    ) : (
	                      <p
	                        data-testid="student-group-ticket-summary-empty"
	                        style={{ margin: 0, opacity: 0.78 }}
	                      >
	                        단체 수강권 등록 필요
	                      </p>
	                    )}
	                  </div>
	                </div>
	              )}
	            </section>
	            <TodaySchedulePanel
	              items={todayScheduleItems}
	              loading={todayScheduleLoading}
	              showStudent={false}
	            />
            <DailyMaterialStudentPanel
              material={
                dailyMaterials.find((material) => material.id === todayDailyMaterialId) ||
                dailyMaterials[0] ||
                null
              }
              loading={dailyMaterialsLoading}
            />
            {dailyMaterialsError ? (
              <p style={{ color: '#f4a7a7', margin: 0 }}>{dailyMaterialsError}</p>
            ) : null}

	            <section
	              style={{
                border: '1px solid #3b4a66',
                borderRadius: 16,
                background: '#182235',
                padding: 18,
              }}
            >
              <p style={{ margin: 0, fontSize: 14, opacity: 0.9 }}>
                예약 후 결제는 학원에서 오프라인으로 진행됩니다.
              </p>
            </section>

            <section
              style={{
                border: '1px solid #2e3240',
                borderRadius: 16,
                background: '#151922',
                padding: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>내 예정 수업</h2>

              {studentPrivateLessonsError || privateReservationsError ? (
                <p style={{ color: '#f4a7a7' }}>
                  {studentPrivateLessonsError || privateReservationsError}
                </p>
              ) : null}
              {upcomingPrivateScheduleLoading ? (
                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
              ) : upcomingPrivateScheduleItems.length === 0 ? (
                <p style={{ opacity: 0.78, marginBottom: 0 }}>
                  예정된 1:1 수업이 없습니다.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {upcomingPrivateScheduleItems.map((item) => (
                    <article
                      key={item.id}
                      data-testid="student-upcoming-private-lesson-card"
                      data-source={item.source}
                      data-source-id={item.sourceId}
                      style={{
                        border: '1px solid #283042',
                        borderRadius: 14,
                        padding: 16,
                        background: '#1a1f2b',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
                          gap: 12,
                          alignItems: 'center',
                        }}
                      >
                        <span>
                          <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                            날짜
                          </span>
                          {item.date || '-'}
                        </span>
                        <span>
                          <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                            시간
                          </span>
                          {item.time || '-'}
                        </span>
                        <span>
                          <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                            선생님
                          </span>
                          {item.teacherLabel || '-'}
                        </span>
                        <span>
                          <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                            수업명
                          </span>
                          {item.title || '-'}
                        </span>
                        {item.sessionLabel ? (
                          <span>
                            <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                              회차
                            </span>
                            <span
                              data-testid="student-upcoming-session-badge"
                              style={{
                                display: 'inline-block',
                                border: '1px solid rgba(120, 140, 200, 0.45)',
                                borderRadius: 4,
                                padding: '2px 6px',
                                background: 'rgba(60, 120, 90, 0.35)',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.sessionLabel}
                            </span>
                          </span>
                        ) : null}
                        <span>
                          <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                            상태
                          </span>
                          {item.statusLabel || '수업 예정'}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section
              style={{
                border: '1px solid #2e3240',
                borderRadius: 16,
                background: '#151922',
                padding: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>단체반 예약</h2>
              <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 14 }}>
                내 반 권한이 있는 수업만 표시됩니다.
              </p>

              {accessError ? <p style={{ color: '#f4a7a7' }}>{accessError}</p> : null}
              {lessonsError ? <p style={{ color: '#f4a7a7' }}>{lessonsError}</p> : null}
              {!accessResolved || accessLoading || lessonsLoading ? (
                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
              ) : sortedLessons.length === 0 ? (
                <p style={{ opacity: 0.78, marginBottom: 0 }}>
                  지금 예약 가능한 단체반 수업이 없습니다. 학원 안내 후 다시 확인해 주세요.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {sortedLessons.map((lesson) => {
                    const reservation = reservationByLessonId.get(lesson.id) || null
                    const isReserved = reservation?.status === 'active'
                    const reservationId = buildGroupLessonReservationId({
                      academyId: currentAcademyId,
                      lessonId: lesson.id,
                      studentId: scopedStudentId,
                    })
                    const isBusy = busyReservationId === reservationId
                    const remainingSeats = Number(
                      lesson.remainingSeats ?? lesson.seatAvailability?.remainingSeats
                    )
                    const hasRemainingSeats = Number.isFinite(remainingSeats)
                      ? remainingSeats > 0
                      : Number(lesson.bookedCount ?? 0) < Number(lesson.capacity ?? 0)
                    const lessonBookingStatusLabel = isReserved
                      ? '예약 완료'
                      : lesson.groupTicketStatusLabel
                        ? lesson.groupTicketStatusLabel
                        : hasRemainingSeats
                        ? '예약 가능'
                        : '마감'
                    const groupTicketAvailableToBook = Number(lesson.groupTicketAvailableToBook ?? 0)
                    const hasGroupTicketBalanceProjection =
                      lesson.groupTicketAvailableToBook !== undefined ||
                      Boolean(lesson.groupTicketStatusLabel)
                    const hasGroupTicketAvailability =
                      !hasGroupTicketBalanceProjection ||
                      (Number.isFinite(groupTicketAvailableToBook) && groupTicketAvailableToBook > 0)
                    const groupReserveDisabledReason = !hasRemainingSeats
                      ? '마감'
                      : lesson.groupTicketStatusLabel && !hasGroupTicketAvailability
                        ? lesson.groupTicketStatusLabel
                        : '마감'
                    const canReserve =
                      !isReserved &&
                      !busyReservationId &&
                      lesson.isBookable === true &&
                      hasRemainingSeats &&
                      hasGroupTicketAvailability

                    return (
                      <article
                        key={lesson.id}
                        data-testid="student-booking-lesson-card"
                        data-lesson-id={lesson.id}
                        style={{
                          border: '1px solid #283042',
                          borderRadius: 14,
                          padding: 16,
                          background: '#1a1f2b',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: '1rem' }}>{lesson.subject || '그룹 수업'}</strong>
                            <div style={{ marginTop: 6, opacity: 0.74, fontSize: 14 }}>
                              {[lesson.date, lesson.time].filter(Boolean).join(' · ') || lesson.id}
                            </div>
                            {getGroupCourseTypeLabel(lesson.groupCourseType) ? (
                              <div style={{ marginTop: 6, opacity: 0.7, fontSize: 13 }}>
                                {getGroupCourseTypeLabel(lesson.groupCourseType)}
                              </div>
                            ) : null}
                            <div style={{ marginTop: 6, opacity: 0.68, fontSize: 13 }}>
                              {lessonBookingStatusLabel} · {getLessonCapacityLabel(lesson)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isReserved ? (
                              <button
                                type="button"
                                onClick={() => cancelReservation(reservation)}
                                disabled={Boolean(busyReservationId)}
                                data-testid="student-booking-cancel-button"
                                style={{
                                  padding: '10px 14px',
                                  borderRadius: 10,
                                  border: '1px solid #744242',
                                  background: '#4a2a2a',
                                  color: 'white',
                                  cursor: busyReservationId ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {isBusy ? '취소 중...' : '예약 취소'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => reserveLesson(lesson)}
                                disabled={!canReserve}
                                data-testid="student-booking-reserve-button"
                                style={{
                                  padding: '10px 14px',
                                  borderRadius: 10,
                                  border: '1px solid #48643a',
                                  background: '#20351f',
                                  color: 'white',
                                  cursor: canReserve ? 'pointer' : 'not-allowed',
                                }}
                              >
                                {isBusy
                                  ? '예약 중...'
                                  : canReserve
                                    ? '단체반 예약'
                                    : groupReserveDisabledReason}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section
              style={{
                border: '1px solid #2e3240',
                borderRadius: 16,
                background: '#151922',
                padding: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>1:1 수업 예약</h2>
              <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 14 }}>
                선생님의 주간 1:1 시간표입니다. 수업이 있는 시간은 ‘수업 있음’으로 표시됩니다.
              </p>
              <div
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  marginTop: 12,
                  padding: 4,
                  border: '1px solid #30384b',
                  borderRadius: 8,
                  background: '#111722',
                }}
              >
                <button
                  type="button"
                  data-testid="private-slot-view-mode-all"
                  onClick={() => setPrivateSlotViewMode('all')}
                  aria-pressed={privateSlotViewMode === 'all'}
                  style={getPrivateSlotViewModeButtonStyle(privateSlotViewMode === 'all')}
                >
                  전체 시간 보기
                </button>
                <button
                  type="button"
                  data-testid="private-slot-view-mode-available"
                  onClick={() => setPrivateSlotViewMode('available')}
                  aria-pressed={privateSlotViewMode === 'available'}
                  style={getPrivateSlotViewModeButtonStyle(privateSlotViewMode === 'available')}
                >
                  예약 가능한 시간만
                </button>
              </div>
              <div
                data-testid="student-private-booking-policy-notice"
                style={{
                  marginTop: 12,
                  border: '1px solid #445066',
                  borderRadius: 12,
                  background: '#1b2536',
                  padding: '12px 14px',
                  color: 'white',
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                <div>예약은 수업 시작 7시간 전까지만 가능합니다.</div>
                <div>취소는 수업 시작 6시간 전까지만 가능합니다.</div>
                <div>학생 직접 취소는 최대 2회까지 가능합니다.</div>
                <div>2회를 초과하면 학원에 문의해 주세요.</div>
              </div>

              {privateAccessError ? <p style={{ color: '#f4a7a7' }}>{privateAccessError}</p> : null}
              {privateSlotsError ? <p style={{ color: '#f4a7a7' }}>{privateSlotsError}</p> : null}
              {!privateAccessResolved || privateAccessLoading || privateSlotsLoading ? (
                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
              ) : sortedPrivateSlots.length === 0 ? (
                <p style={{ opacity: 0.78, marginBottom: 0 }}>
                  지금 예약 가능한 1:1 수업 시간이 없습니다. 학원 안내 후 다시 확인해 주세요.
                </p>
              ) : (
                <div
                  data-testid="student-private-calendar"
                  style={{ display: 'grid', gap: 18, marginTop: 16 }}
                >
                  {privateCalendarWeeks.map((week) => (
                    <div key={week.weekStart} style={{ display: 'grid', gap: 10 }}>
                      <div style={{ opacity: 0.76, fontSize: 13 }}>
                        {week.weekStart} - {week.weekEnd}
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                          gap: 10,
                        }}
                      >
                        {week.days.map((day) => (
                          <div
                            key={day.date}
                            data-testid="student-private-calendar-day"
                            style={{
                              border: '1px solid #283042',
                              borderRadius: 8,
                              padding: 10,
                              background: '#171c27',
                              minHeight: 120,
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                              {day.date}
                            </div>
                            {day.slots.length === 0 ? (
                              <div style={{ opacity: 0.68, fontSize: 13 }}>
                                가능한 시간이 없습니다
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gap: 8 }}>
                                {day.slots.map((slot) => {
                                  const reservation = privateReservationBySlotId.get(slot.id) || null
                                  const reservationId = buildPrivateLessonReservationId({
                                    academyId: currentAcademyId,
                                    slotId: slot.id,
                                    studentId: scopedStudentId,
                                  })
                                  const isBusy = busyPrivateReservationId === reservationId
                                  const hasActivePrivateReservation = reservation?.status === 'active'
                                  const bookingStatus = getStudentPrivateSlotStatus(
                                    slot,
                                    canUsePrivateBooking
                                  )
                                  const studentVisibleStatus = String(
                                    slot.studentVisibleStatus || ''
                                  ).trim()
                                  const isStudentMaskedBusy =
                                    studentVisibleStatus === 'busy' ||
                                    bookingStatus === 'no_ticket' ||
                                    bookingStatus === 'no_makeup'
                                  const isBusySlot =
                                    isStudentMaskedBusy ||
                                    slot.isBusy === true ||
                                    bookingStatus === 'busy' ||
                                    bookingStatus === 'reserved' ||
                                    String(slot.status || '').trim() === 'blocked'
                                  const canReserve =
                                    canUsePrivateBooking &&
                                    bookingStatus === 'available' &&
                                    slot.isBookable === true &&
                                    !hasActivePrivateReservation &&
                                    !busyPrivateReservationId &&
                                    slot.status === 'open'
                                  const statusLabel =
                                    isStudentMaskedBusy
                                      ? getPrivateSlotDisplayLabel(
                                          'busy',
                                          slot.studentVisibleStatusLabel
                                        )
                                      : getPrivateSlotDisplayLabel(
                                          bookingStatus,
                                          slot.bookingStatusLabel
                                        )
                                  const remainingCount = getPrivateSlotAvailableCount(slot)

                                  if (isBusySlot) {
                                    return (
                                      <article
                                        key={slot.id}
                                        data-testid="student-private-busy-slot-card"
                                        data-slot-id={slot.id}
                                        style={getPrivateSlotCardStyle(
                                          isStudentMaskedBusy ? 'busy' : bookingStatus
                                        )}
                                      >
                                        <div style={{ display: 'grid', gap: 6 }}>
                                          <div
                                            style={{
                                              display: 'flex',
                                              alignItems: 'flex-start',
                                              justifyContent: 'space-between',
                                              gap: 8,
                                            }}
                                          >
                                            <strong style={{ fontSize: 14 }}>
                                              {slot.teacherName || slot.teacher || '1:1 수업'}
                                            </strong>
                                            <span style={getPrivateSlotBadgeStyle(
                                              isStudentMaskedBusy ? 'busy' : bookingStatus
                                            )}>
                                              {statusLabel}
                                            </span>
                                          </div>
                                          <div style={{ opacity: 0.74, fontSize: 13 }}>
                                            {slot.date || day.date} · {slot.time || '-'} ·{' '}
                                            {Number(slot.durationMinutes || 0) || 60}분
                                          </div>
                                        </div>
                                      </article>
                                    )
                                  }

                                  return (
                                    <article
                                      key={slot.id}
                                      data-testid="student-private-slot-card"
                                      data-slot-id={slot.id}
                                      style={getPrivateSlotCardStyle(bookingStatus)}
                                    >
                                      <div style={{ display: 'grid', gap: 6 }}>
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            justifyContent: 'space-between',
                                            gap: 8,
                                          }}
                                        >
                                          <strong style={{ fontSize: 14 }}>
                                            {slot.teacherName || slot.teacher || '1:1 수업'}
                                          </strong>
                                          <span style={getPrivateSlotBadgeStyle(bookingStatus)}>
                                            {statusLabel}
                                          </span>
                                        </div>
                                        <div style={{ opacity: 0.74, fontSize: 13 }}>
                                          {slot.date || day.date} · {slot.time || '-'} ·{' '}
                                          {Number(slot.durationMinutes || 0) || 60}분
                                        </div>
                                        {bookingStatus === 'not_open' ? (
                                          <div style={{ opacity: 0.72, fontSize: 12, lineHeight: 1.5 }}>
                                            <div>{formatPrivateSlotOpenDisplay(slot)} 오픈</div>
                                            <div>{getPrivateSlotOpenRelativeDisplay(slot)}</div>
                                          </div>
                                        ) : null}
                                        {bookingStatus === 'closed' ? (
                                          <div style={{ opacity: 0.72, fontSize: 12 }}>
                                            예약 마감 · 수업 준비 중
                                          </div>
                                        ) : null}
                                        {canReserve ? (
                                          <div style={{ opacity: 0.72, fontSize: 12 }}>
                                            예약 가능 {remainingCount}회
                                          </div>
                                        ) : null}
                                        <button
                                          type="button"
                                          onClick={() => reservePrivateSlot(slot)}
                                          disabled={!canReserve}
                                          data-testid="student-private-slot-reserve-button"
                                          style={{
                                            marginTop: 4,
                                            padding: '9px 10px',
                                            borderRadius: 8,
                                            border: '1px solid #48643a',
                                            background: canReserve ? '#20351f' : '#242b3a',
                                            color: 'white',
                                            cursor: canReserve ? 'pointer' : 'not-allowed',
                                          }}
                                        >
                                          {isBusy
                                            ? '예약 중...'
                                            : canReserve
                                              ? '1:1 수업 예약'
                                              : statusLabel}
                                        </button>
                                      </div>
                                    </article>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section
              style={{
                border: '1px solid #2e3240',
                borderRadius: 16,
                background: '#151922',
                padding: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>내 1:1 수업 예약</h2>
              <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 14 }}>
                내 1:1 수업 예약만 표시됩니다.
              </p>

              {privateReservationsError ? (
                <p style={{ color: '#f4a7a7' }}>{privateReservationsError}</p>
              ) : null}
              {!privateReservationsResolved || privateReservationsLoading ? (
                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
              ) : sortedPrivateReservations.length === 0 ? (
                <p style={{ opacity: 0.78, marginBottom: 0 }}>
                  아직 1:1 수업 예약이 없습니다. 예약 가능한 시간이 열리면 여기에서 확인할 수 있습니다.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {sortedPrivateReservations.map((reservation) => {
                    const slot = privateSlotsById.get(reservation.slotId) || null
                    const reservationId = buildPrivateLessonReservationId({
                      academyId: currentAcademyId,
                      slotId: reservation.slotId,
                      studentId: scopedStudentId,
                    })
                    const isBusy = busyPrivateReservationId === reservationId
                    const isActive = reservation.status === 'active'
                    const reservationTitle =
                      String(reservation.subject || slot?.subject || '').trim() || '1:1 수업'
                    const reservationDateTime = [
                      String(reservation.date || slot?.date || '').trim(),
                      String(reservation.time || slot?.time || '').trim(),
                    ].filter(Boolean).join(' · ')

                    return (
                      <article
                        key={reservation.id}
                        data-testid="student-private-reservation-card"
                        data-reservation-id={reservation.id}
                        style={{
                          border: '1px solid #283042',
                          borderRadius: 14,
                          padding: 16,
                          background: '#1a1f2b',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <strong style={{ fontSize: '1rem' }}>
                                {reservation.teacher || slot?.teacher || '1:1 수업'}
                              </strong>
                              <span style={getPrivateSlotBadgeStyle('my_reservation')}>내 예약</span>
                            </div>
                            <div style={{ marginTop: 6, opacity: 0.74, fontSize: 14 }}>
                              {[reservation.date || slot?.date, reservation.time || slot?.time]
                                .filter(Boolean)
                                .join(' · ') || `slotId: ${reservation.slotId}`}
                            </div>
                            <div style={{ marginTop: 6, opacity: 0.68, fontSize: 13 }}>
                              {isActive ? '내 예약' : getReservationStatusLabel(reservation)}
                            </div>
                            {isActive ? (
                              <div style={{ marginTop: 6, opacity: 0.72, fontSize: 13 }}>
                                결제는 학원 안내에 따라 진행됩니다.
                              </div>
                            ) : null}
                          </div>
                          {isActive && PRIVATE_SLOT_BOOKING_ENABLED && privateSlotBookingPilotEnabled ? (
                            <button
                              type="button"
                              onClick={() => cancelPrivateReservation(reservation)}
                              disabled={Boolean(busyPrivateReservationId)}
                              data-testid="student-private-reservation-cancel-button"
                              style={{
                                alignSelf: 'flex-start',
                                padding: '6px 10px',
                                borderRadius: 999,
                                border: '1px solid #9a3f48',
                                background: '#3a1f24',
                                color: '#ffd8dc',
                                cursor: busyPrivateReservationId ? 'not-allowed' : 'pointer',
                                fontSize: 12,
                                fontWeight: 800,
                              }}
                            >
                              {isBusy ? '취소 중...' : '예약 취소'}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section
              style={{
                border: '1px solid #2e3240',
                borderRadius: 16,
                background: '#151922',
                padding: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>내 단체반 예약</h2>
              <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 14 }}>
                내 단체반 예약만 표시됩니다.
              </p>

              {reservationsError ? <p style={{ color: '#f4a7a7' }}>{reservationsError}</p> : null}
              {!reservationsResolved || reservationsLoading ? (
                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
              ) : sortedReservations.length === 0 ? (
                <p style={{ opacity: 0.78, marginBottom: 0 }}>
                  아직 단체반 예약이 없습니다. 예약을 완료하면 이곳에 표시됩니다.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {sortedReservations.map((reservation) => {
                    const lesson = lessonsById.get(reservation.lessonId) || null
                    const reservationId = buildGroupLessonReservationId({
                      academyId: currentAcademyId,
                      lessonId: reservation.lessonId,
                      studentId: scopedStudentId,
                    })
                    const isBusy = busyReservationId === reservationId
                    const isActive = reservation.status === 'active'
                    const reservationTitle =
                      String(reservation.subject || lesson?.subject || '').trim() || '그룹 수업'
                    const reservationDateTime = [
                      String(reservation.date || lesson?.date || '').trim(),
                      String(reservation.time || lesson?.time || '').trim(),
                    ].filter(Boolean).join(' · ')

                    return (
                      <article
                        key={reservation.id}
                        data-testid="student-booking-reservation-card"
                        data-reservation-id={reservation.id}
                        style={{
                          border: '1px solid #283042',
                          borderRadius: 14,
                          padding: 16,
                          background: '#1a1f2b',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: '1rem' }}>
                              {reservationTitle}
                            </strong>
                            <div style={{ marginTop: 6, opacity: 0.74, fontSize: 14 }}>
                              {reservationDateTime || `lessonId: ${reservation.lessonId}`}
                            </div>
                            <div style={{ marginTop: 6, opacity: 0.68, fontSize: 13 }}>
                              {getReservationStatusLabel(reservation)}
                            </div>
                            {isActive ? (
                              <div style={{ marginTop: 6, opacity: 0.72, fontSize: 13 }}>
                                결제는 학원 안내에 따라 진행됩니다.
                              </div>
                            ) : null}
                          </div>
                          {isActive ? (
                            <button
                              type="button"
                              onClick={() => cancelReservation(reservation)}
                              disabled={Boolean(busyReservationId)}
                              data-testid="student-booking-reservation-cancel-button"
                              style={{
                                padding: '10px 14px',
                                borderRadius: 10,
                                border: '1px solid #744242',
                                background: '#4a2a2a',
                                color: 'white',
                                cursor: busyReservationId ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {isBusy ? '취소 중...' : '예약 취소'}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section
              style={{
                border: '1px solid #2e3240',
                borderRadius: 16,
                background: '#151922',
                padding: 20,
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>내 수업 내역</h2>
              <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 14 }}>
                내 1:1 수업과 단체반 수업 예약 내역만 표시됩니다.
              </p>

              {reservationsError || privateReservationsError ? (
                <p style={{ color: '#f4a7a7' }}>
                  {reservationsError || privateReservationsError}
                </p>
              ) : null}
              {lessonHistoryLoading ? (
                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
              ) : lessonHistoryItems.length === 0 ? (
                <p style={{ opacity: 0.78, marginBottom: 0 }}>
                  아직 수업 내역이 없습니다. 예약한 수업이 생기면 이곳에서 확인할 수 있습니다.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {lessonHistoryItems.map((item) => {
                    const dateTimeLabel = [item.date, item.time].filter(Boolean).join(' · ')
                    return (
                      <article
                        key={item.id}
                        data-testid="student-lesson-history-card"
                        style={{
                          border: '1px solid #283042',
                          borderRadius: 14,
                          padding: 16,
                          background: '#1a1f2b',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: '1rem' }}>{item.title}</strong>
                            <div style={{ marginTop: 6, opacity: 0.74, fontSize: 14 }}>
                              {item.typeLabel}
                              {dateTimeLabel ? ` · ${dateTimeLabel}` : ''}
                            </div>
                            {!dateTimeLabel ? (
                              <div style={{ marginTop: 6, opacity: 0.68, fontSize: 13 }}>
                                예약 정보 확인 중
                              </div>
                            ) : null}
                          </div>
                          <div
                            style={{
                              alignSelf: 'flex-start',
                              border: '1px solid #3b4a66',
                              borderRadius: 999,
                              padding: '6px 10px',
                              fontSize: 13,
                              color: 'white',
                              background: '#202b42',
                            }}
                          >
                            {getLessonHistoryStatusLabel(item)}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
