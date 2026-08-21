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
}

export interface McpInventoryStore extends HostObservable<McpInventoryPanelSnapshot> {
  refresh(): void
  reset(): void
  /** Create or overwrite one server, then re-read the roster. */
  upsertServer(spec: McpServerSpec): Promise<void>
  /** Remove one server, then re-read the roster. */
  deleteServer(entryId: string): Promise<void>
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
  }
}

function toView(entry: McpInventoryEntry): McpInventoryEntryView {
  return {
    entryId: entry.entryId,
    serverName: entry.serverName,
    transport: entry.transport,
    target: entry.target,
    enabled: entry.enabled,
  }
}
