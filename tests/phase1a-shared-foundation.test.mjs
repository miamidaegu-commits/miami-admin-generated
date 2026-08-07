import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  parseLanguage,
  persistLanguage,
  readStoredLanguage,
  resolveLanguage,
  synchronizeDocumentLanguage,
  translate,
} from '../src/i18n/core.js'
import en from '../src/i18n/resources/en.js'
import ko from '../src/i18n/resources/ko.js'
import {
  buildPreferredLanguagePatch,
  persistAccountLanguage,
  readAccountLanguage,
} from '../src/preferences/accountLanguage.js'
import {
  LEGACY_LAYOUT_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  MOBILE_BREAKPOINT_PX,
  MOBILE_MEDIA_QUERY,
  installDialogFocusContainment,
  migrateLegacyLayoutMode,
  parseLayoutMode,
  persistLayoutMode,
  readStoredLayoutMode,
  resolveLayoutMode,
  subscribeToMediaQuery,
} from '../src/preferences/layout.js'

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    snapshot: () => Object.fromEntries(values),
  }
}

test('language parser, resolution, fallback, and persistence are safe', () => {
  assert.equal(parseLanguage('ko'), 'ko')
  assert.equal(parseLanguage('en'), 'en')
  assert.equal(parseLanguage('fr'), DEFAULT_LANGUAGE)
  assert.equal(resolveLanguage({ accountLanguage: 'en', localLanguage: 'ko' }), 'en')
  assert.equal(resolveLanguage({ accountLanguage: undefined, localLanguage: 'en' }), 'en')
  assert.equal(resolveLanguage({ accountLanguage: 'bad', localLanguage: 'bad' }), 'ko')

  const storage = makeStorage({ [LANGUAGE_STORAGE_KEY]: 'broken' })
  assert.equal(readStoredLanguage(storage), 'ko')
  assert.equal(persistLanguage(storage, 'en'), 'en')
  assert.equal(storage.snapshot()[LANGUAGE_STORAGE_KEY], 'en')
})

test('translations fall back to Korean and expose missing development keys', () => {
  const resources = {
    ko: { greeting: '안녕하세요 {{name}}' },
    en: {},
  }
  assert.equal(
    translate('en', 'greeting', { name: '<b>A</b>' }, { resources, development: true }),
    '안녕하세요 <b>A</b>'
  )
  assert.equal(
    translate('en', 'missing.key', null, { resources, development: true }),
    '⟦missing:missing.key⟧'
  )
})

test('account language adapter accepts missing fields and writes only the narrow patch', async () => {
  assert.equal(readAccountLanguage(undefined), null)
  assert.equal(readAccountLanguage({}), null)
  assert.equal(readAccountLanguage({ preferredLanguage: 'fr' }), null)
  assert.equal(readAccountLanguage({ preferredLanguage: 'en' }), 'en')

  const marker = { timestamp: true }
  assert.deepEqual(buildPreferredLanguagePatch('ko', marker), {
    preferredLanguage: 'ko',
    updatedAt: marker,
  })

  let observed = null
  await persistAccountLanguage({
    uid: 'user-1',
    language: 'en',
    firestore: { name: 'fake' },
    docFactory: (...args) => ({ args }),
    timestamp: () => marker,
    update: async (ref, patch) => {
      observed = { ref, patch }
    },
  })
  assert.deepEqual(Object.keys(observed.patch).sort(), ['preferredLanguage', 'updatedAt'])
  assert.deepEqual(observed.patch, { preferredLanguage: 'en', updatedAt: marker })
})

