/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, ShadcnButton, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** ToggleButton trigger (figma 313:14108): caption-tone chip, 28px tall. */
const TRIGGER = 'flex h-7 min-w-0 max-w-[220px] cursor-pointer items-center gap-1 rounded-3xl border-none bg-transparent py-0 pl-2 pr-1 text-[13px] font-medium leading-5 text-[var(--dsw-alias-label-secondary)] outline-none hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] hover:enabled:text-[var(--dsw-alias-label-secondary)] focus-visible:shadow-[0_0_0_2px_var(--dsw-alias-border-l3)] focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-default disabled:text-[var(--dsw-alias-label-dimmed)] disabled:opacity-100'
/** MenuDropdown surface (figma 496:26454): r12, inverted hairline, lv3 shadow. */
const MENU = 'absolute bottom-[calc(100%_+_8px)] right-0 z-20 flex max-h-[min(360px,calc(100vh_-_96px))] w-[min(240px,calc(100vw_-_32px))] flex-col overflow-hidden rounded-[12px] border border-[var(--dsw-alias-border-inverted)] bg-[var(--dsw-specific-menu)] p-1 text-foreground shadow-[var(--dsw-shadow-lv3)] [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)]'
/** Quiet status / empty line. */
const STATUS = 'p-2.5 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
/** Error / warning strip base geometry. */
const STRIP = 'mb-1 flex items-start justify-between gap-2 rounded-[8px] px-2 py-[7px] text-xs leading-[18px]'
const ERROR = `${STRIP} bg-[var(--dsw-alias-interactive-bg-hover-danger)] text-[var(--dsw-alias-state-error-primary)]`
const WARNING = `${STRIP} bg-[var(--dsw-alias-bg-module-platform)] text-[var(--dsw-alias-state-warn-label)]`
/** Inline retry verb. */
const RETRY = 'h-auto flex-[0_0_auto] cursor-pointer rounded-none border-none bg-transparent p-0 text-xs font-semibold leading-[18px] text-inherit hover:bg-transparent hover:text-inherit'
/** Drilled-in model / effort option row. */
const OPTION = 'flex w-full min-h-[38px] cursor-pointer items-center gap-2 rounded-[10px] border-none bg-transparent px-2 py-1.5 text-left font-normal text-inherit outline-none hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] hover:enabled:text-inherit focus-visible:bg-[var(--dsw-alias-interactive-bg-hover)] focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-default disabled:text-[var(--dsw-alias-label-dimmed)] disabled:opacity-100'
/** Two-level root cell (figma .Menu_cell). */
const CELL = 'flex h-10 w-full cursor-pointer items-center gap-2 rounded-[10px] border-none bg-transparent px-2.5 py-0 text-left text-sm font-normal leading-[22px] text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-foreground'

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = currentChoice === undefined
    ? t('trigger.selectAria')
    : effortLabel === undefined
      ? t('trigger.aria', { model: modelLabel })
      : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <ShadcnButton
        ref={triggerRef}
        variant="ghost"
        className={TRIGGER}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{modelLabel}</span>
        {effortLabel !== undefined && <span className="flex-[0_0_auto] text-[var(--dsw-alias-label-caption)]">{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx('flex-[0_0_auto] text-[var(--dsw-alias-label-caption)] transition-transform duration-[120ms]', open && 'rotate-180')} />
      </ShadcnButton>

      {open && (
        <div
          id={`${id}-menu`}
          className={MENU}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <ShadcnButton ref={itemRef()} variant="ghost" role="menuitem" className={CELL} onClick={() => { setPane('model') }}>
                <span className="min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap">{t('menu.model')}</span>
                <span className="min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-[var(--dsw-alias-label-tertiary)]">{modelLabel}</span>
                <IconChevronRightOutline14 className="flex-[0_0_auto] text-[var(--dsw-alias-label-tertiary)]" />
              </ShadcnButton>
              {reasoning !== undefined && (
                <ShadcnButton ref={itemRef()} variant="ghost" role="menuitem" className={CELL} onClick={() => { setPane('effort') }}>
                  <span className="min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap">{t('menu.effort')}</span>
                  <span className="min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-[var(--dsw-alias-label-tertiary)]">{effortLabel}</span>
                  <IconChevronRightOutline14 className="flex-[0_0_auto] text-[var(--dsw-alias-label-tertiary)]" />
                </ShadcnButton>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={STATUS}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={ERROR}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <ShadcnButton variant="ghost" className={RETRY} onClick={reload}>{t('retry')}</ShadcnButton>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={WARNING} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <ShadcnButton variant="ghost" className={RETRY} onClick={reload}>{t('retry')}</ShadcnButton>
                </div>
              ))}
              <div className={clsx('min-h-0 space-y-1 overflow-y-auto', 'scrollable')}>
                {state.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className="min-w-0" key={group.id}>
                      <div className="sticky top-0 z-[1] bg-[var(--dsw-specific-menu)] px-2 pb-[3px] pt-[5px] text-xs font-medium leading-[18px] text-[var(--dsw-alias-label-tertiary)]" id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = state.current?.provider === group.id && state.current.model === model.id
                        return (
                          <ShadcnButton
                            ref={itemRef()}
                            variant="ghost"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={OPTION}
                            key={model.id}
                            title={model.name}
                            disabled={busy}
                            onClick={() => { choose({ provider: group.id, model: model.id }) }}
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5 text-inherit">{model.name}</span>
                              {model.description !== undefined && (
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]">{model.description}</span>
                              )}
                            </span>
                            <span className="grid flex-[0_0_18px] place-items-center text-foreground">
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </ShadcnButton>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={STATUS}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={ERROR}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <ShadcnButton variant="ghost" className={RETRY} onClick={reload}>{t('action.reload')}</ShadcnButton>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={STATUS}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <ShadcnButton
                    ref={itemRef()}
                    variant="ghost"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={OPTION}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5 text-inherit">{level.label}</span>
                      {level.description !== undefined && (
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]">{level.description}</span>
                      )}
                    </span>
                    <span className="grid flex-[0_0_18px] place-items-center text-foreground">
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </ShadcnButton>
                ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
