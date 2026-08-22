import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable kebab-case skill identifier. */
export type SkillEntryId = Branded<'SkillEntryId'>

/** Origin bucket for a skill contribution; mirrored from the runtime registry. */
export type SkillEntrySource =
  | 'project-dsh'
  | 'project-agents'
  | 'runtime'
  | 'user-dsh'
  | 'user-agents'
  | 'custom'
  | 'bundled'
  | 'unknown'
  | (string & {})

/** Lifecycle state of one skill's winning summary. */
export type SkillEntryPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/**
 * Why the entry currently resolves to `enabled: false`.
 * - `'user'` — the user toggled this entry off through `~/.dsh/settings.yaml`.
 * - `'cordis'` — the runtime registry disabled the entry (provider dropped).
 * - `null` — entry is enabled.
 */
export type SkillDisabledReason = 'user' | 'cordis' | null

/** One skill in the inventory snapshot. */
export interface SkillInventoryEntry {
  readonly entryId: SkillEntryId
  /** Kebab-case skill name. */
  readonly name: string
  /** Short routing description shown in discovery consumers. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Whether model-facing catalogs may include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs may include this skill. */
  readonly userInvocable: boolean
  /** Discovery origin bucket that produced this winning skill. */
  readonly source: SkillEntrySource
  /** Provider label that owns this skill body. */
  readonly provider: string
  /** Effective enabled state after the user overlay is applied. */
  readonly enabled: boolean
  /** Why the entry is disabled, when it is. */
  readonly disabledReason: SkillDisabledReason
  /** Lifecycle phase of the underlying provider catalog observation. */
  readonly phase: SkillEntryPhase
}

/** Point-in-time inventory returned by the skill-inventory Remote. */
export interface SkillInventorySnapshot {
  readonly entries: readonly SkillInventoryEntry[]
}

/** Payload of the `skill-inventory/changed` Cordis event. */
export interface SkillInventoryChangedPayload {
  /** Full snapshot projected at the moment of emission; clients replace, never diff. */
  readonly snapshot: SkillInventorySnapshot
}

/** Declare the one-way Cordis event this gateway emits on every settings commit. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted after every user-overlay commit (UI toggle, settings file reload). */
    'skill-inventory/changed'(payload: SkillInventoryChangedPayload): void
  }
}
