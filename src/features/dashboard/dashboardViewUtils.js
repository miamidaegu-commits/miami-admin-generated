export const SCHOOL_TIME_ZONE = 'Asia/Seoul'
export function normalizeText(value = '') {
  return String(value).trim().toLowerCase()
}

/** tel: 링크용 — 숫자와 선행 +만 유지 */
export function sanitizePhoneForTel(phone) {
  if (phone == null) return ''
  const s = String(phone).trim()
  if (!s) return ''
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch >= '0' && ch <= '9') out += ch
    else if (ch === '+' && out.length === 0) out += ch
  }
  return out
}

export function makeStudentKey(name = '', teacher = '') {
  return `${normalizeText(name)}__${normalizeText(teacher)}`
}

export function parseLegacyLessonToDate(dateStr, timeStr = '00:00') {
  if (!dateStr) return null

  const [year, month, day] = String(dateStr).split('-').map(Number)
  const [hour = 0, minute = 0] = String(timeStr || '00:00').split(':').map(Number)

  if (!year || !month || !day) return null

  // 현재 브라우저 로컬 시간을 기준으로 Date 생성
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0)
}

export function getLessonDate(lesson) {
  if (lesson?.startAt?.toDate) return lesson.startAt.toDate()
  if (lesson?.startAt?.seconds != null) return new Date(lesson.startAt.seconds * 1000)
  return parseLegacyLessonToDate(lesson?.date, lesson?.time)
}

export function formatDate(date) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(date)
}

export function formatTime(date) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SCHOOL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function getStudentName(lesson) {
  return lesson.studentName || lesson.student || '-'
}

export function getTeacherName(lesson) {
  return lesson.teacherName || lesson.teacher || '-'
}

export function getTodayStorageDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  return `${year}-${month}-${day}`
}

export function getLessonStorageDateString(lesson) {
  if (lesson?.date) return lesson.date

  const d = getLessonDate(lesson)
  if (!d) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  return `${year}-${month}-${day}`
}

export function privateLessonNextSortKey(lesson) {
  if (!lesson) return null
  const d = getLessonStorageDateString(lesson)
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const t = String(lesson.time || '').trim() || '00:00'
  return `${d} ${t}`
}

export function groupLessonNextSortKey(gl) {
  if (!gl) return null
  const dateStr = String(gl.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const t = String(gl.time || '').trim() || '00:00'
  return `${dateStr} ${t}`
}

export function earliestNextLessonSortKey(privateLesson, groupLesson) {
  const a = privateLessonNextSortKey(privateLesson)
  const b = groupLessonNextSortKey(groupLesson)
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

export function lessonDateInputValue(lesson) {
  const s = getLessonStorageDateString(lesson)
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return ''
}

export function lessonTimeInputValue(lesson) {
  const t = String(lesson?.time || '').trim()
  if (/^\d{2}:\d{2}$/.test(t)) return t
  const d = getLessonDate(lesson)
  if (!d) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function validateLessonDateTimeSubject(form) {
  const errors = {}
  const date = String(form.date || '').trim()
  const time = String(form.time || '').trim()
  const subject = String(form.subject || '').trim()

  if (!date) errors.date = '날짜를 선택해주세요.'
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = '날짜 형식이 올바르지 않습니다.'
  if (!time) errors.time = '시간을 선택해주세요.'
  if (time && !/^\d{2}:\d{2}$/.test(time)) errors.time = '시간 형식이 올바르지 않습니다.'
  if (!subject) errors.subject = '과목을 입력해주세요.'

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    date,
    time,
    subject,
  }
}

export function countUsedAsOfTodayForStudent(allLessons, targetStudentName) {
  const normStudent = normalizeText(targetStudentName)
  const today = getTodayStorageDateString()

  let usedCount = 0

  for (const item of allLessons) {
    const docName = normalizeText(getStudentName(item))
    const date = getLessonStorageDateString(item)
    const cancelled = Boolean(item.isDeductCancelled)

    if (docName === normStudent && date && date <= today && !cancelled) {
      usedCount += 1
    }
  }

  return usedCount
}

/** remainingCount에 맞춰 status 동기화 (수동 종료 ended는 유지) */
export function getNextStudentPackageStatus(currentStatus, remainingCount) {
  if (String(currentStatus || '').toLowerCase() === 'ended') return 'ended'
  const rem = Number(remainingCount ?? 0)
  if (!Number.isFinite(rem) || rem <= 0) return 'exhausted'
  return 'active'
}

/** 0 이상 정수 문자열만 허용 (앞뒤 공백 제거 후 검사) */
export function parseRequiredNonNegativeIntField(raw) {
  const t = String(raw ?? '').trim()
  if (t === '') return { ok: false, value: null }
  if (!/^(0|[1-9]\d*)$/.test(t)) return { ok: false, value: null }
  const value = parseInt(t, 10)
  if (!Number.isFinite(value) || value < 0) return { ok: false, value: null }
  return { ok: true, value }
}

/** 1 이상 정수 (그룹 정원) */
export function parseRequiredMinOneIntField(raw) {
  const t = String(raw ?? '').trim()
  if (t === '') return { ok: false, value: null }
  if (!/^(0|[1-9]\d*)$/.test(t)) return { ok: false, value: null }
  const value = parseInt(t, 10)
  if (!Number.isFinite(value) || value < 1) return { ok: false, value: null }
  return { ok: true, value }
}

export function getStorageDateStringFromDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  return `${year}-${month}-${day}`
}

export function getCalendarDays(baseDate) {
  const firstDayOfMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
  const start = new Date(firstDayOfMonth)
  start.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const d = new Date(start)
    d.setDate(start.getDate() + index)
    return d
  })
}

