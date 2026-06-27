export const GROUP_COURSE_TYPES = [
  '일반 영어회화',
  '초급 영어회화',
  '중급 영어회화',
  '고급 영어회화',
  '시험/특강',
]

export const DEFAULT_GROUP_COURSE_TYPE = '일반 영어회화'

const LEGACY_GROUP_COURSE_TYPE_TO_CANONICAL = {
  general_conversation: '일반 영어회화',
  beginner_conversation: '초급 영어회화',
  intermediate_conversation: '중급 영어회화',
  free_talking: '일반 영어회화',
  프리토킹: '일반 영어회화',
}

export const GROUP_COURSE_TYPE_OPTIONS = GROUP_COURSE_TYPES.map((value) => ({
  value,
  label: value,
}))

export function normalizeGroupCourseType(value) {
  const normalized = String(value || '').trim()
  if (GROUP_COURSE_TYPES.includes(normalized)) return normalized
  const legacy = LEGACY_GROUP_COURSE_TYPE_TO_CANONICAL[normalized]
  if (legacy) return legacy
  return ''
}

export function isKnownGroupCourseType(value) {
  return Boolean(normalizeGroupCourseType(value))
}

export function getGroupCourseTypeLabel(value) {
  const normalized = normalizeGroupCourseType(value)
  if (normalized) return normalized
  const raw = String(value || '').trim()
  return raw || ''
}

export function groupCourseTypesMatch(left, right) {
  const leftCanonical = normalizeGroupCourseType(left)
  const rightCanonical = normalizeGroupCourseType(right)
  if (leftCanonical && rightCanonical) return leftCanonical === rightCanonical
  const leftRaw = String(left || '').trim()
  const rightRaw = String(right || '').trim()
  return Boolean(leftRaw && rightRaw && leftRaw === rightRaw)
}
