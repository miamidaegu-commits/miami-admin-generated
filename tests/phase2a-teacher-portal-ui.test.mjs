import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { translate } from '../src/i18n/core.js'
import en from '../src/i18n/resources/en.js'
import ko from '../src/i18n/resources/ko.js'
import {
  MOBILE_BREAKPOINT_PX,
  installDialogFocusContainment,
  resolveLayoutMode,
} from '../src/preferences/layout.js'
import {
  formatPrivateReservationHistoryLabels as format,
} from '../src/features/dashboard/privateReservationHistoryFormatter.js'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function getDialogOpeningTags(source, testId, refName) {
  const testIdIndex = source.indexOf(`data-testid="${testId}"`)
  assert.ok(testIdIndex >= 0, `missing dialog test id: ${testId}`)
  const backdropStart = source.lastIndexOf('<div', testIdIndex)
  const backdropEnd = source.indexOf('>', testIdIndex)
  const refIndex = source.indexOf(`ref={${refName}}`, backdropEnd)
  assert.ok(refIndex > backdropEnd, `missing focus container: ${refName}`)
  const panelStart = Math.max(
    source.lastIndexOf('<div', refIndex),
    source.lastIndexOf('<section', refIndex)
  )
  const panelEnd = source.indexOf('>', refIndex)
  return {
    backdrop: source.slice(backdropStart, backdropEnd + 1),
    panel: source.slice(panelStart, panelEnd + 1),
  }
}

const approvedTeacherSources = [
  'Dashboard.jsx',
  'src/features/dashboard/components/TodaySchedulePanel.jsx',
  'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx',
  'src/features/dashboard/sections/CalendarSection.jsx',
  'src/features/dashboard/sections/GroupsSection.jsx',
  'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx',
]

test('teacher route tree remains shared and student-only routing remains isolated', () => {
  const app = read('App.jsx')
  const dashboardRoute = app.slice(app.indexOf('path="/dashboard"'), app.indexOf('path="/student-booking"'))
  const studentRoute = app.slice(app.indexOf('path="/student-booking"'))

  assert.match(dashboardRoute, /allowedRoles=\{\['admin', 'teacher'\]\}/)
  assert.match(dashboardRoute, /<Dashboard \/>/)
  assert.match(studentRoute, /allowedRoles=\{\['student'\]\}/)
  assert.doesNotMatch(studentRoute, /'teacher'/)
  assert.equal((app.match(/path="\/dashboard"/g) || []).length, 1)
  assert.equal((app.match(/path="\/student-booking"/g) || []).length, 1)
})

test('teacher menu and mutation gates preserve the pre-Phase-2A authority', () => {
  const dashboard = read('Dashboard.jsx')

  for (const flag of [
    'canAddStudent',
    'canEditStudent',
    'canDeleteStudent',
    'canEditLesson',
    'canDeleteLesson',
    'canManageAttendance',
    'canCreateLessonDirectly',
  ]) {
    assert.match(dashboard, new RegExp(`const ${flag} = isAdmin`))
  }
  assert.match(dashboard, /const requiresLessonApproval = userProfile\?\.requiresLessonApproval === true/)
  assert.match(
    dashboard,
    /const canManageOwnGroupClasses =\s*!isAdmin && isDashboardTeacherProfile\(userProfile\) && Boolean\(teacherGroupClassKey\)/
  )
  assert.match(dashboard, /const canUseStudentPackageCountSection = false/)
  assert.match(
    dashboard,
    /canManageFixedPrivateLessonOutcomeLocally\(\{[\s\S]*?target:[\s\S]*?userProfile[\s\S]*?\}\)/
  )
})

