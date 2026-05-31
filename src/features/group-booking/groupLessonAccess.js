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
  const fromLesson = normalizeId(lesson && lesson.groupCourseType)
  if (fromLesson) types.add(fromLesson)

  getLessonGroupClassIds(lesson).forEach((classId) => {
    const groupClass =
      groupClassById instanceof Map
        ? groupClassById.get(classId)
        : groupClassById && groupClassById[classId]
    const fromClass = normalizeId(groupClass && groupClass.groupCourseType)
    if (fromClass) types.add(fromClass)
  })

  return Array.from(types.values())
}

export function hasGroupLessonAccess({ summary, lesson, groupClassById = null } = {}) {
  const accessClassIds = normalizeIdList(summary && summary.groupClassIds)
  const accessCourseTypes = normalizeIdList(summary && summary.groupCourseTypes)

  const lessonClassIds = getLessonGroupClassIds(lesson)
  if (lessonClassIds.some((classId) => accessClassIds.includes(classId))) {
    return true
  }

  const lessonCourseTypes = getEffectiveLessonCourseTypes(lesson, groupClassById)
  return lessonCourseTypes.some((courseType) => accessCourseTypes.includes(courseType))
}
