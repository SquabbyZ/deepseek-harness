import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 180)) })
page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 180)))
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
// open 模型 settings
await page.getByText('模型', { exact: true }).first().click()
await page.waitForTimeout(2000)
const modelText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
console.log('模型 section loaded:', modelText.length > 50)
// find a provider editor's save button (保存)
const saveFound = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  const btn = [...d.querySelectorAll('button')].find((b) => /保存|Save/.test((b.textContent || '').trim()))
  if (!btn) return 'none'
  btn.click(); return (btn.textContent || '').trim()
})
console.log('save clicked:', saveFound)
await page.waitForTimeout(1500)
const errs = logs.filter((l) => !/favicon|net::ERR/.test(l))
console.log('console errors:', JSON.stringify(errs))
await browser.close()
process.exit(errs.some((l) => l.includes('no settings namespaces')) ? 1 : 0)