export function isSameStorageDate(a, b) {
  return getStorageDateStringFromDate(a) === getStorageDateStringFromDate(b)
}

export function formatGroupStudentStartDate(raw) {
  if (raw == null || raw === '') return '-'
  if (typeof raw?.toDate === 'function') {
    const d = raw.toDate()
    return d ? formatDate(d) : '-'
  }
  if (raw?.seconds != null) {
    return formatDate(new Date(raw.seconds * 1000))
  }
  if (typeof raw === 'string') {
    const parsed = parseLegacyLessonToDate(raw, '00:00')
    return parsed ? formatDate(parsed) : raw
  }
  return '-'
}

export function formatStudentPackageDetailTypeLabel(packageType) {
  if (packageType === 'private') return '개인'
  if (packageType === 'group') return '그룹'
  if (packageType === 'openGroup') return '오픈 그룹'
  return packageType != null && String(packageType).trim() !== '' ? '기타' : '-'
}

export function formatStudentPackageDetailStatusLabel(status) {
  const raw =
    status == null || String(status).trim() === ''
      ? 'active'
      : String(status).toLowerCase()
  if (raw === 'active') return '사용 중'
  if (raw === 'exhausted') return '소진'
  if (raw === 'ended' || raw === 'inactive') return '종료'
  return String(status)
}

export function formatStudentPackageDetailAmountPaid(raw) {
  if (raw == null || raw === '') return '-'
  const n = Number(raw)
  if (!Number.isFinite(n)) return '-'
  return n === 0 ? '0' : String(n)
}

export function formatStudentPackageDetailMemo(raw) {
  const s = String(raw ?? '').trim()
  return s || '-'
}

export function creditTransactionCreatedAtToMillis(raw) {
  if (!raw) return 0
  if (typeof raw?.toMillis === 'function') return raw.toMillis()
  if (typeof raw?.toDate === 'function') {
    const d = raw.toDate()
    return d && Number.isFinite(d.getTime()) ? d.getTime() : 0
  }
  if (raw?.seconds != null) {
    return Number(raw.seconds) * 1000 + Math.floor(Number(raw.nanoseconds || 0) / 1e6)
  }
  return 0
}

