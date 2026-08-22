/** Settings MCP-inventory tab: lazy list + dynamic enable/disable + custom CRUD. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { McpInventorySettingsTab, type McpInventorySettingsTabInjected } from './McpInventorySettingsTab.tsx'
import {
  createMcpInventoryStore,
  type McpInventoryEntry,
  type McpRegistrySearchResult,
  type McpServerSpec,
  type SmitheryServer,
} from './inventory-store.ts'
import { en, zh } from './locales.ts'

export type { McpInventorySettingsTabInjected, McpInventorySettingsTabProps } from './McpInventorySettingsTab.tsx'
export type { McpInventoryLocaleKey } from './locales.ts'
export {
  createMcpInventoryStore,
  smitheryServerToSpec,
  type McpInventoryStore,
  type McpInventoryPanelSnapshot,
  type McpRegistrySearchResult,
  type McpServerSpec,
  type SmitheryServer,
} from './inventory-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP server inventory copy. */
    'settings.mcp': string
  }
}

export const NS = 'settings.mcp'

export const inject = ['slots', 'locale', 'remote', 'remote.mcpInventory', 'remote.mcpRegistry']

/**
 * The `mcpInventory` / `mcpRegistry` namespaces are mounted by the fixture
 * client assembly (api-remotes) — their wire types are not declared by a
 * generated package, so the call faces are narrowed here (same compromise the
 * plugin-inventory plugin makes for its own Remote).
 */
type McpInventoryRemote = {
  list(): Promise<{
    ok: boolean
    value: { entries: readonly McpInventoryEntry[] }
    error?: { code: string; message: string }
  }>
  setEnabled(
    args: { entryId: string; enabled: boolean },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }>
  upsertServer(
    spec: McpServerSpec,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }>
  deleteServer(
    args: { entryId: string },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }>
}
type McpRegistryRemote = {
  search(query: string): Promise<{
    ok: boolean
    value: McpRegistrySearchResult
    error?: { code: string; message: string }
  }>
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')

  const t = ctx.locale.bind(NS)

  const mcpRemote = ctx.remote as unknown as {
    mcpInventory: McpInventoryRemote
    mcpRegistry: McpRegistryRemote
  }

  const store = createMcpInventoryStore(
    {
      list: async () => {
        const result = await mcpRemote.mcpInventory.list()
        if (!result.ok) {
          throw new Error(`mcpInventory.list failed: ${result.error?.code}: ${result.error?.message}`)
        }
        return result.value
      },
      upsertServer: async (spec) => {
        const result = await mcpRemote.mcpInventory.upsertServer(spec)
        if (!result.ok) {
          throw new Error(`mcpInventory.upsertServer failed: ${result.error?.code}: ${result.error?.message}`)
        }
      },
      deleteServer: async (entryId) => {
        const result = await mcpRemote.mcpInventory.deleteServer({ entryId })
        if (!result.ok) {
          throw new Error(`mcpInventory.deleteServer failed: ${result.error?.code}: ${result.error?.message}`)
        }
      },
      search: async (query) => {
        const result = await mcpRemote.mcpRegistry.search(query)
        if (!result.ok) {
          throw new Error(`mcpRegistry.search failed: ${result.error?.code}: ${result.error?.message}`)
        }
        return result.value
      },
    },
    (error) => {
      console.error('[ui-settings-mcp] read failed:', error)
    },
  )

  ctx.effect(() => (ctx.remote as { $on(event: string, fn: () => void): () => void }).$on('mcp-inventory/changed', () => { store.refresh() }),
    'ui-settings-mcp: refresh on remote event')
  ctx.effect(() => ctx.on('connection/reset', () => { store.reset(); store.refresh() }),
    'ui-settings-mcp: reset on reconnect')

  const injected = (): McpInventorySettingsTabInjected => ({
    list: async () => {
      const result = await mcpRemote.mcpInventory.list()
      if (!result.ok) {
        throw new Error(`mcpInventory.list failed: ${result.error?.code}: ${result.error?.message}`)
      }
      return result.value
    },
    refresh: () => { store.refresh() },
    store,
    setEnabled: async ({ entryId, enabled }, { signal }) => {
      const result = await mcpRemote.mcpInventory.setEnabled({ entryId, enabled }, signal)
      if (!result.ok) {
        throw new Error(`mcpInventory.setEnabled failed: ${result.error?.code}: ${result.error?.message}`)
      }
      // The fixture's `mcpInventory/setEnabled` handler persists the new
      // overlay but does not emit `mcp-inventory/changed` (the future
      // host-side gateway will, but it is not yet wired into the runtime
      // composition). Re-read the inventory so the switch reflects the
      // committed state instead of snapping back to the stale snapshot.
      store.refresh()
    },
    upsertServer: spec => store.upsertServer(spec),
    deleteServer: entryId => store.deleteServer(entryId),
    search: query => store.search(query),
    installSmithery: (server: SmitheryServer) => store.installSmithery(server),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-manager',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, McpInventorySettingsTab))
}
