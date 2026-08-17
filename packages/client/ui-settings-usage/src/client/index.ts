/**
 * Usage-statistics settings plugin, browser half. It registers the Usage
 * settings page — stat tiles, a token-trend chart, and query-time controls —
 * and polls the host `usage.query` RPC through a client-side controller. The
 * Host collector and its wire API live behind `@deepseek-ai/dsh-usage-stats`;
 * this package declares only the wire contract it consumes (see contract.ts).
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { UsageStatsController } from './controller.ts'
import type { UsageStatsQuery } from './controller.ts'
import type { UsageQueryOptions, UsageStatsResult } from './contract.ts'
import { en, zh, type UsageKey } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Usage statistics page copy. */
    'settings.usage': UsageKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.usage'

/** Required services (cordis fiber inject); the slot is resolved through `slots.inject()`. */
export const inject = ['slots', 'locale', 'connection']

/**
 * The `usage.query` RPC surface the host api-proxy wires against
 * `ctx.usageStats.query`. Declared here — not read from `IApiClient`, whose
 * domain tree the composition owner extends in `api/*.ts` + `rpc-map.ts` — so
 * the cast below is the single seam that becomes real once that wiring lands.
 * The method name and request/response schemas live in contract.ts.
 */
interface UsageApiSurface {
  query(payload: UsageQueryOptions, signal?: AbortSignal): Promise<RpcResponse<UsageStatsResult>>
}

/**
 * Register the Usage section once the `settings.section` declaration is on the
 * ledger, wire its controller to the connection, and keep it polling.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-usage: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  // The host RPC for this section is composed separately; the cast is the seam
  // the composition owner fills in (see the UsageApiSurface doc above).
  const api = connection.api as unknown as { usage: UsageApiSurface }
  const query: UsageStatsQuery = async (options) => {
    const response = await api.usage.query(options)
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value
  }
  const controller = new UsageStatsController(query)
  const useSnapshot = bindSnapshotSelector(controller.store)
  // Registration-time text (the nav label thunk) and the inject face share one
  // bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as UsageSectionInjected['t']
  const injected = (): UsageSectionInjected => ({ controller, useSnapshot, t, getLocale: () => ctx.locale.getLocale().active })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, UsageSection))
}
