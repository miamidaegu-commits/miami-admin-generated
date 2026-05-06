export function buildPrivateLessonReservationId({ academyId, slotId, studentId }) {
  return `${academyId}__${slotId}__${studentId}`
}

export function buildStudentPrivateAccessSummaryId({ academyId, studentId }) {
  return `${academyId}__${studentId}`
}

export function normalizePrivateTeacherKey(value) {
  return String(value || '').trim()
}
