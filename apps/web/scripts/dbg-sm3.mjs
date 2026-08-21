import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => logs.push('PAGEERR: ' + String(e).slice(0, 200)))
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('插件管理', { exact: true }).first().click()
await page.waitForTimeout(2000)
const state = await page.evaluate(() => {
  const list = document.querySelector('[data-plugin-tab-list="builtin"]')
  const rows = list ? [...list.querySelectorAll('[data-plugin-entry]')] : []
  const target = rows.filter((r) => {
    const n = r.getAttribute('data-plugin-entry')
    return n.includes('ui-settings-skill') || n.includes('ui-settings-mcp') || n.includes('api-remotes')
  })
  return target.map((r) => ({
    name: r.getAttribute('data-plugin-entry').split('dsh-client-')[1] || r.getAttribute('data-plugin-entry'),
    caption: r.querySelector('[class*="caption"], p:nth-child(2)')?.textContent,
    checked: r.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
  }))
})
console.log('rows:', JSON.stringify(state))
console.log('logs:', JSON.stringify(logs))
await browser.close()
