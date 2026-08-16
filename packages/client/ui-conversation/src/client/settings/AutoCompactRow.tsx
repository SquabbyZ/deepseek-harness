/** General Settings row for the auto-compact policy (enable + two thresholds). */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Slider, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

/** Registration-side auto-compact preference face. */
export interface AutoCompactRowInjected {
  hooks: {
    /** Persisted enable flag, shared with the composer quick toggle. */
    autoCompact: SnapshotStore<boolean>
    /** Persisted warn threshold ratio (0–1). */
    warnRatio: SnapshotStore<number>
    /** Persisted red-line threshold ratio (0–1). */
    redlineRatio: SnapshotStore<number>
  }
  setAutoCompact: (value: boolean) => void
  setWarnRatio: (value: number) => void
  setRedlineRatio: (value: number) => void
  /** Local-only preview setters keep the thumb smooth during a drag. */
  previewWarnRatio: (value: number) => void
  previewRedlineRatio: (value: number) => void
}

/** Full Settings-row props. */
export type AutoCompactRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<AutoCompactRowInjected>

/**
 * Render the auto-compact controls: a master switch and two percentage
 * sliders (warn threshold and red line). Ratios are stored as fractions in
 * the settings document; the sliders expose percentages and convert.
 * @param props - composed Settings slot props.
 * @returns the auto-compact row.
 */
export function AutoCompactRow({
  useAutoCompact, useWarnRatio, useRedlineRatio,
  setAutoCompact, setWarnRatio, setRedlineRatio, previewWarnRatio, previewRedlineRatio, t,
}: AutoCompactRowProps) {
  const auto = useAutoCompact(value => value)
  const warnRatio = useWarnRatio(value => value)
  const redlineRatio = useRedlineRatio(value => value)
  const warnPercent = Math.round(warnRatio * 100)
  const redlinePercent = Math.round(redlineRatio * 100)

  const slider = (
    value: number,
    min: number,
    max: number,
    onPreview: (ratio: number) => void,
    onCommit: (ratio: number) => void,
  ) => (
    <Slider
      value={[value]}
      min={min}
      max={max}
      step={1}
      disabled={!auto}
      onValueChange={(next) => {
        const first = next[0]
        if (first !== undefined) onPreview(first / 100)
      }}
      onValueCommit={(next) => {
        const first = next[0]
        if (first !== undefined) onCommit(first / 100)
      }}
    />
  )

  return (
    <div className="border-b border-[var(--dsw-alias-border-l2)] py-4">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1 pr-12">
          <div className="text-sm leading-[22px] text-foreground">{t('settings.autoCompact.title')}</div>
          <div className="text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]">{t('settings.autoCompact.description')}</div>
        </div>
        <Switch checked={auto} onCheckedChange={setAutoCompact} aria-label={t('settings.autoCompact.title')} />
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm leading-[22px] text-foreground">{t('settings.autoCompact.warn.title')}</span>
          <span className="text-xs leading-[18px] tabular-nums text-[var(--dsw-alias-label-tertiary)]">{warnPercent}%</span>
        </div>
        {slider(warnPercent, 1, 100, previewWarnRatio, setWarnRatio)}
        <div className="text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]">{t('settings.autoCompact.warn.description')}</div>
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm leading-[22px] text-foreground">{t('settings.autoCompact.redline.title')}</span>
          <span className="text-xs leading-[18px] tabular-nums text-[var(--dsw-alias-label-tertiary)]">{redlinePercent}%</span>
        </div>
        {slider(redlinePercent, 1, 100, previewRedlineRatio, setRedlineRatio)}
        <div className="text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]">{t('settings.autoCompact.redline.description')}</div>
      </div>
    </div>
  )
}
