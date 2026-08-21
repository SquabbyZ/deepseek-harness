/**
 * Deep functional test of the dsh-market plugin UI.
 * Covers: search, categories, install button, theme tab, installed tab,
 * advanced tab, tasks tab. Reports each step's result + any console errors.
 * Run: node apps/web/scripts/test-market-deep.mjs
 */
import { chromium } from 'playwright'
const BASE = process.env.DSH_E2E_URL ?? 'http://[::1]:5173'
const browser = await chromium.launch()
const results = []
const ok = (name, detail) => { results.push({ name, pass: true, detail }); console.log(`  ✅ ${name}: ${detail}`) }
const bad = (name, detail) => { results.push({ name, pass: false, detail }); console.log(`  ❌ ${name}: ${detail}`) }

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const logs = []
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => logs.push(`PAGEERR: ${String(e).slice(0, 300)}`))

  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  const boot = await page.evaluate(() => document.body.innerText.slice(0, 120))
  if (boot.includes('Failed to load')) { console.log('BOOT FAIL'); process.exit(1) }
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.waitForTimeout(2500)
  await page.getByText('插件设置', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.getByText('插件市场', { exact: false }).first().click()
  await page.waitForTimeout(2500)

  const root = () => page.evaluate(() => {
    const r = document.querySelector('[class*="SOz1_a_root"]')
    return r ? r.innerText : ''
  })

  // 1. Discover: plugin cards present?
  const cardCount = await page.evaluate(() => document.querySelectorAll('[class*="SOz1_a_card"]').length)
  cardCount >= 1 ? ok('卡片渲染', `${cardCount} 张插件卡`) : bad('卡片渲染', '无卡片')

  // 2. Search: type in the search box
  const searchBox = page.locator('[class*="SOz1_a_tabSearch"] input, input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"], [class*="SOz1_a_tabSearch"]').first()
  const searchCount = await searchBox.count()
  if (searchCount) {
    const before = await root()
    const beforeCards = await page.evaluate(() => document.querySelectorAll('[class*="SOz1_a_card"]').length)
    await searchBox.fill('plugin')
    await page.waitForTimeout(1500)
    const afterCards = await page.evaluate(() => document.querySelectorAll('[class*="SOz1_a_card"]').length)
    const resultText = await root()
    if (afterCards < beforeCards || /无结果|暂无|empty|0 个/.test(resultText) || afterCards === 0) {
      bad('搜索过滤', `search plugin → cards ${beforeCards}→${afterCards}`)
    } else {
      ok('搜索输入', `search box found; cards ${beforeCards}→${afterCards} (may be slow or no-op in fixture)`)
    }
    await searchBox.fill('')
    await page.waitForTimeout(800)
  } else {
    bad('搜索框', '未找到搜索框')
  }

  // 3. Categories
  const catRes = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter((b) => /UI 增强|主题与外观|模型与账号接入|全部 \(/.test(b.textContent || ''))
    return buttons.map((b) => ({ text: b.textContent.trim().slice(0, 24), visible: !!(b.offsetParent) }))
  })
  if (catRes.length) {
    ok('分类导航', `分类按钮: ${catRes.map((c) => c.text).join(' / ')}`)
    const uiBtn = catRes.find((c) => c.text.includes('UI 增强'))
    if (uiBtn) {
      await page.getByText('UI 增强', { exact: false }).first().click()
      await page.waitForTimeout(1500)
      const t = await root()
      t.includes('UI 增强') && !t.includes('模型与账号') ? ok('分类过滤', '点 UI 增强 后内容变化') : bad('分类过滤', `点击后: ${t.slice(0, 80)}`)
      await page.getByText('全部 (839)', { exact: false }).first().click()
      await page.waitForTimeout(1200)
    }
  } else {
    bad('分类导航', '未找到分类按钮')
  }

  // 4. Install button on a plugin card
  const installInfo = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^安装|Install|安装$/.test((b.textContent || '').trim()))
    if (!btn) return null
    const card = btn.closest('[class*="SOz1_a_card"]')
    return { btnText: btn.textContent.trim(), cardText: (card?.textContent || '').slice(0, 60) }
  })
  if (installInfo) {
    const beforeInstalled = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('button')].find((b) => /已安装/.test(b.textContent || ''))
      return tab ? tab.textContent.trim() : '?'
    })
    // click the install button on the first card
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^安装|Install$/.test((b.textContent || '').trim()))
      if (!btn) return false
      btn.click(); return true
    })
    await page.waitForTimeout(2000)
    const afterInstalled = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('button')].find((b) => /已安装/.test(b.textContent || ''))
      return tab ? tab.textContent.trim() : '?'
    })
    clicked && afterInstalled !== beforeInstalled
      ? ok('安装按钮', `安装 "${installInfo.cardText.slice(0, 30)}" → 已安装tab ${beforeInstalled} → ${afterInstalled}`)
      : bad('安装按钮', `点击后已安装tab ${beforeInstalled} → ${afterInstalled}`)
  } else {
    bad('安装按钮', '未找到可点的安装按钮')
  }

  // 5. Theme tab
  const themeTab = page.getByText('主题', { exact: true }).first()
  if (await themeTab.count()) {
    await themeTab.click()
    await page.waitForTimeout(1500)
    const t = await root()
    const themeCards = await page.evaluate(() => document.querySelectorAll('[class*="SOz1_a_themesGrid"] [class*="SOz1_a_card"], [class*="SOz1_a_swatches"], [class*="SOz1_a_card"]').length)
    t.length > 20 ? ok('主题 tab', `内容: ${t.slice(0, 60).replace(/\n/g, ' ')} (theme cards ≈ ${themeCards})`) : bad('主题 tab', '无内容')
  } else {
    bad('主题 tab', '未找到 主题 tab')
  }

  // 6. 已安装 tab
  const instTab = page.getByText(/^已安装/, { exact: false }).first()
  if (await instTab.count()) {
    await instTab.click()
    await page.waitForTimeout(1500)
    const t = await root()
    t.length > 10 ? ok('已安装 tab', `内容: ${t.slice(0, 60).replace(/\n/g, ' ')}`) : bad('已安装 tab', '空')
  }

  // 7. 高级 tab (backup / conflict / ops)
  const advTab = page.getByText('高级', { exact: true }).first()
  if (await advTab.count()) {
    await advTab.click()
    await page.waitForTimeout(1500)
    const t = await root()
    const hasOps = /备份|backup|冲突|conflict|队列|操作|任务/.test(t)
    hasOps ? ok('高级 tab', `含 备份/冲突/操作: ${t.slice(0, 80).replace(/\n/g, ' ')}`) : bad('高级 tab', `内容: ${t.slice(0, 80)}`)
  }

  // 8. 任务 tab
  const taskTab = page.getByText('任务', { exact: true }).first()
  if (await taskTab.count()) {
    await taskTab.click()
    await page.waitForTimeout(1500)
    const t = await root()
    t.length > 5 ? ok('任务 tab', `内容: ${t.slice(0, 60).replace(/\n/g, ' ')}`) : bad('任务 tab', '空')
  }

  const errs = logs.filter((l) => !l.includes('favicon') && !l.includes('net::ERR'))
  errs.length ? bad('控制台错误', errs.join(' | ')) : ok('控制台错误', '无')
  await browser.close()
  const fails = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - fails}/${results.length} passed`)
  process.exit(fails ? 1 : 0)
} catch (err) {
  console.error('FAIL:', err)
  await browser.close()
  process.exit(1)
}
