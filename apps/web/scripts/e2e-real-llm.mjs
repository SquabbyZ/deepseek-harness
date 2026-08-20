/**
 * Standalone end-to-end check for the real-LLM fixture mode (no MCP browser).
 *
 * Seeds a test credential, boots the app with ?fixture&realLlm=1&llmUrl=…,
 * sends a message, and asserts the mock model's streamed reply renders in the
 * official UI. Uses the repo's installed playwright.
 *
 * Run: node apps/web/scripts/e2e-real-llm.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_E2E_URL ?? 'http://localhost:5173'
const MOCK = process.env.DSH_E2E_LLM ?? 'http://127.0.0.1:9876/chat/completions'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  const logs = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`${msg.type()}: ${msg.text().slice(0, 300)}`)
  })
  page.on('pageerror', (err) => logs.push(`pageerror: ${String(err).slice(0, 300)}`))

  // Seed the credential on the origin first.
  await page.goto(`${BASE}/?fixture`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.setItem('dsh:fixture:credentials', JSON.stringify({ DEEPSEEK_API_KEY: 'test-key' }))
  })

  // Boot with real LLM mode.
  await page.goto(`${BASE}/?fixture&realLlm=1&llmUrl=${encodeURIComponent(MOCK)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)

  const title = await page.title()
  const hero = await page.getByText('探索未至之境').count()

  const newBtn = page.getByRole('button', { name: '新建会话' })
  let clickedNew = false
  if (await newBtn.count()) {
    await newBtn.first().click()
    clickedNew = true
  }
  await page.waitForTimeout(1800)

  const box = page.getByRole('textbox', { name: '描述你想要构建的内容' })
  const boxFound = (await box.count()) > 0
  let filled = false
  let sendClicked = false
  if (boxFound) {
    await box.fill('你好，请回复这段端到端测试消息')
    await page.waitForTimeout(400)
    const send = page.getByRole('button', { name: '发送消息' })
    const sendEnabled = await send.isEnabled().catch(() => false)
    if (sendEnabled) {
      await send.click()
      sendClicked = true
    } else {
      logs.push(`send button disabled (enabled=${sendEnabled})`)
    }
    filled = true
  } else {
    logs.push('hero textbox not found')
  }
  // Wait for the mock stream to complete (or the error text to appear).
  await page.waitForTimeout(8000)

  const bodyText = await page.evaluate(() => document.body.innerText || '')
  const hasMockReply = bodyText.includes('[mock deepseek-chat]')
  const hasError = bodyText.includes('模型调用失败')
  const snippet = bodyText.split('\n').filter((l) => l.includes('mock') || l.includes('收到') || l.includes('失败') || l.includes('你好')).slice(0, 8)
  const finalUrl = page.url()
  const chatArea = await page.evaluate(() => {
    // Grab the visible message list text if the conversation view opened
    const view = document.querySelector('.chat-view-scroll, [class*="chat-view"]')
    return view ? view.innerText.slice(0, 400) : null
  })

  console.log(JSON.stringify({ title, hero, clickedNew, boxFound, filled, sendClicked, hasMockReply, hasError, snippet, chatArea, finalUrl, consoleErrors: logs }, null, 2))
  await browser.close()
  process.exit(hasMockReply ? 0 : 1)
} catch (err) {
  console.error('E2E failed:', err)
  await browser.close()
  process.exit(1)
}
