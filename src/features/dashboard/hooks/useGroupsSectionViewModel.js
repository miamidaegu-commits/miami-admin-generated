import { useMemo } from 'react'
import {
  countWeekdayHitsInRange,
  isClassClosureCancelledGroupLesson,
  isGroupStudentOperationallyEligibleOnYmd,
  normalizeGroupWeekdaysFromDoc,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'
import { getGroupLessonSeatAvailability } from '../../booking/groupSeatAvailability.js'

/**
 * Groups 탭 전용: 반 목록/학생 목록/출석 모달에 쓰이는 파생 데이터만 담당.
 * 학생 등록 add 흐름의 상태/제출/파생값은 별도 hook으로 분리한다.
 */
export default function useGroupsSectionViewModel({
  groupClasses,
  groupStudents,
  groupLessons,
  selectedGroupClass,
  studentPackages,
  groupLessonSeriesForm,
  groupLessonSeriesModalOpen,
  groupLessonAttendanceModal,
  groupLessonReservations = [],
}) {
  const sortedGroupLessonsForSelectedClass = useMemo(() => {
    return groupLessons.filter((lesson) => !isClassClosureCancelledGroupLesson(lesson)).sort((a, b) => {
      const aKey = `${a.date || ''} ${a.time || ''}`
      const bKey = `${b.date || ''} ${b.time || ''}`
      return aKey.localeCompare(bKey)
    })
  }, [groupLessons])

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

  const groupLessonAttendanceModalRows = useMemo(() => {
    const modalLesson = groupLessonAttendanceModal?.lesson
    const gid = selectedGroupClass?.id
    if (!modalLesson?.id || !gid) return []

    const lesson =
      groupLessons.find((l) => l.id === modalLesson.id) || modalLesson

    const lessonDate = String(lesson.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate)) return []

    const countedRaw = lesson.countedStudentIDs
    const countedSet = new Set(
      Array.isArray(countedRaw) ? countedRaw.map((id) => String(id || '').trim()) : []
    )

    const eligible = groupStudents.filter((gs) => {
      if (String(gs.groupClassId || '') !== String(gid)) return false
      const pkgId = String(gs.packageId || '').trim()
      if (!pkgId) return false
      const pkg = studentPackages.find((p) => p.id === pkgId)
      if (
        !pkg ||
        pkg.packageType !== 'group' ||
        String(pkg.groupClassId || '') !== String(gid)
      ) {
        return false
      }
      if (!isGroupStudentOperationallyEligibleOnYmd(gs, lessonDate)) return false
      return true
    })

    return [...eligible]
      .sort((a, b) =>
        String(a.studentName || a.name || '').localeCompare(
          String(b.studentName || b.name || ''),
          'ko'
        )
      )
      .map((gs) => {
        const studentId = String(gs.studentId || '').trim()
        const pkg = studentPackages.find((p) => p.id === gs.packageId)
        const pkgOk = Boolean(pkg)

        const title = pkgOk ? String(pkg.title || '').trim() || '—' : '—'
        const remaining = pkgOk ? Number(pkg.remainingCount ?? 0) : 0
        const used = pkgOk ? Number(pkg.usedCount ?? 0) : 0

        const isCounted = Boolean(studentId && countedSet.has(studentId))
        const releasedStudentIds = Array.isArray(lesson.releasedFixedStudentIDs)
          ? lesson.releasedFixedStudentIDs.map((id) => String(id || '').trim())
          : []
        const isReleased = Boolean(studentId && releasedStudentIds.includes(studentId))

        let statusLabel = '미차감'
        if (isCounted) {
          statusLabel = '차감됨'
        } else if (isReleased) {
          statusLabel = '차감취소됨'
        } else if (remaining <= 0) {
          statusLabel = '남은 횟수 없음'
        }

        return {
          groupStudent: gs,
          studentId,
          packageDoc: pkgOk ? pkg : null,
          packageTitle: title,
          remainingCount: remaining,
          usedCount: used,
          isCounted,
          isReleased,
          statusLabel,
          canDeduct: pkgOk && !isCounted && remaining > 0,
          canUndo: pkgOk && isCounted && used > 0,
          canReleaseSeat: pkgOk && !isCounted && !isReleased,
          canRestoreSeat: pkgOk && isReleased,
        }
      })
  }, [
    groupLessonAttendanceModal,
    groupLessons,
    selectedGroupClass?.id,
    groupStudents,
    studentPackages,
  ])

  const groupLessonSeatAvailabilityById = useMemo(() => {
    const byId = {}
    groupLessons.forEach((lesson) => {
      const lessonDate = String(lesson.date || '').trim()
      const lessonGroupId = String(lesson.groupClassId || lesson.classID || '').trim()
      const fixedMembers = groupStudents.filter((gs) => {
        if (String(gs.groupClassId || gs.classID || '').trim() !== lessonGroupId) return false
        return isGroupStudentOperationallyEligibleOnYmd(gs, lessonDate)
      })
      const lessonReservations = groupLessonReservations.filter(
        (reservation) => reservation.lessonId === lesson.id
      )
      byId[lesson.id] = getGroupLessonSeatAvailability({
        lesson,
        fixedMembers,
        reservations: lessonReservations,
      })
    })
    return byId
  }, [groupLessons, groupStudents, groupLessonReservations])

  const groupLessonForAttendanceModal = useMemo(() => {
    const m = groupLessonAttendanceModal?.lesson
    if (!m?.id) return null
    return groupLessons.find((l) => l.id === m.id) || m
  }, [groupLessonAttendanceModal, groupLessons])

  return {
    sortedGroupLessonsForSelectedClass,
    groupLessonSeriesPlannedCount,
    sortedGroupClasses,
    sortedGroupStudentsForSelectedClass,
    groupLessonAttendanceModalRows,
    groupLessonSeatAvailabilityById,
    groupLessonForAttendanceModal,
  }
}
