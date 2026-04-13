import { useMemo } from 'react'
import {
  countWeekdayHitsInRange,
  groupStudentStartDateToYmd,
  normalizeGroupWeekdaysFromDoc,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'

/**
 * Groups 탭 전용: 반/수업/출석 모달에 쓰이는 파생 데이터만 담당.
 * Firestore 쓰기·submit·handler는 Dashboard에 둔다.
 */
export default function useGroupsSectionViewModel({
  groupClasses,
  groupStudents,
  groupLessons,
  selectedGroupClass,
  studentPackages,
  groupStudentForm,
  groupLessonSeriesForm,
  groupLessonSeriesModalOpen,
  groupLessonAttendanceModal,
}) {
  const sortedGroupLessonsForSelectedClass = useMemo(() => {
    return [...groupLessons].sort((a, b) => {
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
      if (String(gs.status || 'active') !== 'active') return false
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
      const startYmd = groupStudentStartDateToYmd(gs)
      if (startYmd && lessonDate < startYmd) return false
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
          canUndo: pkgOk && isCounted && used > 0,
        }
      })
  }, [
    groupLessonAttendanceModal,
    groupLessons,
    selectedGroupClass?.id,
    groupStudents,
    studentPackages,
  ])

  const groupLessonForAttendanceModal = useMemo(() => {
    const m = groupLessonAttendanceModal?.lesson
    if (!m?.id) return null
    return groupLessons.find((l) => l.id === m.id) || m
  }, [groupLessonAttendanceModal, groupLessons])

  const groupStudentSelectedPackagePreview = useMemo(() => {
    return groupStudentForm.packageId
      ? studentPackages.find((p) => p.id === groupStudentForm.packageId)
      : null
  }, [groupStudentForm.packageId, studentPackages])

  return {
    sortedGroupLessonsForSelectedClass,
    groupLessonSeriesPlannedCount,
    groupStudentEligiblePackages,
    sortedGroupClasses,
    sortedGroupStudentsForSelectedClass,
    groupLessonAttendanceModalRows,
    groupLessonForAttendanceModal,
    groupStudentSelectedPackagePreview,
  }
}
