/** Configuration resolution for semantic tool-result compression. */

import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { HeadroomCompressConfig, ResolvedConfig } from './types.ts'

/** Low-friction defaults for coding-agent tool output. */
export const DEFAULTS: ResolvedConfig = deepFreeze({
  enabled: false,
  thresholdChars: 8192,
  model: '',
  baseUrl: '',
  apiKey: '',
  timeout: 30000,
  fallback: true,
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'enabled',
  'thresholdChars',
  'model',
  'baseUrl',
  'apiKey',
  'timeout',
  'fallback',
  'tokenBudget',
])

/**
 * Count Unicode code points without splitting surrogate pairs.
 * @param text - text to measure.
 * @returns the Unicode code-point count.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Resolve and validate the compression policy.
 * @param config - raw plugin configuration.
 * @returns a detached deeply immutable configuration.
 */
export function resolveConfig(config: HeadroomCompressConfig = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `HeadroomCompressConfig: unknown key "${key}" `
        + '(allowed: enabled, thresholdChars, model, baseUrl, apiKey, timeout, fallback, tokenBudget)',
      )
    }
  }

  assertOptionalBoolean('enabled', config.enabled)
  assertOptionalString('model', config.model)
  assertOptionalString('baseUrl', config.baseUrl)
  assertOptionalString('apiKey', config.apiKey)
  assertOptionalBoolean('fallback', config.fallback)

  const resolved: ResolvedConfig = {
    enabled: config.enabled ?? DEFAULTS.enabled,
    thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
    model: config.model ?? DEFAULTS.model,
    baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
    apiKey: config.apiKey ?? DEFAULTS.apiKey,
    timeout: config.timeout ?? DEFAULTS.timeout,
    fallback: config.fallback ?? DEFAULTS.fallback,
    ...config.tokenBudget === undefined ? {} : { tokenBudget: config.tokenBudget },
  }
  assertPositiveInteger('thresholdChars', resolved.thresholdChars)
  assertPositiveInteger('timeout', resolved.timeout)
  if (resolved.tokenBudget !== undefined) assertPositiveInteger('tokenBudget', resolved.tokenBudget)
  return deepFreeze(structuredClone(resolved))
}

function assertOptionalBoolean(name: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`HeadroomCompressConfig: ${name} must be a boolean`)
  }
}

function assertOptionalString(name: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`HeadroomCompressConfig: ${name} must be a string`)
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`HeadroomCompressConfig: ${name} (${value}) must be a positive integer`)
  }
}
