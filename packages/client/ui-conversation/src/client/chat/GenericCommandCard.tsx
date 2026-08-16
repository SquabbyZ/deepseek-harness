// GenericCommandCard: the default command row — a stripped-down
// GenericToolCard rendering the command name and its settlement text.
// Supplied by the chat view as the keyed commandview slot's render-site
// fallback (an unregistered command name lands here); registrants may compose
// it as a base, feeding the same owner payload through.

import { useState, type ReactNode } from 'react'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { DisclosureRow, IconApiOutline14, Progress, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'

type CommandRowState = 'running' | 'ok' | 'error'

/** Node state → row state semantic (running while unsettled; outcome kind after). */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CommandRowState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

function leadingFor(state: CommandRowState): ReactNode {
  return state === 'error' ? <StateDot state="error" /> : <IconApiOutline14 size={14} />
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
export interface GenericCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  /** Command-specific running copy; absent uses the generic command label. */
  runningSummary?: string | undefined
  /** Show a pulsing progress bar while the command runs (compaction). */
  progress?: boolean | undefined
}

export function GenericCommandCard({ node, t, runningSummary, progress }: GenericCommandCardProps) {
  const [expanded, setExpanded] = useState(false)
  const text = node.outcome?.text
  const summary = node.outcome === null
    ? runningSummary ?? t('command.running')
    : text ?? (node.outcome.kind === 'error' ? t('command.failed') : t('command.done'))
  // Title is the bare command name: the row already reads `name · outcome`,
  // and the dispatched line's own `/` and arguments only restate what the
  // settlement text says (`permission · preset workspace-write`). A
  // cross-window node whose run page fell out of the window has no name.
  const title = node.name ?? t('command.title')
  const state = stateOf(node.outcome)
  const body = text !== undefined && text.includes('\n') ? text : null
  const open = expanded && body !== null
  return (
    <div className="flex flex-col" data-variant="others" data-state={state}>
      {state === 'running' && <span className="absolute w-px h-px overflow-hidden whitespace-nowrap [clip:rect(0_0_0_0)]">{t('row.running')}</span>}
      {state === 'error' && <span className="absolute w-px h-px overflow-hidden whitespace-nowrap [clip:rect(0_0_0_0)]">{t('row.failed')}</span>}
      <DisclosureRow
        rowClassName="row-sweep"
        leadingClassName="shrink-0"
        titleClassName="font-normal"
        chevronClassName="text-[var(--dsw-alias-label-secondary)]"
        icon={leadingFor(state)}
        title={title}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className="flex-none size-0.5 mx-2 rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
            <span className="min-w-0 flex-1 overflow-hidden text-sm leading-6 text-[var(--dsw-alias-label-tertiary)] text-ellipsis whitespace-nowrap data-[error]:text-[var(--dsw-alias-state-error-primary)]" data-error={state === 'error' || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className="max-h-[260px] mt-1 mb-1 ml-1 overflow-auto rounded-[12px] border border-[var(--dsw-alias-border-l1)] bg-[var(--dsw-alias-markdown-code-block)] py-3 px-4 text-[var(--dsw-alias-label-primary)] [font:var(--dsw-font-markdown-code-block-small)] whitespace-pre-wrap data-[error]:text-[var(--dsw-alias-state-error-primary)]" data-error={state === 'error' || undefined}>{body}</pre>
      </DisclosureRow>
      {state === 'running' && progress === true && (
        <Progress value={50} className="mt-1 h-1 animate-pulse" aria-hidden />
      )}
    </div>
  )
}
