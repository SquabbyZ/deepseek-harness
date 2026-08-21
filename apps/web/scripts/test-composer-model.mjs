import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const modelChips = await page.evaluate(() => {
  // the composer model selector chip
  const chips = [...document.querySelectorAll('button, [role="button"]')]
    .filter((b) => /deepseek|v4-flash|model/i.test((b.textContent || '')))
    .map((b) => (b.textContent || '').trim().slice(0, 40))
  return [...new Set(chips)].slice(0, 6)
})
console.log('composer model chips:', JSON.stringify(modelChips))
await browser.close()
