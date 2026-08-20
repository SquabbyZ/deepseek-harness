/**
 * Test the Settings → 模型 (Models) → DeepSeek credential editor save flow.
 * Verifies: editor opens, key can be entered, save succeeds without errors,
 * and the credential lands in localStorage (browser-dev fallback).
 * Run: node apps/web/scripts/test-settings-credential.mjs
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
  const step1 = await page.evaluate(() => ({
    hasSettingsBtn: document.body.innerText.includes('设置'),
    booted: document.body.innerText.includes('探索未至之境'),
  }))

  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  const step2 = await page.evaluate(() => ({ dialogOpen: !!document.querySelector('[role=dialog]') }))

  await page.getByText('模型', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  const step3 = await page.evaluate(() => (document.querySelector('[role=dialog]')?.innerText ?? '').slice(0, 150))

  const editCount = await page.getByRole('button', { name: /编辑/ }).count()
  if (editCount > 0) await page.getByRole('button', { name: /编辑/ }).first().click()
  await page.waitForTimeout(2000)
  const step4 = await page.evaluate(() => (document.querySelector('[role=dialog]')?.innerText ?? '').slice(0, 300))

  const pw = page.locator('[role=dialog] input[type=password]').first()
  const pwCount = await page.locator('[role=dialog] input[type=password]').count()
  let saved = null
  if (pwCount > 0) {
    await pw.fill('sk-test-12345')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '保存' }).click()
    await page.waitForTimeout(2500)
    saved = await page.evaluate(() => ({
      dialogText: (document.querySelector('[role=dialog]')?.innerText ?? '').slice(0, 250),
      storage: localStorage.getItem('dsh:fixture:credentials'),
    }))
  }

  console.log(JSON.stringify({ step1, step2, step3, editCount, step4, pwCount, saved, logs }, null, 2))
  await browser.close()
  process.exit(saved?.storage?.includes('sk-test-12345') ? 0 : 1)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
