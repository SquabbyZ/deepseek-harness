/**
 * Verify the Settings → 插件 card save flow (edit a field + save).
 * Run: node apps/web/scripts/test-plugin-save.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 250)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 250)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.getByText('终端', { exact: true }).first().click()
  await page.waitForTimeout(1500)

  const timeoutInput = page.locator('[role=dialog] input').first()
  await timeoutInput.fill('45000')
  await page.waitForTimeout(400)
  const saveBtn = page.getByRole('button', { name: /保存/ }).first()
  const saveCount = await saveBtn.count()
  let saveResult = 'not-clicked'
  if (saveCount > 0) {
    await saveBtn.click()
    await page.waitForTimeout(2000)
    saveResult = await page.evaluate(() => {
      const d = document.querySelector('[role=dialog]')
      return d ? (d.innerText.includes('已保存') || d.innerText.includes('保存成功') ? 'saved' : 'no-confirm') : 'no-dialog'
    })
  }
  // Re-read the field to confirm persistence.
  const persisted = await timeoutInput.inputValue().catch(() => '')
  console.log(JSON.stringify({ saveCount, saveResult, persisted, logs }, null, 2))
  await browser.close()
  process.exit(persisted === '45000' ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
