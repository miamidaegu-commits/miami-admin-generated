import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
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
  updateDoc,
  where,
  or,
  writeBatch,
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import { useAuth } from './AuthContext'
import {
  SCHOOL_TIME_ZONE,
  addCalendarDaysToYmd,
  countUsedAsOfTodayForStudent,
  formatCreditTransactionActionTypeLabel,
  formatCreditTransactionCreatedAtDisplay,
  formatCreditTransactionDeltaCountDisplay,
  formatDate,
  formatGroupStudentStartDate,
  formatLocalDateToYmd,
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
  getEarliestFutureGroupLessonYmdFromLessons,
  getGroupLessonGroupId,
  getGroupWeeklyClassCountFromWeekdaysDoc,
  getTodayStorageDateString,
  groupLessonNextSortKey,
  GROUP_CLASS_AUTO_LESSON_RANGE_LAST_OFFSET_DAYS,
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
  parseRequiredMinOneIntField,
  parseRequiredNonNegativeIntField,
  parseYmdToLocalDate,
  privateLessonNextSortKey,
  sanitizePhoneForTel,
} from './src/features/dashboard/dashboardViewUtils.js'
import CalendarSection from './src/features/dashboard/sections/CalendarSection.jsx'
import GroupsSection from './src/features/dashboard/sections/GroupsSection.jsx'
import StudentsSection from './src/features/dashboard/sections/StudentsSection.jsx'
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
import useGroupStudentManagementFlow from './src/features/dashboard/hooks/useGroupStudentManagementFlow.js'
import usePrivateLessonFlow, {
  validatePrivateLessonFormFields as validatePrivateLessonFormFieldsShared,
} from './src/features/dashboard/hooks/usePrivateLessonFlow.js'
import useStudentManagementFlow from './src/features/dashboard/hooks/useStudentManagementFlow.js'
import useStudentPackageAdminFlow from './src/features/dashboard/hooks/useStudentPackageAdminFlow.js'
import useStudentPackageFlow from './src/features/dashboard/hooks/useStudentPackageFlow.js'

/** 운영 화면에서는 false 유지. 예전 수업 데이터 일괄 변환이 필요할 때만 true로 잠시 켜세요. */
const ENABLE_LEGACY_LESSON_MIGRATION_BUTTON = false

/** 운영에서는 false. groupClassId 백필 도구 버튼을 켤 때만 true. */
const ENABLE_GROUP_LEGACY_BACKFILL_TOOL = false

const GROUP_BACKFILL_BATCH_SIZE = 400

async function fetchAllDocumentsInCollection(dbInstance, collectionName) {
  const col = collection(dbInstance, collectionName)
  const pageSize = 500
  const out = []
  let lastDoc = null
  while (true) {
    const q = lastDoc
      ? query(col, orderBy(documentId()), startAfter(lastDoc), limit(pageSize))
      : query(col, orderBy(documentId()), limit(pageSize))
    const snap = await getDocs(q)
    if (snap.empty) break
    snap.docs.forEach((d) => out.push(d))
    if (snap.docs.length < pageSize) break
    lastDoc = snap.docs[snap.docs.length - 1]
  }
  return out
}

