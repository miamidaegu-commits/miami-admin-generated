import { useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
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
  getGroupLessonGroupId,
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

const GROUP_CLASS_QUERY_CHUNK_SIZE = 10
const PRIVATE_TEACHER_QUERY_CHUNK_SIZE = 10
function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    String(value || '').trim().toLowerCase()
  )
}

const PRIVATE_SLOT_BOOKING_ENABLED =
  isEnabledFlag(import.meta.env.VITE_PRIVATE_SLOT_BOOKING_ENABLED) ||
  (import.meta.env.MODE === 'e2e' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('privateSlotBooking') === 'enabled')

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
    if (bookedCount >= capacity) throw new Error('정원 마감')
    return
  }
  if (bookedCount <= 0) {
    throw new Error('예약 수가 올바르지 않습니다.')
  }
}

function getLessonCapacityLabel(lesson) {
  const capacity = Number(lesson?.capacity ?? 0)
  const bookedCount = Number(lesson?.bookedCount ?? 0)
  const safeCapacity = Number.isFinite(capacity) && capacity >= 0 ? capacity : 0
  const safeBooked = Number.isFinite(bookedCount) && bookedCount >= 0 ? bookedCount : 0
  return `${safeBooked} / ${safeCapacity}`
}

function getReservationStatusLabel(reservation) {
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
    privateTeacherValuesMatch(teacherKeys, slot?.teacher) ||
    privateTeacherValuesMatch(teacherKeys, slot?.teacherName)
  )
}

function getLessonHistoryStatusLabel(item) {
  if (item.status !== 'active') return '예약 취소'
  if (item.startsAtMs !== null && item.startsAtMs < Date.now()) return '지난 수업'
  return '예약 완료'
}