test('layout parser, persistence, forced modes, and viewport matrix use 720px', () => {
  assert.equal(MOBILE_BREAKPOINT_PX, 720)
  assert.equal(MOBILE_MEDIA_QUERY, '(max-width: 720px)')
  assert.equal(parseLayoutMode('auto'), 'auto')
  assert.equal(parseLayoutMode('mobile'), 'mobile')
  assert.equal(parseLayoutMode('desktop'), 'desktop')
  assert.equal(parseLayoutMode('tablet'), 'auto')

  const storage = makeStorage({ [LAYOUT_STORAGE_KEY]: 'bad' })
  assert.equal(readStoredLayoutMode(storage), 'auto')
  persistLayoutMode(storage, 'desktop')
  assert.equal(storage.snapshot()[LAYOUT_STORAGE_KEY], 'desktop')

  const viewports = [
    [360, 'mobile'],
    [390, 'mobile'],
    [430, 'mobile'],
    [768, 'desktop'],
    [1280, 'desktop'],
    [1440, 'desktop'],
  ]
  for (const [width, expected] of viewports) {
    assert.equal(resolveLayoutMode('auto', width <= MOBILE_BREAKPOINT_PX), expected)
    assert.equal(resolveLayoutMode('mobile', width <= MOBILE_BREAKPOINT_PX), 'mobile')
    assert.equal(resolveLayoutMode('desktop', width <= MOBILE_BREAKPOINT_PX), 'desktop')
  }
})

test('matchMedia subscription reacts and cleans up', () => {
  let listener = null
  let removed = null
  const mediaQueryList = {
    addEventListener: (name, nextListener) => {
      assert.equal(name, 'change')
      listener = nextListener
    },
    removeEventListener: (name, nextListener) => {
      assert.equal(name, 'change')
      removed = nextListener
    },
  }
  const matches = []
  const unsubscribe = subscribeToMediaQuery(mediaQueryList, (value) => matches.push(value))
  listener({ matches: true })
  listener({ matches: false })
  unsubscribe()
  assert.deepEqual(matches, [true, false])
  assert.equal(removed, listener)
})

test('Login and shared settings expose accessible ko/en and layout selectors', async () => {
  const [login, settings] = await Promise.all([
    readFile('Login.jsx', 'utf8'),
    readFile('src/components/SettingsPanel.jsx', 'utf8'),
  ])
  assert.match(login, /data-testid="login-language-selector"/)
  assert.match(login, /aria-pressed=\{language === option\}/)
  assert.match(login, /syncAccount: false/)
  assert.match(settings, /LANGUAGE_OPTIONS = \['ko', 'en'\]/)
  assert.match(settings, /LAYOUT_OPTIONS = \['auto', 'mobile', 'desktop'\]/)
  assert.match(settings, /role="dialog"/)
  assert.match(settings, /installDialogFocusContainment/)
  assert.doesNotMatch(settings, /dangerouslySetInnerHTML/)
})

