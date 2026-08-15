/**
 * The action row every provider card ends with: dismiss on the left, commit on
 * the right.
 *
 * The two cards commit different things — one creates a route, one edits an
 * existing profile — but the row itself carries no such knowledge. It renders
 * what it is handed, so the cards keep sole ownership of when a commit is
 * allowed and what the in-flight wording is.
 *
 * Cancel refuses input only while a commit is in flight, never because the card
 * is disabled: a card the deployment cannot write to must still be dismissable.
 *
 * @module dsh-client-ui-settings-models/client/EditorFooter
 */

import type { ReactNode } from 'react'
import { ShadcnButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'

/** Props of {@link EditorFooter}. */
export interface EditorFooterProps {
  /** Localizer for the row's own labels. */
  t: (key: keyof typeof en) => string
  /** Whether a commit is in flight; holds Cancel and swaps the commit label. */
  busy: boolean
  /** Whether the commit is refused, as judged by the owning card. */
  submitDisabled: boolean
  /** Commit label while idle. */
  submitLabel: keyof typeof en
  /** Commit label while a commit is in flight. */
  submitBusyLabel: keyof typeof en
  /** Dismiss label; defaults to the settings editor copy. */
  cancelLabel?: keyof typeof en
  /** Dismiss the card without committing. */
  onCancel: () => void
  /** Run the card's commit. */
  onSubmit: () => void
}

const SECONDARY_BUTTON =
  'inline-flex h-9 items-center justify-center gap-1 rounded-[18px] border border-border bg-transparent px-[14px] text-sm leading-[22px] font-normal text-foreground hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover-solid)] hover:text-foreground disabled:opacity-40 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--dsw-alias-border-l3)]'

const PRIMARY_BUTTON =
  'inline-flex h-9 items-center justify-center gap-1 rounded-[18px] border-none bg-[var(--dsw-alias-button-primary-fill)] px-[14px] text-sm leading-[22px] font-normal text-[var(--dsw-alias-label-primary-foreground)] hover:enabled:bg-[var(--dsw-alias-button-primary-hover)] hover:text-[var(--dsw-alias-label-primary-foreground)] disabled:opacity-40 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--dsw-alias-border-l3)]'

/**
 * Render one provider card's action row.
 * @param props - the labels, commit gating, and handlers the owning card supplies.
 * @returns the cancel/commit row.
 */
export function EditorFooter(props: EditorFooterProps): ReactNode {
  const { t } = props
  return (
    <div className="flex justify-end gap-2">
      <ShadcnButton
        variant="ghost"
        className={SECONDARY_BUTTON}
        disabled={props.busy}
        onClick={props.onCancel}
      >
        {t(props.cancelLabel ?? 'cancel')}
      </ShadcnButton>
      <ShadcnButton
        variant="ghost"
        className={PRIMARY_BUTTON}
        disabled={props.submitDisabled}
        onClick={props.onSubmit}
      >
        {props.busy ? t(props.submitBusyLabel) : t(props.submitLabel)}
      </ShadcnButton>
    </div>
  )
}
