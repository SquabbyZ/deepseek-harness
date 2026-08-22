/**
 * Skill inventory snapshot store.
 *
 * The host owns the authoritative `ctx.skills` registry and emits
 * `skill-inventory/changed` after every commit. The client mirror stores
 * the last full snapshot and exposes it through a `useSyncExternalStore`
 * surface; the apply closure subscribes to the forwarded event and calls
 * `refresh()`, which re-reads the inventory list and is single-flight so
 * a flood of commits collapses to one wire read.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Stable kebab-case skill identifier. Locally branded string. */
export type SkillEntryId = string & { readonly __brand: 'SkillEntryId' }

/** Local mirror of the host's skill-inventory snapshot shape. */
export interface SkillInventorySnapshot {
  readonly entries: readonly SkillInventoryEntry[]
}

/** Local mirror of one inventory entry. */
export interface SkillInventoryEntry {
  readonly entryId: SkillEntryId
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: string
  readonly provider: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly enabled: boolean
}

/** Snapshot shape the tab reads; adds a `read` flag and optional error. */
export interface SkillInventoryPanelSnapshot {
  readonly entries: readonly SkillInventoryEntryView[]
  /** False until the first read settles; the tab renders a loading line. */
  readonly read: boolean
  /** Last read failure message, kept so the tab can say why the list is empty. */
  readonly error?: string | undefined
}

/** Local view of one entry, narrowed to the fields the tab displays. */
export interface SkillInventoryEntryView {
  readonly entryId: SkillEntryId
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: string
  readonly provider: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly enabled: boolean
}

/** RPC seam the store reads through. */
export interface SkillInventoryPort {
  list: (signal: AbortSignal) => Promise<SkillInventorySnapshot>
  /** Search skills.sh for installable remote skills. */
  search: (query: string) => Promise<SkillRegistrySearchResult>
  /** Install a remote skill into `~/.dsh/skills/{name}`; throws on RPC failure. */
  install: (target: SkillRegistryInstallTarget) => Promise<void>
}

/** One installable skill surfaced by the skills.sh registry. */
export interface SkillRegistrySkill {
  readonly name: string
  readonly description: string
  readonly installs: number
  /** `owner/repo` — the GitHub source the install downloads from. */
  readonly source: string
}

/** Search result envelope from the registry RPC. */
export interface SkillRegistrySearchResult {
  readonly skills: readonly SkillRegistrySkill[]
}

/** What `install` needs: the display name and the `owner/repo` source. */
export interface SkillRegistryInstallTarget {
  readonly name: string
  readonly source: string
}

/** Inventory source: an observable of the snapshot plus the read trigger. */
export interface SkillInventoryStore extends HostObservable<SkillInventoryPanelSnapshot> {
  /** Read the registry unless a read is already in flight. */
  refresh(): void
  /** Drop the snapshot; the next refresh starts from scratch (e.g. on reconnect). */
  reset(): void
  /** Search skills.sh; does not touch the local snapshot. */
  search(query: string): Promise<SkillRegistrySearchResult>
  /** Install a remote skill, then re-read the local inventory so it appears. */
  install(target: SkillRegistryInstallTarget): Promise<void>
}

/**
 * Create the inventory source.
 * @param port - the RPC seam the read goes through.
 * @param onError - reporter for a failed read (console in production, captured in specs).
 * @returns the inventory observable and its read trigger.
 */
export function createSkillInventoryStore(
  port: SkillInventoryPort,
  onError: (error: unknown) => void,
): SkillInventoryStore {
  const listeners = new Set<() => void>()
  let snapshot: SkillInventoryPanelSnapshot = { entries: [], read: false }
  let inFlight: Promise<void> | undefined
  // Bumped by reset; a read whose generation is stale publishes nothing.
  let generation = 0

  const publish = (next: SkillInventoryPanelSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  /**
   * Single-flight read of the registry; a no-op while one is already in flight.
   * Returns the settled promise so callers (e.g. `install`) can await the
   * refreshed snapshot.
   */
  const read = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight
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
          error: error instanceof Error ? error.message : 'skill-inventory read failed',
        })
      },
    ).finally(() => {
      if (issued === generation) inFlight = undefined
    })
    return inFlight
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
    search: query => port.search(query),
    install: async (target) => {
      await port.install(target)
      // Await the re-read so the freshly installed entry is visible in the
      // snapshot by the time the install promise settles.
      await read()
    },
  }
}

function toView(entry: SkillInventorySnapshot['entries'][number]): SkillInventoryEntryView {
  return {
    entryId: entry.entryId,
    name: entry.name,
    description: entry.description,
    ...entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {},
    source: entry.source,
    provider: entry.provider,
    modelInvocable: entry.modelInvocable,
    userInvocable: entry.userInvocable,
    enabled: entry.enabled,
  }
}
