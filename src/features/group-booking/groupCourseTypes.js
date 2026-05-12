export const GROUP_COURSE_TYPES = [
  'free_talking',
  'intermediate_conversation',
  'beginner_conversation',
  'general_conversation',
]

export const DEFAULT_GROUP_COURSE_TYPE = 'general_conversation'

const GROUP_COURSE_TYPE_LABELS = {
  free_talking: '프리토킹',
  intermediate_conversation: '중급 영어회화',
  beginner_conversation: '초급 영어회화',
  general_conversation: '일반 영어회화',
}

export const GROUP_COURSE_TYPE_OPTIONS = GROUP_COURSE_TYPES.map((value) => ({
  value,
  label: GROUP_COURSE_TYPE_LABELS[value],
}))

export function normalizeGroupCourseType(value) {
  const normalized = String(value || '').trim()
  return GROUP_COURSE_TYPES.includes(normalized) ? normalized : ''
}

export function isKnownGroupCourseType(value) {
  return Boolean(normalizeGroupCourseType(value))
}

export function getGroupCourseTypeLabel(value) {
  const normalized = normalizeGroupCourseType(value)
  return normalized ? GROUP_COURSE_TYPE_LABELS[normalized] : ''
}
