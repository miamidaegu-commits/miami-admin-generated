export function parsePositiveInteger(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

export function buildTeacherPrivateLessonRequestPlans({
  paidLessons,
  weeklyFrequency,
  normalizedSlots,
}) {
  const slots = Array.isArray(normalizedSlots) ? normalizedSlots : []
  const frequency = Number(weeklyFrequency)
  const paidLessonCount = parsePositiveInteger(paidLessons)

  if (!paidLessonCount) {
    return slots.map((slot) => ({
      slot,
      repeatWeeks: 1,
      repeatWeekly: false,
    }))
  }

  const computedWeeks = Math.ceil(paidLessonCount / frequency)
  let remainingLessons = paidLessonCount

  return slots
    .map((slot) => {
      const repeatWeeks = Math.min(computedWeeks, remainingLessons)
      remainingLessons -= repeatWeeks
      return {
        slot,
        repeatWeeks,
        repeatWeekly: repeatWeeks > 1,
      }
    })
    .filter((plan) => plan.repeatWeeks > 0)
}
