/**
 * Cordis agent-preset inventory: user-toggleable Remote projection of every
 * preset the host can mount. Each preset is a filesystem-discovered composition;
 * the user overlay toggles whether the preset is offered to subsequent agent
 * factories without unloading its on-disk definition.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset, AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { AGENT_INVENTORY_SETTINGS_NAMESPACE, agentInventorySettingsSchema } from './settings.ts'
import type {
  AgentDisabledReason,
  AgentEntryId,
  AgentEntrySource,
  AgentInventoryEntry,
  AgentInventorySnapshot,
} from './types.ts'

export type * from './types.ts'
export { AGENT_INVENTORY_SETTINGS_NAMESPACE, agentInventorySettingsSchema } from './settings.ts'

/** Stable error tag for failed settings writes before any commit. */
export const AGENT_INVENTORY_ERROR_SETTINGS_UPDATE = 'agent-inventory/settings-update-failed'

/** Settings namespace from `agent-presets` where the default preset id lives. */
const AGENT_PRESETS_SETTINGS_NAMESPACE = 'agent-presets'

/** Brand a preset id at the owning boundary. */
function agentEntryId(value: string): AgentEntryId {
  return value as AgentEntryId
}

/** Public Remote service projecting every discovered agent preset with a user overlay. */
export class AgentInventoryGateway extends TypertRemoteService {
  static inject = ['settings', 'agentPresets']

  constructor(ctx: Context) {
    super(ctx, 'agentInventory')
    this.ctx.settings.register(
      AGENT_INVENTORY_SETTINGS_NAMESPACE,
      agentInventorySettingsSchema,
    )
    this.ctx.on('settings/updated', (ns) => {
      // Re-emit on either our overlay or the agent-presets default id commit;
      // both can flip the rendered snapshot.
      if (ns !== AGENT_INVENTORY_SETTINGS_NAMESPACE && ns !== AGENT_PRESETS_SETTINGS_NAMESPACE) return
      void this.ctx.emit('agent-inventory/changed', { snapshot: { entries: [] } })
    })
  }

  /**
   * Project every discovered preset with the user overlay applied; the
   * `agent-presets/default` field still surfaces as `isDefault`.
   * @returns effective entries; empty when no presets are mounted.
   */
  @Remote('list')
  async list(signal?: AbortSignal): Promise<AgentInventorySnapshot> {
    const overrides = this.readOverrides()
    const defaultId = this.readDefaultId()
    const registry = this.ctx.agentPresets as AgentPresets | undefined
    if (registry === undefined) return { entries: [] }
    if (signal?.aborted === true) throw new Error('aborted')
    const presets = await registry.list()
    const entries: AgentInventoryEntry[] = []
    for (const preset of presets) {
      const presetId = preset.id
      const userOverride = overrides[presetId]
      const enabled = userOverride !== undefined ? userOverride : true
      const disabledReason: AgentDisabledReason = enabled
        ? null
        : userOverride === false ? 'user' : 'cordis'
      entries.push({
        entryId: agentEntryId(presetId),
        presetId,
        name: preset.name ?? presetId,
        description: preset.description ?? '',
        defaultModel: '',
        source: classifySource(preset),
        isDefault: presetId === defaultId,
        enabled,
        disabledReason,
      })
    }
    entries.sort((left, right) => (left.presetId < right.presetId ? -1 : left.presetId > right.presetId ? 1 : 0))
    return { entries }
  }

  /**
   * Persist a user override for one preset.
   * @param args.entryId - preset id; must be present in `list()`.
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
      await this.ctx.settings.update(AGENT_INVENTORY_SETTINGS_NAMESPACE, { enabled: next })
    } catch (cause) {
      throw errorWithCode(AGENT_INVENTORY_ERROR_SETTINGS_UPDATE, 'settings update failed', cause)
    }
  }

  /** Read the user overlay map; returns `{}` when the namespace is not yet resolved. */
  private readOverrides(): Record<string, boolean> {
    const view = this.ctx.settings.get(AGENT_INVENTORY_SETTINGS_NAMESPACE) as
      | { enabled?: Record<string, boolean> }
      | undefined
    return view?.enabled ?? {}
  }

  /** Read the `agent-presets/default` field; absent when the user has not chosen one. */
  private readDefaultId(): string | undefined {
    const view = this.ctx.settings.get(AGENT_PRESETS_SETTINGS_NAMESPACE as never) as
      | { default?: string }
      | undefined
    return typeof view?.default === 'string' ? view.default : undefined
  }
}

/** Classify a preset's source bucket from its `trust` field. */
function classifySource(preset: AgentPreset): AgentEntrySource {
  if (preset.trust === 'system' || preset.trust === 'user') return preset.trust
  return 'unknown'
}

/** Build an Error carrying a stable code (string) without inventing RpcError variants. */
function errorWithCode(code: string, message: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown }
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

export default AgentInventoryGateway
