import { useMemo, useState } from 'react'
import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../../../firebase'
import {
  lessonDateInputValue,
  lessonTimeInputValue,
  normalizeText,
  parseLegacyLessonToDate,
  parseYmdToLocalDate,
  validateLessonDateTimeSubject,
} from '../dashboardViewUtils.js'

const DEFAULT_PRIVATE_LESSON_FORM = {
  studentId: '',
  packageId: '',
  date: '',
  time: '',
  subject: '',
  repeatWeekly: false,
  repeatWeeks: '4',
  repeatStartMode: 'includeStart',
  repeatAnchorDate: '',
  weeklyFrequency: '1',
  weeklySlot2Date: '',
  weeklySlot2Time: '',
  weeklySlot3Date: '',
  weeklySlot3Time: '',
}

const DEFAULT_PRIVATE_LESSON_EDIT_FORM = {
  date: '',
  time: '',
  subject: '',
}

function createDefaultPrivateLessonForm(overrides = {}) {
  return {
    ...DEFAULT_PRIVATE_LESSON_FORM,
    ...overrides,
  }
}

function createDefaultPrivateLessonEditForm(overrides = {}) {
  return {
    ...DEFAULT_PRIVATE_LESSON_EDIT_FORM,
    ...overrides,
  }
}

export function validatePrivateLessonFormFields(form, options = {}) {
  const { isAdmin = false } = options
  const errors = {}
  const studentId = String(form.studentId || '').trim()
  const packageId = String(form.packageId || '').trim()
  const date = String(form.date || '').trim()
  const time = String(form.time || '').trim()
  const subject = String(form.subject || '').trim()
  const repeatWeekly = form.repeatWeekly === true
  const repeatWeeksRaw = String(form.repeatWeeks ?? '').trim()
  const repeatStartModeRaw = String(form.repeatStartMode || '').trim()
  const repeatAnchorDate = String(form.repeatAnchorDate || '').trim()
  const repeatStartMode =
    repeatStartModeRaw === 'afterFirst' ? 'afterFirst' : 'includeStart'
  let repeatWeeks = 4

  const wfRaw = String(form.weeklyFrequency ?? '1').trim()
  const weeklyFrequency = wfRaw === '2' || wfRaw === '3' ? wfRaw : '1'
  const weeklySlot2Date = String(form.weeklySlot2Date || '').trim()
  const weeklySlot2Time = String(form.weeklySlot2Time || '').trim()
  const weeklySlot3Date = String(form.weeklySlot3Date || '').trim()
  const weeklySlot3Time = String(form.weeklySlot3Time || '').trim()

  if (!studentId) errors.studentId = '학생을 선택해주세요.'
  if (!packageId) {
    errors.packageId = isAdmin
      ? '사용할 개인 수강권을 선택해주세요.'
      : '사용할 수업을 선택해주세요.'
  }
  if (!date) errors.date = '날짜를 선택해주세요.'
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = '날짜 형식이 올바르지 않습니다.'
  if (!time) errors.time = '시간을 선택해주세요.'
  if (time && !/^\d{2}:\d{2}$/.test(time)) errors.time = '시간 형식이 올바르지 않습니다.'
  if (!subject) errors.subject = '과목을 입력해주세요.'

  if (repeatWeekly) {
    if (wfRaw !== '' && wfRaw !== '1' && wfRaw !== '2' && wfRaw !== '3') {
      errors.weeklyFrequency = '주당 횟수는 1, 2, 3 중 하나여야 합니다.'
    }
    const parsed = Number.parseInt(repeatWeeksRaw, 10)
    if (!Number.isInteger(parsed) || parsed < 1) {
      errors.repeatWeeks = '반복 주수는 1 이상의 정수여야 합니다.'
    } else {
      repeatWeeks = parsed
    }
    if (repeatStartModeRaw !== 'includeStart' && repeatStartModeRaw !== 'afterFirst') {
      errors.repeatStartMode = '반복 시작 방식이 올바르지 않습니다.'
    }
    if (repeatStartMode === 'afterFirst') {
      if (!repeatAnchorDate) {
        errors.repeatAnchorDate = '반복 시작일을 선택해주세요.'
      } else if (
        !/^\d{4}-\d{2}-\d{2}$/.test(repeatAnchorDate) ||
        !parseYmdToLocalDate(repeatAnchorDate)
      ) {
        errors.repeatAnchorDate = '반복 시작일 형식이 올바르지 않습니다.'
      } else if (repeatAnchorDate === date) {
        errors.repeatAnchorDate = '반복 시작일은 첫 수업 날짜와 달라야 합니다.'
      } else if (date && repeatAnchorDate < date) {
        errors.repeatAnchorDate = '반복 시작일은 첫 수업 날짜 이후여야 합니다.'
      }
    }

    if (weeklyFrequency === '2' || weeklyFrequency === '3') {
      if (!weeklySlot2Date) {
        errors.weeklySlot2Date = '두 번째 수업 날짜를 선택해주세요.'
      } else if (
        !/^\d{4}-\d{2}-\d{2}$/.test(weeklySlot2Date) ||
        !parseYmdToLocalDate(weeklySlot2Date)
      ) {
        errors.weeklySlot2Date = '두 번째 수업 날짜 형식이 올바르지 않습니다.'
      }
      if (!weeklySlot2Time) {
        errors.weeklySlot2Time = '두 번째 수업 시간을 선택해주세요.'
      } else if (!/^\d{2}:\d{2}$/.test(weeklySlot2Time)) {
        errors.weeklySlot2Time = '두 번째 수업 시간 형식이 올바르지 않습니다.'
      }
    }
    if (weeklyFrequency === '3') {
      if (!weeklySlot3Date) {
        errors.weeklySlot3Date = '세 번째 수업 날짜를 선택해주세요.'
      } else if (
        !/^\d{4}-\d{2}-\d{2}$/.test(weeklySlot3Date) ||
        !parseYmdToLocalDate(weeklySlot3Date)
      ) {
        errors.weeklySlot3Date = '세 번째 수업 날짜 형식이 올바르지 않습니다.'
      }
      if (!weeklySlot3Time) {
        errors.weeklySlot3Time = '세 번째 수업 시간을 선택해주세요.'
      } else if (!/^\d{2}:\d{2}$/.test(weeklySlot3Time)) {
        errors.weeklySlot3Time = '세 번째 수업 시간 형식이 올바르지 않습니다.'
      }
    }

    const slotKeys = []
    if (date && time && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)) {
      slotKeys.push(`${date} ${time}`)
    }
    if (
      (weeklyFrequency === '2' || weeklyFrequency === '3') &&
      !errors.weeklySlot2Date &&
      !errors.weeklySlot2Time &&
      weeklySlot2Date &&
      weeklySlot2Time &&
      /^\d{4}-\d{2}-\d{2}$/.test(weeklySlot2Date) &&
      /^\d{2}:\d{2}$/.test(weeklySlot2Time)
    ) {
      slotKeys.push(`${weeklySlot2Date} ${weeklySlot2Time}`)
    }
    if (
      weeklyFrequency === '3' &&
      !errors.weeklySlot3Date &&
      !errors.weeklySlot3Time &&
      weeklySlot3Date &&
      weeklySlot3Time &&
      /^\d{4}-\d{2}-\d{2}$/.test(weeklySlot3Date) &&
      /^\d{2}:\d{2}$/.test(weeklySlot3Time)
    ) {
      slotKeys.push(`${weeklySlot3Date} ${weeklySlot3Time}`)
    }
    if (slotKeys.length >= 2 && new Set(slotKeys).size !== slotKeys.length) {
      errors.scheduleSlots = '각 슬롯의 날짜·시간은 서로 달라야 합니다.'
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    studentId,
    packageId,
    date,
    time,
    subject,
    repeatWeekly,
    repeatWeeks,
    repeatStartMode,
    repeatAnchorDate,
    weeklyFrequency,
    weeklySlot2Date,
    weeklySlot2Time,
    weeklySlot3Date,
    weeklySlot3Time,
  }
}

