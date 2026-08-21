import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 140)))

async function openList() {
  await page.goto('http://[::1]:5173/?fixture', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2200)
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(1800)
  await page.getByText('插件列表', { exact: true }).click()
  await page.waitForTimeout(2200)
}

await openList()
const togglable = await page.evaluate(() =>
  [...document.querySelectorAll('[data-plugin-entry]')]
    .filter((e) => { const sw = e.querySelector('[role="switch"], button[role="switch"]'); return sw && !sw.hasAttribute('disabled') })
    .map((e) => e.getAttribute('data-plugin-entry'))
)
console.log('toggleable count:', togglable.length)
const failures = []
const safe = []
for (const t of togglable) {
  const errBase = pageErrors.length
  const res = await page.evaluate(async (name) => {
    const row = [...document.querySelectorAll('[data-plugin-entry]')].find((e) => e.getAttribute('data-plugin-entry') === name)
    if (!row) return { found: false }
    const sw = row.querySelector('[role="switch"], button[role="switch"]')
    if (!sw) return { found: true, noSwitch: true }
    const before = sw.getAttribute('aria-checked')
    sw.click()
    await new Promise((r) => setTimeout(r, 1800))
    const after = sw.getAttribute('aria-checked')
    const alive = document.querySelectorAll('[data-plugin-entry]').length
    let restored = after
    if (after === 'false') {
      const sw2 = row.querySelector('[role="switch"], button[role="switch"]')
      sw2?.click()
      await new Promise((r) => setTimeout(r, 1800))
      restored = row.querySelector('[role="switch"], button[role="switch"]')?.getAttribute('aria-checked') ?? null
    }
    return { found: true, before, after, alive, restored }
  }, t)
  const newErrs = pageErrors.slice(errBase)
  const label = t.replace('@deepseek-ai/dsh-client-', '').replace('@deepseek-ai/dsh-', '')
  const badToggle = !res.found || res.noSwitch || res.alive === 0 || res.restored !== 'true' || newErrs.length > 0
  if (badToggle) {
    failures.push({ name: label, why: `alive=${res.alive} ${res.before}→${res.after}→${res.restored} errs=${newErrs.length}` })
  } else {
    safe.push(label)
  }
  console.log(`${badToggle ? '❌LOCK' : '✅SAFE'} ${label}`)
  // reload for a clean state before the next plugin
  await openList()
}
console.log('\nSAFE:', JSON.stringify(safe))
console.log('LOCK:', JSON.stringify(failures))
await browser.close()