function validatePrivateSlotBookingState(slot, mode) {
  if (!slot?.id) throw new Error('예약 시간을 찾을 수 없습니다.')
  if (slot.status === 'cancelled') throw new Error('취소된 시간입니다.')
  if (mode === 'reserve') {
    if (slot.status !== 'open') throw new Error('이미 예약된 시간입니다.')
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
  const [allowedPrivateTeacherKeys, setAllowedPrivateTeacherKeys] = useState([])
  const [allowedPrivateSlotIds, setAllowedPrivateSlotIds] = useState([])
  const [privateSlotBookingPilotEnabled, setPrivateSlotBookingPilotEnabled] = useState(false)
  const [privateAccessLoading, setPrivateAccessLoading] = useState(false)
  const [privateAccessResolved, setPrivateAccessResolved] = useState(false)
  const [privateAccessError, setPrivateAccessError] = useState('')
  const [privateSlots, setPrivateSlots] = useState([])
  const [privateSlotsLoading, setPrivateSlotsLoading] = useState(false)
  const [privateSlotsError, setPrivateSlotsError] = useState('')
  const [privateReservations, setPrivateReservations] = useState([])
  const [privateReservationsLoading, setPrivateReservationsLoading] = useState(false)
  const [privateReservationsResolved, setPrivateReservationsResolved] = useState(false)
  const [privateReservationsError, setPrivateReservationsError] = useState('')
  const [studentPrivateLessons, setStudentPrivateLessons] = useState([])
  const [studentPrivateLessonsLoading, setStudentPrivateLessonsLoading] = useState(false)
  const [studentPrivateLessonsResolved, setStudentPrivateLessonsResolved] = useState(false)
  const [studentPrivateLessonsError, setStudentPrivateLessonsError] = useState('')
  const [busyPrivateReservationId, setBusyPrivateReservationId] = useState('')
  const [dailyMaterials, setDailyMaterials] = useState([])
  const [dailyMaterialsLoading, setDailyMaterialsLoading] = useState(false)
  const [dailyMaterialsError, setDailyMaterialsError] = useState('')

  const scopedStudentId = String(studentId || currentMembership?.studentId || '').trim()
  const hasOperationalAcademy = isValidOperationalAcademyId(currentAcademyId)
  const todayDailyMaterialId = hasOperationalAcademy
    ? `${currentAcademyId}__${getTodayStorageDateString()}`
    : ''

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setAllowedGroupClassIds([])
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
        setAllowedGroupClassIds(Array.from(nextIds.values()))
        setAccessLoading(false)
        setAccessResolved(true)
      },
      (error) => {
        console.error('studentGroupAccessSummary 불러오기 실패:', error)
        setAllowedGroupClassIds([])
        setAccessLoading(false)
        setAccessResolved(true)
        setAccessError('예약 가능한 반 권한을 확인할 수 없습니다.')
      }
    )

    return () => unsubscribe()
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

    const unsubscribe = onSnapshot(
      summaryRef,
      (snapshot) => {
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
        setPrivateSlotBookingPilotEnabled(summaryData?.privateSlotBookingPilotEnabled === true)
        const nextKeys = new Set()
        if (hasActivePrivateAccess) {
          teacherKeys.forEach((value) => {
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

    return () => unsubscribe()
  }, [currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setLessons([])
      setLessonsLoading(false)
      setLessonsError('')
      return
    }
    if (allowedGroupClassIds.length === 0) {
      setLessons([])
      setLessonsLoading(false)
      setLessonsError('')
      return
    }

    setLessonsLoading(true)
    setLessonsError('')

    const chunks = chunkValues(allowedGroupClassIds, GROUP_CLASS_QUERY_CHUNK_SIZE)
    const chunkMaps = new Map()
    const unsubs = []

    const mergeRows = () => {
      const byId = new Map()
      for (let i = 0; i < chunks.length; i += 1) {
        const chunkMap = chunkMaps.get(i)
        if (!chunkMap) continue
        for (const row of chunkMap.values()) {
          byId.set(row.id, row)
        }
      }
      setLessons(Array.from(byId.values()))
      setLessonsLoading(false)
    }

    chunks.forEach((chunk, chunkIndex) => {
      const unsubscribe = onSnapshot(
        query(
          collection(db, 'groupLessons'),
          where('academyId', '==', currentAcademyId),
          where('isBookable', '==', true),
          where('groupClassId', 'in', chunk)
        ),
        (snapshot) => {
          const rows = new Map()
          snapshot.docs.forEach((docItem) => {
            rows.set(docItem.id, {
              id: docItem.id,
              ...docItem.data(),
            })
          })
          chunkMaps.set(chunkIndex, rows)
          mergeRows()
        },
        (error) => {
          console.error('student groupLessons 불러오기 실패:', error)
          chunkMaps.set(chunkIndex, new Map())
          setLessonsError('예약 가능한 수업을 불러오지 못했습니다.')
          mergeRows()
        }
      )

      unsubs.push(unsubscribe)
    })

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe())
    }
  }, [allowedGroupClassIds, currentAcademyId, hasOperationalAcademy, role, scopedStudentId])

  useEffect(() => {
    if (!hasOperationalAcademy || role !== 'student' || !scopedStudentId) {
      setPrivateSlots([])
      setPrivateSlotsLoading(false)
      setPrivateSlotsError('')
      return
    }
    setPrivateSlotsLoading(true)
    setPrivateSlotsError('')

    const teacherChunks = chunkValues(allowedPrivateTeacherKeys, PRIVATE_TEACHER_QUERY_CHUNK_SIZE)
    const sources = [
      ...teacherChunks.map((values) => ({ type: 'teacher', values })),
      ...teacherChunks.map((values) => ({ type: 'teacherName', values })),
      ...allowedPrivateSlotIds.map((slotId) => ({ type: 'slot', slotId })),
    ]
    if (sources.length === 0) {
      setPrivateSlots([])
      setPrivateSlotsLoading(false)
      return
    }

    const sourceMaps = new Map()
    const sourceFailures = new Map()
    const unsubs = []

    const mergeRows = () => {
      const byId = new Map()
      for (let i = 0; i < sources.length; i += 1) {
        const sourceMap = sourceMaps.get(i)
        if (!sourceMap) continue
        for (const row of sourceMap.values()) {
          byId.set(row.id, row)
        }
      }
      const nextSlots = Array.from(byId.values())
      const allSourcesSettled = sources.every((_, index) => sourceMaps.has(index))
      setPrivateSlots(nextSlots)
      setPrivateSlotsError(
        nextSlots.length === 0 &&
          allSourcesSettled &&
          sourceFailures.size === sources.length
          ? '예약 가능한 1:1 수업 시간을 불러오지 못했습니다.'
          : ''
      )
      setPrivateSlotsLoading(false)
    }

    sources.forEach((source, sourceIndex) => {
      if (source.type === 'slot') {
        const unsubscribe = onSnapshot(
          doc(db, 'privateLessonSlots', source.slotId),
          (snapshot) => {
            const rows = new Map()
            if (snapshot.exists()) {
              const row = {
                id: snapshot.id,
                ...snapshot.data(),
              }
              if (
                String(row.academyId || '').trim() === currentAcademyId &&
                String(row.status || '').trim() === 'open'
              ) {
                rows.set(snapshot.id, row)
              }
            }
            sourceMaps.set(sourceIndex, rows)
            sourceFailures.delete(sourceIndex)
            mergeRows()
          },
          (error) => {
            console.error('student allowed privateLessonSlot 불러오기 실패:', error)
            sourceMaps.set(sourceIndex, new Map())
            sourceFailures.set(sourceIndex, error)
            mergeRows()
          }
        )

        unsubs.push(unsubscribe)
        return
      }

      const privateSlotQuery = query(
        collection(db, 'privateLessonSlots'),
        where('academyId', '==', currentAcademyId),
        where('status', '==', 'open'),
        where(source.type, 'in', source.values)
      )
      const unsubscribe = onSnapshot(
        privateSlotQuery,
        (snapshot) => {
          const rows = new Map()
          snapshot.docs.forEach((docItem) => {
            const row = {
              id: docItem.id,
              ...docItem.data(),
            }
            if (
              String(row.academyId || '').trim() !== currentAcademyId ||
              String(row.status || '').trim() !== 'open'
            ) {
              return
            }
            if (
              !slotMatchesPrivateTeacherAccess(row, allowedPrivateTeacherKeys)
            ) {
              return
            }
            rows.set(docItem.id, row)
          })
          sourceMaps.set(sourceIndex, rows)
          sourceFailures.delete(sourceIndex)
          mergeRows()
        },
        (error) => {
          console.error('student privateLessonSlots 불러오기 실패:', error)
          sourceMaps.set(sourceIndex, new Map())
          sourceFailures.set(sourceIndex, error)
          mergeRows()
        }
      )

      unsubs.push(unsubscribe)
    })

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe())
    }
  }, [
    allowedPrivateSlotIds,
    allowedPrivateTeacherKeys,
    currentAcademyId,
    hasOperationalAcademy,
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
    return [...privateSlots].sort((a, b) => {
      const aKey = `${a.date || ''} ${a.time || ''} ${a.teacher || ''}`
      const bKey = `${b.date || ''} ${b.time || ''} ${b.teacher || ''}`
      return aKey.localeCompare(bKey, 'ko')
    })
  }, [privateSlots])

  const sortedPrivateReservations = useMemo(() => {
    return [...privateReservations].sort((a, b) => {
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
    if (!allowedGroupClassIds.includes(groupClassId)) {
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
      if (existingReservation?.status === 'cancelled') {
        await runTransaction(db, async (transaction) => {
          const lessonRef = doc(db, 'groupLessons', lesson.id)
          const reservationRef = doc(db, 'groupLessonReservations', reservationId)

          const [lessonSnap, reservationSnap] = await Promise.all([
            transaction.get(lessonRef),
            transaction.get(reservationRef),
          ])

          if (!lessonSnap.exists()) throw new Error('수업 일정을 찾을 수 없습니다.')
          if (!reservationSnap.exists()) throw new Error('취소된 예약을 찾을 수 없습니다.')

          const lessonData = { id: lessonSnap.id, ...lessonSnap.data() }
          const reservationData = reservationSnap.data()

          assertSameAcademy(lessonData, scopedAcademyId, '그룹 수업')
          validateLessonBookingState(lessonData, 'reserve')

          if (getGroupLessonGroupId(lessonData) !== groupClassId) {
            throw new Error('수업의 그룹 정보가 올바르지 않습니다.')
          }
          if (String(reservationData.studentId || '').trim() !== scopedStudentId) {
            throw new Error('다른 학생의 예약은 수정할 수 없습니다.')
          }
          if (reservationData.status !== 'cancelled') {
            throw new Error('이미 예약됨')
          }

          const bookedCount = Number(lessonData.bookedCount ?? 0)

          transaction.update(reservationRef, {
            status: 'active',
            cancelledAt: null,
            updatedAt: serverTimestamp(),
          })
          transaction.update(lessonRef, {
            bookedCount: bookedCount + 1,
            updatedAt: serverTimestamp(),
          })
        })
      } else {
        await runTransaction(db, async (transaction) => {
          const lessonRef = doc(db, 'groupLessons', lesson.id)
          const reservationRef = doc(db, 'groupLessonReservations', reservationId)
          const lessonSnap = await transaction.get(lessonRef)

          if (!lessonSnap.exists()) throw new Error('수업 일정을 찾을 수 없습니다.')

          const lessonData = { id: lessonSnap.id, ...lessonSnap.data() }

          assertSameAcademy(lessonData, scopedAcademyId, '그룹 수업')
          validateLessonBookingState(lessonData, 'reserve')

          if (getGroupLessonGroupId(lessonData) !== groupClassId) {
            throw new Error('수업의 그룹 정보가 올바르지 않습니다.')
          }

          const bookedCount = Number(lessonData.bookedCount ?? 0)

          transaction.set(reservationRef, {
            academyId: scopedAcademyId,
            lessonId: lesson.id,
            groupClassId,
            studentId: scopedStudentId,
            status: 'active',
            source: 'student',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            cancelledAt: null,
          })
          transaction.update(lessonRef, {
            bookedCount: bookedCount + 1,
            updatedAt: serverTimestamp(),
          })
        })
      }
      logStudentBookingEvent('reserve_success', {
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        studentId: scopedStudentId,
      })
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
    const hasSlotAccess =
      allowedPrivateSlotIds.includes(slot.id) ||
      slotEligibleStudentIds.some((value) => String(value || '').trim() === scopedStudentId)
    const hasTeacherAccess = slotMatchesPrivateTeacherAccess(slot, allowedPrivateTeacherKeys)
    if (!hasTeacherAccess && !hasSlotAccess) {
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

    try {
      setBusyPrivateReservationId(reservationId)
      const reservePrivateLessonSlot = httpsCallable(
        firebaseFunctions,
        'reservePrivateLessonSlot'
      )
      await reservePrivateLessonSlot({
        academyId: scopedAcademyId,
        slotId: slot.id,
      })
      logStudentPrivateBookingEvent('reserve_success', {
        academyId: scopedAcademyId,
        slotId: slot.id,
        studentId: scopedStudentId,
      })
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
      await runTransaction(db, async (transaction) => {
        const lessonRef = doc(db, 'groupLessons', reservation.lessonId)
        const reservationRef = doc(db, 'groupLessonReservations', reservationId)
        const [lessonSnap, reservationSnap] = await Promise.all([
          transaction.get(lessonRef),
          transaction.get(reservationRef),
        ])

        if (!lessonSnap.exists()) throw new Error('수업 일정을 찾을 수 없습니다.')
        if (!reservationSnap.exists()) throw new Error('활성 예약을 찾을 수 없습니다.')

        const lessonData = { id: lessonSnap.id, ...lessonSnap.data() }
        const reservationData = reservationSnap.data()

        assertSameAcademy(lessonData, scopedAcademyId, '그룹 수업')
        validateLessonBookingState(lessonData, 'cancel')

        if (String(reservationData.studentId || '').trim() !== scopedStudentId) {
          throw new Error('다른 학생의 예약은 취소할 수 없습니다.')
        }
        if (reservationData.status !== 'active') {
          throw new Error('활성 예약을 찾을 수 없습니다.')
        }

        const bookedCount = Number(lessonData.bookedCount ?? 0)

        transaction.update(reservationRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        transaction.update(lessonRef, {
          bookedCount: bookedCount - 1,
          updatedAt: serverTimestamp(),
        })
      })
      logStudentBookingEvent('cancel_success', {
        academyId: scopedAcademyId,
        lessonId: reservation.lessonId,
        studentId: scopedStudentId,
      })
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

    try {
      setBusyPrivateReservationId(reservationId)
      const cancelPrivateLessonReservation = httpsCallable(
        firebaseFunctions,
        'cancelPrivateLessonReservation'
      )
      await cancelPrivateLessonReservation({
        academyId: scopedAcademyId,
        slotId: reservation.slotId,
      })
      logStudentPrivateBookingEvent('cancel_success', {
        academyId: scopedAcademyId,
        slotId: reservation.slotId,
        studentId: scopedStudentId,
      })
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
            <p style={{ margin: '8px 0 0 0', opacity: 0.78 }}>
              {currentAcademy?.name || currentAcademyId || '-'} · {user?.email || '-'}
            </p>
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
                    const canReserve =
                      !isReserved &&
                      !busyReservationId &&
                      lesson.isBookable === true &&
                      Number(lesson.bookedCount ?? 0) < Number(lesson.capacity ?? 0)

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
                            <div style={{ marginTop: 6, opacity: 0.68, fontSize: 13 }}>
                              정원 {getLessonCapacityLabel(lesson)}
                              {isReserved ? ' · 예약 완료' : ''}
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
                                {isBusy ? '예약 중...' : '예약'}
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
                내 개인 수강권 선생님의 예약 가능한 시간만 표시됩니다.
              </p>

              {privateAccessError ? <p style={{ color: '#f4a7a7' }}>{privateAccessError}</p> : null}
              {privateSlotsError ? <p style={{ color: '#f4a7a7' }}>{privateSlotsError}</p> : null}
              {!privateAccessResolved || privateAccessLoading || privateSlotsLoading ? (
                <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
              ) : sortedPrivateSlots.length === 0 ? (
                <p style={{ opacity: 0.78, marginBottom: 0 }}>
                  지금 예약 가능한 1:1 수업 시간이 없습니다. 학원 안내 후 다시 확인해 주세요.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                  {sortedPrivateSlots.map((slot) => {
                    const reservation = privateReservationBySlotId.get(slot.id) || null
                    const reservationId = buildPrivateLessonReservationId({
                      academyId: currentAcademyId,
                      slotId: slot.id,
                      studentId: scopedStudentId,
                    })
                    const isBusy = busyPrivateReservationId === reservationId
                    const slotEligibleStudentIds = Array.isArray(slot.eligibleStudentIds)
                      ? slot.eligibleStudentIds
                      : []
                    const isSlotEligible =
                      slotEligibleStudentIds.some(
                        (value) => String(value || '').trim() === scopedStudentId
                      ) || allowedPrivateSlotIds.includes(slot.id)
                    const isTeacherEligible = slotMatchesPrivateTeacherAccess(
                      slot,
                      allowedPrivateTeacherKeys
                    )
                    const hasActivePrivateReservation = reservation?.status === 'active'
                    const canReserve =
                      PRIVATE_SLOT_BOOKING_ENABLED &&
                      privateSlotBookingPilotEnabled &&
                      (isTeacherEligible || isSlotEligible) &&
                      !hasActivePrivateReservation &&
                      !busyPrivateReservationId &&
                      slot.status === 'open'

                    return (
                      <article
                        key={slot.id}
                        data-testid="student-private-slot-card"
                        data-slot-id={slot.id}
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
                            <strong style={{ fontSize: '1rem' }}>{slot.teacher || '1:1 수업'}</strong>
                            <div style={{ marginTop: 6, opacity: 0.74, fontSize: 14 }}>
                              {[slot.date, slot.time].filter(Boolean).join(' · ') || slot.id}
                            </div>
                            <div style={{ marginTop: 6, opacity: 0.68, fontSize: 13 }}>
                              {Number(slot.durationMinutes || 0) || 50}분 · 오프라인 결제
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => reservePrivateSlot(slot)}
                            disabled={!canReserve}
                            data-testid="student-private-slot-reserve-button"
                            style={{
                              padding: '10px 14px',
                              borderRadius: 10,
                              border: '1px solid #48643a',
                              background: '#20351f',
                              color: 'white',
                              cursor: canReserve ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {isBusy ? '예약 중...' : canReserve ? '1:1 수업 예약' : '예약 중지'}
                          </button>
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
                            <strong style={{ fontSize: '1rem' }}>
                              {reservation.teacher || slot?.teacher || '1:1 수업'}
                            </strong>
                            <div style={{ marginTop: 6, opacity: 0.74, fontSize: 14 }}>
                              {[reservation.date || slot?.date, reservation.time || slot?.time]
                                .filter(Boolean)
                                .join(' · ') || `slotId: ${reservation.slotId}`}
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
                          {isActive && PRIVATE_SLOT_BOOKING_ENABLED && privateSlotBookingPilotEnabled ? (
                            <button
                              type="button"
                              onClick={() => cancelPrivateReservation(reservation)}
                              disabled={Boolean(busyPrivateReservationId)}
                              data-testid="student-private-reservation-cancel-button"
                              style={{
                                padding: '10px 14px',
                                borderRadius: 10,
                                border: '1px solid #744242',
                                background: '#4a2a2a',
                                color: 'white',
                                cursor: busyPrivateReservationId ? 'not-allowed' : 'pointer',
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
                              {lesson?.subject || '그룹 수업'}
                            </strong>
                            <div style={{ marginTop: 6, opacity: 0.74, fontSize: 14 }}>
                              {lesson
                                ? [lesson.date, lesson.time].filter(Boolean).join(' · ')
                                : `lessonId: ${reservation.lessonId}`}
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
