// ProducedFiles: the produced-file row a finished turn ends with. The paths
// come pre-matched by the turn-tail chain from the mutation tools'
// follow-along locations, never from the closing prose. Clicking one goes
// through the same openFile the tool rows use — the Host's own opener, on the
// Host machine.

import { useLayoutEffect, useRef, useState } from 'react'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import { ShadcnButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'

/** One produced file: a link by behavior (opens the file), a chip by shape. */
const FILE_BASE = 'm-0 flex-none max-w-[320px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border-none rounded-md bg-[var(--dsw-alias-interactive-bg-hover)] px-2 py-0 h-auto text-[13px] font-normal leading-[22px] text-[var(--dsw-alias-label-secondary)] hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_2px_var(--dsw-alias-border-l3)]'

/** Native folder action under the lane. */
const SHOW_FOLDER_BASE = 'col-start-2 row-start-2 justify-self-start m-0 cursor-pointer border-none rounded bg-transparent px-0.5 py-0 h-auto text-[13px] font-normal leading-5 text-[var(--dsw-alias-label-tertiary)] hover:text-[var(--dsw-alias-label-secondary)] hover:underline focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_2px_var(--dsw-alias-border-l3)]'

/** Browser-native width probe for each candidate shown count. */
const PROBE_BASE = 'absolute top-0 left-0 w-max'

/** At most six chips compete for the one-line summary; every other path stays counted. */
const SHOWN_LIMIT = 6

/**
 * Select the largest prefix whose measured chips and exact remainder fit.
 * @param available - usable width of the one-line file lane.
 * @param gap - computed flex gap between adjacent visible items.
 * @param chipWidths - measured widths for the candidate file chips.
 * @param moreWidthsByShown - exact localized remainder width for each shown count.
 * @returns Number of leading chips to render.
 */
export function fitProducedFiles(
  available: number,
  gap: number,
  chipWidths: readonly number[],
  moreWidthsByShown: readonly (number | undefined)[],
): number {
  if (available <= 0) return chipWidths.length
  const prefix = [0]
  let prefixWidth = 0
  for (const width of chipWidths) {
    prefixWidth += width
    prefix.push(prefixWidth)
  }
  let largestFit = 0
  for (const [shown, width] of prefix.entries()) {
    const more = moreWidthsByShown[shown]
    const items = shown + (more === undefined ? 0 : 1)
    const needed = width + (more ?? 0) + Math.max(0, items - 1) * gap
    if (needed <= available) largestFit = shown
  }
  return largestFit
}

/** Registration-side Host capability facts. */
export interface ProducedFilesInjected {
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
}

/** Matched paths plus the opener, locale, and injected Host capability. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Render one turn's produced files as openable chips.
 * @param props - selector-matched paths, the chat view's file opener, and the locale seat.
 * @returns The produced-files row.
 */
export function ProducedFiles({
  matched: paths, openFile, isLoopback, useHostDescription, t,
}: ProducedFilesProps) {
  const hostCanOpenPath = useHostDescription(description => description?.canOpenPath === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  const limit = Math.min(paths.length, SHOWN_LIMIT)
  const [shownCount, setShownCount] = useState(limit)
  const rowRef = useRef<HTMLDivElement>(null)
  const chipProbes = useRef<Array<HTMLButtonElement | null>>([])
  const moreProbe = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const row = rowRef.current
    const remainderProbe = moreProbe.current
    /* v8 ignore next -- React attaches both refs before the layout effect runs. */
    if (row === null || remainderProbe === null) return
    const measure = (): void => {
      const styles = getComputedStyle(row)
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
      // React attaches every still-mounted callback ref before layout effects run.
      const activeChipProbes = chipProbes.current.slice(0, limit) as HTMLButtonElement[]
      const chips = activeChipProbes.map(probe => probe.getBoundingClientRect().width)
      const more = Array.from({ length: limit + 1 }, (_, candidate) => {
        if (paths.length === candidate) return undefined
        remainderProbe.textContent = moreLabel(t, paths.length - candidate)
        return remainderProbe.getBoundingClientRect().width
      })
      setShownCount(fitProducedFiles(row.clientWidth, gap, chips, more))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const probe of [...chipProbes.current, moreProbe.current]) {
      if (probe !== null) observer.observe(probe)
    }
    return () => { observer.disconnect() }
  }, [limit, paths, t])

  const visibleCount = Math.min(shownCount, limit)
  const shown = paths.slice(0, visibleCount)
  const hidden = paths.length - shown.length
  return (
    <div className="relative grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 mt-4 text-[13px] leading-[22px]">
      <span className="col-start-1 row-start-1 text-[var(--dsw-alias-label-tertiary)]">{t('produced.label')}</span>
      <div ref={rowRef} className="col-start-2 row-start-1 flex flex-nowrap items-center gap-2 min-w-0 overflow-hidden" data-produced-files-row>
        {shown.map(path => (
          <ShadcnButton
            key={path}
            variant="ghost"
            className={FILE_BASE}
            // The full path is the disambiguator when two turns produce files
            // that share a basename; the chip itself stays short.
            title={path}
            aria-label={t('produced.open', { name: path })}
            onClick={() => { openFile(path) }}
          >
            {basename(path)}
          </ShadcnButton>
        ))}
        {hidden > 0 && <span className="flex-none whitespace-nowrap text-[var(--dsw-alias-label-tertiary)]">{moreLabel(t, hidden)}</span>}
      </div>
      {hidden > 0 && canOpenPath && (
        <ShadcnButton variant="ghost" className={SHOW_FOLDER_BASE} onClick={() => { openFile('.') }}>
          {t('produced.showInFolder')}
        </ShadcnButton>
      )}
      <div className="absolute w-0 h-0 overflow-hidden invisible pointer-events-none [contain:strict]" aria-hidden="true">
        {paths.slice(0, limit).map((path, index) => (
          <ShadcnButton
            key={path}
            ref={(node) => { chipProbes.current[index] = node }}
            variant="ghost"
            tabIndex={-1}
            className={`${FILE_BASE} ${PROBE_BASE}`}
          >
            {basename(path)}
          </ShadcnButton>
        ))}
        <span ref={moreProbe} className={`flex-none whitespace-nowrap text-[var(--dsw-alias-label-tertiary)] ${PROBE_BASE}`} />
      </div>
    </div>
  )
}
