import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { chromium, webkit } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const css = fs.readFileSync(path.join(root, 'index.css'), 'utf8')
const viewports = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]

const calendarCells = (tag, attributes = '') =>
  Array.from(
    { length: 7 },
    (_, index) => `<${tag} ${attributes}>${index + 1}</${tag}>`
  ).join('')

const fixture = `<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8"></head>
  <body>
    <div id="root">
      <div class="dashboard dashboard--mobile dashboard--teacher">
        <header class="mobile-shell-header" data-testid="mobile-shell-header">
          <button class="icon-button" type="button" aria-label="메뉴">☰</button>
          <strong>Teacher Portal</strong>
          <button class="icon-button" type="button" aria-label="설정">⚙</button>
        </header>
        <main class="main" data-testid="main">
          <header class="main-header">
            <div>
              <h1 class="page-title">캘린더</h1>
              <p class="page-sub">오늘 일정과 예약을 확인하세요.</p>
            </div>
          </header>

          <section class="today-schedule-panel" data-testid="today-schedule-panel"
            style="border:1px solid #2e3240;border-radius:10px;padding:16px;margin-bottom:18px">
            <div class="today-schedule-summary-grid"
              style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">
              <article class="today-schedule-summary-card">오늘 수업 12</article>
              <article class="today-schedule-summary-card">예정 수업 8</article>
              <article class="today-schedule-summary-card">완료 수업 4</article>
              <article class="today-schedule-summary-card">예약 요청 3</article>
            </div>
          </section>

          <section class="activity-section" data-testid="reservation-notifications-panel"
            style="margin-bottom:20px">
            <div data-testid="reservation-header"
              style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
              <h2 class="section-title" style="margin:0">길이가 긴 최근 예약 알림 제목</h2>
              <span style="font-size:12px;opacity:.65">최근 20개</span>
            </div>
            <div style="display:grid;gap:8px">
              <div data-testid="reservation-notification-row"
                style="border:1px solid #2e3240;border-radius:8px;padding:10px 12px">
                학생 예약 알림은 Firebase 또는 외부 네트워크 없이 표시됩니다.
              </div>
            </div>
          </section>

          <section class="activity-section teacher-calendar-month" data-testid="teacher-calendar-month"
            style="margin-bottom:24px">
            <div class="teacher-calendar-toolbar"
              style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap">
              <button data-testid="toolbar-prev" type="button" style="padding:8px 12px">←</button>
              <div style="display:grid;gap:8px;justify-items:center">
                <h2 class="section-title" style="margin:0">2026년 8월</h2>
              </div>
              <button data-testid="toolbar-next" type="button" style="padding:8px 12px">→</button>
            </div>
            <div class="teacher-calendar-weekdays" data-testid="weekdays"
              style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:8px">
              ${calendarCells('div', 'data-testid="weekday-cell"')}
            </div>
            <div class="teacher-calendar-days" data-testid="days"
              style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px">
              ${calendarCells(
                'button',
                'type="button" data-testid="calendar-day-button" style="min-height:96px;padding:8px"'
              )}
            </div>
          </section>

          <section class="activity-section teacher-calendar-agenda"
            data-testid="calendar-lessons-section">
            <div class="teacher-selected-date-header" data-testid="selected-date-header"
              style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
              <div>
                <h2 class="section-title" style="margin:0">2026년 8월 7일 금요일 수업</h2>
                <p style="margin:6px 0 0;opacity:.75;font-size:13px">
                  선택한 날짜의 수업만 표시 중
                </p>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button data-testid="selected-date-action" type="button"
                  style="padding:10px 14px">전체 보기</button>
              </div>
            </div>
            <div class="activity-table teacher-responsive-table teacher-calendar-agenda-list">
              <div class="table-row">
                <span data-label="날짜">2026-08-07</span>
                <span data-label="학생">Mobile Safari Geometry Student</span>
              </div>
            </div>
            <section data-testid="private-reservation-history-section"
              style="margin-top:18px;border:1px solid #333b4f;border-radius:12px;padding:16px">
              <h3 style="margin:0;font-size:15px">1:1 예약 기록</h3>
              <div class="teacher-reservation-history-list"
                style="display:grid;gap:8px;margin-top:12px">
                <article class="teacher-reservation-history-row"
                  data-testid="private-reservation-history-row"
                  style="display:grid;grid-template-columns:minmax(84px,.85fr) minmax(64px,.65fr) minmax(110px,1fr) minmax(90px,.9fr) minmax(100px,1fr) minmax(62px,.55fr) minmax(86px,.75fr) minmax(112px,1fr);gap:10px;border:1px solid #283042;border-radius:10px;padding:10px 12px">
                  <span data-label="날짜">2026-08-07</span>
                  <span data-label="시간">18:00</span>
                  <span data-label="학생">Mobile Safari Geometry Student</span>
                  <span data-label="선생님">Teacher</span>
                  <span data-label="과목">Conversation</span>
                  <span data-label="수업 시간">50분</span>
                  <span data-label="상태">예약 완료</span>
                  <span data-label="내용">외부 네트워크 없는 표시 전용 기록</span>
                </article>
              </div>
            </section>
          </section>
        </main>
      </div>
    </div>
  </body>
</html>`

function installed(browserType) {
  return fs.existsSync(browserType.executablePath())
}

