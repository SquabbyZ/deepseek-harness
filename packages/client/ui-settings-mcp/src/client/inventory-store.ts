/** MCP inventory snapshot store. Mirrors the plugin/skill inventory store. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Local stand-ins for the host-side inventory types after
 * `@deepseek-ai/dsh-host-mcp-inventory` was deleted. The client tab remains
 * compile-compatible with the existing `ctx.remote.mcpInventory` Remote API
 * shape, even though `ctx.remote.mcpInventory` resolves to `undefined` at
 * runtime until task 2.5.6 (client-side `inventory/mcp.ts` hook) lands.
 *
 * The brand uses a structural nominal type (`string & { readonly __brand:
 * 'McpEntryId' }`) instead of the original `Branded<'McpEntryId'>` from
 * `@deepseek-ai/dsh-brand`, mirroring the same compromise the plugin/skill
 * stores adopted in tasks 2.5.2 / 2.5.3. Downstream consumers only need a
 * string-bearing opaque id, so this is functionally compatible. If task 2.5.6
 * needs an exact `Branded<'McpEntryId'>`, the schema fragment below will
 * need reconciling.
 */
export type McpEntryId = string & { readonly __brand: 'McpEntryId' }

export interface McpInventoryEntry {
  readonly entryId: McpEntryId
  readonly serverName: string
  readonly transport: string
  readonly target: string
  readonly enabled: boolean
  /** The full persisted spec (the list projection loses args/url detail, so the probe needs this). */
  readonly spec: McpServerSpec
}

export interface McpInventorySnapshot {
  readonly entries: readonly McpInventoryEntry[]
}

export interface McpInventoryPanelSnapshot {
  readonly entries: readonly McpInventoryEntryView[]
  readonly read: boolean
  readonly error?: string | undefined
}

export interface McpInventoryEntryView {
  readonly entryId: McpEntryId
  readonly serverName: string
  readonly transport: string
  readonly target: string
  readonly enabled: boolean
  readonly spec: McpServerSpec
}

/**
 * The persisted spec of one MCP server, stored under the `mcp-inventory`
 * settings namespace (`{ servers: { [id]: McpServerSpec } }`). Kept exact to
 * the plan: stdio carries command/args/env/cwd, streamable-http carries url.
 */
export type McpServerSpec =
  | {
    readonly transport: 'stdio'
    readonly serverName: string
    readonly command: string
    readonly args: string[]
    readonly env: Record<string, string>
    readonly cwd: string
  }
  | {
    readonly transport: 'streamable-http'
    readonly serverName: string
    readonly url: string
    readonly headers: Record<string, string>
  }

export interface McpInventoryPort {
  list: (signal: AbortSignal) => Promise<McpInventorySnapshot>
  /** Create or overwrite one server (the id is derived from serverName); throws on RPC failure. */
  upsertServer: (spec: McpServerSpec) => Promise<void>
  /** Remove one server by its stable id; throws on RPC failure. */
  deleteServer: (entryId: string) => Promise<void>
  /** Search the Smithery registry for installable remote MCP servers. */
  search: (query: string) => Promise<McpRegistrySearchResult>
}

/**
 * True when the runtime webview is Windows. The user typically types `npx`
 * without the `.cmd` suffix; the Rust spawn (`tokio::process::Command::new`)
 * bypasses `cmd.exe` PATHEXT resolution, so callers that hand the command
 * to the spawn gate must rewrite bare names to the platform-correct form
 * first.
 */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  if (typeof uaData?.platform === 'string') return uaData.platform.toLowerCase() === 'windows'
  return /windows/i.test(navigator.userAgent)
}

/**
 * Map well-known cross-platform binaries to the platform-correct spawn name.
 * Inputs like `npx`, `uvx`, `npm` are common in MCP server docs but on
 * Windows they live as `.cmd` shims; Rust's `Command::new` won't append the
 * extension, so callers rewrite bare names before the spawn gate sees them.
 *
 * Inputs that already carry an extension (`.cmd`, `.exe`, `.bat`) or a
 * path separator pass through untouched.
 */
const WINDOWS_SUFFIX: Record<string, string> = {
  npx: 'npx.cmd',
  npm: 'npm.cmd',
  pnpm: 'pnpm.cmd',
  yarn: 'yarn.cmd',
  pnpx: 'pnpx.cmd',
  uv: 'uv.exe',
  uvx: 'uvx.exe',
  pipx: 'pipx.exe',
  bunx: 'bunx.exe',
}

