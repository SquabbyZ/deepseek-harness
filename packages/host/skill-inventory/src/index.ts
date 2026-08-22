/**
 * Cordis skill inventory: user-toggleable Remote projection of effective
 * skill registry state. The host owns the runtime `ctx.skills` registry and
 * emits `skill-inventory/changed` after every user-overlay commit; the
 * consumer mirror subscribes through the existing `host/remote-event`
 * forwarding path.
 *
 * The gateway wraps `ctx.skills.snapshot/list/get` so the user overlay is
 * visible to every Cordis-side consumer — the model-facing catalog built by
 * `dsh-tool-skill` filters `isModelInvocable(skill)` against the wrapped
 * snapshot, and the user-facing `/` palette filters `isUserInvocable(skill)`
 * against the wrapped list. Without the wrap, a toggled-off skill keeps
 * appearing in both prompts until the user restarts the host.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {
  SkillCatalogSnapshot,
  SkillDefinition,
  SkillRegistry,
  SkillSummary,
  SkillViewOptions,
} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { SKILL_INVENTORY_SETTINGS_NAMESPACE, skillInventorySettingsSchema } from './settings.ts'
import type {
  SkillDisabledReason,
  SkillEntryId,
  SkillEntrySource,
  SkillInventoryEntry,
  SkillInventorySnapshot,
} from './types.ts'

export type * from './types.ts'
export { SKILL_INVENTORY_SETTINGS_NAMESPACE, skillInventorySettingsSchema } from './settings.ts'

/** Stable error tag for unknown skill names. */
export const SKILL_INVENTORY_ERROR_ENTRY_NOT_FOUND = 'skill-inventory/entry-not-found'
/** Stable error tag for failed settings writes before any commit. */
export const SKILL_INVENTORY_ERROR_SETTINGS_UPDATE = 'skill-inventory/settings-update-failed'

/** Brand a runtime skill name at the owning boundary. */
function skillEntryId(value: string): SkillEntryId {
  return value as SkillEntryId
}

/** Resolved user-overlay override for one skill; `undefined` means "use cordis baseline". */
type OverrideMap = Record<string, boolean>

/**
 * Project the runtime {@link SkillSummary} onto the snapshot shape, applying
 * the user override. The runtime registry's `invocation` policy is the
 * baseline when no override exists; the user overlay wins outright when set.
 */
function project(
  skill: SkillSummary,
  userOverride: boolean | undefined,
): SkillInventoryEntry {
  const cordisEnabled = skill.invocation.modelInvocable || skill.invocation.userInvocable
  const enabled = userOverride !== undefined ? userOverride : cordisEnabled
  const disabledReason: SkillDisabledReason =
    enabled
      ? null
      : userOverride === false ? 'user' : 'cordis'
  return {
    entryId: skillEntryId(skill.name),
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
    modelInvocable: skill.invocation.modelInvocable,
    userInvocable: skill.invocation.userInvocable,
    source: skill.source as SkillEntrySource,
    provider: skill.provider,
    enabled,
    disabledReason,
    phase: 'active',
  }
}

/** Map an override to the concrete model/user invocation pair it pins. */
function projectInvocation(override: boolean | undefined): { modelInvocable: boolean; userInvocable: boolean } {
  if (override === false) return { modelInvocable: false, userInvocable: false }
  if (override === true) return { modelInvocable: true, userInvocable: true }
  // The callers guard on `=== undefined` before invoking this helper, so
  // this branch is unreachable at runtime; the throw is a defense in depth.
  throw new Error('projectInvocation: undefined override')
}

/**
 * Project a runtime summary through the user overlay. `false` forces both
 * invocable flags off (the prompt catalog and `/` palette both filter these
 * out), `true` forces both on (so a cordis-disabled skill can be re-enabled),
 * an absent key leaves the summary unchanged. A new object is returned on
 * override; the input identity is preserved otherwise.
 */
function applySummaryOverride(skill: SkillSummary, overrides: OverrideMap): SkillSummary {
  const override = overrides[skill.name]
  if (override === undefined) return skill
  return { ...skill, invocation: projectInvocation(override) }
}

/** Same projection for a {@link SkillDefinition} (the `get()` return shape). */
function applyDefinitionOverride(skill: SkillDefinition, overrides: OverrideMap): SkillDefinition {
  const override = overrides[skill.name]
  if (override === undefined) return skill
  return { ...skill, invocation: projectInvocation(override) }
}

