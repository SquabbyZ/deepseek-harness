/** Settings skill-inventory tab: lazy list + dynamic enable/disable + skills.sh install. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkillInventorySettingsTab, type SkillInventorySettingsTabInjected } from './SkillInventorySettingsTab.tsx'
import { createSkillInventoryStore, type SkillInventoryEntry, type SkillRegistrySearchResult } from './inventory-store.ts'
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
export const inject = ['slots', 'locale', 'remote', 'remote.skillInventory', 'remote.skillRegistry']

/**
 * The `skillInventory` / `skillRegistry` namespaces are mounted by the fixture
 * client assembly (api-remotes) — their wire types are not declared by a
 * generated package, so the call faces are narrowed here (same compromise the
 * mcp-inventory plugin makes for its own Remote).
 */
type SkillInventoryRemote = {
  list(): Promise<{
    ok: boolean
    value: { entries: readonly SkillInventoryEntry[] }
    error?: { code: string; message: string }
  }>
  setEnabled(
    args: { entryId: string; enabled: boolean },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }>
}
type SkillRegistryRemote = {
  search(query: string): Promise<{
    ok: boolean
    value: SkillRegistrySearchResult
    error?: { code: string; message: string }
  }>
  installSkill(
    target: { name: string; source: string },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }>
  uninstall(
    target: { name: string },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }>
  readDetails(
    target: { name: string },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; value: { body: string }; error?: { code: string; message: string } }>
}

/** Contribute the skill inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skill: dictionaries')

  const t = ctx.locale.bind(NS)

  const remote = ctx.remote as unknown as { skillInventory: SkillInventoryRemote; skillRegistry: SkillRegistryRemote }

  const store = createSkillInventoryStore(
    {
      list: async () => {
        const result = await remote.skillInventory.list()
        if (!result.ok) {
          throw new Error(`skillInventory.list failed: ${result.error?.code}: ${result.error?.message}`)
        }
        return result.value
      },
      search: async (query) => {
        const result = await remote.skillRegistry.search(query)
        if (!result.ok) {
          throw new Error(`skillRegistry.search failed: ${result.error?.code}: ${result.error?.message}`)
        }
        return result.value
      },
      install: async (target) => {
        const result = await remote.skillRegistry.installSkill(target)
        if (!result.ok) {
          throw new Error(`skillRegistry.install failed: ${result.error?.code}: ${result.error?.message}`)
        }
      },
      uninstall: async (target, signal) => {
        const result = await remote.skillRegistry.uninstall(target, signal)
        if (!result.ok) {
          throw new Error(`skillRegistry.uninstall failed: ${result.error?.code}: ${result.error?.message}`)
        }
      },
      readDetails: async (target, signal) => {
        const result = await remote.skillRegistry.readDetails(target, signal)
        if (!result.ok) {
          throw new Error(`skillRegistry.readDetails failed: ${result.error?.code}: ${result.error?.message}`)
        }
        return result.value.body
      },
    },
    (error) => {
      console.error('[ui-settings-skill] read failed:', error)
    },
  )

  ctx.effect(() => (ctx.remote as { $on(event: string, fn: () => void): () => void }).$on('skill-inventory/changed', () => { store.refresh() }),
    'ui-settings-skill: refresh on remote event')
  ctx.effect(() => ctx.on('connection/reset', () => { store.reset(); store.refresh() }),
    'ui-settings-skill: reset on reconnect')

  const injected = (): SkillInventorySettingsTabInjected => ({
    list: async () => {
      const result = await remote.skillInventory.list()
      if (!result.ok) {
        throw new Error(`skillInventory.list failed: ${result.error?.code}: ${result.error?.message}`)
      }
      return result.value
    },
    refresh: () => { store.refresh() },
    store,
    setEnabled: async ({ entryId, enabled }, { signal }) => {
      const result = await remote.skillInventory.setEnabled({ entryId, enabled }, signal)
      if (!result.ok) {
        throw new Error(`skillInventory.setEnabled failed: ${result.error?.code}: ${result.error?.message}`)
      }
    },
    search: query => store.search(query),
    install: target => store.install(target),
    uninstall: (target, _signal) => store.uninstall(target),
    readDetails: (target, _signal) => store.readDetails(target),
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
