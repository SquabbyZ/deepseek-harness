/**
 * Test the Settings → 代理 (Proxy) section: fill a URL, click 测试, click 保存.
 * Run: node apps/web/scripts/test-settings-proxy.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 200)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('代理', { exact: true }).first().click()
  await page.waitForTimeout(1500)

  const input = page.locator('[role=dialog] input').first()
  await input.fill('http://127.0.0.1:7890')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '测试' }).click()
  await page.waitForTimeout(1800)
  const afterTest = await page.evaluate(() => (document.querySelector('[role=dialog]')?.innerText ?? '').slice(0, 300))

  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(2500)
  const afterSave = await page.evaluate(() => (document.querySelector('[role=dialog]')?.innerText ?? '').slice(0, 300))
  // Re-open and confirm the URL persisted
  await page.getByRole('button', { name: '关闭' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2000)
  await page.getByText('代理', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  const persisted = await page.locator('[role=dialog] input').first().inputValue()

  console.log(JSON.stringify({ afterTest, afterSave, persisted, logs }, null, 2))
  await browser.close()
  process.exit(persisted === 'http://127.0.0.1:7890' ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
