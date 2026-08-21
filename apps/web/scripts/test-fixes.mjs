/**
 * Verify the session-log download (issue 3) and the API-URL prefill (issue 2).
 * Run: node apps/web/scripts/test-fixes.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  const downloads = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 250)}`))
  page.on('download', (d) => downloads.push(d.suggestedFilename()))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const result = {}

  // Open the fixture history session (fx-alpha) from the sidebar.
  const sessionItem = page.getByText('Fixture 历史会话').first()
  if (await sessionItem.count()) { await sessionItem.click(); await page.waitForTimeout(2000) }

  // Issue 3: Session log button in the conversation header.
  const logBtn = page.getByRole('button', { name: /Session log/i }).first()
  result.logBtn = await logBtn.count()
  if (await logBtn.count()) { await logBtn.click(); await page.waitForTimeout(4000) }
  result.downloads = downloads
  // Dismiss any download-result dialog that the flow opened.
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(800)

  // Issue 2: API URL prefill after adding a provider.
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('模型', { exact: true }).first().click()
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: '添加提供方' }).click()
  await page.waitForTimeout(1500)
  const addOpts = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    return d ? d.innerText.split('\n').filter((l) => /GPT|Claude|Codex|MiniMax|GLM|Kimi/i.test(l)).slice(0, 10) : null
  })
  const openai = page.getByText(/OpenAI GPT/).first()
  if (await openai.count()) { await openai.click(); await page.waitForTimeout(1500) }
  result.apiUrl = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    const urlInput = d ? [...d.querySelectorAll('input')].find((i) => i.value.includes('api.') || i.placeholder.includes('api.')) : null
    return urlInput ? { val: urlInput.value, ph: urlInput.placeholder } : null
  })

  console.log(JSON.stringify({ result, addOpts, logs }, null, 2))
  await browser.close()
  process.exit(downloads.length > 0 && result.apiUrl?.val ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
