/**
 * Verify the plugin inventory reflects the REAL loaded plugin graph:
 *  - the list shows official built-ins (real names/count) + dshmarket external
 *  - shell-critical & service-provider plugins have a locked switch (ui-theme etc.)
 *  - toggling a leaf plugin (ui-goal) persists and the app survives the fiber dispose
 * Run: node apps/web/scripts/test-inventory-real.mjs
 */
import { chromium } from 'playwright'
const BASE = process.env.DSH_E2E_URL ?? 'http://[::1]:5173'
const browser = await chromium.launch()
const results = []
const ok = (n, d) => { results.push([n, true]); console.log(`  ✅ ${n}: ${d}`) }
const bad = (n, d) => { results.push([n, false]); console.log(`  ❌ ${n}: ${d}`) }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 250)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 250)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件管理', { exact: true }).first().click()
  await page.waitForTimeout(2500)

  const info = await page.evaluate(() => {
    const list = document.querySelector('[data-plugin-tab-list="builtin"]')
    const rows = list ? [...list.querySelectorAll('[data-plugin-entry]')] : []
    const states = rows.map((r) => {
      const sw = r.querySelector('[role="switch"], button[role="switch"]')
      return {
        name: r.getAttribute('data-plugin-entry'),
        checked: sw?.getAttribute('aria-checked') ?? null,
        disabled: sw?.hasAttribute('disabled') ?? false,
      }
    })
    return { builtinCount: rows.length, names: rows.map((r) => r.getAttribute('data-plugin-entry')), states }
  })
  // Switch to the external tab to read its rows.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[data-plugin-tab]')].find((b) => b.getAttribute('data-plugin-tab') === 'external')
    tab?.click()
  })
  await page.waitForTimeout(1200)
  const externalNames = await page.evaluate(() => {
    const list = document.querySelector('[data-plugin-tab-list="external"]')
    return list ? [...list.querySelectorAll('[data-plugin-entry]')].map((r) => r.getAttribute('data-plugin-entry')) : []
  })
  // Back to the built-in tab for the toggle test.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[data-plugin-tab]')].find((b) => b.getAttribute('data-plugin-tab') === 'builtin')
    tab?.click()
  })
  await page.waitForTimeout(1000)

  info.builtinCount >= 20 ? ok('真实插件数量', `${info.builtinCount} 内置 + ${externalNames.length} 外部`) : bad('真实插件数量', `${info.builtinCount}`)
  info.names.includes('@deepseek-ai/dsh-client-connection') ? ok('含 connection', '') : bad('含 connection', '')
  externalNames.includes('dshmarket') ? ok('dshmarket 在外部', '') : bad('dshmarket 在外部', JSON.stringify(externalNames))

  // Shell-critical + service-provider rows are locked.
  const lockName = (n) => { const s = info.states.find((x) => x.name === n); return s && s.disabled === true }
  lockName('@deepseek-ai/dsh-client-connection') ? ok('connection 锁定', '') : bad('connection 锁定', '')
  lockName('@deepseek-ai/dsh-client-ui-theme') ? ok('ui-theme 锁定', '(提供 theme service，被 ui-layout 注入)') : bad('ui-theme 锁定', '')

  // Toggle a leaf plugin: ui-goal — real fiber dispose, app must survive.
  const leafName = '@deepseek-ai/dsh-client-ui-goal'
  const row = page.locator(`[data-plugin-entry="${leafName}"]`)
  const sw = row.locator('[role="switch"], button[role="switch"]').first()
  const swCount = await sw.count()
  if (swCount > 0) {
    const before = await sw.getAttribute('aria-checked')
    await sw.click()
    await page.waitForTimeout(2000) // debounced commit → real fiber dispose
    const alive = await page.evaluate(() => document.querySelectorAll('[data-plugin-entry]').length)
    const after = await sw.getAttribute('aria-checked')
    before === "true" && after === "false" && alive >= 20
      ? ok('叶子插件开关真实生效', `${leafName}: ${before} → ${after}, 列表仍存活(${alive})`)
      : bad('叶子插件开关真实生效', `${leafName}: ${before} → ${after}, alive=${alive}`)
    // re-enable to restore the fiber
    if (after === "false") { await sw.click(); await page.waitForTimeout(2000) }
    const restored = await sw.getAttribute('aria-checked')
    restored === "true" ? ok('重新启用', `${leafName} 恢复 ${restored}`) : bad('重新启用', `${restored}`)
  } else {
    bad('叶子插件开关', `no switch for ${leafName}`)
  }

  const errs = logs.filter((l) => !/favicon|net::ERR/.test(l) && !l.includes('PAGEERR'))
  errs.length ? bad('控制台错误', errs.join(' | ')) : ok('控制台错误', '无')
  const pageErrors = logs.filter((l) => l.includes('PAGEERR'))
  pageErrors.length ? bad('页面崩溃', pageErrors.join(' | ')) : ok('页面崩溃', '无')
  await browser.close()
  const fails = results.filter((r) => !r[1]).length
  console.log(`\n${results.length - fails}/${results.length} passed`)
  process.exit(fails ? 1 : 0)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
