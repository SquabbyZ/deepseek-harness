/**
 * Verify market install (with confirm) → appears in 已安装 → uninstall removes it.
 * Run: node apps/web/scripts/test-market-uninstall.mjs
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
  const posts = []
  page.on('request', (r) => { if (r.url().includes('dsh-market')) posts.push(r.method() + ' ' + r.url().split('?')[0]) })
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.getByText('插件市场', { exact: false }).first().click()
  await page.waitForTimeout(2500)

  // 1. Click install on the first card (DOM click; the settings veil defeats actionability)
  const installBtnFound = await page.evaluate(() => {
    const root = document.querySelector('[class*="SOz1_a_root"]')
    const card = [...root.querySelectorAll('[class*="SOz1_a_card"]')][0]
    const btn = card ? [...card.querySelectorAll('button')].find((b) => /^安装$/.test((b.textContent || '').trim())) : null
    btn?.click()
    return !!btn
  })
  installBtnFound ? ok('卡片安装按钮', '已点击') : bad('卡片安装按钮', '未找到')
  await page.waitForTimeout(800)

  // 2. Confirm modal → click 安装/确定
  const confirmClicked = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const modal = dialogs.find((d) => /安装 .*\?/.test(d.innerText) && d.innerText.length < 300)
    if (!modal) return false
    const btn = [...modal.querySelectorAll('button')].find((b) => /安装|确定|确认/i.test((b.textContent || '').trim()))
    if (!btn) return false
    btn.click(); return true
  })
  confirmClicked ? ok('确认弹窗', '已点确定') : bad('确认弹窗', '未出现/未找到确定按钮')
  await page.waitForTimeout(2500)
  const installPosted = posts.filter((p) => p.startsWith('POST') && p.includes('/install')).length > 0
  installPosted ? ok('安装 POST', '已发出 /dsh-market/install') : bad('安装 POST', `posts=${posts.join(', ')}`)

  // 3. Switch to 已安装 tab and verify the plugin row
  await page.evaluate(() => {
    const r = document.querySelector('[class*="SOz1_a_root"]')
    const b = [...r.querySelectorAll('button')].find((b) => (b.textContent || '').includes('已安装'))
    b?.click()
  })
  await page.waitForTimeout(2000)
  const installedView = await page.evaluate(() => {
    const root = document.querySelector('[class*="SOz1_a_root"]')
    const rosterRows = [...root.querySelectorAll('[class*="rosterRow"], [class*="irow"]')]
    return { text: root.innerText.slice(0, 400), rows: rosterRows.map((r) => r.innerText.slice(0, 80)) }
  })
  const hasInstalledRow = /coding-agents|hindsight|vectorize-io/.test(installedView.text)
  hasInstalledRow ? ok('已安装列表', `含插件行: ${installedView.rows[0] ?? installedView.text.slice(0, 60)}`) : bad('已安装列表', installedView.text.slice(0, 120))

  // 4. Click 卸载 on the installed row (exact text; the row lives in irowActions)
  const uninstalled = await page.evaluate(() => {
    const root = document.querySelector('[class*="SOz1_a_root"]')
    const btn = [...root.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '卸载')
    if (!btn) return false
    btn.click(); return true
  })
  uninstalled ? ok('卸载按钮', '已点击') : bad('卸载按钮', '未找到')
  await page.waitForTimeout(800)
  // 4b. uninstall confirm dialog → click its 卸载 button
  const uninstConfirm = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('[role="dialog"]')].filter((d) => !!d.offsetParent)
    const modal = vis[vis.length - 1]
    if (!modal || !/卸载/.test(modal.innerText)) return 'no-dialog'
    const btn = [...modal.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '卸载')
    if (!btn) return 'no-btn'
    btn.click(); return 'clicked'
  })
  await page.waitForTimeout(2500)
  const uninstallPosted = posts.filter((p) => p.startsWith('POST') && p.includes('/uninstall')).length > 0
  uninstallPosted ? ok('卸载 POST', '已发出 /dsh-market/uninstall') : bad('卸载 POST', `confirm=${uninstConfirm}, posts=${posts.filter(p=>p.startsWith('POST')).join(', ')}`)

  // 5. Verify removed from installed view
  await page.evaluate(() => {
    const r = document.querySelector('[class*="SOz1_a_root"]')
    const b = [...r.querySelectorAll('button')].find((b) => (b.textContent || '').includes('已安装'))
    b?.click()
  })
  await page.waitForTimeout(1500)
  const afterText = await page.evaluate(() => {
    const root = document.querySelector('[class*="SOz1_a_root"]')
    return root ? root.innerText.slice(0, 300) : ''
  })
  const stillThere = /coding-agents|hindsight|vectorize-io/.test(afterText)
  stillThere ? bad('卸载后已清空', afterText.slice(0, 80)) : ok('卸载后已清空', '已安装列表无该插件')

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
