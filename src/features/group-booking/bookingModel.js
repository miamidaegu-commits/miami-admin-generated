export function buildGroupLessonReservationId({ academyId, lessonId, studentId }) {
  return `${academyId}__${lessonId}__${studentId}`
}

export function buildStudentGroupAccessId({ academyId, groupClassId, studentId }) {
  return `${academyId}__${groupClassId}__${studentId}`
}

export function buildStudentGroupAccessSummaryId({ academyId, studentId }) {
  return `${academyId}__${studentId}`
}

export function normalizeGroupStudentAccessStatus(status) {
  return String(status || '').trim().toLowerCase() === 'active' ? 'active' : 'ended'
}

export function normalizeGroupStudentAccessStudentStatus(studentStatus) {
  return String(studentStatus || '').trim().toLowerCase() === 'onbreak'
    ? 'onBreak'
    : 'active'
}

export function buildStudentGroupAccessDoc({
  academyId,
  groupClassId,
  groupStudentId,
  studentId,
  packageId,
  status,
  studentStatus,
}) {
  return {
    academyId: String(academyId || '').trim(),
    groupClassId: String(groupClassId || '').trim(),
    groupStudentId: String(groupStudentId || '').trim(),
    studentId: String(studentId || '').trim(),
    packageId: String(packageId || '').trim(),
    status: normalizeGroupStudentAccessStatus(status),
    studentStatus: normalizeGroupStudentAccessStudentStatus(studentStatus),
  }
}
