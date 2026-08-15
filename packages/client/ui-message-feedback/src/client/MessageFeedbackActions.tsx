/**
 * Per-message feedback controls: a Like/Dislike pair plus an optional note.
 * Rendered inside the assistant message's IconActions row, so the buttons
 * reuse that row's chrome and sit between copy and branch.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/MessageFeedbackActions
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconDislikeOutline16, IconLikeOutline16, ShadcnButton, Textarea, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackActionProps } from './slots.ts'

/** Rating glyph button mirroring the shared IconActions chrome. */
const ACTION = 'inline-flex size-7 cursor-pointer items-center justify-center rounded-[28px] border-none bg-transparent p-1.5 text-[var(--dsw-alias-label-tertiary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-secondary)] data-[active]:text-foreground disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40'
/** Inline "open note" text button. */
const NOTE_OPEN = 'h-auto max-w-[220px] cursor-pointer overflow-hidden rounded-[14px] border-none bg-transparent px-2 py-0 text-[13px] font-normal leading-7 text-[var(--dsw-alias-label-tertiary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-secondary)] whitespace-nowrap text-ellipsis'
/** Filled note-save button. */
const NOTE_SAVE = 'h-7 cursor-pointer rounded-[14px] border-none bg-[var(--dsw-alias-interactive-bg-primary)] px-2.5 py-0 text-[13px] font-normal text-[var(--dsw-alias-label-inverse)] hover:bg-[var(--dsw-alias-interactive-bg-primary)] hover:text-[var(--dsw-alias-label-inverse)] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40'
/** Quiet note-cancel button. */
const NOTE_CANCEL = 'h-7 cursor-pointer rounded-[14px] border-none bg-transparent px-2.5 py-0 text-[13px] font-normal text-[var(--dsw-alias-label-tertiary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-secondary)]'

/**
 * One message's feedback controls.
 * @param props - the owner's message identity, the injected verbs, and the
 * shared feedback hook.
 * @returns the rating buttons, plus the note editor while it is open.
 */
export function MessageFeedbackActions({ messageId, ensure, rate, toggle, clearNote, useFeedback, t }: MessageFeedbackActionProps) {
  const item = useFeedback(view => view.items.get(messageId))
  const loadFailed = useFeedback(view => view.status === 'error')
  const rating = item?.rating
  const [noteOpen, setNoteOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // The controls mount for every settled message in the transcript, so the
  // Session's feedback is read once on first hover/focus rather than on mount.
  const seeded = useRef(false)
  const seed = useCallback(() => {
    if (seeded.current) return
    seeded.current = true
    void ensure()
  }, [ensure])

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const settle = useCallback((result: { ok: boolean; error?: { code: string } }) => {
    if (!alive.current) return
    setPending(false)
    if (result.ok) {
      setFailure(null)
      return
    }
    setFailure(result.error?.code === 'version-conflict' ? t('error.conflict') : t('error.generic'))
  }, [t])

  const onRate = useCallback((next: MessageFeedbackRating) => {
    setPending(true)
    setFailure(null)
    // The controller decides retract-vs-replace from the committed item, so a
    // click that lands before the first list read still toggles the stored
    // value instead of this render's empty view.
    setNoteOpen(false)
    void toggle(messageId, next).then(settle)
  }, [messageId, settle, toggle])

  // The rating is a parameter because only the note editor's render site can
  // prove one is recorded; that removes an unreachable undefined guard here.
  const onSaveNote = useCallback((current: MessageFeedbackRating) => {
    const trimmed = draft.trim()
    setPending(true)
    setFailure(null)
    // An emptied editor removes the note explicitly; `rate` alone preserves a
    // stored note, so it cannot express deletion.
    const settled = trimmed.length === 0
      ? clearNote(messageId)
      : rate(messageId, current, trimmed)
    void settled.then((result) => {
      settle(result)
      if (result.ok && alive.current) setNoteOpen(false)
    })
  }, [clearNote, draft, messageId, rate, settle])

  const openNote = useCallback(() => {
    setDraft(item?.note ?? '')
    setNoteOpen(true)
  }, [item?.note])

  const likeLabel = rating === 'positive' ? t('action.likeActive') : t('action.like')
  const dislikeLabel = rating === 'negative' ? t('action.dislikeActive') : t('action.dislike')

  return (
    <>
      <Tooltip label={likeLabel} side="bottom">
        <ShadcnButton
          variant="ghost"
          className={ACTION}
          aria-label={likeLabel}
          aria-pressed={rating === 'positive'}
          data-active={rating === 'positive' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={() => { onRate('positive') }}
        >
          <IconLikeOutline16 />
        </ShadcnButton>
      </Tooltip>
      <Tooltip label={dislikeLabel} side="bottom">
        <ShadcnButton
          variant="ghost"
          className={ACTION}
          aria-label={dislikeLabel}
          aria-pressed={rating === 'negative'}
          data-active={rating === 'negative' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={() => { onRate('negative') }}
        >
          <IconDislikeOutline16 />
        </ShadcnButton>
      </Tooltip>
      {rating !== undefined && !noteOpen && (
        <ShadcnButton variant="ghost" className={NOTE_OPEN} onClick={openNote}>
          {item?.note === undefined ? t('note.open') : item.note}
        </ShadcnButton>
      )}
      {rating !== undefined && noteOpen && (
        <span className="inline-flex items-start gap-1.5">
          <Textarea
            className="min-h-0 w-[260px] rounded-[8px] border border-[var(--dsw-alias-border-secondary)] bg-[var(--dsw-alias-bg-primary)] px-2 py-1.5 text-[13px] text-foreground shadow-none outline-none [font:inherit] focus-visible:ring-0 resize-y"
            aria-label={t('note.aria')}
            placeholder={t('note.placeholder')}
            value={draft}
            rows={2}
            onChange={(event) => { setDraft(event.target.value) }}
          />
          <ShadcnButton
            variant="ghost"
            className={NOTE_SAVE}
            disabled={pending}
            onClick={() => { onSaveNote(rating) }}
          >
            {t('note.save')}
          </ShadcnButton>
          <ShadcnButton variant="ghost" className={NOTE_CANCEL} onClick={() => { setNoteOpen(false) }}>
            {t('note.cancel')}
          </ShadcnButton>
        </span>
      )}
      {failure === null && loadFailed && (
        <span className="pl-1 text-[13px] leading-7 text-[var(--dsw-alias-label-tertiary)]" role="status">{t('error.load')}</span>
      )}
      {failure !== null && <span className="pl-1 text-[13px] leading-7 text-[var(--dsw-alias-label-tertiary)]" role="status">{failure}</span>}
    </>
  )
}
