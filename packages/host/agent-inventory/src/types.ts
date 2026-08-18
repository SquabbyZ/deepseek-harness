import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable agent-preset identifier (kebab-case directory name). */
export type AgentEntryId = Branded<'AgentEntryId'>

/** Origin bucket for an agent-preset contribution. */
export type AgentEntrySource = 'bundled' | 'user' | 'project' | 'unknown' | (string & {})

/** Why the entry currently resolves to `enabled: false`. */
export type AgentDisabledReason = 'user' | 'cordis' | null

/** One agent preset in the inventory snapshot. */
export interface AgentInventoryEntry {
  readonly entryId: AgentEntryId
  /** Kebab-case preset id (also its directory name). */
  readonly presetId: string
  /** Display name carried by the preset metadata. */
  readonly name: string
  /** Optional short description from the preset metadata. */
  readonly description: string
  /** Default model route the preset selects (e.g. provider/model). */
  readonly defaultModel: string
  /** Where this preset was discovered. */
  readonly source: AgentEntrySource
  /** True when this preset is the user's chosen default. */
  readonly isDefault: boolean
  /** Effective enabled state after the user overlay is applied. */
  readonly enabled: boolean
  /** Why the entry is disabled, when it is. */
  readonly disabledReason: AgentDisabledReason
}

/** Point-in-time inventory returned by the agent-inventory Remote. */
export interface AgentInventorySnapshot {
  readonly entries: readonly AgentInventoryEntry[]
}

/** Payload of the `agent-inventory/changed` Cordis event. */
export interface AgentInventoryChangedPayload {
  /** Full snapshot projected at the moment of emission; clients replace, never diff. */
  readonly snapshot: AgentInventorySnapshot
}

/** Declare the one-way Cordis event this gateway emits on every settings commit. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Emitted after every user-overlay commit (UI toggle, settings file reload).
     * @param payload - full snapshot projected at the moment of emission; clients replace, never diff.
     * @mode emit
     */
    'agent-inventory/changed'(payload: AgentInventoryChangedPayload): void
  }
}
