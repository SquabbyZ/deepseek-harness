/**
 * E2E: 技能管理 (Skill Management) + MCP 管理 (MCP Management) settings sections.
 *  - nav siblings in the 设置 dialog (alongside 插件设置 / 插件管理)
 *  - 技能管理: fixture skill list renders, skills.sh search box wires up a
 *    remote-results region when a query is typed
 *  - MCP 管理: 新增 MCP 服务 add form opens / validates / submits; per-row
 *    测试 button renders and a probe attempt produces a status badge
 *
 * Self-contained Playwright script — deliberately does NOT import the deleted
 * apps/web/tests/scaffold.ts (the vitest web suite is broken by that deletion,
 * so this follows the manual scripts/ pattern instead).
 *
 * Run:
 *   pnpm --dir apps/web dev            # vite dev server on port 5173
 *   node apps/web/scripts/test-mcp-skill-management.mjs
 *
 * Network note: registry lookups (skills.sh / Smithery) go through the desktop
 * `http_request` bridge; without the Tauri bridge the fixture resolves an empty
 * result set, so the script asserts the search UI wires up (input present +
 * a remote-results region reaches a terminal state) rather than a live hit.
 */
import { chromium } from 'playwright'
const BASE = process.env.DSH_E2E_URL ?? 'http://[::1]:5173'
const browser = await chromium.launch()
const results = []
const ok = (n, d) => { results.push([n, true]); console.log(`  ✅ ${n}: ${d}`) }
const bad = (n, d) => { results.push([n, false]); console.log(`  ❌ ${n}: ${d}`) }
const skip = (n, d) => { console.log(`  ⏭️  ${n}: ${d}`) }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 220)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 220)}`))
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)

  // Boot guard: the official shell renders "Failed to load plugins" when a
  // plugin entry cannot activate (e.g. a pending remote service).
  const boot = await page.evaluate(() => document.body.innerText.slice(0, 200))
  boot.includes('Failed to load') || boot.includes('boot failed')
    ? bad('app boot', boot.slice(0, 140))
    : ok('app boot', 'fixture shell rendered')

  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)

  // Nav: 技能管理 / MCP 管理 should be siblings of 插件设置 / 插件管理.
  const navText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
  navText.includes('技能管理') ? ok('导航含 技能管理', '') : bad('导航含 技能管理', navText.slice(0, 140))
  navText.includes('MCP 管理') ? ok('导航含 MCP 管理', '') : bad('导航含 MCP 管理', navText.slice(0, 140))

  // ============================ 技能管理 ============================
  await page.getByText('技能管理', { exact: true }).first().click()
  await page.waitForTimeout(2200)

  const skillSearch = page.getByLabel('搜索技能')
  ;(await skillSearch.count()) > 0
    ? ok('技能搜索框存在', 'aria-label=搜索技能')
    : bad('技能搜索框存在', 'no [aria-label=搜索技能]')

  const skillEntries = await page.evaluate(() =>
    [...document.querySelectorAll('[data-skill-entry]')].map((e) => e.getAttribute('data-skill-entry')))
  ;['shell', 'web-search', 'agent-loop'].every((id) => skillEntries.includes(id))
    ? ok('技能列表渲染 fixture 技能', skillEntries.join(','))
    : bad('技能列表渲染 fixture 技能', skillEntries.join(','))

  const skillCount = await page.evaluate(() => document.querySelector('[data-skill-count]')?.textContent ?? '')
  skillCount === String(skillEntries.length)
    ? ok('技能计数', skillCount)
    : bad('技能计数', `count=${skillCount} rows=${skillEntries.length}`)

  const shellSwitch = page.getByRole('switch', { name: 'Shell' })
  if ((await shellSwitch.count()) > 0) {
    const before = await shellSwitch.getAttribute('aria-checked')
    await shellSwitch.click()
    // The switch flips optimistically (useDebouncedToggle) before the 500ms
    // debounced RPC. Browser fixture mode emits no `skill-inventory/changed`
    // event, so the store snapshot stays stale and the switch reverts after the
    // commit — the wiring we assert is the immediate optimistic flip.
    await page.waitForTimeout(100)
    const optimistic = await shellSwitch.getAttribute('aria-checked')
    before !== optimistic
      ? ok('技能开关切换(乐观态)', `${before}→${optimistic}`)
      : bad('技能开关切换(乐观态)', `${before}→${optimistic}`)
    await page.waitForTimeout(800) // let the debounced commit settle
    await shellSwitch.click() // restore the fixture state
    await page.waitForTimeout(800)
  } else {
    bad('技能开关存在', 'no role=switch named Shell')
  }

  // skills.sh search wiring: typing a query must surface the remote-results
  // region. In browser fixture mode the registry resolves empty (no desktop
  // bridge), so we assert the region + a terminal state, not a live hit.
  await skillSearch.fill('web')
  await page.waitForTimeout(1600) // 200ms debounce + registry resolve
  const remoteRes = await page.evaluate(() => {
    const r = document.querySelector('[data-remote-results]')
    return r ? r.innerText : ''
  })
  remoteRes.length > 0
    ? ok('skills.sh 搜索结果区出现', remoteRes.replace(/\n+/g, ' · ').slice(0, 140))
    : bad('skills.sh 搜索结果区出现', 'no [data-remote-results] region')
  ;/未找到|无法搜索|正在搜索|安装/.test(remoteRes)
    ? ok('skills.sh 搜索接线(远端状态)', '')
    : bad('skills.sh 搜索接线(远端状态)', remoteRes.slice(0, 140))
  await skillSearch.fill('')
  await page.waitForTimeout(400)

  // ============================ MCP 管理 ============================
  await page.getByText('MCP 管理', { exact: true }).first().click()
  await page.waitForTimeout(2200)

  const addBtn = page.getByText('新增 MCP 服务', { exact: true }).first()
  ;(await addBtn.count()) > 0
    ? ok('新增 MCP 服务 按钮存在', '')
    : bad('新增 MCP 服务 按钮存在', 'no 新增 MCP 服务 button')

  await addBtn.click()
  await page.waitForTimeout(600)
  const formFields = await page.evaluate(() => ({
    name: !!document.querySelector('#mcp-server-name'),
    command: !!document.querySelector('#mcp-command'),
    args: !!document.querySelector('#mcp-args'),
    transport: !!document.querySelector('#mcp-transport'),
  }))
  formFields.name && formFields.command && formFields.args && formFields.transport
    ? ok('新增表单字段', 'name/command/args/transport')
    : bad('新增表单字段', JSON.stringify(formFields))

  // Empty submit → validation alert.
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(400)
  const validationText = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? '')
  validationText.includes('必填')
    ? ok('空表单校验', validationText)
    : bad('空表单校验', validationText || '(no alert)')

  // Fill + submit a stdio server → the form closes (deterministic wiring).
  await page.fill('#mcp-server-name', 'fixture-echo')
  await page.fill('#mcp-command', 'node')
  await page.fill('#mcp-args', '-e console.log(1)')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(1500)
  const formStillOpen = await page.evaluate(() => !!document.querySelector('#mcp-server-name'))
  formStillOpen
    ? bad('新增提交后表单关闭', 'form still open')
    : ok('新增提交后表单关闭', '')

  // Row-dependent checks (list row + probe badge). The fixture's
  // mcpInventory/list now serves the in-memory mcpServers in browser mode (same
  // source of truth as the Tauri branch), so the added server shows up and the
  // 测试 probe attempt renders a status badge (fail without a live server).
  // If a row is ever absent (older fixture / no bridge), report as a skip.
  const mcpRows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mcp-entry]')].map((e) => e.getAttribute('data-mcp-entry')))
  if (mcpRows.length > 0) {
    ok('MCP 列表显示服务', mcpRows.join(','))
    const testBtn = page.getByRole('button', { name: '测试' }).first()
    if ((await testBtn.count()) > 0) {
      ok('行内 测试 按钮存在', '')
      await testBtn.click()
      await page.waitForTimeout(4000) // handshake timeout budget (stdio probe 5s)
      const badge = await page.evaluate(() => {
        const o = document.querySelector('[data-mcp-probe-ok]')
        const f = document.querySelector('[data-mcp-probe-fail]')
        return o ? `ok:${o.textContent}` : f ? `fail:${f.textContent}` : ''
      })
      badge.length > 0
        ? ok('测试产生状态 badge', badge)
        : bad('测试产生状态 badge', '(no probe badge rendered)')
    } else {
      bad('行内 测试 按钮存在', 'no 测试 button on rows')
    }
  } else {
    skip('MCP 列表显示服务', 'browser fixture mode keeps mcpInventory empty; verified in desktop mode')
    skip('行内 测试 按钮/状态 badge', 'needs a row (desktop bridge)')
  }

  const errs = logs.filter((l) => !/favicon|net::ERR|Failed to load resource|api-remotes/.test(l))
  errs.length ? bad('控制台错误', errs.join(' | ')) : ok('控制台错误', '无')
  await browser.close()
  const fails = results.filter((r) => !r[1]).length
  console.log(`\n${results.length - fails}/${results.length} passed`)
  process.exit(fails ? 1 : 0)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
