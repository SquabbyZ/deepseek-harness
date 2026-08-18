/** Settings agent-inventory tab: lazy list + dynamic enable/disable. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-host-agent-inventory/types'
import { AgentInventorySettingsTab, type AgentInventorySettingsTabInjected } from './AgentInventorySettingsTab.tsx'
import { createAgentInventoryStore } from './inventory-store.ts'
import { en, zh } from './locales.ts'

export type { AgentInventorySettingsTabInjected, AgentInventorySettingsTabProps } from './AgentInventorySettingsTab.tsx'
export type { AgentInventoryLocaleKey } from './locales.ts'
export {
  createAgentInventoryStore,
  type AgentInventoryStore,
  type AgentInventoryPanelSnapshot,
} from './inventory-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent preset inventory copy. */
    'settings.agent': string
  }
}

export const NS = 'settings.agent'

export const inject = ['slots', 'locale', 'remote', 'remote.agentInventory']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-agent: dictionaries')

  const t = ctx.locale.bind(NS)

  const store = createAgentInventoryStore(
    {
      list: async () => {
        const result = await ctx.remote.agentInventory.list()
        if (!result.ok) {
          throw new Error(`agentInventory.list failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value
      },
    },
    (error) => {
      console.error('[ui-settings-agent] read failed:', error)
    },
  )

  ctx.effect(() => ctx.remote.$on('agent-inventory/changed', () => { store.refresh() }),
    'ui-settings-agent: refresh on remote event')
  ctx.effect(() => ctx.on('connection/reset', () => { store.reset(); store.refresh() }),
    'ui-settings-agent: reset on reconnect')

  const injected = (): AgentInventorySettingsTabInjected => ({
    list: async () => {
      const result = await ctx.remote.agentInventory.list()
      if (!result.ok) {
        throw new Error(`agentInventory.list failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    refresh: () => { store.refresh() },
    store,
    setEnabled: async ({ entryId, enabled }, { signal }) => {
      const result = await ctx.remote.agentInventory.setEnabled({ entryId, enabled }, signal)
      if (!result.ok) {
        throw new Error(`agentInventory.setEnabled failed: ${result.error.code}: ${result.error.message}`)
      }
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'agent-list',
    order: 40,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, AgentInventorySettingsTab))
}
