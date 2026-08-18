/**
 * Plugin inventory snapshot store.
 *
 * The host owns the authoritative Loader state and emits
 * `plugin-inventory/changed` after every commit. The client mirror stores the
 * last full snapshot and exposes it through a `useSyncExternalStore` surface;
 * the apply closure subscribes to the forwarded event and calls `refresh()`,
 * which re-reads `ctx.remote.pluginInventory.list()` once and is single-flight
 * so a flood of commits collapses to one wire read.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySnapshot, PluginInventoryEntry } from '@deepseek-ai/dsh-host-plugin-inventory/types'

/** Snapshot shape the panel reads; adds a `read` flag and optional error. */
export interface PluginInventoryPanelSnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  /** False until the first read settles; the panel renders a loading line. */
  readonly read: boolean
  /** Last read failure message, kept so the panel can say why the list is empty. */
  readonly error?: string | undefined
}

/** RPC seam the store reads through. */
export interface PluginInventoryPort {
  list: (signal: AbortSignal) => Promise<PluginInventorySnapshot>
}

/** Inventory source: an observable of the snapshot plus the read trigger. */
export interface PluginInventoryStore extends HostObservable<PluginInventoryPanelSnapshot> {
  /** Read the registry unless a read is already in flight. */
  refresh(): void
  /** Drop the snapshot; the next refresh starts from scratch (e.g. on reconnect). */
  reset(): void
}

/**
 * Create the inventory source.
 * @param port - the RPC seam the read goes through.
 * @param onError - reporter for a failed read (console in production, captured in specs).
 * @returns the inventory observable and its read trigger.
 */
export function createPluginInventoryStore(
  port: PluginInventoryPort,
  onError: (error: unknown) => void,
): PluginInventoryStore {
  const listeners = new Set<() => void>()
  let snapshot: PluginInventoryPanelSnapshot = { entries: [], read: false }
  let inFlight: Promise<void> | undefined
  // Bumped by reset; a read whose generation is stale publishes nothing.
  let generation = 0

  const publish = (next: PluginInventoryPanelSnapshot): void => {
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
          publish({ entries: value.entries, read: true })
        },
        (error: unknown) => {
          if (issued !== generation) return
          if (controller.signal.aborted) return
          onError(error)
          // A failed read keeps whatever was shown and says why; dropping the
          // rows would turn a transient wire failure into "nothing is configured".
          publish({
            entries: snapshot.entries,
            read: snapshot.read,
            error: error instanceof Error ? error.message : 'plugin-inventory read failed',
          })
        },
      ).finally(() => {
        if (issued === generation) inFlight = undefined
      })
    },
    reset: () => {
      generation += 1
      if (inFlight !== undefined) {
        // The next then() block checks generation and skips publish; the
        // pending Promise still settles on its own.
        inFlight = undefined
      }
      publish({ entries: [], read: false })
    },
  }
}
