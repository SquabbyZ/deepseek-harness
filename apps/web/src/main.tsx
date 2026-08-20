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
  colno?: number
  source?: 'sync' | 'promise' | 'async'
  cause?: unknown
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Walk a possibly-nested cause chain. Errors thrown inside the node-shim
// proxy bubble up as `new Error(msg, { cause: original })` from any
// plugin that wrapped the call; we surface each link so the user can see
// both the shim's throw site and the originating plugin call site.
function collectCauseChain(cause: unknown, depth = 0): Array<{ message: string; stack?: string; depth: number }> {
  if (cause == null || depth > 5) return []
  if (cause instanceof Error) {
    return [
      { message: cause.message, stack: cause.stack, depth },
      ...collectCauseChain((cause as Error & { cause?: unknown }).cause, depth + 1),
    ]
  }
  return [{ message: String(cause), depth }]
}

// Render the stack as a styled <pre> block. Each `at ...` frame becomes its
// own <span>; frames NOT pointing into node-shims are tagged as plugin
// frames so the user can spot the originating call site at a glance.
function renderStack(stack: string): string {
  const rawLines = stack.split('\n')
  const rendered = rawLines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    const isFrame = /^at\s/.test(trimmed)
    if (!isFrame) {
      // non-frame line (e.g. the leading "Error: ..." repeated in some
      // engines) — escape and wrap in a neutral span
      return `<span class="dsh-stack-line">${escapeHtml(trimmed)}</span>`
    }
    const isShimFrame = trimmed.includes('node-shims')
    const cls = isShimFrame ? 'dsh-frame dsh-frame-shim' : 'dsh-frame dsh-frame-plugin'
    return `<span class="${cls}">${escapeHtml(trimmed)}</span>`
  })
  return `<pre class="dsh-stack">${rendered.join('\n')}</pre>`
}

function renderCause(cause: unknown): string {
  if (cause == null) return ''
  const chain = collectCauseChain(cause)
  if (chain.length === 0) return ''
  const blocks = chain
    .map((link) => {
      const label = link.depth === 0 ? 'Caused by' : `Caused by (level ${link.depth + 1})`
      const stackHtml = link.stack ? renderStack(link.stack) : ''
      return `
        <div class="dsh-cause-label">${escapeHtml(label)}: <span class="dsh-cause-msg">${escapeHtml(link.message)}</span></div>
        ${stackHtml}
      `
    })
    .join('')
  return `<div class="dsh-cause">${blocks}</div>`
}

