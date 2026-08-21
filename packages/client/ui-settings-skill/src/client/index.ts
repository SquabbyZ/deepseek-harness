/** Settings skill-inventory tab: lazy list + dynamic enable/disable. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkillInventorySettingsTab, type SkillInventorySettingsTabInjected } from './SkillInventorySettingsTab.tsx'
import { createSkillInventoryStore } from './inventory-store.ts'
import { en, zh } from './locales.ts'

export type { SkillInventorySettingsTabInjected, SkillInventorySettingsTabProps } from './SkillInventorySettingsTab.tsx'
export type { SkillInventoryLocaleKey } from './locales.ts'
export {
  createSkillInventoryStore,
  type SkillInventoryStore,
  type SkillInventoryPanelSnapshot,
} from './inventory-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skill inventory copy. */
    'settings.skill': string
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.skill'

/** Services required by the Settings registration, the snapshot store, and the Remote contribution. */
export const inject = ['slots', 'locale', 'remote', 'remote.skillInventory']

/** Contribute the skill inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skill: dictionaries')

  const t = ctx.locale.bind(NS)

  const store = createSkillInventoryStore(
    {
      list: async () => {
        const result = await ctx.remote.skillInventory.list()
        if (!result.ok) {
          throw new Error(`skillInventory.list failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value
      },
    },
    (error) => {
      console.error('[ui-settings-skill] read failed:', error)
    },
  )

  ctx.effect(() => ctx.remote.$on('skill-inventory/changed', () => { store.refresh() }),
    'ui-settings-skill: refresh on remote event')
  ctx.effect(() => ctx.on('connection/reset', () => { store.reset(); store.refresh() }),
    'ui-settings-skill: reset on reconnect')

  const injected = (): SkillInventorySettingsTabInjected => ({
    list: async () => {
      const result = await ctx.remote.skillInventory.list()
      if (!result.ok) {
        throw new Error(`skillInventory.list failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    refresh: () => { store.refresh() },
    store,
    setEnabled: async ({ entryId, enabled }, { signal }) => {
      const result = await ctx.remote.skillInventory.setEnabled({ entryId, enabled }, signal)
      if (!result.ok) {
        throw new Error(`skillInventory.setEnabled failed: ${result.error.code}: ${result.error.message}`)
      }
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skill-manager',
    order: 17,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SkillInventorySettingsTab))
}
