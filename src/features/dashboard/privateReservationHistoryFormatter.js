export function formatPrivateReservationHistoryLabels({
  row,
  slot,
  cancelUsage = null,
  text = (_key, fallback) => fallback,
}) {
  const normalizedStatus = String(row?.status || '').trim().toLowerCase()
  const isCancelled = normalizedStatus === 'cancelled' || normalizedStatus === 'canceled'
  const cancellationType = String(row?.cancellationType || '').trim().toLowerCase()
  const actor = String(
    row?.cancelledByRole ||
      row?.canceledByRole ||
      row?.cancelledBy ||
      row?.canceledBy ||
      row?.source ||
      ''
  )
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  const reason = String(
    row?.cancellationReason || row?.cancelledReason || slot?.releaseReason || ''
  )
    .trim()
    .toLowerCase()
  const teacherUnavailableReasons = new Set([
    'teacher_absent',
    'teacher_unavailable',
    'teacher_unavailable_closed',
    'teacher_absence',
    'teacher_no_show',
    'closed',
    'academy_closed',
    'holiday',
    'class_closure',
  ])
  const isTeacherUnavailable = teacherUnavailableReasons.has(reason)
  const actorKind = !isCancelled
    ? ''
    : isTeacherUnavailable
      ? 'teacherUnavailable'
      : actor.includes('student') || reason.includes('student')
        ? 'student'
        : actor.includes('teacher') || reason.includes('teacher')
          ? 'teacher'
          : actor.includes('admin') ||
              actor.includes('owner') ||
              actor.includes('staff') ||
              actor.includes('dashboard') ||
              reason.includes('admin')
            ? 'admin'
            : actor || reason
              ? 'unknown'
              : ''
  const isStudentSeatReleased =
    isCancelled && cancellationType === 'seat_released' && actorKind === 'student'
  const isReleased =
    slot?.releasedFromFixed === true ||
    String(slot?.slotType || '').trim() === 'released_fixed' ||
    slot?.isBookable === true

  let statusLabel
  if (isStudentSeatReleased) {
    statusLabel = text('teacher.calendar.history.status.studentCancelled', '학생 취소')
  } else if (isCancelled && isTeacherUnavailable) {
    statusLabel = text(
      'teacher.calendar.history.status.teacherUnavailable',
      '예약 취소 · 수업불가 닫힘'
    )
  } else if (isCancelled && isReleased) {
    statusLabel = text(
      'teacher.calendar.history.status.released',
      '예약 취소 · 예약 가능 공개'
    )
  } else if (isCancelled) {
    statusLabel = text('teacher.calendar.history.status.cancelled', '예약 취소')
  } else if (normalizedStatus === 'completed') {
    statusLabel = text('teacher.calendar.history.status.completed', '수업 완료')
  } else if (['active', 'reserved', 'confirmed', 'booked'].includes(normalizedStatus)) {
    statusLabel = text('teacher.calendar.history.status.active', '예약 완료')
  } else {
    statusLabel = text('teacher.calendar.history.status.unknown', '상태 확인 필요')
  }

  const actorLabels = {
    student: ['teacher.calendar.history.actor.student', '학생 취소'],
    teacherUnavailable: [
      'teacher.calendar.history.actor.teacherUnavailable',
      '선생님 휴강/수업불가',
    ],
    teacher: ['teacher.calendar.history.actor.teacher', '선생님 취소'],
    admin: ['teacher.calendar.history.actor.admin', '관리자 취소'],
    unknown: ['teacher.calendar.history.actor.unknown', '취소 주체 확인 필요'],
  }
  const actorEntry = actorLabels[actorKind]
  const cancelActorLabel = actorEntry ? text(actorEntry[0], actorEntry[1]) : ''

  const timestampValue = row?.cancelledAt || row?.canceledAt
  let millis = null
  if (timestampValue && typeof timestampValue.toMillis === 'function') {
    const value = timestampValue.toMillis()
    millis = Number.isFinite(value) ? value : null
  } else if (timestampValue && typeof timestampValue.toDate === 'function') {
    const value = timestampValue.toDate().getTime()
    millis = Number.isFinite(value) ? value : null
  } else if (timestampValue instanceof Date) {
    const value = timestampValue.getTime()
    millis = Number.isFinite(value) ? value : null
  } else if (typeof timestampValue === 'number' && Number.isFinite(timestampValue)) {
    millis = timestampValue
  } else if (typeof timestampValue === 'string') {
    const value = Date.parse(timestampValue)
    millis = Number.isFinite(value) ? value : null
  }
  let cancelledAtLabel = ''
  if (millis != null) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(millis))
    const byType = new Map(parts.map((part) => [part.type, part.value]))
    cancelledAtLabel = `${byType.get('year')}-${byType.get('month')}-${byType.get('day')} ${byType.get('hour')}:${byType.get('minute')}`
  }

  const detailLabels = []
  if (cancelActorLabel && !isStudentSeatReleased) detailLabels.push(cancelActorLabel)
  if (cancelledAtLabel) {
    detailLabels.push(
      text(
        'teacher.calendar.history.detail.cancelledAt',
        `취소 처리일: ${cancelledAtLabel}`,
        { date: cancelledAtLabel }
      )
    )
  }
  if (isStudentSeatReleased && row?.noDeduction === true) {
    detailLabels.push(
      text('teacher.calendar.history.detail.noDeduction', '수강권 차감 없음')
    )
  }
  if (
    isStudentSeatReleased &&
    Number.isFinite(Number(cancelUsage?.used)) &&
    Number.isFinite(Number(cancelUsage?.limit))
  ) {
    const used = Math.max(0, Math.floor(Number(cancelUsage.used)))
    const limit = Math.max(0, Math.floor(Number(cancelUsage.limit)))
    detailLabels.push(
      text(
        'teacher.calendar.history.detail.cancelUsage',
        `취소 사용 ${used}/${limit}회`,
        { used, limit }
      )
    )
  }

  return {
    statusLabel,
    cancelActorLabel,
    cancelledAtLabel,
    detailLabel: detailLabels.join(' · '),
  }
}
