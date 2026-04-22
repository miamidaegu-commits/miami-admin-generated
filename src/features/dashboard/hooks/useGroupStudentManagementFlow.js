import { useState } from 'react'
import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../../../firebase'
import {
  getGroupStudentExcludedDatesArray,
  groupStudentDateValueToYmd,
  groupStudentStartDateToYmd,
  normalizeGroupStudentOperationalStatus,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'

const DEFAULT_GROUP_STUDENT_MANAGE_FORM = {
  startDateStr: '',
  studentStatus: 'active',
  breakStartStr: '',
  breakEndStr: '',
  excludedDates: [],
  excludeAddInput: '',
}

function resolveStateUpdater(updater, prev) {
  return typeof updater === 'function' ? updater(prev) : updater
}

function createDefaultGroupStudentManageForm(groupStudent) {
  return {
    ...DEFAULT_GROUP_STUDENT_MANAGE_FORM,
    startDateStr: groupStudentStartDateToYmd(groupStudent) || '',
    studentStatus:
      normalizeGroupStudentOperationalStatus(groupStudent) === 'onBreak' ? 'onBreak' : 'active',
    breakStartStr: groupStudentDateValueToYmd(groupStudent?.breakStartDate) || '',
    breakEndStr: groupStudentDateValueToYmd(groupStudent?.breakEndDate) || '',
    excludedDates: getGroupStudentExcludedDatesArray(groupStudent),
  }
}

function clearErrors(prev, keys) {
  const next = { ...prev }
  keys.forEach((key) => {
    delete next[key]
  })
  return next
}

function normalizeExcludedDates(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  raw.forEach((value) => {
    const t = String(value ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !parseYmdToLocalDate(t)) return
    if (seen.has(t)) return
    seen.add(t)
    out.push(t)
  })
  out.sort()
  return out
}

function validateGroupStudentManageForm(form) {
  const errors = {}
  const startDateStr = String(form?.startDateStr || '').trim()
  const studentStatus = form?.studentStatus === 'onBreak' ? 'onBreak' : 'active'
  const breakStartStr = String(form?.breakStartStr || '').trim()
  const breakEndStr = String(form?.breakEndStr || '').trim()

  if (!startDateStr) {
    errors.startDate = '시작일을 선택해주세요.'
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
    errors.startDate = '시작일 형식이 올바르지 않습니다.'
  } else if (!parseYmdToLocalDate(startDateStr)) {
    errors.startDate = '유효한 날짜를 선택해주세요.'
  }

  if (studentStatus === 'onBreak') {
    if (!breakStartStr) errors.breakStartDate = '휴원 시작일을 입력해주세요.'
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(breakStartStr) || !parseYmdToLocalDate(breakStartStr)) {
      errors.breakStartDate = '유효한 날짜를 입력해주세요.'
    }

    if (!breakEndStr) errors.breakEndDate = '휴원 종료일을 입력해주세요.'
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(breakEndStr) || !parseYmdToLocalDate(breakEndStr)) {
      errors.breakEndDate = '유효한 날짜를 입력해주세요.'
    }

    if (
      !errors.breakStartDate &&
      !errors.breakEndDate &&
      breakStartStr &&
      breakEndStr &&
      breakStartStr > breakEndStr
    ) {
      errors.breakEndDate = '휴원 종료일은 시작일 이후여야 합니다.'
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    startDateStr,
    studentStatus,
    breakStartStr,
    breakEndStr,
    excludedDates: normalizeExcludedDates(form?.excludedDates),
  }
}

