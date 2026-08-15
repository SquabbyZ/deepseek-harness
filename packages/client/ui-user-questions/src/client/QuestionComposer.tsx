import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckOutline14, IconChevronLeftOutline14, IconChevronRightOutline14,
  IconCloseOutline16, IconEditOutline16, MarkdownText, ShadcnButton, ShadcnInput, Textarea,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  PendingQuestion, planReviewOf,
  type QuestionAnswer, type QuestionComposerProps,
} from './contract/slots.ts'
import { PlanReviewPanel } from './PlanReviewPanel.tsx'

/** Composer-takeover frame: centered on the shared content width. */
const FRAME = 'flex flex-col items-center px-[calc(var(--dsh-composer-side-clearance)_+_16px)] pt-1.5 pb-2.5'
/** Question card (figma Input 973:36348): no banner strip, sections own insets. */
const CARD = 'flex w-full max-w-[var(--dsh-chat-content-width)] max-h-[min(60vh,520px)] flex-col overflow-hidden rounded-[20px] border border-[var(--dsw-alias-border-l2-darkmode-thin)] bg-[var(--dsw-specific-input-major)] pb-2.5 shadow-[var(--dsw-shadow-lv2)] text-foreground [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)] max-[720px]:rounded-2xl'
/** Card header (figma 1019:36938, user-tuned): heading left, close right. */
const HEADER = 'flex flex-shrink-0 items-start justify-between gap-4 pt-5 pr-4 pb-0 pl-6 max-[720px]:pt-2.5 max-[720px]:pr-3 max-[720px]:pb-0 max-[720px]:pl-[18px]'
/** Round icon button (close / prev / next). */
const ICON_BTN = 'grid size-6 cursor-pointer place-items-center rounded-full border-none bg-transparent p-0 text-[var(--dsw-alias-label-tertiary)] hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] hover:enabled:text-foreground disabled:pointer-events-auto disabled:cursor-default disabled:text-[var(--dsw-alias-label-dimmed)] disabled:opacity-100'
/** Selectable option row (single-select number, multi-select checkbox). */
const OPTION = 'flex w-full min-h-10 flex-shrink-0 cursor-pointer items-start gap-2 rounded-[12px] border border-transparent bg-transparent py-2 pl-2 pr-3 text-left font-normal text-inherit transition-colors duration-[120ms] motion-reduce:transition-none hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] hover:enabled:text-inherit disabled:pointer-events-auto disabled:cursor-default disabled:opacity-100 max-[720px]:px-1.5'
const OPTION_SELECTED = 'border-border bg-[var(--dsw-alias-interactive-bg-hover)]'
/** Leading indicator seat (figma 20×20, radius 6). */
const NUMBER = 'grid size-5 flex-[0_0_20px] place-items-center mt-0.5 rounded-[6px] bg-[var(--dsw-alias-bg-overlay)] text-xs font-medium leading-[18px] text-[var(--dsw-alias-label-secondary)]'
/** Multi-select box: the 14×14 box is drawn by .question-checkbox::before. */
const CHECKBOX = 'question-checkbox size-5 flex-[0_0_20px] mt-0.5'
const CHECKBOX_CHECKED = 'text-[var(--dsw-alias-label-primary-foreground)]'
/** Custom answer row: option-shaped row whose copy is an inline input. */
const CUSTOM_ROW = 'flex w-full min-h-10 flex-shrink-0 items-start gap-2 rounded-[12px] border border-transparent py-2 pl-2 pr-3 transition-colors duration-[120ms] motion-reduce:transition-none hover:bg-[var(--dsw-alias-interactive-bg-hover)] focus-within:border-border focus-within:bg-[var(--dsw-alias-interactive-bg-hover)] max-[720px]:px-1.5'
const CUSTOM_ROW_ACTIVE = 'border-border bg-[var(--dsw-alias-interactive-bg-hover)]'
const CUSTOM_INPUT = 'h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-sm leading-6 text-foreground outline-none shadow-none caret-[var(--dsw-alias-state-business-primary)] focus-visible:ring-0 placeholder:text-[var(--dsw-alias-label-caption)]'
const CUSTOM_TEXTAREA = 'mx-3 block min-h-16 max-h-[140px] w-auto flex-shrink-0 rounded-[10px] border border-border bg-[var(--dsw-alias-bg-module-platform)] px-3 py-2 text-sm leading-6 text-foreground shadow-none outline-none caret-[var(--dsw-alias-state-business-primary)] resize-none focus:border-[var(--dsw-alias-state-business-primary)] focus-visible:ring-0 placeholder:text-[var(--dsw-alias-label-caption)]'
const FOOTER = 'flex flex-shrink-0 items-center justify-between gap-3 mt-3 pl-[18px] pr-2.5 max-[720px]:items-end max-[720px]:px-2.5'

interface DraftAnswer {
  selected: string[]
  custom: string
  skipped: boolean
}

/**
 * Displayed feedback: validation feedback is stored as a dictionary KEY and
 * translated at render, so already-shown feedback follows a locale switch;
 * runtime failure messages (finished strings from the wire) pass through
 * verbatim.
 */