test('admin and teacher menu filtering is preserved and desktop/mobile shell is shared', async () => {
  const [dashboard, shell, css] = await Promise.all([
    readFile('Dashboard.jsx', 'utf8'),
    readFile('src/components/AuthenticatedShell.jsx', 'utf8'),
    readFile('index.css', 'utf8'),
  ])
  assert.match(dashboard, /isAdmin \|\| canUseStudentPackageCountSection/)
  assert.match(dashboard, /canManageOwnGroupClasses/)
  assert.match(dashboard, /isAdmin \? \[\{ key: 'teachers'/)
  assert.match(dashboard, /data-testid="dashboard-welcome-subtitle"/)
  assert.match(shell, /data-testid="desktop-sidebar"/)
  assert.match(shell, /data-testid="mobile-shell-header"/)
  assert.match(shell, /aria-current=/)
  assert.match(shell, /aria-expanded=/)
  assert.match(shell, /returnFocus: menuButtonRef\.current/)
  assert.doesNotMatch(shell, /aria-selected=/)
  assert.match(css, /\.dashboard--mobile \.main/)
  assert.match(css, /overflow-x: hidden/)
  assert.match(css, /env\(safe-area-inset-bottom/)
})

test('provider ordering does not block auth and route authorization remains unchanged', async () => {
  const [app, authContext, studentPage] = await Promise.all([
    readFile('App.jsx', 'utf8'),
    readFile('AuthContext.jsx', 'utf8'),
    readFile('StudentBookingPage.jsx', 'utf8'),
  ])
  assert.ok(app.indexOf('<AuthProvider>') < app.indexOf('<LocalizationProvider>'))
  assert.match(app, /path="\/dashboard"/)
  assert.match(app, /allowedRoles=\{\['admin', 'teacher'\]\}/)
  assert.match(app, /path="\/student-booking"/)
  assert.match(app, /allowedRoles=\{\['student'\]\}/)
  assert.equal((app.match(/path="\/student-booking"/g) || []).length, 1)
  assert.doesNotMatch(authContext, /LocalizationProvider|LayoutProvider|preferredLanguage/)
  assert.match(studentPage, /role !== 'student'/)
  assert.match(studentPage, /useLayoutMode\(\)/)
  assert.match(studentPage, /SettingsControl/)
})

test('document language follows initial, switched, malformed, and account-resolved language', () => {
  const documentRef = { documentElement: { lang: 'ko' } }

  let cleanup = synchronizeDocumentLanguage(documentRef, 'ko')
  assert.equal(documentRef.documentElement.lang, 'ko')
  cleanup()

  cleanup = synchronizeDocumentLanguage(documentRef, 'en')
  assert.equal(documentRef.documentElement.lang, 'en')
  cleanup()
  assert.equal(documentRef.documentElement.lang, 'ko')

  cleanup = synchronizeDocumentLanguage(documentRef, 'ko')
  assert.equal(documentRef.documentElement.lang, 'ko')
  cleanup()

  cleanup = synchronizeDocumentLanguage(documentRef, 'malformed')
  assert.equal(documentRef.documentElement.lang, 'ko')
  cleanup()

  const accountOverride = resolveLanguage({ accountLanguage: 'en', localLanguage: 'ko' })
  cleanup = synchronizeDocumentLanguage(documentRef, accountOverride)
  assert.equal(documentRef.documentElement.lang, 'en')
  cleanup()
})

test('legacy student layout values migrate one time with current-key precedence', () => {
  for (const legacyValue of ['auto', 'mobile', 'desktop']) {
    const storage = makeStorage({ [LEGACY_LAYOUT_STORAGE_KEY]: legacyValue })
    assert.equal(migrateLegacyLayoutMode(storage), legacyValue)
    assert.equal(storage.snapshot()[LAYOUT_STORAGE_KEY], legacyValue)
    assert.equal(storage.snapshot()[LEGACY_LAYOUT_STORAGE_KEY], undefined)
    assert.equal(readStoredLayoutMode(storage), legacyValue)
  }

  const currentWins = makeStorage({
    [LAYOUT_STORAGE_KEY]: 'mobile',
    [LEGACY_LAYOUT_STORAGE_KEY]: 'desktop',
  })
  assert.equal(migrateLegacyLayoutMode(currentWins), 'mobile')
  assert.equal(currentWins.snapshot()[LAYOUT_STORAGE_KEY], 'mobile')

  const malformed = makeStorage({ [LEGACY_LAYOUT_STORAGE_KEY]: 'tablet' })
  assert.equal(migrateLegacyLayoutMode(malformed), 'auto')
  assert.equal(malformed.snapshot()[LAYOUT_STORAGE_KEY], undefined)

  const missing = makeStorage()
  assert.equal(migrateLegacyLayoutMode(missing), 'auto')
})

test('legacy layout migration preserves presentation on write failure and is idempotent', () => {
  let removedAfterFailedWrite = false
  const failingStorage = {
    getItem: (key) => (key === LEGACY_LAYOUT_STORAGE_KEY ? 'desktop' : null),
    setItem: () => {
      throw new Error('storage denied')
    },
    removeItem: () => {
      removedAfterFailedWrite = true
    },
  }
  assert.equal(migrateLegacyLayoutMode(failingStorage), 'desktop')
  assert.equal(removedAfterFailedWrite, false)

  const values = new Map([[LEGACY_LAYOUT_STORAGE_KEY, 'mobile']])
  let writes = 0
  let removals = 0
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1
      values.set(key, value)
    },
    removeItem: (key) => {
      removals += 1
      values.delete(key)
    },
  }
  assert.equal(migrateLegacyLayoutMode(storage), 'mobile')
  assert.equal(readStoredLayoutMode(storage), 'mobile')
  assert.equal(migrateLegacyLayoutMode(storage), 'mobile')
  assert.equal(writes, 1)
  assert.equal(removals, 1)
})

function makeFocusEnvironment({ hiddenFirst = false } = {}) {
  let keydownListener = null
  let container = null
  const documentRef = {
    activeElement: null,
    body: null,
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    },
    addEventListener: (name, listener) => {
      assert.equal(name, 'keydown')
      keydownListener = listener
    },
    removeEventListener: (name, listener) => {
      assert.equal(name, 'keydown')
      if (keydownListener === listener) keydownListener = null
    },
    querySelectorAll: () => [container],
  }
  const makeElement = (name, overrides = {}) => {
    const attributes = new Map()
    return {
      name,
      disabled: false,
      hidden: false,
      inert: false,
      isConnected: true,
      ownerDocument: documentRef,
      focus() {
        documentRef.activeElement = this
      },
      getAttribute: (key) => attributes.get(key) ?? null,
      getClientRects: () => [{}],
      hasAttribute: (key) => attributes.has(key),
      removeAttribute: (key) => attributes.delete(key),
      setAttribute: (key, value) => attributes.set(key, String(value)),
      ...overrides,
    }
  }
  const hidden = makeElement('hidden', {
    hidden: hiddenFirst,
    getClientRects: () => (hiddenFirst ? [] : [{}]),
  })
  const first = makeElement('first')
  const last = makeElement('last')
  const trigger = makeElement('trigger')
  const controls = hiddenFirst ? [hidden, first, last] : [first, last]
  container = makeElement('dialog')
  container.querySelectorAll = () => controls
  container.contains = (element) => element === container || controls.includes(element)
  const background = makeElement('background')
  const body = {
    children: [background, container],
    parentElement: null,
  }
  background.parentElement = body
  container.parentElement = body
  documentRef.body = body

  return {
    background,
    container,
    documentRef,
    first,
    last,
    trigger,
    dispatch(key, shiftKey = false) {
      assert.ok(keydownListener)
      const event = {
        key,
        shiftKey,
        prevented: false,
        preventDefault() {
          this.prevented = true
        },
      }
      keydownListener(event)
      return event
    },
    hasListener: () => Boolean(keydownListener),
  }
}

