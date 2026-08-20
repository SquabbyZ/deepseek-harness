/** Settings MCP-inventory tab: lazy list + dynamic enable/disable. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { McpInventorySettingsTab, type McpInventorySettingsTabInjected } from './McpInventorySettingsTab.tsx'
import { createMcpInventoryStore } from './inventory-store.ts'
import { en, zh } from './locales.ts'

export type { McpInventorySettingsTabInjected, McpInventorySettingsTabProps } from './McpInventorySettingsTab.tsx'
export type { McpInventoryLocaleKey } from './locales.ts'
export {
  createMcpInventoryStore,
  type McpInventoryStore,
  type McpInventoryPanelSnapshot,
} from './inventory-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP server inventory copy. */
    'settings.mcp': string
  }
}

export const NS = 'settings.mcp'

export const inject = ['slots', 'locale', 'remote', 'remote.mcpInventory']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')

  const t = ctx.locale.bind(NS)

  const store = createMcpInventoryStore(
    {
      list: async () => {
        const result = await ctx.remote.mcpInventory.list()
        if (!result.ok) {
          throw new Error(`mcpInventory.list failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value
      },
    },
    (error) => {
      console.error('[ui-settings-mcp] read failed:', error)
    },
  )

  ctx.effect(() => ctx.remote.$on('mcp-inventory/changed', () => { store.refresh() }),
    'ui-settings-mcp: refresh on remote event')
  ctx.effect(() => ctx.on('connection/reset', () => { store.reset(); store.refresh() }),
    'ui-settings-mcp: reset on reconnect')

  const injected = (): McpInventorySettingsTabInjected => ({
    list: async () => {
      const result = await ctx.remote.mcpInventory.list()
      if (!result.ok) {
        throw new Error(`mcpInventory.list failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    refresh: () => { store.refresh() },
    store,
    setEnabled: async ({ entryId, enabled }, { signal }) => {
      const result = await ctx.remote.mcpInventory.setEnabled({ entryId, enabled }, signal)
      if (!result.ok) {
        throw new Error(`mcpInventory.setEnabled failed: ${result.error.code}: ${result.error.message}`)
      }
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'mcp-list',
    order: 30,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, McpInventorySettingsTab))
}
