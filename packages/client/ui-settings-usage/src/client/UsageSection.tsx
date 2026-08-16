/**
 * Usage statistics settings section: token-consumption stat tiles, a recharts
 * area chart of the token trend, and the two query-time controls (refresh
 * interval + date range). The section polls the host `usage.query` RPC through
 * its controller — the host is the single fact source and every figure is
 * range-scoped to the selected window. One signature element: the consumption
 * hero tile carries a faint whale watermark in brand blue; every other surface
 * stays quiet so the trend reads first.
 */

import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  Area, ChartContainer, ChartTooltip, ChartTooltipContent, FishLogo, ShadcnButton,
  ToggleGroup, ToggleGroupItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChartConfig } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { queryOptionsFor, UsageStatsController } from './controller.ts'
import type { UsageRangeKey, UsageStatsState } from './controller.ts'
import type { en } from './locales.ts'

const DAY_MS = 86_400_000

const SECTION = 'flex flex-col gap-5 max-w-[720px] text-foreground'
const TITLE = 'm-0 text-base leading-6 font-medium text-foreground'
const INTRO = 'm-0 text-sm leading-[22px] text-[var(--dsw-alias-label-tertiary)]'
const CONTROLS = 'flex flex-wrap items-end gap-4'
const CONTROL_GROUP = 'flex flex-col gap-1.5'
const CONTROL_LABEL = 'text-xs leading-[18px] font-medium text-[var(--dsw-alias-label-secondary)]'
const SEGMENT = 'rounded-lg border border-input bg-[var(--dsw-alias-bg-module-platform)] p-0.5'
const SEGMENT_ITEM = 'h-7 px-2.5 text-xs leading-[18px] font-normal text-[var(--dsw-alias-label-secondary)]'
const HERO_TILE = 'relative overflow-hidden flex flex-col gap-2 rounded-xl border border-border bg-[var(--dsw-alias-bg-module-platform)] px-4 py-4'
const TILES_GRID = 'grid grid-cols-2 gap-3 md:grid-cols-5'
const TILE = 'flex flex-col gap-1.5 rounded-xl border border-border bg-[var(--dsw-alias-bg-module-platform)] px-4 py-3'
const TILE_LABEL = 'text-xs leading-[18px] text-[var(--dsw-alias-label-secondary)]'
const TILE_VALUE = 'font-mono text-xl leading-7 font-medium tabular-nums text-foreground'
const HERO_VALUE = 'font-mono text-3xl leading-10 font-medium tabular-nums text-[var(--dsw-alias-brand-primary-new-colorprimary-new-color)]'
const HERO_WATERMARK = 'pointer-events-none absolute -bottom-4 -right-3 text-[var(--dsw-alias-brand-primary-new-colorprimary-new-color)] opacity-[0.08]'
const CHART_BOX = 'h-[220px] w-full rounded-xl border border-border bg-[var(--dsw-alias-bg-module-platform)] p-3'
const ERROR = 'error m-0 text-xs leading-[18px] text-[var(--dsw-alias-state-error-primary)]'
const EMPTY = 'm-0 text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const RETRY_BUTTON = 'inline-flex h-7 items-center justify-center gap-1 rounded-[14px] border border-border bg-transparent px-2.5 text-xs leading-[18px] font-normal text-foreground hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover-solid)] focus-visible:ring-0'

