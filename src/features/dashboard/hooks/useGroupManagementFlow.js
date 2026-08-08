import { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../../../firebase'
import { assertSameAcademy, requireCurrentAcademyId } from '../academyScope.js'
import {
  addCalendarDaysToYmd,
  formatLocalDateToYmd,
  getGroupLessonGroupId,
  getTodayStorageDateString,
  GROUP_CLASS_AUTO_LESSON_RANGE_LAST_OFFSET_DAYS,
  isNoDeductionCancelledGroupLesson,
  normalizeGroupWeekdaysFromDoc,
  normalizeText,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'
import {
  buildGroupClassOwnershipFields,
  resolveCanonicalTeacherSelection,
} from '../groupClassTeacherScope.js'
import { normalizeGroupCourseType } from '../../group-booking/groupCourseTypes.js'
import {
  countActiveGroupFixedMembers,
  createDefaultGroupForm,
  groupMaxStudentsToFormString,
  resolveGroupLessonSubject,
  validateGroupFormFields,
} from '../groupClassRoomUtils.js'

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
  if (
    resolveGroupLessonSubject({
      subject: currentGroup.subject,
      groupClassName: currentGroup.name,
      groupCourseType: currentGroup.groupCourseType,
    }) !== validated.subject
  ) {
    return true
  }
  if (normalizeGroupCourseType(currentGroup.groupCourseType) !== validated.groupCourseType) return true
  if (!areNormalizedGroupWeekdaysEqual(currentGroup.weekdays, validated.weekdays)) return true
  return false
}

export async function countActiveGroupFixedMembersFromDb({ academyId, groupClassId }) {
  const scopedAcademyId = requireCurrentAcademyId(academyId)
  const gid = String(groupClassId || '').trim()
  if (!gid) return 0
  const snap = await getDocs(
    query(
      collection(db, 'groupStudents'),
      where('academyId', '==', scopedAcademyId),
      where('groupClassId', '==', gid)
    )
  )
  return countActiveGroupFixedMembers(
    snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })),
    gid
  )
}

function isAdminProfile(profile) {
  return (
    profile?.role === 'admin' ||
    profile?.role === 'owner' ||
    profile?.membershipRole === 'admin' ||
    profile?.membershipRole === 'owner'
  )
}

function groupBelongsToTeacher(group, teacherIdentity) {
  return Boolean(
    teacherIdentity?.academyId &&
      teacherIdentity?.teacherUid &&
      String(group?.academyId || '').trim() === teacherIdentity.academyId &&
      String(group?.teacherUid || '').trim() === teacherIdentity.teacherUid
  )
}

function resolveGroupTeacherFormValue(group, teacherSelectOptions = []) {
  const teacherUid = String(group?.teacherUid || '').trim()
  if (!teacherUid) return ''
  const option = (Array.isArray(teacherSelectOptions) ? teacherSelectOptions : []).find(
    (candidate) =>
      String(candidate?.teacherUid || '').trim() === teacherUid &&
      String(candidate?.value || '').trim() === teacherUid
  )
  return option ? teacherUid : ''
}

function teacherIdentityChanged(group, teacherIdentity) {
  return [
    ['teacherUid', teacherIdentity.teacherUid],
    ['teacherName', teacherIdentity.teacherName],
  ].some(([key, value]) => String(group?.[key] || '').trim() !== String(value || '').trim())
}