export function formatCreditTransactionCreatedAtDisplay(raw) {
  if (!raw) return '-'
  let d = null
  if (typeof raw?.toDate === 'function') d = raw.toDate()
  else if (typeof raw?.toMillis === 'function') d = new Date(raw.toMillis())
  else if (raw?.seconds != null) d = new Date(raw.seconds * 1000)
  if (!d || !Number.isFinite(d.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}

export function formatCreditTransactionDeltaCountDisplay(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '-'
  if (v === 0) return '0'
  if (v > 0) return `+${v}`
  return String(v)
}

export function formatCreditTransactionActionTypeLabel(actionType) {
  const key = String(actionType ?? '').trim()
  if (!key) return '-'
  const map = {
    package_created: '수강권 발급',
    package_adjusted: '총 횟수 조정',
    package_updated: '수강권 정보 수정',
    private_deduct_cancel: '개인 차감취소',
    private_deduct_restore: '개인 차감복구',
    group_deduct: '그룹 차감',
    group_deduct_restore: '그룹 차감복구',
    package_ended: '수강권 종료',
    group_reenroll: '그룹 재등록',
  }
  return map[key] ?? key
}

export const GROUP_RECURRENCE_WEEKDAY_TOGGLES = [
  { value: 2, label: '월' },
  { value: 3, label: '화' },
  { value: 4, label: '수' },
  { value: 5, label: '목' },
  { value: 6, label: '금' },
  { value: 7, label: '토' },
  { value: 1, label: '일' },
]

export const GROUP_WEEKDAY_LABELS = {
  1: '일',
  2: '월',
  3: '화',
  4: '수',
  5: '목',
  6: '금',
  7: '토',
}

export function normalizeGroupWeekdaysFromDoc(raw) {
  if (!Array.isArray(raw)) return []
  const nums = raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  return [...new Set(nums)].sort((a, b) => a - b)
}

export function formatGroupWeekdaysDisplay(nums) {
  const arr = normalizeGroupWeekdaysFromDoc(nums)
  if (arr.length === 0) return ''
  const order = [2, 3, 4, 5, 6, 7, 1]
  const sorted = [...arr].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return sorted.map((d) => GROUP_WEEKDAY_LABELS[d] || String(d)).join(', ')
}

/** JS Date.getDay() (0=일) → groupClasses.weekdays 코드 (1=일 … 7=토) */
export function jsDateToGroupWeekdayCode(date) {
  const day = date.getDay()
  return day === 0 ? 1 : day + 1
}

export function parseYmdToLocalDate(ymd) {
  const [y, mo, d] = String(ymd).split('-').map(Number)
  if (!y || !mo || !d) return null
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt
}

export function formatLocalDateToYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function studentFirstRegisteredYmdForSort(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return String(value).trim()
  if (typeof value.toDate === 'function') {
    const d = value.toDate()
    return d ? formatLocalDateToYmd(d) : ''
  }
  return ''
}

export function isGroupStudentRowActive(gs) {
  const raw = gs?.status
  const s =
    raw == null || String(raw).trim() === ''
      ? 'active'
      : String(raw).trim().toLowerCase()
  return s === 'active'
}

/** groupStudents 등 날짜 필드 원시값 → yyyy-mm-dd (없으면 null) */
export function groupStudentDateValueToYmd(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw?.toDate === 'function') {
    const d = raw.toDate()
    return d ? formatLocalDateToYmd(d) : null
  }
  if (raw?.seconds != null) {
    return formatLocalDateToYmd(new Date(raw.seconds * 1000))
  }
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return null
}

/** groupStudents.startDate → yyyy-mm-dd (없으면 null) */
export function groupStudentStartDateToYmd(gs) {
  return groupStudentDateValueToYmd(gs?.startDate)
}

/** studentStatus: 없거나 빈 값이면 'active' */
export function normalizeGroupStudentOperationalStatus(gs) {
  const s = String(gs?.studentStatus ?? '').trim().toLowerCase()
  if (s === 'onbreak') return 'onBreak'
  return 'active'
}

export function getGroupStudentExcludedDatesArray(gs) {
  const raw = gs?.excludedDates
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const x of raw) {
    const t = String(x ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  out.sort()
  return out
}

export function isGroupStudentOnBreakOnYmd(gs, ymd) {
  if (normalizeGroupStudentOperationalStatus(gs) !== 'onBreak') return false
  const bs = groupStudentDateValueToYmd(gs?.breakStartDate)
  const be = groupStudentDateValueToYmd(gs?.breakEndDate)
  const y = String(ymd || '').trim()
  if (!bs || !be || !y || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bs) || !/^\d{4}-\d{2}-\d{2}$/.test(be)) return false
  return bs <= y && y <= be
}

export function isGroupStudentExcludedOnYmd(gs, ymd) {
  const y = String(ymd || '').trim()
  if (!y || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return false
  return getGroupStudentExcludedDatesArray(gs).includes(y)
}

/** 기존 status(active)·startDate 규칙 + 휴원 기간·제외일 반영 */
export function isGroupStudentOperationallyEligibleOnYmd(gs, ymd) {
  if (!isGroupStudentRowActive(gs)) return false
  if (!isGroupStudentStartedByYmd(gs, ymd)) return false
  if (isGroupStudentOnBreakOnYmd(gs, ymd)) return false
  if (isGroupStudentExcludedOnYmd(gs, ymd)) return false
  return true
}

/** Students 현재 등록 행용: 오늘 기준 짧은 상태 문구 */
export function getGroupStudentRegistrationOperationalLabelForToday(gs) {
  const today = getTodayStorageDateString()
  if (isGroupStudentExcludedOnYmd(gs, today)) return '오늘 제외'
  if (
    normalizeGroupStudentOperationalStatus(gs) === 'onBreak' &&
    isGroupStudentOnBreakOnYmd(gs, today)
  ) {
    return '휴원중'
  }
  return ''
}

export function isGroupStudentStartedByYmd(gs, ymd) {
  const startYmd = groupStudentStartDateToYmd(gs)
  if (!startYmd) return true
  const y = String(ymd || '').trim()
  if (!y || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return true
  return startYmd <= y
}

export function* iterateYmdRangeInclusive(startYmd, endYmd) {
  const start = parseYmdToLocalDate(startYmd)
  const end = parseYmdToLocalDate(endYmd)
  if (!start || !end || start > end) return
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  while (cur.getTime() <= endTime) {
    yield formatLocalDateToYmd(cur)
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
  }
}

export function countWeekdayHitsInRange(startYmd, endYmd, weekdaySet) {
  if (!weekdaySet || weekdaySet.size === 0) return 0
  let n = 0
  for (const ymd of iterateYmdRangeInclusive(startYmd, endYmd)) {
    const dt = parseYmdToLocalDate(ymd)
    if (!dt) continue
    if (weekdaySet.has(jsDateToGroupWeekdayCode(dt))) n += 1
  }
  return n
}

/** yyyy-mm-dd 기준으로 달력일을 더한 yyyy-mm-dd (로컬) */
export function addCalendarDaysToYmd(startYmd, deltaDays) {
  const d = parseYmdToLocalDate(startYmd)
  if (!d || !Number.isFinite(deltaDays)) return null
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + Math.trunc(deltaDays))
  return formatLocalDateToYmd(next)
}

export function studentPackageExpiresAtToYmd(raw) {
  if (raw == null || raw === '') return ''
  if (typeof raw === 'string') {
    const t = String(raw).trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''
  }
  if (typeof raw?.toDate === 'function') {
    const d = raw.toDate()
    return d ? formatLocalDateToYmd(d) : ''
  }
  if (raw?.seconds != null) {
    return formatLocalDateToYmd(new Date(raw.seconds * 1000))
  }
  return ''
}

/** Students 주의 배지용: 같은 범위의 수강권을 묶어 재등록 필요 여부를 판정 */
export function studentPackageAttentionScope(pkg) {
  const pt = String(pkg?.packageType || '').trim()
  if (pt === 'private') {
    return `private:${normalizeText(pkg.teacher || '')}`
  }
  if (pt === 'group') {
    return `group:${String(pkg.groupClassId ?? '').trim()}`
  }
  if (pt === 'openGroup') {
    return `openGroup:${String(pkg.groupClassId ?? '').trim()}`
  }
  return `other:${pt || 'na'}:${String(pkg?.id || '')}`
}

export function isStudentPackageRowActive(pkg) {
  const raw = pkg?.status
  const s =
    raw == null || String(raw).trim() === ''
      ? 'active'
      : String(raw).trim().toLowerCase()
  return s === 'active'
}

export function buildStudentPackageScopeKey({ packageType, teacher, groupClassId }) {
  return studentPackageAttentionScope({
    packageType,
    teacher,
    groupClassId,
  })
}

/** 신규 정규반 저장 직후 자동 일정 등에 쓰는 기본 기간(시작일 포함 약 1년, 365일) */
export const GROUP_CLASS_AUTO_LESSON_RANGE_LAST_OFFSET_DAYS = 365 - 1

/** iOS 등 레거시 groupLessons 문서의 groupClassID 필드와 정규 groupClassId 모두 지원 */
export function getGroupLessonGroupId(gl) {
  return String(gl?.groupClassId ?? gl?.groupClassID ?? '').trim()
}

/** 그룹 수강권 제목 미입력 시 저장·표시용 기본 제목 */
export function buildAutoGroupStudentPackageTitle({
  groupClassName,
  registrationStartDate,
  registrationWeeks,
}) {
  const name = String(groupClassName || '').trim() || '그룹'
  const d = String(registrationStartDate || '').trim() || '-'
  const wNum = Number(registrationWeeks)
  const w =
    Number.isFinite(wNum) && wNum > 0
      ? String(Math.trunc(wNum))
      : String(registrationWeeks ?? '').trim() || '?'
  return `${name} · ${d} 시작 · ${w}주`
}

/** 정기등록 개인 수강권: 등록 주수 × 주당 횟수 (둘 다 1 이상 정수일 때만 유효, 아니면 0) */
export function computePrivateRegularTotalCount({ registrationWeeks, weeklyFrequency }) {
  const w =
    typeof registrationWeeks === 'number'
      ? registrationWeeks
      : Number.parseInt(String(registrationWeeks ?? '').trim(), 10)
  const f =
    typeof weeklyFrequency === 'number'
      ? weeklyFrequency
      : Number.parseInt(String(weeklyFrequency ?? '').trim(), 10)
  if (!Number.isInteger(w) || w < 1) return 0
  if (!Number.isInteger(f) || f < 1 || f > 3) return 0
  return w * f
}

/** 개인 정기등록 수강권 제목 미입력 시 저장·표시용 기본 제목 */
export function buildAutoPrivateStudentPackageTitle({
  studentName,
  registrationStartDate,
  registrationWeeks,
  weeklyFrequency,
}) {
  const name = String(studentName || '').trim() || '학생'
  const d = String(registrationStartDate || '').trim()
  const wNum = Number(registrationWeeks)
  const w =
    Number.isFinite(wNum) && wNum > 0
      ? String(Math.trunc(wNum))
      : String(registrationWeeks ?? '').trim() || '?'
  const fNum = Number(weeklyFrequency)
  const f =
    Number.isFinite(fNum) && fNum > 0
      ? String(Math.trunc(fNum))
      : String(weeklyFrequency ?? '').trim() || '?'
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return `${d} 시작 · 주${f}회 · ${w}주`
  }
  return `${name} · 주${f}회 · ${w}주`
}

/** 오늘(포함) 이후 해당 반의 그룹 수업 중 가장 이른 date(yyyy-mm-dd), 없으면 '' */
export function getEarliestFutureGroupLessonYmdFromLessons({
  groupClassId,
  groupLessons,
  todayYmd,
}) {
  const gid = String(groupClassId || '').trim()
  if (!gid || !Array.isArray(groupLessons)) return ''
  const today =
    todayYmd && String(todayYmd).trim()
      ? String(todayYmd).trim()
      : getTodayStorageDateString()
  let best = ''
  for (const gl of groupLessons) {
    if (getGroupLessonGroupId(gl) !== gid) continue
    const dateStr = String(gl.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
    if (dateStr < today) continue
    if (!best || dateStr < best) best = dateStr
  }
  return best
}

function addWeeksToYmdPrivate(ymd, weeks) {
  const d = parseYmdToLocalDate(ymd)
  if (!d || !Number.isFinite(weeks)) return null
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + Math.trunc(weeks) * 7)
  return formatLocalDateToYmd(next)
}

/** 매주 반복 시 날짜(ymd) 목록만 — 첫 슬롯 규칙(includeStart / afterFirst) */
function buildPrivateLessonDateChainYmds({
  startDateYmd,
  repeatWeekly,
  repeatWeeks,
  repeatStartMode,
  repeatAnchorDate,
}) {
  const base = String(startDateYmd || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base) || !parseYmdToLocalDate(base)) return []
  if (!repeatWeekly) return [base]

  const weeksNum = Number(repeatWeeks)
  const weeksParsed = Number.isInteger(weeksNum) ? weeksNum : parseInt(String(repeatWeeks || ''), 10)
  const safeWeeks = Number.isInteger(weeksParsed) && weeksParsed > 0 ? weeksParsed : 1
  const mode = repeatStartMode === 'afterFirst' ? 'afterFirst' : 'includeStart'
  const anchor = String(repeatAnchorDate || '').trim()

  const out = []
  const seen = new Set()
  const pushUnique = (d) => {
    if (!d || seen.has(d)) return
    seen.add(d)
    out.push(d)
  }

  pushUnique(base)
  if (mode === 'includeStart') {
    for (let i = 1; i < safeWeeks; i += 1) {
      pushUnique(addWeeksToYmdPrivate(base, i))
    }
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !parseYmdToLocalDate(anchor)) return []
    if (anchor === base) return []
    if (anchor < base) return []
    pushUnique(anchor)
    for (let i = 1; i < safeWeeks; i += 1) {
      pushUnique(addWeeksToYmdPrivate(anchor, i))
    }
  }

  return out
}

