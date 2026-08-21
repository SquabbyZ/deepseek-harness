/**
 * Verify the dsh-market plugin boots and renders its Settings section.
 * Run: node apps/web/scripts/test-dshmarket.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 300)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const boot = await page.evaluate(() => document.body.innerText.slice(0, 200))
  if (boot.includes('Failed to load')) {
    console.log('BOOT FAIL:\n' + boot)
    console.log('LOGS:', JSON.stringify(logs, null, 2))
    await browser.close()
    process.exit(1)
  }
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  const nav = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    const navEl = d?.querySelector('nav')
    return navEl ? navEl.innerText.split('\n').filter(Boolean) : []
  })
  // Click 插件市场 and read the section content.
  const market = page.getByText('插件市场', { exact: true })
  let marketContent = null
  if (await market.count()) {
    await market.click()
    await page.waitForTimeout(4000)
    marketContent = await page.evaluate(() => {
      const nav = document.querySelector('[role=dialog] nav')
      const body = nav?.nextElementSibling
      return body ? body.innerText.slice(0, 500) : null
    })
  }
  console.log(JSON.stringify({ nav, marketContent, logs }, null, 2))
  await browser.close()
  process.exit(nav.includes('插件市场') ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
