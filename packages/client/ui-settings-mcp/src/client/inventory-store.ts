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

export interface McpInventoryPort {
  list: (signal: AbortSignal) => Promise<McpInventorySnapshot>
}

export interface McpInventoryStore extends HostObservable<McpInventoryPanelSnapshot> {
  refresh(): void
  reset(): void
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

  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    refresh: () => {
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
    },
    reset: () => {
      generation += 1
      if (inFlight !== undefined) inFlight = undefined
      publish({ entries: [], read: false })
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
