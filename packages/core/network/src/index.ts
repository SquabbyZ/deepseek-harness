/**
 * Outbound HTTP proxy: persists a proxy URL, installs it as the process-global
 * undici dispatcher so every host outbound `fetch` (the LLM providers, web
 * search, model discovery, GitHub OAuth, the lazy provider-SDK download) routes
 * through it, and exposes a connectivity probe the settings page's 测试 button
 * drives. Node's `fetch` is undici, which ignores `HTTP_PROXY`/`HTTPS_PROXY`, so
 * a global `ProxyAgent` is the only way to make those requests honour a proxy.
 *
 * @module @deepseek-ai/dsh-network
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Agent, ProxyAgent, setGlobalDispatcher, type Dispatcher } from 'undici'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Outbound-proxy runtime: the persisted URL plus a connectivity probe. */
    network: NetworkHandle
  }
}

/** Settings namespace carrying the outbound proxy URL. */
export const PROXY_SETTINGS_NAMESPACE = settingsNamespace('proxy')

/** Stored proxy section: one URL, empty means direct (no proxy). */
export interface ProxySettings {
  url: string
}

/** Schema of the proxy settings section. */
export const PROXY_SETTINGS_SCHEMA: z<ProxySettings> = z.object({
  url: z.string().default(''),
})

/** Probe target for the connectivity test (reliable, and what the lazy SDK download also needs). */
const PROBE_URL = 'https://registry.npmjs.org/-/ping'

/** Probe timeout: long enough for a slow proxy, short enough not to hang the page. */
const PROBE_TIMEOUT_MS = 10_000

/** The runtime face the api-proxy's `host.testProxy` and the UI consume. */
export interface NetworkHandle {
  /** The configured proxy URL (trimmed), or undefined when empty / unset. */
  proxyUrl(): string | undefined
  /** Probe one proxy URL; `ok` is true when the proxy reaches the internet. */
  testProxy(url: string, signal?: AbortSignal): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
}

/** Cordis plugin name. */
export const name = 'network'

/**
 * Register the `proxy` settings namespace and keep the global undici dispatcher
 * in step with it: a stored URL installs a `ProxyAgent`, clearing it restores
 * the direct `Agent`. `installSettingsSection` calls `onChange` once at mount
 * and again on every settings change, so the dispatcher never goes stale.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  let source: () => ProxySettings = () => ({ url: '' })
  const applyProxy = (): void => {
    const url = source().url.trim()
    try {
      setGlobalDispatcher(url === '' ? new Agent() : new ProxyAgent(url))
      ctx.logger.info(`network: outbound proxy ${url === '' ? 'disabled (direct)' : url}`)
    } catch (error) {
      ctx.logger.error('network: failed to apply the outbound proxy')
      ctx.logger.error(error)
    }
  }
  installSettingsSection(ctx, PROXY_SETTINGS_NAMESPACE, PROXY_SETTINGS_SCHEMA, { url: '' }, {
    setSource: (current) => { source = current },
    onChange: applyProxy,
  })
  ctx.provide('network', {
    proxyUrl: (): string | undefined => {
      const url = source().url.trim()
      return url === '' ? undefined : url
    },
    testProxy: async (url: string, signal?: AbortSignal) => {
      const trimmed = url.trim()
      if (trimmed === '') return { ok: false, error: 'proxy URL is empty' }
      const started = Date.now()
      const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
      const combined = signal === undefined ? timeout : AbortSignal.any([timeout, signal])
      try {
        const init: RequestInit & { dispatcher: Dispatcher } = { dispatcher: new ProxyAgent(trimmed), signal: combined }
        await fetch(PROBE_URL, init)
        return { ok: true, latencyMs: Date.now() - started }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
