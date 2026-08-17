/**
 * Token-usage time-series collector (`ctx.usageStats`): folds the same
 * `assistant/chunk` + `assistant/message` usage events the token meter reads
 * into a second-granularity wall-clock series and a per-UTC-date aggregate,
 * persisted to a storage-domain table. The fold mirrors the token meter's
 * replacement accounting — a finalized message replaces the same turn/step's
 * earlier chunk sample rather than double counting it — attributed to the
 * event's wall-clock `time`. Query results are read synchronously from the
 * in-memory accumulator (seeded from the domain on cold start), so a stats
 * page polls without loading session logs.
 * @module @deepseek-ai/dsh-usage-stats
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { usageStatsDomainSpec, zeroBucket } from './spec.ts'
import type {
  UsageBucket,
  UsageDateRow,
  UsageGranularity,
  UsageProviderRow,
  UsageQueryOptions,
  UsageSeriesPoint,
  UsageStatsResult,
  UsageTotals,
} from './types.ts'

export { usageBucketSchema, usageStatsDomainSpec, zeroBucket } from './spec.ts'
export type {
  UsageBucket, UsageDateRow, UsageGranularity, UsageProviderRow, UsageQueryOptions,
  UsageSeriesPoint, UsageStatsResult, UsageTotals,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageStats: UsageStats
  }
}

/** The wall-clock seconds of each second-based granularity bucket. */
const GRANULARITY_SECONDS: Record<Exclude<UsageGranularity, 'day'>, number> = {
  '5s': 5,
  '10s': 10,
  '30s': 30,
  '60s': 60,
}

/** Milliseconds per UTC calendar day (the day-granularity bucket). */
const DAY_MS = 86_400_000

/** One per-session last sample: the bucket a turn/step is currently attributed to. */
interface LastSample {
  turn: number
  step: number
  provider: string
  model: string
  buckets: UsageBucket
  second: number
}

/** The usage a chunk or finalized message reports, with its turn/step and finality. */
interface UsageSample {
  turn: number
  step: number
  buckets: UsageBucket
  final: boolean
}

/** Fold the four disjoint provider buckets, ignoring reasoning (already in output). */
function bucketsFrom(usage: TokenUsage): UsageBucket {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    requests: 0,
  }
}

/** The usage a usage-bearing event reports, or undefined for every other event. */
function usageSampleOf(event: SessionEvent): UsageSample | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    const { turn, step } = event.data
    return { turn, step, buckets: bucketsFrom(event.data.chunk.usage), final: false }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    const { turn, step } = event.data
    return { turn, step, buckets: bucketsFrom(event.data.usage), final: true }
  }
  return undefined
}

/** Whether two bucket samples carry the identical token accounting. */
function bucketsEqual(left: UsageBucket, right: UsageBucket): boolean {
  return left.input === right.input
    && left.output === right.output
    && left.cacheRead === right.cacheRead
    && left.cacheWrite === right.cacheWrite
}

/** Add two buckets field-wise. */
function addBuckets(left: UsageBucket, right: UsageBucket): UsageBucket {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    requests: left.requests + right.requests,
  }
}

/** Negate a sample's token buckets (a replacement's subtraction delta; requests stay 0). */
function negateBuckets(bucket: UsageBucket): UsageBucket {
  return {
    input: -bucket.input,
    output: -bucket.output,
    cacheRead: -bucket.cacheRead,
    cacheWrite: -bucket.cacheWrite,
    requests: 0,
  }
}

/**
 * Clamp every field to a non-negative integer. A provider that under-reports
 * its final usage (smaller than its own streamed chunk) could otherwise push
 * the cumulative counter negative; the durable schema is non-negative, so the
 * pathological decrease is clamped to zero rather than poisoning the medium.
 */
function clampBucket(bucket: UsageBucket): UsageBucket {
  return {
    input: Math.max(0, bucket.input),
    output: Math.max(0, bucket.output),
    cacheRead: Math.max(0, bucket.cacheRead),
    cacheWrite: Math.max(0, bucket.cacheWrite),
    requests: Math.max(0, bucket.requests),
  }
}

