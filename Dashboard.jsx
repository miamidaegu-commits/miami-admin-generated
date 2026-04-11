import { useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import { useAuth } from './AuthContext'

const SCHOOL_TIME_ZONE = 'Asia/Seoul'

function normalizeText(value = '') {
  return String(value).trim().toLowerCase()
}

function makeStudentKey(name = '', teacher = '') {
  return `${normalizeText(name)}__${normalizeText(teacher)}`
}

function parseLegacyLessonToDate(dateStr, timeStr = '00:00') {
  if (!dateStr) return null

  const [year, month, day] = String(dateStr).split('-').map(Number)
  const [hour = 0, minute = 0] = String(timeStr || '00:00').split(':').map(Number)

  if (!year || !month || !day) return null

  // 현재 브라우저 로컬 시간을 기준으로 Date 생성
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0)
}

function getLessonDate(lesson) {
  if (lesson?.startAt?.toDate) return lesson.startAt.toDate()
  if (lesson?.startAt?.seconds != null) return new Date(lesson.startAt.seconds * 1000)
  return parseLegacyLessonToDate(lesson?.date, lesson?.time)
}

function formatDate(date) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(date)
}

function formatTime(date) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SCHOOL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function getStudentName(lesson) {
  return lesson.studentName || lesson.student || '-'
}

function getTeacherName(lesson) {
  return lesson.teacherName || lesson.teacher || '-'
}

function getTodayStorageDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function getLessonStorageDateString(lesson) {
  if (lesson?.date) return lesson.date

  const d = getLessonDate(lesson)
  if (!d) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function lessonDateInputValue(lesson) {
  const s = getLessonStorageDateString(lesson)
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return ''
}

function lessonTimeInputValue(lesson) {
  const t = String(lesson?.time || '').trim()
  if (/^\d{2}:\d{2}$/.test(t)) return t
  const d = getLessonDate(lesson)
  if (!d) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function validateLessonDateTimeSubject(form) {
  const errors = {}
  const date = String(form.date || '').trim()
  const time = String(form.time || '').trim()
  const subject = String(form.subject || '').trim()

  if (!date) errors.date = '날짜를 선택해주세요.'
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = '날짜 형식이 올바르지 않습니다.'
  if (!time) errors.time = '시간을 선택해주세요.'
  if (time && !/^\d{2}:\d{2}$/.test(time)) errors.time = '시간 형식이 올바르지 않습니다.'
  if (!subject) errors.subject = '과목을 입력해주세요.'

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    date,
    time,
    subject,
  }
}

function countUsedAsOfTodayForStudent(allLessons, targetStudentName) {
  const normStudent = normalizeText(targetStudentName)
  const today = getTodayStorageDateString()

  let usedCount = 0

  for (const item of allLessons) {
    const docName = normalizeText(getStudentName(item))
    const date = getLessonStorageDateString(item)
    const cancelled = Boolean(item.isDeductCancelled)

    if (docName === normStudent && date && date <= today && !cancelled) {
      usedCount += 1
    }
  }

  return usedCount
}

/** 0 이상 정수 문자열만 허용 (앞뒤 공백 제거 후 검사) */
function parseRequiredNonNegativeIntField(raw) {
  const t = String(raw ?? '').trim()
  if (t === '') return { ok: false, value: null }
  if (!/^(0|[1-9]\d*)$/.test(t)) return { ok: false, value: null }
  const value = parseInt(t, 10)
  if (!Number.isFinite(value) || value < 0) return { ok: false, value: null }
  return { ok: true, value }
}

/** 1 이상 정수 (그룹 정원) */
function parseRequiredMinOneIntField(raw) {
  const t = String(raw ?? '').trim()
  if (t === '') return { ok: false, value: null }
  if (!/^(0|[1-9]\d*)$/.test(t)) return { ok: false, value: null }
  const value = parseInt(t, 10)
  if (!Number.isFinite(value) || value < 1) return { ok: false, value: null }
  return { ok: true, value }
}

function getStorageDateStringFromDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function getCalendarDays(baseDate) {
  const firstDayOfMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
  const start = new Date(firstDayOfMonth)
  start.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const d = new Date(start)
    d.setDate(start.getDate() + index)
    return d
  })
}

function isSameStorageDate(a, b) {
  return getStorageDateStringFromDate(a) === getStorageDateStringFromDate(b)
}

function formatGroupStudentStartDate(raw) {
  if (raw == null || raw === '') return '-'
  if (typeof raw?.toDate === 'function') {
    const d = raw.toDate()
    return d ? formatDate(d) : '-'
  }
  if (raw?.seconds != null) {
    return formatDate(new Date(raw.seconds * 1000))
  }
  if (typeof raw === 'string') {
    const parsed = parseLegacyLessonToDate(raw, '00:00')
    return parsed ? formatDate(parsed) : raw
  }
  return '-'
}

const GROUP_RECURRENCE_WEEKDAY_TOGGLES = [
  { value: 2, label: '월' },
  { value: 3, label: '화' },
  { value: 4, label: '수' },
  { value: 5, label: '목' },
  { value: 6, label: '금' },
  { value: 7, label: '토' },
  { value: 1, label: '일' },
]

const GROUP_WEEKDAY_LABELS = {
  1: '일',
  2: '월',
  3: '화',
  4: '수',
  5: '목',
  6: '금',
  7: '토',
}

function normalizeGroupWeekdaysFromDoc(raw) {
  if (!Array.isArray(raw)) return []
  const nums = raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  return [...new Set(nums)].sort((a, b) => a - b)
}

function formatGroupWeekdaysDisplay(nums) {
  const arr = normalizeGroupWeekdaysFromDoc(nums)
  if (arr.length === 0) return ''
  const order = [2, 3, 4, 5, 6, 7, 1]
  const sorted = [...arr].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return sorted.map((d) => GROUP_WEEKDAY_LABELS[d] || String(d)).join(', ')
}

/** JS Date.getDay() (0=일) → groupClasses.weekdays 코드 (1=일 … 7=토) */
function jsDateToGroupWeekdayCode(date) {
  const day = date.getDay()
  return day === 0 ? 1 : day + 1
}

function parseYmdToLocalDate(ymd) {
  const [y, mo, d] = String(ymd).split('-').map(Number)
  if (!y || !mo || !d) return null
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt
}

function formatLocalDateToYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function* iterateYmdRangeInclusive(startYmd, endYmd) {
  const start = parseYmdToLocalDate(startYmd)
  const end = parseYmdToLocalDate(endYmd)
  if (!start || !end || start > end) return
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  while (cur.getTime() <= endTime) {
    yield formatLocalDateToYmd(cur)
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
  }
}

