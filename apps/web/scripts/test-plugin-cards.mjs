/**
 * Verify the Settings → 插件 cards render + expose fields (expand 终端 card).
 * Run: node apps/web/scripts/test-plugin-cards.mjs
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
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(2000)

  // The three cards should be visible.
  const cards = []
  for (const name of ['终端', 'Agent 循环', '网页搜索']) {
    const count = await page.getByText(name, { exact: true }).count()
    cards.push({ name, count })
  }
  // Expand the 终端 (bash) card and read its fields.
  const bash = page.getByText('终端', { exact: true }).first()
  let fields = []
  if (await bash.count()) {
    await bash.click()
    await page.waitForTimeout(1500)
    fields = await page.evaluate(() => {
      const d = document.querySelector('[role=dialog]')
      return d ? [...d.querySelectorAll('input')].map((i) => ({ ph: i.placeholder, val: i.value })) : []
    })
  }
  console.log(JSON.stringify({ cards, bashFields: fields, logs }, null, 2))
  await browser.close()
  process.exit(cards.every((c) => c.count > 0) ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
