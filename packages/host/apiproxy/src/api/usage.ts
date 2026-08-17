/**
 * usage domain contract: the read-only usage-statistics query. The types are
 * structurally identical to the host collector's client-safe vocabulary
 * (`@deepseek-ai/dsh-usage-stats`) so the wire stays browser-importable while
 * the host `ctx.usageStats.query` result is directly assignable.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Series bucket granularity: second-based roll-ups or the per-date table. */
export type UsageGranularity = '5s' | '10s' | '30s' | '60s' | 'day'

/** Query inputs: an inclusive `from` / exclusive `to` window plus a series granularity. */
export interface UsageQueryOptions {
  /** Inclusive lower bound, epoch milliseconds; absent means all time. */
  from?: number
  /** Exclusive upper bound, epoch milliseconds; absent means now. */
  to?: number
  /** Series bucket size; absent means `60s`. */
  granularity?: UsageGranularity
  /** Exact `(provider, model)` pairs to keep; absent or empty means every provider/model. */
  filter?: Array<{ provider: string; model: string }>
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
  /** Rounded integer percent of billed prompt input served from cache, or null when no input was billed. */
  cacheHitRate: number | null
}

/** One token-trend point. */
export interface UsageSeriesPoint {
  /** Start of the bucket, epoch milliseconds. */
  at: number
  /** Real consumption in the bucket. */
  tokens: number
}

/** One per-date aggregate row (`date` is a UTC `YYYY-MM-DD`). */
export interface UsageDateRow {
  date: string
  tokens: number
  requests: number
}

/** One distinct provider and the models seen under it, for the filter dropdown. */
export interface UsageProviderRow {
  provider: string
  models: string[]
}

/** The stable JSON result of the usage query. */
export interface UsageStatsResult {
  totals: UsageTotals
  series: UsageSeriesPoint[]
  byDate: UsageDateRow[]
  providers: UsageProviderRow[]
}

/** Usage-domain read-only query. */
export interface UsageApi {
  query(request: RpcRequest<UsageQueryOptions>): Promise<RpcResponse<UsageStatsResult>>
}
