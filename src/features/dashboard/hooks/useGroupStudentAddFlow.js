import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../../../../firebase'
import {
  getEarliestFutureGroupLessonYmdFromLessons,
  getTodayStorageDateString,
  normalizeText,
} from '../dashboardViewUtils.js'

const DEFAULT_GROUP_STUDENT_FORM = {
  packageId: '',
  startDate: '',
}

function resolveStateUpdater(updater, prev) {
  return typeof updater === 'function' ? updater(prev) : updater
}

function createDefaultGroupStudentForm(overrides = {}) {
  return {
    ...DEFAULT_GROUP_STUDENT_FORM,
    ...overrides,
  }
}

function validateGroupStudentFormFields(form, options = {}) {
  const { isAdmin = false } = options
  const errors = {}
  const packageId = String(form?.packageId || '').trim()
  if (!packageId) {
    errors.packageId = isAdmin
      ? '사용할 그룹 수강권을 선택해주세요.'
      : '사용할 등록을 선택해주세요.'
  }

  const dateStr = String(form?.startDate || '').trim()
  if (!dateStr) {
    errors.startDate = '시작일을 선택해주세요.'
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    errors.startDate = '시작일 형식이 올바르지 않습니다.'
  } else {
    const [year, month, day] = dateStr.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      errors.startDate = '유효한 날짜를 선택해주세요.'
    }
  }

  let startTimestamp = null
  if (!errors.startDate && dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number)
    startTimestamp = Timestamp.fromDate(new Date(year, month - 1, day))
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    packageId,
    startDate: startTimestamp,
  }
}

export default function useGroupStudentAddFlow({
  activeSection,
  userProfile,
  selectedGroupClass,
  studentPackages,
  groupStudents,
  groupLessons,
}) {
  const [groupStudentAddModalOpen, setGroupStudentAddModalOpen] = useState(false)
  const [groupStudentForm, setGroupStudentFormState] = useState(
    createDefaultGroupStudentForm()
  )
  const [groupStudentFormErrors, setGroupStudentFormErrors] = useState({})
  const [busyGroupStudentId, setBusyGroupStudentId] = useState(null)

  const isAdmin = userProfile?.role === 'admin'
  const canAddStudent = isAdmin || userProfile?.canAddStudent === true

  useEffect(() => {
    if (activeSection !== 'groups') {
      setGroupStudentAddModalOpen(false)
      setGroupStudentFormErrors({})
    }
  }, [activeSection])

  useEffect(() => {
    if (!groupStudentAddModalOpen) return

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setGroupStudentAddModalOpen(false)
        setGroupStudentFormErrors({})
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupStudentAddModalOpen])

  const groupStudentEligiblePackages = useMemo(() => {
    const groupId = selectedGroupClass?.id
    if (!groupId) return []

    return studentPackages
      .filter((pkg) => {
        if (pkg.packageType !== 'group') return false
        if (String(pkg.groupClassId || '') !== String(groupId)) return false
        if (pkg.status !== 'active') return false
        if (Number(pkg.remainingCount || 0) <= 0) return false
        return true
      })
      .sort((a, b) => {
        const byStudent = String(a.studentName || '').localeCompare(
          String(b.studentName || ''),
          'ko'
        )
        if (byStudent !== 0) return byStudent
        return String(a.title || '').localeCompare(String(b.title || ''), 'ko')
      })
  }, [studentPackages, selectedGroupClass?.id])

  const groupStudentSelectedPackagePreview = useMemo(() => {
    return groupStudentForm.packageId
      ? studentPackages.find((pkg) => pkg.id === groupStudentForm.packageId) || null
      : null
  }, [groupStudentForm.packageId, studentPackages])

  const isGroupStudentModalSubmitting = busyGroupStudentId === '__add__'

  function setGroupStudentForm(updater) {
    setGroupStudentFormState((prev) => resolveStateUpdater(updater, prev))
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

    setGroupStudentFormState(createDefaultGroupStudentForm())
    setGroupStudentFormErrors({})
    setGroupStudentAddModalOpen(true)
  }

  async function submitGroupStudentAdd() {
    if (!selectedGroupClass?.id) return

    if (!canAddStudent) {
      alert('학생 추가 권한이 없습니다.')
      return
    }

    const result = validateGroupStudentFormFields(groupStudentForm, { isAdmin })
    setGroupStudentFormErrors(result.errors)
    if (!result.valid || !result.startDate) return

    const selectedPackage = studentPackages.find((pkg) => pkg.id === result.packageId)
    if (!selectedPackage) {
      alert(
        isAdmin
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
        isAdmin
          ? '이 그룹에서 사용할 수 없는 수강권입니다.'
          : '이 그룹에서 사용할 수 없는 등록입니다.'
      )
      return
    }

    if (Number(selectedPackage.remainingCount || 0) <= 0) {
      alert(isAdmin ? '남은 횟수가 없는 수강권입니다.' : '남은 횟수가 없습니다.')
      return
    }

    const studentId = String(selectedPackage.studentId || '').trim()
    if (!studentId) {
      alert(
        isAdmin ? '수강권에 연결된 학생이 없습니다.' : '등록에 학생 연결이 없습니다.'
      )
      return
    }

    if (
      groupStudents.some(
        (groupStudent) =>
          String(groupStudent.studentId || '').trim() === studentId &&
          String(groupStudent.groupClassId || '') === String(selectedGroupClass.id) &&
          String(groupStudent.status || 'active') === 'active'
      )
    ) {
      alert('이미 이 그룹에 등록된 학생입니다.')
      return
    }

    const dateStrYmd = String(groupStudentForm.startDate || '').trim()
    const packageRegistrationYmd = String(selectedPackage.registrationStartDate || '').trim()
    const extraStartErrors = {}
    if (/^\d{4}-\d{2}-\d{2}$/.test(packageRegistrationYmd) && dateStrYmd < packageRegistrationYmd) {
      extraStartErrors.startDate =
        '등록 시작일은 수강권 시작일보다 이를 수 없습니다.'
    }
    if (!extraStartErrors.startDate) {
      const earliestGroupLessonYmd = getEarliestFutureGroupLessonYmdFromLessons({
        groupClassId: selectedGroupClass.id,
        groupLessons,
        todayYmd: getTodayStorageDateString(),
      })
      if (/^\d{4}-\d{2}-\d{2}$/.test(earliestGroupLessonYmd) && dateStrYmd < earliestGroupLessonYmd) {
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

  return {
    groupStudentAddModalOpen,
    groupStudentForm,
    setGroupStudentForm,
    groupStudentFormErrors,
    busyGroupStudentId,
    groupStudentEligiblePackages,
    groupStudentSelectedPackagePreview,
    openGroupStudentAddModal,
    closeGroupStudentAddModal,
    submitGroupStudentAdd,
    isGroupStudentModalSubmitting,
  }
}
