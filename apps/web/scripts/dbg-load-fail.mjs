import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 250)}`) })
page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 250)}`))
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.evaluate(() => fetch('/dsh-market/install', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://github.com/Limitinfinitude/DSH-Right-Sidebar' }),
}).then((r) => r.json()))
await page.waitForTimeout(2000)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
const state = await page.evaluate(() => ({
  bootText: document.body.innerText.slice(0, 150),
  bootGraph: (window.__DSH_BOOT__) ? JSON.stringify(window.__DSH_BOOT__).slice(0, 200) : 'NO GRAPH',
}))
console.log('state:', JSON.stringify(state, null, 2))
console.log('logs:', JSON.stringify(logs, null, 2))
await browser.close()
