/** Agent-preset inventory snapshot store. Mirrors the plugin/skill/mcp stores. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentEntryId, AgentInventorySnapshot } from '@deepseek-ai/dsh-host-agent-inventory/types'

export interface AgentInventoryPanelSnapshot {
  readonly entries: readonly AgentInventoryEntryView[]
  readonly read: boolean
  readonly error?: string | undefined
}

export interface AgentInventoryEntryView {
  readonly entryId: AgentEntryId
  readonly presetId: string
  readonly name: string
  readonly description: string
  readonly source: string
  readonly isDefault: boolean
  readonly enabled: boolean
}

export interface AgentInventoryPort {
  list: (signal: AbortSignal) => Promise<AgentInventorySnapshot>
}

export interface AgentInventoryStore extends HostObservable<AgentInventoryPanelSnapshot> {
  refresh(): void
  reset(): void
}

export function createAgentInventoryStore(
  port: AgentInventoryPort,
  onError: (error: unknown) => void,
): AgentInventoryStore {
  const listeners = new Set<() => void>()
  let snapshot: AgentInventoryPanelSnapshot = { entries: [], read: false }
  let inFlight: Promise<void> | undefined
  let generation = 0

  const publish = (next: AgentInventoryPanelSnapshot): void => {
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
          publish({ entries: value.entries.map(toView), read: true })
        },
        (error: unknown) => {
          if (issued !== generation) return
          if (controller.signal.aborted) return
          onError(error)
          publish({
            entries: snapshot.entries,
            read: snapshot.read,
            error: error instanceof Error ? error.message : 'agent-inventory read failed',
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

function toView(entry: AgentInventorySnapshot['entries'][number]): AgentInventoryEntryView {
  return {
    entryId: entry.entryId,
    presetId: entry.presetId,
    name: entry.name,
    description: entry.description,
    source: entry.source,
    isDefault: entry.isDefault,
    enabled: entry.enabled,
  }
}
