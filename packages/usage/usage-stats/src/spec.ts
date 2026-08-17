/**
 * The usage-stats domain declaration: one `usage_stats` domain with a
 * cumulative `global` counter plus two tables — `seconds` (the
 * second-granularity wall-clock series) and `days` (the per-UTC-date
 * aggregate). The spec object is the single source of the domain's identity,
 * version, and record schema; the storage-domain routing decides the medium
 * (the shipped composition's json backend lands it at `<root>/usage_stats.json`,
 * beside `workspace.json`). Version bumps discard the whole medium — the
 * series is re-foldable from durable session logs, so a stale format costs a
 * rebuild, never a wrong value.
 * @module @deepseek-ai/dsh-usage-stats/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { UsageBucket } from './types.ts'

/** One usage bucket: the four disjoint token buckets plus a request count. */
export const usageBucketSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
})

/** The all-zero bucket — the global initial and the fold's additive identity. */
export const zeroBucket = (): UsageBucket => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  requests: 0,
})

/**
 * The usage-stats domain spec. The global slot holds the all-time cumulative
 * counters (the `totals` fast path for the whole-history view); `seconds` keys
 * are JSON arrays `[provider, model, epochSecond]` and `days` keys are JSON
 * arrays `[provider, model, utcDate]`, so a bucket is attributed to the route
 * that produced it. Both tables store the same {@link UsageBucket} record, so
 * the query can serve range-scoped totals from either resolution.
 */
export const usageStatsDomainSpec = defineDomain({
  name: 'usage_stats',
  version: 2,
  global: {
    schema: usageBucketSchema,
    initial: zeroBucket(),
  },
  tables: {
    seconds: domainTable<string, UsageBucket>(usageBucketSchema),
    days: domainTable<string, UsageBucket>(usageBucketSchema),
  },
})
