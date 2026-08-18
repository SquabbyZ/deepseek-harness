/** Cordis Loader plugin inventory: user-toggleable Remote projection of effective entry state. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { PLUGIN_INVENTORY_SETTINGS_NAMESPACE, pluginInventorySettingsSchema } from './settings.ts'
import type {
  PluginDisabledReason,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'
export { PLUGIN_INVENTORY_SETTINGS_NAMESPACE, pluginInventorySettingsSchema } from './settings.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Stable reason tag for an entry the user explicitly disabled. */
const REASON_USER: PluginDisabledReason = 'user'
/** Stable reason tag for an entry the loader-side config disabled. */
const REASON_CORDIS: PluginDisabledReason = 'cordis'

/** Stable error tag for the entry-not-found case. */
export const PLUGIN_INVENTORY_ERROR_ENTRY_NOT_FOUND = 'plugin-inventory/entry-not-found'
/** Stable error tag for a failed settings write before the loader applied. */
export const PLUGIN_INVENTORY_ERROR_SETTINGS_UPDATE = 'plugin-inventory/settings-update-failed'
/** Stable error tag for a failed loader entry update after settings succeeded. */
export const PLUGIN_INVENTORY_ERROR_LOADER_UPDATE = 'plugin-inventory/loader-update-failed'

/** Public Remote service exposing the Loader's current non-group entry state and the user toggle. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
    // Register the user-overlay namespace exactly once per service fiber.
    this.ctx.settings.register(
      PLUGIN_INVENTORY_SETTINGS_NAMESPACE,
      pluginInventorySettingsSchema,
    )
    // Forward the namespace's `update` source as a forwarded Cordis event so
    // the existing remote-event pipeline carries it verbatim to consumers.
    this.ctx.on('settings/updated', (ns) => {
      if (ns !== PLUGIN_INVENTORY_SETTINGS_NAMESPACE) return
      this.ctx.emit('plugin-inventory/changed', { snapshot: this.list() })
    })
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order, with the user
   *   overlay from `~/.dsh/settings.yaml` applied.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const overrides = this.readOverrides()
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      const cordisDisabled = entry.disabled
      const userOverride = overrides[entry.id]
      const enabled = userOverride !== undefined ? userOverride : !cordisDisabled
      const disabledReason = resolveReason(userOverride, cordisDisabled, enabled)
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled,
        disabledReason,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /**
   * Persist a user override and immediately apply it to the Loader entry.
   * Settings write and `entry.update` are sequenced so a settings write failure
   * never leaves an orphaned disabled state in the Loader; an `entry.update`
   * failure rolls the settings write back to its prior value.
   * @param args.entryId - Loader-tree entry id; must be present in `list()`.
   * @param args.enabled - desired effective state; `true` clears a prior user off-toggle.
   * @param signal - transport cancellation injected by Typert.
   * @throws Error with `code` set to one of {@link PLUGIN_INVENTORY_ERROR_*} on failure.
   */
  @Remote('setEnabled')
  async setEnabled(
    args: { entryId: string; enabled: boolean },
    signal: AbortSignal,
  ): Promise<void> {
    const { entryId, enabled } = args
    signal.throwIfAborted()
    const ns = PLUGIN_INVENTORY_SETTINGS_NAMESPACE
    const current = this.readOverrides()
    const next = { ...current, [entryId]: enabled }
    const entry = this.findEntry(entryId)

    // Write settings first; if this fails, the Loader stays in its prior state.
    try {
      await this.ctx.settings.update(ns, { enabled: next })
    } catch (cause) {
      throw errorWithCode(PLUGIN_INVENTORY_ERROR_SETTINGS_UPDATE, 'settings update failed', cause)
    }
    signal.throwIfAborted()
    // Apply to the Loader. Roll the settings write back on failure.
    try {
      await entry.update({ disabled: !enabled })
    } catch (cause) {
      try {
        // `replace` (not `update`) is required: `update` merges patch into the
        // current section, so `{ enabled: {} }` would leave the prior override
        // key in place. Rollback must restore the exact prior section.
        await this.ctx.settings.replace(ns, { enabled: current })
      } catch (rollback) {
        const errors = [asError(cause), asError(rollback)].filter(Boolean) as Error[]
        throw errorWithCode(
          PLUGIN_INVENTORY_ERROR_LOADER_UPDATE,
          'loader update failed and rollback also failed',
          new AggregateError(errors, 'plugin-inventory setEnabled rollback failed'),
        )
      }
      throw errorWithCode(PLUGIN_INVENTORY_ERROR_LOADER_UPDATE, 'loader update failed', cause)
    }
  }

  /** Read the user-overlay map; returns `{}` when the namespace is not yet resolved. */
  private readOverrides(): Record<string, boolean> {
    const view = this.ctx.settings.get(PLUGIN_INVENTORY_SETTINGS_NAMESPACE) as
      | { enabled?: Record<string, boolean> }
      | undefined
    return view?.enabled ?? {}
  }

  /** Resolve one Loader entry by id or throw a typed error. */
  private findEntry(entryId: string) {
    for (const candidate of this.ctx.loader.entries()) {
      if (candidate.id === entryId) return candidate
    }
    throw errorWithCode(
      PLUGIN_INVENTORY_ERROR_ENTRY_NOT_FOUND,
      `unknown plugin-inventory entry: ${entryId}`,
    )
  }
}

/** Resolve the effective reason for a projection row. */
function resolveReason(
  userOverride: boolean | undefined,
  cordisDisabled: boolean,
  enabled: boolean,
): PluginDisabledReason {
  if (enabled) return null
  if (userOverride === false) return REASON_USER
  if (cordisDisabled) return REASON_CORDIS
  return null
}

/** Build an Error carrying a stable code (string) without inventing RpcError variants. */
function errorWithCode(code: string, message: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown }
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

/** Coerce an unknown value into an Error instance when possible. */
function asError(value: unknown): Error | null {
  return value instanceof Error ? value : null
}

export default PluginInventoryGateway
