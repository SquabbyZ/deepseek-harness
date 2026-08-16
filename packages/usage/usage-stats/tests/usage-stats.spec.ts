/**
 * UsageStats behavior: the live fold (chunk-then-message replacement, per-step
 * request counting, wall-clock second/date attribution), the query roll-up
 * (series granularity, day mode, range-scoped totals, cache-hit rate), and the
 * durable write-through + cold-start seed over a shared memory medium.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import UsageStats from '../src/index.ts'

const contexts: Context[] = []

async function harness(pool = new MemoryMediaPool()): Promise<{ ctx: Context; pool: MemoryMediaPool }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionStore)
  await ctx.plugin(UsageStats)
  return { ctx, pool }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Wait until queued fire-and-forget durable writes drain. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const startStep = (session: Session, turn: number, step: number): void => {
  session.append('step/start', { turn, step })
}

/** Append one usage chunk and return its seq (the message's sourceEventSeqs). */
function usageChunk(session: Session, usage: TokenUsage, turn: number, step: number): number {
  return session.append('assistant/chunk', { turn, step, chunk: { type: 'usage', usage } }).seq
}

/** Append the finalized assistant message carrying the step's final usage. */
function finalUsage(
  session: Session,
  usage: TokenUsage,
  turn: number,
  step: number,
  sourceSeqs: number[],
): void {
  session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
    usage,
  }, { surfaceOp: 'append', sourceEventSeqs: sourceSeqs })
}

describe('UsageStats fold', () => {
  it('serves zero totals and empty series for an empty history', async () => {
    const { ctx } = await harness()
    expect(ctx.usageStats.query()).toEqual({
      totals: {
        consumption: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheHitRate: null,
      },
      series: [],
      byDate: [],
    })
  })

  it('counts a finalized message once and derives the cache-hit rate', async () => {
    vi.setSystemTime(new Date('2026-08-16T10:00:05.500Z'))
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('final'))
    startStep(session, 1, 1)
    const source = usageChunk(session, {
      inputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2,
    }, 1, 1)
    finalUsage(session, {
      inputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2,
    }, 1, 1, [source])

    expect(ctx.usageStats.query().totals).toEqual({
      consumption: 23, requests: 1, input: 10, output: 4, cacheRead: 7, cacheWrite: 2, cacheHitRate: 41,
    })
    expect(ctx.usageStats.query().byDate).toEqual([{ date: '2026-08-16', tokens: 23, requests: 1 }])
  })

  it('replaces a same-step chunk sample with the final usage instead of double counting', async () => {
    vi.setSystemTime(new Date('2026-08-16T10:00:05.500Z'))
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('replace'))
    startStep(session, 1, 1)
    const source = usageChunk(session, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }, 1, 1)
    vi.setSystemTime(new Date('2026-08-16T10:00:07.500Z'))
    finalUsage(session, {
      inputTokens: 14, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 1,
    }, 1, 1, [source])

    const result = ctx.usageStats.query()
    // Totals are the FINAL sample, not the chunk + final summed.
    expect(result.totals).toEqual({
      consumption: 28, requests: 1, input: 14, output: 5, cacheRead: 8, cacheWrite: 1,
      cacheHitRate: Math.round(8 / (14 + 8) * 100),
    })
    // The tokens moved from the chunk's second to the message's second.
    expect(result.series.map(point => point.tokens)).toEqual([28])
  })

  it('retains a usage chunk when the request produces no final assistant message', async () => {
    vi.setSystemTime(new Date('2026-08-16T10:00:05.500Z'))
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('chunk-only'))
    startStep(session, 1, 1)
    usageChunk(session, { inputTokens: 9, outputTokens: 1 }, 1, 1)

    expect(ctx.usageStats.query().totals).toEqual({
      consumption: 10, requests: 0, input: 9, output: 1, cacheRead: 0, cacheWrite: 0, cacheHitRate: 0,
    })
  })

  it('accumulates disjoint steps across seconds and counts one request per step', async () => {
    vi.setSystemTime(new Date('2026-08-16T10:00:05.500Z'))
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('two-steps'))
    startStep(session, 1, 1)
    const first = usageChunk(session, { inputTokens: 10, outputTokens: 6, cacheReadTokens: 2 }, 1, 1)
    finalUsage(session, { inputTokens: 10, outputTokens: 6, cacheReadTokens: 2 }, 1, 1, [first])
    startStep(session, 1, 2)
    vi.setSystemTime(new Date('2026-08-16T10:00:30.500Z'))
    const second = usageChunk(session, { inputTokens: 20, outputTokens: 9, cacheWriteTokens: 4 }, 1, 2)
    finalUsage(session, { inputTokens: 20, outputTokens: 9, cacheWriteTokens: 4 }, 1, 2, [second])

    const result = ctx.usageStats.query({ granularity: '5s' })
    expect(result.totals).toEqual({
      consumption: 51, requests: 2, input: 30, output: 15, cacheRead: 2, cacheWrite: 4,
      cacheHitRate: Math.round(2 / (30 + 2) * 100),
    })
    expect(result.series.map(point => point.tokens).sort()).toEqual([18, 33])
  })
})

