import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/**
 * Reason an entry currently resolves to `enabled: false`. Orthogonal to
 * {@link PluginInventoryEntry.enabled}: `enabled` is the effective boolean;
 * `disabledReason` is the metadata explaining it.
 *
 * - `'user'` — the user toggled this entry off through `settings.pluginInventory.enabled`.
 * - `'cordis'` — `cordis.yml` (or an ancestor group) carries `disabled: true`.
 * - `null` — either enabled, or `user` and `cordis` both apply (effective false
 *   but the user toggle is the recorded reason).
 */
export type PluginDisabledReason = 'user' | 'cordis' | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups and user overrides. */
  readonly enabled: boolean
  /**
   * Why `enabled` resolved to its current value. `null` when the entry is
   * enabled, or when both user and cordis disable the entry (the user's
   * toggle wins the precedence and the cordis flag is informational).
   */
  readonly disabledReason: PluginDisabledReason
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}

/** Payload of the `plugin-inventory/changed` Cordis event. */
export interface PluginInventoryChangedPayload {
  /** Full snapshot projected at the moment of emission; clients replace, never diff. */
  readonly snapshot: PluginInventorySnapshot
}

/**
 * Declare the one-way Cordis event this gateway emits on every settings commit.
 *
 * Lives in the client-safe `./types` subpath so `api/remotes` (which derives the
 * `TypertRemoteEventSelection` type) and `host/apiproxy` (which iterates the
 * forwarded-events allowlist at runtime) both see this signature without
 * depending on the host-only Gateway implementation.
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted after every user-overlay commit (UI toggle, settings file reload). */
    'plugin-inventory/changed'(payload: PluginInventoryChangedPayload): void
  }
}
