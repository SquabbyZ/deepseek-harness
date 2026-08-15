// Bash toolview registrant: third-party posture over the keyed toolview hole
// (ctx.slots.register + ToolRowProps only — never imports the chat domain).
// Product chrome matches ToolRow / Think (figma: Bash · {description}).
//
// A bash call normally declares the terminal render intent, so this row renders
// the command's own output through TerminalBlock. Execution failures that
// settle without terminal material use the bounded generic IN/OUT fallback —
// both are expand-gated exactly like
// ToolRow's unified interaction: collapsed by default, the whole summary row
// is the toggle (click / Enter / Space, icon→chevron hover preview; the
// summary stays inline while open),
// and the expanded card max-height-scrolls inside its own surface with the
// full output (maxLines Infinity — no middle collapse). An error row's
// collapsed summary is the failure's first line in the error color.

import { useState, type KeyboardEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import {
  IconApiOutline14, IconChevronDownOutline14, IconInspectOutline12, StateDot, TerminalBlock, cn,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { terminalBlockLabels, terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { toolRowModel, type ToolRowState } from '../models/tool-call-model.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Bash row props: the toolview runtime share plus the standard locale seat. */
type BashRowProps = ToolCallViewProps & PropsLocale<'conversation'>

function leadingFor(state: ToolRowState) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    // Running keeps the icon — the row sweep carries the in-flight signal.
    default: return <IconApiOutline14 size={14} />
  }
}

/** Visually hidden status — StateDot is aria-hidden; AT needs a text label. */
function stateStatus(state: ToolRowState, t: BashRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('bash.running')
    case 'error': return t('bash.failed')
    case 'stopped': return t('bash.stopped')
    default: return null
  }
}

/**
 * Bash row: icon + Bash · {description} in the shared ToolRow chrome, the
 * whole row toggling the command's terminal or generic error card (ToolRow's unified
 * expand interaction, replicated locally per the registrant posture).
 */
export function BashRow({ toolName, block, sessionId, useSessions, inspect, t }: BashRowProps) {
  const model = toolRowModel(toolName, block)
  // Session workspace root: the terminal view's cwd resolves against it (an
  // omitted workdir IS the workspace), which the pure presenter cannot do.
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const terminal = terminalCardModel(block, cwd)
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  const status = stateStatus(state, t)
  const [expanded, setExpanded] = useState(false)
  // Execution failures (for example cancellation before the process reports a
  // terminal result) use the generic presenter. Keep their recorded args and
  // full error reachable instead of collapsing the row to the first line.
  const genericError = terminal === null
    && model.state === 'error'
    && (model.body !== null || model.output !== null)
  const expandable = terminal !== null || genericError
  const open = expanded && expandable
  const failureLine = model.state === 'error' ? model.errorSummary : null
  const toggleExpand = () => {
    setExpanded(v => !v)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const leading = open
    ? <IconChevronDownOutline14 className="text-[var(--dsw-alias-label-secondary)]" />
    : expandable
      ? (
        <>
          <span className="inline-flex opacity-100 transition-opacity duration-100 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:opacity-0 motion-reduce:transition-none">{leadingFor(state)}</span>
          <IconChevronDownOutline14 className={cn('text-[var(--dsw-alias-label-secondary)]', 'absolute inset-0 m-auto opacity-0 transition-opacity duration-100 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:opacity-100 motion-reduce:transition-none')} />
        </>
      )
      : leadingFor(state)
  return (
    <div className="group/card flex flex-col">
      <div
        className="row-sweep group relative flex h-6 min-w-0 items-center overflow-hidden data-[expandable]:cursor-pointer"
        data-sample="bash"
        data-variant="bash"
        data-state={state}
        data-expandable={expandable || undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? toggleExpand : undefined}
        onKeyDown={expandable ? toggleFromKeyboard : undefined}
      >
        <span className="relative mr-1.5 inline-flex size-4 shrink-0 items-center justify-center text-[var(--dsw-alias-label-tertiary)]">{leading}</span>
        {status !== null && <span className="absolute size-px overflow-hidden whitespace-nowrap [clip:rect(0_0_0_0)]">{status}</span>}
        <span className="flex-none text-sm leading-6 text-[var(--dsw-alias-label-secondary)]">{model.title}</span>
        <span className="mx-2 size-0.5 flex-none rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
        {/* The terminal presenter's description is the contractual
            above-card summary; a failure's first line outranks both. */}
        <span className={cn('flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-6', failureLine !== null ? 'text-[var(--dsw-alias-state-error-primary)]' : 'text-[var(--dsw-alias-label-tertiary)]')}>
          {failureLine ?? terminal?.description ?? model.summary}
        </span>
      </div>
      {open && (
        /* Same hover-Inspect posture as ToolRow's expanded body, replicated
           locally per the registrant posture. */
        <div className="flex flex-col">
          {terminal !== null
            ? (
              <TerminalBlock
                {...terminal.card}
                maxLines={Infinity}
                labels={terminalBlockLabels(t)}
                className="m-[4px_0_4px_4px] border border-[var(--dsw-alias-border-l1)] [--dsl-terminal-font:var(--dsw-font-markdown-code-block-small)] [--dsl-terminal-line-height:18px] [--dsl-terminal-output-max-height:224px]"
              />
            )
            : (
              <div className="m-[4px_0_4px_4px] flex flex-col rounded-xl border border-[var(--dsw-alias-border-l1)] bg-[var(--dsw-alias-markdown-code-block)] [font:var(--dsw-font-markdown-code-block-small)]">
                {model.body !== null && (
                  <div className="tool-scroll-thin grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3">
                    <span className="sticky top-0 self-start text-[var(--dsw-alias-label-caption)]">IN</span>
                    <span className="min-w-0 whitespace-pre-wrap text-[var(--dsw-alias-label-secondary)] [word-break:break-word]">{model.body}</span>
                  </div>
                )}
                {model.body !== null && model.output !== null && (
                  <span className="h-px flex-none bg-[var(--dsw-alias-border-l2)]" aria-hidden />
                )}
                {model.output !== null && (
                  <div className="tool-scroll-thin grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3">
                    <span className="sticky top-0 self-start text-[var(--dsw-alias-label-caption)]">OUT</span>
                    <span className="min-w-0 whitespace-pre-wrap text-[var(--dsw-alias-label-secondary)] [word-break:break-word] data-[error]:text-[var(--dsw-alias-state-error-primary)]" data-error>
                      {model.output}
                    </span>
                  </div>
                )}
              </div>
            )}
          {inspect !== undefined && (
            <button
              type="button"
              className="group-hover/card:opacity-100 focus-visible:opacity-100 m-[4px_0_2px_4px] inline-flex cursor-pointer items-center gap-1 self-start rounded-full border border-border bg-background px-2 py-0.5 text-[11px] leading-4 text-[var(--dsw-alias-label-secondary)] opacity-0 transition-opacity duration-100 hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)] hover:text-foreground motion-reduce:transition-none"
              onClick={inspect}
            >
              <IconInspectOutline12 />
              Inspect
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The sample as a plain registrant plugin. Slot injection follows the chat
 * toolview declaration across independent activation and reload lifetimes.
 */
export const bashToolviewSample = {
  name: 'bash-toolview-sample',
  inject: ['slots'],
  /**
   * Register the bash row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow))
  },
}