test('permission matrix keeps admin allowed, teacher denied, and undefined fields safe', () => {
  const effective = ({ role, permissions = {} }) => ({
    canAddStudent: role === 'admin',
    canEditStudent: role === 'admin',
    canDeleteStudent: role === 'admin',
    canEditLesson: role === 'admin',
    canDeleteLesson: role === 'admin',
    canManageAttendance: role === 'admin',
    canCreateLessonDirectly: role === 'admin',
    requiresLessonApproval:
      role !== 'admin' && permissions.requiresLessonApproval === true,
  })

  const flags = [
    'canAddStudent',
    'canEditStudent',
    'canDeleteStudent',
    'canEditLesson',
    'canDeleteLesson',
    'canManageAttendance',
    'canCreateLessonDirectly',
  ]
  for (const flag of flags) {
    assert.equal(effective({ role: 'admin' })[flag], true)
    assert.equal(effective({ role: 'teacher', permissions: { [flag]: true } })[flag], false)
    assert.equal(effective({ role: 'teacher' })[flag], false)
  }
  assert.equal(
    effective({ role: 'teacher', permissions: { requiresLessonApproval: true } })
      .requiresLessonApproval,
    true
  )
  assert.equal(effective({ role: 'teacher' }).requiresLessonApproval, false)
})

test('ko and en teacher catalogs have exact parity and every referenced key exists', () => {
  const koKeys = Object.keys(ko).filter((key) => key.startsWith('teacher.')).sort()
  const enKeys = Object.keys(en).filter((key) => key.startsWith('teacher.')).sort()

  assert.deepEqual(enKeys, koKeys)
  assert.ok(koKeys.length >= 140)

  const referenced = new Set()
  for (const file of approvedTeacherSources) {
    const source = read(file)
    for (const match of source.matchAll(/(?:t|text)\(\s*['"]((?:teacher|nav)\.[^'"]+)['"]/g)) {
      referenced.add(match[1])
    }
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/)
  }
  for (const key of referenced) {
    assert.equal(typeof ko[key], 'string', `missing ko key: ${key}`)
    assert.equal(typeof en[key], 'string', `missing en key: ${key}`)
  }
})

test('teacher translations preserve user-entered values and document text stays HTML-free', () => {
  const userName = '<강사 & Teacher>'
  const koMessage = translate('ko', 'teacher.notifications.booked', {
    student: userName,
    date: '2026-08-05',
    time: '18:00',
  })
  const enMessage = translate('en', 'teacher.notifications.booked', {
    student: userName,
    date: '2026-08-05',
    time: '18:00',
  })

  assert.match(koMessage, /<강사 & Teacher>/)
  assert.match(enMessage, /<강사 & Teacher>/)
  assert.match(read('src/i18n/core.js'), /React renders it as escaped text/)
})

test('layout matrix resolves all requested teacher combinations', () => {
  const requestedViewports = [
    [360, 'mobile'],
    [390, 'mobile'],
    [430, 'mobile'],
    [768, 'desktop'],
    [1280, 'desktop'],
    [1440, 'desktop'],
  ]

  for (const [width, expected] of requestedViewports) {
    assert.equal(resolveLayoutMode('auto', width <= MOBILE_BREAKPOINT_PX), expected)
  }
  assert.equal(resolveLayoutMode('mobile', false), 'mobile')
  assert.equal(resolveLayoutMode('desktop', true), 'desktop')

  for (const language of ['ko', 'en']) {
    assert.equal(resolveLayoutMode('mobile', true), 'mobile', `teacher/mobile/${language}`)
    assert.equal(resolveLayoutMode('desktop', false), 'desktop', `teacher/desktop/${language}`)
  }
})

