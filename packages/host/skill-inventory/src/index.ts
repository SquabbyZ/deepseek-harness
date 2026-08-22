/**
 * Cordis skill inventory: user-toggleable Remote projection of effective
 * skill registry state. The host owns the runtime `ctx.skills` registry and
 * emits `skill-inventory/changed` after every user-overlay commit; the
 * consumer mirror subscribes through the existing `host/remote-event`
 * forwarding path.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { SkillRegistry, SkillSummary } from '@deepseek-ai/dsh-skill'
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

/** Public Remote service exposing the runtime skill registry with a user overlay. */
export class SkillInventoryGateway extends TypertRemoteService {
  static inject = ['skills', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'skillInventory')
    this.ctx.settings.register(
      SKILL_INVENTORY_SETTINGS_NAMESPACE,
      skillInventorySettingsSchema,
    )
    this.ctx.on('settings/updated', (ns) => {
      if (ns !== SKILL_INVENTORY_SETTINGS_NAMESPACE) return
      void this.ctx.emit('skill-inventory/changed', { snapshot: { entries: [] } })
    })
  }

  /**
   * Project the runtime skill catalog with the user overlay applied.
   * Reads via `ctx.skills.snapshot()` so providers' complete-array shorthand
   * and `complete: false` observations all flow through.
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
   * Persist a user override for one skill. The toggle's effect on the runtime
   * registry is delegated to consumers (the registry filters `modelInvocable` /
   * `userInvocable` per summary).
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
  private readOverrides(): Record<string, boolean> {
    const view = this.ctx.settings.get(SKILL_INVENTORY_SETTINGS_NAMESPACE) as
      | { enabled?: Record<string, boolean> }
      | undefined
    return view?.enabled ?? {}
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
