/**
 * Verify market install → appears in 已安装 → uninstall removes it.
 * Install goes through the real pipeline (middleware fetches the plugin's
 * client bundle from GitHub via the local proxy); uninstall exercises the UI.
 * Run: node apps/web/scripts/test-market-uninstall.mjs
 */
import { chromium } from 'playwright'
const BASE = process.env.DSH_E2E_URL ?? 'http://[::1]:5173'
const KNOWN_URL = 'https://github.com/Limitinfinitude/DSH-Right-Sidebar'
const browser = await chromium.launch()
const results = []
const ok = (n, d) => { results.push([n, true]); console.log(`  ✅ ${n}: ${d}`) }
const bad = (n, d) => { results.push([n, false]); console.log(`  ❌ ${n}: ${d}`) }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 180)) })
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)

  // 1. Install a known-good plugin through the real pipeline.
  const installRes = await page.evaluate((url) => fetch('/dsh-market/install', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
  }).then((r) => r.json()), KNOWN_URL)
  installRes.ok === true ? ok('安装（真实拉包）', `bundleUrl=${installRes.bundleUrl}`) : bad('安装（真实拉包）', installRes.error ?? 'unknown')

  const installedAfter = await page.evaluate(() => fetch('/dsh-market/installed').then((r) => r.json()))
  installedAfter.installed && Object.keys(installedAfter.installed).length >= 1
    ? ok('已安装记录', JSON.stringify(installedAfter.installed))
    : bad('已安装记录', JSON.stringify(installedAfter))

  // 2. Open the market 已安装 tab and uninstall via the UI.
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.getByText('插件市场', { exact: false }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText(/^已安装/, { exact: false }).first().click()
  await page.waitForTimeout(2000)

  const uninstallBtn = await page.evaluate(() => {
    const root = document.querySelector('[class*="SOz1_a_root"]')
    const btn = root ? [...root.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '卸载') : null
    btn?.click(); return !!btn
  })
  uninstallBtn ? ok('卸载按钮', '已点击') : bad('卸载按钮', '未找到')
  await page.waitForTimeout(800)
  const confirmClicked = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('[role="dialog"]')].filter((d) => !!d.offsetParent)
    const modal = vis[vis.length - 1]
    if (!modal || !/卸载/.test(modal.innerText)) return 'no-dialog'
    const btn = [...modal.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '卸载')
    if (!btn) return 'no-btn'
    btn.click(); return 'clicked'
  })
  await page.waitForTimeout(2500)
  const uninstallPosted = await page.evaluate(() => fetch('/dsh-market/installed').then((r) => r.json()))
  const cleared = uninstallPosted.installed && Object.keys(uninstallPosted.installed).length === 0
  cleared ? ok('卸载后已清空', '') : bad('卸载后已清空', JSON.stringify(uninstallPosted.installed))

  const errs = logs.filter((l) => !/favicon|net::ERR|Failed to load resource/.test(l))
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
