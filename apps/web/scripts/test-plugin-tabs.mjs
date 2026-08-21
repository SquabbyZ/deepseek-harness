/**
 * Verify the Settings → 插件设置 section: the 插件配置 + 插件列表 tabs.
 * Run: node apps/web/scripts/test-plugin-tabs.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 250)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 250)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const boot = await page.evaluate(() => document.body.innerText.slice(0, 150))
  if (boot.includes('Failed to load')) {
    console.log('BOOT FAIL: ' + boot)
    await browser.close()
    process.exit(1)
  }
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(2500)

  const tabs = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    return d ? [...d.querySelectorAll('[role=tab]')].map((t) => t.innerText.trim()) : []
  })
  // Click the 插件列表 tab and read the inventory.
  const listTab = page.getByText('插件列表', { exact: true })
  let inventory = null
  if (await listTab.count()) {
    await listTab.click()
    await page.waitForTimeout(2500)
    inventory = await page.evaluate(() => {
      const nav = document.querySelector('[role=dialog] nav')
      const body = nav?.nextElementSibling
      return body ? body.innerText.slice(0, 700) : null
    })
  }
  console.log(JSON.stringify({ tabs, inventory, logs }, null, 2))
  await browser.close()
  process.exit(0)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