test('drawer focus containment initializes, wraps Tab, closes on Escape, restores, and cleans up', () => {
  const env = makeFocusEnvironment()
  env.documentRef.activeElement = env.trigger
  let closeCount = 0
  const cleanup = installDialogFocusContainment({
    container: env.container,
    initialFocus: env.first,
    returnFocus: env.trigger,
    onClose: () => {
      closeCount += 1
    },
    documentRef: env.documentRef,
  })

  assert.equal(env.documentRef.activeElement, env.first)
  assert.equal(env.background.inert, true)
  assert.equal(env.background.getAttribute('aria-hidden'), 'true')
  env.last.focus()
  assert.equal(env.dispatch('Tab').prevented, true)
  assert.equal(env.documentRef.activeElement, env.first)
  assert.equal(env.dispatch('Tab', true).prevented, true)
  assert.equal(env.documentRef.activeElement, env.last)
  assert.equal(env.dispatch('Escape').prevented, true)
  assert.equal(closeCount, 1)
  cleanup()
  assert.equal(env.documentRef.activeElement, env.trigger)
  assert.equal(env.background.inert, false)
  assert.equal(env.background.getAttribute('aria-hidden'), null)
  assert.equal(env.hasListener(), false)
})

test('settings focus containment excludes hidden controls and has independent cleanup', () => {
  const env = makeFocusEnvironment({ hiddenFirst: true })
  env.documentRef.activeElement = env.trigger
  let closeCount = 0
  const cleanup = installDialogFocusContainment({
    container: env.container,
    initialFocus: null,
    returnFocus: env.trigger,
    onClose: () => {
      closeCount += 1
    },
    documentRef: env.documentRef,
  })

  assert.equal(env.documentRef.activeElement, env.first)
  env.last.focus()
  env.dispatch('Tab')
  assert.equal(env.documentRef.activeElement, env.first)
  env.dispatch('Tab', true)
  assert.equal(env.documentRef.activeElement, env.last)
  env.dispatch('Escape')
  assert.equal(closeCount, 1)
  cleanup()
  assert.equal(env.documentRef.activeElement, env.trigger)
  assert.equal(env.hasListener(), false)
})

