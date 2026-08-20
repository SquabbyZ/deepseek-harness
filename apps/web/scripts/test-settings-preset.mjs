/**
 * Test the Settings → Agent 预设 copy flow with a fresh identifier + display name.
 * Run: node apps/web/scripts/test-settings-preset.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 250)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('Agent 预设', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /复制/ }).first().click()
  await page.waitForTimeout(2000)

  const inputs = page.locator('input')
  const count = await inputs.count()
  const states = []
  for (let i = 0; i < count; i++) {
    const ph = await inputs.nth(i).getAttribute('placeholder').catch(() => '')
    const val = await inputs.nth(i).inputValue().catch(() => '')
    states.push({ i, ph, val })
  }
  // identifier field: placeholder is the source id (my-agent)
  const idField = page.locator('input[placeholder="my-agent"]').first()
  const idCount = await idField.count()
  let idFilled = false
  if (idCount > 0) {
    await idField.fill('my-copy-id')
    idFilled = true
  }
  // display name field
  const display = page.locator('input[placeholder*="选择器"]').first()
  const displayCount = await display.count()
  if (displayCount > 0) await display.fill('我的复制预设')
  await page.waitForTimeout(500)

  const create = page.locator('button:has-text("创建")').first()
  const disabled = await create.isDisabled().catch(() => true)
  let created = false
  if (!disabled) { await create.click(); created = true }
  await page.waitForTimeout(2000)
  const after = await page.evaluate(() => document.body.innerText.includes('我的复制预设'))

  console.log(JSON.stringify({ count, states, idCount, idFilled, displayCount, createDisabled: disabled, created, after, logs }, null, 2))
  await browser.close()
  process.exit(created && after ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
