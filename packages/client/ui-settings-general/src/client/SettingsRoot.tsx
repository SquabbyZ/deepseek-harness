/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — every piece of text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve to that content (trigger: its own text; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import {
  IconAgentPresetOutline16, IconCloseOutline16, IconDataOutline16,
  IconPersonalizationOutline16, IconSettingsOutline16, ShadcnButton, Sheet,
  SheetContent, SheetTitle, cn,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'

/** Trigger pill: compact content-width row (icon + label). */
const TRIGGER_BASE =
  'flex-none flex h-[34px] items-center gap-2 overflow-hidden rounded-xl border-none bg-transparent px-2.5 py-1.5 text-sm leading-[22px] text-foreground cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

/** Rail trigger: the same 36x36 circle box as the other rail controls. */
const TRIGGER_RAIL =
  'mt-2 mb-[10px] h-9 w-9 justify-center gap-0 rounded-full p-0'

/** Nav cell (figma .Setting-nav-cell): 164x40, r12, 14/400 lh22. */
const NAV_CELL_BASE =
  'flex h-10 items-center gap-2 rounded-xl border-none bg-transparent py-[9px] pl-3 pr-4 text-left text-sm leading-[22px] font-normal text-foreground hover:bg-[var(--dsw-specific-sidebar-nav-item-hover)]'

const NAV_CELL_ACTIVE = 'bg-[var(--dsw-specific-sidebar-nav-item-active)]'

/** Close button (figma .Icon_container): 28x28, r28, 14px glyph. */
const CLOSE_BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-[28px] border-none bg-transparent p-0 text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className="flex-none" size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className="flex-none" size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className="flex-none" size={16} />
  return <IconSettingsOutline16 className="flex-none" size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
  open: boolean
}

/**
 * The settings panel as a right-side drawer (shadcn Sheet): full-height and
 * side-anchored with the section nav rail. Mask click, Escape, and focus
 * management are the Radix dialog's own, so the panel stays thin.
 */
function SettingsPanel({ rows, renderSlot, activeId, onSelect, onClose, open }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  const titleId = useId()

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        hideClose
        className="w-[560px] max-w-[calc(100vw_-_16px)] sm:max-w-none gap-0 bg-[var(--dsw-alias-bg-overlay)] p-0 shadow-[var(--dsw-shadow-lv3)] [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)]"
      >
        <SheetTitle className="sr-only">{renderSlot('settings.header', {})}</SheetTitle>
        <div className="flex h-full">
          <nav className="flex-none flex w-[188px] flex-col gap-[18px] px-3 pt-[22px]">
            <div className="px-3 text-base leading-6 font-medium text-foreground" id={titleId}>{renderSlot('settings.header', {})}</div>
            <div className="flex flex-col gap-1">
              {rows.map(row => (
                <ShadcnButton
                  key={row.id}
                  variant="ghost"
                  className={cn(NAV_CELL_BASE, row.id === active && NAV_CELL_ACTIVE)}
                  aria-current={row.id === active ? 'true' : undefined}
                  onClick={() => { onSelect(row.id) }}
                >
                  {navIcon(row.id)}
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{row.label}</span>
                </ShadcnButton>
              ))}
            </div>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-none flex h-[54px] items-start justify-between gap-2 pt-5 pr-[14px] pb-2 pl-2.5">
              <div className="ml-auto flex min-w-0 items-center justify-end gap-2">{renderSlot('settings.action', {})}</div>
              <ShadcnButton variant="ghost" className={CLOSE_BUTTON} onClick={onClose}>
                <IconCloseOutline16 size={14} />
                <span className="sr-only">{renderSlot('settings.close', {})}</span>
              </ShadcnButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const { wide, useSections, useOnboardingSteps, useSessions, renderSlot } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
  }, [])
  const openSection = useCallback((id: string) => {
    setActiveId(id)
    setOpen(true)
  }, [])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  return (
    <>
      <ShadcnButton
        variant="ghost"
        className={cn(TRIGGER_BASE, !wide && TRIGGER_RAIL)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        {renderSlot('settings.trigger', { wide })}
      </ShadcnButton>
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={close}
          open={open}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
