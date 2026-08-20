import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { startHost } from './dsh/host.ts'
import { queryClient } from './dsh/query/client.ts'
import { App } from './App.tsx'

interface ErrorInfo {
  message: string
  stack?: string
  filename?: string
  lineno?: number
  source?: 'sync' | 'promise' | 'async'
}

function renderError(err: ErrorInfo) {
  const root = document.getElementById('root')
  if (!root) return
  const formatted = [
    `[${err.source ?? 'sync'}] ${err.message}`,
    err.filename ? `at ${err.filename}:${err.lineno}` : '',
    err.stack ?? '',
  ].filter(Boolean).join('\n\n')
  root.innerHTML = `
    <div style="position:fixed;inset:0;background:#1a0000;color:#ff6b6b;font-family:monospace;padding:24px;overflow:auto;white-space:pre-wrap;font-size:13px;line-height:1.5">
      <div style="font-size:18px;font-weight:bold;margin-bottom:16px;color:#ff4444">⚠ DSH Desktop boot failed</div>
      ${formatted.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      <div style="margin-top:24px;color:#888">This is a debug overlay — check the boot sequence above.</div>
    </div>
  `
}

window.addEventListener('error', (e) => {
  renderError({
    message: e.message,
    stack: e.error?.stack,
    filename: e.filename,
    lineno: e.lineno,
    source: 'sync',
  })
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as Error | unknown
  renderError({
    message: String(reason instanceof Error ? reason.message : reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    source: 'promise',
  })
})

async function main(): Promise<void> {
  try {
    await startHost()
    const element = document.getElementById('root')
    if (!element) throw new Error('#root not found in index.html')

    ReactDOM.createRoot(element).render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )
  } catch (err) {
    renderError({
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      source: 'async',
    })
    throw err
  }
}

main().catch((err) => {
  // already rendered by the try/catch above; re-throw for devtools
  // eslint-disable-next-line no-console
  console.error('main() failed:', err)
})