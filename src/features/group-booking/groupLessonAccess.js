import { groupCourseTypesMatch, normalizeGroupCourseType } from './groupCourseTypes.js'

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  value.forEach((item) => {
    const id = normalizeId(item)
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
  })
  return out
}

function addCourseType(types, value) {
  const raw = normalizeId(value)
  if (!raw) return
  const canonical = normalizeGroupCourseType(raw) || raw
  types.add(canonical)
}

export function getGroupLessonGroupId(data) {
  return normalizeId(data && (data.groupClassId || data.groupClassID || data.classID))
}

export function getLessonGroupClassIds(lesson) {
  const ids = normalizeIdList(lesson && lesson.groupClassIds)
  const primary = getGroupLessonGroupId(lesson)
  if (primary && !ids.includes(primary)) {
    ids.unshift(primary)
  }
  return ids
}

export function getEffectiveLessonCourseTypes(lesson, groupClassById = null) {
  const types = new Set()
  addCourseType(types, lesson && lesson.groupCourseType)

  getLessonGroupClassIds(lesson).forEach((classId) => {
    const groupClass =
      groupClassById instanceof Map
        ? groupClassById.get(classId)
        : groupClassById && groupClassById[classId]
    addCourseType(types, groupClass && groupClass.groupCourseType)
  })

  return Array.from(types.values())
}

export function hasGroupLessonAccess({ summary, lesson, groupClassById = null } = {}) {
  const accessClassIds = normalizeIdList(summary && summary.groupClassIds)
  const accessCourseTypes = normalizeIdList(summary && summary.groupCourseTypes).map(
    (courseType) => normalizeGroupCourseType(courseType) || courseType
  )

  const lessonClassIds = getLessonGroupClassIds(lesson)
  if (lessonClassIds.some((classId) => accessClassIds.includes(classId))) {
    return true
  }

  const lessonCourseTypes = getEffectiveLessonCourseTypes(lesson, groupClassById)
  return lessonCourseTypes.some((lessonCourseType) =>
    accessCourseTypes.some((accessCourseType) =>
      groupCourseTypesMatch(lessonCourseType, accessCourseType)
    )
  )
}