describe('UsageStats query', () => {
  it('rolls second buckets up to the requested granularity', async () => {
    vi.setSystemTime(new Date('2026-08-16T10:00:05.500Z'))
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('rollup'))
    startStep(session, 1, 1)
    const first = usageChunk(session, { inputTokens: 5, outputTokens: 0 }, 1, 1)
    finalUsage(session, { inputTokens: 5, outputTokens: 0 }, 1, 1, [first])
    startStep(session, 1, 2)
    vi.setSystemTime(new Date('2026-08-16T10:00:20.500Z'))
    const second = usageChunk(session, { inputTokens: 7, outputTokens: 0 }, 1, 2)
    finalUsage(session, { inputTokens: 7, outputTokens: 0 }, 1, 2, [second])

    // Both seconds fall in the same 30s bucket: one point; 5s keeps them apart.
    expect(ctx.usageStats.query({ granularity: '30s' }).series).toHaveLength(1)
    expect(ctx.usageStats.query({ granularity: '5s' }).series).toHaveLength(2)
    expect(ctx.usageStats.query({ granularity: 'day' }).series).toEqual([
      { at: Date.parse('2026-08-16T00:00:00.000Z'), tokens: 12 },
    ])
  })

  it('scopes totals and series to the window and serves the all-time fast path', async () => {
    vi.setSystemTime(new Date('2026-08-16T10:00:05.500Z'))
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('window'))
    startStep(session, 1, 1)
    const first = usageChunk(session, { inputTokens: 5, outputTokens: 1 }, 1, 1)
    finalUsage(session, { inputTokens: 5, outputTokens: 1 }, 1, 1, [first])

    const after = Date.parse('2026-08-16T10:01:00.000Z')
    expect(ctx.usageStats.query({ from: after }).totals.requests).toBe(0)
    expect(ctx.usageStats.query({ from: after }).series).toHaveLength(0)
    // The from-absent query reads the durable all-time counter.
    expect(ctx.usageStats.query().totals.consumption).toBe(6)
  })

  it('persists to the domain and seeds a cold start from the stored medium', async () => {
    vi.setSystemTime(new Date('2026-08-16T10:00:05.500Z'))
    const pool = new MemoryMediaPool()
    const firstHarness = await harness(pool)
    const session = firstHarness.ctx.sessions.create(SessionId('persist'))
    startStep(session, 1, 1)
    const source = usageChunk(session, {
      inputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2,
    }, 1, 1)
    finalUsage(session, {
      inputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2,
    }, 1, 1, [source])
    await settle()
    await firstHarness.ctx.fiber.dispose()

    // A second harness over the same medium restores the fold without replaying logs.
    const secondHarness = await harness(pool)
    expect(secondHarness.ctx.usageStats.query().totals).toEqual({
      consumption: 23, requests: 1, input: 10, output: 4, cacheRead: 7, cacheWrite: 2, cacheHitRate: 41,
    })
    expect(secondHarness.ctx.usageStats.query().byDate).toEqual([{ date: '2026-08-16', tokens: 23, requests: 1 }])
  })
})