export default function useGroupStudentManagementFlow({ userProfile }) {
  const [groupStudentManageModal, setGroupStudentManageModal] = useState(null)
  const [groupStudentManageForm, setGroupStudentManageFormState] = useState(
    DEFAULT_GROUP_STUDENT_MANAGE_FORM
  )
  const [groupStudentManageFormErrors, setGroupStudentManageFormErrors] = useState({})
  const [busyGroupStudentManageId, setBusyGroupStudentManageId] = useState(null)

  const isGroupStudentManageSubmitting =
    Boolean(groupStudentManageModal?.id) &&
    busyGroupStudentManageId === String(groupStudentManageModal.id)

  function setGroupStudentManageForm(updater) {
    setGroupStudentManageFormState((prev) => resolveStateUpdater(updater, prev))
  }

  function openGroupStudentManageModal(groupStudent) {
    if (userProfile?.role !== 'admin') return
    setGroupStudentManageModal(groupStudent)
    setGroupStudentManageFormState(createDefaultGroupStudentManageForm(groupStudent))
    setGroupStudentManageFormErrors({})
  }

  function closeGroupStudentManageModal() {
    if (busyGroupStudentManageId) return
    setGroupStudentManageModal(null)
    setGroupStudentManageFormErrors({})
  }

  function updateGroupStudentManageField(field, value) {
    setGroupStudentManageFormState((prev) => ({ ...prev, [field]: value }))

    if (field === 'startDateStr') {
      setGroupStudentManageFormErrors((prev) => clearErrors(prev, ['startDate']))
      return
    }
    if (field === 'breakStartStr') {
      setGroupStudentManageFormErrors((prev) => clearErrors(prev, ['breakStartDate']))
      return
    }
    if (field === 'breakEndStr') {
      setGroupStudentManageFormErrors((prev) => clearErrors(prev, ['breakEndDate']))
      return
    }
    if (field === 'studentStatus') {
      setGroupStudentManageFormErrors((prev) =>
        clearErrors(prev, ['breakStartDate', 'breakEndDate'])
      )
      return
    }
    if (field === 'excludeAddInput') {
      setGroupStudentManageFormErrors((prev) => clearErrors(prev, ['excludeAdd']))
    }
  }

  function addGroupStudentManageExcludedDate() {
    const nextDate = String(groupStudentManageForm.excludeAddInput || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || !parseYmdToLocalDate(nextDate)) {
      setGroupStudentManageFormErrors((prev) => ({
        ...prev,
        excludeAdd: 'yyyy-MM-dd 형식으로 입력해주세요.',
      }))
      return
    }

    setGroupStudentManageFormErrors((prev) => clearErrors(prev, ['excludeAdd']))
    setGroupStudentManageFormState((prev) => ({
      ...prev,
      excludedDates: prev.excludedDates.includes(nextDate)
        ? prev.excludedDates
        : [...prev.excludedDates, nextDate].sort(),
      excludeAddInput: '',
    }))
  }

  function removeGroupStudentManageExcludedDate(targetDate) {
    const dateStr = String(targetDate || '').trim()
    if (!dateStr) return
    setGroupStudentManageFormState((prev) => ({
      ...prev,
      excludedDates: prev.excludedDates.filter((value) => value !== dateStr),
    }))
  }

  async function submitGroupStudentManageModal(event) {
    if (event?.preventDefault) event.preventDefault()

    const groupStudent = groupStudentManageModal
    if (!groupStudent?.id) return
    if (userProfile?.role !== 'admin') {
      alert('관리자만 수정할 수 있습니다.')
      return
    }

    const result = validateGroupStudentManageForm(groupStudentManageForm)
    setGroupStudentManageFormErrors(result.errors)
    if (result.errors.startDate) {
      alert('시작일이 올바르지 않습니다.')
      return
    }
    if (!result.valid) return

    const [year, month, day] = result.startDateStr.split('-').map(Number)
    const startTimestamp = Timestamp.fromDate(new Date(year, month - 1, day))

    try {
      setBusyGroupStudentManageId(groupStudent.id)
      await updateDoc(doc(db, 'groupStudents', groupStudent.id), {
        startDate: startTimestamp,
        studentStatus: result.studentStatus,
        breakStartDate: result.studentStatus === 'onBreak' ? result.breakStartStr : '',
        breakEndDate: result.studentStatus === 'onBreak' ? result.breakEndStr : '',
        excludedDates: result.excludedDates,
        updatedAt: serverTimestamp(),
      })
      setGroupStudentManageModal(null)
    } catch (error) {
      console.error('그룹 학생 운영 정보 저장 실패:', error)
      alert(`저장 실패: ${error.message}`)
    } finally {
      setBusyGroupStudentManageId(null)
    }
  }

  return {
    groupStudentManageModal,
    groupStudentManageForm,
    setGroupStudentManageForm,
    groupStudentManageFormErrors,
    busyGroupStudentManageId,
    openGroupStudentManageModal,
    closeGroupStudentManageModal,
    submitGroupStudentManageModal,
    updateGroupStudentManageField,
    addGroupStudentManageExcludedDate,
    removeGroupStudentManageExcludedDate,
    isGroupStudentManageSubmitting,
  }
}
