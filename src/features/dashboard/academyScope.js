export const DEFAULT_LEGACY_ACADEMY_ID = 'academy_default'

export function normalizeAcademyId(academyId) {
  return String(academyId || '').trim()
}

export function isValidOperationalAcademyId(academyId) {
  const id = normalizeAcademyId(academyId)
  return Boolean(id) && id !== DEFAULT_LEGACY_ACADEMY_ID
}

export function requireCurrentAcademyId(academyId) {
  const id = normalizeAcademyId(academyId)
  if (!isValidOperationalAcademyId(id)) {
    throw new Error('현재 학원 컨텍스트가 없어 작업할 수 없습니다.')
  }
  return id
}

function hasKoreanFinalConsonant(value) {
  const text = String(value || '').trim()
  if (!text) return false
  const code = text.charCodeAt(text.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return false
  return (code - 0xac00) % 28 !== 0
}

export function assertSameAcademy(row, academyId, label = '문서') {
  const currentAcademyId = requireCurrentAcademyId(academyId)
  if (normalizeAcademyId(row?.academyId) !== currentAcademyId) {
    const subjectParticle = hasKoreanFinalConsonant(label) ? '이' : '가'
    throw new Error(`${label}${subjectParticle} 현재 학원에 속하지 않습니다.`)
  }
  return currentAcademyId
}
