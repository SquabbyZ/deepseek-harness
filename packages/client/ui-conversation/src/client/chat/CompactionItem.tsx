// CompactionItem: the one row a landed compaction contributes to the flow.
// The conversation it shadowed on the model surface stays above it, so this
// marker reports where the model stopped seeing that history — it never
// replaces it. The framed checkpoint payload is written for the model and is
// not rendered; the disclosure shows the summary from the checkpoint's own
// cited `compaction/summary` event, and a window cut that left that event outside makes the row
// non-expandable rather than empty.

import { memo, useState } from 'react'
import type { CompactionSummaryNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconApiOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  MarkdownText,
  ShadcnButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'

interface CompactionItemProps {
  node: CompactionSummaryNode
  /** Optional command title for a manual compaction folded into this marker. */
  title?: string
  /** Command settlement text used when structured compaction counts are unavailable. */
  fallbackSummary?: string | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}

/**
 * The collapsed-by-default compaction marker.
 * @param props - the marker node off the snapshot cache.
 * @returns the marker row, with the summary disclosure when one is available.
 */
export const CompactionItem = memo(function CompactionItem({
  node,
  title,
  fallbackSummary,
  t,
}: CompactionItemProps) {
  const [expanded, setExpanded] = useState(false)
  const expandable = node.summary !== null
  const open = expandable && expanded
  const summary = node.shadowedItemCount !== null && node.shadowedTokenCount !== null
    ? t('message.compaction.completed', {
      items: node.shadowedItemCount,
      tokens: node.shadowedTokenCount,
    })
    : fallbackSummary
      ?? (expandable ? t('message.compaction.expand') : t('message.compaction.unavailable'))
  return (
    <div className="py-0.5">
      <ShadcnButton
        variant="ghost"
        className="group h-6 w-full min-w-0 justify-start gap-0 rounded-[6px] bg-transparent p-0 text-left text-inherit font-normal hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-inherit disabled:opacity-100"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className="flex-none inline-grid place-items-center size-4 mr-[6px] text-[var(--dsw-alias-label-secondary)]" aria-hidden>
          <span className="inline-flex grid-area-[1/1] items-center justify-center group-hover:opacity-0 group-focus-visible:opacity-0" data-compaction-icon="context">
            <IconApiOutline14 />
          </span>
          <span
            className="inline-flex grid-area-[1/1] items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            data-compaction-disclosure={open ? 'expanded' : 'collapsed'}
          >
            {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
        </span>
        <span className="flex-none text-sm leading-6 text-[var(--dsw-alias-label-primary-dimmed)]">{title ?? t('message.compaction')}</span>
        <span className="flex-none size-0.5 mx-2 rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
        <span className="min-w-0 flex-1 overflow-hidden text-sm leading-6 text-[var(--dsw-alias-label-tertiary)] text-ellipsis whitespace-nowrap">{summary}</span>
      </ShadcnButton>
      {open && node.summary !== null
        && <div className="py-1 pl-[22px] pr-0 text-sm leading-6 text-[var(--dsw-alias-label-tertiary)]"><MarkdownText text={node.summary} /></div>}
    </div>
  )
})
