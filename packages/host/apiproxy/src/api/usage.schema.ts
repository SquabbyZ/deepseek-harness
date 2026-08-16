/**
 * usage domain zod schemas. The read-only usage query mirrors the client
 * contract (`@deepseek-ai/dsh-client-ui-settings-usage`) so the two planes
 * cannot drift.
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { RequestPayload, ResponseValue } from './index.ts'

/** usage.query request payload. */
export const usageQueryRequestSchema = z.object({
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
  granularity: z.enum(['5s', '10s', '30s', '60s', 'day']).optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'usage.query'>>>

/** usage.query response value. */
export const usageQueryValueSchema = z.object({
  totals: z.object({
    consumption: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
    cacheHitRate: z.number().int().nonnegative().nullable(),
  }),
  series: z.array(z.object({
    at: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
  })),
  byDate: z.array(z.object({
    date: z.string(),
    tokens: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
  })),
}) as unknown as z.ZodType<Wire<ResponseValue<'usage.query'>>>
