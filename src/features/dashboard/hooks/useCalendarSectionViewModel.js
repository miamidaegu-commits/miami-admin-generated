import { useMemo } from 'react'
import {
  getGroupLessonGroupId,
  getLessonDate,
  getLessonStorageDateString,
  getTodayStorageDateString,
  formatLessonSessionNumber,
  getStudentName,
  getTeacherName,
  isActiveGroupClassRow,
  isClassClosureCancelledGroupLesson,
  isNoDeductionCancelledGroupLesson,
  normalizeText,
} from '../dashboardViewUtils.js'

/**
 * 캘린더 탭 전용: 개인/그룹 수업 통합·필터·일자별 집계 등 읽기 전용 파생 상태.
 * Firestore 쓰기·모달·핸들러는 Dashboard에 둔다.
 */
function groupLessonHasAutoDeduction(groupLesson) {
  const autoDeductedIds = Array.isArray(groupLesson?.autoDeductedStudentIDs)
    ? groupLesson.autoDeductedStudentIDs
    : []
  if (autoDeductedIds.length > 0) return true
  if (String(groupLesson?.deductionSource || '').trim() === 'auto') return true
  const deductionSources =
    groupLesson?.deductionSources && typeof groupLesson.deductionSources === 'object'
      ? groupLesson.deductionSources
      : {}
  return Object.values(deductionSources).some(
    (source) => String(source || '').trim() === 'auto'
  )
}

