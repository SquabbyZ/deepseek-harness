// @vitest-environment jsdom
/**
 * The Usage section's presentation rules: the six stat tiles render from the
 * controller's result (the consumption hero reads its compact count), and the
 * three query-time controls — provider/model filter, refresh interval + button,
 * and the date-range picker — are present.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { EMPTY_USAGE_RESULT, UsageStatsController } from '../src/client/controller.ts'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageSectionProps } from '../src/client/UsageSection.tsx'
import { en } from '../src/client/locales.ts'
import type { UsageStatsResult } from '../src/client/contract.ts'

/** jsdom has no ResizeObserver; the chart's ResponsiveContainer needs one to measure. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const RESULT: UsageStatsResult = {
  totals: {
    consumption: 1_200, requests: 3, input: 900, output: 250, cacheRead: 400, cacheWrite: 50, cacheHitRate: 31,
  },
  series: [
    { at: Date.parse('2026-08-16T10:00:00.000Z'), tokens: 400 },
    { at: Date.parse('2026-08-16T10:00:05.000Z'), tokens: 800 },
  ],
  byDate: [{ date: '2026-08-16', tokens: 1_200, requests: 3 }],
  providers: [{ provider: 'deepseek-official', models: ['deepseek-v4-pro'] }],
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Render the section over a fixed result; the fake query resolves with it. */
function renderSection(result: UsageStatsResult = RESULT) {
  const controller = new UsageStatsController(vi.fn(async () => result))
  const props = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t: (key: keyof typeof en) => en[key],
    getLocale: () => 'zh',
  } as UsageSectionProps
  render(<UsageSection {...props} />)
  return controller
}

describe('the usage stat tiles', () => {
  it('renders all six tiles once the first poll resolves', async () => {
    renderSection()

    await waitFor(() => { expect(screen.getByText('1.2K')).toBeTruthy() })
    expect(screen.getByText(en.statConsumption)).toBeTruthy()
    expect(screen.getByText(en.statRequests)).toBeTruthy()
    expect(screen.getByText(en.statInput)).toBeTruthy()
    expect(screen.getByText(en.statOutput)).toBeTruthy()
    expect(screen.getByText(en.statCacheRead)).toBeTruthy()
    expect(screen.getByText(en.statCacheHitRate)).toBeTruthy()
    // The request count and cache-hit rate are raw whole values.
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('31%')).toBeTruthy()
  })

  it('shows the empty hint when the window records no usage', async () => {
    renderSection(EMPTY_USAGE_RESULT)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })
  })
})

describe('the query-time controls', () => {
  it('offers the provider/model, refresh, and date-range controls', () => {
    renderSection()

    expect(screen.getByText(en.providerModelLabel)).toBeTruthy()
    expect(screen.getByText(en.intervalLabel)).toBeTruthy()
    expect(screen.getByText(en.rangeLabel)).toBeTruthy()
    // Default filter trigger reads "All"; default date trigger reads "Today".
    expect(screen.getByText(en.providerModelAll)).toBeTruthy()
    expect(screen.getByText(en.rangeToday)).toBeTruthy()
    // Manual refresh button.
    expect(screen.getByText(en.refreshButton)).toBeTruthy()
  })
})