export function resolveSpawnCommand(cmd: string): string {
  const trimmed = cmd.trim()
  if (trimmed.length === 0) return trimmed
  if (
    /\.(cmd|exe|bat|com)$/i.test(trimmed)
    || /[\\/]/.test(trimmed)
  ) {
    return trimmed
  }
  if (isWindowsPlatform()) {
    const mapped = WINDOWS_SUFFIX[trimmed.toLowerCase()]
    if (mapped !== undefined) return mapped
    return `${trimmed}.cmd`
  }
  return trimmed
}

/** One server surfaced by the Smithery registry (`/servers?q=`). */
export interface SmitheryServer {
  /** The install id — also the streamable-http host path segment. */
  readonly qualifiedName: string
  readonly displayName: string
  readonly description: string
  /** true = Smithery-hosted (streamable-http one-click); false = stdio (needs a local command). */
  readonly remote: boolean
  readonly useCount: number
}

/** Search result envelope from the registry RPC. */
export interface McpRegistrySearchResult {
  readonly servers: readonly SmitheryServer[]
}

/**
 * Convert a Smithery registry server into a persisted McpServerSpec. Remote
 * servers map to a streamable-http spec against the Smithery hosted endpoint
 * (`https://server.smithery.ai/{qualifiedName}`). stdio servers carry no
 * command/args on the list endpoint, so they return null — the UI disables
 * their install with a manual-command hint instead of writing a broken spec.
 */
export function smitheryServerToSpec(server: SmitheryServer): McpServerSpec | null {
  if (!server.remote) return null
  return {
    transport: 'streamable-http',
    serverName: server.qualifiedName,
    url: `https://server.smithery.ai/${server.qualifiedName}`,
    headers: {},
  }
}

export interface McpInventoryStore extends HostObservable<McpInventoryPanelSnapshot> {
  refresh(): void
  reset(): void
  /** Create or overwrite one server, then re-read the roster. */
  upsertServer(spec: McpServerSpec): Promise<void>
  /** Remove one server, then re-read the roster. */
  deleteServer(entryId: string): Promise<void>
  /** Search the Smithery registry; does not touch the local snapshot. */
  search(query: string): Promise<McpRegistrySearchResult>
  /** One-click install a Smithery server: convert → upsert → re-read. stdio servers throw (the UI disables them). */
  installSmithery(server: SmitheryServer): Promise<void>
}

export function createMcpInventoryStore(
  port: McpInventoryPort,
  onError: (error: unknown) => void,
): McpInventoryStore {
  const listeners = new Set<() => void>()
  let snapshot: McpInventoryPanelSnapshot = { entries: [], read: false }
  let inFlight: Promise<void> | undefined
  let generation = 0

  const publish = (next: McpInventoryPanelSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  /** Single-flight read of the roster; a no-op while one is already in flight. */
  const read = (): void => {
    if (inFlight !== undefined) return
    const issued = generation
    const controller = new AbortController()
    inFlight = port.list(controller.signal).then(
      (value) => {
        if (issued !== generation) return
        publish({
          entries: value.entries.map(toView),
          read: true,
        })
      },
      (error: unknown) => {
        if (issued !== generation) return
        if (controller.signal.aborted) return
        onError(error)
        publish({
          entries: snapshot.entries,
          read: snapshot.read,
          error: error instanceof Error ? error.message : 'mcp-inventory read failed',
        })
      },
    ).finally(() => {
      if (issued === generation) inFlight = undefined
    })
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    refresh: read,
    reset: () => {
      generation += 1
      if (inFlight !== undefined) inFlight = undefined
      publish({ entries: [], read: false })
    },
    upsertServer: async (spec) => {
      await port.upsertServer(spec)
      read()
    },
    deleteServer: async (entryId) => {
      await port.deleteServer(entryId)
      read()
    },
    search: query => port.search(query),
    installSmithery: async (server) => {
      const spec = smitheryServerToSpec(server)
      if (spec === null) {
        throw new Error(`Smithery server ${JSON.stringify(server.qualifiedName)} is stdio and needs a manual command`)
      }
      await port.upsertServer(spec)
      read()
    },
  }
}

function toView(entry: McpInventoryEntry): McpInventoryEntryView {
  return {
    entryId: entry.entryId,
    serverName: entry.serverName,
    transport: entry.transport,
    target: entry.target,
    enabled: entry.enabled,
    spec: entry.spec,
  }
}
