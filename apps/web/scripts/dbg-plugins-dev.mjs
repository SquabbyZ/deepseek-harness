import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('plugins-settings')) logs.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 200)))
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('插件设置', { exact: true }).first().click()
await page.waitForTimeout(2000)
const state = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  const sec = d?.querySelector('[data-plugins-rows]')
  const err = d?.querySelector('[data-plugins-error]')
  const cards = d ? [...d.querySelectorAll('li')].map((e) => (e.textContent || '').slice(0, 30)) : []
  return { rows: sec?.getAttribute('data-plugins-rows'), err: err?.textContent, cards, text: d?.innerText.slice(0, 150) }
})
console.log('state:', JSON.stringify(state))
console.log('logs:', JSON.stringify(logs))
await browser.close()