function renderError(err: ErrorInfo) {
  const root = document.getElementById('root')
  if (!root) return
  const sourceTag = err.source ?? 'sync'
  const locationHtml = err.filename
    ? `<div class="dsh-location">at <span class="dsh-file">${escapeHtml(err.filename)}</span>:<span class="dsh-line">${err.lineno ?? '?'}</span>${err.colno != null ? `:<span class="dsh-col">${err.colno}</span>` : ''}</div>`
    : ''
  const stackHtml = err.stack ? renderStack(err.stack) : ''
  const causeHtml = renderCause(err.cause)

  root.innerHTML = `
    <div class="dsh-error-overlay">
      <style>
        .dsh-error-overlay {
          position: fixed;
          inset: 0;
          background: #1a0000;
          color: #ff6b6b;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          padding: 24px;
          overflow: auto;
          font-size: 13px;
          line-height: 1.5;
          z-index: 2147483647;
        }
        .dsh-error-overlay .dsh-title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 16px;
          color: #ff4444;
        }
        .dsh-error-overlay .dsh-source {
          color: #888;
        }
        .dsh-error-overlay .dsh-message {
          color: #ff6b6b;
          margin-left: 4px;
        }
        .dsh-error-overlay .dsh-location {
          margin: 8px 0 12px 24px;
          color: #aaa;
        }
        .dsh-error-overlay .dsh-file { color: #ffd28b; }
        .dsh-error-overlay .dsh-line { color: #ffd28b; }
        .dsh-error-overlay .dsh-col  { color: #ffd28b; }
        .dsh-error-overlay .dsh-stack {
          background: #0d0000;
          border: 1px solid #4a1010;
          border-radius: 4px;
          padding: 12px 14px;
          margin: 8px 0 0 24px;
          font-size: 11.5px;
          line-height: 1.55;
          white-space: pre;
          overflow-x: auto;
          color: #d0d0d0;
        }
        .dsh-error-overlay .dsh-stack-line {
          display: block;
          color: #888;
        }
        .dsh-error-overlay .dsh-frame {
          display: block;
          padding-left: 12px;
          border-left: 3px solid transparent;
        }
        .dsh-error-overlay .dsh-frame-shim {
          color: #8a8a8a;
          border-left-color: #4a1010;
        }
        .dsh-error-overlay .dsh-frame-plugin {
          color: #ffe066;
          background: rgba(255, 224, 102, 0.07);
          border-left-color: #ffe066;
          font-weight: 600;
        }
        .dsh-error-overlay .dsh-cause {
          margin-top: 16px;
          padding-left: 12px;
          border-left: 2px dashed #6a2a2a;
        }
        .dsh-error-overlay .dsh-cause-label {
          margin: 8px 0 4px 12px;
          color: #ff9b9b;
          font-style: italic;
        }
        .dsh-error-overlay .dsh-cause-msg {
          color: #ffb3b3;
          font-style: normal;
        }
        .dsh-error-overlay .dsh-cause .dsh-stack {
          margin-left: 12px;
        }
        .dsh-error-overlay .dsh-footer {
          margin-top: 24px;
          color: #888;
        }
      </style>
      <div class="dsh-title">⚠ DSH Desktop boot failed</div>
      <div><span class="dsh-source">[${escapeHtml(sourceTag)}]</span><span class="dsh-message">${escapeHtml(err.message)}</span></div>
      ${locationHtml}
      ${causeHtml}
      ${stackHtml}
      <div class="dsh-footer">This is a debug overlay — check the boot sequence above.</div>
    </div>
  `
}

window.addEventListener('error', (e) => {
  const errObj = e.error as (Error & { cause?: unknown }) | undefined
  renderError({
    message: e.message,
    stack: errObj?.stack,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    source: 'sync',
    cause: errObj?.cause,
  })
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as (Error & { cause?: unknown }) | unknown
  if (reason instanceof Error) {
    renderError({
      message: reason.message,
      stack: reason.stack,
      source: 'promise',
      cause: reason.cause,
    })
  } else {
    renderError({
      message: String(reason),
      source: 'promise',
    })
  }
})

async function main(): Promise<void> {
  // vite dev runs without a Tauri runtime; install a per-command bridge
  // override so `pnpm dev` keeps a usable boot loop while `pnpm tauri dev`
  // (and the production MSI) get the real Rust-side `invoke` for free.
  if (!('__TAURI_INTERNALS__' in window)) {
    const { setDevInvokeOverride } = await import('./dsh/bridge/env.ts')
    setDevInvokeOverride((cmd, args) => {
      switch (cmd) {
        case 'app_config_dir': return Promise.resolve('/tmp/.dsh-dev')
        case 'app_version': return Promise.resolve('0.0.0-dev')
        case 'crash_log_path': return Promise.resolve('/tmp/.dsh-dev/crash.log')
        default:
          if (process.env.NODE_ENV !== 'production') {
            return Promise.reject(new Error(
              `bridge: dev invoke of "${cmd}" has no stub — ` +
              'add one to setDevInvokeOverride() in main.tsx. ' +
              `(args=${JSON.stringify(args ?? {})})`,
            ))
          }
          return Promise.reject(new Error(`bridge: dev invoke of "${cmd}" without Tauri runtime`))
      }
    })
  }

  try {
    const host = await startHost()
    const element = document.getElementById('root')
    if (!element) throw new Error('#root not found in index.html')

    const { HostProvider } = await import('./dsh/host-context.tsx')

    ReactDOM.createRoot(element).render(
      <HostProvider value={host}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </HostProvider>,
    )
  } catch (err) {
    const e = err as Error & { cause?: unknown }
    renderError({
      message: e instanceof Error ? e.message : String(err),
      stack: e instanceof Error ? e.stack : undefined,
      source: 'async',
      cause: e instanceof Error ? e.cause : undefined,
    })
    throw err
  }
}

main().catch((err) => {
  // already rendered by the try/catch above; re-throw for devtools
  console.error('main() failed:', err)
})
