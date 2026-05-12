import { useEffect, useState } from 'react'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../../../firebase'
import { assertSameAcademy, requireCurrentAcademyId } from '../academyScope.js'
import {
  addCalendarDaysToYmd,
  formatLocalDateToYmd,
  getTodayStorageDateString,
  GROUP_CLASS_AUTO_LESSON_RANGE_LAST_OFFSET_DAYS,
  normalizeGroupWeekdaysFromDoc,
  normalizeText,
  parseRequiredMinOneIntField,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'
import {
  DEFAULT_GROUP_COURSE_TYPE,
  normalizeGroupCourseType,
} from '../../group-booking/groupCourseTypes.js'

const DEFAULT_GROUP_FORM = {
  name: '',
  teacher: '',
  maxStudents: '1',
  startDate: '',
  time: '',
  subject: '',
  groupCourseType: DEFAULT_GROUP_COURSE_TYPE,
  weekdays: [],
  recurrenceMode: 'fixedWeekdays',
  rebuildFutureLessons: false,
  rebuildFromDate: '',
}

function resolveStateUpdater(updater, prev) {
  return typeof updater === 'function' ? updater(prev) : updater
}

function areNormalizedGroupWeekdaysEqual(rawA, rawB) {
  const a = normalizeGroupWeekdaysFromDoc(rawA)
  const b = normalizeGroupWeekdaysFromDoc(rawB)
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function isGroupEditScheduleAffected(group, validated) {
  const currentGroup = group || {}
  if (String(currentGroup.time || '').trim() !== validated.time) return true
  if (String(currentGroup.subject || '').trim() !== validated.subject) return true
  if (normalizeGroupCourseType(currentGroup.groupCourseType) !== validated.groupCourseType) return true
  if (!areNormalizedGroupWeekdaysEqual(currentGroup.weekdays, validated.weekdays)) return true
  return false
}

function groupMaxStudentsToFormString(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '1'
  const i = Math.trunc(n)
  return String(Math.max(1, i))
}

function createDefaultGroupForm(overrides = {}) {
  return {
    ...DEFAULT_GROUP_FORM,
    ...overrides,
  }
}

function validateGroupFormFields(form, options = {}) {
  const { forNewClass, forEdit } = options
  const errors = {}
  const name = String(form?.name || '').trim()
  const teacher = String(form?.teacher || '').trim()
  if (!name) errors.name = '이름을 입력해주세요.'
  if (!teacher) errors.teacher = '선생님 이름을 입력해주세요.'

  const maxStudents = parseRequiredMinOneIntField(form?.maxStudents)
  if (!maxStudents.ok) errors.maxStudents = '1 이상의 정수를 입력해주세요.'

  let startDate = ''
  if (forNewClass) {
    startDate = String(form?.startDate || '').trim()
    if (!startDate) {
      errors.startDate = '시작일을 선택해주세요.'
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      errors.startDate = '시작일 형식이 올바르지 않습니다.'
    } else if (!parseYmdToLocalDate(startDate)) {
      errors.startDate = '유효한 시작일을 선택해주세요.'
    }
  }

  const time = String(form?.time || '').trim()
  if (!time) {
    errors.time = '시간을 입력해주세요.'
  } else if (!/^\d{2}:\d{2}$/.test(time)) {
    errors.time = 'HH:mm 형식으로 입력해주세요.'
  } else {
    const [h, m] = time.split(':').map(Number)
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      errors.time = '유효한 시간을 입력해주세요.'
    }
  }

  const subject = String(form?.subject || '').trim()
  if (!subject) errors.subject = '과목을 입력해주세요.'
  const normalizedGroupCourseType = normalizeGroupCourseType(form?.groupCourseType)
  const groupCourseType = normalizedGroupCourseType || (forNewClass ? DEFAULT_GROUP_COURSE_TYPE : '')

  const weekdays = normalizeGroupWeekdaysFromDoc(
    Array.isArray(form?.weekdays) ? form.weekdays : []
  )
  if (weekdays.length === 0) {
    errors.weekdays = '요일을 1개 이상 선택해주세요.'
  }

  const recurrenceMode =
    form?.recurrenceMode === 'fixedWeekdays' ? 'fixedWeekdays' : 'fixedWeekdays'

  let rebuildFutureLessons = false
  let rebuildFromDate = ''
  if (forEdit) {
    rebuildFutureLessons = Boolean(form?.rebuildFutureLessons)
    if (rebuildFutureLessons) {
      rebuildFromDate = String(form?.rebuildFromDate || '').trim()
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
    time,
    subject,
    groupCourseType,
    weekdays,
    recurrenceMode,
    rebuildFutureLessons,
    rebuildFromDate,
  }
}

function isAdminProfile(profile) {
  return (
    profile?.role === 'admin' ||
    profile?.role === 'owner' ||
    profile?.membershipRole === 'admin' ||
    profile?.membershipRole === 'owner'
  )
}

function getTeacherOwnGroupKey(profile) {
  if (String(profile?.role || '').trim().toLowerCase() !== 'teacher') return ''
  return normalizeText(profile?.teacherName || '')
}

function groupBelongsToTeacher(group, teacherKey) {
  if (!teacherKey) return false
  return (
    normalizeText(group?.teacher || '') === teacherKey ||
    normalizeText(group?.teacherName || '') === teacherKey
  )
}

export default function useGroupManagementFlow({
  activeSection,
  userProfile,
  currentAcademyId,
  busyGroupId,
  setBusyGroupId,
  selectedDateString,
  groupLessons,
  createGroupLessonsInDateRange,
  openPostGroupScheduleRebuildModal,
}) {
  const [groupModal, setGroupModal] = useState(null)
  const [groupForm, setGroupFormState] = useState(createDefaultGroupForm())
  const [groupFormErrors, setGroupFormErrors] = useState({})

  useEffect(() => {
    if (activeSection !== 'groups') {
      setGroupModal(null)
      setGroupFormErrors({})
    }
  }, [activeSection])

  useEffect(() => {
    if (!groupModal) return

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setGroupModal(null)
        setGroupFormErrors({})
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupModal])

  const isGroupModalSubmitting =
    Boolean(groupModal) &&
    (groupModal.type === 'add'
      ? busyGroupId === '__add__'
      : busyGroupId === groupModal.group.id)

  function setGroupForm(updater) {
    setGroupFormState((prev) => resolveStateUpdater(updater, prev))
  }

  function closeGroupModal() {
    setGroupModal(null)
    setGroupFormErrors({})
  }

  function openGroupAddModal() {
    const teacherKey = getTeacherOwnGroupKey(userProfile)
    if (!isAdminProfile(userProfile) && !teacherKey) {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    setGroupFormState(
      createDefaultGroupForm({
        startDate: formatLocalDateToYmd(new Date()),
        teacher: teacherKey || '',
      })
    )
    setGroupFormErrors({})
    setGroupModal({ type: 'add' })
  }

  function openGroupEditModal(group) {
    const teacherKey = getTeacherOwnGroupKey(userProfile)
    if (!isAdminProfile(userProfile) && !groupBelongsToTeacher(group, teacherKey)) {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    const todayYmd = getTodayStorageDateString()
    const selectedYmd = String(selectedDateString || '').trim()
    const defaultRebuildFrom =
      selectedYmd &&
      /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd) &&
      parseYmdToLocalDate(selectedYmd) &&
      selectedYmd >= todayYmd
        ? selectedYmd
        : todayYmd

    setGroupFormState(
      createDefaultGroupForm({
        name: group.name || '',
        teacher: teacherKey || group.teacher || group.teacherName || '',
        maxStudents: groupMaxStudentsToFormString(group.maxStudents),
        time: String(group.time || '').trim(),
        subject: String(group.subject || '').trim(),
        groupCourseType: normalizeGroupCourseType(group.groupCourseType),
        weekdays: normalizeGroupWeekdaysFromDoc(group.weekdays),
        rebuildFromDate: defaultRebuildFrom,
      })
    )
    setGroupFormErrors({})
    setGroupModal({ type: 'edit', group })
  }

  async function submitGroupModal() {
    if (!groupModal) return

    const result = validateGroupFormFields(groupForm, {
      forNewClass: groupModal.type === 'add',
      forEdit: groupModal.type === 'edit',
    })
    setGroupFormErrors(result.errors)
    if (!result.valid) return

    const teacherOwnKey = getTeacherOwnGroupKey(userProfile)
    const teacherKey = teacherOwnKey || normalizeText(result.teacher)
    const canAutoCreateLessons =
      (isAdminProfile(userProfile) || userProfile?.canCreateLessonDirectly === true) &&
      userProfile?.requiresLessonApproval !== true

    if (groupModal.type === 'add') {
      if (!isAdminProfile(userProfile) && !teacherOwnKey) {
        alert('그룹 관리 권한이 없습니다.')
        return
      }
      try {
        const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
        setBusyGroupId('__add__')
        const docRef = await addDoc(collection(db, 'groupClasses'), {
          academyId: scopedAcademyId,
          name: result.name,
          teacher: teacherKey,
          teacherName: teacherKey,
          maxStudents: result.maxStudents,
          time: result.time,
          subject: result.subject,
          groupCourseType: result.groupCourseType,
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
              academyId: scopedAcademyId,
              groupClassId: newId,
              groupClassName: result.name,
              teacher: teacherKey,
              time: result.time,
              subject: result.subject,
              groupCourseType: result.groupCourseType,
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
    if (!isAdminProfile(userProfile) && !groupBelongsToTeacher(group, teacherOwnKey)) {
      alert('다른 선생님의 반은 수정할 수 없습니다.')
      return
    }
    const scheduleAffected = isGroupEditScheduleAffected(group, result)

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(group, scopedAcademyId, '그룹')
      setBusyGroupId(group.id)
      await updateDoc(doc(db, 'groupClasses', group.id), {
        name: result.name,
        teacher: teacherKey,
        teacherName: teacherKey,
        maxStudents: result.maxStudents,
        time: result.time,
        subject: result.subject,
        groupCourseType: result.groupCourseType,
        weekdays: result.weekdays,
        recurrenceMode: result.recurrenceMode,
        updatedAt: serverTimestamp(),
      })
      closeGroupModal()
      if (
        scheduleAffected &&
        isAdminProfile(userProfile) &&
        result.rebuildFutureLessons
      ) {
        const fromYmd = String(result.rebuildFromDate || '').trim()
        openPostGroupScheduleRebuildModal(
          {
            groupId: group.id,
            groupName: result.name,
            oldTime: String(group.time || '').trim(),
            oldSubject: String(group.subject || '').trim(),
            oldWeekdays: normalizeGroupWeekdaysFromDoc(group.weekdays),
            newTime: result.time,
            newSubject: result.subject,
            newGroupCourseType: result.groupCourseType,
            newWeekdays: result.weekdays,
            maxStudents: result.maxStudents,
            teacher: teacherKey,
            requestedFromDate: fromYmd,
          },
          fromYmd
        )
      }
    } catch (error) {
      console.error('그룹 수정 실패:', error)
      alert(`그룹 수정 실패: ${error.message}`)
    } finally {
      setBusyGroupId(null)
    }
  }

  return {
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
  }
}