function isFutureTeacherSyncTargetGroupLesson(lesson, groupClassId, todayYmd) {
  if (getGroupLessonGroupId(lesson) !== String(groupClassId || '').trim()) return false
  if (isNoDeductionCancelledGroupLesson(lesson)) return false
  if (lesson?.completed === true) return false
  const status = String(lesson?.status || '').trim().toLowerCase()
  if (['cancelled', 'canceled', 'deleted', 'closed'].includes(status)) return false
  const date = String(lesson?.date || '').trim()
  return !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= todayYmd
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export default function useGroupManagementFlow({
  activeSection,
  userProfile,
  currentAcademyId,
  canonicalTeacherIdentity,
  busyGroupId,
  setBusyGroupId,
  selectedDateString,
  groupLessons,
  createGroupLessonsInDateRange,
  openPostGroupScheduleRebuildModal,
  groupStudents = [],
  teacherSelectOptions = [],
  setGroupClasses,
  setSelectedGroupClass,
  setGroupLessons,
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
    if (!isAdminProfile(userProfile) && !canonicalTeacherIdentity) {
      alert('그룹 관리 권한이 없습니다.')
      return
    }

    setGroupFormState(
      createDefaultGroupForm({
        startDate: formatLocalDateToYmd(new Date()),
        teacher: canonicalTeacherIdentity?.teacherUid || '',
        status: 'active',
      })
    )
    setGroupFormErrors({})
    setGroupModal({ type: 'add' })
  }

  function openGroupEditModal(group) {
    if (!isAdminProfile(userProfile) && !groupBelongsToTeacher(group, canonicalTeacherIdentity)) {
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
        teacher:
          canonicalTeacherIdentity?.teacherUid ||
          resolveGroupTeacherFormValue(group, teacherSelectOptions),
        maxStudents: groupMaxStudentsToFormString(group.maxStudents),
        status: String(group.status || 'active').trim() === 'inactive' ? 'inactive' : 'active',
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
      activeFixedMemberCount:
        groupModal.type === 'edit'
          ? countActiveGroupFixedMembers(groupStudents, groupModal.group?.id)
          : 0,
    })
    setGroupFormErrors(result.errors)
    if (!result.valid) return

    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    let teacherIdentity
    try {
      teacherIdentity = isAdminProfile(userProfile)
        ? resolveCanonicalTeacherSelection({
            academyId: scopedAcademyId,
            selectedValue: result.teacher,
            teacherOptions: teacherSelectOptions,
          })
        : canonicalTeacherIdentity
      buildGroupClassOwnershipFields({
        academyId: scopedAcademyId,
        teacherIdentity,
        status: result.status,
      })
    } catch (error) {
      alert(error.message || '현재 학원의 활성 선생님 계정을 선택해주세요.')
      return
    }
    const teacherKey = normalizeText(teacherIdentity.teacherName)
    const canAutoCreateLessons =
      (isAdminProfile(userProfile) || userProfile?.canCreateLessonDirectly === true) &&
      userProfile?.requiresLessonApproval !== true

    if (groupModal.type === 'add') {
      if (!isAdminProfile(userProfile) && !canonicalTeacherIdentity) {
        alert('그룹 관리 권한이 없습니다.')
        return
      }
      try {
        setBusyGroupId('__add__')
        const ownershipFields = buildGroupClassOwnershipFields({
          academyId: scopedAcademyId,
          teacherIdentity,
          status: result.status,
        })
        const docRef = await addDoc(collection(db, 'groupClasses'), {
          ...ownershipFields,
          name: result.name,
          teacher: teacherKey,
          teacherKey,
          teacherId: teacherIdentity.teacherUid,
          teacherDisplayName: teacherIdentity.teacherName,
          displayName: teacherIdentity.teacherName,
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
              teacherUid: teacherIdentity.teacherUid,
              teacherName: teacherIdentity.teacherName,
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
    if (!isAdminProfile(userProfile) && !groupBelongsToTeacher(group, canonicalTeacherIdentity)) {
      alert('다른 선생님의 반은 수정할 수 없습니다.')
      return
    }
    const scheduleAffected = isGroupEditScheduleAffected(group, result)
    const teacherChanged = teacherIdentityChanged(group, teacherIdentity)

    try {
      assertSameAcademy(group, scopedAcademyId, '그룹')
      setBusyGroupId(group.id)
      const activeFixedMemberCount = await countActiveGroupFixedMembersFromDb({
        academyId: scopedAcademyId,
        groupClassId: group.id,
      })
      if (activeFixedMemberCount > result.maxStudents) {
        setGroupFormErrors((prev) => ({
          ...prev,
          maxStudents: `현재 반 등록 학생 ${activeFixedMemberCount}명보다 정원을 작게 설정할 수 없습니다.`,
        }))
        setBusyGroupId(null)
        return
      }
      const ownershipFields = buildGroupClassOwnershipFields({
        academyId: scopedAcademyId,
        teacherIdentity,
        status: result.status,
      })
      const groupClassUpdate = {
        ...ownershipFields,
        name: result.name,
        teacher: teacherKey,
        teacherKey,
        teacherId: teacherIdentity.teacherUid,
        teacherDisplayName: teacherIdentity.teacherName,
        displayName: teacherIdentity.teacherName,
        maxStudents: result.maxStudents,
        time: result.time,
        subject: result.subject,
        groupCourseType: result.groupCourseType,
        weekdays: result.weekdays,
        recurrenceMode: result.recurrenceMode,
        updatedAt: serverTimestamp(),
      }
      await updateDoc(doc(db, 'groupClasses', group.id), groupClassUpdate)

      const savedGroup = {
        ...group,
        ...ownershipFields,
        name: result.name,
        teacher: teacherKey,
        teacherKey,
        teacherId: teacherIdentity.teacherUid,
        teacherDisplayName: teacherIdentity.teacherName,
        displayName: teacherIdentity.teacherName,
        maxStudents: result.maxStudents,
        time: result.time,
        subject: result.subject,
        groupCourseType: result.groupCourseType,
        weekdays: result.weekdays,
        recurrenceMode: result.recurrenceMode,
      }

      setGroupClasses?.((prev) =>
        (Array.isArray(prev) ? prev : []).map((row) =>
          row?.id === savedGroup.id ? { ...row, ...savedGroup } : row
        )
      )
      setSelectedGroupClass?.((prev) =>
        prev?.id === savedGroup.id ? { ...prev, ...savedGroup } : prev
      )

      if (teacherChanged) {
        const todayYmd = getTodayStorageDateString()
        const futureGroupLessonsTeacherUpdate = {
          teacher: teacherKey,
          teacherKey,
          teacherUid: teacherIdentity.teacherUid,
          teacherId: teacherIdentity.teacherUid,
          teacherName: teacherIdentity.teacherName,
          teacherDisplayName: teacherIdentity.teacherName,
          displayName: teacherIdentity.teacherName,
          updatedAt: serverTimestamp(),
        }
        const snapshots = await Promise.all([
          getDocs(
            query(
              collection(db, 'groupLessons'),
              where('academyId', '==', scopedAcademyId),
              where('groupClassId', '==', group.id)
            )
          ),
          getDocs(
            query(
              collection(db, 'groupLessons'),
              where('academyId', '==', scopedAcademyId),
              where('groupClassID', '==', group.id)
            )
          ),
        ])
        const futureGroupLessons = new Map()
        snapshots.forEach((snapshot) => {
          snapshot.docs.forEach((docItem) => {
            const lesson = { id: docItem.id, ...docItem.data() }
            if (isFutureTeacherSyncTargetGroupLesson(lesson, group.id, todayYmd)) {
              futureGroupLessons.set(docItem.id, docItem.ref)
            }
          })
        })
        for (const refs of chunkArray([...futureGroupLessons.values()], 450)) {
          const batch = writeBatch(db)
          refs.forEach((lessonRef) => batch.update(lessonRef, futureGroupLessonsTeacherUpdate))
          await batch.commit()
        }
        setGroupLessons?.((prev) =>
          (Array.isArray(prev) ? prev : []).map((lesson) =>
            isFutureTeacherSyncTargetGroupLesson(lesson, group.id, todayYmd)
              ? {
                  ...lesson,
                  teacher: teacherKey,
                  teacherKey,
                  teacherUid: teacherIdentity.teacherUid,
                  teacherId: teacherIdentity.teacherUid,
                  teacherName: teacherIdentity.teacherName,
                  teacherDisplayName: teacherIdentity.teacherName,
                  displayName: teacherIdentity.teacherName,
                }
              : lesson
          )
        )
      }

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
            teacherUid: teacherIdentity.teacherUid,
            teacherName: teacherIdentity.teacherName,
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