type Feedback = { key: 'error.incomplete' | 'error.unanswered' } | { text: string }

/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** Return whether a text-field key event belongs to an active IME composition. */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  // oxlint-disable-next-line typescript/no-deprecated
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
}

/**
 * Composer takeover boundary; the carrier key keys local drafts, so a
 * same-request replay (same key, new carrier object) preserves them.
 *
 * One takeover, two shapes: a request that declares a presentation intent this
 * package renders takes that shape (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither shape can claim a request the other is already rendering.
 *
 * @param props - the selector-matched pending question carrier plus the framework standard kit.
 * @returns The question flow, or the intent's own surface, for this request.
 */
export function QuestionComposer(props: QuestionComposerProps) {
  // Domain-face mint rides the carrier's stable identity (never minted in a
  // select/render dispatch — per-dispatch minting would churn memo identity).
  const question = useMemo(() => new PendingQuestion(props.matched), [props.matched])
  const review = useMemo(() => planReviewOf(question.questions), [question])
  return review === undefined
    ? <QuestionFlow key={question.key} pending={question} t={props.t} />
    : <PlanReviewPanel key={question.key} pending={question} review={review} t={props.t} />
}

function QuestionFlow({ pending, t }: { pending: PendingQuestion } & Pick<QuestionComposerProps, 't'>) {
  const questions = pending.questions
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() => questions.map(() => ({
    selected: [], custom: '', skipped: false,
  })))
  const [busy, setBusy] = useState<'answer' | 'cancel' | null>(null)
  const [error, setError] = useState<Feedback | null>(null)
  // index stays in bounds (every setIndex site clamps) and drafts mirrors questions 1:1.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const question = questions[index]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const draft = drafts[index]!
  const hasOptions = (question.options?.length ?? 0) > 0

  const cancelFlow = (): void => {
    setBusy('cancel')
    setError(null)
    void pending.cancel().catch((cause: unknown) => {
      setBusy(null)
      setError({ text: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  const updateDraft = (update: (current: DraftAnswer) => DraftAnswer): void => {
    setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? update(item) : item))
    setError(null)
  }

  const choose = (label: string): void => {
    updateDraft((current) => {
      if (question.multiSelect === true) {
        const selected = current.selected.includes(label)
          ? current.selected.filter(item => item !== label)
          : [...current.selected, label]
        return { ...current, selected, skipped: false }
      }
      return { selected: [label], custom: '', skipped: false }
    })
    if (question.multiSelect !== true && index < questions.length - 1) {
      setIndex(current => current + 1)
    }
  }

  const answered = (item: DraftAnswer): boolean =>
    item.selected.length > 0 || item.custom.trim() !== ''

  const completed = (item: DraftAnswer): boolean => answered(item) || item.skipped

  const submitDrafts = (values: DraftAnswer[]): void => {
    const missing = values.findIndex(item => !completed(item))
    if (missing >= 0) {
      setIndex(missing)
      setError({ key: 'error.incomplete' })
      return
    }
    const answer: QuestionAnswer = {
      answers: questions.map((item, itemIndex) => {
        const value = values[itemIndex] as DraftAnswer
        if (value.skipped) return { id: item.id, selected: [] }
        const custom = value.custom.trim()
        return {
          id: item.id,
          selected: custom === '' || item.multiSelect === true ? value.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    setBusy('answer')
    setError(null)
    void pending.answer(answer).catch((cause: unknown) => {
      setBusy(null)
      setError({ text: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  const continueFlow = (): void => {
    if (!answered(draft)) {
      setError({ key: 'error.unanswered' })
      return
    }
    if (index < questions.length - 1) {
      setIndex(current => current + 1)
      setError(null)
      return
    }
    submitDrafts(drafts)
  }

  // Shared by the inline custom input and the optionless textarea: a
  // multi-select draft retains checked labels, while a single-select custom
  // answer replaces its selection. Enter continues the flow (Shift+Enter
  // stays a newline in the textarea; on the single-line input it is inert).
  const draftCustom = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const value = event.target.value
    updateDraft(current => ({
      ...current,
      selected: question.multiSelect === true ? current.selected : [],
      custom: value,
      skipped: false,
    }))
  }

  const continueFromCustom = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    continueFlow()
  }

  const skipQuestion = (): void => {
    const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index
      ? { selected: [], custom: '', skipped: true }
      : item)
    setDrafts(nextDrafts)
    setError(null)
    if (index < questions.length - 1) {
      setIndex(current => current + 1)
      return
    }
    submitDrafts(nextDrafts)
  }

  return (
    <div className={FRAME} data-question-key={pending.key}>
      <section className={CARD} aria-labelledby={`question-${pending.key}-${String(index)}`}>
        <header className={HEADER}>
          <div className="min-w-0">
            {question.header !== undefined && <div className="mb-[5px] text-[11px] leading-4 text-[var(--dsw-alias-label-tertiary)]">{question.header}</div>}
            <h2 className="m-0 text-base font-medium leading-[22px] max-[720px]:text-[15px] max-[720px]:leading-[21px]" id={`question-${pending.key}-${String(index)}`}>
              {question.question}
            </h2>
          </div>
          <ShadcnButton
            variant="ghost" className={ICON_BTN} aria-label={t('nav.cancel')}
            title={t('nav.cancel')}
            disabled={busy !== null} onClick={cancelFlow}
          >
            <IconCloseOutline16 />
          </ShadcnButton>
        </header>

        <div className="flex min-h-0 flex-[1_1_auto] flex-col overflow-y-auto [overscroll-behavior:contain]" data-question-scroll>
          {question.detail !== undefined && (
            <div className="mx-0.5 mb-2 mt-0"><MarkdownText text={question.detail} /></div>
          )}
          <div className="flex flex-col gap-[1px] mt-2 px-3 py-1 max-[720px]:px-2" role={question.multiSelect === true ? 'group' : 'radiogroup'}>
            {(question.options ?? []).map((option, optionIndex) => {
              const selected = draft.selected.includes(option.label)
              const display = parseRecommendedLabel(option.label)
              return (
                <ShadcnButton
                  variant="ghost" key={`${option.label}-${String(optionIndex)}`}
                  className={clsx(OPTION, selected && question.multiSelect !== true && OPTION_SELECTED)}
                  role={question.multiSelect === true ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  aria-label={display.label}
                  disabled={busy !== null}
                  onClick={() => { choose(option.label) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || !drafts.every(completed)) return
                    event.preventDefault()
                    submitDrafts(drafts)
                  }}
                >
                  {question.multiSelect === true
                    ? (
                      <span className={clsx(CHECKBOX, selected && CHECKBOX_CHECKED)} data-checked={selected || undefined} aria-hidden="true">
                        {selected && <IconCheckOutline14 size={12} />}
                      </span>
                    )
                    : <span className={NUMBER}>{optionIndex + 1}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="text-sm font-medium leading-6">{display.label}</span>
                      {display.recommended && (
                        <span className="rounded-[6px] bg-[var(--dsw-specific-sidebar-nav-item-active-accent)] px-1 text-[11px] font-semibold leading-[18px] text-[var(--dsw-alias-button-info-fill)]">{t('option.recommended')}</span>
                      )}
                      {option.description !== undefined && (
                        <span className="text-sm font-normal leading-6 text-[var(--dsw-alias-label-tertiary)]">{option.description}</span>
                      )}
                    </span>
                  </span>
                </ShadcnButton>
              )
            })}

            {hasOptions
              ? (
                <div className={clsx(CUSTOM_ROW, draft.custom !== '' && CUSTOM_ROW_ACTIVE)}>
                  {question.multiSelect === true
                    ? (
                      <span
                        className={clsx(CHECKBOX, draft.custom !== '' && CHECKBOX_CHECKED)}
                        data-checked={draft.custom !== '' || undefined}
                        aria-hidden="true"
                      >
                        {draft.custom !== '' && <IconCheckOutline14 size={12} />}
                      </span>
                    )
                    : (
                      <span className={NUMBER} aria-hidden="true">
                        <IconEditOutline16 size={12} />
                      </span>
                    )}
                  <ShadcnInput
                    type="text"
                    className={CUSTOM_INPUT}
                    value={draft.custom}
                    disabled={busy !== null}
                    placeholder={t('custom.placeholder')}
                    onChange={draftCustom}
                    onKeyDown={continueFromCustom}
                  />
                </div>
              )
              : (
                <Textarea
                  autoFocus
                  className={CUSTOM_TEXTAREA}
                  value={draft.custom}
                  disabled={busy !== null}
                  rows={2}
                  placeholder={t('custom.placeholder')}
                  onChange={draftCustom}
                  onKeyDown={continueFromCustom}
                />
              )}
          </div>
        </div>

        <footer className={FOOTER}>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <ShadcnButton
              variant="ghost" className={ICON_BTN} aria-label={t('nav.prev')}
              disabled={index === 0 || busy !== null}
              onClick={() => { setIndex(index - 1); setError(null) }}
            >
              <IconChevronLeftOutline14 />
            </ShadcnButton>
            <span className="px-1 text-sm font-medium leading-6 whitespace-nowrap text-[var(--dsw-alias-label-secondary)] [word-spacing:-2px]">{index + 1} / {questions.length}</span>
            <ShadcnButton
              variant="ghost" className={ICON_BTN} aria-label={t('nav.next')}
              disabled={index === questions.length - 1 || busy !== null}
              onClick={() => { setIndex(index + 1); setError(null) }}
            >
              <IconChevronRightOutline14 />
            </ShadcnButton>
          </div>
          <div className="min-h-4 flex-1 text-right text-[11px] leading-4 text-[var(--dsw-alias-state-error-primary)]" role="status">
            {error === null ? null : 'key' in error ? t(error.key) : error.text}
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <Button variant="outline" disabled={busy !== null} onClick={skipQuestion}>
              {t('action.skip')}
            </Button>
            <Button
              variant="primary"
              disabled={busy !== null || !answered(draft)} onClick={continueFlow}
            >
              {busy === 'answer'
                ? t('submitting')
                : index === questions.length - 1 ? t('submit') : t('action.next')}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  )
}
