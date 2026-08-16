/**
 * Client-side usage-stats controller: a snapshot store the section renders
 * from, plus the polling lifecycle that keeps it fresh. The host stays the
 * single fact source — the controller only maps a date-range selection onto a
 * `usage.query` window and repolls on the chosen refresh interval. The query
 * function is injected (wired to `connection.api` in `apply`), so the section
 * renders against a fake controller in tests with zero wire machinery.
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { UsageQueryOptions, UsageStatsResult } from './contract.ts'

/** One unary stats read (already unwrapped from the RPC envelope by `apply`). */
export type UsageStatsQuery = (options: UsageQueryOptions) => Promise<UsageStatsResult>

/** The date-dimension choices the section offers. */
export type UsageRangeKey = 'today' | '7d' | '30d' | 'all'

const DAY_MS = 86_400_000

/** The empty result served before the first poll lands (and on a cleared history). */
export const EMPTY_USAGE_RESULT: UsageStatsResult = {
  totals: {
    consumption: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheHitRate: null,
  },
  series: [],
  byDate: [],
}

/** Section snapshot. */
export interface UsageStatsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; the last good result stays rendered. */
  error: string | null
  /** The newest successful result. */
  result: UsageStatsResult
}

/** The wall-clock start of the local day containing `now`. */
function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Map a date-range selection onto the `usage.query` window (recomputed per poll). */
export function queryOptionsFor(range: UsageRangeKey, now: number): UsageQueryOptions {
  switch (range) {
    case 'today': return { from: startOfLocalDay(now), to: now, granularity: '5s' }
    case '7d': return { from: now - 7 * DAY_MS, to: now, granularity: '60s' }
    case '30d': return { from: now - 30 * DAY_MS, to: now, granularity: 'day' }
    case 'all': return { granularity: 'day' }
  }
}

/**
 * The usage-stats page controller (one per settings surface). Polls the query
 * on the chosen interval and publishes each result through a snapshot store;
 * a failure keeps the last good result and surfaces the error.
 */
export class UsageStatsController {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<UsageStatsState> = createSnapshotStore<UsageStatsState>({
    status: 'idle',
    error: null,
    result: EMPTY_USAGE_RESULT,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0
  private timer: ReturnType<typeof setInterval> | undefined

  /** @param query - the unwrapped `usage.query` read. */
  constructor(private readonly query: UsageStatsQuery) {}

  /**
   * Refresh the snapshot once. Failures set the error status without dropping
   * the last good result; a stale response that resolves after a newer load is
   * discarded by generation.
   * @param options - the query window.
   */
  async refresh(options: UsageQueryOptions): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const result = await this.query(options)
      if (generation !== this.generation) return
      this.store.update((s) => { s.status = 'ready'; s.result = result })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Start (or restart) polling: an immediate refresh, then one per interval.
   * @param range - the date dimension to poll.
   * @param intervalMs - the client polling cadence.
   */
  start(range: UsageRangeKey, intervalMs: number): void {
    this.stop()
    const poll = (): void => { void this.refresh(queryOptionsFor(range, Date.now())) }
    poll()
    this.timer = setInterval(poll, intervalMs)
  }

  /** Stop polling; the last snapshot stays published. */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
}
