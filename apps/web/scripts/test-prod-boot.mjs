import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 200)))
// serve the static dist — simulate the Tauri prod (no vite middleware)
await page.goto('http://localhost:4321/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
const state = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 120),
  failed: document.body.innerText.includes('Failed to load plugins'),
}))
console.log('boot text:', JSON.stringify(state.text))
console.log('boot failed:', state.failed)
const errs = logs.filter((l) => !/favicon/.test(l))
console.log('console errors:', JSON.stringify(errs.slice(0, 4)))
await browser.close()
process.exit(state.failed ? 1 : 0)