test('calendar desktop and mobile agenda share data and handlers without Firebase paths', () => {
  const dashboard = read('Dashboard.jsx')
  const calendar = read('src/features/dashboard/sections/CalendarSection.jsx')

  assert.match(dashboard, /<CalendarSection \{\.\.\.calendarSectionProps\.month\} teacherPortal=\{!isAdmin\} \/>/)
  assert.match(dashboard, /<CalendarSection \{\.\.\.calendarSectionProps\.lessons\} teacherPortal=\{!isAdmin\} \/>/)
  assert.match(calendar, /data-shared-data-source=\{teacherPortal \? 'displayedLessons'/)
  assert.match(calendar, /data-shared-handler-source=\{teacherPortal \? 'calendarSectionProps\.lessons'/)
  assert.match(calendar, /teacher-calendar-agenda-list/)
  assert.doesNotMatch(calendar, /firebase\/(firestore|functions)/)
  assert.doesNotMatch(calendar, /\b(onSnapshot|getDocs|httpsCallable)\b/)
})

test('mobile group, student, lesson, and private cards reuse existing arrays', () => {
  const groups = read('src/features/dashboard/sections/GroupsSection.jsx')
  const privateSlots = read('src/features/dashboard/sections/PrivateLessonSlotsSection.jsx')

  for (const marker of [
    'teacher-group-card-list',
    'teacher-student-card-list',
    'teacher-group-lesson-card-list',
  ]) {
    assert.match(groups, new RegExp(marker))
  }
  assert.match(groups, /sortedGroupClasses\.map/)
  assert.match(groups, /sortedGroupStudentsForSelectedClass\.map/)
  assert.match(groups, /sortedGroupLessonsForSelectedClass\.map/)
  assert.match(privateSlots, /teacher-private-card-list/)
  assert.match(privateSlots, /privateBoardRows\.map/)
  assert.match(privateSlots, /data-shared-data-source=\{teacherPortal \? 'privateBoardRows'/)
  assert.doesNotMatch(groups + privateSlots, /firebase\/(firestore|functions)/)
})

test('teacher dialogs retain semantic and focus-management contracts', () => {
  const calendar = read('src/features/dashboard/sections/CalendarSection.jsx')
  const groups = read('src/features/dashboard/sections/GroupsSection.jsx')
  const outcome = read('src/features/dashboard/components/PrivateLessonStatusActionModal.jsx')

  for (const source of [calendar, groups, outcome]) {
    assert.match(source, /role="dialog"/)
    assert.match(source, /aria-modal="true"/)
    assert.match(source, /installDialogFocusContainment/)
    assert.match(source, /teacher-dialog-panel/)
  }
  assert.match(outcome, /initialFocus: closeRef\.current/)
  assert.match(groups, /initialFocus: reservationCloseRef\.current/)
  assert.match(calendar, /initialFocus: closeRef\.current/)
})

test('mobile CSS defines touch, focus, card, overflow, and full-screen sheet contracts', () => {
  const css = read('index.css')

  assert.match(css, /\.dashboard--mobile\.dashboard--teacher/)
  assert.match(css, /min-height: 44px/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /\.teacher-responsive-table > \.table-row/)
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) !important/)
  assert.match(css, /content: attr\(data-label\)/)
  assert.match(css, /\.teacher-dialog-panel[\s\S]*height: 100%/)
  assert.match(css, /\.dashboard--mobile \.main[\s\S]*overflow-x: hidden/)
})

test('mobile dashboard containment is scoped and preserves desktop box models', () => {
  const css = read('index.css')
  const today = read('src/features/dashboard/components/TodaySchedulePanel.jsx')
  const bodyRule = css.match(/\nbody\s*\{([^}]*)\}/)?.[1] || ''

  assert.match(
    css,
    /\.dashboard--mobile\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100vw;[\s\S]*?box-sizing: border-box;/
  )
  assert.match(
    css,
    /\.dashboard--mobile \.main\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?margin: 0;[\s\S]*?align-self: stretch;[\s\S]*?box-sizing: border-box;[\s\S]*?overflow-x: hidden;/
  )
  for (const marker of [
    '.main-header',
    '.activity-section',
    '.teacher-calendar-month',
    '.today-schedule-panel',
    '[data-testid="reservation-notifications-panel"]',
  ]) {
    assert.match(css, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(
    css,
    /:where\([\s\S]*?\)\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?box-sizing: border-box;/
  )
  assert.equal(/\bwidth\s*:/.test(bodyRule), false)
  assert.match(today, /gridTemplateColumns: 'repeat\(4, minmax\(0, 1fr\)\)'/)
})

test('mobile shell resets horizontal scroll while retaining vertical positions', () => {
  const shell = read('src/components/AuthenticatedShell.jsx')

  assert.match(
    shell,
    /!isMobile \|\|[\s\S]*?typeof window === 'undefined' \|\|[\s\S]*?typeof document === 'undefined'/
  )
  assert.match(shell, /document\.scrollingElement,[\s\S]*?document\.documentElement,[\s\S]*?document\.body/)
  assert.match(shell, /const scrollTopByElement = new Map/)
  assert.match(shell, /window\.scrollTo\(0, windowScrollY\)/)
  assert.match(shell, /element\.scrollLeft = 0/)
  assert.match(shell, /element\.scrollTop = scrollTopByElement\.get\(element\) \|\| 0/)
  assert.match(shell, /window\.requestAnimationFrame\(resetHorizontalScroll\)/)
  assert.match(shell, /window\.cancelAnimationFrame\(frameId\)/)
  assert.match(shell, /\}, \[activeKey, isMobile\]\)/)
})

