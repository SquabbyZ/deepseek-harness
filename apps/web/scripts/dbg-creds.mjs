import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const creds = await page.evaluate(() => {
  const raw = localStorage.getItem('dsh:fixture:credentials')
  if (!raw) return 'NO STORE'
  const obj = JSON.parse(raw)
  return Object.keys(obj)
})
console.log('fixture credential refs:', JSON.stringify(creds))
await browser.close()
