/**
 * Outbound-proxy settings controller: reads the `proxy` namespace, writes a URL
 * (or clears it) through `settings.mutate`, and probes one URL through the
 * `host.testProxy` RPC. The host is the single fact source — every mutation
 * re-reads the descriptor so the input reflects the stored value, and a changed
 * proxy re-applies the global dispatcher on the host side.
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The settings namespace the host `@deepseek-ai/dsh-network` plugin owns. */
export const PROXY_SETTINGS_NS = 'proxy'

/** The placeholder shown while no proxy is stored. */
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'

/** Result of one connectivity probe (mirrors `host.testProxy`). */
export interface ProxyTestResult {
  ok: boolean
  latencyMs?: number
  error?: string
}

/** Page snapshot. */
export interface ProxySettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Stored proxy URL ('' when none). */
  value: string
  testing: boolean
  testResult: ProxyTestResult | null
  /** Last save/clear failure, cleared by the next action. */
  error: string | null
}

/**
 * Read/write the proxy URL and drive its connectivity test.
 * @param api - the settings + host wire faces.
 */
export class ProxySettingsController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<ProxySettingsState> = createSnapshotStore({
    status: 'idle',
    value: '',
    testing: false,
    testResult: null,
    error: null,
  })

  private generation = 0
  private view: SettingsNamespaceView | undefined

  constructor(private readonly api: Pick<IApiClient, 'settings' | 'host'>) {}

  /**
   * Read the `proxy` namespace into the snapshot. Latest request wins.
   * @returns nothing; {@link store} carries success or failure.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return
      const view = response.result.value.namespaces.find(entry => entry.ns === PROXY_SETTINGS_NS)
      this.view = view
      const value = (view?.value as { url?: unknown } | null)?.url
      this.store.update((state) => {
        state.status = 'ready'
        state.value = typeof value === 'string' ? value : ''
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Persist a proxy URL (trimmed), then re-read the descriptor. */
  async save(url: string): Promise<void> {
    await this.write([{ op: 'set', path: ['url'], value: url.trim() }])
  }

  /** Remove the proxy URL, then re-read the descriptor. */
  async clear(): Promise<void> {
    await this.write([{ op: 'unset', path: ['url'] }])
  }

  /** Shared set/unset write path. */
  private async write(
    ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>,
  ): Promise<void> {
    const view = this.view
    const generation = ++this.generation
    this.store.update((state) => { state.error = null })
    try {
      const response = await this.api.settings.mutate({
        ns: PROXY_SETTINGS_NS,
        ops,
        ...(view === undefined ? {} : { expectedRevision: view.revision }),
      })
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.load()
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => { state.error = error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Probe one URL through the host's proxy tester. The result is always a value
   * (`{ ok, latencyMs?, error? }`) — a down proxy is a result, not a rejection.
   * @param url - the proxy URL to test.
   */
  async test(url: string): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.testing = true; state.testResult = null; state.error = null })
    try {
      const response = await this.api.host.testProxy({ url: url.trim() })
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      const value = response.result.value
      this.store.update((state) => { state.testing = false; state.testResult = value })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.testing = false
        state.testResult = { ok: false, error: error instanceof Error ? error.message : String(error) }
      })
    }
  }
}
