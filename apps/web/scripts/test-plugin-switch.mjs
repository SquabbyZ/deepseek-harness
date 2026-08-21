/**
 * Test the 插件列表 switch (enable/disable) behavior.
 * Run: node apps/web/scripts/test-plugin-switch.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().includes('fixture')) logs.push(m.type() + ': ' + m.text().slice(0, 300)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 300)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const boot = await page.evaluate(() => document.body.innerText.slice(0, 150))
  if (boot.includes('Failed to load')) {
    console.log('BOOT FAIL: ' + boot)
    await browser.close()
    process.exit(1)
  }
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.getByText('插件列表', { exact: true }).click()
  await page.waitForTimeout(2500)

  // Find the first SwitchRow (the Sidebar plugin's toggle) and read its state.
  const firstRow = page.locator('[data-plugin-entry]').first()
  const entryId = await firstRow.getAttribute('data-plugin-entry')
  const switchEl = firstRow.locator('[role="switch"], button[role="switch"]').first()
  const switchCount = await switchEl.count()
  let before = null
  let optimistic = null
  let after = null
  if (switchCount > 0) {
    before = await switchEl.getAttribute('aria-checked').catch(() => null)
    await switchEl.click().catch((e) => logs.push(`switch click error: ${String(e).slice(0, 150)}`))
    await page.waitForTimeout(150) // optimistic state before the 500ms debounce commit
    optimistic = await switchEl.getAttribute('aria-checked').catch(() => null)
    await page.waitForTimeout(1500) // after the debounced commit
    after = await switchEl.getAttribute('aria-checked').catch(() => null)
  }
  const pageText = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    return d ? d.innerText.slice(-300) : ''
  })
  console.log(JSON.stringify({ entryId, switchCount, before, optimistic, after, pageTail: pageText, logs }, null, 2))
  await browser.close()
  process.exit(before === "true" && after === "false" ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
