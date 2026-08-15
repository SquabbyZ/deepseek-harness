// Skill toolview registrant: a domain-owned row over the keyed toolview hole.
// The compact accent row keeps loaded instructions scannable in the transcript;
// the exact durable tool output remains available in a bounded disclosure card.

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconInspectOutline12, IconSkillOutline16, StateDot, cn,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** Skill row lifecycle derived solely from the durable call slice. */
type SkillRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Full row props: the toolview runtime share plus this package's locale seat. */
type SkillRowProps = ToolCallViewProps & PropsLocale<'skill'>

/** Compact, replay-stable view model for the dedicated row. */
interface SkillRowModel {
  readonly name: string
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: SkillRowState
}

/** First physical line for the collapsed error summary and malformed-args fallback. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Skill names are the only call argument the compact row presents. */
function skillName(argsRaw: string, callId: string): string {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const name = (parsed as Record<string, unknown>).name
      if (typeof name === 'string' && name !== '') return firstLine(name)
    }
  } catch {
    // Streaming can expose a truncated JSON prefix; its first line is still
    // more useful than replacing the call with an unrelated catalog lookup.
  }
  return argsRaw === '' ? callId : firstLine(argsRaw)
}

/** Flatten durable result blocks under the generic Tool-row text contract.
 *  Keep aligned with ui-tool's models/tool-call-model.ts `resultText`. */
function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** Derive display state without consulting the live skill catalog. */
function skillRowModel(block: ToolCallViewProps['block']): SkillRowModel {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const state: SkillRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const output = resultText(block)
  return {
    name: skillName(argsRaw, block.callId),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/** State substitution for the collapsed leading slot. */
function leadingFor(state: SkillRowState): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconSkillOutline16 size={14} />
  }
}

/** Leading disclosure slot: state icon at rest, chevron on hover or while open. */
function disclosureLeading(state: SkillRowState, open: boolean, expandable: boolean): ReactNode {
  if (open) return <IconChevronDownOutline14 className="text-[var(--dsw-alias-label-secondary)]" />
  const icon = leadingFor(state)
  if (!expandable) return icon
  return (
    <>
      <span className="inline-flex opacity-100 transition-opacity duration-100 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:opacity-0 motion-reduce:transition-none">{icon}</span>
      <IconChevronDownOutline14 className={cn('text-[var(--dsw-alias-label-secondary)]', 'absolute inset-0 m-auto opacity-0 transition-opacity duration-100 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:opacity-100 motion-reduce:transition-none')} />
    </>
  )
}

/** Visually hidden state copy for the colour-only lifecycle cues. */
function stateStatus(state: SkillRowState, t: SkillRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

/**
 * Render one `skill` tool call as an accent summary and instructions disclosure.
 * @param props - keyed toolview payload plus the skill locale seat.
 * @returns the dedicated skill row.
 */
export function SkillRow({ block, inspect, t }: SkillRowProps) {
  const model = skillRowModel(block)
  const [expanded, setExpanded] = useState(false)
  const expandable = model.output !== null
  const open = expanded && expandable
  const status = stateStatus(model.state, t)
  const summary = model.errorSummary ?? model.name
  const toggleExpand = (): void => {
    setExpanded(value => !value)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const disclosureProps = expandable ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': open,
    onClick: toggleExpand,
    onKeyDown: toggleFromKeyboard,
  } : {}
  const leading = disclosureLeading(model.state, open, expandable)
  return (
    <div className="group/skill flex flex-col" data-tool="skill" data-state={model.state}>
      <div
        className="row-sweep group relative flex h-6 min-w-0 items-center overflow-hidden data-[expandable]:cursor-pointer"
        data-expandable={expandable || undefined}
        {...disclosureProps}
      >
        <span className="relative mr-1.5 inline-flex size-4 shrink-0 items-center justify-center text-[var(--dsw-alias-label-tertiary)]">{leading}</span>
        {status !== null ? <span className="absolute size-px overflow-hidden whitespace-nowrap [clip:rect(0_0_0_0)]">{status}</span> : null}
        <span className="flex-none text-sm leading-6 text-[var(--dsw-alias-label-secondary)]">Skill</span>
        <span className="mx-2 size-0.5 flex-none rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
        <span className={cn('flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-6', model.errorSummary === null ? 'text-[var(--dsw-alias-label-tertiary)]' : 'text-[var(--dsw-alias-state-error-primary)]')}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className="flex flex-col">
          <section className="my-1 ml-1 flex max-h-[260px] flex-col overflow-hidden rounded-xl border border-[var(--dsw-alias-border-l1)] bg-[var(--dsw-alias-markdown-code-block)]" aria-label={t('row.instructions')}>
            <div className="flex-none border-b border-border bg-[var(--dsw-alias-markdown-code-block-banner)] px-3 py-2 text-[11px] font-medium uppercase leading-4 tracking-[0.04em] text-[var(--dsw-alias-label-caption)]">{t('row.instructions')}</div>
            <pre className="tool-scroll-thin m-0 min-h-0 overflow-auto whitespace-pre-wrap px-3 pb-3 pt-2.5 [font:var(--dsw-font-markdown-code-block-small)] text-[var(--dsw-alias-label-secondary)] [overflow-wrap:anywhere] data-[error]:text-[var(--dsw-alias-state-error-primary)]" data-error={model.state === 'error' || undefined}>{model.output}</pre>
          </section>
          {inspect !== undefined ? (
            <button
              type="button"
              className="group-hover/skill:opacity-100 focus-visible:opacity-100 m-[4px_0_2px_4px] inline-flex cursor-pointer items-center gap-1 self-start rounded-full border border-border bg-background px-2 py-0.5 text-[11px] leading-4 text-[var(--dsw-alias-label-secondary)] opacity-0 transition-opacity duration-100 hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)] hover:text-foreground motion-reduce:transition-none"
              onClick={inspect}
            >
              <IconInspectOutline12 />
              Inspect
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
