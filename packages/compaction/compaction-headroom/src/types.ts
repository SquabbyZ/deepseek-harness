import type { CallId } from '@deepseek-ai/dsh-llm'

/** Semantic tool-result compression policy driven through the Headroom proxy. */
export interface HeadroomCompressConfig {
  /** Enable semantic compression; defaults to `false` so a bare composition stays model-free. */
  enabled?: boolean
  /** Compress when combined text exceeds this many Unicode code points. Defaults to `8192`. */
  thresholdChars?: number
  /** Headroom token-counting model; empty inherits the session's routed model. */
  model?: string
  /** Headroom proxy base URL; empty inherits the `HEADROOM_BASE_URL` environment variable. */
  baseUrl?: string
  /** Optional proxy API key; empty inherits the `HEADROOM_API_KEY` environment variable. */
  apiKey?: string
  /** Proxy request timeout in milliseconds. Defaults to `30000`. */
  timeout?: number
  /** Return uncompressed content when the proxy is unreachable. Defaults to `true`. */
  fallback?: boolean
  /** Compress to fit this token budget; omitted lets the proxy choose. */
  tokenBudget?: number
}

/** Validated, detached, deeply immutable compression configuration. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly thresholdChars: number
  readonly model: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly timeout: number
  readonly fallback: boolean
  readonly tokenBudget?: number
}

/** Cited source event and size accounting for one landed surface replacement. */
export interface CompressedEntry {
  /** Full-fidelity tool-result event shadowed by the replacement. */
  readonly originalSeq: number
  /** Newly appended compressed tool-result event. */
  readonly replacementSeq: number
  /** Tool call shared by the original and replacement. */
  readonly callId: CallId
  /** Original text size in Unicode code points. */
  readonly charsBefore: number
  /** Replacement text size in Unicode code points. */
  readonly charsAfter: number
}

/** Aggregate outcome of one stable-surface compression pass. */
export interface CompressResult {
  /** Replacements in the snapshotted surface order. */
  readonly compressed: readonly CompressedEntry[]
  /** Total Unicode code points removed across replacements. */
  readonly charsRemoved: number
}
