/**
 * Usage statistics settings section: token-consumption stat tiles, a recharts
 * area chart of the token trend, and three query-time controls — a
 * provider/model multi-select filter, a refresh interval (select + manual
 * refresh button), and a date-range picker with presets. The section polls the
 * host `usage.query` RPC through its controller — the host is the single fact
 * source and every figure is range-scoped to the selected window. One signature
 * element: the consumption hero tile leads the section in brand blue; every
 * other surface stays quiet so the trend reads first.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Calendar, Checkbox, IconChevronDownOutline14, IconRefreshOutline14, Popover,
  PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger,
  SelectValue, ShadcnButton, cn, enUS, zhCN,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleId } from '@deepseek-ai/dsh-client-locale/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { presetWindow, queryOptionsFor, UsageStatsController } from './controller.ts'
import type { UsagePresetKey, UsageStatsState, UsageWindow } from './controller.ts'
import type { UsageFilter } from './contract.ts'
import type { en } from './locales.ts'

const DAY_MS = 86_400_000

const SECTION = 'flex flex-col gap-5 w-full text-foreground'
const TITLE = 'm-0 text-base leading-6 font-medium text-foreground'
const INTRO = 'm-0 text-sm leading-[22px] text-[var(--dsw-alias-label-tertiary)]'
const CONTROLS = 'flex flex-wrap items-end gap-4'
const CONTROL_GROUP = 'flex flex-col gap-1.5'
const CONTROL_LABEL = 'text-xs leading-[18px] font-medium text-[var(--dsw-alias-label-secondary)]'
/** Shared trigger pill for the two popover controls (provider/model + date range). */
const TRIGGER = 'flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm leading-6 text-foreground shadow-sm hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
/** Portaled popover above the settings sheet overlay (z-[1000]). */
const POPOVER_CONTENT = 'z-[1100] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none'
const FILTER_GROUP_LABEL = 'px-2.5 pb-1 pt-2 text-xs leading-[18px] font-medium text-[var(--dsw-alias-label-tertiary)]'
const FILTER_ITEM = 'flex items-center gap-2 px-2.5 py-1.5 text-sm leading-6 text-foreground cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)]'
const PRESET_BUTTON = 'inline-flex h-7 items-center rounded-md px-2.5 text-xs leading-[18px] font-normal border-none cursor-pointer'
const PRESET_BUTTON_ACTIVE = 'bg-[var(--dsw-alias-label-primary)] text-[var(--dsw-alias-label-primary-inverted)]'
const PRESET_BUTTON_IDLE = 'bg-transparent text-[var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)]'
const HERO_TILE = 'relative overflow-hidden flex flex-col gap-2 rounded-xl border border-border bg-[var(--dsw-alias-bg-module-platform)] px-4 py-4'
const TILES_GRID = 'grid grid-cols-2 gap-3 md:grid-cols-5'
const TILE = 'flex flex-col gap-1.5 rounded-xl border border-border bg-[var(--dsw-alias-bg-module-platform)] px-4 py-3'
const TILE_LABEL = 'text-xs leading-[18px] text-[var(--dsw-alias-label-secondary)]'
const TILE_VALUE = 'font-mono text-xl leading-7 font-medium tabular-nums text-foreground'
const HERO_VALUE = 'font-mono text-3xl leading-10 font-medium tabular-nums text-[var(--dsw-alias-brand-primary-new-colorprimary-new-color)]'
const CHART_BOX = 'h-[220px] w-full rounded-xl border border-border bg-[var(--dsw-alias-bg-module-platform)]'
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
  /** Active locale id (for the calendar's month/day labels). */
  getLocale: () => LocaleId
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

/** One stat tile; the hero variant leads the section. */
function StatTile({ label, value, hero }: { label: string; value: string; hero?: boolean }): ReactNode {
  return (
    <div className={hero === true ? HERO_TILE : TILE}>
      <span className={TILE_LABEL}>{label}</span>
      <span className={hero === true ? HERO_VALUE : TILE_VALUE}>{value}</span>
    </div>
  )
}

/** The chart series plus the span its X axis must format. */
interface ChartView {
  series: { at: number; tokens: number }[]
  spanMs: number
}

/** The preset keys the date-range picker offers as quick chips. */
const PRESET_KEYS = ['today', '7d', '30d', 'all'] as const

