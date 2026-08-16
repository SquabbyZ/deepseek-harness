/**
 * Pure client-safe vocabulary of the usage-stats collector and its query
 * result. The four provider usage buckets are disjoint (reasoning output is
 * already inside `output`); `requests` counts finalized assistant messages
 * that reported usage. All fields are whole token counts, so the result is
 * lossless JSON and the client renders it without further accounting.
 * @module @deepseek-ai/dsh-usage-stats/src/types
 */

/** One usage bucket: the four disjoint provider buckets plus a request count. */
export interface UsageBucket {
  /** Uncached prompt input tokens. */
  input: number
  /** Response output tokens (reasoning already included). */
  output: number
  /** Prompt tokens served from cache. */
  cacheRead: number
  /** Prompt tokens written to cache. */
  cacheWrite: number
  /** Finalized requests that reported usage. */
  requests: number
}

/** Range-scoped totals with the derived cache-hit rate. */
export interface UsageTotals {
  /** Real consumption: input + cacheRead + cacheWrite + output. */
  consumption: number
  /** Finalized requests in the window. */
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /**
   * Rounded integer percent of billed prompt input served from cache
   * (`cacheRead / (input + cacheRead)`), or null when no input was billed.
   */
  cacheHitRate: number | null
}

/** One token-trend point: wall-clock `at` (epoch ms) and the window's token count. */
export interface UsageSeriesPoint {
  /** Start of the bucket, epoch milliseconds. */
  at: number
  /** Real consumption (`input + cacheRead + cacheWrite + output`) in the bucket. */
  tokens: number
}

/** One per-date aggregate row (`date` is a UTC `YYYY-MM-DD`). */
export interface UsageDateRow {
  /** UTC calendar date. */
  date: string
  /** Real consumption for the day. */
  tokens: number
  /** Finalized requests for the day. */
  requests: number
}

/** The stable JSON result of {@link UsageStats.query}. */
export interface UsageStatsResult {
  totals: UsageTotals
  series: UsageSeriesPoint[]
  byDate: UsageDateRow[]
}

/**
 * Series bucket granularity. The four second-based values roll the
 * second-granularity wall-clock series up; `day` serves the per-date table
 * directly (one point per UTC day).
 */
export type UsageGranularity = '5s' | '10s' | '30s' | '60s' | 'day'

/** Query inputs: an inclusive `from` / exclusive `to` window plus a series granularity. */
export interface UsageQueryOptions {
  /** Inclusive lower bound, epoch milliseconds; absent means all time. */
  from?: number
  /** Exclusive upper bound, epoch milliseconds; absent means now. */
  to?: number
  /** Series bucket size; absent means `60s`. */
  granularity?: UsageGranularity
}
