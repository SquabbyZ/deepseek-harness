/**
 * Outbound-proxy settings plugin, browser half. It registers the 代理 settings
 * section — a proxy URL input with test / clear / save — and drives the host
 * `host.testProxy` RPC and the `proxy` settings namespace through a client-side
 * controller. The host namespace + dispatcher live in `@deepseek-ai/dsh-network`.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ProxySection } from './ProxySection.tsx'
import type { ProxySectionInjected } from './ProxySection.tsx'
import { ProxySettingsController } from './controller.ts'
import { en, zh, type ProxyKey } from './locales.ts'

export type { ProxySectionInjected, ProxySectionProps } from './ProxySection.tsx'
export type { ProxyKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The outbound-proxy page copy. */
    'settings.proxy': ProxyKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.proxy'

/** Required services (cordis fiber inject); the slot is resolved through `slots.inject()`. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the 代理 section once the `settings.section` declaration is on the
 * ledger, wire its controller to the connection, and keep the input in sync.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-proxy: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ProxySettingsController(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as ProxySectionInjected['t']
  const injected = (): ProxySectionInjected => ({ controller, useSnapshot, t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'proxy',
    order: 25,
    label: () => t('nav'),
    inject: injected,
  }, ProxySection))
}
