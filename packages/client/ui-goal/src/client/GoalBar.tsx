/**
 * GoalBar: the goal indicator docked above the message composer (input dock
 * strip). A present goal shows a goal glyph, a phase label, the truncated
 * objective, and icon actions — resume when paused, edit (inline form in the
 * same strip), and clear. Goal creation lives on the `/goal` command, not
 * here: loading (undefined), no goal (null), and complete goals render
 * nothing. Live state arrives as the projected whole snapshot; the verbs are
 * the injected face.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoalSnapshot } from '@deepseek-ai/dsh-goal/client'
import {
  IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconGoalOutline16,
  IconPauseOutline16, IconPlayOutline16, IconTrashOutline16, ShadcnButton, ShadcnInput, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalActionResult, GoalBarActions } from './slots.ts'
import type { GoalKey } from './locales.ts'

/** Dock column (card cap minus the four dock insets; matches Todo / Queue). */
const DOCK = 'box-border mx-auto w-[calc(100%_-_2*var(--dsh-composer-side-clearance)_-_4*var(--dsh-composer-dock-inset))]'
/** The goal strip card (figma 1236:32276): hairline tip surface, 36px tall. */
const BAR = 'box-border mx-auto flex h-9 w-full max-w-[calc(var(--dsh-composer-card-max-width)_-_4*var(--dsh-composer-dock-inset))] items-center gap-2.5 rounded-[12px] border border-[var(--dsw-alias-border-l1)] bg-[var(--dsw-specific-tip)] py-1 pl-3 pr-[5px]'
/** Round icon action in the strip's trailing cluster. */
const ICON_BTN = 'size-7 flex-none rounded-full border-none bg-transparent p-0 text-[var(--dsw-alias-label-tertiary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-secondary)] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40'

export interface GoalBarProps extends GoalBarActions {
  /** Current goal snapshot; undefined = capability absent or loading, null = no goal set. */
  goal: GoalSnapshot | null | undefined
}

/** Strip label keys per visible phase; complete goals render nothing. */
const PHASE_LABELS = {
  active: 'phase.active',
  paused: 'phase.paused',
  blocked: 'phase.blocked',
} as const satisfies Record<string, GoalKey>

