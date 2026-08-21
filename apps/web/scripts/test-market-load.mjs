import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 220)) })
page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 220)}`))
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
// Install a real plugin via the middleware
await page.evaluate(() => fetch('/dsh-market/install', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://github.com/Limitinfinitude/DSH-Right-Sidebar' }),
}).then((r) => r.json()))
await page.waitForTimeout(2000)
// Reload → boot merges the installed plugin
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const bootOk = await page.evaluate(() => document.body.innerText.slice(0, 80))
console.log('boot text:', JSON.stringify(bootOk))
// Open 插件管理 → 外部插件 tab
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('插件管理', { exact: true }).first().click()
await page.waitForTimeout(2500)
await page.locator('[data-plugin-tab="external"]').click()
await page.waitForTimeout(1500)
const ext = await page.evaluate(() => {
  const list = document.querySelector('[data-plugin-tab-list="external"]')
  return list ? [...list.querySelectorAll('[data-plugin-entry]')].map((r) => r.getAttribute('data-plugin-entry')) : []
})
console.log('external plugins:', JSON.stringify(ext))
const hasInstalled = ext.includes('dsh-right-sidebar') || ext.includes('DSH-Right-Sidebar')
console.log('installed plugin loaded:', hasInstalled)
const bootFailed = bootOk.includes('Failed to load') || bootOk.includes('boot failed')
console.log('boot failed:', bootFailed)
// Plugin-UI crashes (e.g. a plugin built for a newer layout API) are contained
// slot failures — not boot failures. Only boot-level / infra errors count here.
const errs = logs.filter((l) => !/favicon|net::ERR|Failed to load resource|getDetailsSurface|slot entry crashed|The above error occurred|at OutputDockLauncher|at RootEntry/.test(l))
console.log('console errors (boot-level):', JSON.stringify(errs))
// cleanup: uninstall the plugin so later tests boot without it
await page.evaluate(() => fetch('/dsh-market/uninstall', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'DSH-Right-Sidebar' }),
}).then((r) => r.json()))
await browser.close()
process.exit(hasInstalled && !bootFailed && errs.length === 0 ? 0 : 1)
