/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])

  return (
    <div className="flex flex-col" data-variant="think" data-state={running ? 'running' : 'ok'}>
      {running && <span className="absolute w-px h-px overflow-hidden whitespace-nowrap [clip:rect(0_0_0_0)]">{t('row.running')}</span>}
      <DisclosureRow
        rowClassName="row-sweep"
        leadingClassName="shrink-0"
        titleClassName="font-normal"
        chevronClassName="text-[var(--dsw-alias-label-secondary)]"
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className="flex-none size-0.5 mx-2 rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
            <span ref={summaryRef} className="min-w-0 flex-1 overflow-hidden text-sm leading-6 text-[var(--dsw-alias-label-tertiary)] text-ellipsis whitespace-nowrap data-[follow-end]:text-clip" data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className="thinkBody py-1 pr-0 pl-[22px] text-sm leading-6 text-[var(--dsw-alias-label-tertiary)] whitespace-pre-wrap [word-break:break-word]">{text}</div>
      </DisclosureRow>
    </div>
  )
}
