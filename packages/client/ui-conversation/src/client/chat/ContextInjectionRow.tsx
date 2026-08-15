import { useState } from 'react'
import type { ContextMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { contextBody } from './ContextBody.tsx'

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  provenance: ContextMessageNode['provenance']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Render logged context with the Tool calls disclosure chrome from Figma.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * The expanded body follows the producer-declared form; an absent or unknown
 * form renders the opaque body.
 * @param props - Durable content, its projected producer role/name and form, and the locale seat.
 * @returns A collapsed context row with a bounded, form-specific body.
 */
export function ContextInjectionRow({ content, source, provenance, form, t }: ContextInjectionRowProps) {
  const [open, setOpen] = useState(false)
  // Resolved rather than declared: a form whose fields are unreadable renders
  // the opaque body, and the marker must say what the row actually shows.
  const { rendered, summary, body } = contextBody(form, { content, source, t })

  return (
    <DisclosureRow
      className="data-[open]:pb-1"
      icon={<IconBrowseOutline16 size={14} />}
      chevronClassName="text-[var(--dsw-alias-label-secondary)]"
      title={t(provenance.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')}
      collapsedContent={provenance.label === null ? undefined : (
        /* ToolRow's separator shape: an aria-hidden dot, so the accessible name
           stays the two readable parts and the two disclosure rows expose one
           name shape. A source that names no producer drops the dot with it. */
        <>
          <span className="flex-none size-0.5 mx-2 rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
          <span className="flex-none min-w-0 overflow-hidden text-sm leading-6 text-[var(--dsw-alias-label-tertiary)] text-ellipsis whitespace-nowrap" data-context-source>{provenance.label}</span>
          {summary !== null && (
            <>
              <span className="flex-none size-0.5 mx-2 rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
              <span className="min-w-0 flex-1 overflow-hidden text-sm leading-6 text-[var(--dsw-alias-label-tertiary)] text-ellipsis whitespace-nowrap" data-context-summary>{summary}</span>
            </>
          )}
        </>
      )}
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className="box-border w-[calc(100%-22px)] max-h-[141px] mt-1 ml-[22px] overflow-auto pt-[10px] pr-4 pb-3 pl-3 border-none rounded-[8px] bg-[var(--dsw-alias-markdown-code-block)] text-[var(--dsw-alias-label-tertiary)] [font:400_11px/16px_var(--ds-font-family-code)]" data-context-injection-body data-context-form={rendered ?? undefined}>
        {body}
      </div>
    </DisclosureRow>
  )
}
