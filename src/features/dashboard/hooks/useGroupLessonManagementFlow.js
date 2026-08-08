import { useEffect, useState } from 'react'
import {
  doc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../../../firebase'
import { assertSameAcademy, requireCurrentAcademyId } from '../academyScope.js'
import {
  formatLocalDateToYmd,
  getGroupLessonGroupId,
  normalizeGroupWeekdaysFromDoc,
  normalizeText,
  parseYmdToLocalDate,
  validateLessonDateTimeSubject,
} from '../dashboardViewUtils.js'
import { normalizeGroupCourseType } from '../../group-booking/groupCourseTypes.js'
import { resolveGroupLessonSubject } from '../groupClassRoomUtils.js'
import { buildGroupLessonCanonicalFields } from '../groupClassTeacherScope.js'

const DEFAULT_GROUP_LESSON_FORM = {
  date: '',
  time: '',
  subject: '',
  capacity: '',
  isBookable: false,
}

const DEFAULT_GROUP_LESSON_SERIES_FORM = {
  startDate: '',
  endDate: '',
}

function createDefaultGroupLessonForm(overrides = {}) {
  return {
    ...DEFAULT_GROUP_LESSON_FORM,
    ...overrides,
  }
}

function createDefaultGroupLessonSeriesForm(overrides = {}) {
  return {
    ...DEFAULT_GROUP_LESSON_SERIES_FORM,
    ...overrides,
  }
}

function assertTeacherOwnsSelectedGroupClass({
  userProfile,
  canonicalTeacherIdentity,
  selectedGroupClass,
}) {
  if (String(userProfile?.role || '').trim().toLowerCase() !== 'teacher') return
  if (
    !canonicalTeacherIdentity ||
    String(selectedGroupClass?.academyId || '').trim() !== canonicalTeacherIdentity.academyId ||
    String(selectedGroupClass?.teacherUid || '').trim() !== canonicalTeacherIdentity.teacherUid
  ) {
    throw new Error('현재 교사 계정에 속한 단체반만 변경할 수 있습니다.')
  }
}

function resetGroupLessonPurgeState(setGroupLessonPurgeModalOpen, setGroupLessonPurgeFromDate, setGroupLessonPurgeFormErrors) {
  setGroupLessonPurgeModalOpen(false)
  setGroupLessonPurgeFromDate('')
  setGroupLessonPurgeFormErrors({})
}

export function validateGroupLessonFormFields(form) {
  const base = validateLessonDateTimeSubject(form, { requireSubject: false })
  const errors = { ...base.errors }
  const capacityRaw = String(form.capacity ?? '').trim()
  const capacity = Number(capacityRaw)

  if (!capacityRaw) errors.capacity = '정원을 입력해주세요.'
  else if (!Number.isInteger(capacity) || capacity < 0) {
    errors.capacity = '정원은 0 이상의 정수여야 합니다.'
  }

  return {
    ...base,
    valid: Object.keys(errors).length === 0,
    errors,
    capacity: Number.isInteger(capacity) && capacity >= 0 ? capacity : 0,
    isBookable: form.isBookable === true,
  }
}

export function validateGroupLessonSeriesFormFields(form) {
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

export default function useGroupLessonManagementFlow({
  activeSection,
  userProfile,
  currentAcademyId,
  canonicalTeacherIdentity,
  selectedGroupClass,
  groupLessons,
  createGroupLessonsInDateRange,
}) {
  const [groupLessonModal, setGroupLessonModal] = useState(null)
  const [groupLessonForm, setGroupLessonForm] = useState(createDefaultGroupLessonForm())
  const [groupLessonFormErrors, setGroupLessonFormErrors] = useState({})
  const [busyGroupLessonId, setBusyGroupLessonId] = useState(null)

  const [groupLessonSeriesModalOpen, setGroupLessonSeriesModalOpen] = useState(false)
  const [groupLessonSeriesForm, setGroupLessonSeriesForm] = useState(
    createDefaultGroupLessonSeriesForm()
  )
  const [groupLessonSeriesFormErrors, setGroupLessonSeriesFormErrors] = useState({})
  const [busyGroupLessonSeries, setBusyGroupLessonSeries] = useState(false)

  const [groupLessonPurgeModalOpen, setGroupLessonPurgeModalOpen] = useState(false)
  const [groupLessonPurgeFromDate, setGroupLessonPurgeFromDate] = useState('')
  const [groupLessonPurgeFormErrors, setGroupLessonPurgeFormErrors] = useState({})
  const [busyGroupLessonPurge, setBusyGroupLessonPurge] = useState(false)

  const isGroupLessonModalSubmitting =
    Boolean(groupLessonModal) &&
    (groupLessonModal.type === 'add'
      ? busyGroupLessonId === '__add__'
      : busyGroupLessonId === groupLessonModal.lesson.id)

  const isGroupLessonSeriesSubmitting = busyGroupLessonSeries

  useEffect(() => {
    if (activeSection === 'groups') return

    setGroupLessonModal(null)
    setGroupLessonFormErrors({})
    setGroupLessonSeriesModalOpen(false)
    setGroupLessonSeriesFormErrors({})
    resetGroupLessonPurgeState(
      setGroupLessonPurgeModalOpen,
      setGroupLessonPurgeFromDate,
      setGroupLessonPurgeFormErrors
    )
  }, [activeSection])

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

    setGroupLessonForm(
      createDefaultGroupLessonForm({
        capacity: String(selectedGroupClass?.maxStudents ?? 0),
        subject: resolveGroupLessonSubject({
          subject: selectedGroupClass?.subject,
          groupClassName: selectedGroupClass?.name,
          groupCourseType: selectedGroupClass?.groupCourseType,
        }),
        isBookable: false,
      })
    )
    setGroupLessonFormErrors({})
    setGroupLessonModal({ type: 'add' })
  }

  function openGroupLessonEditModal(lesson) {
    if (!(userProfile?.role === 'admin' || userProfile?.canEditLesson === true)) {
      alert('수업 수정 권한이 없습니다.')
      return
    }

    setGroupLessonForm(
      createDefaultGroupLessonForm({
        date: lesson.date || '',
        time: lesson.time || '',
        subject: lesson.subject || '',
        capacity: String(lesson.capacity ?? selectedGroupClass?.maxStudents ?? 0),
        isBookable: lesson.isBookable === true,
      })
    )
    setGroupLessonFormErrors({})
    setGroupLessonModal({ type: 'edit', lesson })
  }

  async function submitGroupLessonModal() {
    if (!selectedGroupClass?.id) return
    if (!groupLessonModal) return

    if (groupLessonModal.type === 'add') {
      const canCreateDirectly =
        userProfile?.role === 'admin' || userProfile?.canCreateLessonDirectly === true
      const requiresApproval = userProfile?.requiresLessonApproval === true
      if (!canCreateDirectly || requiresApproval) {
        alert('직접 수업 생성 권한이 없거나 승인 절차가 필요합니다.')
        return
      }
    }

    const result = validateGroupLessonFormFields(groupLessonForm)
    setGroupLessonFormErrors(result.errors)
    if (!result.valid) return
    const resolvedSubject = resolveGroupLessonSubject({
      subject: result.subject,
      groupClassName: selectedGroupClass.name,
      groupCourseType: selectedGroupClass.groupCourseType,
    })

    if (groupLessonModal.type === 'add') {
      try {
        const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
        assertSameAcademy(selectedGroupClass, scopedAcademyId, '그룹')
        assertTeacherOwnsSelectedGroupClass({
          userProfile,
          canonicalTeacherIdentity,
          selectedGroupClass,
        })
        setBusyGroupLessonId('__add__')
        const canonicalFields = buildGroupLessonCanonicalFields({
          academyId: scopedAcademyId,
          groupClass: selectedGroupClass,
          date: result.date,
          time: result.time,
          status: 'scheduled',
        })
        const lessonRef = doc(db, 'groupLessons', canonicalFields.occurrenceId)
        await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(lessonRef)
          if (existing.exists()) {
            throw new Error('같은 반·날짜·시간의 수업이 이미 있습니다.')
          }
          transaction.set(lessonRef, {
            ...canonicalFields,
            groupClassName: selectedGroupClass.name || '',
            teacher: normalizeText(selectedGroupClass.teacher || ''),
            teacherName: String(selectedGroupClass.teacherName || '').trim(),
            subject: resolvedSubject,
            ...(() => {
              const groupCourseType = normalizeGroupCourseType(selectedGroupClass.groupCourseType)
              return groupCourseType ? { groupCourseType } : {}
            })(),
            completed: false,
            countedStudentIDs: [],
            attendanceAppliedAt: null,
            bookingMode: 'fixed',
            capacity: result.capacity,
            bookedCount: 0,
            isBookable: result.isBookable,
            generationKind: 'manual',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
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
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(selectedGroupClass, scopedAcademyId, '그룹')
      assertSameAcademy(lesson, scopedAcademyId, '그룹 수업')
      assertTeacherOwnsSelectedGroupClass({
        userProfile,
        canonicalTeacherIdentity,
        selectedGroupClass,
      })
      const bookedCount = Number(lesson.bookedCount ?? 0)
      if (Number.isFinite(bookedCount) && result.capacity < bookedCount) {
        setGroupLessonFormErrors((prev) => ({
          ...prev,
          capacity: '정원은 현재 예약 수보다 작을 수 없습니다.',
        }))
        return
      }
      setBusyGroupLessonId(lesson.id)
      const canonicalFields = buildGroupLessonCanonicalFields({
        academyId: scopedAcademyId,
        groupClass: selectedGroupClass,
        date: result.date,
        time: result.time,
        status: String(lesson.status || '').trim() || 'scheduled',
      })
      const currentRef = doc(db, 'groupLessons', lesson.id)
      const canonicalRef = doc(db, 'groupLessons', canonicalFields.occurrenceId)
      await runTransaction(db, async (transaction) => {
        const currentSnapshot = await transaction.get(currentRef)
        if (!currentSnapshot.exists()) throw new Error('수정할 그룹 수업을 찾을 수 없습니다.')
        const canonicalSnapshot =
          canonicalFields.occurrenceId === lesson.id
            ? currentSnapshot
            : await transaction.get(canonicalRef)
        if (canonicalFields.occurrenceId !== lesson.id && canonicalSnapshot.exists()) {
          throw new Error('같은 반·날짜·시간의 수업이 이미 있습니다.')
        }
        const updates = {
          ...canonicalFields,
          groupClassName: selectedGroupClass.name || '',
          teacher: normalizeText(selectedGroupClass.teacher || ''),
          teacherName: String(selectedGroupClass.teacherName || '').trim(),
          subject: resolvedSubject,
          ...(() => {
            const groupCourseType = normalizeGroupCourseType(selectedGroupClass.groupCourseType)
            return groupCourseType ? { groupCourseType } : {}
          })(),
          capacity: result.capacity,
          isBookable: result.isBookable,
          updatedAt: serverTimestamp(),
        }
        if (canonicalFields.occurrenceId === lesson.id) {
          transaction.update(currentRef, updates)
          return
        }
        transaction.set(canonicalRef, { ...currentSnapshot.data(), ...updates })
        transaction.delete(currentRef)
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
    const groupCourseType = normalizeGroupCourseType(selectedGroupClass.groupCourseType)
    if (wd.length === 0 || !timeStr || !groupCourseType) {
      alert(
        '반에 요일(weekdays)·시간(time)·코스 유형이 모두 설정되어 있어야 수업 일정을 만들 수 있습니다.'
      )
      return
    }

    setGroupLessonSeriesForm(createDefaultGroupLessonSeriesForm())
    setGroupLessonSeriesFormErrors({})
    setGroupLessonSeriesModalOpen(true)
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
    const groupCourseType = normalizeGroupCourseType(gc.groupCourseType)
    if (weekdaySet.size === 0 || !timeStr || !groupCourseType) {
      alert('반 설정(요일·시간·코스 유형)을 확인해주세요.')
      return
    }

    let created = 0
    let skippedDup = 0

    try {
      setBusyGroupLessonSeries(true)
      assertSameAcademy(gc, currentAcademyId, '그룹')
      assertTeacherOwnsSelectedGroupClass({
        userProfile,
        canonicalTeacherIdentity,
        selectedGroupClass: gc,
      })
      const batchResult = await createGroupLessonsInDateRange({
        academyId: currentAcademyId,
        groupClassId: gc.id,
        groupClassName: gc.name || '',
        teacher: gc.teacher,
        teacherUid: gc.teacherUid,
        teacherName: gc.teacherName,
        time: gc.time,
        subject: resolveGroupLessonSubject({
          subject: gc.subject,
          groupClassName: gc.name,
          groupCourseType,
        }),
        groupCourseType: gc.groupCourseType,
        weekdays: gc.weekdays,
        maxStudents: gc.maxStudents,
        startYmd: result.startDate,
        endYmd: result.endDate,
        existingLessons: groupLessons,
      })
      created = batchResult.created
      skippedDup = batchResult.skippedDup

      alert(`추가 일정 생성 완료: ${created}건 생성, 중복 건너뜀 ${skippedDup}건`)
      closeGroupLessonSeriesModal()
    } catch (error) {
      console.error('추가 일정 생성 실패:', error)
      alert(`추가 일정 생성 실패: ${error.message}`)
    } finally {
      setBusyGroupLessonSeries(false)
    }
  }

  function closeGroupLessonPurgeModal() {
    resetGroupLessonPurgeState(
      setGroupLessonPurgeModalOpen,
      setGroupLessonPurgeFromDate,
      setGroupLessonPurgeFormErrors
    )
  }

  function openGroupLessonPurgeModal() {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 사용할 수 있습니다.')
      return
    }
    if (!selectedGroupClass?.id) return
    setGroupLessonPurgeFromDate(formatLocalDateToYmd(new Date()))
    setGroupLessonPurgeFormErrors({})
    setGroupLessonPurgeModalOpen(true)
  }

  async function submitGroupLessonPurgeFromDate() {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 사용할 수 있습니다.')
      return
    }
    if (!selectedGroupClass?.id) return

    const fromD = String(groupLessonPurgeFromDate || '').trim()
    if (!fromD) {
      setGroupLessonPurgeFormErrors({ purgeDate: '기준일을 선택해주세요.' })
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromD) || !parseYmdToLocalDate(fromD)) {
      setGroupLessonPurgeFormErrors({ purgeDate: '유효한 기준일을 선택해주세요.' })
      return
    }
    setGroupLessonPurgeFormErrors({})

    const gid = String(selectedGroupClass.id)
    const toDelete = groupLessons.filter(
      (gl) =>
        Boolean(gl?.id) &&
        getGroupLessonGroupId(gl) === gid &&
        String(gl.date || '').trim() >= fromD
    )

    if (toDelete.length === 0) {
      alert('선택한 기준일 이후(포함)로 삭제할 수업 일정이 없습니다.')
      return
    }

    const classLabel = selectedGroupClass.name || '-'
    if (
      !window.confirm(
        `「${classLabel}」 반의 수업 일정 중,\n기준일 ${fromD} 이후(당일 포함) ${toDelete.length}건을 삭제합니다.\n\n지난 일정(기준일 이전)은 그대로 둡니다.\n이 작업은 되돌릴 수 없습니다. 계속할까요?`
      )
    ) {
      return
    }

    const chunkSize = 400
    let deleted = 0

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(selectedGroupClass, scopedAcademyId, '그룹')
      setBusyGroupLessonPurge(true)
      for (let i = 0; i < toDelete.length; i += chunkSize) {
        const batch = writeBatch(db)
        const chunk = toDelete.slice(i, i + chunkSize)
        for (const gl of chunk) {
          assertSameAcademy(gl, scopedAcademyId, '그룹 수업')
          batch.delete(doc(db, 'groupLessons', gl.id))
        }
        await batch.commit()
        deleted += chunk.length
      }
      closeGroupLessonPurgeModal()
      alert(`기준일 이후(포함) 그룹 수업 일정 삭제 완료: ${deleted}건`)
    } catch (error) {
      console.error('그룹 수업 일괄 삭제 실패:', error)
      alert(`삭제 실패: ${error.message}`)
    } finally {
      setBusyGroupLessonPurge(false)
    }
  }

  return {
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
  }
}