export default function usePrivateLessonFlow({
  selectedDate,
  getStorageDateStringFromDate,
  userProfile,
  showPrivateLessonAddInCalendar,
  canEditLesson,
  sortedPrivateStudents,
  studentPackages,
  createPrivateLessonsForPackage,
  recomputePrivatePackageUsage,
}) {
  const [privateLessonModalOpen, setPrivateLessonModalOpen] = useState(false)
  const [privateLessonForm, setPrivateLessonForm] = useState(createDefaultPrivateLessonForm())
  const [privateLessonFormErrors, setPrivateLessonFormErrors] = useState({})
  const [busyPrivateLessonAdd, setBusyPrivateLessonAdd] = useState(false)

  const [privateLessonEditModal, setPrivateLessonEditModal] = useState(null)
  const [privateLessonEditForm, setPrivateLessonEditForm] = useState(
    createDefaultPrivateLessonEditForm()
  )
  const [privateLessonEditFormErrors, setPrivateLessonEditFormErrors] = useState({})
  const [busyPrivateLessonEditId, setBusyPrivateLessonEditId] = useState(null)

  const isAdmin = userProfile?.role === 'admin'

  const privateLessonEligiblePackages = useMemo(() => {
    const sid = String(privateLessonForm.studentId || '').trim()
    if (!sid) return []

    const student = sortedPrivateStudents.find((s) => s.id === sid)
    if (!student) return []

    const studentTeacherKey = normalizeText(student.teacher || '')
    const myTeacherKey = normalizeText(userProfile?.teacherName || '')

    const createdSortKey = (p) => {
      const c = p?.createdAt
      if (c && typeof c.toDate === 'function') return c.toDate().getTime()
      if (c?.seconds != null) return Number(c.seconds) * 1000
      return 0
    }

    return studentPackages
      .filter((p) => {
        if (p.packageType !== 'private') return false
        if (String(p.studentId || '').trim() !== sid) return false
        if (p.status !== 'active') return false
        if (Number(p.remainingCount ?? 0) <= 0) return false
        const pkgT = normalizeText(p.teacher || '')
        if (isAdmin) {
          if (!studentTeacherKey || pkgT !== studentTeacherKey) return false
        } else {
          if (!myTeacherKey || pkgT !== myTeacherKey) return false
        }
        return true
      })
      .sort((a, b) => {
        const byTitle = String(a.title || '').localeCompare(String(b.title || ''), 'ko')
        if (byTitle !== 0) return byTitle
        return createdSortKey(b) - createdSortKey(a)
      })
  }, [
    privateLessonForm.studentId,
    sortedPrivateStudents,
    studentPackages,
    isAdmin,
    userProfile?.teacherName,
  ])

  const privateLessonSelectedPackagePreview = useMemo(() => {
    const id = String(privateLessonForm.packageId || '').trim()
    if (!id) return null
    return privateLessonEligiblePackages.find((p) => p.id === id) || null
  }, [privateLessonForm.packageId, privateLessonEligiblePackages])

  function closePrivateLessonModal() {
    setPrivateLessonModalOpen(false)
    setPrivateLessonFormErrors({})
  }

  function openPrivateLessonModal() {
    if (!showPrivateLessonAddInCalendar) {
      alert('직접 수업 생성 권한이 없거나 승인 절차가 필요합니다.')
      return
    }
    setPrivateLessonForm(
      createDefaultPrivateLessonForm({
        date: getStorageDateStringFromDate(selectedDate),
      })
    )
    setPrivateLessonFormErrors({})
    setPrivateLessonModalOpen(true)
  }

  function validatePrivateLessonForm(form) {
    return validatePrivateLessonFormFields(form, { isAdmin })
  }

  async function submitPrivateLessonModal() {
    if (!showPrivateLessonAddInCalendar) {
      alert('직접 수업 생성 권한이 없거나 승인 절차가 필요합니다.')
      return
    }

    const result = validatePrivateLessonForm(privateLessonForm)
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

    const selectedPackage = studentPackages.find((p) => p.id === result.packageId)
    if (!selectedPackage) {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        packageId: isAdmin
          ? '등록된 수강권을 찾을 수 없습니다.'
          : '선택한 수업 등록을 찾을 수 없습니다.',
      }))
      return
    }
    if (selectedPackage.packageType !== 'private') {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        packageId: isAdmin ? '개인 수강권이 아닙니다.' : '개인 수업 등록이 아닙니다.',
      }))
      return
    }
    if (String(selectedPackage.studentId || '').trim() !== student.id) {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        packageId: isAdmin
          ? '선택한 학생과 수강권이 일치하지 않습니다.'
          : '선택한 학생과 수업 등록이 일치하지 않습니다.',
      }))
      return
    }
    if (selectedPackage.status !== 'active') {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        packageId: isAdmin
          ? '활성 수강권만 사용할 수 있습니다.'
          : '사용 가능한 등록만 선택할 수 있습니다.',
      }))
      return
    }
    if (Number(selectedPackage.remainingCount ?? 0) <= 0) {
      setPrivateLessonFormErrors((prev) => ({
        ...prev,
        packageId: isAdmin
          ? '남은 횟수가 있는 수강권을 선택해주세요.'
          : '남은 횟수가 있는 등록을 선택해주세요.',
      }))
      return
    }
    const pkgTeacher = normalizeText(selectedPackage.teacher || '')
    if (isAdmin) {
      const stTeacher = normalizeText(student.teacher || '')
      if (!stTeacher || pkgTeacher !== stTeacher) {
        setPrivateLessonFormErrors((prev) => ({
          ...prev,
          packageId: '학생 담당 선생님과 수강권의 담당 선생님이 일치하지 않습니다.',
        }))
        return
      }
    } else {
      const myT = normalizeText(userProfile?.teacherName || '')
      if (!myT || pkgTeacher !== myT) {
        setPrivateLessonFormErrors((prev) => ({
          ...prev,
          packageId: '본인 담당 등록만 사용할 수 있습니다.',
        }))
        return
      }
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
      const created = await createPrivateLessonsForPackage({
        result,
        student,
        selectedPackage,
        teacherKey,
      })
      if (!created.ok) {
        setPrivateLessonFormErrors((prev) => ({ ...prev, ...created.errors }))
        return
      }
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
    setPrivateLessonEditForm(
      createDefaultPrivateLessonEditForm({
        date: lessonDateInputValue(lesson),
        time: lessonTimeInputValue(lesson),
        subject: String(lesson.subject || '').trim(),
      })
    )
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
      setBusyPrivateLessonEditId(lesson.id)
      await updateDoc(doc(db, 'lessons', lesson.id), {
        date: result.date,
        time: result.time,
        subject: result.subject,
        startAt: Timestamp.fromDate(startDate),
        updatedAt: serverTimestamp(),
      })
      const pkgId = String(lesson.packageId || '').trim()
      if (pkgId) {
        await recomputePrivatePackageUsage(pkgId)
      }
      closePrivateLessonEditModal()
    } catch (error) {
      console.error('개인 수업 수정 실패:', error)
      alert(`개인 수업 수정 실패: ${error.message}`)
    } finally {
      setBusyPrivateLessonEditId(null)
    }
  }

  const isPrivateLessonModalSubmitting = busyPrivateLessonAdd
  const isPrivateLessonEditSubmitting = Boolean(
    privateLessonEditModal && busyPrivateLessonEditId === privateLessonEditModal.lesson.id
  )

  return {
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
    validatePrivateLessonFormFields: validatePrivateLessonForm,
    submitPrivateLessonModal,
    openPrivateLessonEditModal,
    closePrivateLessonEditModal,
    submitPrivateLessonEditModal,
    isPrivateLessonModalSubmitting,
    isPrivateLessonEditSubmitting,
  }
}
