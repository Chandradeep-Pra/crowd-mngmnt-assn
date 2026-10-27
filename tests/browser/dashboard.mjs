// Optional isolated tooling; never connects to staging or uses real credentials.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'

const requireQA = createRequire(resolve(process.env.QA_MODULE_ROOT || '.qa-tools', 'package.json'))
let chromium
try { ({ chromium } = requireQA('playwright')) } catch {
  throw new Error('Isolated browser tooling is unavailable. Run: npm install --prefix .qa-tools --no-save --package-lock=false playwright; then npx --prefix .qa-tools playwright install chromium. See README.md.')
}
await readFile('dist/index.html') // Require a production build for load measurements.
const baseURL = 'http://127.0.0.1:4173'
const NOW = Date.parse('2026-10-27T12:30:00Z')
const output = resolve('qa-results')
await mkdir(output, { recursive: true })
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { windowsHide: true, stdio: 'ignore' })
let browser
const report = { profile: 'Production build, isolated Chromium, 150ms synthetic API latency, no CPU/network throttling', loadMs: [], checks: [] }
try {
  let available = false
  for (let i = 0; i < 50; i++) {
    if (preview.exitCode !== null) throw new Error('QA preview could not start; port 4173 must be free.')
    try { const response = await fetch(baseURL); if (response.ok) { available = true; break } } catch { /* preview is starting */ }
    await delay(200)
  }
  assert.ok(available, 'Production preview did not become available')
  browser = await chromium.launch({ headless: true, chromiumSandbox: true })

  // Three fresh contexts: no warm browser cache or stored authenticated state.
  for (let i = 0; i < 3; i++) {
    const fixture = await createFixture()
    try {
      await fixture.page.goto(baseURL)
      await signIn(fixture.page)
      const started = performance.now()
      await fixture.page.getByRole('button', { name: 'Sign in', exact: true }).press('Enter')
      await fixture.page.getByRole('heading', { name: 'Hourly occupancy', exact: true }).waitFor()
      await fixture.page.getByRole('combobox', { name: 'Hour', exact: true }).waitFor()
      await fixture.page.getByText('332', { exact: true }).waitFor()
      await fixture.page.locator('.ui-chart-plot .recharts-surface').first().waitFor()
      report.loadMs.push(Math.round(performance.now() - started))
      assert.ok(report.loadMs.at(-1) <= 5_000, 'Synthetic dashboard readiness exceeded 5s')
      assert.equal(fixture.errors.length, 0, 'Uncaught browser error')
      assert.equal(fixture.blocked.length, 0, 'Unexpected external or mutating request')
    } finally { await fixture.context.close() }
  }
  report.checks.push('Three cold-session dashboard loads within 5s under the stated fixture profile')

  const fixture = await createFixture(true)
  const { page } = fixture
  try {
    await page.goto(baseURL)
    // Real keyboard sequence through email, password, visibility toggle and submit.
    await page.getByRole('textbox', { name: 'Email' }).focus()
    await page.keyboard.type('qa@example.invalid')
    await page.keyboard.press('Tab'); await page.keyboard.type('synthetic-password')
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter')
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'text')
    await page.keyboard.press('Enter')
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'password')
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
    await page.getByText('332', { exact: true }).waitFor()
    await page.getByText('Connected', { exact: true }).waitFor({ state: 'attached' })
    assert.equal(await page.locator('#main-content').evaluate(el => el === document.activeElement), true)

    const period = page.getByRole('combobox', { name: 'Period', exact: true })
    await period.press('Enter')
    await page.getByRole('listbox', { name: 'Period', exact: true }).waitFor()
    await period.press('End')
    assert.match(await period.textContent(), /Today/, 'Browsing must not commit the pending choice')
    await period.press('Escape')
    assert.equal(await period.getAttribute('aria-expanded'), 'false')
    assert.equal(await period.evaluate(el => el === document.activeElement), true)
    await period.press('y'); await period.press('Enter')
    assert.match(await period.textContent(), /Yesterday/)
    await choose(page, 'Period', 'Today')
    await period.press('Enter')
    await page.getByRole('heading', { name: 'Overview', exact: true }).click()
    assert.equal(await period.getAttribute('aria-expanded'), 'false', 'Outside click dismisses')
    const hour = page.getByRole('combobox', { name: 'Hour', exact: true })
    const initialHour = await hour.textContent()
    await hour.press('z'); await hour.press('Enter')
    assert.equal(await hour.textContent(), initialHour, 'Unmatched typing retains the selected hour')
    await hour.press('Home'); await hour.press('Enter')
    const chosenHour = await hour.textContent()
    const account = page.getByLabel('Account actions', { exact: true })
    await account.press('Enter'); await account.press('Escape')
    assert.equal(await page.locator('.account-menu').getAttribute('open'), null)

    // No interval polling: idle after the one bounded connection catch-up.
    await page.clock.fastForward(16_000)
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor()
    const before = fixture.analytics.length
    fixture.setFootfall(333); fixture.emit('alert', movement('qa-new-entry', 'entry'))
    fixture.emit('live_occupancy', { ts: NOW + 1, siteId: 'qa-site', siteOccupancy: 125, zoneId: 'qa-zone', zoneOccupancy: 45 })
    await page.clock.fastForward(16_000)
    await page.getByText('333', { exact: true }).waitFor()
    assert.equal(await hour.textContent(), chosenHour, 'Background refresh preserves the chosen demographic hour')
    assert.equal(fixture.analytics.length - before, 7, 'One activity burst should fetch one snapshot')
    const after = fixture.analytics.length
    await page.clock.fastForward(16_000); await delay(250)
    assert.equal(fixture.analytics.length, after, 'Idle analytics must not poll')
    assert.equal(await page.locator('.movement-row--entry .movement-direction').first().textContent(), 'Entry')
    fixture.emit('alert', movement('qa-new-exit', 'exit'))
    await page.clock.fastForward(300)
    assert.equal(await page.locator('.movement-row--exit .movement-direction').first().textContent(), 'Exit')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    for (const [direction, tone, label, color] of [['zone-entry', 'entry', 'Zone entry', 'rgb(134, 239, 172)'], ['zone-exit', 'exit', 'Zone exit', 'rgb(252, 165, 165)']]) {
      fixture.emit('alert', movement(`qa-${direction}`, direction))
      await page.clock.fastForward(300)
      const pill = page.locator('.movement-direction').filter({ hasText: label }).first()
      await pill.waitFor()
      assert.equal(await pill.evaluate(el => getComputedStyle(el).backgroundColor), color)
      const animation = await pill.evaluate((el, tone) => {
        const row = el.closest('li'), style = getComputedStyle(row)
        return { tone: row.classList.contains(`movement-row--${tone}`), name: style.animationName, iterations: style.animationIterationCount }
      }, tone)
      assert.ok(animation.tone, `Missing ${tone} row color`)
      assert.equal(animation.name, 'movement-arrival')
      assert.equal(animation.iterations, '1')
      assert.equal(await page.locator('.overview-page .movement-row--new').count(), 1, 'Only the latest arrival should blink')
      assert.equal(await pill.evaluate(el => !!el.closest('li').querySelector('time.movement-time[datetime]')), true)
    }
    await page.clock.fastForward(3_000)

    for (const width of [320, 390, 768, 1024, 1563]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overview overflows at ${width}px`)
      const siteSelect = page.getByRole('combobox', { name: 'Site', exact: true })
      await siteSelect.press('Enter')
      const dropdown = page.getByRole('listbox', { name: 'Site', exact: true })
      await dropdown.waitFor()
      const bounds = await dropdown.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Dropdown overflows at ${width}px`)
      assert.notEqual(await dropdown.evaluate(el => getComputedStyle(el).boxShadow), 'none')
      await page.screenshot({ path: resolve(output, `site-dropdown-${width}.png`), fullPage: true })
      await siteSelect.press('Escape')
      const recent = page.getByRole('button', { name: /^Recent movement/ })
      await recent.focus(); await recent.press('Enter')
      await page.getByRole('dialog', { name: 'Recent movement', exact: true }).waitFor()
      assert.equal(await page.locator('.activity-dialog .movement-row--new').count(), 0, 'Retained movements must not pulse on opening')
      await page.keyboard.press('Tab')
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]')), 'Dialog focus escaped')
      await page.keyboard.press('Escape')
      assert.equal(await recent.evaluate(el => el === document.activeElement), true)
      if (width < 1000) {
        const open = page.getByRole('button', { name: 'Open navigation' })
        await open.focus(); await open.press('Enter')
        await page.getByRole('dialog', { name: 'Navigation', exact: true }).waitFor()
        await page.keyboard.press('Escape')
        assert.equal(await open.evaluate(el => el === document.activeElement), true)
      }
      await page.screenshot({ path: resolve(output, `overview-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1563, height: 900 })
    const entries = page.getByRole('link', { name: 'Crowd Entries', exact: true }).first()
    await entries.focus(); await entries.press('Enter')
    await page.getByRole('heading', { name: 'Visit records', exact: true }).waitFor()
    assert.equal(await page.locator('#main-content').evaluate(el => el === document.activeElement), true)
    await page.getByRole('cell', { name: 'No recorded exit', exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Next', exact: true }).press('Enter')
    await page.getByText('Page 2 of 2', { exact: true }).waitFor()
    for (const width of [320, 390, 768, 1024, 1563]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Entries overflows at ${width}px`)
      await page.screenshot({ path: resolve(output, `entries-${width}.png`), fullPage: true })
    }
    // Pauses in history; source activity does not refetch old ranges.
    await page.setViewportSize({ width: 1563, height: 900 })
    await page.getByRole('link', { name: 'Overview', exact: true }).first().press('Enter')
    await choose(page, 'Period', 'Yesterday')
    await page.getByRole('button', { name: 'Apply', exact: true }).press('Enter')
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor()
    const historical = fixture.analytics.length
    fixture.emit('alert', movement('qa-history', 'entry'))
    await page.clock.fastForward(20_000); await delay(250)
    assert.equal(fixture.analytics.length, historical)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    fixture.emit('alert', movement('qa-reduced', 'entry')); await page.clock.fastForward(300)
    assert.equal(await page.locator('.movement-row').first().evaluate(el => getComputedStyle(el).animationName), 'none')
    assert.equal(fixture.errors.length, 0, 'Uncaught browser error')
    assert.equal(fixture.blocked.length, 0, 'Unexpected external or mutating request')
    report.checks.push('Keyboard login, password toggle, route focus, dialogs and Escape', 'Overview and entries overflow/screenshots at 320/390/768/1024/1563px', 'Socket activity refresh coalescing, idle/history pause, entry/exit pills and reduced motion', 'Pagination and nullable exits')
  } finally { await fixture.context.close() }
  report.result = 'passed'
} catch (error) {
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : 'Unknown QA error'
  throw error
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close()
  preview.kill()
}
console.log(JSON.stringify(report, null, 2))

