import {
  normalizeGroupWeekdaysFromDoc,
  parseRequiredMinOneIntField,
  parseYmdToLocalDate,
} from './dashboardViewUtils.js'
import {
  DEFAULT_GROUP_COURSE_TYPE,
  normalizeGroupCourseType,
} from '../group-booking/groupCourseTypes.js'

const DEFAULT_GROUP_FORM = {
  name: '',
  teacher: '',
  maxStudents: '4',
  startDate: '',
  time: '',
  subject: '',
  status: 'active',
  groupCourseType: DEFAULT_GROUP_COURSE_TYPE,
  weekdays: [],
  recurrenceMode: 'fixedWeekdays',
  rebuildFutureLessons: false,
  rebuildFromDate: '',
}

export function groupMaxStudentsToFormString(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '4'
  const i = Math.trunc(n)
  return String(Math.max(1, i))
}

export function createDefaultGroupForm(overrides = {}) {
  return {
    ...DEFAULT_GROUP_FORM,
    ...overrides,
  }
}

export function countActiveGroupFixedMembers(groupStudents, groupClassId) {
  const gid = String(groupClassId || '').trim()
  if (!gid) return 0
  return (Array.isArray(groupStudents) ? groupStudents : []).filter((row) => {
    const rowGroupId = String(row?.groupClassId || row?.classID || '').trim()
    if (rowGroupId !== gid) return false
    return String(row?.status || 'active').trim() === 'active'
  }).length
}

export function getGroupClassBookingCapacitySummary({
  maxStudents,
  activeFixedMemberCount,
} = {}) {
  const capacity = Math.max(
    1,
    Math.floor(Number.isFinite(Number(maxStudents)) ? Number(maxStudents) : 4)
  )
  const fixedMemberCount = Math.max(0, Math.floor(Number(activeFixedMemberCount || 0)))
  const fcfsRemainingSeats = Math.max(0, capacity - fixedMemberCount)
  return {
    capacity,
    fixedMemberCount,
    fcfsRemainingSeats,
  }
}

export function validateGroupFormFields(form, options = {}) {
  const { forNewClass, forEdit, activeFixedMemberCount = 0 } = options
  const errors = {}
  const name = String(form?.name || '').trim()
  const teacher = String(form?.teacher || '').trim()
  if (!name) errors.name = '이름을 입력해주세요.'
  if (!teacher) errors.teacher = '선생님 이름을 입력해주세요.'

  const maxStudents = parseRequiredMinOneIntField(form?.maxStudents)
  if (!maxStudents.ok) errors.maxStudents = '1 이상의 정수를 입력해주세요.'
  else if (Number(activeFixedMemberCount || 0) > maxStudents.value) {
    errors.maxStudents = `현재 반 등록 학생 ${Number(activeFixedMemberCount)}명보다 정원을 작게 설정할 수 없습니다.`
  }

  const status = String(form?.status || 'active').trim() === 'inactive' ? 'inactive' : 'active'

  let startDate = ''
  if (forNewClass) {
    startDate = String(form?.startDate || '').trim()
    if (!startDate) {
      errors.startDate = '시작일을 선택해주세요.'
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      errors.startDate = '시작일 형식이 올바르지 않습니다.'
    } else if (!parseYmdToLocalDate(startDate)) {
      errors.startDate = '유효한 시작일을 선택해주세요.'
    }
  }

  const time = String(form?.time || '').trim()
  if (!time) {
    errors.time = '시간을 입력해주세요.'
  } else if (!/^\d{2}:\d{2}$/.test(time)) {
    errors.time = 'HH:mm 형식으로 입력해주세요.'
  } else {
    const [h, m] = time.split(':').map(Number)
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      errors.time = '유효한 시간을 입력해주세요.'
    }
  }

  const subject = String(form?.subject || '').trim()
  if (!subject) errors.subject = '과목을 입력해주세요.'
  const normalizedGroupCourseType = normalizeGroupCourseType(form?.groupCourseType)
  const groupCourseType = normalizedGroupCourseType || (forNewClass ? DEFAULT_GROUP_COURSE_TYPE : '')

  const weekdays = normalizeGroupWeekdaysFromDoc(
    Array.isArray(form?.weekdays) ? form.weekdays : []
  )
  if (weekdays.length === 0) {
    errors.weekdays = '요일을 1개 이상 선택해주세요.'
  }

  const recurrenceMode =
    form?.recurrenceMode === 'fixedWeekdays' ? 'fixedWeekdays' : 'fixedWeekdays'

  let rebuildFutureLessons = false
  let rebuildFromDate = ''
  if (forEdit) {
    rebuildFutureLessons = Boolean(form?.rebuildFutureLessons)
    if (rebuildFutureLessons) {
      rebuildFromDate = String(form?.rebuildFromDate || '').trim()
      if (!rebuildFromDate) {
        errors.rebuildFromDate = '변경 적용 시작일을 선택해주세요.'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(rebuildFromDate)) {
        errors.rebuildFromDate = '날짜 형식이 올바르지 않습니다.'
      } else if (!parseYmdToLocalDate(rebuildFromDate)) {
        errors.rebuildFromDate = '유효한 날짜를 선택해주세요.'
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    name,
    teacher,
    maxStudents: maxStudents.ok ? maxStudents.value : 1,
    status,
    startDate: forNewClass ? startDate : '',
    time,
    subject,
    groupCourseType,
    weekdays,
    recurrenceMode,
    rebuildFutureLessons,
    rebuildFromDate,
  }
}
