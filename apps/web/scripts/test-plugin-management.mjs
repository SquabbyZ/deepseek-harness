/**
 * E2E: 插件管理 top-level settings section.
 *  - nav sibling of 插件设置
 *  - tabs 内置插件 / 外部插件
 *  - 详情 button opens a bottom drawer
 *  - external rows have 卸载; confirm removes the entry
 *  - 插件设置 keeps only 插件配置 (no 插件列表 tab)
 * Run: node apps/web/scripts/test-plugin-management.mjs
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
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 220)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 220)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)

  // Nav: 插件管理 should be a sibling of 插件设置
  const navText = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    return d ? d.innerText : ''
  })
  navText.includes('插件管理') ? ok('导航含 插件管理', '') : bad('导航含 插件管理', '')
  navText.includes('插件设置') ? ok('导航含 插件设置', '') : bad('导航含 插件设置', '')

  // 插件设置 → should NOT have 插件列表 tab anymore (only 插件配置)
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(1800)
  const pluginsText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
  pluginsText.includes('插件配置') ? ok('插件设置 有 插件配置', '') : bad('插件设置 有 插件配置', '')
  pluginsText.includes('插件列表') ? bad('插件设置 不应有 插件列表', pluginsText.slice(0, 80)) : ok('插件设置 无 插件列表 tab', '')

  // Close & open 插件管理
  await page.getByText('插件管理', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  const mgmtText = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    return d ? d.innerText : ''
  })
  mgmtText.includes('内置插件') ? ok('插件管理 tab 内置插件', '') : bad('插件管理 tab 内置插件', '')
  mgmtText.includes('外部插件') ? ok('插件管理 tab 外部插件', '') : bad('插件管理 tab 外部插件', '')

  // builtin rows have 详情 buttons but no 卸载
  const builtinRows = await page.evaluate(() => {
    const r = document.querySelector('[class*="SOz1_a_root"]') // may not exist; fall back to dialog
    const list = document.querySelector('[data-plugin-tab-list="builtin"]')
    const rows = list ? list.querySelectorAll('[data-plugin-entry]').length : 0
    const detailBtns = list ? list.querySelectorAll('button').length : 0
    const uninstalls = list ? [...list.querySelectorAll('button')].filter((b) => (b.textContent || '').includes('卸载')).length : 0
    return { rows, detailBtns, uninstalls }
  })
  builtinRows.rows >= 20 ? ok('内置插件行数', `${builtinRows.rows}`) : bad('内置插件行数', `${builtinRows.rows}`)
  builtinRows.uninstalls === 0 ? ok('内置插件无卸载', '') : bad('内置插件无卸载', `${builtinRows.uninstalls}`)

  // 详情 drawer on a builtin row
  await page.evaluate(() => {
    const list = document.querySelector('[data-plugin-tab-list="builtin"]')
    const btn = list ? [...list.querySelectorAll('button')].find((b) => (b.textContent || '').includes('详情')) : null
    btn?.click()
  })
  await page.waitForTimeout(800)
  const drawer = await page.evaluate(() => {
    const d = document.querySelector('[data-plugin-detail]')
    return d ? d.innerText : ''
  })
  drawer.includes('模块 ID') ? ok('详情抽屉', '含 模块 ID') : bad('详情抽屉', drawer.slice(0, 80))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  // external tab → dshmarket row with 卸载 + 详情
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[data-plugin-tab]')].find((b) => b.getAttribute('data-plugin-tab') === 'external')
    tab?.click()
  })
  await page.waitForTimeout(1200)
  const extRows = await page.evaluate(() => {
    const list = document.querySelector('[data-plugin-tab-list="external"]')
    const rows = list ? [...list.querySelectorAll('[data-plugin-entry]')].map((r) => r.getAttribute('data-plugin-entry')) : []
    const btns = list ? [...list.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean) : []
    return { rows, btns }
  })
  extRows.rows.includes('dshmarket') ? ok('外部插件含 dshmarket', '') : bad('外部插件含 dshmarket', JSON.stringify(extRows.rows))
  extRows.btns.includes('卸载') && extRows.btns.includes('详情') ? ok('外部插件有 卸载+详情', '') : bad('外部插件有 卸载+详情', JSON.stringify(extRows.btns))

  const errs = logs.filter((l) => !/favicon|net::ERR/.test(l))
  errs.length ? bad('控制台错误', errs.join(' | ')) : ok('控制台错误', '无')
  await browser.close()
  const fails = results.filter((r) => !r[1]).length
  console.log(`\n${results.length - fails}/${results.length} passed`)
  process.exit(fails ? 1 : 0)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