/** Injected dependencies of {@link UsageSection} (slot `inject`). */
export interface UsageSectionInjected {
  /** The polling controller (started/stopped by the section). */
  controller: UsageStatsController
  /** uSES subscription hook bound to the controller store. */
  useSnapshot: SnapshotSelectorHook<UsageStatsState>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type UsageSectionProps = Partial<UsageSectionInjected>

/** Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits). */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** Cache-hit rate with an em dash for the unbilled case. */
function formatPercent(n: number | null): string {
  return n === null ? '—' : `${n}%`
}

/** `HH:mm` of an epoch-millisecond instant (local time). */
function clockOf(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** `MM-DD` of an epoch-millisecond instant (local time). */
function dateOf(at: number): string {
  const d = new Date(at)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Axis tick label: time-of-day for sub-day spans, calendar date for longer ones. */
function tickLabel(at: number, spanMs: number): string {
  return spanMs > DAY_MS * 2 ? dateOf(at) : clockOf(at)
}

/** Tooltip label: time-of-day, with the calendar date prefixed for multi-day spans. */
function tooltipLabel(at: number, spanMs: number): string {
  return spanMs > DAY_MS * 2 ? `${dateOf(at)} ${clockOf(at)}` : clockOf(at)
}

/** One stat tile; the hero variant leads the section and carries the whale watermark. */
function StatTile({ label, value, hero }: { label: string; value: string; hero?: boolean }): ReactNode {
  return (
    <div className={hero === true ? HERO_TILE : TILE}>
      <span className={TILE_LABEL}>{label}</span>
      <span className={hero === true ? HERO_VALUE : TILE_VALUE}>{value}</span>
      {hero === true ? <FishLogo size={96} className={HERO_WATERMARK} /> : null}
    </div>
  )
}

/** The chart series plus the span its X axis must format. */
interface ChartView {
  series: { at: number; tokens: number }[]
  spanMs: number
}

/**
 * Render the Usage section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: UsageSectionInjected }): ReactNode {
  const { controller, useSnapshot, t } = injected
  const state = useSnapshot(snapshot => snapshot)
  const [range, setRange] = useState<UsageRangeKey>('today')
  const [intervalMs, setIntervalMs] = useState(30_000)
  const gradientId = useId().replace(/:/g, '')

  useEffect(() => {
    controller.start(range, intervalMs)
    return () => { controller.stop() }
  }, [controller, range, intervalMs])

  const totals = state.result.totals
  const chart: ChartView = {
    series: state.result.series,
    spanMs: state.result.series.length > 1
      ? (state.result.series.at(-1)?.at ?? 0) - (state.result.series[0]?.at ?? 0)
      : 0,
  }

  const onRange = (value: string): void => {
    if (value === '') return
    setRange(value as UsageRangeKey)
  }
  const onInterval = (value: string): void => {
    if (value === '') return
    setIntervalMs(Number(value))
  }
  const retry = (): void => { void controller.refresh(queryOptionsFor(range, Date.now())) }

  const chartConfig: ChartConfig = {
    tokens: {
      label: t('seriesTokens'),
      color: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color)',
    },
  }

  return (
    <div className={SECTION}>
      <h2 className={TITLE}>{t('title')}</h2>
      <p className={INTRO}>{t('intro')}</p>

      <div className={CONTROLS}>
        <div className={CONTROL_GROUP}>
          <span className={CONTROL_LABEL}>{t('rangeLabel')}</span>
          <ToggleGroup type="single" value={range} onValueChange={onRange} className={SEGMENT}>
            <ToggleGroupItem value="today" className={SEGMENT_ITEM}>{t('rangeToday')}</ToggleGroupItem>
            <ToggleGroupItem value="7d" className={SEGMENT_ITEM}>{t('range7d')}</ToggleGroupItem>
            <ToggleGroupItem value="30d" className={SEGMENT_ITEM}>{t('range30d')}</ToggleGroupItem>
            <ToggleGroupItem value="all" className={SEGMENT_ITEM}>{t('rangeAll')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className={CONTROL_GROUP}>
          <span className={CONTROL_LABEL}>{t('intervalLabel')}</span>
          <ToggleGroup type="single" value={String(intervalMs)} onValueChange={onInterval} className={SEGMENT}>
            <ToggleGroupItem value="5000" className={SEGMENT_ITEM}>{t('interval5s')}</ToggleGroupItem>
            <ToggleGroupItem value="10000" className={SEGMENT_ITEM}>{t('interval10s')}</ToggleGroupItem>
            <ToggleGroupItem value="30000" className={SEGMENT_ITEM}>{t('interval30s')}</ToggleGroupItem>
            <ToggleGroupItem value="60000" className={SEGMENT_ITEM}>{t('interval60s')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <StatTile hero label={t('statConsumption')} value={formatTokens(totals.consumption)} />
      <div className={TILES_GRID}>
        <StatTile label={t('statRequests')} value={String(totals.requests)} />
        <StatTile label={t('statInput')} value={formatTokens(totals.input)} />
        <StatTile label={t('statOutput')} value={formatTokens(totals.output)} />
        <StatTile label={t('statCacheRead')} value={formatTokens(totals.cacheRead)} />
        <StatTile label={t('statCacheHitRate')} value={formatPercent(totals.cacheHitRate)} />
      </div>

      <ChartContainer config={chartConfig} className={CHART_BOX}>
        <AreaChart data={chart.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-tokens)" stopOpacity={0.24} />
              <stop offset="100%" stopColor="var(--color-tokens)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="at"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={value => tickLabel(Number(value), chart.spanMs)}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={value => formatTokens(Number(value))}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <ChartTooltip
            content={<ChartTooltipContent labelFormatter={value => tooltipLabel(Number(value), chart.spanMs)} />}
          />
          <Area
            dataKey="tokens"
            type="monotone"
            stroke="var(--color-tokens)"
            fill={`url(#${gradientId})`}
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>

      {state.status === 'error'
        ? (
          <div className="flex items-center gap-3">
            <p className={ERROR}>{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
            <ShadcnButton variant="ghost" className={RETRY_BUTTON} onClick={retry}>
              {t('retry')}
            </ShadcnButton>
          </div>
        )
        : null}
      {state.status === 'ready' && state.result.byDate.length === 0
        ? <p className={EMPTY}>{t('empty')}</p>
        : null}
    </div>
  )
}
