/**
 * Register a {@link DeepSeekAdapter} for the `deepseek-official` provider route on
 * `ctx.llm`, mounted dormant like the pi-ai twin: the route is not registered
 * until the optional `llm-deepseek` user-settings section supplies a profile,
 * and it drops again when that profile is removed. Profile facts resolve per
 * request through the optional credential seam (`ctx.credentials`), so a changed
 * base URL, catalog, or key reaches the very next request without restarting
 * anything, while an in-flight stream keeps the facts it started with. The two
 * registration-captured facts — the route set and the retry policy — re-register
 * the adapter in place when they change.
 *
 * ```yaml
 * - id: llm-deepseek
 *   name: '@deepseek-ai/dsh-llm-deepseek'
 *   config:
 *     providers:
 *       deepseek-official:
 *         apiKeyEnv: DEEPSEEK_API_KEY
 *         models:
 *           - id: deepseek-v4-flash
 *           - id: deepseek-v4-pro
 * ```
 *
 * @module @deepseek-ai/dsh-llm-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, LlmConfigurableProvider, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DeepSeekAdapter,
} from './adapter.ts'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from './adapter.ts'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DeepSeekAdapter,
} from './adapter.ts'
export type { DeepSeekAdapterOptions, DeepSeekCatalogModel, DeepSeekConnectionOptions } from './adapter.ts'
export type { RequestDefaults } from './serialize.ts'
export type * from './types.ts'

export const name = 'llm-deepseek'
export const inject = ['llm']

const NS = settingsNamespace('llm-deepseek')
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
/** The single provider route this plugin owns. */
const PROVIDER = 'deepseek-official'

const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: DEFAULT_CONTEXT_WINDOW },
]

/**
 * Configuration for one DeepSeek route. Every field is optional in yml: a
 * missing API key resolves through {@link DeepSeekProfile.apiKeyEnv} at each
 * request (a request without any key fails with `MISSING_CREDENTIAL`, not at
 * plugin load), omitted thinking mode uses the provider default, and omitted
 * reasoning effort resolves to `high`.
 */
export interface DeepSeekProfile {
  /** Credential reference (environment-variable name) resolved per request; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; falls back to $DEEPSEEK_BASE_URL from a trusted environment layer, then the public API. */
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'high' | 'max'
  /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to V4 Flash and V4 Pro. */
  models?: DeepSeekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

/**
 * Plugin configuration: the provider routes this instance owns. An empty (or
 * omitted) dict is the dormant settings-driven posture — the adapter mounts
 * with no routes and registers `deepseek-official` the moment a settings
 * section supplies its profile, dropping it again when the profile is removed.
 */
export interface Config {
  /**
   * DeepSeek provider routes, keyed by route. Only `deepseek-official` is a
   * route this adapter serves; any other key is refused.
   */
  providers?: Record<string, DeepSeekProfile>
}

const catalogModel: z<DeepSeekCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

const DeepSeekProfileSchema: z<DeepSeekProfile> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  thinking: z.union(['enabled', 'disabled']),
  reasoningEffort: z.union(['off', 'high', 'max']),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.dict(DeepSeekProfileSchema).default({}),
})

/** Public API default; the internal endpoint comes from $DEEPSEEK_BASE_URL. */
export const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Environment variable naming this provider's endpoint, honored only from trusted layers. */
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

/**
 * One resolution's complete request facts. Connection and credential facts
 * are one value on purpose: a snapshot the resolver rejects keeps the whole
 * previous generation, so a request can never pair a stale endpoint with a
 * newer key.
 */
export type ResolvedDeepSeekOptions = DeepSeekConnectionOptions

/** Resolve, validate, and detach the advisory model catalog. */
function resolveModels(models: readonly DeepSeekCatalogModel[] | undefined): DeepSeekCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (model.id.length === 0) throw new Error('llm-deepseek: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-deepseek: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-deepseek: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-deepseek: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`llm-deepseek: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }
  })
}

