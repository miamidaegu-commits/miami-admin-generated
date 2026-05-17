import { useMemo } from 'react'
import {
  countWeekdayHitsInRange,
  getGroupLessonGroupId,
  isGroupStudentOperationallyEligibleOnYmd,
  normalizeGroupWeekdaysFromDoc,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'

/**
 * Groups 탭 전용: 반 목록/학생 목록/출석 모달에 쓰이는 파생 데이터만 담당.
 * 학생 등록 add 흐름의 상태/제출/파생값은 별도 hook으로 분리한다.
 */
export default function useGroupsSectionViewModel({
  groupClasses,
  groupStudents,
  groupLessons,
  groupLessonReservations,
  selectedGroupClass,
  studentPackages,
  groupLessonSeriesForm,
  groupLessonSeriesModalOpen,
  groupLessonAttendanceModal,
}) {
  const sortedGroupLessonsForSelectedClass = useMemo(() => {
    const reservations = Array.isArray(groupLessonReservations) ? groupLessonReservations : []
    return [...groupLessons].map((lesson) => {
      const lessonDate = String(lesson.date || '').trim()
      const gid = getGroupLessonGroupId(lesson)
      const fixedCount = groupStudents.filter((gs) => {
        if (String(gs.groupClassId || gs.classID || '') !== String(gid)) return false
        return isGroupStudentOperationallyEligibleOnYmd(gs, lessonDate)
      }).length
      const activeBookedCount = reservations.filter(
        (reservation) =>
          String(reservation.lessonId || '') === String(lesson.id) &&
          String(reservation.status || '') === 'active'
      ).length
      const capacity = Number(lesson.capacity ?? 0)
      const remainingSeats = Number.isFinite(capacity)
        ? Math.max(0, capacity - fixedCount - activeBookedCount)
        : 0
      return {
        ...lesson,
        fixedStudentCount: fixedCount,
        activeReservationCount: activeBookedCount,
        remainingSeats,
      }
    }).sort((a, b) => {
      const aKey = `${a.date || ''} ${a.time || ''}`
      const bKey = `${b.date || ''} ${b.time || ''}`
      return aKey.localeCompare(bKey)
    })
  }, [groupLessons, groupStudents, groupLessonReservations])

  const groupLessonSeriesPlannedCount = useMemo(() => {
    if (!groupLessonSeriesModalOpen || !selectedGroupClass) return null
    const weekdaySet = new Set(normalizeGroupWeekdaysFromDoc(groupLessonSeriesForm.weekdays))
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
    groupLessonSeriesForm.weekdays,
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

    const fixedEligible = groupStudents.filter((gs) => {
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

    const fixedRows = [...fixedEligible]
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

        let statusLabel = '미차감'
        if (isCounted) {
          statusLabel = '차감됨'
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
          statusLabel,
          canDeduct: pkgOk && !isCounted && remaining > 0,
          canUndo: pkgOk && isCounted,
        }
      })

    const fixedStudentIds = new Set(
      fixedRows.map((row) => String(row.studentId || '').trim()).filter(Boolean)
    )
    const reservations = Array.isArray(groupLessonReservations) ? groupLessonReservations : []
    const reservationRows = reservations
      .filter((reservation) => {
        if (String(reservation.lessonId || '') !== String(lesson.id)) return false
        if (String(reservation.status || '') !== 'active') return false
        const sid = String(reservation.studentId || '').trim()
        if (!sid || fixedStudentIds.has(sid)) return false
        return true
      })
      .sort((a, b) =>
        String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ko')
      )
      .map((reservation) => {
        const studentId = String(reservation.studentId || '').trim()
        const pkg = studentPackages.find(
          (p) =>
            String(p.studentId || '').trim() === studentId &&
            p.packageType === 'group' &&
            String(p.groupClassId || '') === String(gid) &&
            String(p.status || 'active') === 'active'
        )
        const pkgOk = Boolean(pkg)
        const remaining = pkgOk ? Number(pkg.remainingCount ?? 0) : 0
        const used = pkgOk ? Number(pkg.usedCount ?? 0) : 0
        const isCounted = Boolean(studentId && countedSet.has(studentId))
        return {
          groupStudent: {
            id: `reservation:${reservation.id}`,
            reservationId: reservation.id,
            isReservation: true,
            groupClassId: gid,
            studentId,
            studentName: String(reservation.studentName || '').trim() || '-',
            name: String(reservation.studentName || '').trim() || '-',
            packageId: pkg?.id || '',
          },
          studentId,
          packageDoc: pkgOk ? pkg : null,
          packageTitle: pkgOk ? String(pkg.title || '').trim() || '—' : '수강권 없음',
          remainingCount: remaining,
          usedCount: used,
          isCounted,
          statusLabel: isCounted ? '차감됨' : remaining <= 0 ? '남은 횟수 없음' : '예약',
          canDeduct: pkgOk && !isCounted && remaining > 0,
          canUndo: pkgOk && isCounted,
        }
      })

    return [...fixedRows, ...reservationRows]
  }, [
    groupLessonAttendanceModal,
    groupLessons,
    selectedGroupClass?.id,
    groupStudents,
    groupLessonReservations,
    studentPackages,
  ])

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
    groupLessonForAttendanceModal,
  }
}
