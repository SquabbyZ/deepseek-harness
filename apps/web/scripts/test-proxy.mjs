import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 200)))
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('代理', { exact: true }).first().click()
await page.waitForTimeout(2000)
// find the proxy input (placeholder has default http://127.0.0.1:7890)
const inputInfo = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')].map((i) => ({ ph: i.placeholder, val: i.value }))
  return inputs.find((i) => i.ph?.includes('7890') || i.ph?.includes('proxy') || i.ph?.includes('代理')) ?? inputs.slice(0, 5)
})
console.log('proxy input:', JSON.stringify(inputInfo))
// fill a proxy url and save
const filled = await page.evaluate(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('7890'))
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'http://127.0.0.1:7890')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})
console.log('filled:', filled)
await page.waitForTimeout(500)
// click 保存 / Save
const saveClicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim())
  const save = [...document.querySelectorAll('button')].find((b) => /保存|Save/.test((b.textContent || '').trim()))
  save?.click(); return !!save
})
console.log('save clicked:', saveClicked)
await page.waitForTimeout(1200)
const errs = logs.filter((l) => !/favicon|net::ERR/.test(l))
console.log('console errors:', JSON.stringify(errs))
await browser.close()
process.exit(errs.length ? 1 : 0)