test('remediation localizes shell fallbacks and enforces navigation and Login accessibility', async () => {
  const [login, shell, provider, css] = await Promise.all([
    readFile('Login.jsx', 'utf8'),
    readFile('src/components/AuthenticatedShell.jsx', 'utf8'),
    readFile('src/i18n/LocalizationProvider.jsx', 'utf8'),
    readFile('index.css', 'utf8'),
  ])

  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort())
  for (const key of [
    'login.emailPlaceholder',
    'login.passwordPlaceholder',
    'shell.accountInitialFallback',
    'shell.emailUnavailable',
    'shell.roleUnavailable',
    'shell.currentLayout',
  ]) {
    assert.equal(typeof en[key], 'string')
    assert.equal(typeof ko[key], 'string')
  }

  assert.match(login, /placeholder=\{t\('login\.emailPlaceholder'\)\}/)
  assert.match(login, /placeholder=\{t\('login\.passwordPlaceholder'\)\}/)
  assert.doesNotMatch(login, /placeholder="email@example\.com"|placeholder="••••••••"/)
  assert.match(shell, /t\('shell\.accountInitialFallback'\)/)
  assert.match(shell, /t\('shell\.emailUnavailable'\)/)
  assert.match(shell, /t\('shell\.roleUnavailable'\)/)
  assert.match(shell, /t\('shell\.currentLayout'/)
  assert.doesNotMatch(shell, /aria-selected=/)
  assert.match(shell, /aria-current=\{activeKey === item\.key \? 'page' : undefined\}/)
  assert.match(provider, /synchronizeDocumentLanguage\(document, language\)/)

  assert.match(css, /\.login-language-selector button\s*\{[\s\S]*?min-height:\s*44px/)
  assert.match(css, /\.login-public-link\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/)
  assert.match(css, /\.field input\s*\{[\s\S]*?min-height:\s*44px/)
  assert.match(css, /\.btn-primary\s*\{[\s\S]*?min-height:\s*44px/)
  assert.match(css, /\.field input:focus-visible\s*\{[\s\S]*?outline:/)
})

test('student booking presentation has ko/en parity and localized direct components', async () => {
  const [studentPage, dailyPanel, css] = await Promise.all([
    readFile('StudentBookingPage.jsx', 'utf8'),
    readFile('src/features/public/DailyMaterialStudentPanel.jsx', 'utf8'),
    readFile('index.css', 'utf8'),
  ])
  const requiredKeys = [
    'student.page.title',
    'student.quickNav.label',
    'student.tickets.title',
    'student.upcoming.title',
    'student.group.fixedTitle',
    'student.group.freeTitle',
    'student.private.bookingTitle',
    'student.private.reservationsTitle',
    'student.group.reservationsTitle',
    'student.history.title',
    'student.dailyVideo.title',
    'student.action.reserve',
    'student.action.cancelReservation',
    'student.status.reserved',
    'student.status.cancelled',
    'student.status.completed',
    'student.status.noShow',
  ]

  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort())
  for (const key of requiredKeys) {
    assert.equal(typeof ko[key], 'string', `missing ko key: ${key}`)
    assert.equal(typeof en[key], 'string', `missing en key: ${key}`)
    assert.notEqual(translate('en', key, null, { development: true }), `⟦missing:${key}⟧`)
  }
  assert.match(studentPage, /localize=\{true\}/)
  assert.match(studentPage, /installDialogFocusContainment/)
  assert.match(studentPage, /className="student-booking-dialog-panel"/)
  assert.match(dailyPanel, /useTranslation/)
  assert.doesNotMatch(dailyPanel, />오늘의 영상<|>영상 보기</)
  assert.match(
    css,
    /\.student-booking-mobile-overflow-root[\s\S]*?:where\(a, button,[\s\S]*?min-height:\s*44px !important/
  )
})