/**
 * 개인 수업 예약: 반복·주당 횟수(1~3 슬롯)에 따라 생성할 { date, time }[].
 * 검증은 호출부(validatePrivateLessonFormFields)에서 수행하는 것을 전제로, 형식 불가 시 [].
 */
export function buildPrivateLessonScheduleEntries(form) {
  const date = String(form?.date || '').trim()
  const timeRaw = String(form?.time || '').trim()
  const repeatWeekly = form?.repeatWeekly === true

  if (!repeatWeekly) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseYmdToLocalDate(date)) return []
    if (!timeRaw || !/^\d{2}:\d{2}$/.test(timeRaw)) return []
    return [{ date, time: timeRaw }]
  }

  if (!timeRaw || !/^\d{2}:\d{2}$/.test(timeRaw)) return []

  const wfRaw = String(form?.weeklyFrequency ?? '1').trim()
  const weeklyFrequency = wfRaw === '2' || wfRaw === '3' ? wfRaw : '1'
  const repeatStartMode = form?.repeatStartMode === 'afterFirst' ? 'afterFirst' : 'includeStart'
  const repeatAnchorDate = String(form?.repeatAnchorDate || '').trim()

  const weeksNum = Number(form?.repeatWeeks)
  const weeksParsed = Number.isInteger(weeksNum)
    ? weeksNum
    : parseInt(String(form?.repeatWeeks ?? ''), 10)
  const safeWeeks = Number.isInteger(weeksParsed) && weeksParsed > 0 ? weeksParsed : 1

  const chainParams = {
    startDateYmd: date,
    repeatWeekly: true,
    repeatWeeks: form?.repeatWeeks,
    repeatStartMode,
    repeatAnchorDate,
  }

  if (weeklyFrequency === '1') {
    const ymds = buildPrivateLessonDateChainYmds(chainParams)
    return ymds
      .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .map((d) => ({ date: d, time: timeRaw }))
  }

  const slot1Ymds = buildPrivateLessonDateChainYmds(chainParams)
  const entries = []
  for (const d of slot1Ymds) {
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) entries.push({ date: d, time: timeRaw })
  }

  const slot2Date = String(form?.weeklySlot2Date || '').trim()
  const slot2Time = String(form?.weeklySlot2Time || '').trim()
  if (weeklyFrequency === '2' || weeklyFrequency === '3') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot2Date) || !parseYmdToLocalDate(slot2Date)) return []
    if (!slot2Time || !/^\d{2}:\d{2}$/.test(slot2Time)) return []
    for (let i = 0; i < safeWeeks; i += 1) {
      const ymd = addWeeksToYmdPrivate(slot2Date, i)
      if (ymd) entries.push({ date: ymd, time: slot2Time })
    }
  }

  if (weeklyFrequency === '3') {
    const slot3Date = String(form?.weeklySlot3Date || '').trim()
    const slot3Time = String(form?.weeklySlot3Time || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot3Date) || !parseYmdToLocalDate(slot3Date)) return []
    if (!slot3Time || !/^\d{2}:\d{2}$/.test(slot3Time)) return []
    for (let i = 0; i < safeWeeks; i += 1) {
      const ymd = addWeeksToYmdPrivate(slot3Date, i)
      if (ymd) entries.push({ date: ymd, time: slot3Time })
    }
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.time.localeCompare(b.time)
  })
  const out = []
  const seen = new Set()
  for (const e of entries) {
    const k = `${e.date} ${e.time}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

/** 반 weekdays 배열 길이로 주당 수업 횟수 (없으면 1) */
export function getGroupWeeklyClassCountFromWeekdaysDoc(weekdays) {
  const wds = Array.isArray(weekdays) ? normalizeGroupWeekdaysFromDoc(weekdays) : []
  return wds.length > 0 ? wds.length : 1
}