/**
 * The one explicit resolve step from raw profile to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param profile - raw provider profile or resolved settings snapshot.
 * @param environment - this run's environment layers, or `undefined` outside
 * the product CLI. Every layer may supply an endpoint: the product trusts the
 * project it is launched in, so a checkout can point its own agent at the
 * gateway that checkout is meant to use.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(profile: DeepSeekProfile, environment?: LaunchEnvironmentSnapshot): ResolvedDeepSeekOptions {
  if (profile.thinking === 'disabled'
    && profile.reasoningEffort !== undefined
    && profile.reasoningEffort !== 'off') {
    throw new Error('llm-deepseek: only reasoningEffort "off" can be configured when thinking is disabled')
  }
  if (profile.defaultContextWindow !== undefined
    && (!Number.isInteger(profile.defaultContextWindow) || profile.defaultContextWindow <= 0)) {
    throw new Error('llm-deepseek: defaultContextWindow must be a positive integer')
  }
  if (profile.maxTokens !== undefined
    && (!Number.isSafeInteger(profile.maxTokens) || profile.maxTokens <= 0)) {
    throw new Error('llm-deepseek: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = profile.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-deepseek: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return {
    apiKeyEnv: credentialRef(profile.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL: profile.baseURL
      ?? environment?.get(BASE_URL_ENV)?.value
      ?? PUBLIC_BASE_URL,
    defaults: {
      thinking: profile.thinking,
      reasoningEffort: profile.reasoningEffort,
    },
    maxTokens: profile.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: profile.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(profile.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(profile.retryPolicy, 'llm-deepseek: retryPolicy'),
  }
}

/**
 * Resolve the provider profiles keyed by route. This is the one explicit
 * resolve step for the whole section, so an omitted dict resolves to the empty
 * (dormant) route set here rather than through a hidden fallback.
 * @param providers - configured provider profiles keyed by route.
 * @param environment - this run's environment layers.
 * @returns resolved profiles in configuration order.
 */
export function resolveProfiles(
  providers: Readonly<Record<string, DeepSeekProfile>> | undefined,
  environment?: LaunchEnvironmentSnapshot,
): Map<string, ResolvedDeepSeekOptions> {
  const resolved = new Map<string, ResolvedDeepSeekOptions>()
  for (const [provider, source] of Object.entries(providers ?? {})) {
    if (provider !== PROVIDER) {
      throw new Error(`llm-deepseek: unknown provider route "${provider}"; only "${PROVIDER}" is served`)
    }
    resolved.set(provider, resolveAdapterOptions(source, environment))
  }
  return resolved
}

/** The single configurable-provider directory entry: always advertised, dormant until configured. */
const DIRECTORY_ENTRY: LlmConfigurableProvider = {
  provider: PROVIDER,
  displayName: 'DeepSeek',
  settingsNs: NS,
  settingsPath: ['providers', PROVIDER],
  declared: false,
  baseUrl: 'https://api.deepseek.com',
}

/**
 * The registry captures these per route; a change here must re-register. The
 * route set is captured by the entry keys and the retry policy rides each
 * entry, so both a route appearing/disappearing and a policy change are seen.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedDeepSeekOptions>): unknown {
  return [...profiles.entries()].map(([provider, profile]) => ({
    provider,
    retryPolicy: profile.retryPolicy,
  }))
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let memoized: ReadonlyMap<string, ResolvedDeepSeekOptions> | undefined
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity — which is also what makes the adapter's own snapshot
   * stable across operations that observe no change. A snapshot that fails the
   * beyond-schema resolve step keeps the last good route set serving requests.
   */
  const profiles = (): ReadonlyMap<string, ResolvedDeepSeekOptions> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    try {
      const next = resolveProfiles(raw.providers, launchEnvironmentOf(ctx))
      lastRaw = raw
      memoized = next
      return next
    } catch (error) {
      if (memoized === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-deepseek: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return memoized
    }
  }
  profiles()

  const options = (): ResolvedDeepSeekOptions => {
    const profile = profiles().get(PROVIDER)
    if (profile === undefined) {
      throw new LlmError(
        `llm-deepseek: no profile for provider route "${PROVIDER}"`,
        'MISSING_CREDENTIAL',
      )
    }
    return profile
  }

  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
      }
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new DeepSeekAdapter({ options, resolveApiKey, resolveUserId })

  // The route is configurable from the moment the plugin mounts — dormant or
  // not — so configuration surfaces can offer it before any profile exists.
  ctx.llm.registerConfigurableProviders([DIRECTORY_ENTRY])

  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero profiles) is the dormant posture: nothing registers until a
  // settings section supplies a profile, and the route drops when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies a
      // profile, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // A refused swap keeps the previous routes serving and `registeredFacts`
      // stays put, so returning to a working configuration re-applies.
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('llm-deepseek: keeping the previously registered routes after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}
