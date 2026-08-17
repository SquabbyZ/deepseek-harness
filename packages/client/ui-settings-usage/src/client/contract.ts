/**
 * The wire contract of the usage-statistics settings section: the RPC method
 * name and the zod schemas that bound its request payload and response value.
 * The host api-proxy wires `usage.query` against `ctx.usageStats.query`
 * (`@deepseek-ai/dsh-usage-stats`); the schemas here are the single source for
 * the client's types and the shape the host `api/usage.schema.ts` mirrors, so
 * the two planes cannot drift.
 * @module @deepseek-ai/dsh-client-ui-settings-usage/src/client/contract
 */

import { z } from 'zod'

/** RPC method name (POST `/api/usage.query`). */
export const USAGE_QUERY_METHOD = 'usage.query'

/** Series bucket granularity: second-based roll-ups or the per-date table. */
export const usageGranularitySchema = z.enum(['5s', '10s', '30s', '60s', 'day'] as const)

/** One provider/model route filter entry (an exact pair). */
export const usageFilterSchema = z.object({
  provider: z.string(),
  model: z.string(),
})

/** `usage.query` request payload: an inclusive `from`/exclusive `to` window plus a granularity and an optional provider/model filter. */
export const usageQueryRequestSchema = z.object({
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
  granularity: usageGranularitySchema.optional(),
  filter: z.array(usageFilterSchema).optional(),
})

/** Range-scoped totals with the derived cache-hit rate (null when no input billed). */
export const usageTotalsSchema = z.object({
  consumption: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  cacheHitRate: z.number().int().nonnegative().nullable(),
})

/** One token-trend point. */
export const usageSeriesPointSchema = z.object({
  at: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
})

/** One per-date aggregate row. */
export const usageDateRowSchema = z.object({
  date: z.string(),
  tokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
})

/** One provider with its distinct models (the filter dropdown's source). */
export const usageProviderRowSchema = z.object({
  provider: z.string(),
  models: z.array(z.string()),
})

/** `usage.query` response value. */
export const usageStatsResultSchema = z.object({
  totals: usageTotalsSchema,
  series: z.array(usageSeriesPointSchema),
  byDate: z.array(usageDateRowSchema),
  providers: z.array(usageProviderRowSchema),
})

export type UsageGranularity = z.infer<typeof usageGranularitySchema>
export type UsageFilter = z.infer<typeof usageFilterSchema>
export type UsageProviderRow = z.infer<typeof usageProviderRowSchema>
export type UsageQueryOptions = z.infer<typeof usageQueryRequestSchema>
export type UsageTotals = z.infer<typeof usageTotalsSchema>
export type UsageSeriesPoint = z.infer<typeof usageSeriesPointSchema>
export type UsageDateRow = z.infer<typeof usageDateRowSchema>
export type UsageStatsResult = z.infer<typeof usageStatsResultSchema>