test('teacher calendar and today summary use stable responsive class roles', () => {
  const calendar = read('src/features/dashboard/sections/CalendarSection.jsx')
  const today = read('src/features/dashboard/components/TodaySchedulePanel.jsx')
  const css = read('index.css')
  const toolbarIndex = calendar.indexOf("'teacher-calendar-toolbar'")
  const weekdaysIndex = calendar.indexOf("'teacher-calendar-weekdays'")
  const daysIndex = calendar.indexOf("'teacher-calendar-days'")
  const dayButtonIndex = calendar.indexOf('data-testid="calendar-day-button"')
  const previewIndex = calendar.indexOf('data-testid="calendar-day-preview-row"')

  assert.ok(toolbarIndex >= 0)
  assert.ok(weekdaysIndex > toolbarIndex)
  assert.ok(daysIndex > weekdaysIndex)
  assert.ok(dayButtonIndex > daysIndex)
  assert.ok(previewIndex > dayButtonIndex)
  assert.equal((calendar.match(/teacher-calendar-toolbar/g) || []).length, 1)
  assert.equal((calendar.match(/teacher-calendar-weekdays/g) || []).length, 1)
  assert.equal((calendar.match(/teacher-calendar-days/g) || []).length, 1)
  assert.doesNotMatch(calendar + css, /teacher-calendar-grid/)
  assert.match(calendar, /gridTemplateColumns: 'repeat\(7, 1fr\)'/)
  assert.match(
    css,
    /\.teacher-calendar-weekdays,\s*\.dashboard--mobile\.dashboard--teacher \.teacher-calendar-days\s*\{[\s\S]*?grid-template-columns: repeat\(7, minmax\(0, 1fr\)\) !important;[\s\S]*?gap: 4px !important;/
  )
  assert.match(
    css,
    /\.teacher-calendar-toolbar\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?box-sizing: border-box;/
  )
  assert.match(
    css,
    /\.teacher-calendar-days\s*\[data-testid="calendar-day-button"\]\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?box-sizing: border-box;[\s\S]*?min-height: 52px !important;[\s\S]*?padding: 6px !important;[\s\S]*?overflow: hidden;/
  )
  assert.match(
    css,
    /\.teacher-calendar-days\s*\[data-testid="calendar-day-preview-row"\]\s*\{[\s\S]*?display: none;/
  )
  assert.match(today, /className="today-schedule-panel"/)
  assert.match(today, /className="today-schedule-summary-grid"/)
  assert.match(today, /className="today-schedule-summary-card"/)
  assert.match(
    css,
    /\.today-schedule-summary-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/
  )
  assert.match(
    css,
    /\.today-schedule-summary-card\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/
  )
})

test('mobile presentation cannot bypass admin-only action gates', () => {
  const dashboard = read('Dashboard.jsx')
  const groups = read('src/features/dashboard/sections/GroupsSection.jsx')
  const privateSlots = read('src/features/dashboard/sections/PrivateLessonSlotsSection.jsx')

  assert.match(dashboard, /canManageGroupReservations: isAdmin/)
  assert.match(dashboard, /canManagePrivateSlots: isAdmin/)
  assert.match(groups, /\{canManageAttendance \? \(/)
  assert.match(groups, /\{canEditLesson \? \(/)
  assert.match(groups, /\{canDeleteLesson \? \(/)
  assert.match(privateSlots, /const showPrivateBoardActions = canManagePrivateSlots === true/)
  assert.doesNotMatch(read('index.css'), /display:\s*block[^}]*admin-only/)
})

test('remediation executes the production reservation-history formatter for every ko/en branch', () => {
  const textFor = (language) => (key, fallback, values) =>
    translate(language, key, values, { development: false })
  const cancelledAt = '2026-08-05T09:30:00.000Z'
  const cases = [
    {
      name: 'student seat release',
      input: {
        row: {
          status: 'cancelled',
          cancellationType: 'seat_released',
          cancelledByRole: 'student',
          cancelledAt,
          noDeduction: true,
          studentName: '<학생 & Student>',
          note: '사용자 메모 / user note',
        },
        cancelUsage: { used: 1, limit: 3 },
      },
      ko: ['학생 취소', '학생 취소', '취소 처리일: 2026-08-05 18:30 · 수강권 차감 없음 · 취소 사용 1/3회'],
      en: ['Cancelled by student', 'Cancelled by student', 'Cancellation processed: 2026-08-05 18:30 · No lesson-pass deduction · Cancellation usage 1/3'],
    },
    {
      name: 'teacher unavailable',
      input: {
        row: { status: 'cancelled', cancellationReason: 'teacher_unavailable', cancelledAt },
      },
      ko: ['예약 취소 · 수업불가 닫힘', '선생님 휴강/수업불가'],
      en: ['Cancelled · teacher unavailable / closed', 'Teacher unavailable / closed'],
    },
    {
      name: 'released slot and administrator actor',
      input: {
        row: { status: 'cancelled', cancelledByRole: 'admin' },
        slot: { releasedFromFixed: true },
      },
      ko: ['예약 취소 · 예약 가능 공개', '관리자 취소'],
      en: ['Cancelled · reopened for booking', 'Cancelled by administrator'],
    },
    {
      name: 'teacher actor',
      input: { row: { status: 'cancelled', cancelledByRole: 'teacher' } },
      ko: ['예약 취소', '선생님 취소'],
      en: ['Cancelled', 'Cancelled by teacher'],
    },
    {
      name: 'generic cancellation',
      input: { row: { status: 'cancelled' } },
      ko: ['예약 취소', ''],
      en: ['Cancelled', ''],
    },
    {
      name: 'completed',
      input: { row: { status: 'completed' } },
      ko: ['수업 완료', ''],
      en: ['Completed', ''],
    },
    {
      name: 'active',
      input: { row: { status: 'active' } },
      ko: ['예약 완료', ''],
      en: ['Reserved', ''],
    },
    {
      name: 'unknown status',
      input: { row: { status: 'unexpected' } },
      ko: ['상태 확인 필요', ''],
      en: ['Status needs review', ''],
    },
    {
      name: 'unknown cancellation actor',
      input: { row: { status: 'cancelled', cancelledByRole: 'external-system' } },
      ko: ['예약 취소', '취소 주체 확인 필요'],
      en: ['Cancelled', 'Cancellation actor needs review'],
    },
  ]

  for (const entry of cases) {
    for (const language of ['ko', 'en']) {
      const originalRow = structuredClone(entry.input.row)
      const result = format({ ...entry.input, text: textFor(language) })
      const expected = entry[language]
      assert.equal(result.statusLabel, expected[0], `${entry.name}/${language}/status`)
      assert.equal(result.cancelActorLabel, expected[1], `${entry.name}/${language}/actor`)
      if (expected[2]) assert.equal(result.detailLabel, expected[2], `${entry.name}/${language}/detail`)
      assert.deepEqual(entry.input.row, originalRow, `${entry.name}/${language}/user values`)
    }
  }
})

test('remediation wires stable reservation-history keys without direct Korean return branches', () => {
  const calendar = read('src/features/dashboard/sections/CalendarSection.jsx')
  const formatter = read('src/features/dashboard/privateReservationHistoryFormatter.js')
  assert.equal(typeof format, 'function')
  const requiredKeys = [
    'status.studentCancelled',
    'status.teacherUnavailable',
    'status.released',
    'status.cancelled',
    'status.completed',
    'status.active',
    'status.unknown',
    'actor.student',
    'actor.teacherUnavailable',
    'actor.teacher',
    'actor.admin',
    'actor.unknown',
    'detail.cancelledAt',
    'detail.noDeduction',
    'detail.cancelUsage',
  ].map((suffix) => `teacher.calendar.history.${suffix}`)

  for (const key of requiredKeys) {
    assert.equal(typeof ko[key], 'string', `missing ko key: ${key}`)
    assert.equal(typeof en[key], 'string', `missing en key: ${key}`)
    assert.match(formatter, new RegExp(key.replaceAll('.', '\\.')))
  }
  assert.doesNotMatch(
    formatter,
    /return\s+['"`](?:학생 취소|관리자 취소|예약 취소|예약 완료|수업 완료)/
  )
  assert.match(calendar, /studentName:\s*[\s\S]*?effectiveReservation\.studentName/)
  assert.match(calendar, /String\(effectiveReservation\.subject \|\| ''\)\.trim\(\)/)
  assert.doesNotMatch(calendar, /dangerouslySetInnerHTML/)
  assert.match(
    calendar,
    /import \{ formatPrivateReservationHistoryLabels \} from '\.\.\/privateReservationHistoryFormatter\.js'/
  )
  assert.doesNotMatch(
    calendar,
    /(?:function|const)\s+formatPrivateReservationHistoryLabels/
  )
  assert.doesNotMatch(calendar, /RESERVATION_HISTORY_FORMATTER_(?:START|END)/)
})

test('remediation makes the exact three focus containers the semantic dialogs', () => {
  const dialogs = [
    [
      read('src/features/dashboard/sections/CalendarSection.jsx'),
      'calendar-private-lesson-detail-modal',
      'dialogRef',
    ],
    [
      read('src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'),
      'fixed-private-lesson-outcome-modal',
      'dialogRef',
    ],
    [
      read('src/features/dashboard/sections/GroupsSection.jsx'),
      'group-reservation-modal',
      'reservationDialogRef',
    ],
  ]

  assert.equal(dialogs.length, 3)
  for (const [source, testId, refName] of dialogs) {
    const { backdrop, panel } = getDialogOpeningTags(source, testId, refName)
    assert.match(backdrop, /role="presentation"/, `${testId} backdrop`)
    assert.doesNotMatch(backdrop, /role="dialog"|aria-modal=/, `${testId} backdrop semantics`)
    assert.match(panel, new RegExp(`ref=\\{${refName}\\}`), `${testId} focus ref`)
    assert.match(panel, /role="dialog"/, `${testId} role`)
    assert.match(panel, /aria-modal="true"/, `${testId} aria-modal`)
    assert.match(panel, /aria-labelledby="[^"]+"/, `${testId} accessible name`)
  }
})

test('remediation focus regression uses the topmost semantic container and never leaks listeners', () => {
  const listeners = new Set()
  let semanticDialogs = []
  const attributes = (initial = {}) => new Map(Object.entries(initial))
  const documentRef = {
    activeElement: null,
    body: null,
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
    addEventListener(name, listener) {
      assert.equal(name, 'keydown')
      listeners.add(listener)
    },
    removeEventListener(name, listener) {
      assert.equal(name, 'keydown')
      listeners.delete(listener)
    },
    querySelectorAll: () => semanticDialogs,
  }
  const element = (name, options = {}) => {
    const attrs = attributes(options.attributes)
    return {
      name,
      disabled: options.disabled === true,
      hidden: options.hidden === true,
      inert: false,
      isConnected: true,
      ownerDocument: documentRef,
      parentElement: null,
      focus() {
        documentRef.activeElement = this
      },
      getAttribute: (key) => attrs.get(key) ?? null,
      getClientRects: () => (options.hidden ? [] : [{}]),
      hasAttribute: (key) => attrs.has(key),
      removeAttribute: (key) => attrs.delete(key),
      setAttribute: (key, value) => attrs.set(key, String(value)),
    }
  }
  const hidden = element('hidden', { hidden: true })
  const disabled = element('disabled', { disabled: true })
  const first = element('first')
  const last = element('last')
  const trigger = element('trigger')
  const panel = element('panel', {
    attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'title' },
  })
  const controls = [hidden, disabled, first, last]
  panel.querySelectorAll = () => controls
  panel.contains = (candidate) => candidate === panel || controls.includes(candidate)
  const backdrop = element('backdrop', { attributes: { role: 'presentation' } })
  backdrop.children = [panel]
  panel.parentElement = backdrop
  const background = element('background')
  const body = { children: [background, backdrop], parentElement: null }
  backdrop.parentElement = body
  background.parentElement = body
  documentRef.body = body
  semanticDialogs = [panel]
  const dispatch = (key, shiftKey = false) => {
    assert.equal(listeners.size, 1)
    const event = {
      key,
      shiftKey,
      prevented: false,
      preventDefault() {
        this.prevented = true
      },
    }
    ;[...listeners][0](event)
    return event
  }

  documentRef.activeElement = trigger
  let closeCount = 0
  const open = (initialFocus = null) =>
    installDialogFocusContainment({
      container: panel,
      initialFocus,
      returnFocus: trigger,
      onClose: () => {
        closeCount += 1
      },
      documentRef,
    })

  let cleanup = open(first)
  assert.equal(documentRef.activeElement, first)
  assert.equal(listeners.size, 1)
  assert.equal(background.inert, true)
  last.focus()
  assert.equal(dispatch('Tab').prevented, true)
  assert.equal(documentRef.activeElement, first)
  assert.equal(dispatch('Tab', true).prevented, true)
  assert.equal(documentRef.activeElement, last)
  const stacked = element('stacked', {
    attributes: { role: 'dialog', 'aria-modal': 'true' },
  })
  semanticDialogs = [panel, stacked]
  dispatch('Escape')
  assert.equal(closeCount, 0, 'a covered dialog must not handle Escape')
  semanticDialogs = [panel]
  assert.equal(dispatch('Escape').prevented, true)
  assert.equal(closeCount, 1)
  cleanup()
  assert.equal(documentRef.activeElement, trigger)
  assert.equal(background.inert, false)
  assert.equal(listeners.size, 0)

  cleanup = open()
  assert.equal(documentRef.activeElement, first, 'hidden and disabled controls are excluded')
  assert.equal(listeners.size, 1)
  cleanup()
  assert.equal(listeners.size, 0)
  assert.equal(documentRef.activeElement, trigger)
})

test('remediation preserves the desktop eight-column history grid and adds a shared mobile card contract', () => {
  const calendar = read('src/features/dashboard/sections/CalendarSection.jsx')
  const css = read('index.css')

  assert.equal((calendar.match(/privateReservationHistoryRows\.map/g) || []).length, 1)
  assert.match(calendar, /className="teacher-reservation-history-list"/)
  assert.match(calendar, /className="teacher-reservation-history-row"/)
  assert.match(
    calendar,
    /gridTemplateColumns:\s*'minmax\(84px, 0\.85fr\)[\s\S]*?minmax\(112px, 1fr\)'/
  )
  assert.ok((calendar.match(/data-label=\{text\('teacher\.common\./g) || []).length >= 8)
  assert.match(
    css,
    /\.dashboard--mobile\.dashboard--teacher \.teacher-reservation-history-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/
  )
  assert.match(
    css,
    /\.teacher-reservation-history-row[\s\S]*?> \[data-label\][\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/
  )
  assert.match(css, /word-break: break-word/)
  assert.doesNotMatch(css, /teacher-reservation-history-row[\s\S]{0,300}min-width:\s*[4-9]\d{2}px/)
})