/** The locale key of a preset chip. */
function presetLabelKey(key: (typeof PRESET_KEYS)[number]): keyof typeof en {
  switch (key) {
    case 'today': return 'rangeToday'
    case '7d': return 'range7d'
    case '30d': return 'range30d'
    case 'all': return 'rangeAll'
  }
}

/**
 * Render the Usage section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { controller, useSnapshot, t, getLocale } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined || getLocale === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t, getLocale }} />
}

function Loaded({ injected }: { injected: UsageSectionInjected }): ReactNode {
  const { controller, useSnapshot, t, getLocale } = injected
  const locale = getLocale()
  const state = useSnapshot(snapshot => snapshot)
  const [preset, setPreset] = useState<UsagePresetKey>('today')
  const [custom, setCustom] = useState<{ from: number; to: number } | null>(null)
  const [filter, setFilter] = useState<UsageFilter[]>([])
  const [intervalMs, setIntervalMs] = useState(30_000)
  const gradientId = useId().replace(/:/g, '')
  const chartBoxRef = useRef<HTMLDivElement>(null)
  const [chartBox, setChartBox] = useState({ width: 0, height: 0 })

  // The query window: presets set a `from` with `to` left to "now"; a picked
  // custom range pins both bounds; the provider/model filter rides alongside.
  const window: UsageWindow = useMemo(() => {
    const base = preset === 'custom' && custom !== null
      ? { from: custom.from, to: custom.to }
      : presetWindow(preset === 'custom' ? 'all' : preset, Date.now())
    return filter.length > 0 ? { ...base, filter } : base
  }, [preset, custom, filter])

  useEffect(() => {
    controller.start(window, intervalMs)
    return () => { controller.stop() }
  }, [controller, window, intervalMs])

  // Measure the chart box so recharts gets explicit dimensions (its own
  // responsive container measures 0 inside the portaled settings sheet).
  useEffect(() => {
    const el = chartBoxRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      setChartBox((current) => {
        const next = { width: el.clientWidth, height: el.clientHeight }
        return current.width === next.width && current.height === next.height ? current : next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

  const totals = state.result.totals
  const providers = state.result.providers
  const chart: ChartView = {
    series: state.result.series,
    spanMs: state.result.series.length > 1
      ? (state.result.series.at(-1)?.at ?? 0) - (state.result.series[0]?.at ?? 0)
      : 0,
  }

  const onInterval = (value: string): void => {
    if (value === '') return
    setIntervalMs(Number(value))
  }
  const refreshNow = (): void => { void controller.refresh(queryOptionsFor(window, Date.now())) }
  const selectPreset = (key: (typeof PRESET_KEYS)[number]): void => {
    setPreset(key)
    setCustom(null)
  }
  const isSelected = (pair: UsageFilter): boolean =>
    filter.some(f => f.provider === pair.provider && f.model === pair.model)
  const togglePair = (pair: UsageFilter, checked: boolean | 'indeterminate'): void => {
    setFilter(prev => checked === true
      ? [...prev, pair]
      : prev.filter(f => !(f.provider === pair.provider && f.model === pair.model)))
  }
  const handleRange = (range: { from: Date | undefined; to?: Date | undefined } | undefined): void => {
    if (range?.from !== undefined && range.to !== undefined) {
      setPreset('custom')
      setCustom({ from: range.from.getTime(), to: range.to.getTime() })
    }
  }
  const retry = (): void => { void controller.refresh(queryOptionsFor(window, Date.now())) }

  // The calendar's selection mirrors the current window (preset bounds or custom).
  const rangeSelected = useMemo(() => {
    if (preset === 'custom' && custom !== null) {
      return { from: new Date(custom.from), to: new Date(custom.to) }
    }
    const w = presetWindow(preset === 'custom' ? 'all' : preset, Date.now())
    return w.from !== undefined ? { from: new Date(w.from), to: new Date() } : undefined
  }, [preset, custom])

  const rangeTriggerLabel = preset === 'custom' && custom !== null
    ? `${dateOf(custom.from)} ~ ${dateOf(custom.to)}`
    : t(presetLabelKey(preset === 'custom' ? 'all' : preset))

  return (
    <div className={SECTION}>
      <h2 className={TITLE}>{t('title')}</h2>
      <p className={INTRO}>{t('intro')}</p>

      <div className={CONTROLS}>
        {/* Provider / model filter (all + multi-select). */}
        <div className={CONTROL_GROUP}>
          <span className={CONTROL_LABEL}>{t('providerModelLabel')}</span>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={TRIGGER}>
                <span className="min-w-0 truncate">
                  {filter.length === 0 ? t('providerModelAll') : `${t('providerModelAll')} · ${filter.length}`}
                </span>
                <IconChevronDownOutline14 className="flex-none size-3.5 opacity-50" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className={cn(POPOVER_CONTENT, 'min-w-[240px]')}>
              <div className="max-h-72 overflow-y-auto p-1">
                <label className={FILTER_ITEM}>
                  <Checkbox checked={filter.length === 0} onCheckedChange={() => setFilter([])} />
                  <span className="min-w-0 truncate">{t('providerModelAll')}</span>
                </label>
                {providers.map(row => (
                  <div key={row.provider}>
                    <div className={FILTER_GROUP_LABEL}>{row.provider}</div>
                    {row.models.map((model) => {
                      const pair = { provider: row.provider, model }
                      return (
                        <label key={model} className={FILTER_ITEM}>
                          <Checkbox checked={isSelected(pair)} onCheckedChange={checked => togglePair(pair, checked)} />
                          <span className="min-w-0 truncate">{model}</span>
                        </label>
                      )
                    })}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Refresh interval (select) + manual refresh button. */}
        <div className={CONTROL_GROUP}>
          <span className={CONTROL_LABEL}>{t('intervalLabel')}</span>
          <div className="flex items-center gap-2">
            <Select value={String(intervalMs)} onValueChange={onInterval}>
              <SelectTrigger className="h-8 w-[92px]" aria-label={t('intervalLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5000">{t('interval5s')}</SelectItem>
                <SelectItem value="10000">{t('interval10s')}</SelectItem>
                <SelectItem value="30000">{t('interval30s')}</SelectItem>
                <SelectItem value="60000">{t('interval60s')}</SelectItem>
              </SelectContent>
            </Select>
            <ShadcnButton variant="outline" size="sm" className="h-8 gap-1.5" onClick={refreshNow}>
              <IconRefreshOutline14 className="size-3.5" aria-hidden />
              {t('refreshButton')}
            </ShadcnButton>
          </div>
        </div>

        {/* Date range picker (presets + calendar). */}
        <div className={CONTROL_GROUP}>
          <span className={CONTROL_LABEL}>{t('rangeLabel')}</span>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={TRIGGER}>
                <span className="min-w-0 truncate">{rangeTriggerLabel}</span>
                <IconChevronDownOutline14 className="flex-none size-3.5 opacity-50" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className={POPOVER_CONTENT}>
              <div className="p-1">
                <div className="flex flex-wrap gap-1 px-1 pb-2 pt-1">
                  {PRESET_KEYS.map(key => (
                    <button
                      key={key}
                      type="button"
                      className={cn(PRESET_BUTTON, preset === key ? PRESET_BUTTON_ACTIVE : PRESET_BUTTON_IDLE)}
                      onClick={() => selectPreset(key)}
                    >
                      {t(presetLabelKey(key))}
                    </button>
                  ))}
                </div>
                <Calendar
                  mode="range"
                  selected={rangeSelected}
                  onSelect={handleRange}
                  defaultMonth={rangeSelected?.from ?? new Date()}
                  numberOfMonths={1}
                  locale={locale === 'zh' ? zhCN : enUS}
                />
              </div>
            </PopoverContent>
          </Popover>
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

      <div ref={chartBoxRef} className={CHART_BOX} style={{ height: 220 }}>
        {chartBox.width > 0 && chartBox.height > 0 && (
          <AreaChart width={chartBox.width} height={chartBox.height} data={chart.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-tokens)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--color-tokens)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="at"
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
            <Tooltip
              labelFormatter={value => tooltipLabel(Number(value), chart.spanMs)}
              formatter={value => [formatTokens(Number(value)), t('seriesTokens')]}
            />
            <Area
              dataKey="tokens"
              type="monotone"
              stroke="var(--dsw-alias-brand-primary-new-colorprimary-new-color)"
              fill={`url(#${gradientId})`}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </div>

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