/** Firestore 기준으로 private 패키지의 usedCount / remainingCount 재계산 */
async function recomputePrivatePackageUsage(packageId) {
  const pid = String(packageId || '').trim()
  if (!pid) return

  const pkgRef = doc(db, 'studentPackages', pid)
  const pkgSnap = await getDoc(pkgRef)
  if (!pkgSnap.exists()) return

  const pkg = pkgSnap.data()
  if (pkg.packageType !== 'private') return

  const packageTeacher = normalizeText(pkg.teacher || '')
  if (!packageTeacher) return

  const snap = await getDocs(
    query(
      collection(db, 'lessons'),
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

  const total = Number(pkg.totalCount ?? 0)
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
 * groupClassId + date + time 기준 중복은 건너뜀. Firestore addDoc 순차 호출.
 */
async function createGroupLessonsInDateRange({
  groupClassId,
  groupClassName,
  teacher,
  time,
  subject,
  weekdays,
  maxStudents,
  startYmd,
  endYmd,
  existingLessons,
}) {
  const weekdaySet = new Set(normalizeGroupWeekdaysFromDoc(weekdays))
  const timeStr = String(time || '').trim()
  const subjectStr = String(subject || '').trim()
  const teacherNorm = normalizeText(teacher || '')
  const capacity = Number(maxStudents)
  const cap = Number.isFinite(capacity) && capacity >= 0 ? capacity : 0

  let created = 0
  let skippedDup = 0

  if (weekdaySet.size === 0 || !timeStr || !subjectStr) return { created, skippedDup }

  const prior = Array.isArray(existingLessons) ? existingLessons : []

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

    await addDoc(collection(db, 'groupLessons'), {
      groupClassId,
      groupClassName: groupClassName || '',
      teacher: teacherNorm,
      date: dateStr,
      time: timeStr,
      subject: subjectStr,
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
  }

  return { created, skippedDup }
}

function areNormalizedGroupWeekdaysEqual(rawA, rawB) {
  const a = normalizeGroupWeekdaysFromDoc(rawA)
  const b = normalizeGroupWeekdaysFromDoc(rawB)
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

function isGroupEditScheduleAffected(group, validated) {
  const g = group || {}
  if (String(g.time || '').trim() !== validated.time) return true
  if (String(g.subject || '').trim() !== validated.subject) return true
  if (!areNormalizedGroupWeekdaysEqual(g.weekdays, validated.weekdays)) return true
  return false
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
  const { user } = useAuth()
  const navigate = useNavigate()
  const [userProfile, setUserProfile] = useState(null)
  const [teacherDirectoryUsers, setTeacherDirectoryUsers] = useState([])
  const [lessons, setLessons] = useState([])
  const [privateStudents, setPrivateStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [migrating, setMigrating] = useState(false)
  const [busyGroupLegacyBackfill, setBusyGroupLegacyBackfill] = useState(false)
  const [busyLessonId, setBusyLessonId] = useState(null)
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
  const [groupModal, setGroupModal] = useState(null)
  const [groupForm, setGroupForm] = useState({
    name: '',
    teacher: '',
    maxStudents: '1',
    startDate: '',
    time: '',
    subject: '',
    weekdays: [],
    recurrenceMode: 'fixedWeekdays',
    rebuildFutureLessons: false,
    rebuildFromDate: '',
  })
  const [groupFormErrors, setGroupFormErrors] = useState({})
  const [selectedGroupClass, setSelectedGroupClass] = useState(null)
  const [groupStudents, setGroupStudents] = useState([])
  const [groupStudentsLoading, setGroupStudentsLoading] = useState(false)
  const [groupStudentAddModalOpen, setGroupStudentAddModalOpen] = useState(false)
  const [groupStudentForm, setGroupStudentForm] = useState({
    packageId: '',
    startDate: '',
  })
  const [groupStudentFormErrors, setGroupStudentFormErrors] = useState({})
  const [busyGroupStudentId, setBusyGroupStudentId] = useState(null)
  const [groupLessons, setGroupLessons] = useState([])

  const [groupLessonsLoading, setGroupLessonsLoading] = useState(false)
  const [studentSummaryGroupStudents, setStudentSummaryGroupStudents] = useState([])
  const [studentSummaryGroupLessons, setStudentSummaryGroupLessons] = useState([])

  const [busyDeletingPrivateLessonId, setBusyDeletingPrivateLessonId] = useState(null)
  const [studentPackages, setStudentPackages] = useState([])

  useEffect(() => {
    if (!user?.uid) return

    const unsubscribeUser = onSnapshot(
      doc(db, 'users', user.uid),
      (snapshot) => {
        setUserProfile(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null)
      },
      (error) => {
        console.error('users 프로필 불러오기 실패:', error)
      }
    )

    return () => unsubscribeUser()
  }, [user])

  useEffect(() => {
    if (userProfile?.role !== 'admin') {
      setTeacherDirectoryUsers([])
      return
    }
    const unsubscribeUsers = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        setTeacherDirectoryUsers(rows)
      },
      (error) => {
        console.error('users 목록 불러오기 실패:', error)
        setTeacherDirectoryUsers([])
      }
    )
    return () => unsubscribeUsers()
  }, [userProfile?.role])

  const teacherSelectOptions = useMemo(() => {
    const map = new Map()
    for (const u of teacherDirectoryUsers) {
      const rawName = String(u?.teacherName || '').trim()
      if (!rawName) continue
      const role = String(u?.role || '').trim().toLowerCase()
      if (!(role === 'teacher' || role === 'admin')) continue
      const value = normalizeText(rawName)
      if (!value) continue
      if (!map.has(value)) map.set(value, { value, label: rawName })
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  }, [teacherDirectoryUsers])

  useEffect(() => {
    if (!user?.uid) {
      setLessons([])
      setPrivateStudents([])
      setLoading(false)
      return
    }
    if (!userProfile?.role) return

    const roleKey = String(userProfile.role).trim().toLowerCase()
    const teacherNameRaw = userProfile.teacherName

    console.log('[Dashboard] userProfile.role (raw):', userProfile.role, 'normalized:', roleKey)

    let lessonsLoaded = false
    let studentsLoaded = false
    let lessonsByTeacherNameRows = []
    let lessonsByLegacyTeacherRows = []

    const markLessonsLoaded = () => {
      lessonsLoaded = true
      if (studentsLoaded) setLoading(false)
    }

    const markStudentsLoaded = () => {
      studentsLoaded = true
      if (lessonsLoaded) setLoading(false)
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

    if (roleKey === 'admin') {
      unsubscribeLessons = onSnapshot(
        collection(db, 'lessons'),
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
        collection(db, 'privateStudents'),
        (snapshot) => {
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          console.log('[Dashboard] privateStudents(admin) snapshot row count:', rows.length)
          setPrivateStudents(rows)
          markStudentsLoaded()
        },
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
      unsubscribeLessons = onSnapshot(
        query(collection(db, 'lessons'), where('teacherName', '==', teacherNameRaw)),
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
        query(collection(db, 'lessons'), where('teacher', '==', teacherNameRaw)),
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
        query(
          collection(db, 'privateStudents'),
          where('teacher', '==', teacherNameRaw)
        ),
        (snapshot) => {
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          console.log('[Dashboard] privateStudents(teacher) snapshot row count:', rows.length)
          setPrivateStudents(rows)
          markStudentsLoaded()
        },
        (error) => {
          console.error('privateStudents(teacher) 불러오기 실패:', error)
          setPrivateStudents([])
          markStudentsLoaded()
        }
      )
    } else {
      setLessons([])
      setLoading(false)
    }

    return () => {
      unsubscribeLessons()
      unsubscribeLessonsLegacy()
      unsubscribeStudents()
    }
  }, [user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    if (!user?.uid) {
      setGroupClasses([])
      setGroupClassesLoading(false)
      return
    }
    if (!userProfile?.role) return

    const role = userProfile.role
    const teacherName = String(userProfile.teacherName ?? '').trim()

    let ref
    if (role === 'admin') {
      ref = collection(db, 'groupClasses')
    } else if (role === 'teacher' && teacherName) {
      ref = query(collection(db, 'groupClasses'), where('teacher', '==', teacherName))
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
  }, [user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    if (!user?.uid) {
      setStudentPackages([])
      return
    }
    if (!userProfile?.role) {
      setStudentPackages([])
      return
    }

    if (userProfile.role === 'admin') {
      const unsubscribe = onSnapshot(
        collection(db, 'studentPackages'),
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
      const q = query(
        collection(db, 'studentPackages'),
        where('teacher', '==', teacherKey)
      )
      const unsubscribe = onSnapshot(
        q,
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

    setStudentPackages([])
  }, [user?.uid, userProfile?.role, userProfile?.teacherName])

  useEffect(() => {
    if (activeSection !== 'groups') {
      setGroupModal(null)
      setGroupFormErrors({})
      setSelectedGroupClass(null)
      setGroupStudentAddModalOpen(false)
      setGroupStudentFormErrors({})
    }
  }, [activeSection])

  useEffect(() => {
    if (!groupModal) return
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setGroupModal(null)
        setGroupFormErrors({})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupModal])

  useEffect(() => {
    if (!selectedGroupClass?.id) {
      setGroupStudents([])
      setGroupStudentsLoading(false)
      return
    }

    setGroupStudentsLoading(true)
    const groupClassId = selectedGroupClass.id
    const q = query(
      collection(db, 'groupStudents'),
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
  }, [selectedGroupClass?.id])

  useEffect(() => {
    if (!selectedGroupClass?.id) return
    const stillThere = groupClasses.some((g) => g.id === selectedGroupClass.id)
    if (!stillThere) setSelectedGroupClass(null)
  }, [groupClasses, selectedGroupClass?.id])

  useEffect(() => {
    if (!groupStudentAddModalOpen) return
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setGroupStudentAddModalOpen(false)
        setGroupStudentFormErrors({})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupStudentAddModalOpen])

  useEffect(() => {
    if (!selectedGroupClass?.id) {
      setGroupLessons([])
      setGroupLessonsLoading(false)
      return
    }

    setGroupLessonsLoading(true)
    const groupClassId = selectedGroupClass.id
    const q = query(
      collection(db, 'groupLessons'),
      or(where('groupClassId', '==', groupClassId), where('groupClassID', '==', groupClassId))
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
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
  }, [selectedGroupClass?.id])

  useEffect(() => {
    if (!user?.uid) {
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
      const unsubGs = onSnapshot(
        collection(db, 'groupStudents'),
        (snapshot) => {
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          setStudentSummaryGroupStudents(rows)
        },
        (error) => {
          console.error('studentSummary groupStudents 불러오기 실패:', error)
          setStudentSummaryGroupStudents([])
        }
      )
      const unsubGl = onSnapshot(
        collection(db, 'groupLessons'),
        (snapshot) => {
          const rows = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          }))
          setStudentSummaryGroupLessons(rows)
        },
        (error) => {
          console.error('studentSummary groupLessons 불러오기 실패:', error)
          setStudentSummaryGroupLessons([])
        }
      )
      return () => {
        unsubGs()
        unsubGl()
      }
    }

    if (role === 'teacher' && teacherName) {
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
          where('groupClassId', 'in', chunk)
        )
        unsubs.push(
          onSnapshot(
            qGs,
            (snapshot) => {
              const m = new Map()
              snapshot.docs.forEach((docItem) => {
                m.set(docItem.id, { id: docItem.id, ...docItem.data() })
              })
              chunkMapsGs.set(chunkIndex, m)
              mergeGs()
            },
            (error) => {
              console.error('studentSummary groupStudents 불러오기 실패:', error)
              chunkMapsGs.set(chunkIndex, new Map())
              mergeGs()
            }
          )
        )

        const qGl = query(
          collection(db, 'groupLessons'),
          or(where('groupClassId', 'in', chunk), where('groupClassID', 'in', chunk))
        )
        unsubs.push(
          onSnapshot(
            qGl,
            (snapshot) => {
              const m = new Map()
              snapshot.docs.forEach((docItem) => {
                m.set(docItem.id, { id: docItem.id, ...docItem.data() })
              })
              chunkMapsGl.set(chunkIndex, m)
              mergeGl()
            },
            (error) => {
              console.error('studentSummary groupLessons 불러오기 실패:', error)
              chunkMapsGl.set(chunkIndex, new Map())
              mergeGl()
            }
          )
        )
      })

      return () => {
        unsubs.forEach((u) => u())
      }
    }

    setStudentSummaryGroupStudents([])
    setStudentSummaryGroupLessons([])
  }, [user?.uid, userProfile?.role, userProfile?.teacherName, groupClasses])

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
    selectedGroupClass,
    groupLessons,
    createGroupLessonsInDateRange,
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
  } = useGroupAttendanceFlow({
    activeSection,
    userProfile,
    groupClasses,
    selectedGroupClass,
    setSelectedGroupClass,
    groupLessons,
    studentSummaryGroupStudents,
    studentPackages,
    addCreditTransaction,
  })

  const {
    sortedGroupClasses,
    sortedGroupStudentsForSelectedClass,
    sortedGroupLessonsForSelectedClass,
    groupStudentEligiblePackages,
    groupLessonSeriesPlannedCount,
    groupLessonForAttendanceModal,
    groupLessonAttendanceModalRows,
    groupStudentSelectedPackagePreview,
  } = useGroupsSectionViewModel({
    groupClasses,
    groupStudents,
    groupLessons,
    selectedGroupClass,
    studentPackages,
    groupStudentForm,
    groupLessonSeriesForm,
    groupLessonSeriesModalOpen,
    groupLessonAttendanceModal,
  })

  const studentsSectionViewModel = useStudentsSectionViewModel({
    privateStudents,
    studentPackages,
    lessons,
    studentSummaryGroupStudents,
    studentSummaryGroupLessons,
    groupClasses,
    userProfile,
  })

  const isAdmin = userProfile?.role === 'admin'
  const canAddStudent = isAdmin || userProfile?.canAddStudent === true
  const canEditStudent = isAdmin || userProfile?.canEditStudent === true
  const canDeleteStudent = isAdmin || userProfile?.canDeleteStudent === true
  const canEditLesson = isAdmin || userProfile?.canEditLesson === true
  const canDeleteLesson = isAdmin || userProfile?.canDeleteLesson === true
  const canManageAttendance = isAdmin || userProfile?.canManageAttendance === true
  const canCreateLessonDirectly = isAdmin || userProfile?.canCreateLessonDirectly === true
  const requiresLessonApproval = userProfile?.requiresLessonApproval === true
  const canUseDirectLessonCreation = canCreateLessonDirectly && !requiresLessonApproval
  const canManageGroupClasses = isAdmin
  const showPrivateLessonAddInCalendar =
    isAdmin ||
    (userProfile?.canCreateLessonDirectly === true &&
      userProfile?.requiresLessonApproval === false)

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
    privateStudents,
    groupClasses,
    studentPackages,
    lessons,
    studentSummaryGroupLessons,
    buildGroupPackageCoverageLessons,
    addCreditTransaction,
    getNextGroupLessonDateYmd,
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
    formatLocalYmd,
    studentDocFieldToYmdString,
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
    closeStudentPackageEditModal,
    submitStudentPackageEditModal,
    endStudentPackage,
    openStudentPackageHistoryModal,
    closeStudentPackageHistoryModal,
  } = useStudentPackageAdminFlow({
    userProfile,
    addCreditTransaction,
    studentDocFieldToYmdString,
  })

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

  const { lessonsCountByDate, displayedLessons } = useCalendarSectionViewModel({
    lessons,
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
      setMigrating(true)

      const snapshot = await getDocs(collection(db, 'lessons'))
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
      setBusyGroupLegacyBackfill(true)

      const glDocs = await fetchAllDocumentsInCollection(db, 'groupLessons')
      const gsDocs = await fetchAllDocumentsInCollection(db, 'groupStudents')

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
    if (!(userProfile?.role === 'admin' || userProfile?.canManageAttendance === true)) {
      alert('출결 관리 권한이 없습니다.')
      return
    }

    const packageId = String(lesson.packageId || '').trim()
    const usePackagePath = Boolean(packageId)

    const studentId = getMatchedStudentId(lesson)
    const resolvedStudentId = String(lesson.studentId || '').trim() || studentId || ''

    if (!usePackagePath && !studentId) {
      alert(
        '이 수업은 학생 정보와 연결되어 있지 않아 차감할 수 없습니다. 관리자에게 문의해 주세요.'
      )
      return
    }

    const currentlyCancelled = Boolean(lesson.isDeductCancelled)
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
      setBusyLessonId(lesson.id)

      const nextLessons = lessons.map((item) =>
        item.id === lesson.id
          ? { ...item, isDeductCancelled: nextCancelled, deductMemo: nextMemo }
          : item
      )

      const batch = writeBatch(db)
      const lessonRef = doc(db, 'lessons', lesson.id)

      if (usePackagePath) {
        const selectedPackage = studentPackages.find((p) => p.id === packageId)
        if (!selectedPackage) {
          alert('연결된 수강권을 찾을 수 없습니다.')
          return
        }
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
        const adminUser = userProfile?.role === 'admin'
        const pkgTeacher = normalizeText(selectedPackage.teacher || '')
        const lessonTeacher = normalizeText(getTeacherName(lesson))
        if (!pkgTeacher || !lessonTeacher || pkgTeacher !== lessonTeacher) {
          alert('수업 담당 선생님과 수강권 담당 선생님이 일치하지 않습니다.')
          return
        }
        if (!adminUser) {
          const myT = normalizeText(userProfile?.teacherName || '')
          if (!myT || pkgTeacher !== myT) {
            alert('본인 담당 수강권만 차감 처리할 수 있습니다.')
            return
          }
        }

        batch.update(lessonRef, {
          isDeductCancelled: nextCancelled,
          deductMemo: nextMemo,
          updatedAt: serverTimestamp(),
        })
      } else {
        const nextAttendanceCount = countUsedAsOfTodayForStudent(
          nextLessons,
          getStudentName(lesson)
        )

        const studentRef = doc(db, 'privateStudents', studentId)

        batch.update(lessonRef, {
          isDeductCancelled: nextCancelled,
          deductMemo: nextMemo,
          updatedAt: serverTimestamp(),
          studentId,
          studentName: getStudentName(lesson),
          teacherName: getTeacherName(lesson),
        })

        batch.update(studentRef, {
          attendanceCount: nextAttendanceCount,
          updatedAt: serverTimestamp(),
        })
      }

      await batch.commit()

      if (usePackagePath) {
        await recomputePrivatePackageUsage(packageId)
        const pkgForLog = studentPackages.find((p) => p.id === packageId)
        if (pkgForLog) {
          const datePart = [lesson.date, lesson.time, lesson.subject]
            .filter(Boolean)
            .join(' ')
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
    if (c <= 0) return '수강권 없음'
    const rem = Number(remainingTotal) || 0
    return `${c}개 / 남은 ${rem}회`
  }

  async function fetchGroupLessonsForClassIdMerge(gid) {
    const id = String(gid || '').trim()
    if (!id) return []
    const [a, b] = await Promise.all([
      getDocs(query(collection(db, 'groupLessons'), where('groupClassId', '==', id))),
      getDocs(query(collection(db, 'groupLessons'), where('groupClassID', '==', id))),
    ])
    const byId = new Map()
    for (const snap of [a, b]) {
      snap.docs.forEach((docItem) => {
        byId.set(docItem.id, { id: docItem.id, ...docItem.data() })
      })
    }
    return Array.from(byId.values())
  }

  async function getNextGroupLessonDateYmd(groupClassId) {
    const gid = String(groupClassId || '').trim()
    if (!gid) return formatLocalYmd(new Date())

    const today = getTodayStorageDateString()

    try {
      const rows = await fetchGroupLessonsForClassIdMerge(gid)
      let best = null
      for (const gl of rows) {
        if (getGroupLessonGroupId(gl) !== gid) continue
        const dateStr = String(gl.date || '').trim()
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
        if (dateStr < today) continue
        if (best === null || dateStr < best) best = dateStr
      }
      if (best) return best
    } catch (error) {
      console.error('다음 수업일 조회 실패:', error)
    }

    return formatLocalYmd(new Date())
  }

  async function addCreditTransaction(payload) {
    try {
      await addDoc(collection(db, 'creditTransactions'), {
        studentId: String(payload.studentId ?? ''),
        studentName: String(payload.studentName ?? ''),
        teacher: String(payload.teacher ?? ''),
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
      })
    } catch (error) {
      console.error('creditTransactions 기록 실패:', error)
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
      setBusyDeletingStudentId(student.id)
      await deleteDoc(doc(db, 'privateStudents', student.id))
    } catch (error) {
      console.error('학생 삭제 실패:', error)
      alert(`학생 삭제 실패: ${error.message}`)
    } finally {
      setBusyDeletingStudentId(null)
    }
  }

  function closeGroupModal() {
    setGroupModal(null)
    setGroupFormErrors({})
  }

  function groupMaxStudentsToFormString(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return '1'
    const i = Math.trunc(n)
    return String(Math.max(1, i))
  }

  function openGroupAddModal() {
    if (userProfile?.role !== 'admin') {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    setGroupForm({
      name: '',
      teacher: '',
      maxStudents: '1',
      startDate: formatLocalDateToYmd(new Date()),
      time: '',
      subject: '',
      weekdays: [],
      recurrenceMode: 'fixedWeekdays',
      rebuildFutureLessons: false,
      rebuildFromDate: '',
    })
    setGroupFormErrors({})
    setGroupModal({ type: 'add' })
  }

  function openGroupEditModal(group) {
    if (userProfile?.role !== 'admin') {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    const todayYmd = getTodayStorageDateString()
    const sel = selectedDateString
    const defaultRebuildFrom =
      sel &&
      /^\d{4}-\d{2}-\d{2}$/.test(sel) &&
      parseYmdToLocalDate(sel) &&
      sel >= todayYmd
        ? sel
        : todayYmd
    setGroupForm({
      name: group.name || '',
      teacher: group.teacher || '',
      maxStudents: groupMaxStudentsToFormString(group.maxStudents),
      startDate: '',
      time: String(group.time || '').trim(),
      subject: String(group.subject || '').trim(),
      weekdays: normalizeGroupWeekdaysFromDoc(group.weekdays),
      recurrenceMode: 'fixedWeekdays',
      rebuildFutureLessons: false,
      rebuildFromDate: defaultRebuildFrom,
    })
    setGroupFormErrors({})
    setGroupModal({ type: 'edit', group })
  }

  function validateGroupFormFields(form, options = {}) {
    const { forNewClass, forEdit } = options
    const errors = {}
    const name = form.name.trim()
    const teacher = form.teacher.trim()
    if (!name) errors.name = '이름을 입력해주세요.'
    if (!teacher) errors.teacher = '선생님 이름을 입력해주세요.'

    const maxStudents = parseRequiredMinOneIntField(form.maxStudents)
    if (!maxStudents.ok) errors.maxStudents = '1 이상의 정수를 입력해주세요.'

    let startDate = ''
    if (forNewClass) {
      startDate = String(form.startDate || '').trim()
      if (!startDate) {
        errors.startDate = '시작일을 선택해주세요.'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        errors.startDate = '시작일 형식이 올바르지 않습니다.'
      } else if (!parseYmdToLocalDate(startDate)) {
        errors.startDate = '유효한 시작일을 선택해주세요.'
      }
    }

    const timeStr = String(form.time || '').trim()
    if (!timeStr) {
      errors.time = '시간을 입력해주세요.'
    } else if (!/^\d{2}:\d{2}$/.test(timeStr)) {
      errors.time = 'HH:mm 형식으로 입력해주세요.'
    } else {
      const [h, m] = timeStr.split(':').map(Number)
      if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
        errors.time = '유효한 시간을 입력해주세요.'
      }
    }

    const subject = String(form.subject || '').trim()
    if (!subject) errors.subject = '과목을 입력해주세요.'

    const weekdays = normalizeGroupWeekdaysFromDoc(
      Array.isArray(form.weekdays) ? form.weekdays : []
    )
    if (weekdays.length === 0) {
      errors.weekdays = '요일을 1개 이상 선택해주세요.'
    }

    const recurrenceMode =
      form.recurrenceMode === 'fixedWeekdays' ? 'fixedWeekdays' : 'fixedWeekdays'

    let rebuildFutureLessons = false
    let rebuildFromDate = ''
    if (forEdit) {
      rebuildFutureLessons = Boolean(form.rebuildFutureLessons)
      if (rebuildFutureLessons) {
        rebuildFromDate = String(form.rebuildFromDate || '').trim()
        if (!rebuildFromDate) {
          errors.rebuildFromDate = '변경 적용 시작일을 선택해주세요.'
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(rebuildFromDate)) {
          errors.rebuildFromDate = '날짜 형식이 올바르지 않습니다.'
        } else if (!parseYmdToLocalDate(rebuildFromDate)) {
          errors.rebuildFromDate = '유효한 날짜를 선택해주세요.'
        }
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      name,
      teacher,
      maxStudents: maxStudents.ok ? maxStudents.value : 1,
      startDate: forNewClass ? startDate : '',
      time: timeStr,
      subject,
      weekdays,
      recurrenceMode,
      rebuildFutureLessons,
      rebuildFromDate,
    }
  }

  async function submitGroupModal() {
    if (!groupModal) return

    const result = validateGroupFormFields(groupForm, {
      forNewClass: groupModal.type === 'add',
      forEdit: groupModal.type === 'edit',
    })
    setGroupFormErrors(result.errors)
    if (!result.valid) return

    const teacherKey = normalizeText(result.teacher)

    const canAutoCreateLessons =
      (userProfile?.role === 'admin' || userProfile?.canCreateLessonDirectly === true) &&
      userProfile?.requiresLessonApproval !== true

    if (groupModal.type === 'add') {
      try {
        setBusyGroupId('__add__')
        const docRef = await addDoc(collection(db, 'groupClasses'), {
          name: result.name,
          teacher: teacherKey,
          maxStudents: result.maxStudents,
          time: result.time,
          subject: result.subject,
          weekdays: result.weekdays,
          recurrenceMode: result.recurrenceMode,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        const newId = docRef.id

        if (
          result.recurrenceMode === 'fixedWeekdays' &&
          canAutoCreateLessons &&
          result.startDate
        ) {
          const endYmd = addCalendarDaysToYmd(
            result.startDate,
            GROUP_CLASS_AUTO_LESSON_RANGE_LAST_OFFSET_DAYS
          )
          if (endYmd) {
            const { created, skippedDup } = await createGroupLessonsInDateRange({
              groupClassId: newId,
              groupClassName: result.name,
              teacher: teacherKey,
              time: result.time,
              subject: result.subject,
              weekdays: result.weekdays,
              maxStudents: result.maxStudents,
              startYmd: result.startDate,
              endYmd,
              existingLessons: groupLessons,
            })
            if (created > 0 || skippedDup > 0) {
              alert(
                `반을 저장했습니다. 약 1년간 수업 일정 ${created}건이 자동으로 만들어졌습니다. (중복 ${skippedDup}건 건너뜀)`
              )
            }
          }
        }

        closeGroupModal()
      } catch (error) {
        console.error('그룹 추가 실패:', error)
        alert(`그룹 추가 실패: ${error.message}`)
      } finally {
        setBusyGroupId(null)
      }
      return
    }

    const { group } = groupModal
    const scheduleAffected = isGroupEditScheduleAffected(group, result)
    try {
      setBusyGroupId(group.id)
      await updateDoc(doc(db, 'groupClasses', group.id), {
        name: result.name,
        teacher: teacherKey,
        maxStudents: result.maxStudents,
        time: result.time,
        subject: result.subject,
        weekdays: result.weekdays,
        recurrenceMode: result.recurrenceMode,
        updatedAt: serverTimestamp(),
      })
      closeGroupModal()
      if (
        scheduleAffected &&
        userProfile?.role === 'admin' &&
        result.rebuildFutureLessons
      ) {
        const fromYmd = String(result.rebuildFromDate || '').trim()
        openPostGroupScheduleRebuildModal({
          groupId: group.id,
          groupName: result.name,
          oldTime: String(group.time || '').trim(),
          oldSubject: String(group.subject || '').trim(),
          oldWeekdays: normalizeGroupWeekdaysFromDoc(group.weekdays),
          newTime: result.time,
          newSubject: result.subject,
          newWeekdays: result.weekdays,
          maxStudents: result.maxStudents,
          teacher: teacherKey,
          requestedFromDate: fromYmd,
        }, fromYmd)
      }
    } catch (error) {
      console.error('그룹 수정 실패:', error)
      alert(`그룹 수정 실패: ${error.message}`)
    } finally {
      setBusyGroupId(null)
    }
  }

  async function handleDeleteGroup(group) {
    if (userProfile?.role !== 'admin') {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    const label = `${group.name || ''} (${group.teacher || ''})`.trim()
    if (!window.confirm(`이 반을 삭제할까요?\n${label}`)) return

    try {
      setBusyGroupId(group.id)
      await deleteDoc(doc(db, 'groupClasses', group.id))
      setSelectedGroupClass((prev) => (prev?.id === group.id ? null : prev))
    } catch (error) {
      console.error('그룹 삭제 실패:', error)
      alert(`그룹 삭제 실패: ${error.message}`)
    } finally {
      setBusyGroupId(null)
    }
  }

  function getGroupStudentDisplayName(row) {
    return row.studentName || row.name || '-'
  }

  function closeGroupStudentAddModal() {
    setGroupStudentAddModalOpen(false)
    setGroupStudentFormErrors({})
  }

  function openGroupStudentAddModal() {
    if (!canAddStudent) {
      alert('학생 추가 권한이 없습니다.')
      return
    }

    setGroupStudentForm({
      packageId: '',
      startDate: '',
    })
    setGroupStudentFormErrors({})
    setGroupStudentAddModalOpen(true)
  }

  function validateGroupStudentFormFields(form) {
    const errors = {}
    const packageId = String(form.packageId || '').trim()
    const adminUi = userProfile?.role === 'admin'
    if (!packageId) {
      errors.packageId = adminUi
        ? '사용할 그룹 수강권을 선택해주세요.'
        : '사용할 등록을 선택해주세요.'
    }

    const dateStr = String(form.startDate || '').trim()
    if (!dateStr) {
      errors.startDate = '시작일을 선택해주세요.'
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      errors.startDate = '시작일 형식이 올바르지 않습니다.'
    } else {
      const [y, mo, d] = dateStr.split('-').map(Number)
      const dt = new Date(y, mo - 1, d)
      if (
        dt.getFullYear() !== y ||
        dt.getMonth() !== mo - 1 ||
        dt.getDate() !== d
      ) {
        errors.startDate = '유효한 날짜를 선택해주세요.'
      }
    }

    let startTimestamp = null
    if (!errors.startDate && dateStr) {
      const [y, mo, d] = dateStr.split('-').map(Number)
      startTimestamp = Timestamp.fromDate(new Date(y, mo - 1, d))
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      packageId,
      startDate: startTimestamp,
    }
  }

  async function submitGroupStudentAdd() {
    if (!selectedGroupClass?.id) return

    if (!canAddStudent) {
      alert('학생 추가 권한이 없습니다.')
      return
    }

    const result = validateGroupStudentFormFields(groupStudentForm)
    setGroupStudentFormErrors(result.errors)
    if (!result.valid || !result.startDate) return

    const adminUi = userProfile?.role === 'admin'
    const selectedPackage = studentPackages.find((p) => p.id === result.packageId)
    if (!selectedPackage) {
      alert(
        adminUi
          ? '등록된 수강권을 찾을 수 없습니다.'
          : '선택한 수업 등록을 찾을 수 없습니다.'
      )
      return
    }
    if (
      selectedPackage.packageType !== 'group' ||
      String(selectedPackage.groupClassId || '') !== String(selectedGroupClass.id) ||
      selectedPackage.status !== 'active'
    ) {
      alert(
        adminUi
          ? '이 그룹에서 사용할 수 없는 수강권입니다.'
          : '이 그룹에서 사용할 수 없는 등록입니다.'
      )
      return
    }

    if (Number(selectedPackage.remainingCount || 0) <= 0) {
      alert(adminUi ? '남은 횟수가 없는 수강권입니다.' : '남은 횟수가 없습니다.')
      return
    }

    const studentId = String(selectedPackage.studentId || '').trim()
    if (!studentId) {
      alert(
        adminUi ? '수강권에 연결된 학생이 없습니다.' : '등록에 학생 연결이 없습니다.'
      )
      return
    }

    if (
      groupStudents.some(
        (gs) =>
          String(gs.studentId || '').trim() === studentId &&
          String(gs.groupClassId || '') === String(selectedGroupClass.id) &&
          String(gs.status || 'active') === 'active'
      )
    ) {
      alert('이미 이 그룹에 등록된 학생입니다.')
      return
    }

    const dateStrYmd = String(groupStudentForm.startDate || '').trim()
    const pkgRegYmd = String(selectedPackage.registrationStartDate || '').trim()
    const extraStartErrors = {}
    if (/^\d{4}-\d{2}-\d{2}$/.test(pkgRegYmd) && dateStrYmd < pkgRegYmd) {
      extraStartErrors.startDate =
        '등록 시작일은 수강권 시작일보다 이를 수 없습니다.'
    }
    if (!extraStartErrors.startDate) {
      const earliestGl = getEarliestFutureGroupLessonYmdFromLessons({
        groupClassId: selectedGroupClass.id,
        groupLessons,
        todayYmd: getTodayStorageDateString(),
      })
      if (/^\d{4}-\d{2}-\d{2}$/.test(earliestGl) && dateStrYmd < earliestGl) {
        extraStartErrors.startDate =
          '등록 시작일은 반의 첫 예정 수업일보다 이를 수 없습니다.'
      }
    }
    if (Object.keys(extraStartErrors).length > 0) {
      setGroupStudentFormErrors(extraStartErrors)
      return
    }

    const studentName = String(selectedPackage.studentName || '').trim() || '-'
    const teacher = normalizeText(
      selectedGroupClass.teacher || selectedPackage.teacher || ''
    )

    try {
      setBusyGroupStudentId('__add__')
      await addDoc(collection(db, 'groupStudents'), {
        groupClassId: selectedGroupClass.id,
        classID: selectedGroupClass.id,
        studentId,
        studentName,
        name: studentName,
        teacher,
        packageId: selectedPackage.id,
        packageType: selectedPackage.packageType,
        paidLessons: Number(selectedPackage.totalCount || 0),
        attendanceCount: Number(selectedPackage.usedCount || 0),
        startDate: result.startDate,
        status: 'active',
        studentStatus: 'active',
        excludedDates: [],
        breakStartDate: '',
        breakEndDate: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      closeGroupStudentAddModal()
    } catch (error) {
      console.error('그룹 학생 추가 실패:', error)
      alert(`그룹 학생 추가 실패: ${error.message}`)
    } finally {
      setBusyGroupStudentId(null)
    }
  }

  async function handleRemoveGroupStudent(row) {
    if (!canDeleteStudent) {
      alert('학생 삭제 권한이 없습니다.')
      return
    }

    const label = getGroupStudentDisplayName(row)
    if (!window.confirm(`이 학생을 이 반에서 제거할까요?\n${label}`)) return

    try {
      setBusyGroupStudentId(row.id)
      await deleteDoc(doc(db, 'groupStudents', row.id))
    } catch (error) {
      console.error('그룹 학생 제거 실패:', error)
      alert(`그룹 학생 제거 실패: ${error.message}`)
    } finally {
      setBusyGroupStudentId(null)
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
      setBusyGroupLessonId(lesson.id)
      await deleteDoc(doc(db, 'groupLessons', lesson.id))
    } catch (error) {
      console.error('그룹 수업 삭제 실패:', error)
      alert(`그룹 수업 삭제 실패: ${error.message}`)
    } finally {
      setBusyGroupLessonId(null)
    }
  }

  const busyStudentId = busyDeletingStudentId || busyStudentFlowId

  const isGroupModalSubmitting =
    Boolean(groupModal) &&
    (groupModal.type === 'add'
      ? busyGroupId === '__add__'
      : busyGroupId === groupModal.group.id)

  const isGroupStudentModalSubmitting = busyGroupStudentId === '__add__'

  const isStudentPackageModalSubmitting = busyStudentPackageSubmit

  console.log('[permission check]', {
    uid: user?.uid,
    role: userProfile?.role,
    teacherName: userProfile?.teacherName,
    canAddStudentRaw: userProfile?.canAddStudent,
    canCreateLessonDirectlyRaw: userProfile?.canCreateLessonDirectly,
    canEditLessonRaw: userProfile?.canEditLesson,
    canDeleteLessonRaw: userProfile?.canDeleteLesson,
    canManageAttendanceRaw: userProfile?.canManageAttendance,
    canEditStudentRaw: userProfile?.canEditStudent,
    canDeleteStudentRaw: userProfile?.canDeleteStudent,
    canAddStudent,
    canCreateLessonDirectly,
    showPrivateLessonAddInCalendar:
      isAdmin ||
      (userProfile?.canCreateLessonDirectly === true &&
        userProfile?.requiresLessonApproval === false),
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
      setBusyDeletingPrivateLessonId(lesson.id)
      await deleteDoc(doc(db, 'lessons', lesson.id))
      if (packageIdBeforeDelete) {
        await recomputePrivatePackageUsage(packageIdBeforeDelete)
      }
    } catch (error) {
      console.error('개인 수업 삭제 실패:', error)
      alert(`개인 수업 삭제 실패: ${error.message}`)
    } finally {
      setBusyDeletingPrivateLessonId(null)
    }
  }

  const calendarSectionProps = {
    month: {
      view: 'month',
      setCalendarMonth,
      calendarMonthLabel,
      calendarDays,
      lessonsCountByDate,
      calendarMonth,
      selectedDate,
      setSelectedDate,
      setShowOnlySelectedDate,
    },
    lessons: {
      view: 'lessons',
      activeSection,
      showOnlySelectedDate,
      selectedDateDisplayString,
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
      getMatchedStudent,
      getMatchedStudentId,
      studentPackages,
      handleDeductionToggle,
      canManageAttendance,
      busyLessonId,
      busyPrivateLessonCrudId,
      busyPrivateLessonAdd,
      openPrivateLessonEditModal,
      handleDeletePrivateLesson,
      canEditLesson,
      canDeleteLesson,
      onOpenCalendarGroupLessonAttendance: openCalendarGroupLessonAttendance,
    },
  }

  const studentsSectionProps = {
    ...studentsSectionViewModel,
    loading,
    privateStudents,
    isAdmin,
    groupClasses,
    studentPackages,
    busyStudentId,
    busyStudentPackageSubmit,
    busyStudentPackageActionId,
    canAddStudent,
    canEditStudent,
    canDeleteStudent,
    openStudentAddModal,
    openStudentEditModal,
    handleDeleteStudent,
    openStudentPackageModal,
    openStudentPackageEditModal,
    endStudentPackage,
    openStudentPackageHistoryModal,
    openStudentPackageReRegisterModal,
    formatStudentFirstRegisteredForTable,
    formatStudentPackageCellSummary,
  }

  const groupsSectionProps = {
    canManageGroupClasses,
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
    canCreateLessonDirectly,
    openGroupLessonSeriesModal,
    isAdmin,
    openGroupLessonPurgeModal,
    busyGroupLessonPurge,
    sortedGroupStudentsForSelectedClass,
    handleRemoveGroupStudent,
    sortedGroupLessonsForSelectedClass,
    busyGroupAttendanceStudentId,
    canManageAttendance,
    openGroupLessonAttendanceModal,
    canEditLesson,
    openGroupLessonEditModal,
    canDeleteLesson,
    handleDeleteGroupLesson,
    getGroupStudentDisplayName,
    openGroupStudentManageModal,
    busyGroupStudentManageId,
    requiresLessonApproval: userProfile?.requiresLessonApproval === true,
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
    sortedGroupClasses,
    nextGroupLessonDateByGroupId,
    studentPackageGroupAutoSummary,
    studentPackageModalActiveSameScopeDuplicates,
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
    busyPostPrivateLessonSchedule,
  }

  const groupModalProps = {
    groupModal,
    groupForm,
    setGroupForm,
    groupFormErrors,
    setGroupFormErrors,
    teacherSelectOptions,
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
    isPastLesson: isPastGroupLesson(groupLessonForAttendanceModal),
    isAdmin,
    busyGroupAttendanceStudentId,
    applyGroupLessonAttendanceDeduction,
    applyGroupLessonAttendanceUndo,
    closeGroupLessonAttendanceModal,
  }

  const privateLessonModalProps = {
    isAdmin,
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
    { key: 'students', label: '학생 관리' },
    { key: 'groups', label: '반 관리' },
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
    : '반 관리'}
</h1>
            <p className="page-sub" data-testid="dashboard-welcome-subtitle">
              {userProfile?.teacherName
                ? `${userProfile.teacherName} 님 환영합니다`
                : `${user?.email || '사용자'} 님, 환영합니다`}
            </p>
          </div>
          </header>

          {activeSection === 'calendar' && (
            <CalendarSection {...calendarSectionProps.month} />
          )}
          {activeSection === 'students' && (
            <StudentsSection {...studentsSectionProps} />
          )}
          {activeSection === 'groups' && (
            <GroupsSection {...groupsSectionProps} />
          )}

        <CalendarSection {...calendarSectionProps.lessons} />

      </main>

      {activeSection === 'students' && studentModal ? (
        <StudentModal {...studentModalProps} />
      ) : null}
      {activeSection === 'students' && isAdmin && postStudentCreateModalStudent ? (
        <PostStudentCreateModal {...postStudentCreateModalProps} />
      ) : null}
      {activeSection === 'students' && studentPackageModalStudent ? (
        <StudentPackageModal {...studentPackageModalProps} />
      ) : null}
      {activeSection === 'students' && isAdmin && studentPackageEditModalPackage ? (
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

      {activeSection === 'groups' && groupModal ? (
        <GroupModal {...groupModalProps} />
      ) : null}

      {activeSection === 'groups' && isAdmin && postGroupScheduleRebuildModalData ? (
        <PostGroupScheduleRebuildModal {...postGroupScheduleRebuildModalProps} />
      ) : null}

      {activeSection === 'groups' &&
      groupStudentAddModalOpen &&
      selectedGroupClass ? (
        <GroupStudentAddModal {...groupStudentAddModalProps} />
      ) : null}

      {activeSection === 'groups' && isAdmin && groupStudentManageModal ? (
        <GroupStudentManageModal {...groupStudentManageModalProps} />
      ) : null}

      {activeSection === 'groups' && groupLessonModal && selectedGroupClass ? (
        <GroupLessonModal {...groupLessonModalProps} />
      ) : null}

      {activeSection === 'groups' && groupLessonSeriesModalOpen && selectedGroupClass ? (
        <GroupLessonSeriesModal {...groupLessonSeriesModalProps} />
      ) : null}

      {activeSection === 'groups' && groupLessonPurgeModalOpen && selectedGroupClass ? (
        <GroupLessonPurgeModal {...groupLessonPurgeModalProps} />
      ) : null}

      {groupLessonAttendanceModal &&
      selectedGroupClass &&
      groupLessonForAttendanceModal ? (
        <GroupLessonAttendanceModal {...groupLessonAttendanceModalProps} />
      ) : null}

      {activeSection === 'calendar' && privateLessonModalOpen ? (
        <PrivateLessonModal {...privateLessonModalProps} />
      ) : null}

      {activeSection === 'calendar' && privateLessonEditModal ? (
        <PrivateLessonEditModal {...privateLessonEditModalProps} />
      ) : null}

    </div>
  )
}
