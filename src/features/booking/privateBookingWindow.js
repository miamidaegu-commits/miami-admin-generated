const KST_OFFSET_HOURS = 9
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
export const PRIVATE_BOOKING_CUTOFF_HOURS = 7
export const PRIVATE_BOOKING_STATUS_LABELS = {
  available: '예약 가능',
  busy: '수업 있음',
  not_open: '예약 오픈 대기',
  closed: '예약 마감 · 수업 준비 중',
  my_reservation: '내 예약',
  reserved_by_me: '내 예약',
  reserved: '수업 있음',
  blocked: '수업 있음',
  no_ticket: '수업 있음',
  no_package: '수강권 등록 필요',
  no_makeup: '보충 가능 0회',
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function parseYmd(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

function parseHm(value) {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  }
}

export function getKstDateTimeMillis(dateValue, timeValue = '00:00') {
  const date = parseYmd(dateValue)
  const time = parseHm(timeValue)
  if (!date || !time) return null
  return Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour - KST_OFFSET_HOURS,
    time.minute,
    0,
    0
  )
}

export function formatKstYmd(millis) {
  const date = new Date(millis + KST_OFFSET_HOURS * HOUR_MS)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

export function formatKstDotDateTime(millis) {
  const date = new Date(millis + KST_OFFSET_HOURS * HOUR_MS)
  return `${date.getUTCFullYear()}.${pad2(date.getUTCMonth() + 1)}.${pad2(
    date.getUTCDate()
  )} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
}

export function getKstWeekday(dateValue) {
  const start = getKstDateTimeMillis(dateValue, '00:00')
  if (start === null) return null
  const day = new Date(start + KST_OFFSET_HOURS * HOUR_MS).getUTCDay()
  return day === 0 ? 7 : day
}

export function addKstDays(dateValue, days) {
  const start = getKstDateTimeMillis(dateValue, '00:00')
  if (start === null) return ''
  return formatKstYmd(start + Number(days || 0) * DAY_MS)
}

export function getMondayForKstDate(dateValue) {
  const weekday = getKstWeekday(dateValue)
  if (!weekday) return ''
  return addKstDays(dateValue, 1 - weekday)
}

export function getBookingWindowForPrivateLesson(dateValue, timeValue) {
  const startsAt = getKstDateTimeMillis(dateValue, timeValue)
  if (startsAt === null) return null
  const weekday = getKstWeekday(dateValue)
  const weekStartsOn = getMondayForKstDate(dateValue)
  const bookingOpensAt = getKstDateTimeMillis(addKstDays(weekStartsOn, -3), '00:00')
  const bookingClosesAt = startsAt - PRIVATE_BOOKING_CUTOFF_HOURS * HOUR_MS
  return {
    startsAt,
    bookingOpensAt,
    bookingClosesAt,
    weekStartsOn,
    weekEndsOn: addKstDays(weekStartsOn, 5),
    isBookableWeekday: weekday >= 1 && weekday <= 6,
  }
}

function getMillisFromTimestampLike(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value.seconds !== undefined) {
    const seconds = Number(value.seconds)
    if (Number.isFinite(seconds)) return seconds * 1000
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

export function getRelativeOpenLabel(openMillis, nowMillis = Date.now()) {
  const diff = Math.max(0, Number(openMillis || 0) - Number(nowMillis || 0))
  if (diff < DAY_MS) return `${Math.max(1, Math.ceil(diff / HOUR_MS))}시간 후`
  return `${Math.max(1, Math.ceil(diff / DAY_MS))}일 후`
}

export function getPrivateBookingStatus({
  slot,
  nowMillis = Date.now(),
  hasPackage = true,
  isReservedByMe = false,
}) {
  const rawStatus = String(slot?.status || '').trim()
  if (isReservedByMe) return 'my_reservation'
  if (slot?.isBusy === true) return String(slot?.bookingStatus || 'busy').trim() || 'busy'
  if (rawStatus === 'reserved') return 'reserved'
  if (rawStatus === 'blocked' || rawStatus === 'closed' || rawStatus === 'cancelled') return 'blocked'
  if (!hasPackage) return 'no_ticket'
  if (Number(slot?.packageRemainingCount ?? 1) <= 0) return 'no_makeup'

  const window = getBookingWindowForPrivateLesson(slot?.date, slot?.time)
  if (!window || !window.isBookableWeekday) return 'closed'
  const explicitOpen =
    Number(slot?.bookingOpensAtMillis) || getMillisFromTimestampLike(slot?.bookingOpensAt)
  const explicitClose =
    Number(slot?.bookingClosesAtMillis) || getMillisFromTimestampLike(slot?.bookingClosesAt)
  if (nowMillis < (explicitOpen || window.bookingOpensAt)) return 'not_open'
  if (nowMillis >= (explicitClose || window.bookingClosesAt)) return 'closed'
  return 'available'
}

export function getPrivateBookingStatusLabel(status) {
  return PRIVATE_BOOKING_STATUS_LABELS[status] || PRIVATE_BOOKING_STATUS_LABELS.blocked
}

export function buildMondaySaturdayWeekDays(weekStartsOn) {
  const monday = getMondayForKstDate(weekStartsOn)
  if (!monday) return []
  return [0, 1, 2, 3, 4, 5].map((offset) => addKstDays(monday, offset))
}
