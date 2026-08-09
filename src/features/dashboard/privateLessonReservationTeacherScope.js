function normalizeRequiredId(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

export function buildTeacherPrivateReservationQuerySpec({ academyId, teacherUid }) {
  return [
    {
      field: 'academyId',
      operator: '==',
      value: normalizeRequiredId(academyId, 'academyId'),
    },
    {
      field: 'teacherUid',
      operator: '==',
      value: normalizeRequiredId(teacherUid, 'teacherUid'),
    },
  ]
}
