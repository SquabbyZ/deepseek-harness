import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 180)) })
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('通用设置', { exact: true }).first().click()
await page.waitForTimeout(2500)
// click the permission pill (button containing 工作区写入)
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  const btn = [...d.querySelectorAll('button')].find((b) => (b.textContent || '').includes('工作区写入'))
  btn?.click()
})
await page.waitForTimeout(1000)
const options = await page.evaluate(() => {
  // dropdown items rendered in a menu
  return [...document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-menu-item]')].map((e) => (e.textContent || '').trim()).filter(Boolean)
})
console.log('dropdown options:', JSON.stringify(options))
// click 只读 if present
const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-menu-item]')].find((e) => (e.textContent || '').includes('只读'))
  if (!el) return false
  el.click(); return true
})
await page.waitForTimeout(1500)
const after = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
console.log('clicked 只读:', clicked, '| row now shows 只读:', after.includes('只读'))
const errs = logs.filter((l) => !/favicon|net::ERR/.test(l))
console.log('console errors:', JSON.stringify(errs))
await browser.close()
