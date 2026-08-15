// PlanReviewPanel: the composer takeover for a question carrying the
// `plan-review` presentation intent. A plan under review is one decision over
// one body of markdown, so it takes the waiting-approval card shape — tinted
// strip, content, right-aligned action row — instead of the generic question
// flow's pager, numbered options, skip and custom-answer affordances, which
// read as a quiz the user is being graded on.
//
// The three actions are the whole decision surface: approve and decline answer
// the question with the option labels the asker offered (localised copy on the
// buttons, the asker's descriptions as their tooltips), while "discuss"
// dismisses the request so the composer returns and the user can simply say
// what they want. Dismissal is the generic flow's own cancel verb, promoted to
// a labelled button because in a two-outcome decision it is the third real
// answer, not an escape hatch.

import { useState } from 'react'
import { Button, IconEditOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingQuestion, PlanReview, QuestionComposerProps } from './contract/slots.ts'

/** Composer-takeover frame: centered on the shared content width. */
const FRAME = 'flex flex-col items-center px-[calc(var(--dsh-composer-side-clearance)_+_16px)] pt-1.5 pb-2.5'
/** Waiting-approval capsule (amber strip on the floating card). */
const CARD = 'flex w-full max-w-[var(--dsh-chat-content-width)] max-h-[min(60vh,520px)] flex-col overflow-hidden rounded-[20px] border border-[var(--dsw-alias-state-warn-secondary)] bg-[var(--dsw-specific-input-major)] shadow-[var(--dsw-shadow-lv2)] text-foreground [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)] max-[720px]:rounded-2xl'
const STRIP = 'flex flex-shrink-0 items-center gap-2 bg-[var(--dsw-alias-state-warn-tertiary)] px-4 py-2.5 text-[13px] leading-[18px] text-[var(--dsw-alias-state-warn-primary)]'
const BODY = 'min-h-0 flex-[1_1_auto] overflow-y-auto px-4 pb-1 pt-3 text-sm leading-[22px] [overscroll-behavior:contain] max-[720px]:px-3 max-[720px]:pt-2.5 max-[720px]:pb-1'
const FOOTER = 'flex flex-shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-2 max-[720px]:items-end max-[720px]:px-3 max-[720px]:pb-2.5'

/** The panel's own props: the question domain face, the narrowed review, and the locale seat. */
export type PlanReviewPanelProps =
  { pending: PendingQuestion; review: PlanReview } & Pick<QuestionComposerProps, 't'>

/**
 * Optional-prop spread for a decision button's tooltip: `title` is optional on
 * the DOM props, and exactOptionalPropertyTypes rejects an explicit undefined.
 *
 * @param description - the asker's option description, when it carries one.
 * @returns The `title` prop to spread, or nothing.
 */
function tooltip(description: string | undefined): { title?: string } {
  return description === undefined ? {} : { title: description }
}

/**
 * Render a plan review as a decision card.
 *
 * @param props - the question domain face, the narrowed plan review, and `t`.
 * @returns The plan-review takeover for this request.
 */
export function PlanReviewPanel({ pending, review, t }: PlanReviewPanelProps) {
  // One-shot latch shaped like the approval takeover's: the panel leaves only
  // when the host's resolved frame lands, so until then a second click must
  // not re-fire. A failed send (rejected receipt / transport) re-arms it and
  // shows why, since nothing else would tell the user the click was lost.
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settle = (send: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void send().catch((cause: unknown) => {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  const decide = (label: string): void => {
    settle(() => pending.answer({ answers: [{ id: review.id, selected: [label] }] }))
  }
  const decline = review.decline

  return (
    <div className={FRAME} data-plan-review-key={pending.key}>
      <section className={CARD} aria-label={review.question}>
        <div className={STRIP}>
          <span className="size-2 rounded-full bg-[var(--dsw-alias-state-warn-primary)]" />
          {t('plan.header')}
        </div>
        <div className={BODY} data-plan-review-scroll>
          <MarkdownText text={review.plan} />
        </div>
        <div className={FOOTER}>
          <div className="min-h-4 text-[11px] leading-4 text-[var(--dsw-alias-state-error-primary)]" role="status">{error}</div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              variant="ghost" className="gap-1.5 text-[var(--dsw-alias-label-secondary)] hover:enabled:text-foreground" icon={<IconEditOutline16 size={14} />}
              disabled={busy} onClick={() => { settle(() => pending.cancel()) }}
            >
              {t('plan.discuss')}
            </Button>
            {decline !== undefined && (
              <Button
                variant="outline" {...tooltip(decline.description)}
                disabled={busy} onClick={() => { decide(decline.label) }}
              >
                {t('plan.decline')}
              </Button>
            )}
            <Button
              variant="primary" {...tooltip(review.approve.description)}
              disabled={busy} onClick={() => { decide(review.approve.label) }}
            >
              {t('plan.approve')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
