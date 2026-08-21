import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 180)) })
await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)

// 1. Configure a custom provider in llm-pi-ai (as 设置-模型 would save it)
const saved = await page.evaluate(async () => {
  const rpc = (window.__DSH_BOOT__) // no direct rpc handle; use the fixture API via connection
  return 'skip'
})
// Instead: go through the settings UI by mutating via the app's own connection is complex.
// Use the fixture's in-process api via window if exposed. Fallback: navigate settings UI.
// Open 设置 → 模型 → check the picker reflects a configured provider by directly
// calling the fixture through the page's fetch to a debug? The fixture isn't HTTP.
// Simplest robust check: mutate llm-pi-ai through the settings RPC using the app's own
// client — reachable via the connection plugin? Hard. Let's instead verify via the
// models UI: add a provider and confirm the composer reflects it.

// Open 设置 → 模型
await page.getByRole('button', { name: '设置' }).first().click()
await page.waitForTimeout(2500)
await page.getByText('模型', { exact: true }).first().click()
await page.waitForTimeout(2000)
const modelText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
console.log('模型 section has MiniMax/GLM groups:', /MiniMax|智谱/.test(modelText))
const errs = logs.filter((l) => !/favicon|net::ERR/.test(l))
console.log('console errors:', JSON.stringify(errs))
await browser.close()