function countWeekdayHitsInRange(startYmd, endYmd, weekdaySet) {
  if (!weekdaySet || weekdaySet.size === 0) return 0
  let n = 0
  for (const ymd of iterateYmdRangeInclusive(startYmd, endYmd)) {
    const dt = parseYmdToLocalDate(ymd)
    if (!dt) continue
    if (weekdaySet.has(jsDateToGroupWeekdayCode(dt))) n += 1
  }
  return n
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [userProfile, setUserProfile] = useState(null)
  const [lessons, setLessons] = useState([])
  const [privateStudents, setPrivateStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [migrating, setMigrating] = useState(false)
  const [busyLessonId, setBusyLessonId] = useState(null)
  const [busyStudentId, setBusyStudentId] = useState(null)
  const [studentModal, setStudentModal] = useState(null)
  const [studentForm, setStudentForm] = useState({
    name: '',
    teacher: '',
    paidLessons: '0',
    attendanceCount: '0',
  })
  const [studentFormErrors, setStudentFormErrors] = useState({})
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
    time: '',
    subject: '',
    weekdays: [],
    recurrenceMode: 'fixedWeekdays',
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
  const sortedGroupLessonsForSelectedClass = useMemo(() => {
    return [...groupLessons].sort((a, b) => {
      const aKey = `${a.date || ''} ${a.time || ''}`
      const bKey = `${b.date || ''} ${b.time || ''}`
      return aKey.localeCompare(bKey)
    })
  }, [groupLessons])

  const [groupLessonsLoading, setGroupLessonsLoading] = useState(false)
  const [groupLessonModal, setGroupLessonModal] = useState(null)
  const [groupLessonForm, setGroupLessonForm] = useState({
    date: '',
    time: '',
    subject: '',
  })
  const [groupLessonFormErrors, setGroupLessonFormErrors] = useState({})
  const [busyGroupLessonId, setBusyGroupLessonId] = useState(null)
  const [groupLessonSeriesModalOpen, setGroupLessonSeriesModalOpen] = useState(false)
  const [groupLessonSeriesForm, setGroupLessonSeriesForm] = useState({
    startDate: '',
    endDate: '',
  })
  const [groupLessonSeriesFormErrors, setGroupLessonSeriesFormErrors] = useState({})
  const [busyGroupLessonSeries, setBusyGroupLessonSeries] = useState(false)

  const groupLessonSeriesPlannedCount = useMemo(() => {
    if (!groupLessonSeriesModalOpen || !selectedGroupClass) return null
    const weekdaySet = new Set(normalizeGroupWeekdaysFromDoc(selectedGroupClass.weekdays))
    if (weekdaySet.size === 0) return null
    const s = String(groupLessonSeriesForm.startDate || '').trim()
    const e = String(groupLessonSeriesForm.endDate || '').trim()
    if (!s || !e) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return null
    const ds = parseYmdToLocalDate(s)
    const de = parseYmdToLocalDate(e)
    if (!ds || !de || ds > de) return null
    return countWeekdayHitsInRange(s, e, weekdaySet)
  }, [
    groupLessonSeriesModalOpen,
    selectedGroupClass,
    groupLessonSeriesForm.startDate,
    groupLessonSeriesForm.endDate,
  ])

  const [privateLessonModalOpen, setPrivateLessonModalOpen] = useState(false)
  const [privateLessonForm, setPrivateLessonForm] = useState({
    studentId: '',
    date: '',
    time: '',
    subject: '',
  })
  const [privateLessonFormErrors, setPrivateLessonFormErrors] = useState({})
  const [busyPrivateLessonAdd, setBusyPrivateLessonAdd] = useState(false)
  const [privateLessonEditModal, setPrivateLessonEditModal] = useState(null)
  const [privateLessonEditForm, setPrivateLessonEditForm] = useState({
    date: '',
    time: '',
    subject: '',
  })
  const [privateLessonEditFormErrors, setPrivateLessonEditFormErrors] = useState({})
  const [busyPrivateLessonCrudId, setBusyPrivateLessonCrudId] = useState(null)
  const [studentPackages, setStudentPackages] = useState([])
  const [studentPackageModalStudent, setStudentPackageModalStudent] = useState(null)
  const [studentPackageForm, setStudentPackageForm] = useState({
    packageType: 'private',
    title: '',
    totalCount: '1',
    groupClassId: '',
    expiresAt: '',
    amountPaid: '',
    memo: '',
  })
  const [studentPackageFormErrors, setStudentPackageFormErrors] = useState({})
  const [busyStudentPackageSubmit, setBusyStudentPackageSubmit] = useState(false)

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
    if (activeSection !== 'students') {
      setStudentModal(null)
      setStudentFormErrors({})
      setStudentPackageModalStudent(null)
      setStudentPackageFormErrors({})
    }
  }, [activeSection])

  useEffect(() => {
    if (!studentModal) return
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setStudentModal(null)
        setStudentFormErrors({})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [studentModal])

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
    if (!studentPackageModalStudent) return
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setStudentPackageModalStudent(null)
        setStudentPackageFormErrors({})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [studentPackageModalStudent])

  useEffect(() => {
    if (activeSection !== 'groups') {
      setGroupModal(null)
      setGroupFormErrors({})
      setSelectedGroupClass(null)
      setGroupStudentAddModalOpen(false)
      setGroupStudentFormErrors({})
      setGroupLessonModal(null)
      setGroupLessonFormErrors({})
      setGroupLessonSeriesModalOpen(false)
      setGroupLessonSeriesFormErrors({})
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
    if (!groupLessonSeriesModalOpen) return
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setGroupLessonSeriesModalOpen(false)
        setGroupLessonSeriesFormErrors({})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupLessonSeriesModalOpen])

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
      where('groupClassId', '==', groupClassId)
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
    if (!groupLessonModal) return
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setGroupLessonModal(null)
        setGroupLessonFormErrors({})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupLessonModal])

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

  const groupStudentEligiblePackages = useMemo(() => {
    const gid = selectedGroupClass?.id
    if (!gid) return []
    return studentPackages
      .filter((p) => {
        if (p.packageType !== 'group') return false
        if (String(p.groupClassId || '') !== String(gid)) return false
        if (p.status !== 'active') return false
        if (Number(p.remainingCount || 0) <= 0) return false
        return true
      })
      .sort((a, b) => {
        const byStudent = String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ko')
        if (byStudent !== 0) return byStudent
        return String(a.title || '').localeCompare(String(b.title || ''), 'ko')
      })
  }, [studentPackages, selectedGroupClass?.id])

  const sortedPrivateStudents = useMemo(() => {
    return [...privateStudents].sort((a, b) => {
      const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
      if (byName !== 0) return byName
      return String(a.teacher || '').localeCompare(String(b.teacher || ''), 'ko')
    })
  }, [privateStudents])

  const studentFormRemainingPreview = useMemo(() => {
    const paidParsed = parseRequiredNonNegativeIntField(studentForm.paidLessons)
    const attParsed = parseRequiredNonNegativeIntField(studentForm.attendanceCount)
    if (!paidParsed.ok || !attParsed.ok) return null
    return paidParsed.value - attParsed.value
  }, [studentForm.paidLessons, studentForm.attendanceCount])

  const sortedLessons = useMemo(() => {
    return [...lessons].sort((a, b) => {
      const aDate = getLessonDate(a)
      const bDate = getLessonDate(b)

      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1

      return aDate.getTime() - bDate.getTime()
    })
  }, [lessons])

  const visibleLessons = useMemo(() => {
    if (userProfile?.role === 'teacher' && userProfile?.teacherName) {
      const myTeacherName = normalizeText(userProfile.teacherName)
      return sortedLessons.filter(
        (lesson) => normalizeText(getTeacherName(lesson)) === myTeacherName
      )
    }

    return sortedLessons
  }, [sortedLessons, userProfile])

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

  const displayedLessons = useMemo(() => {
    if (showOnlySelectedDate) {
      return visibleLessons.filter(
        (lesson) => getLessonStorageDateString(lesson) === selectedDateString
      )
    }

    return visibleLessons
  }, [showOnlySelectedDate, visibleLessons, selectedDateString])

  const lessonsCountByDate = useMemo(() => {
    const map = new Map()

    visibleLessons.forEach((lesson) => {
      const dateKey = getLessonStorageDateString(lesson)
      if (!dateKey) return
      map.set(dateKey, (map.get(dateKey) || 0) + 1)
    })

    return map
  }, [visibleLessons])

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

  const sortedGroupClasses = useMemo(() => {
    return [...groupClasses].sort((a, b) => {
      const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
      if (byName !== 0) return byName
      return String(a.teacher || '').localeCompare(String(b.teacher || ''), 'ko')
    })
  }, [groupClasses])

  const sortedGroupStudentsForSelectedClass = useMemo(() => {
    return [...groupStudents].sort((a, b) =>
      String(a.studentName || a.name || '').localeCompare(
        String(b.studentName || b.name || ''),
        'ko'
      )
    )
  }, [groupStudents])

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
      alert('관리자만 lesson migration을 실행할 수 있습니다.')
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
        alert('변환할 lessons가 없습니다. 이미 startAt / studentId가 들어가 있을 가능성이 큽니다.')
        return
      }

      await batch.commit()
      alert(`lessons ${changedCount}개를 변환했습니다.`)
    } catch (error) {
      console.error('lesson migration 실패:', error)
      alert(`lesson migration 실패: ${error.message}`)
    } finally {
      setMigrating(false)
    }
  }

  async function handleDeductionToggle(lesson) {
    if (!(userProfile?.role === 'admin' || userProfile?.canManageAttendance === true)) {
      alert('출결 관리 권한이 없습니다.')
      return
    }

    const studentId = getMatchedStudentId(lesson)

    if (!studentId) {
      alert('이 lesson은 studentId 연결이 없습니다. 먼저 "기존 lessons를 Timestamp + studentId로 변환"을 눌러주세요.')
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

      const nextAttendanceCount = countUsedAsOfTodayForStudent(
        nextLessons,
        getStudentName(lesson)
      )

      const batch = writeBatch(db)
      const lessonRef = doc(db, 'lessons', lesson.id)
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

      await batch.commit()
    } catch (error) {
      console.error('차감 처리 실패:', error)
      alert(`차감 처리 실패: ${error.message}`)
    } finally {
      setBusyLessonId(null)
    }
  }

  function closeStudentModal() {
    setStudentModal(null)
    setStudentFormErrors({})
  }

  function studentFieldToFormIntString(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return '0'
    const i = Math.trunc(n)
    return String(Math.max(0, i))
  }

  function openStudentAddModal() {
    if (!(userProfile?.role === 'admin' || userProfile?.canAddStudent === true)) {
      alert('학생 추가 권한이 없습니다.')
      return
    }

    setStudentForm({
      name: '',
      teacher:
        userProfile?.role === 'admin'
          ? ''
          : normalizeText(userProfile?.teacherName || ''),
      paidLessons: '0',
      attendanceCount: '0',
    })
    setStudentFormErrors({})
    setStudentModal({ type: 'add' })
  }

  function openStudentEditModal(student) {
    if (!(userProfile?.role === 'admin' || userProfile?.canEditStudent === true)) {
      alert('학생 수정 권한이 없습니다.')
      return
    }

    setStudentForm({
      name: student.name || '',
      teacher:
        userProfile?.role === 'admin'
          ? student.teacher || ''
          : normalizeText(userProfile?.teacherName || ''),
      paidLessons: studentFieldToFormIntString(student.paidLessons),
      attendanceCount: studentFieldToFormIntString(student.attendanceCount),
    })
    setStudentFormErrors({})
    setStudentModal({ type: 'edit', student })
  }

  function validateStudentFormFields(form) {
    const errors = {}
    const name = form.name.trim()
    const teacher = form.teacher.trim()
    if (!name) errors.name = '이름을 입력해주세요.'
    if (!teacher) errors.teacher = '선생님 이름을 입력해주세요.'

    const paid = parseRequiredNonNegativeIntField(form.paidLessons)
    if (!paid.ok) errors.paidLessons = '0 이상의 정수를 입력해주세요.'

    const att = parseRequiredNonNegativeIntField(form.attendanceCount)
    if (!att.ok) errors.attendanceCount = '0 이상의 정수를 입력해주세요.'

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      name,
      teacher,
      paidLessons: paid.ok ? paid.value : 0,
      attendanceCount: att.ok ? att.value : 0,
    }
  }

  async function submitStudentModal() {
    if (!studentModal) return

    const result = validateStudentFormFields(studentForm)
    setStudentFormErrors(result.errors)
    if (!result.valid) return

    const teacherStored = isAdmin
      ? normalizeText(result.teacher)
      : normalizeText(userProfile?.teacherName)

    if (studentModal.type === 'add') {
      try {
        setBusyStudentId('__add__')
        await addDoc(collection(db, 'privateStudents'), {
          name: result.name,
          teacher: teacherStored,
          paidLessons: result.paidLessons,
          attendanceCount: result.attendanceCount,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        closeStudentModal()
      } catch (error) {
        console.error('학생 추가 실패:', error)
        alert(`학생 추가 실패: ${error.message}`)
      } finally {
        setBusyStudentId(null)
      }
      return
    }

    const { student } = studentModal
    try {
      setBusyStudentId(student.id)
      await updateDoc(doc(db, 'privateStudents', student.id), {
        name: result.name,
        teacher: teacherStored,
        paidLessons: result.paidLessons,
        attendanceCount: result.attendanceCount,
        updatedAt: serverTimestamp(),
      })
      closeStudentModal()
    } catch (error) {
      console.error('학생 수정 실패:', error)
      alert(`학생 수정 실패: ${error.message}`)
    } finally {
      setBusyStudentId(null)
    }
  }

  function closeStudentPackageModal() {
    setStudentPackageModalStudent(null)
    setStudentPackageFormErrors({})
  }

  function openStudentPackageModal(student) {
    if (userProfile?.role !== 'admin') return
    setStudentPackageModalStudent(student)
    setStudentPackageForm({
      packageType: 'private',
      title: '',
      totalCount: '1',
      groupClassId: '',
      expiresAt: '',
      amountPaid: '',
      memo: '',
    })
    setStudentPackageFormErrors({})
  }

  function validateStudentPackageFormFields(form) {
    const errors = {}
    const title = String(form.title || '').trim()
    if (!title) errors.title = '패키지 제목을 입력해주세요.'

    const totalParsed = parseRequiredMinOneIntField(form.totalCount)
    if (!totalParsed.ok) errors.totalCount = '1 이상의 정수를 입력해주세요.'

    const packageType = form.packageType
    let groupClassId = String(form.groupClassId || '').trim()
    if (packageType === 'group' || packageType === 'openGroup') {
      if (!groupClassId) errors.groupClassId = '그룹을 선택해주세요.'
    } else {
      groupClassId = ''
    }

    let expiresAtTs = null
    const expStr = String(form.expiresAt || '').trim()
    if (expStr) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expStr)) {
        errors.expiresAt = '날짜 형식이 올바르지 않습니다.'
      } else {
        const [y, mo, d] = expStr.split('-').map(Number)
        const dt = new Date(y, mo - 1, d)
        if (
          dt.getFullYear() !== y ||
          dt.getMonth() !== mo - 1 ||
          dt.getDate() !== d
        ) {
          errors.expiresAt = '유효한 날짜를 선택해주세요.'
        } else {
          expiresAtTs = Timestamp.fromDate(new Date(y, mo - 1, d))
        }
      }
    }

    let amountPaid = 0
    const amountRaw = String(form.amountPaid ?? '').trim()
    if (amountRaw !== '') {
      const n = Number(amountRaw)
      if (!Number.isFinite(n) || n < 0) {
        errors.amountPaid = '0 이상의 숫자를 입력해주세요.'
      } else {
        amountPaid = n
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      title,
      totalCount: totalParsed.ok ? totalParsed.value : 1,
      packageType,
      groupClassId,
      expiresAt: expiresAtTs,
      amountPaid,
      memo: String(form.memo || '').trim(),
    }
  }

  async function submitStudentPackageModal() {
    if (!studentPackageModalStudent) return
    if (userProfile?.role !== 'admin') {
      alert('관리자만 패키지를 추가할 수 있습니다.')
      return
    }

    const result = validateStudentPackageFormFields(studentPackageForm)
    setStudentPackageFormErrors(result.errors)
    if (!result.valid) return

    const st = studentPackageModalStudent
    const studentId = st.id
    const studentName = String(st.name || '').trim() || '-'

    let teacher = ''
    let groupClassId = null
    let groupClassName = null

    if (result.packageType === 'private') {
      teacher = normalizeText(st.teacher || '')
    } else if (result.packageType === 'group' || result.packageType === 'openGroup') {
      const g = groupClasses.find((gc) => gc.id === result.groupClassId)
      if (!g) {
        setStudentPackageFormErrors((prev) => ({
          ...prev,
          groupClassId: '선택한 그룹을 찾을 수 없습니다.',
        }))
        return
      }
      teacher = normalizeText(g.teacher || '')
      groupClassId = g.id
      groupClassName = g.name || null
    }

    try {
      setBusyStudentPackageSubmit(true)
      await addDoc(collection(db, 'studentPackages'), {
        studentId,
        studentName,
        teacher,
        packageType: result.packageType,
        groupClassId,
        groupClassName,
        title: result.title,
        totalCount: result.totalCount,
        usedCount: 0,
        remainingCount: result.totalCount,
        status: 'active',
        expiresAt: result.expiresAt,
        amountPaid: result.amountPaid,
        memo: result.memo,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      closeStudentPackageModal()
    } catch (error) {
      console.error('학생 패키지 추가 실패:', error)
      alert(`학생 패키지 추가 실패: ${error.message}`)
    } finally {
      setBusyStudentPackageSubmit(false)
    }
  }

  async function handleDeleteStudent(student) {
    if (!(userProfile?.role === 'admin' || userProfile?.canDeleteStudent === true)) {
      alert('학생 삭제 권한이 없습니다.')
      return
    }

    const label = `${student.name || ''} (${student.teacher || ''})`.trim()
    if (!window.confirm(`이 학생을 삭제할까요?\n${label}`)) return

    try {
      setBusyStudentId(student.id)
      await deleteDoc(doc(db, 'privateStudents', student.id))
    } catch (error) {
      console.error('학생 삭제 실패:', error)
      alert(`학생 삭제 실패: ${error.message}`)
    } finally {
      setBusyStudentId(null)
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
      time: '',
      subject: '',
      weekdays: [],
      recurrenceMode: 'fixedWeekdays',
    })
    setGroupFormErrors({})
    setGroupModal({ type: 'add' })
  }

  function openGroupEditModal(group) {
    if (userProfile?.role !== 'admin') {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    setGroupForm({
      name: group.name || '',
      teacher: group.teacher || '',
      maxStudents: groupMaxStudentsToFormString(group.maxStudents),
      time: String(group.time || '').trim(),
      subject: String(group.subject || '').trim(),
      weekdays: normalizeGroupWeekdaysFromDoc(group.weekdays),
      recurrenceMode: 'fixedWeekdays',
    })
    setGroupFormErrors({})
    setGroupModal({ type: 'edit', group })
  }

  function validateGroupFormFields(form) {
    const errors = {}
    const name = form.name.trim()
    const teacher = form.teacher.trim()
    if (!name) errors.name = '이름을 입력해주세요.'
    if (!teacher) errors.teacher = '선생님 이름을 입력해주세요.'

    const maxStudents = parseRequiredMinOneIntField(form.maxStudents)
    if (!maxStudents.ok) errors.maxStudents = '1 이상의 정수를 입력해주세요.'

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

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      name,
      teacher,
      maxStudents: maxStudents.ok ? maxStudents.value : 1,
      time: timeStr,
      subject,
      weekdays,
      recurrenceMode,
    }
  }

  async function submitGroupModal() {
    if (!groupModal) return

    const result = validateGroupFormFields(groupForm)
    setGroupFormErrors(result.errors)
    if (!result.valid) return

    const teacherKey = normalizeText(result.teacher)

    if (groupModal.type === 'add') {
      try {
        setBusyGroupId('__add__')
        await addDoc(collection(db, 'groupClasses'), {
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
    if (!packageId) errors.packageId = '그룹 패키지를 선택해주세요.'

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

    const selectedPackage = studentPackages.find((p) => p.id === result.packageId)
    if (!selectedPackage) {
      alert('선택한 패키지를 찾을 수 없습니다.')
      return
    }
    if (
      selectedPackage.packageType !== 'group' ||
      String(selectedPackage.groupClassId || '') !== String(selectedGroupClass.id) ||
      selectedPackage.status !== 'active'
    ) {
      alert('이 그룹에서 사용할 수 없는 패키지입니다.')
      return
    }

    if (Number(selectedPackage.remainingCount || 0) <= 0) {
      alert('남은 횟수가 없는 패키지입니다.')
      return
    }

    const studentId = String(selectedPackage.studentId || '').trim()
    if (!studentId) {
      alert('패키지에 studentId가 없습니다.')
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

  function closeGroupLessonModal() {
    setGroupLessonModal(null)
    setGroupLessonFormErrors({})
  }

  function openGroupLessonAddModal() {
    const canCreateDirectly =
      userProfile?.role === 'admin' || userProfile?.canCreateLessonDirectly === true
    const requiresApproval = userProfile?.requiresLessonApproval === true

    if (!canCreateDirectly || requiresApproval) {
      alert('직접 수업 생성 권한이 없거나 승인 절차가 필요합니다.')
      return
    }

    setGroupLessonForm({ date: '', time: '', subject: '' })
    setGroupLessonFormErrors({})
    setGroupLessonModal({ type: 'add' })
  }

  function openGroupLessonEditModal(lesson) {
    if (!(userProfile?.role === 'admin' || userProfile?.canEditLesson === true)) {
      alert('수업 수정 권한이 없습니다.')
      return
    }

    setGroupLessonForm({
      date: lesson.date || '',
      time: lesson.time || '',
      subject: lesson.subject || '',
    })
    setGroupLessonFormErrors({})
    setGroupLessonModal({ type: 'edit', lesson })
  }

  function validateGroupLessonFormFields(form) {
    const errors = {}
    const date = String(form.date || '').trim()
    const time = String(form.time || '').trim()
    const subject = String(form.subject || '').trim()

    if (!date) errors.date = '날짜를 선택해주세요.'
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = '날짜 형식이 올바르지 않습니다.'

    if (!time) errors.time = '시간을 선택해주세요.'
    if (time && !/^\d{2}:\d{2}$/.test(time)) errors.time = '시간 형식이 올바르지 않습니다.'

    if (!subject) errors.subject = '과목을 입력해주세요.'

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      date,
      time,
      subject,
    }
  }

  async function submitGroupLessonModal() {
    if (!selectedGroupClass?.id) return
    if (!groupLessonModal) return

    const result = validateGroupLessonFormFields(groupLessonForm)
    setGroupLessonFormErrors(result.errors)
    if (!result.valid) return

    if (groupLessonModal.type === 'add') {
      try {
        setBusyGroupLessonId('__add__')
        await addDoc(collection(db, 'groupLessons'), {
          groupClassId: selectedGroupClass.id,
          groupClassName: selectedGroupClass.name || '',
          teacher: selectedGroupClass.teacher || '',
          date: result.date,
          time: result.time,
          subject: result.subject,
          completed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        closeGroupLessonModal()
      } catch (error) {
        console.error('그룹 수업 추가 실패:', error)
        alert(`그룹 수업 추가 실패: ${error.message}`)
      } finally {
        setBusyGroupLessonId(null)
      }
      return
    }

    const { lesson } = groupLessonModal
    try {
      setBusyGroupLessonId(lesson.id)
      await updateDoc(doc(db, 'groupLessons', lesson.id), {
        groupClassId: selectedGroupClass.id,
        groupClassName: selectedGroupClass.name || '',
        teacher: selectedGroupClass.teacher || '',
        date: result.date,
        time: result.time,
        subject: result.subject,
        updatedAt: serverTimestamp(),
      })
      closeGroupLessonModal()
    } catch (error) {
      console.error('그룹 수업 수정 실패:', error)
      alert(`그룹 수업 수정 실패: ${error.message}`)
    } finally {
      setBusyGroupLessonId(null)
    }
  }

  function closeGroupLessonSeriesModal() {
    setGroupLessonSeriesModalOpen(false)
    setGroupLessonSeriesFormErrors({})
  }

  function openGroupLessonSeriesModal() {
    const canCreateDirectly =
      userProfile?.role === 'admin' || userProfile?.canCreateLessonDirectly === true
    const requiresApproval = userProfile?.requiresLessonApproval === true

    if (!canCreateDirectly || requiresApproval) {
      alert('직접 수업 생성 권한이 없거나 승인 절차가 필요합니다.')
      return
    }

    if (!selectedGroupClass?.id) return

    const wd = normalizeGroupWeekdaysFromDoc(selectedGroupClass.weekdays)
    const timeStr = String(selectedGroupClass.time || '').trim()
    const subjectStr = String(selectedGroupClass.subject || '').trim()
    if (wd.length === 0 || !timeStr || !subjectStr) {
      alert(
        '반에 요일(weekdays)·시간(time)·과목(subject)이 모두 설정되어 있어야 수업 일정을 만들 수 있습니다.'
      )
      return
    }

    setGroupLessonSeriesForm({ startDate: '', endDate: '' })
    setGroupLessonSeriesFormErrors({})
    setGroupLessonSeriesModalOpen(true)
  }

  function validateGroupLessonSeriesFormFields(form) {
    const errors = {}
    const startDate = String(form.startDate || '').trim()
    const endDate = String(form.endDate || '').trim()

    if (!startDate) errors.startDate = '시작일을 선택해주세요.'
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) errors.startDate = '시작일 형식이 올바르지 않습니다.'
    else if (!parseYmdToLocalDate(startDate)) errors.startDate = '유효한 시작일을 선택해주세요.'

    if (!endDate) errors.endDate = '종료일을 선택해주세요.'
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) errors.endDate = '종료일 형식이 올바르지 않습니다.'
    else if (!parseYmdToLocalDate(endDate)) errors.endDate = '유효한 종료일을 선택해주세요.'

    if (!errors.startDate && !errors.endDate && startDate && endDate) {
      const ds = parseYmdToLocalDate(startDate)
      const de = parseYmdToLocalDate(endDate)
      if (ds && de && ds > de) {
        errors.endDate = '종료일은 시작일 이후여야 합니다.'
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      startDate,
      endDate,
    }
  }

  async function submitGroupLessonSeriesModal() {
    if (!selectedGroupClass?.id) return

    const canCreateDirectly =
      userProfile?.role === 'admin' || userProfile?.canCreateLessonDirectly === true
    const requiresApproval = userProfile?.requiresLessonApproval === true
    if (!canCreateDirectly || requiresApproval) {
      alert('직접 수업 생성 권한이 없거나 승인 절차가 필요합니다.')
      return
    }

    const result = validateGroupLessonSeriesFormFields(groupLessonSeriesForm)
    setGroupLessonSeriesFormErrors(result.errors)
    if (!result.valid) return

    const gc = selectedGroupClass
    const weekdaySet = new Set(normalizeGroupWeekdaysFromDoc(gc.weekdays))
    const timeStr = String(gc.time || '').trim()
    const subjectStr = String(gc.subject || '').trim()
    if (weekdaySet.size === 0 || !timeStr || !subjectStr) {
      alert('반 설정(요일·시간·과목)을 확인해주세요.')
      return
    }

    const teacherNorm = normalizeText(gc.teacher || '')
    const capacity = Number(gc.maxStudents)
    const cap = Number.isFinite(capacity) && capacity >= 0 ? capacity : 0

    let created = 0
    let skippedDup = 0

    try {
      setBusyGroupLessonSeries(true)
      for (const dateStr of iterateYmdRangeInclusive(result.startDate, result.endDate)) {
        const dt = parseYmdToLocalDate(dateStr)
        if (!dt || !weekdaySet.has(jsDateToGroupWeekdayCode(dt))) continue

        const dup = groupLessons.some(
          (gl) =>
            String(gl.groupClassId || '') === String(gc.id) &&
            String(gl.date || '') === dateStr &&
            String(gl.time || '').trim() === timeStr
        )
        if (dup) {
          skippedDup += 1
          continue
        }

        await addDoc(collection(db, 'groupLessons'), {
          groupClassId: gc.id,
          groupClassName: gc.name || '',
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
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        created += 1
      }

      alert(`수업 일정 생성 완료: ${created}건 생성, 중복 건너뜀 ${skippedDup}건`)
      closeGroupLessonSeriesModal()
    } catch (error) {
      console.error('수업 일정 생성 실패:', error)
      alert(`수업 일정 생성 실패: ${error.message}`)
    } finally {
      setBusyGroupLessonSeries(false)
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

  const isStudentModalSubmitting =
    Boolean(studentModal) &&
    (studentModal.type === 'add'
      ? busyStudentId === '__add__'
      : busyStudentId === studentModal.student.id)

  const isGroupModalSubmitting =
    Boolean(groupModal) &&
    (groupModal.type === 'add'
      ? busyGroupId === '__add__'
      : busyGroupId === groupModal.group.id)

  const isGroupStudentModalSubmitting = busyGroupStudentId === '__add__'

  const isGroupLessonModalSubmitting =
    Boolean(groupLessonModal) &&
    (groupLessonModal.type === 'add'
      ? busyGroupLessonId === '__add__'
      : busyGroupLessonId === groupLessonModal.lesson.id)

  const isGroupLessonSeriesSubmitting = busyGroupLessonSeries

  const isPrivateLessonModalSubmitting = busyPrivateLessonAdd
  const isPrivateLessonEditSubmitting = Boolean(
    privateLessonEditModal && busyPrivateLessonCrudId === privateLessonEditModal.lesson.id
  )

  const isStudentPackageModalSubmitting = busyStudentPackageSubmit

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

  const showPrivateLessonAddInCalendar =
    isAdmin ||
    (userProfile?.canCreateLessonDirectly === true &&
      userProfile?.requiresLessonApproval === false)

  function closePrivateLessonModal() {
    setPrivateLessonModalOpen(false)
    setPrivateLessonFormErrors({})
  }

  function openPrivateLessonModal() {
    if (!showPrivateLessonAddInCalendar) {
      alert('직접 수업 생성 권한이 없거나 승인 절차가 필요합니다.')
      return
    }
    setPrivateLessonForm({
      studentId: '',
      date: getStorageDateStringFromDate(selectedDate),
      time: '',
      subject: '',
    })
    setPrivateLessonFormErrors({})
    setPrivateLessonModalOpen(true)
  }

  function validatePrivateLessonFormFields(form) {
    const errors = {}
    const studentId = String(form.studentId || '').trim()
    const date = String(form.date || '').trim()
    const time = String(form.time || '').trim()
    const subject = String(form.subject || '').trim()

    if (!studentId) errors.studentId = '학생을 선택해주세요.'
    if (!date) errors.date = '날짜를 선택해주세요.'
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = '날짜 형식이 올바르지 않습니다.'
    if (!time) errors.time = '시간을 선택해주세요.'
    if (time && !/^\d{2}:\d{2}$/.test(time)) errors.time = '시간 형식이 올바르지 않습니다.'
    if (!subject) errors.subject = '과목을 입력해주세요.'

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      studentId,
      date,
      time,
      subject,
    }
  }

  async function submitPrivateLessonModal() {
    const result = validatePrivateLessonFormFields(privateLessonForm)
    setPrivateLessonFormErrors(result.errors)
    if (!result.valid) return

    const student = sortedPrivateStudents.find((s) => s.id === result.studentId)
    if (!student) {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        studentId: '선택한 학생을 찾을 수 없습니다.',
      }))
      return
    }

    const teacherKey = isAdmin
      ? normalizeText(student.teacher)
      : normalizeText(userProfile?.teacherName)
    if (!teacherKey) {
      alert(
        isAdmin
          ? '이 학생의 담당 선생님(teacher)이 비어 있어 수업을 만들 수 없습니다.'
          : '프로필의 선생님 이름이 없어 수업을 만들 수 없습니다.'
      )
      return
    }

    const startDate = parseLegacyLessonToDate(result.date, result.time)
    if (!startDate) {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        date: '날짜·시간을 확인해주세요.',
      }))
      return
    }

    const studentName = String(student.name || '').trim()
    if (!studentName) {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        studentId: '학생 이름이 비어 있습니다.',
      }))
      return
    }

    try {
      setBusyPrivateLessonAdd(true)
      await addDoc(collection(db, 'lessons'), {
        studentId: student.id,
        studentName,
        teacherName: teacherKey,
        student: studentName,
        teacher: teacherKey,
        date: result.date,
        time: result.time,
        startAt: Timestamp.fromDate(startDate),
        subject: result.subject,
        completed: false,
        completedAt: null,
        isDeductCancelled: false,
        deductMemo: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      closePrivateLessonModal()
    } catch (error) {
      console.error('개인 수업 추가 실패:', error)
      alert(`개인 수업 추가 실패: ${error.message}`)
    } finally {
      setBusyPrivateLessonAdd(false)
    }
  }

  function closePrivateLessonEditModal() {
    setPrivateLessonEditModal(null)
    setPrivateLessonEditFormErrors({})
  }

  function openPrivateLessonEditModal(lesson) {
    if (!canEditLesson) {
      alert('수업 수정 권한이 없습니다.')
      return
    }
    setPrivateLessonEditForm({
      date: lessonDateInputValue(lesson),
      time: lessonTimeInputValue(lesson),
      subject: String(lesson.subject || '').trim(),
    })
    setPrivateLessonEditFormErrors({})
    setPrivateLessonEditModal({ lesson })
  }

  async function submitPrivateLessonEditModal() {
    if (!privateLessonEditModal?.lesson) return
    if (!canEditLesson) {
      alert('수업 수정 권한이 없습니다.')
      return
    }

    const result = validateLessonDateTimeSubject(privateLessonEditForm)
    setPrivateLessonEditFormErrors(result.errors)
    if (!result.valid) return

    const { lesson } = privateLessonEditModal
    const startDate = parseLegacyLessonToDate(result.date, result.time)
    if (!startDate) {
      setPrivateLessonEditFormErrors((prev) => ({
        ...prev,
        date: '날짜·시간을 확인해주세요.',
      }))
      return
    }

    try {
      setBusyPrivateLessonCrudId(lesson.id)
      await updateDoc(doc(db, 'lessons', lesson.id), {
        date: result.date,
        time: result.time,
        subject: result.subject,
        startAt: Timestamp.fromDate(startDate),
        updatedAt: serverTimestamp(),
      })
      closePrivateLessonEditModal()
    } catch (error) {
      console.error('개인 수업 수정 실패:', error)
      alert(`개인 수업 수정 실패: ${error.message}`)
    } finally {
      setBusyPrivateLessonCrudId(null)
    }
  }

  async function handleDeletePrivateLesson(lesson) {
    if (!canDeleteLesson) {
      alert('수업 삭제 권한이 없습니다.')
      return
    }

    const label = `${getLessonStorageDateString(lesson)} ${lessonTimeInputValue(lesson)} ${lesson.subject || ''}`.trim()
    if (!window.confirm(`이 개인 수업을 삭제할까요?\n${label || lesson.id}`)) return

    try {
      setBusyPrivateLessonCrudId(lesson.id)
      await deleteDoc(doc(db, 'lessons', lesson.id))
    } catch (error) {
      console.error('개인 수업 삭제 실패:', error)
      alert(`개인 수업 삭제 실패: ${error.message}`)
    } finally {
      setBusyPrivateLessonCrudId(null)
    }
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
    { key: 'calendar', label: 'Calendar' },
    { key: 'students', label: 'Students' },
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
            Sign Out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="main-header">
          <div>
          <h1 className="page-title">
  {activeSection === 'calendar'
    ? 'Calendar'
    : activeSection === 'students'
    ? 'Students'
    : '반 관리'}
</h1>
            <p className="page-sub">
              {userProfile?.teacherName
                ? `${userProfile.teacherName} 님 환영합니다`
                : `Welcome back, ${user?.email || ''}`}
            </p>
          </div>
          </header>

          {activeSection === 'calendar' && (
<section className="activity-section" style={{ marginBottom: 24 }}>
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
      gap: 12,
    }}
  >
    <button
      onClick={() =>
        setCalendarMonth(
          (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
        )
      }
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #444',
        background: '#1f1f1f',
        color: 'white',
        cursor: 'pointer',
      }}
    >
      ←
    </button>

    <h2 className="section-title" style={{ margin: 0 }}>
      {calendarMonthLabel}
    </h2>

    <button
      onClick={() =>
        setCalendarMonth(
          (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
        )
      }
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #444',
        background: '#1f1f1f',
        color: 'white',
        cursor: 'pointer',
      }}
    >
      →
    </button>
  </div>

  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap: 8,
      marginBottom: 8,
      fontSize: 12,
      opacity: 0.8,
    }}
  >
    {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
      <div key={day} style={{ textAlign: 'center' }}>
        {day}
      </div>
    ))}
  </div>

  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap: 8,
    }}
  >
    {calendarDays.map((day) => {
      const dateKey = getStorageDateStringFromDate(day)
      const count = lessonsCountByDate.get(dateKey) || 0
      const isCurrentMonth = day.getMonth() === calendarMonth.getMonth()
      const isSelected = isSameStorageDate(day, selectedDate)

      return (
        <button
          key={dateKey}
          onClick={() => {
            setSelectedDate(day)
            setShowOnlySelectedDate(true)
          }}
          style={{
            minHeight: 72,
            borderRadius: 10,
            border: isSelected ? '1px solid #6b8cff' : '1px solid #2e3240',
            background: isSelected ? '#1f2a44' : '#151922',
            color: isCurrentMonth ? 'white' : '#666',
            padding: 8,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>{day.getDate()}</div>
          {count > 0 ? (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                opacity: 0.9,
              }}
            >
              수업 {count}개
            </div>
          ) : null}
        </button>
      )
    })}
  </div>
