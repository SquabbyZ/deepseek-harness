/**
 * Mock DeepSeek chat-completions SSE server for end-to-end testing without a
 * real API key. Speaks the OpenAI-style streaming protocol the fixture's
 * real-llm transport consumes:
 *
 *     POST /chat/completions  →  `data: {choices:[{delta:{content}}]}` … `[DONE]`
 *
 * Run:  node apps/web/scripts/mock-llm-server.mjs [port]
 * Then boot the app with  ?fixture&realLlm=1&llmUrl=http://127.0.0.1:9876/chat/completions
 */
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] ?? 9876)

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  // CORS preflight (the browser fetch transport sends one for the JSON POST).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  if (req.method !== 'POST' || url.pathname !== '/chat/completions') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      res.statusCode = 400
      res.end('bad json')
      return
    }
    console.error(`[mock] POST /chat/completions model=${body.model ?? '?'} user=${(body.messages ?? []).filter((m) => m.role === 'user').at(-1)?.content?.slice(0, 40) ?? ''}`)
    const model = body.model ?? 'deepseek-chat'
    const userText = body.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? ''
    const reply = `[mock ${model}] 收到：${String(userText).slice(0, 80)}`
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream')
    res.setHeader('cache-control', 'no-cache')
    // Browser dev-testing path: the fixture's fetch transport is same-origin
    // free, so the mock must answer cross-origin (the Tauri path uses Rust
    // reqwest and never needs this).
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type, authorization')
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] }) + '\n\n')
    // Emit the reply in small chunks with tiny delays, mimicking a real stream.
    const chars = Array.from(reply)
    let i = 0
    const timer = setInterval(() => {
      const piece = chars.slice(i, i + 3).join('')
      i += 3
      if (piece !== '') {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')
      }
      if (i >= chars.length) {
        clearInterval(timer)
        res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: chars.length } }) + '\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }, 20)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock llm listening on http://127.0.0.1:${PORT}/chat/completions`)
})