export function GoalBar({ goal, onEdit, onPause, onResume, onClear, t }: GoalBarProps & PropsLocale<'goal'>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [clearedGoalId, setClearedGoalId] = useState<GoalSnapshot['id'] | null>(null)
  const pendingRef = useRef(false)

  // A new goal identity (cleared/completed/replaced externally) invalidates the local edit
  // state: without the reset a surviving draft's Enter would write over the NEW goal.
  const goalId = goal?.id
  useEffect(() => {
    setEditing(false)
    setActionError(null)
    setClearedGoalId(null)
  }, [goalId])

  // React state disables the controls on the next render; the ref closes the
  // same-render window so rapid clicks cannot submit the same CAS twice.
  const runAction = useCallback(async (action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    const result = await action()
    pendingRef.current = false
    setPending(false)
    if (!result.ok) setActionError(`${result.error.message} (${result.error.code})`)
    return result
  }, [])

  const handleEdit = useCallback(async () => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    const result = await runAction(() => onEdit(trimmed))
    if (result?.ok) setEditing(false)
  }, [draft, onEdit, runAction])

  const handleClear = useCallback(async (clearedId: GoalSnapshot['id']) => {
    const result = await runAction(onClear)
    if (result?.ok) setClearedGoalId(clearedId)
  }, [onClear, runAction])

  // Loading, absent, and complete goals have no strip at all.
  if (goal === undefined || goal === null || goal.phase === 'complete' || goal.id === clearedGoalId) return null

  if (editing) {
    return (
      <div className={DOCK} data-goal-bar>
        <div className={BAR}>
          <ShadcnInput
            className="h-[26px] min-w-0 flex-1 rounded-[6px] border-border bg-background px-2 py-0 text-[13px] leading-5 text-foreground outline-none shadow-none placeholder:text-[var(--dsw-alias-label-caption)] focus:border-[var(--dsw-alias-state-business-primary)] focus-visible:ring-0"
            type="text"
            aria-label={t('objective.aria')}
            value={draft}
            onChange={(e) => { setDraft(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
            autoFocus
          />
          {actionError !== null && <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[var(--dsw-alias-state-error-primary)]" role="alert">{actionError}</span>}
          <div className="flex flex-none items-center gap-2.5">
            <Tooltip label={t('action.save')} side="bottom" delayMs={500}>
              <ShadcnButton
                variant="ghost"
                className={ICON_BTN}
                onClick={() => { void handleEdit() }}
                disabled={pending || draft.trim() === ''}
                aria-label={t('action.save')}
              >
                <IconCheckOutline16 size={14} />
              </ShadcnButton>
            </Tooltip>
            <Tooltip label={t('action.cancel')} side="bottom" delayMs={500}>
              <ShadcnButton
                variant="ghost"
                className={ICON_BTN}
                onClick={() => { setEditing(false) }}
                disabled={pending}
                aria-label={t('action.cancel')}
              >
                <IconCloseOutline16 size={14} />
              </ShadcnButton>
            </Tooltip>
          </div>
        </div>
      </div>
    )
  }

  const title = goal.phase === 'blocked' ? goal.blockedReason?.message : undefined
  return (
    <div className={DOCK} data-goal-bar>
      <div className={BAR} title={title}>
        <span className="inline-flex flex-none text-[var(--dsw-alias-label-tertiary)]"><IconGoalOutline16 size={14} /></span>
        <span className="flex-none text-[13px] leading-6 font-medium text-foreground">{t(PHASE_LABELS[goal.phase])}</span>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-5 text-[var(--dsw-alias-label-primary-dimmed)]">{goal.objective}</span>
        {actionError !== null && <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[var(--dsw-alias-state-error-primary)]" role="alert">{actionError}</span>}
        <div className="flex flex-none items-center gap-2.5">
          {goal.phase === 'active' && (
            <Tooltip label={t('action.pause')} side="bottom" delayMs={500}>
              <ShadcnButton variant="ghost" className={ICON_BTN} disabled={pending} onClick={() => { void runAction(onPause) }} aria-label={t('action.pause')}>
                <IconPauseOutline16 size={14} />
              </ShadcnButton>
            </Tooltip>
          )}
          {goal.phase === 'paused' && (
            <Tooltip label={t('action.resume')} side="bottom" delayMs={500}>
              <ShadcnButton variant="ghost" className={ICON_BTN} disabled={pending} onClick={() => { void runAction(onResume) }} aria-label={t('action.resume')}>
                <IconPlayOutline16 size={14} />
              </ShadcnButton>
            </Tooltip>
          )}
          <Tooltip label={t('action.edit')} side="bottom" delayMs={500}>
            <ShadcnButton
              variant="ghost"
              className={ICON_BTN}
              disabled={pending}
              onClick={() => { setDraft(goal.objective); setEditing(true) }}
              aria-label={t('action.edit')}
            >
              <IconEditOutline16 size={14} />
            </ShadcnButton>
          </Tooltip>
          <Tooltip label={t('action.clear')} side="bottom" delayMs={500}>
            <ShadcnButton variant="ghost" className={ICON_BTN} disabled={pending} onClick={() => { void handleClear(goal.id) }} aria-label={t('action.clear')}>
              <IconTrashOutline16 size={14} />
            </ShadcnButton>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

/** Full props of the dock entry: InputZone owner share + session standard kit + injected verbs + the locale seat. */
export type GoalDockProps = import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'> & GoalBarActions & PropsLocale<'goal'>

/** Dock adapter: reads the host-computed 'goal' projection (whole value; absent or null renders nothing). */
export function GoalDock({ useProjection, onEdit, onPause, onResume, onClear, t }: GoalDockProps) {
  const projection = useProjection('goal')
  return (
    <GoalBar
      goal={projection === undefined ? undefined : projection === null ? null : projection.goal}
      onEdit={onEdit}
      onPause={onPause}
      onResume={onResume}
      onClear={onClear}
      t={t}
    />
  )
}