</section>
)}
{activeSection === 'students' && (
  <section className="activity-section">
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <h2 className="section-title" style={{ margin: 0 }}>
        Student Management
      </h2>
      {canAddStudent ? (
        <button
          type="button"
          onClick={openStudentAddModal}
          disabled={busyStudentId === '__add__' || loading}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #444',
            background: '#1f2a44',
            color: 'white',
            cursor:
              busyStudentId === '__add__' || loading ? 'not-allowed' : 'pointer',
          }}
        >
          {busyStudentId === '__add__' ? '추가 중...' : '학생 추가'}
        </button>
      ) : null}
    </div>

    {loading ? (
      <p>불러오는 중...</p>
    ) : sortedPrivateStudents.length === 0 ? (
      <p style={{ opacity: 0.8 }}>등록된 학생이 없습니다.</p>
    ) : (
      <div className="activity-table">
        <div
          className="table-head"
          style={{
            gridTemplateColumns: '1.1fr 1.1fr 0.75fr 0.85fr 0.75fr minmax(200px, auto)',
          }}
        >
          <span>이름</span>
          <span>선생님</span>
          <span>결제 횟수</span>
          <span>차감 횟수</span>
          <span>남은 횟수</span>
          <span>작업</span>
        </div>

        {sortedPrivateStudents.map((student) => {
          const paid = Number(student.paidLessons ?? 0)
          const attended = Number(student.attendanceCount ?? 0)
          const remaining = paid - attended
          const rowBusy = busyStudentId === student.id

          return (
            <div
              key={student.id}
              className="table-row"
              style={{
                gridTemplateColumns:
                  '1.1fr 1.1fr 0.75fr 0.85fr 0.75fr minmax(200px, auto)',
              }}
            >
              <span>{student.name || '-'}</span>
              <span>{student.teacher || '-'}</span>
              <span>{paid}</span>
              <span>{attended}</span>
              <span>{remaining}</span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {canEditStudent ? (
                  <button
                    type="button"
                    onClick={() => openStudentEditModal(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #555',
                      background: '#1f2a44',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {rowBusy ? '처리 중...' : '수정'}
                  </button>
                ) : null}
                {canDeleteStudent ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteStudent(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #553333',
                      background: '#4a2a2a',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {rowBusy ? '처리 중...' : '삭제'}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => openStudentPackageModal(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #335533',
                      background: '#2a3d2a',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    패키지 추가
                  </button>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
    )}
  </section>
)}

{activeSection === 'groups' && (
  <section className="activity-section">
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <h2 className="section-title" style={{ margin: 0 }}>
        반 관리
      </h2>
      {canManageGroupClasses ? (
        <button
          type="button"
          onClick={openGroupAddModal}
          disabled={busyGroupId === '__add__' || groupClassesLoading}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #444',
            background: '#1f2a44',
            color: 'white',
            cursor:
              busyGroupId === '__add__' || groupClassesLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {busyGroupId === '__add__' ? '만드는 중...' : '반 만들기'}
        </button>
      ) : null}
    </div>

    {groupClassesLoading ? (
      <p>불러오는 중...</p>
    ) : sortedGroupClasses.length === 0 ? (
      <p style={{ opacity: 0.8 }}>등록된 반이 없습니다. 위에서 반을 만들 수 있습니다.</p>
    ) : (
      <>
        <div className="activity-table">
          <div
            className="table-head"
            style={{
              gridTemplateColumns: '1.2fr 1.2fr 0.9fr minmax(140px, auto)',
            }}
          >
            <span>이름</span>
            <span>선생님</span>
            <span>최대 인원</span>
            <span>작업</span>
          </div>

          {sortedGroupClasses.map((group) => {
            const rowBusy = busyGroupId === group.id
            const isSelected = selectedGroupClass?.id === group.id

            return (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                className="table-row"
                onClick={() => setSelectedGroupClass(group)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedGroupClass(group)
                  }
                }}
                style={{
                  gridTemplateColumns: '1.2fr 1.2fr 0.9fr minmax(140px, auto)',
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid #6b8cff' : undefined,
                  outlineOffset: -2,
                }}
              >
                <span>{group.name || '-'}</span>
                <span>{group.teacher || '-'}</span>
                <span>{group.maxStudents ?? '-'}</span>
                <span
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {canManageGroupClasses ? (
                    <button
                      type="button"
                      onClick={() => openGroupEditModal(group)}
                      disabled={rowBusy || busyGroupId === '__add__'}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: rowBusy || busyGroupId === '__add__' ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowBusy ? '처리 중...' : '수정'}
                    </button>
                  ) : null}
                  {canManageGroupClasses ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteGroup(group)}
                      disabled={rowBusy || busyGroupId === '__add__'}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #553333',
                        background: '#4a2a2a',
                        color: 'white',
                        cursor: rowBusy || busyGroupId === '__add__' ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowBusy ? '처리 중...' : '삭제'}
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>

        {!selectedGroupClass && sortedGroupClasses.length > 0 ? (
          <p style={{ marginTop: 16, opacity: 0.75, fontSize: 13 }}>
            반을 선택하면 학생과 수업 일정을 관리할 수 있습니다.
          </p>
        ) : null}

        {selectedGroupClass ? (
          <div
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: 12,
              border: '1px solid #2e3240',
              background: '#151922',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              등록 학생 — {selectedGroupClass.name || '-'}
            </h3>
            <p style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 13 }}>
              담당 선생님 {selectedGroupClass.teacher || '-'} · 정원{' '}
              {selectedGroupClass.maxStudents ?? '-'}명
            </p>
            <p style={{ margin: '6px 0 0 0', opacity: 0.68, fontSize: 12 }}>
              기본 시간 {selectedGroupClass.time || '—'} · 과목{' '}
              {selectedGroupClass.subject || '—'} · 요일{' '}
              {formatGroupWeekdaysDisplay(selectedGroupClass.weekdays) || '—'}
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 14,
                marginBottom: 16,
                alignItems: 'center',
              }}
            >
              {canAddStudent ? (
                <button
                  type="button"
                  onClick={openGroupStudentAddModal}
                  disabled={
                    busyGroupStudentId === '__add__' ||
                    groupStudentsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                  }
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid #444',
                    background: '#1f2a44',
                    color: 'white',
                    cursor:
                      busyGroupStudentId === '__add__' ||
                      groupStudentsLoading ||
                      busyGroupId === '__add__' ||
                      busyGroupId === selectedGroupClass.id
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {busyGroupStudentId === '__add__' ? '등록 중...' : '학생 등록'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={openGroupLessonAddModal}
                disabled={
                  !canUseDirectLessonCreation ||
                  busyGroupLessonId === '__add__' ||
                  busyGroupLessonSeries ||
                  groupLessonsLoading ||
                  busyGroupId === '__add__' ||
                  busyGroupId === selectedGroupClass.id
                }
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid #444',
                  background: '#1f2a44',
                  color: 'white',
                  cursor:
                    !canUseDirectLessonCreation ||
                    busyGroupLessonId === '__add__' ||
                    busyGroupLessonSeries ||
                    groupLessonsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
                title={
                  requiresLessonApproval
                    ? '승인 절차가 필요해 직접 수업 생성을 사용할 수 없습니다.'
                    : !canCreateLessonDirectly
                    ? '직접 수업 생성 권한이 없습니다.'
                    : undefined
                }
              >
                {busyGroupLessonId === '__add__' ? '추가 중...' : '한 번만 수업 추가'}
              </button>
              <button
                type="button"
                onClick={openGroupLessonSeriesModal}
                disabled={
                  !canUseDirectLessonCreation ||
                  busyGroupLessonId === '__add__' ||
                  busyGroupLessonSeries ||
                  groupLessonsLoading ||
                  busyGroupId === '__add__' ||
                  busyGroupId === selectedGroupClass.id
                }
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid #335533',
                  background: '#2a3d2a',
                  color: 'white',
                  cursor:
                    !canUseDirectLessonCreation ||
                    busyGroupLessonId === '__add__' ||
                    busyGroupLessonSeries ||
                    groupLessonsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
                title={
                  requiresLessonApproval
                    ? '승인 절차가 필요해 직접 수업 생성을 사용할 수 없습니다.'
                    : !canCreateLessonDirectly
                    ? '직접 수업 생성 권한이 없습니다.'
                    : undefined
                }
              >
                {busyGroupLessonSeries ? '생성 중...' : '수업 일정 생성'}
              </button>
            </div>
            <p style={{ margin: '-8px 0 16px 0', fontSize: 11, opacity: 0.6, lineHeight: 1.45 }}>
              한 번만 수업 추가: 보강·특강 등 임시 일정용 · 수업 일정 생성: 반에 저장된 요일·시간으로
              여러 날짜를 한 번에 만듭니다.
            </p>

            {groupStudentsLoading ? (
              <p style={{ opacity: 0.85 }}>학생 목록 불러오는 중...</p>
            ) : sortedGroupStudentsForSelectedClass.length === 0 ? (
              <p style={{ opacity: 0.8 }}>이 반에 등록된 학생이 없습니다.</p>
            ) : (
              <div className="activity-table">
                <div
                  className="table-head"
                  style={{
                    gridTemplateColumns:
                      '1.1fr 0.75fr 0.75fr 1fr minmax(100px, auto)',
                  }}
                >
                  <span>학생 이름</span>
                  <span>차감 횟수</span>
                  <span>결제 횟수</span>
                  <span>시작일</span>
                  <span>작업</span>
                </div>

                {sortedGroupStudentsForSelectedClass.map((gs) => {
                  const gsBusy = busyGroupStudentId === gs.id
                  const paid = Number(gs.paidLessons ?? 0)
                  const attended = Number(gs.attendanceCount ?? 0)

                  return (
                    <div
                      key={gs.id}
                      className="table-row"
                      style={{
                        gridTemplateColumns:
                          '1.1fr 0.75fr 0.75fr 1fr minmax(100px, auto)',
                      }}
                    >
                      <span>{getGroupStudentDisplayName(gs)}</span>
                      <span>{attended}</span>
                      <span>{paid}</span>
                      <span>{formatGroupStudentStartDate(gs.startDate)}</span>
                      <span>
                        <button
                          type="button"
                          onClick={() => handleRemoveGroupStudent(gs)}
                          disabled={
                            gsBusy ||
                            busyGroupStudentId === '__add__' ||
                            busyGroupId === '__add__' ||
                            busyGroupId === selectedGroupClass.id
                          }
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #553333',
                            background: '#4a2a2a',
                            color: 'white',
                            cursor:
                              gsBusy ||
                              busyGroupStudentId === '__add__' ||
                              busyGroupId === '__add__' ||
                              busyGroupId === selectedGroupClass.id
                                ? 'not-allowed'
                                : 'pointer',
                          }}
                        >
                          {gsBusy ? '처리 중...' : '제거'}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ height: 20 }} />

            <div style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>수업 일정</h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.75, fontSize: 13 }}>
                이 반에서 실제로 진행되는 날짜별 수업입니다.
              </p>
            </div>

            {groupLessonsLoading ? (
              <p style={{ opacity: 0.85 }}>수업 일정을 불러오는 중...</p>
            ) : sortedGroupLessonsForSelectedClass.length === 0 ? (
              <p style={{ opacity: 0.8 }}>등록된 수업 일정이 없습니다.</p>
            ) : (
              <div className="activity-table">
                <div
                  className="table-head"
                  style={{
                    gridTemplateColumns: '1fr 0.7fr 1.2fr minmax(140px, auto)',
                  }}
                >
                  <span>날짜</span>
                  <span>시간</span>
                  <span>과목</span>
                  <span>작업</span>
                </div>

                {sortedGroupLessonsForSelectedClass.map((gl) => {
                  const rowBusy = busyGroupLessonId === gl.id
                  return (
                    <div
                      key={gl.id}
                      className="table-row"
                      style={{
                        gridTemplateColumns: '1fr 0.7fr 1.2fr minmax(140px, auto)',
                      }}
                    >
                      <span>{gl.date || '-'}</span>
                      <span>{gl.time || '-'}</span>
                      <span>{gl.subject || '-'}</span>
                      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {canEditLesson ? (
                          <button
                            type="button"
                            onClick={() => openGroupLessonEditModal(gl)}
                            disabled={
                              rowBusy ||
                              busyGroupLessonId === '__add__' ||
                              busyGroupId === '__add__' ||
                              busyGroupId === selectedGroupClass.id
                            }
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #555',
                              background: '#1f2a44',
                              color: 'white',
                              cursor:
                                rowBusy ||
                                busyGroupLessonId === '__add__' ||
                                busyGroupId === '__add__' ||
                                busyGroupId === selectedGroupClass.id
                                  ? 'not-allowed'
                                  : 'pointer',
                            }}
                          >
                            {rowBusy ? '처리 중...' : '수정'}
                          </button>
                        ) : null}
                        {canDeleteLesson ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteGroupLesson(gl)}
                            disabled={
                              rowBusy ||
                              busyGroupLessonId === '__add__' ||
                              busyGroupId === '__add__' ||
                              busyGroupId === selectedGroupClass.id
                            }
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #553333',
                              background: '#4a2a2a',
                              color: 'white',
                              cursor:
                                rowBusy ||
                                busyGroupLessonId === '__add__' ||
                                busyGroupId === '__add__' ||
                                busyGroupId === selectedGroupClass.id
                                  ? 'not-allowed'
                                  : 'pointer',
                            }}
                          >
                            {rowBusy ? '처리 중...' : '삭제'}
                          </button>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
      </>
    )}
  </section>
)}

        <section className="activity-section">
        <div
  style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  }}
>
  <div>
    <h2 className="section-title" style={{ margin: 0 }}>
      {showOnlySelectedDate ? `${selectedDateDisplayString} 수업` : '전체 수업'}
    </h2>
    <p style={{ margin: '6px 0 0 0', opacity: 0.75, fontSize: 13 }}>
      {showOnlySelectedDate
        ? '선택한 날짜의 수업만 표시 중'
        : '전체 수업 표시 중'}
    </p>
  </div>

  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <button
      onClick={() => setShowOnlySelectedDate((prev) => !prev)}
      style={{
        padding: '10px 14px',
        borderRadius: 10,
        border: '1px solid #444',
        background: '#1f1f1f',
        color: 'white',
        cursor: 'pointer',
      }}
    >
      {showOnlySelectedDate ? '전체 보기' : '선택 날짜만 보기'}
    </button>

    {activeSection === 'calendar' && showPrivateLessonAddInCalendar ? (
      <button
        type="button"
        onClick={openPrivateLessonModal}
        disabled={loading || isPrivateLessonModalSubmitting || sortedPrivateStudents.length === 0}
        title={
          sortedPrivateStudents.length === 0
            ? '표시할 개인 학생이 없습니다.'
            : undefined
        }
        style={{
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid #444',
          background: '#1f2a44',
          color: 'white',
          cursor:
            loading || isPrivateLessonModalSubmitting || sortedPrivateStudents.length === 0
              ? 'not-allowed'
              : 'pointer',
        }}
      >
        개인 수업 추가
      </button>
    ) : null}

    {isAdmin ? (
      <button
        onClick={handleMigrateLessons}
        disabled={migrating}
        style={{
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid #444',
          background: '#1f1f1f',
          color: 'white',
          cursor: migrating ? 'not-allowed' : 'pointer',
        }}
      >
        {migrating ? '변환 중...' : '기존 lessons를 Timestamp + studentId로 변환'}
      </button>
    ) : null}
  </div>
</div>

          {loading ? (
            <p>불러오는 중...</p>
          ) : displayedLessons.length === 0 ? (
            <p>등록된 수업이 없습니다.</p>
          ) : (
            <div className="activity-table">
              <div className="table-head">
                <span>날짜</span>
                <span>시간</span>
                <span>학생</span>
                <span>선생님</span>
                <span>과목</span>
                <span>남은 횟수</span>
                <span>상태</span>
                <span>작업</span>
              </div>

              {displayedLessons.map((lesson) => {
                const lessonDate = getLessonDate(lesson)
                const matchedStudent = getMatchedStudent(lesson)
                const remainingLessons = matchedStudent
                  ? Number(matchedStudent.paidLessons || 0) -
                    Number(matchedStudent.attendanceCount || 0)
                  : '-'
                const canDeductionAction =
                  canManageAttendance && Boolean(getMatchedStudentId(lesson))
                const todayString = getTodayStorageDateString()
                const lessonDateStr = getLessonStorageDateString(lesson)
                const statusLabel = lesson.isDeductCancelled
                  ? '차감취소'
                  : lessonDateStr && lessonDateStr <= todayString
                    ? '정상 차감'
                    : '예정'
                const rowPrivateCrudBusy = busyPrivateLessonCrudId === lesson.id
                const rowLessonActionBusy =
                  busyLessonId === lesson.id || rowPrivateCrudBusy || busyPrivateLessonAdd
                return (
                  <div key={lesson.id} className="table-row">
                    <span>{formatDate(lessonDate)}</span>
                    <span>{formatTime(lessonDate)}</span>
                    <span>{getStudentName(lesson)}</span>
                    <span>{getTeacherName(lesson)}</span>
                    <span>{lesson.subject || '-'}</span>
                    <span>{remainingLessons}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>{statusLabel}</span>
                      {lesson.deductMemo ? (
                        <span style={{ fontSize: 12, opacity: 0.8 }}>
                          메모: {lesson.deductMemo}
                        </span>
                      ) : null}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        alignItems: 'flex-start',
                      }}
                    >
                      {canManageAttendance ? (
                        <button
                          onClick={() => handleDeductionToggle(lesson)}
                          disabled={busyLessonId === lesson.id || !canDeductionAction}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #555',
                            background: lesson.isDeductCancelled ? '#4a2a2a' : '#1f2a44',
                            color: 'white',
                            cursor:
                              busyLessonId === lesson.id || !canDeductionAction
                                ? 'not-allowed'
                                : 'pointer',
                          }}
                        >
                          {busyLessonId === lesson.id
                            ? '처리 중...'
                            : lesson.isDeductCancelled
                            ? '차감복구'
                            : '차감취소'}
                        </button>
                      ) : null}
                      {activeSection === 'calendar' && canEditLesson ? (
                        <button
                          type="button"
                          onClick={() => openPrivateLessonEditModal(lesson)}
                          disabled={rowLessonActionBusy}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #555',
                            background: '#1f2a44',
                            color: 'white',
                            cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {rowPrivateCrudBusy ? '처리 중...' : '수정'}
                        </button>
                      ) : null}
                      {activeSection === 'calendar' && canDeleteLesson ? (
                        <button
                          type="button"
                          onClick={() => handleDeletePrivateLesson(lesson)}
                          disabled={rowLessonActionBusy}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #553333',
                            background: '#4a2a2a',
                            color: 'white',
                            cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {rowPrivateCrudBusy ? '처리 중...' : '삭제'}
                        </button>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {activeSection === 'students' && studentModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeStudentModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="student-modal-title"
              style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              {studentModal.type === 'add' ? '학생 추가' : '학생 수정'}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>이름</span>
                <input
                  type="text"
                  value={studentForm.name}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  autoComplete="name"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentFormErrors.name ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{studentFormErrors.name}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>선생님</span>
                <input
                  type="text"
                  value={studentForm.teacher}
                  readOnly={!isAdmin}
                  onChange={
                    isAdmin
                      ? (e) =>
                          setStudentForm((prev) => ({ ...prev, teacher: e.target.value }))
                      : undefined
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentFormErrors.teacher ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{studentFormErrors.teacher}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>결제 횟수 (paidLessons)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={studentForm.paidLessons}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, paidLessons: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentFormErrors.paidLessons ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentFormErrors.paidLessons}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>차감 횟수 (attendanceCount)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={studentForm.attendanceCount}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, attendanceCount: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentFormErrors.attendanceCount ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentFormErrors.attendanceCount}
                  </span>
                ) : null}
              </label>

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px dashed #444',
                  background: '#1a1d26',
                  fontSize: 13,
                  opacity: 0.95,
                }}
              >
                남은 횟수 (표시만){' '}
                <strong>
                  {studentFormRemainingPreview === null ? '—' : studentFormRemainingPreview}
                </strong>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closeStudentModal}
                disabled={isStudentModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isStudentModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitStudentModal}
                disabled={isStudentModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isStudentModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isStudentModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'students' && studentPackageModalStudent ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-package-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeStudentPackageModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="student-package-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              학생 패키지 추가
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.85 }}>
              {studentPackageModalStudent.name || '-'} · {studentPackageModalStudent.teacher || '-'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>패키지 유형</span>
                <select
                  value={studentPackageForm.packageType}
                  onChange={(e) => {
                    const packageType = e.target.value
                    setStudentPackageForm((prev) => ({
                      ...prev,
                      packageType,
                      groupClassId:
                        packageType === 'private' ? '' : prev.groupClassId,
                    }))
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                >
                  <option value="private">개인 (private)</option>
                  <option value="group">그룹 (group)</option>
                  <option value="openGroup">오픈 그룹 (openGroup)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>제목</span>
                <input
                  type="text"
                  value={studentPackageForm.title}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.title ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.title}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>총 횟수 (totalCount)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={studentPackageForm.totalCount}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, totalCount: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.totalCount ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.totalCount}
                  </span>
                ) : null}
              </label>

              {studentPackageForm.packageType === 'group' ||
              studentPackageForm.packageType === 'openGroup' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>그룹 수업</span>
                  <select
                    value={studentPackageForm.groupClassId}
                    onChange={(e) =>
                      setStudentPackageForm((prev) => ({
                        ...prev,
                        groupClassId: e.target.value,
                      }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  >
                    <option value="">그룹을 선택하세요</option>
                    {sortedGroupClasses.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name || '-'} ({g.teacher || '-'})
                      </option>
                    ))}
                  </select>
                  {studentPackageFormErrors.groupClassId ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageFormErrors.groupClassId}
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>만료일 (선택)</span>
                <input
                  type="date"
                  value={studentPackageForm.expiresAt}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, expiresAt: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.expiresAt ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.expiresAt}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>결제 금액 (선택)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={studentPackageForm.amountPaid}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, amountPaid: e.target.value }))
                  }
                  placeholder="0"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.amountPaid ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.amountPaid}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>메모 (선택)</span>
                <textarea
                  value={studentPackageForm.memo}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, memo: e.target.value }))
                  }
                  rows={3}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                    resize: 'vertical',
                  }}
                />
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closeStudentPackageModal}
                disabled={isStudentPackageModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isStudentPackageModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitStudentPackageModal}
                disabled={isStudentPackageModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isStudentPackageModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isStudentPackageModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'groups' && groupModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeGroupModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="group-modal-title"
              style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              {groupModal.type === 'add' ? '반 만들기' : '반 수정'}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                반복 모드: fixedWeekdays (고정 요일, 읽기 전용)
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>이름</span>
                <input
                  type="text"
                  value={groupForm.name}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.name ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{groupFormErrors.name}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>선생님</span>
                <input
                  type="text"
                  value={groupForm.teacher}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, teacher: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.teacher ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{groupFormErrors.teacher}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>최대 인원 (maxStudents)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={groupForm.maxStudents}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, maxStudents: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.maxStudents ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupFormErrors.maxStudents}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>시간 (HH:mm)</span>
                <input
                  type="time"
                  value={groupForm.time}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, time: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.time ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{groupFormErrors.time}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>과목</span>
                <input
                  type="text"
                  value={groupForm.subject}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, subject: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.subject ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupFormErrors.subject}
                  </span>
                ) : null}
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>요일 (1=일 … 7=토)</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px' }}>
                  {GROUP_RECURRENCE_WEEKDAY_TOGGLES.map(({ value, label }) => {
                    const checked =
                      Array.isArray(groupForm.weekdays) && groupForm.weekdays.includes(value)
                    return (
                      <label
                        key={value}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setGroupForm((prev) => {
                              const prevWd = Array.isArray(prev.weekdays) ? prev.weekdays : []
                              const set = new Set(prevWd)
                              if (set.has(value)) set.delete(value)
                              else set.add(value)
                              return { ...prev, weekdays: [...set].sort((a, b) => a - b) }
                            })
                          }}
                        />
                        {label}
                      </label>
                    )
                  })}
                </div>
                {groupFormErrors.weekdays ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupFormErrors.weekdays}
                  </span>
                ) : null}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closeGroupModal}
                disabled={isGroupModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isGroupModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitGroupModal}
                disabled={isGroupModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isGroupModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isGroupModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'groups' &&
      groupStudentAddModalOpen &&
      selectedGroupClass ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-student-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeGroupStudentAddModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="group-student-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              학생 등록
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
              {selectedGroupClass.name || '-'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>이 반에서 사용할 패키지 선택</span>
                <select
                  value={groupStudentForm.packageId}
                  onChange={(e) =>
                    setGroupStudentForm((prev) => ({
                      ...prev,
                      packageId: e.target.value,
                    }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                >
                  <option value="">패키지를 선택하세요</option>
                  {groupStudentEligiblePackages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.studentName || '-'} — {p.title || '(제목 없음)'}
                    </option>
                  ))}
                </select>
                {groupStudentEligiblePackages.length === 0 ? (
                  <span style={{ fontSize: 12, opacity: 0.75 }}>
                    이 반에 연결된 활성 group 패키지가 없습니다.
                  </span>
                ) : null}
                {groupStudentFormErrors.packageId ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupStudentFormErrors.packageId}
                  </span>
                ) : null}
              </label>

              {(() => {
                const pkg = groupStudentForm.packageId
                  ? studentPackages.find((p) => p.id === groupStudentForm.packageId)
                  : null
                if (!pkg) return null
                return (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid #333',
                      background: '#1a1d26',
                      opacity: 0.95,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.9 }}>
                      패키지 정보 (읽기 전용)
                    </div>
                    <div>studentName: {pkg.studentName ?? '-'}</div>
                    <div>teacher: {pkg.teacher ?? '-'}</div>
                    <div>title: {pkg.title ?? '-'}</div>
                    <div>totalCount: {pkg.totalCount ?? '-'}</div>
                    <div>usedCount: {pkg.usedCount ?? '-'}</div>
                    <div>remainingCount: {pkg.remainingCount ?? '-'}</div>
                    <div>expiresAt: {formatGroupStudentStartDate(pkg.expiresAt)}</div>
                    <div>amountPaid: {pkg.amountPaid ?? 0}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>memo: {pkg.memo || '—'}</div>
                  </div>
                )
              })()}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>시작일</span>
                <input
                  type="date"
                  value={groupStudentForm.startDate}
                  onChange={(e) =>
                    setGroupStudentForm((prev) => ({
                      ...prev,
                      startDate: e.target.value,
                    }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupStudentFormErrors.startDate ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupStudentFormErrors.startDate}
                  </span>
                ) : null}
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closeGroupStudentAddModal}
                disabled={isGroupStudentModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isGroupStudentModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitGroupStudentAdd}
                disabled={isGroupStudentModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isGroupStudentModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isGroupStudentModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'groups' && groupLessonModal && selectedGroupClass ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-lesson-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeGroupLessonModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="group-lesson-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              {groupLessonModal.type === 'add' ? '한 번만 수업 추가' : '수업 수정'}
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
              {selectedGroupClass.name || '-'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>날짜</span>
                <input
                  type="date"
                  value={groupLessonForm.date}
                  onChange={(e) =>
                    setGroupLessonForm((prev) => ({ ...prev, date: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupLessonFormErrors.date ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{groupLessonFormErrors.date}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>시간</span>
                <input
                  type="time"
                  value={groupLessonForm.time}
                  onChange={(e) =>
                    setGroupLessonForm((prev) => ({ ...prev, time: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupLessonFormErrors.time ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{groupLessonFormErrors.time}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>과목</span>
                <input
                  type="text"
                  value={groupLessonForm.subject}
                  onChange={(e) =>
                    setGroupLessonForm((prev) => ({ ...prev, subject: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupLessonFormErrors.subject ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupLessonFormErrors.subject}
                  </span>
                ) : null}
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closeGroupLessonModal}
                disabled={isGroupLessonModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isGroupLessonModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitGroupLessonModal}
                disabled={isGroupLessonModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isGroupLessonModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isGroupLessonModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'groups' && groupLessonSeriesModalOpen && selectedGroupClass ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-lesson-series-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeGroupLessonSeriesModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="group-lesson-series-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              수업 일정 생성
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
              {selectedGroupClass.name || '-'}
            </p>

            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                padding: 12,
                borderRadius: 8,
                border: '1px solid #333',
                background: '#1a1d26',
                marginBottom: 12,
                opacity: 0.95,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>이 반의 수업 정보 (읽기 전용)</div>
              <div>시간: {selectedGroupClass.time || '—'}</div>
              <div>과목: {selectedGroupClass.subject || '—'}</div>
              <div>
                요일:{' '}
                {formatGroupWeekdaysDisplay(selectedGroupClass.weekdays) || '—'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>시작일</span>
                <input
                  type="date"
                  value={groupLessonSeriesForm.startDate}
                  onChange={(e) =>
                    setGroupLessonSeriesForm((prev) => ({
                      ...prev,
                      startDate: e.target.value,
                    }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupLessonSeriesFormErrors.startDate ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupLessonSeriesFormErrors.startDate}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>종료일</span>
                <input
                  type="date"
                  value={groupLessonSeriesForm.endDate}
                  onChange={(e) =>
                    setGroupLessonSeriesForm((prev) => ({
                      ...prev,
                      endDate: e.target.value,
                    }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupLessonSeriesFormErrors.endDate ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupLessonSeriesFormErrors.endDate}
                  </span>
                ) : null}
              </label>

              {groupLessonSeriesPlannedCount != null ? (
                <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
                  이 기간·요일 기준 생성 후보: <strong>{groupLessonSeriesPlannedCount}</strong>건
                  (이미 같은 날짜·시간 수업이 있으면 건너뜁니다)
                </p>
              ) : null}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closeGroupLessonSeriesModal}
                disabled={isGroupLessonSeriesSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isGroupLessonSeriesSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitGroupLessonSeriesModal}
                disabled={isGroupLessonSeriesSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isGroupLessonSeriesSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isGroupLessonSeriesSubmitting ? '생성 중...' : '생성'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'calendar' && privateLessonModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="private-lesson-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePrivateLessonModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="private-lesson-modal-title"
              style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              개인 수업 추가
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>학생</span>
                <select
                  value={privateLessonForm.studentId}
                  onChange={(e) =>
                    setPrivateLessonForm((prev) => ({ ...prev, studentId: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                >
                  <option value="">선택</option>
                  {sortedPrivateStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || '-'}
                      {isAdmin && s.teacher ? ` (${s.teacher})` : ''}
                    </option>
                  ))}
                </select>
                {privateLessonFormErrors.studentId ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {privateLessonFormErrors.studentId}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>날짜 (선택한 캘린더 날짜)</span>
                <input
                  type="date"
                  value={privateLessonForm.date}
                  readOnly
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252525',
                    color: 'white',
                    cursor: 'default',
                  }}
                />
                {privateLessonFormErrors.date ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{privateLessonFormErrors.date}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>시간</span>
                <input
                  type="time"
                  value={privateLessonForm.time}
                  onChange={(e) =>
                    setPrivateLessonForm((prev) => ({ ...prev, time: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {privateLessonFormErrors.time ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{privateLessonFormErrors.time}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>과목</span>
                <input
                  type="text"
                  value={privateLessonForm.subject}
                  onChange={(e) =>
                    setPrivateLessonForm((prev) => ({ ...prev, subject: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {privateLessonFormErrors.subject ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {privateLessonFormErrors.subject}
                  </span>
                ) : null}
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closePrivateLessonModal}
                disabled={isPrivateLessonModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isPrivateLessonModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitPrivateLessonModal}
                disabled={isPrivateLessonModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isPrivateLessonModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isPrivateLessonModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === 'calendar' && privateLessonEditModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="private-lesson-edit-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePrivateLessonEditModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="private-lesson-edit-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              개인 수업 수정
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
              {getStudentName(privateLessonEditModal.lesson)} ·{' '}
              {getTeacherName(privateLessonEditModal.lesson)}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>날짜</span>
                <input
                  type="date"
                  value={privateLessonEditForm.date}
                  onChange={(e) =>
                    setPrivateLessonEditForm((prev) => ({ ...prev, date: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {privateLessonEditFormErrors.date ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {privateLessonEditFormErrors.date}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>시간</span>
                <input
                  type="time"
                  value={privateLessonEditForm.time}
                  onChange={(e) =>
                    setPrivateLessonEditForm((prev) => ({ ...prev, time: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {privateLessonEditFormErrors.time ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {privateLessonEditFormErrors.time}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>과목</span>
                <input
                  type="text"
                  value={privateLessonEditForm.subject}
                  onChange={(e) =>
                    setPrivateLessonEditForm((prev) => ({ ...prev, subject: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {privateLessonEditFormErrors.subject ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {privateLessonEditFormErrors.subject}
                  </span>
                ) : null}
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closePrivateLessonEditModal}
                disabled={isPrivateLessonEditSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isPrivateLessonEditSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitPrivateLessonEditModal}
                disabled={isPrivateLessonEditSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isPrivateLessonEditSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isPrivateLessonEditSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}