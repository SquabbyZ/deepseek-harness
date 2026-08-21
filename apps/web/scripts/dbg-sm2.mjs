import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 180)) })
page.on('pageerror', (e) => logs.push('PAGEERR: ' + String(e).slice(0, 180)))
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('插件管理', { exact: true }).first().click()
await page.waitForTimeout(2000)
const state = await page.evaluate(() => {
  const list = document.querySelector('[data-plugin-tab-list="builtin"]')
  const rows = list ? [...list.querySelectorAll('[data-plugin-entry]')].map((r) => r.getAttribute('data-plugin-entry')) : []
  const skill = rows.filter((r) => r.includes('skill') || r.includes('mcp'))
  const bootGraph = window.__DSH_BOOT__ ? window.__DSH_BOOT__.entries.map((e) => e.id) : []
  const smInGraph = bootGraph.filter((id) => id.includes('skill') || id.includes('mcp'))
  return { total: rows.length, skillMcp: skill, inGraph: smInGraph }
})
console.log('plugins:', JSON.stringify(state))
console.log('logs:', JSON.stringify(logs))
await browser.close()
