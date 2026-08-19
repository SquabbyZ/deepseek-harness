// Smoke fixture for Playwright (task 2.6.6).
//
// Boots Cordis through `startHost()` in the real browser, exposing the
// outcome on `window.__inboxLoad` so the Playwright spec can assert
// without touching the runtime data structures directly.
import { startHost } from '../../src/dsh/host.ts'

interface InboxLoadResult {
  ok: boolean
  error?: string
  registrySize: number
  loaderEntryCount: number
  entryIds: string[]
  hasKnownPlugin: boolean
  knownPluginFragment: string
}

declare global {
  interface Window {
    __inboxLoad?: InboxLoadResult
    __inboxLoadError?: unknown
  }
}

function readLoadError(): string | undefined {
  const err = window.__inboxLoadError as undefined | {
    kind: string
    message?: string
    filename?: string
    lineno?: number
    colno?: number
    stack?: string | null
    source?: string | null
  }
  if (!err) return undefined
  const filename = err.filename ?? err.source ?? 'unknown'
  const lineCol = err.lineno !== undefined ? `:${err.lineno}:${err.colno ?? '?'}` : ''
  return `${err.kind}: ${err.message}\n  at ${filename}${lineCol}\n${err.stack ?? ''}`
}

/**
 * Collect the human-readable identifiers of every registered Cordis
 * runtime. The runtime's `name` field comes from the plugin's `name`
 * export (task 2.6.1 audit labels); falling back to `String(callback)`
 * keeps the assertion useful even if the plugin forgot to label itself.
 */
function collectRegistryNames(ctx: { registry: { values: () => Iterable<unknown> } }): string[] {
  const names: string[] = []
  for (const runtime of ctx.registry.values()) {
    const named = runtime as { name?: string; callback?: { name?: string } }
    names.push(named.name ?? named.callback?.name ?? '<unknown>')
  }
  return names
}

async function run(): Promise<void> {
  try {
    const { ctx, loader } = await startHost()
    // Cordis registry: every `ctx.plugin()` call adds an entry here, so
    // `registrySize` is the count of in-box plugins Cordis knows about.
    const registrySize = ctx.registry.size
    // Loader entry tree: explicit `ctx.loader.entry(...)` rows. Phase 2
    // task 2.6.2 wires in-box plugins via `ctx.plugin()` directly, so this
    // is expected to stay at zero — kept in the result for completeness so
    // future loader-managed plugins are visible.
    const entryIds = [...loader.entries()].map(e => e.options.id ?? '')
    const registryNames = collectRegistryNames(ctx)
    const knownPluginFragment = 'tool-web'
    const hasKnownPlugin = registryNames.some(name => name.includes(knownPluginFragment))
    const status = document.getElementById('status')
    if (status) status.textContent = `ready registry=${registrySize}`
    window.__inboxLoad = {
      ok: true,
      registrySize,
      loaderEntryCount: entryIds.length,
      entryIds: registryNames,
      hasKnownPlugin,
      knownPluginFragment,
    }
  } catch (err) {
    const error = readLoadError()
      ?? (err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))
    const status = document.getElementById('status')
    if (status) status.textContent = `error: ${err instanceof Error ? err.message : String(err)}`
    window.__inboxLoad = {
      ok: false,
      error,
      registrySize: 0,
      loaderEntryCount: 0,
      entryIds: [],
      hasKnownPlugin: false,
      knownPluginFragment: 'tool-web',
    }
  }
}

void run()
