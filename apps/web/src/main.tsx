/**
 * apps/web — the official DSH client shell for the Tauri WebView2.
 *
 * This entry IS the official SaaS UI: it boots the whole client plugin graph
 * (packages/client/*) through `@deepseek-ai/dsh-client-web`'s AppWebEntry —
 * the same boot kernel `dsh web` serves. The Phase-2 client-first desktop
 * shell has no host process composing `__DSH_BOOT__`, so the manifest is
 * generated statically (scripts/generate-official-roster.mjs) and the client
 * plugin bundles are served by a vite dev middleware (vite.config.ts
 * `officialBundleServer`).
 *
 * Transport: `dsh-client-connection` selects the in-memory FixtureApiClient
 * when the page URL carries `?fixture` — the standalone/dev/desktop boot
 * (no host API yet) defaults to it so the official UI renders with fixture
 * session/workspace data, exactly like the repo's own keyless web snapshot
 * lane. A real host connection replaces it later; until then `?fixture` is
 * always on for this entry.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { officialGraph } from './dsh/official-graph.ts'

interface DshBootWindow extends Window {
  __DSH_BOOT__?: unknown
}

/**
 * Append market-installed plugins to the boot graph. The market middleware
 * publishes each installed plugin's served bundle URL under
 * `/dsh-market/installed` (keyed by plugin id); this turns those into graph
 * rows the AppWebEntry loader fetches and boots — the "install → restart →
 * actually usable" pipeline for the client-first shell.
 */
async function mergeInstalledPlugins(base: WebBootGraph): Promise<WebBootGraph> {
  try {
    const response = await fetch('/dsh-market/installed', { cache: 'no-store' })
    if (!response.ok) return base
    const body = (await response.json()) as { bundles?: Record<string, string> }
    const bundles = body.bundles ?? {}
    const extra = Object.entries(bundles).map(([id, url]) => ({
      id,
      url,
      rev: url.split('rev=')[1] ?? '',
    }))
    if (extra.length === 0) return base
    const seen = new Set(base.entries.map(entry => entry.id))
    return { ...base, entries: [...base.entries, ...extra.filter(entry => !seen.has(entry.id))] }
  } catch {
    return base
  }
}

async function main(): Promise<void> {
  // Fixture transport default: standalone web/dev/desktop boot has no host
  // API yet, and the connection plugin keys its transport off the page URL.
  // The desktop shell additionally defaults to real model calls (realLlm):
  // the fixture's prompt reaches the real DeepSeek endpoint through the Rust
  // http_request invoke (no CORS). A dev/test URL that already pins these
  // (e.g. ?fixture&llmUrl=http://…&realLlm=1) is left untouched.
  if (typeof location !== 'undefined' && !new URLSearchParams(location.search).has('fixture')) {
    const params = new URLSearchParams()
    params.set('fixture', '')
    if ('__TAURI_INTERNALS__' in globalThis) params.set('realLlm', '1')
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`)
  }

  // Merge market-installed plugins into the boot graph: the market's install →
  // restart flow publishes served bundle URLs under `/dsh-market/installed`,
  // so after a reload the module loader can fetch and boot them like the
  // roster plugins. Failures (no host, offline) keep the base graph.
  const bootGraph = await mergeInstalledPlugins(officialGraph)
  ;(globalThis as DshBootWindow).__DSH_BOOT__ = bootGraph

  const root = document.getElementById('root')
  if (root === null) throw new Error('web app: missing #root')

  const entry = new AppWebEntry(root)
  await entry.run()
}

void main().catch((error) => {
  console.error('official shell boot failed:', error)
  const root = document.getElementById('root')
  if (root !== null) {
    root.innerHTML = `<pre style="color:#ff6b6b;padding:24px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap">DSH shell boot failed:\n${String(error instanceof Error ? error.stack ?? error.message : error)}</pre>`
  }
})