/** Whether a bucket carries no activity (the fold drops such rows to stay sparse). */
function isZeroBucket(bucket: UsageBucket): boolean {
  return bucket.input === 0
    && bucket.output === 0
    && bucket.cacheRead === 0
    && bucket.cacheWrite === 0
    && bucket.requests === 0
}

/** Real consumption: input + cacheRead + cacheWrite + output. */
function tokensOf(bucket: UsageBucket): number {
  return bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output
}

/** Derive the range-scoped totals view (consumption + cache-hit rate) from a bucket sum. */
function finishTotals(bucket: UsageBucket): UsageTotals {
  const billed = bucket.input + bucket.cacheRead
  return {
    consumption: tokensOf(bucket),
    requests: bucket.requests,
    input: bucket.input,
    output: bucket.output,
    cacheRead: bucket.cacheRead,
    cacheWrite: bucket.cacheWrite,
    cacheHitRate: billed === 0 ? null : Math.round(bucket.cacheRead / billed * 100),
  }
}

/** The UTC `YYYY-MM-DD` of an epoch second. */
function utcDateOf(second: number): string {
  return new Date(second * 1_000).toISOString().slice(0, 10)
}

/** The epoch-millisecond start of a UTC `YYYY-MM-DD` date string. */
function dayStartMsOf(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

/** Encode a composite `seconds` key: `[provider, model, epochSecond]` as JSON — the
 *  array shape cannot collide with any provider/model string, so it is separator-proof. */
function secondsKey(provider: string, model: string, second: number): string {
  return JSON.stringify([provider, model, second])
}

/** Encode a composite `days` key: `[provider, model, utcDate]` as JSON. */
function daysKey(provider: string, model: string, date: string): string {
  return JSON.stringify([provider, model, date])
}

/** The `(provider, model)` pair identity, used to match a filter entry. */
function routeKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

/** Parse a composite table key back into `[provider, model, slot]` (`slot`: second or date). */
function decodeKey(key: string): [string, string, string | number] {
  return JSON.parse(key) as [string, string, string | number]
}

/**
 * Host-side token-usage time-series collector. Opens the `usage_stats` domain
 * at init, seeds its in-memory accumulator from the stored medium, folds live
 * usage events into it (synchronously, so queries never lag a landed event),
 * and writes each fold through to the domain fail-soft — a lost write costs a
 * shorter history after restart, never a wrong value for a live read.
 */
export class UsageStats extends Service {
  static inject = ['storageDomain']

  private secondsTable?: KvTable<string, UsageBucket>
  private daysTable?: KvTable<string, UsageBucket>
  private totalsGlobal?: DomainGlobal<UsageBucket>

  /** In-memory accumulator (authoritative live state; the domain is the durable copy). */
  private readonly seconds = new Map<string, UsageBucket>()
  private readonly days = new Map<string, UsageBucket>()
  private totals: UsageBucket = zeroBucket()

  /** Per-session last sample, so a finalized message replaces its chunk instead of doubling. */
  private readonly lastBySession = new WeakMap<Session, LastSample>()

  /** Per-session current route (folded from `request/context`), so chunks carry an attribution. */
  private readonly routeBySession = new WeakMap<Session, { provider: string; model: string }>()

  constructor(ctx: Context) {
    super(ctx, 'usageStats')
  }

  /** Open the domain, seed the accumulator, and install the live fold listener. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(usageStatsDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'usageStats.domainClose')
    this.secondsTable = domain.table('seconds')
    this.daysTable = domain.table('days')
    this.totalsGlobal = domain.global
    for (const [key, bucket] of this.secondsTable.entries()) this.seconds.set(key, bucket)
    for (const [key, bucket] of this.daysTable.entries()) this.days.set(key, bucket)
    this.totals = { ...this.totalsGlobal.get() }

    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.fold(session, event)
    })
  }

  /**
   * Query the collected usage over a window. `totals` is range-scoped (the
   * whole-history cumulative counter serves the `from`-absent fast path, but
   * only when no `filter` is present — a filtered view must sum the table);
   * `series` rolls the second-granularity wall-clock series up to `granularity`
   * (or serves the per-date table at `day`); `byDate` is always the per-date
   * aggregate filtered to the window. `providers` is the full distinct
   * provider/model breakdown (never filtered, so the dropdown stays complete).
   * Synchronous from memory.
   * @param options - window bounds, series granularity, and `(provider, model)` filter.
   * @returns the stable JSON result.
   */
  query(options: UsageQueryOptions = {}): UsageStatsResult {
    const now = Date.now()
    const to = options.to ?? now
    const from = options.from ?? 0
    const granularity = options.granularity ?? '60s'
    const dayMode = granularity === 'day'
    const table = dayMode ? this.days : this.seconds
    const bucketMs = granularity === 'day' ? DAY_MS : GRANULARITY_SECONDS[granularity] * 1_000
    const allTime = from <= 0 && to >= now
    const filter = options.filter ?? []
    const filtered = filter.length > 0
    const wanted = filtered ? new Set(filter.map(({ provider, model }) => routeKey(provider, model))) : undefined

    const series = new Map<number, number>()
    let totals = zeroBucket()
    for (const [key, bucket] of table) {
      const [provider, model, slot] = decodeKey(key)
      if (wanted !== undefined && !wanted.has(routeKey(provider, model))) continue
      const at = dayMode ? dayStartMsOf(slot as string) : (slot as number) * 1_000
      if (at < from || at >= to) continue
      const pointAt = dayMode ? at : Math.floor(at / bucketMs) * bucketMs
      series.set(pointAt, (series.get(pointAt) ?? 0) + tokensOf(bucket))
      totals = addBuckets(totals, bucket)
    }

    return {
      // A whole-history query reads the durable all-time counter: O(1) for the
      // "all" view that would otherwise sum the whole second series.
      totals: finishTotals(allTime && !filtered ? this.totals : totals),
      series: [...series.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([at, tokens]): UsageSeriesPoint => ({ at, tokens })),
      byDate: this.byDateRows(from, to, wanted),
      providers: this.providerRows(),
    }
  }

  /** Fold one live event: replace-or-add its usage at its wall-clock second, attributed to a route. */
  private fold(session: Session, event: SessionEvent): void {
    // Track the current route before any chunk lands (chunks carry no provenance).
    // `request/header` fires every request (before dispatch) so it is the reliable
    // source; `request/context` only fires on route change, so a resumed session
    // with an unchanged route would otherwise fall back to an empty attribution.
    if (event.type === 'request/header') {
      this.routeBySession.set(session, { provider: event.data.header.config.provider, model: event.data.header.config.model })
      return
    }
    if (event.type === 'request/context') {
      this.routeBySession.set(session, { provider: event.data.provider, model: event.data.model })
      return
    }
    const sample = usageSampleOf(event)
    if (sample === undefined) return
    const { provider, model } = this.attributionOf(session, event)
    const second = Math.floor(event.time / 1_000)
    const last = this.lastBySession.get(session)
    const previous = last !== undefined && last.turn === sample.turn && last.step === sample.step
      ? { buckets: last.buckets, second: last.second, provider: last.provider, model: last.model }
      : undefined

    const dirtySeconds = new Set<string>()
    const dirtyDays = new Set<string>()
    // Token accounting mirrors the token meter's same-step replacement; an
    // equal sample restates it without moving the buckets.
    if (previous === undefined || !bucketsEqual(previous.buckets, sample.buckets)) {
      if (previous !== undefined) {
        this.applyDelta(
          negateBuckets(previous.buckets), previous.provider, previous.model, previous.second, dirtySeconds, dirtyDays,
        )
      }
      this.applyDelta(sample.buckets, provider, model, second, dirtySeconds, dirtyDays)
    }
    // A request is counted once per finalized message, independent of whether
    // its usage restated the chunk's (the two can land in the same second).
    if (sample.final) {
      this.applyDelta(
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 1 }, provider, model, second, dirtySeconds, dirtyDays,
      )
    }
    this.lastBySession.set(session, {
      turn: sample.turn, step: sample.step, provider, model, buckets: sample.buckets, second,
    })

    if (dirtySeconds.size === 0) return
    void this.flush(dirtySeconds, dirtyDays).catch((error: unknown) => {
      this.ctx.logger.warn(`usage stats: durable write for "${session.id}" failed (stats may lag): ${String(error)}`)
    })
  }

  /**
   * The route a usage sample is attributed to: the message's authoritative
   * provenance for a finalized message, else the session's tracked route (the
   * `request/context` fold). Falls back to an empty route only when neither is
   * known, which a model-produced message never hits.
   */
  private attributionOf(session: Session, event: SessionEvent): { provider: string; model: string } {
    if (event.type === 'assistant/message') {
      const { provider, model } = event.data.message.source
      if (provider !== undefined && model !== undefined) return { provider, model }
    }
    return this.routeBySession.get(session) ?? { provider: '', model: '' }
  }

  /** Apply one signed bucket delta to the second, day, and cumulative counters. */
  private applyDelta(
    delta: UsageBucket,
    provider: string,
    model: string,
    second: number,
    dirtySeconds: Set<string>,
    dirtyDays: Set<string>,
  ): void {
    const key = secondsKey(provider, model, second)
    const nextSecond = clampBucket(addBuckets(this.seconds.get(key) ?? zeroBucket(), delta))
    if (isZeroBucket(nextSecond)) this.seconds.delete(key)
    else this.seconds.set(key, nextSecond)
    dirtySeconds.add(key)

    const date = utcDateOf(second)
    const dayKey = daysKey(provider, model, date)
    const nextDay = clampBucket(addBuckets(this.days.get(dayKey) ?? zeroBucket(), delta))
    if (isZeroBucket(nextDay)) this.days.delete(dayKey)
    else this.days.set(dayKey, nextDay)
    dirtyDays.add(dayKey)

    this.totals = clampBucket(addBuckets(this.totals, delta))
  }

  /** Write the touched accumulator rows through to the domain (fail-soft at the caller). */
  private async flush(dirtySeconds: Set<string>, dirtyDays: Set<string>): Promise<void> {
    const tables = this.requireTables()
    const writes: Promise<unknown>[] = []
    for (const key of dirtySeconds) {
      const bucket = this.seconds.get(key)
      writes.push(bucket === undefined ? tables.seconds.delete(key) : tables.seconds.put(key, bucket))
    }
    for (const key of dirtyDays) {
      const bucket = this.days.get(key)
      writes.push(bucket === undefined ? tables.days.delete(key) : tables.days.put(key, bucket))
    }
    writes.push(tables.totals.set(this.totals))
    await Promise.all(writes)
  }

  /** The per-date rows in the window, oldest first, summing every matching provider/model. */
  private byDateRows(from: number, to: number, wanted: Set<string> | undefined): UsageDateRow[] {
    const byDate = new Map<string, UsageBucket>()
    for (const [key, bucket] of this.days) {
      const [provider, model, date] = decodeKey(key) as [string, string, string]
      if (wanted !== undefined && !wanted.has(routeKey(provider, model))) continue
      const at = dayStartMsOf(date)
      if (at < from || at >= to) continue
      byDate.set(date, addBuckets(byDate.get(date) ?? zeroBucket(), bucket))
    }
    return [...byDate.entries()]
      .map(([date, bucket]): UsageDateRow => ({ date, tokens: tokensOf(bucket), requests: bucket.requests }))
      .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))
  }

  /** Distinct providers and their distinct models, derived from the accumulated bucket keys. */
  private providerRows(): UsageProviderRow[] {
    const modelsByProvider = new Map<string, Set<string>>()
    for (const table of [this.seconds, this.days]) {
      for (const key of table.keys()) {
        const [provider, model] = decodeKey(key)
        const models = modelsByProvider.get(provider)
        if (models === undefined) modelsByProvider.set(provider, new Set([model]))
        else models.add(model)
      }
    }
    return [...modelsByProvider.entries()]
      .map(([provider, models]): UsageProviderRow => ({ provider, models: [...models].sort() }))
      .sort((left, right) => (left.provider < right.provider ? -1 : left.provider > right.provider ? 1 : 0))
  }

  private requireTables(): {
    seconds: KvTable<string, UsageBucket>
    days: KvTable<string, UsageBucket>
    totals: DomainGlobal<UsageBucket>
  } {
    /* v8 ignore next -- Service.init opens the domain before the service becomes injectable */
    if (this.secondsTable === undefined || this.daysTable === undefined || this.totalsGlobal === undefined) {
      throw new Error('usage stats is not initialized')
    }
    return { seconds: this.secondsTable, days: this.daysTable, totals: this.totalsGlobal }
  }
}

export default UsageStats
