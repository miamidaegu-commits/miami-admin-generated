import { useMemo } from 'react'
import {
  getGroupLessonGroupId,
  getLessonDate,
  getLessonStorageDateString,
  getTeacherName,
  normalizeText,
} from '../dashboardViewUtils.js'

/**
 * 캘린더 탭 전용: 개인/그룹 수업 통합·필터·일자별 집계 등 읽기 전용 파생 상태.
 * Firestore 쓰기·모달·핸들러는 Dashboard에 둔다.
 */
export default function useCalendarSectionViewModel({
  lessons,
  studentSummaryGroupLessons,
  groupClasses,
  selectedDateString,
  showOnlySelectedDate,
  userProfile,
}) {
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

  const visibleGroupLessons = useMemo(() => {
    const rows = Array.isArray(studentSummaryGroupLessons)
      ? studentSummaryGroupLessons
      : []
    if (userProfile?.role === 'teacher' && userProfile?.teacherName) {
      const myTeacherName = normalizeText(userProfile.teacherName)
      return rows.filter((gl) => {
        const gcid = getGroupLessonGroupId(gl)
        const gc = groupClasses.find((g) => String(g.id) === String(gcid))
        return gc && normalizeText(gc.teacher || '') === myTeacherName
      })
    }
    return rows
  }, [studentSummaryGroupLessons, groupClasses, userProfile])

  const calendarGroupLessonRows = useMemo(() => {
    return visibleGroupLessons.map((gl) => {
      const gcid = getGroupLessonGroupId(gl)
      const gc = groupClasses.find((g) => String(g.id) === String(gcid))
      const name =
        gc?.name != null && String(gc.name).trim() ? String(gc.name).trim() : '-'
      return {
        ...gl,
        _calendarRowKind: 'group',
        groupClassDisplayName: name,
        teacher: String(gl.teacher || gc?.teacher || '').trim() || '-',
      }
    })
  }, [visibleGroupLessons, groupClasses])

  const calendarCombinedLessons = useMemo(() => {
    const priv = visibleLessons.map((l) => ({ ...l, _calendarRowKind: 'private' }))
    const all = [...priv, ...calendarGroupLessonRows]
    all.sort((a, b) => {
      const aDate = getLessonDate(a)
      const bDate = getLessonDate(b)
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      return aDate.getTime() - bDate.getTime()
    })
    return all
  }, [visibleLessons, calendarGroupLessonRows])

  const displayedLessons = useMemo(() => {
    if (showOnlySelectedDate) {
      return calendarCombinedLessons.filter(
        (lesson) => getLessonStorageDateString(lesson) === selectedDateString
      )
    }

    return calendarCombinedLessons
  }, [showOnlySelectedDate, calendarCombinedLessons, selectedDateString])

  const lessonsCountByDate = useMemo(() => {
    const map = new Map()

    calendarCombinedLessons.forEach((lesson) => {
      const dateKey = getLessonStorageDateString(lesson)
      if (!dateKey) return
      map.set(dateKey, (map.get(dateKey) || 0) + 1)
    })

    return map
  }, [calendarCombinedLessons])

  return {
    visibleLessons,
    visibleGroupLessons,
    calendarGroupLessonRows,
    calendarCombinedLessons,
    displayedLessons,
    lessonsCountByDate,
  }
}