/** Public Remote service exposing the runtime skill registry with a user overlay. */
export class SkillInventoryGateway extends TypertRemoteService {
  static inject = ['skills', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'skillInventory')
    this.ctx.settings.register(
      SKILL_INVENTORY_SETTINGS_NAMESPACE,
      skillInventorySettingsSchema,
    )
    this.installSkillRegistryOverride()
    this.ctx.on('settings/updated', (ns) => {
      if (ns !== SKILL_INVENTORY_SETTINGS_NAMESPACE) return
      void this.refreshInventoryAndNotify()
    })
  }

  /**
   * Project the runtime skill catalog with the user overlay applied.
   * Reads via `ctx.skills.snapshot()` so providers' complete-array shorthand
   * and `complete: false` observations all flow through. The wrapped snapshot
   * already applies the overlay to `modelInvocable` / `userInvocable`, so this
   * projection only re-derives the inventory-shaped `enabled` / `disabledReason`.
   * @returns sorted effective entries; empty when no registry is mounted.
   */
  @Remote('list')
  async list(signal?: AbortSignal): Promise<SkillInventorySnapshot> {
    const overrides = this.readOverrides()
    const registry = this.ctx.skills as SkillRegistry | undefined
    if (registry === undefined) return { entries: [] }
    const options = signal !== undefined ? { signal } : {}
    const snapshot = await registry.snapshot(options)
    const entries = snapshot.skills.map(summary => project(summary, overrides[summary.name]))
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    return { entries }
  }

  /**
   * Persist a user override for one skill. The settings commit fires
   * `settings/updated`, which triggers the gateway's listener to recompute
   * and re-emit the inventory snapshot — the wrapped registry reads the
   * updated overlay on its next `snapshot/list/get` call, so the next step
   * the model runs already reflects the toggle.
   * @param args.entryId - skill name; must be present in the registry.
   * @param args.enabled - desired effective state.
   * @param signal - transport cancellation injected by Typert.
   * @throws Error with a stable `code` field on failure.
   */
  @Remote('setEnabled')
  async setEnabled(
    args: { entryId: string; enabled: boolean },
    signal: AbortSignal,
  ): Promise<void> {
    const { entryId, enabled } = args
    signal.throwIfAborted()
    const current = this.readOverrides()
    const next = { ...current, [entryId]: enabled }
    try {
      await this.ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: next })
    } catch (cause) {
      throw errorWithCode(SKILL_INVENTORY_ERROR_SETTINGS_UPDATE, 'settings update failed', cause)
    }
  }

  /** Read the user overlay map; returns `{}` when the namespace is not yet resolved. */
  private readOverrides(): OverrideMap {
    const view = this.ctx.settings.get(SKILL_INVENTORY_SETTINGS_NAMESPACE) as
      | { enabled?: Record<string, boolean> }
      | undefined
    return view?.enabled ?? {}
  }

  /**
   * Recompute the inventory snapshot after a settings commit and emit it on
   * the `skill-inventory/changed` Cordis event. Consumers re-fetch via
   * `list()` on receipt, but carrying the real snapshot here lets dashboards
   * that hydrate from the event payload see the post-commit state without
   * an extra round-trip.
   */
  private async refreshInventoryAndNotify(): Promise<void> {
    let snapshot: SkillInventorySnapshot
    try {
      snapshot = await this.list()
    } catch (error) {
      this.ctx.logger.warn(
        `skill-inventory: failed to recompute snapshot after settings update: ${String(error)}`,
      )
      return
    }
    this.ctx.emit('skill-inventory/changed', { snapshot })
  }

  /**
   * Install per-call wrappers around `ctx.skills.snapshot/list/get` so every
   * downstream consumer (`dsh-tool-skill`, `api-proxy.skills.list`,
   * `agent/pre-step` skill-name expansion, etc.) reads the user overlay
   * without each consumer duplicating the projection logic.
   *
   * Why monkey-patch the registry instance instead of changing the consumer
   * surface: the registry is the established Cordis seam — every consumer
   * reads it via `ctx.skills.snapshot`/`list`/`get`, and the wrapped output
   * is shape-compatible with the original. Replacing the methods on the
   * instance (not the prototype) keeps a hypothetical second registry in a
   * different layer untouched.
   *
   * The override map is re-read on every call, so a commit that lands
   * between two snapshots is observed on the next read without any explicit
   * cache invalidation: `dsh-skill` keeps its own collect cache, but that
   * cache holds the cordis view; the wrapper applies the overlay after the
   * cached read returns.
   */
  private installSkillRegistryOverride(): void {
    const registry = this.ctx.skills as SkillRegistry | undefined
    if (registry === undefined) return
    const originalSnapshot = registry.snapshot.bind(registry) as (
      options?: SkillViewOptions,
    ) => Promise<SkillCatalogSnapshot>
    const originalList = registry.list.bind(registry) as (
      options?: SkillViewOptions,
    ) => Promise<SkillSummary[]>
    const originalGet = registry.get.bind(registry) as (
      name: string,
      options?: SkillViewOptions,
    ) => Promise<SkillDefinition | undefined>

    const wrappedSnapshot = async (options?: SkillViewOptions): Promise<SkillCatalogSnapshot> => {
      const overrides = this.readOverrides()
      const snapshot = await originalSnapshot(options)
      return {
        skills: snapshot.skills.map(skill => applySummaryOverride(skill, overrides)),
        complete: snapshot.complete,
      }
    }
    const wrappedList = async (options?: SkillViewOptions): Promise<SkillSummary[]> => {
      const overrides = this.readOverrides()
      const list = await originalList(options)
      return list.map(skill => applySummaryOverride(skill, overrides))
    }
    const wrappedGet = async (
      name: string,
      options?: SkillViewOptions,
    ): Promise<SkillDefinition | undefined> => {
      const overrides = this.readOverrides()
      const definition = await originalGet(name, options)
      if (definition === undefined) return undefined
      return applyDefinitionOverride(definition, overrides)
    }

    // Replace the instance's bound methods. SkillRegistry's internal `list()`
    // delegates to `this.snapshot(options)`, so the wrapped snapshot also
    // covers the registry's own list implementation.
    ;(registry as unknown as { snapshot: typeof registry.snapshot }).snapshot = wrappedSnapshot
    ;(registry as unknown as { list: typeof registry.list }).list = wrappedList
    ;(registry as unknown as { get: typeof registry.get }).get = wrappedGet
  }
}

/** Build an Error carrying a stable code (string) without inventing RpcError variants. */
function errorWithCode(code: string, message: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown }
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

export default SkillInventoryGateway
