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
import { officialGraph } from './dsh/official-graph.ts'

interface DshBootWindow extends Window {
  __DSH_BOOT__?: unknown
}

async function main(): Promise<void> {
  // Fixture transport default: standalone web/dev/desktop boot has no host
  // API yet, and the connection plugin keys its transport off the page URL.
  if (typeof location !== 'undefined' && !new URLSearchParams(location.search).has('fixture')) {
    history.replaceState(null, '', `${location.pathname}?fixture`)
  }

  ;(globalThis as DshBootWindow).__DSH_BOOT__ = officialGraph

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
