/**
 * Cordis MCP server inventory: user-toggleable Remote projection of effective
 * MCP-client Loader entries. Each `name: '@deepseek-ai/dsh-mcp-client'` Loader
 * entry represents one server; this gateway projects the current set with the
 * user overlay applied and emits `mcp-inventory/changed` on every commit.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { MCP_INVENTORY_SETTINGS_NAMESPACE, mcpInventorySettingsSchema } from './settings.ts'
import type {
  McpDisabledReason,
  McpEntryId,
  McpInventoryEntry,
  McpInventorySnapshot,
  McpTransport,
} from './types.ts'

export type * from './types.ts'
export { MCP_INVENTORY_SETTINGS_NAMESPACE, mcpInventorySettingsSchema } from './settings.ts'

/** Stable error tag for failed settings writes before any commit. */
export const MCP_INVENTORY_ERROR_SETTINGS_UPDATE = 'mcp-inventory/settings-update-failed'

const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

/** Brand a Loader entry id at the owning boundary. */
function mcpEntryId(value: string): McpEntryId {
  return value as McpEntryId
}

/** Read the `serverName` field from an MCP-client Loader entry config. */
function readServerName(entry: Entry): string {
  const config = entry.options.config as { serverName?: unknown } | undefined
  return typeof config?.serverName === 'string' ? config.serverName : entry.id
}

/** Read the transport kind from an MCP-client Loader entry config. */
function readTransport(entry: Entry): McpTransport {
  const config = entry.options.config as { transport?: unknown } | undefined
  if (config?.transport === 'stdio') return 'stdio'
  if (config?.transport === 'streamable-http') return 'streamable-http'
  return 'unknown'
}

/** Read the executable/URL target from an MCP-client Loader entry config. */
function readTarget(entry: Entry): string {
  const config = entry.options.config as
    | { command?: unknown; url?: unknown }
    | undefined
  if (typeof config?.command === 'string') return config.command
  if (typeof config?.url === 'string') return config.url
  return ''
}

/** Public Remote service projecting MCP-client Loader entries with a user overlay. */
export class McpInventoryGateway extends TypertRemoteService {
  static inject = ['loader', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'mcpInventory')
    this.ctx.settings.register(
      MCP_INVENTORY_SETTINGS_NAMESPACE,
      mcpInventorySettingsSchema,
    )
    this.ctx.on('settings/updated', (ns) => {
      if (ns !== MCP_INVENTORY_SETTINGS_NAMESPACE) return
      this.ctx.emit('mcp-inventory/changed', { snapshot: this.listSync() })
    })
  }

  /**
   * Project the current MCP-client Loader entries with the user overlay applied.
   * @returns effective entries; empty when no MCP-client plugin is loaded.
   */
  @Remote('list')
  list(): McpInventorySnapshot {
    return this.listSync()
  }

  /**
   * Persist a user override for one MCP server. The runtime fiber's `disabled`
   * flag is left alone; consumers that want to actually unload the server
   * must reload the Loader composition.
   * @param args.entryId - Loader entry id; must be present in `list()`.
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
      await this.ctx.settings.update(MCP_INVENTORY_SETTINGS_NAMESPACE, { enabled: next })
    } catch (cause) {
      throw errorWithCode(MCP_INVENTORY_ERROR_SETTINGS_UPDATE, 'settings update failed', cause)
    }
  }

  /** Synchronous projection used by both `@Remote('list')` and the change forwarder. */
  private listSync(): McpInventorySnapshot {
    const overrides = this.readOverrides()
    const entries: McpInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      if (entry.options.name !== MCP_CLIENT_PACKAGE) continue
      const serverName = readServerName(entry)
      const userOverride = overrides[serverName]
      const cordisDisabled = entry.disabled === true
      const enabled = userOverride !== undefined ? userOverride : !cordisDisabled
      const disabledReason: McpDisabledReason = resolveReason(userOverride, cordisDisabled, enabled)
      entries.push({
        entryId: mcpEntryId(entry.id),
        serverName,
        transport: readTransport(entry),
        target: readTarget(entry),
        toolCount: 0,
        enabled,
        disabledReason,
      })
    }
    entries.sort((left, right) => (left.serverName < right.serverName ? -1 : left.serverName > right.serverName ? 1 : 0))
    return { entries }
  }

  /** Read the user overlay map; returns `{}` when the namespace is not yet resolved. */
  private readOverrides(): Record<string, boolean> {
    const view = this.ctx.settings.get(MCP_INVENTORY_SETTINGS_NAMESPACE) as
      | { enabled?: Record<string, boolean> }
      | undefined
    return view?.enabled ?? {}
  }
}

/** Resolve the effective reason for a projection row. */
function resolveReason(
  userOverride: boolean | undefined,
  cordisDisabled: boolean,
  enabled: boolean,
): McpDisabledReason {
  if (enabled) return null
  if (userOverride === false) return 'user'
  if (cordisDisabled) return 'cordis'
  return null
}

/** Build an Error carrying a stable code (string) without inventing RpcError variants. */
function errorWithCode(code: string, message: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown }
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

export default McpInventoryGateway
