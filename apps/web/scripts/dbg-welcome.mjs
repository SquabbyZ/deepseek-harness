import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const hasNotice = await page.evaluate(() => document.body.innerText.includes('内测声明') || document.body.innerText.includes('Internal Testing Notice'))
console.log('内测声明 popup visible:', hasNotice)
// check the settings describe welcome ack
const ack = await page.evaluate(() => document.body.innerText.slice(0, 80))
console.log('boot text:', JSON.stringify(ack))
await browser.close()
