function normalizeRequiredId(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is required.`)
  return normalized
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeStatus(value, fallback = '') {
  return String(value || fallback).trim().toLowerCase()
}

function normalizeLessonDate(value) {
  const date = String(value || '').trim()
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('A canonical lesson date is required.')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('A valid canonical lesson date is required.')
  }
  return date
}

function normalizeLessonTime(value) {
  const time = String(value || '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('A canonical lesson start time is required.')
  }
  return time
}

function encodeOccurrenceComponent(value) {
  return encodeURIComponent(value).replace(/\./g, '%2E')
}

export function resolveCanonicalTeacherMembershipIdentity({
  authUid,
  academyId,
  membership,
}) {
  const canonicalAuthUid = normalizeRequiredId(authUid, 'Auth UID')
  const canonicalAcademyId = normalizeRequiredId(academyId, 'academyId')
  if (!membership || typeof membership !== 'object') {
    throw new Error('An active academy membership is required.')
  }
  if (String(membership.academyId || '').trim() !== canonicalAcademyId) {
    throw new Error('The active membership belongs to another academy.')
  }
  if (String(membership.uid || '').trim() !== canonicalAuthUid) {
    throw new Error('The active membership UID does not match Auth UID.')
  }
  if (normalizeRole(membership.role) !== 'teacher') {
    throw new Error('The active membership role must be teacher.')
  }
  if (normalizeStatus(membership.status) !== 'active') {
    throw new Error('The academy membership must be active.')
  }

  return {
    academyId: canonicalAcademyId,
    teacherUid: canonicalAuthUid,
    teacherName: String(
      membership.displayName || membership.teacherName || membership.name || ''
    ).trim(),
  }
}

export function buildCanonicalTeacherOption({ academyId, membership, teacherRecord = null }) {
  const canonicalAcademyId = String(academyId || '').trim()
  if (!canonicalAcademyId) return null
  const membershipAcademyId = String(membership?.academyId || '').trim()
  const teacherUid = String(membership?.uid || '').trim()
  if (
    membershipAcademyId !== canonicalAcademyId ||
    normalizeRole(membership?.role) !== 'teacher' ||
    normalizeStatus(membership?.status) !== 'active' ||
    !teacherUid
  ) {
    return null
  }
  const recordUid = String(teacherRecord?.teacherUid || teacherRecord?.uid || '').trim()
  const matchedRecord = recordUid === teacherUid ? teacherRecord : null
  const teacherName = String(
    matchedRecord?.name ||
      matchedRecord?.displayName ||
      matchedRecord?.teacherName ||
      membership?.displayName ||
      membership?.teacherName ||
      membership?.name ||
      ''
  ).trim()
  if (!teacherName) return null
  return {
    academyId: canonicalAcademyId,
    role: 'teacher',
    status: 'active',
    teacherUid,
    teacherName,
    displayName: teacherName,
    teacherEmail: String(membership?.email || '').trim(),
    value: teacherUid,
  }
}

export function resolveCanonicalTeacherSelection({
  academyId,
  selectedValue,
  teacherOptions,
}) {
  const canonicalAcademyId = normalizeRequiredId(academyId, 'academyId')
  const selected = normalizeRequiredId(selectedValue, 'teacher selection')
  const option = (Array.isArray(teacherOptions) ? teacherOptions : []).find(
    (candidate) =>
      String(candidate?.value || '').trim() === selected ||
      String(candidate?.teacherUid || '').trim() === selected
  )
  if (
    !option ||
    String(option.academyId || '').trim() !== canonicalAcademyId ||
    normalizeRole(option.role) !== 'teacher' ||
    normalizeStatus(option.status) !== 'active'
  ) {
    throw new Error('Select an active teacher membership from the current academy.')
  }
  const teacherUid = normalizeRequiredId(option.teacherUid, 'teacherUid')
  const teacherName = normalizeRequiredId(
    option.teacherName || option.displayName,
    'teacherName'
  )
  return { academyId: canonicalAcademyId, teacherUid, teacherName }
}

export function buildTeacherGroupClassesQuerySpec(identity) {
  const academyId = normalizeRequiredId(identity?.academyId, 'academyId')
  const teacherUid = normalizeRequiredId(identity?.teacherUid, 'teacherUid')
  return [
    { field: 'academyId', operator: '==', value: academyId },
    { field: 'teacherUid', operator: '==', value: teacherUid },
  ]
}

export function buildGroupClassOwnershipFields({ academyId, teacherIdentity, status }) {
  const canonicalAcademyId = normalizeRequiredId(academyId, 'academyId')
  if (String(teacherIdentity?.academyId || '').trim() !== canonicalAcademyId) {
    throw new Error('The selected teacher belongs to another academy.')
  }
  return {
    academyId: canonicalAcademyId,
    teacherUid: normalizeRequiredId(teacherIdentity?.teacherUid, 'teacherUid'),
    teacherName: normalizeRequiredId(teacherIdentity?.teacherName, 'teacherName'),
    status: normalizeRequiredId(status, 'status'),
  }
}

export function buildGroupLessonOccurrenceIdentity({
  academyId,
  groupClassId,
  date,
  time,
  slot = '0',
}) {
  return [
    normalizeRequiredId(academyId, 'academyId'),
    normalizeRequiredId(groupClassId, 'groupClassId'),
    normalizeLessonDate(date),
    normalizeLessonTime(time),
    normalizeRequiredId(slot, 'slot'),
  ].join('\u001f')
}

export function buildGroupLessonOccurrenceId(input) {
  const identity = buildGroupLessonOccurrenceIdentity(input)
  return `group-lesson-v1~${identity.split('\u001f').map(encodeOccurrenceComponent).join('~')}`
}

export function buildGroupLessonCanonicalFields({
  academyId,
  groupClass,
  date,
  time,
  status = 'scheduled',
  slot = '0',
}) {
  const canonicalAcademyId = normalizeRequiredId(academyId, 'academyId')
  if (String(groupClass?.academyId || '').trim() !== canonicalAcademyId) {
    throw new Error('The linked group class belongs to another academy.')
  }
  const groupClassId = normalizeRequiredId(groupClass?.id, 'groupClassId')
  const teacherUid = normalizeRequiredId(groupClass?.teacherUid, 'groupClass.teacherUid')
  const canonicalDate = normalizeLessonDate(date)
  const canonicalTime = normalizeLessonTime(time)
  const occurrenceId = buildGroupLessonOccurrenceId({
    academyId: canonicalAcademyId,
    groupClassId,
    date: canonicalDate,
    time: canonicalTime,
    slot,
  })
  return {
    academyId: canonicalAcademyId,
    groupClassId,
    teacherUid,
    date: canonicalDate,
    time: canonicalTime,
    status: normalizeRequiredId(status, 'status'),
    occurrenceId,
  }
}

export function scopeTeacherGroupData({
  groupClasses,
  groupLessons,
  academyId,
  teacherUid,
}) {
  const canonicalAcademyId = String(academyId || '').trim()
  const canonicalTeacherUid = String(teacherUid || '').trim()
  const classes = Array.isArray(groupClasses) ? groupClasses : []
  const lessons = Array.isArray(groupLessons) ? groupLessons : []
  const scopedClasses = []
  const ownedGroupClassIds = new Set()
  let excludedGroupClasses = 0

  for (const groupClass of classes) {
    const id = String(groupClass?.id || '').trim()
    if (
      !canonicalAcademyId ||
      !canonicalTeacherUid ||
      !id ||
      String(groupClass?.academyId || '').trim() !== canonicalAcademyId ||
      String(groupClass?.teacherUid || '').trim() !== canonicalTeacherUid
    ) {
      excludedGroupClasses += 1
      continue
    }
    scopedClasses.push(groupClass)
    ownedGroupClassIds.add(id)
  }

  const scopedLessons = []
  const seenLessonIds = new Set()
  let excludedGroupLessons = 0
  let duplicateGroupLessons = 0
  for (const lesson of lessons) {
    const id = String(lesson?.id || '').trim()
    const groupClassId = String(lesson?.groupClassId || '').trim()
    if (
      !id ||
      String(lesson?.academyId || '').trim() !== canonicalAcademyId ||
      !groupClassId ||
      !ownedGroupClassIds.has(groupClassId)
    ) {
      excludedGroupLessons += 1
      continue
    }
    if (seenLessonIds.has(id)) {
      duplicateGroupLessons += 1
      continue
    }
    seenLessonIds.add(id)
    scopedLessons.push(lesson)
  }

  return {
    groupClasses: scopedClasses,
    groupLessons: scopedLessons,
    ownedGroupClassIds,
    excludedCounts: {
      groupClasses: excludedGroupClasses,
      groupLessons: excludedGroupLessons,
      duplicateGroupLessons,
    },
  }
}
