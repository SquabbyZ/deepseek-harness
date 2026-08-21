import { chromium } from 'playwright'
const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 250)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 250)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件市场', { exact: true }).click()
  await page.waitForTimeout(3000)
  const installBtn = page.getByRole('button', { name: /安装/ }).first()
  const count = await installBtn.count()
  let installedVisible = false
  if (count > 0) {
    await installBtn.click()
    await page.waitForTimeout(2500)
  }
  const text = await page.evaluate(() => (document.querySelector('[role=dialog]')?.innerText ?? '').slice(0, 500))
  installedVisible = text.includes('已安装') || text.includes('安装')
  console.log(JSON.stringify({ installBtnCount: count, text: text.split('\n').filter((l) => /安装|已安装|bar-plugin|coding-agents/i.test(l)).slice(0, 8), logs }, null, 2))
  await browser.close()
  process.exit(count > 0 ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
