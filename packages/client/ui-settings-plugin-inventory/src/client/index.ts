/** Settings plugin-inventory tab: lazy list + dynamic enable/disable. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { createPluginInventoryStore, type PluginInventoryEntry } from './inventory-store.ts'
import { en, zh } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'
export {
  createPluginInventoryStore,
  type PluginInventoryStore,
  type PluginInventoryPanelSnapshot,
} from './inventory-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin inventory copy. */
    'settings.pluginInventory': string
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration, the snapshot store, and the Remote contribution. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Contribute the inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)

  // Snapshot store: re-reads through the Remote list and subscribes to the
  // forwarded `plugin-inventory/changed` event so the panel refreshes on
  // every host commit. The store is recreated on every plugin mount so its
  // generation counter and listeners stay fiber-local.
  // The pluginInventory namespace is mounted by the fixture client assembly
  // (api-remotes) — its wire type is not declared by a generated package, so
  // the call face is narrowed here.
  const inventoryRemote = ctx.remote as unknown as {
    pluginInventory: {
      list(): Promise<{
        ok: boolean
        value: { entries: readonly PluginInventoryEntry[] }
        error?: { code: string; message: string }
      }>
      setEnabled(
        args: { entryId: string; enabled: boolean },
        signal?: AbortSignal,
      ): Promise<{ ok: boolean; error?: { code: string; message: string } }>
    }
  }
  const store = createPluginInventoryStore(
    {
      list: async (signal) => {
        void signal
        const result = await inventoryRemote.pluginInventory.list()
        if (!result.ok) {
          throw new Error(`pluginInventory.list failed: ${result.error?.code}: ${result.error?.message}`)
        }
        return result.value
      },
    },
    (error) => {
      console.error('[ui-settings-plugin-inventory] read failed:', error)
    },
  )

  // Refresh the store on every forwarded change; also re-read after a
  // reconnect so the new generation re-baselines the panel.
  ctx.effect(() => (ctx.remote as { $on(event: string, fn: () => void): () => void }).$on('plugin-inventory/changed', () => { store.refresh() }),
    'ui-settings-plugin-inventory: refresh on remote event')
  ctx.effect(() => ctx.on('connection/reset', () => { store.reset(); store.refresh() }),
    'ui-settings-plugin-inventory: reset on reconnect')

  const injected = (): PluginInventorySettingsTabInjected => ({
    list: async () => {
      const result = await inventoryRemote.pluginInventory.list()
      if (!result.ok) {
        throw new Error(`pluginInventory.list failed: ${result.error?.code}: ${result.error?.message}`)
      }
      return result.value
    },
    refresh: () => { store.refresh() },
    store,
    setEnabled: async ({ entryId, enabled }, { signal }) => {
      const result = await inventoryRemote.pluginInventory.setEnabled({ entryId, enabled }, signal)
      if (!result.ok) {
        throw new Error(`pluginInventory.setEnabled failed: ${result.error?.code}: ${result.error?.message}`)
      }
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))
}