async function assertMobileGeometry(page, engine, viewport) {
  await page.setContent(fixture, { waitUntil: 'domcontentloaded' })
  await page.addStyleTag({ content: css })

  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing fixture element: ${selector}`)
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, width: box.width }
    }
    const rects = (selector) =>
      Array.from(document.querySelectorAll(selector), (element) => {
        const box = element.getBoundingClientRect()
        return { left: box.left, right: box.right, width: box.width }
      })

    return {
      clientWidth: document.documentElement.clientWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      elements: {
        shellHeader: rect('[data-testid="mobile-shell-header"]'),
        main: rect('[data-testid="main"]'),
        today: rect('[data-testid="today-schedule-panel"]'),
        reservationHeader: rect('[data-testid="reservation-header"]'),
        toolbarPrev: rect('[data-testid="toolbar-prev"]'),
        toolbarNext: rect('[data-testid="toolbar-next"]'),
        weekdays: rect('[data-testid="weekdays"]'),
        days: rect('[data-testid="days"]'),
        saturday: rect('[data-testid="weekday-cell"]:nth-child(7)'),
        seventhDay: rect('[data-testid="calendar-day-button"]:nth-child(7)'),
        selectedDateHeader: rect('[data-testid="selected-date-header"]'),
        selectedDateAction: rect('[data-testid="selected-date-action"]'),
        historyCard: rect('[data-testid="private-reservation-history-row"]'),
      },
      weekdayCells: rects('[data-testid="weekday-cell"]'),
      dayCells: rects('[data-testid="calendar-day-button"]'),
      weekdayGrid: rect('[data-testid="weekdays"]'),
      dayGrid: rect('[data-testid="days"]'),
    }
  })

  assert.ok(
    geometry.htmlScrollWidth <= geometry.clientWidth + 1,
    `${engine}/${viewport.width}: html scrollWidth ${geometry.htmlScrollWidth} > ${geometry.clientWidth}`
  )
  assert.ok(
    geometry.bodyScrollWidth <= geometry.bodyClientWidth + 1,
    `${engine}/${viewport.width}: body scrollWidth ${geometry.bodyScrollWidth} > ${geometry.bodyClientWidth}`
  )

  for (const [name, box] of Object.entries(geometry.elements)) {
    assert.ok(box.left >= -1, `${engine}/${viewport.width}/${name}: left ${box.left}`)
    assert.ok(
      box.right <= geometry.clientWidth + 1,
      `${engine}/${viewport.width}/${name}: right ${box.right} > ${geometry.clientWidth}`
    )
    assert.ok(
      box.width <= geometry.clientWidth + 1,
      `${engine}/${viewport.width}/${name}: width ${box.width} > ${geometry.clientWidth}`
    )
  }

  for (const [name, cells, grid] of [
    ['weekdays', geometry.weekdayCells, geometry.weekdayGrid],
    ['days', geometry.dayCells, geometry.dayGrid],
  ]) {
    assert.equal(cells.length, 7, `${engine}/${viewport.width}/${name}: expected 7 cells`)
    for (const [index, cell] of cells.entries()) {
      assert.ok(
        cell.left >= grid.left - 1 && cell.right <= grid.right + 1,
        `${engine}/${viewport.width}/${name}/${index + 1}: outside grid`
      )
    }
    const widths = cells.map((cell) => cell.width)
    assert.ok(
      Math.max(...widths) - Math.min(...widths) <= 2,
      `${engine}/${viewport.width}/${name}: unequal widths ${widths.join(', ')}`
    )
  }

  console.log(
    `GEOMETRY ${engine} ${viewport.width}x${viewport.height} ${JSON.stringify({
      clientWidth: geometry.clientWidth,
      htmlScrollWidth: geometry.htmlScrollWidth,
      bodyScrollWidth: geometry.bodyScrollWidth,
      main: geometry.elements.main,
      reservationHeader: geometry.elements.reservationHeader,
      days: geometry.elements.days,
      seventhDay: geometry.elements.seventhDay,
      selectedDateHeader: geometry.elements.selectedDateHeader,
      historyCard: geometry.elements.historyCard,
    })}`
  )
}

async function runEngine(browserType, engine) {
  const browser = await browserType.launch({ executablePath: browserType.executablePath() })
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport,
        offline: true,
        serviceWorkers: 'block',
      })
      const page = await context.newPage()
      await page.route('**/*', (route) => route.abort())
      await assertMobileGeometry(page, engine, viewport)
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

test('Chromium contains the teacher portal at both iPhone widths', async () => {
  assert.ok(
    installed(chromium),
    `CHROMIUM_STATUS=REQUIRED_NOT_INSTALLED path=${chromium.executablePath()}`
  )
  await runEngine(chromium, 'chromium')
  console.log('CHROMIUM_STATUS=RUN_INSTALLED_PASS')
})

if (installed(webkit)) {
  test('installed WebKit contains the teacher portal at both iPhone widths', async () => {
    await runEngine(webkit, 'webkit')
    console.log('WEBKIT_STATUS=RUN_INSTALLED_PASS')
  })
} else {
  test('WEBKIT_STATUS=NOT_RUN_NOT_INSTALLED', { skip: true }, () => {})
  console.log(`WEBKIT_STATUS=NOT_RUN_NOT_INSTALLED path=${webkit.executablePath()}`)
}