function movement(eventId, direction) { return { eventId, direction, ts: NOW, siteId: 'qa-site', personName: 'Example visitor', zoneName: 'Example zone', severity: 'medium' } }
async function signIn(page) {
  await page.getByRole('textbox', { name: 'Email' }).fill('qa@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password')
}
async function choose(page, label, option) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function createFixture(virtualClock = false) {
  const context = await browser.newContext({ viewport: { width: 1563, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage(), analytics = [], errors = [], blocked = []
  if (virtualClock) await page.clock.install({ time: new Date(NOW) })
  else await page.clock.setFixedTime(new Date(NOW))
  let footfall = 332
  const sockets = new Set()
  page.on('pageerror', () => errors.push('Uncaught browser error'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin === baseURL) return route.continue()
      blocked.push(url.pathname); return route.abort()
    }
    const allowed = (request.method() === 'POST' && ['/api/auth/login', ...['footfall', 'dwell', 'occupancy', 'demographics', 'entry-exit'].map(x => `/api/analytics/${x}`)].includes(url.pathname)) || (request.method() === 'GET' && url.pathname === '/api/sites')
    if (!allowed) { blocked.push(url.pathname); return route.abort() }
    await delay(150)
    const payload = request.postDataJSON() || {}
    let body
    if (url.pathname === '/api/auth/login') {
      const encoded = Buffer.from(JSON.stringify({ exp: Math.floor(NOW / 1000) + 3600 })).toString('base64url')
      body = { token: `e30.${encoded}.cWE` } // Synthetic expiry hint, never sent to a server.
    } else if (url.pathname === '/api/sites') body = [{ siteId: 'qa-site', name: 'Example venue', city: 'Bengaluru', country: 'India', timezone: 'Asia/Kolkata', zones: [{ zoneId: 'qa-zone', name: 'Example zone', securityLevel: 'medium' }] }]
    else {
      analytics.push({ path: url.pathname, ...payload })
      const utc = Math.ceil(payload.fromUtc / 3_600_000) * 3_600_000
      body = { ...payload, timezone: 'Asia/Kolkata' }
      if (url.pathname.endsWith('/footfall')) body.footfall = footfall
      if (url.pathname.endsWith('/dwell')) Object.assign(body, { avgDwellMinutes: 20.6, dwellRecords: 318 })
      if (url.pathname.endsWith('/occupancy')) body.buckets = [0, 1, 2].map(i => ({ utc: utc + i * 3_600_000, avg: 100 + i }))
      if (url.pathname.endsWith('/demographics')) body.buckets = [0, 1, 2].map(i => ({ utc: utc + i * 3_600_000, male: 70.6, female: 42.8 }))
      if (url.pathname.endsWith('/entry-exit')) Object.assign(body, { totalRecords: 50, totalPages: 2, records: [{ personId: 'example-person', personName: 'Example visitor', gender: 'male', zoneId: 'qa-zone', zoneName: 'Example zone', entryUtc: utc, exitUtc: null, exitLocal: null, dwellMinutes: null }] })
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await context.routeWebSocket(/.*/, socket => {
    if (!new URL(socket.url()).pathname.startsWith('/socket.io/')) { blocked.push('unexpected socket'); socket.close(); return }
    sockets.add(socket)
    socket.onClose(() => sockets.delete(socket))
    socket.onMessage(message => {
      if (String(message).startsWith('40')) {
        socket.send('40{"sid":"qa-socket"}')
        socket.send(`42${JSON.stringify(['live_occupancy', { ts: NOW, siteId: 'qa-site', siteOccupancy: 124, zoneId: 'qa-zone', zoneOccupancy: 44 }])}`)
      }
    })
    socket.send('0{"sid":"qa-engine","upgrades":[],"pingInterval":300000,"pingTimeout":300000}')
  })
  return { context, page, analytics, errors, blocked, setFootfall: value => { footfall = value }, emit: (event, payload) => { for (const socket of sockets) socket.send(`42${JSON.stringify([event, payload])}`) } }
}
