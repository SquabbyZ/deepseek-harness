/**
 * Inspect the Settings → 插件 section: what tabs/cards actually render.
 * Run: node apps/web/scripts/test-plugins-section.mjs
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
  await page.waitForTimeout(2500)

  const result = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    if (!d) return null
    // All buttons in the dialog (tabs + actions), and the panel content.
    const buttons = [...d.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean)
    // The settings content region: after the sidebar nav.
    const nav = d.querySelector('nav')
    const body = nav?.nextElementSibling ?? d
    const text = body ? body.innerText : ''
    // Any inputs/selects anywhere in the panel.
    const inputs = [...body.querySelectorAll('input, select, textarea')].map((i) => ({ tag: i.tagName, ph: i.getAttribute('placeholder') }))
    return { text: text.slice(0, 300), buttons, inputs, bodyHtmlLen: body ? body.outerHTML.length : 0 }
  })
  console.log(JSON.stringify({ result, logs }, null, 2))
  await browser.close()
  process.exit(0)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