export default function useCalendarSectionViewModel({
  lessons,
  privateLessonReservations,
  privateLessonSlots,
  studentSummaryGroupLessons,
  groupClasses,
  selectedDateString,
  showOnlySelectedDate,
  userProfile,
}) {
  const todayYmd = getTodayStorageDateString()
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
    const activeGroupClassById = new Map(
      groupClasses
        .filter(isActiveGroupClassRow)
        .map((groupClass) => [String(groupClass.id || ''), groupClass])
    )
    const activeRows = rows.filter((gl) => {
      if (isClassClosureCancelledGroupLesson(gl)) return false
      const gcid = getGroupLessonGroupId(gl)
      if (!gcid) return false
      return activeGroupClassById.has(String(gcid))
    })
    if (userProfile?.role === 'teacher' && userProfile?.teacherName) {
      const myTeacherName = normalizeText(userProfile.teacherName)
      return activeRows.filter((gl) => {
        const gcid = getGroupLessonGroupId(gl)
        const gc = activeGroupClassById.get(String(gcid))
        return gc && normalizeText(gc.teacher || '') === myTeacherName
      })
    }
    return activeRows
  }, [studentSummaryGroupLessons, groupClasses, userProfile])

  const calendarGroupLessonRows = useMemo(() => {
    return visibleGroupLessons.map((gl) => {
      const gcid = getGroupLessonGroupId(gl)
      const gc = groupClasses.find((g) => String(g.id) === String(gcid))
      const name =
        gc?.name != null && String(gc.name).trim() ? String(gc.name).trim() : '-'
      const lessonDate = getLessonStorageDateString(gl)
      const countedIds = Array.isArray(gl.countedStudentIDs) ? gl.countedStudentIDs : []
      let calendarStatusLabel = '예정'
      if (isNoDeductionCancelledGroupLesson(gl)) {
        calendarStatusLabel = '휴강 · 차감 없음'
      } else if (groupLessonHasAutoDeduction(gl)) {
        calendarStatusLabel = '자동 차감 완료'
      } else if (countedIds.length > 0) {
        calendarStatusLabel = '정상 차감'
      } else if (lessonDate && lessonDate < todayYmd) {
        calendarStatusLabel = '미처리 · 자동 차감 예정'
      }
      return {
        ...gl,
        _calendarRowKind: 'group',
        groupClassDisplayName: name,
        teacher: String(gl.teacher || gc?.teacher || '').trim() || '-',
        calendarStatusLabel,
      }
    })
  }, [visibleGroupLessons, groupClasses, todayYmd])

  const privateSlotById = useMemo(() => {
    return new Map(
      (Array.isArray(privateLessonSlots) ? privateLessonSlots : []).map((slot) => [
        String(slot.id || '').trim(),
        slot,
      ])
    )
  }, [privateLessonSlots])

  const approvedPrivateLessonKeys = useMemo(() => {
    const byKey = new Set()
    visibleLessons.forEach((lesson) => {
      const directReservationId = String(lesson.reservationId || '').trim()
      const directSlotId = String(lesson.slotId || '').trim()
      if (directReservationId) byKey.add(`reservationId:${directReservationId}`)
      if (directSlotId) byKey.add(`slotId:${directSlotId}`)
      const base = [
        String(getLessonStorageDateString(lesson) || '').trim(),
        String(lesson.time || '').trim(),
        normalizeText(getTeacherName(lesson)),
      ]
      const studentKeys = [
        normalizeText(lesson.studentId || lesson.studentID || ''),
        normalizeText(getStudentName(lesson)),
      ].filter(Boolean)
      studentKeys.forEach((studentKey) => {
        byKey.add([base[0], base[1], studentKey, base[2]].join('__'))
      })
    })
    return byKey
  }, [visibleLessons])

  const calendarPrivateReservationRows = useMemo(() => {
    const rows = Array.isArray(privateLessonReservations) ? privateLessonReservations : []
    return rows
      .filter((reservation) =>
        ['active', 'completed', 'no_show'].includes(String(reservation.status || '').trim())
      )
      .map((reservation) => {
        const slot = privateSlotById.get(String(reservation.slotId || '').trim()) || null
        const date = String(reservation.date || slot?.date || '').trim()
        const time = String(reservation.time || slot?.time || '').trim()
        const teacherLabel =
          String(reservation.teacherName || '').trim() ||
          String(reservation.teacher || '').trim() ||
          String(slot?.teacherName || '').trim() ||
          String(slot?.teacher || '').trim()
        const studentLabel =
          String(reservation.studentName || '').trim() ||
          String(reservation.student || '').trim() ||
          String(reservation.studentId || '').trim()
        const subject =
          String(reservation.subject || '').trim() ||
          String(slot?.subject || '').trim() ||
          '1:1 수업'
        return {
          ...reservation,
          _calendarRowKind: 'privateReservation',
          date,
          time,
          studentName: studentLabel || '-',
          teacherName: teacherLabel || '-',
          teacher: teacherLabel || '-',
          subject,
          startAt: reservation.startAt || slot?.startAt || null,
          durationMinutes: reservation.durationMinutes || slot?.durationMinutes || 50,
        }
      })
      .filter((reservation) => {
        if (!reservation.date) return false
        const reservationId = String(reservation.id || reservation.reservationId || '').trim()
        const slotId = String(reservation.slotId || '').trim()
        if (reservationId && approvedPrivateLessonKeys.has(`reservationId:${reservationId}`)) {
          return false
        }
        if (slotId && approvedPrivateLessonKeys.has(`slotId:${slotId}`)) return false
        const fallbackKey = [
          String(reservation.date || '').trim(),
          String(reservation.time || '').trim(),
          normalizeText(reservation.studentId || reservation.studentName || reservation.student),
          normalizeText(reservation.teacherName || reservation.teacher),
        ].join('__')
        return !approvedPrivateLessonKeys.has(fallbackKey)
      })
  }, [approvedPrivateLessonKeys, privateLessonReservations, privateSlotById])

  const calendarCombinedLessons = useMemo(() => {
    const priv = visibleLessons.map((l) => ({ ...l, _calendarRowKind: 'private' }))
    const all = [...priv, ...calendarGroupLessonRows, ...calendarPrivateReservationRows]
    all.sort((a, b) => {
      const aDate = getLessonDate(a)
      const bDate = getLessonDate(b)
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      return aDate.getTime() - bDate.getTime()
    })
    return all
  }, [visibleLessons, calendarGroupLessonRows, calendarPrivateReservationRows])

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

  const lessonsPreviewByDate = useMemo(() => {
    const map = new Map()

    calendarCombinedLessons.forEach((lesson) => {
      const dateKey = getLessonStorageDateString(lesson)
      if (!dateKey) return
      const current = map.get(dateKey) || []
      const isGroupRow = lesson._calendarRowKind === 'group'
      const isPrivateReservationRow = lesson._calendarRowKind === 'privateReservation'
      current.push({
        id: lesson.id,
        kind: lesson._calendarRowKind || 'private',
        time: lesson.time || '',
        label: [
          isGroupRow
            ? lesson.groupClassDisplayName || '단체수업'
            : isPrivateReservationRow
              ? '1:1 예약'
              : getStudentName(lesson),
          isPrivateReservationRow ? getStudentName(lesson) : '',
          lesson.time || '',
          formatLessonSessionNumber(lesson),
        ]
          .filter(Boolean)
          .join(' · '),
      })
      map.set(dateKey, current)
    })

    map.forEach((previews) => {
      previews.sort((a, b) => {
        const priority = (preview) => (preview.kind === 'privateReservation' ? 0 : 1)
        const priorityDiff = priority(a) - priority(b)
        if (priorityDiff !== 0) return priorityDiff
        return String(a.time || '').localeCompare(String(b.time || ''), 'ko')
      })
    })

    return map
  }, [calendarCombinedLessons])

  return {
    visibleLessons,
    visibleGroupLessons,
    calendarGroupLessonRows,
    calendarPrivateReservationRows,
    calendarCombinedLessons,
    displayedLessons,
    lessonsCountByDate,
    lessonsPreviewByDate,
  }
}
