import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseFill14, ShadcnButton } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat and
// its {locked} owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PlanChipInjected } from './index.ts'

/** Active plan warn-state pill (figma). */
const CHIP = 'inline-flex min-w-[34px] cursor-pointer items-center gap-1 rounded-full border-none bg-[var(--dsw-alias-state-warn-tertiary)] px-2 py-0.5 text-[13px] font-medium leading-5 text-[var(--dsw-alias-state-warn-label)] hover:enabled:bg-[var(--dsw-alias-state-warn-tertiary)] hover:enabled:text-[var(--dsw-alias-state-warn-primary)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--dsw-alias-state-warn-label)] focus-visible:outline-offset-2 focus-visible:ring-0 disabled:pointer-events-auto disabled:cursor-default disabled:opacity-60'

/** Full plan-seat component props: runtime share (standard kit + locked owner prop) & injected share & the locale seat. */
export type PlanChipProps =
  PropsRuntime<'conversation.input.plan'> & InjectFace<PlanChipInjected> & PropsLocale<'plan'>

/**
 * Plan-mode status over the host-computed `plan` projection. The chip renders
 * only while the effective target is plan mode (`pending ? !active : active`
 * — a folded host value, not client optimism) and executes /plan off.
 */
export function PlanChip({ useProjection, locked, exitPlanMode, t }: PlanChipProps) {
  const plan = useProjection('plan')
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (plan === undefined) return null
  const target = plan.pending ? !plan.active : plan.active
  if (!target) return null

  const off = (): void => {
    // No leaving/locked guard: both disable the button, so no click arrives.
    setLeaving(true)
    setError(null)
    void exitPlanMode().then((failure) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <ShadcnButton
        variant="ghost"
        className={CHIP}
        aria-label={t('chip.on.aria')}
        title={t('chip.on.title')}
        disabled={locked || leaving}
        onClick={off}
      >
        {/* Design literal, not copy: the chip wordmark stays 'Plan' in every locale. */}
        Plan
        <span className="inline-flex items-center text-current" aria-hidden>
          <IconCloseFill14 size={12} />
        </span>
      </ShadcnButton>
      {/* Failure copy stays English (error-surface policy: not localized). */}
      {error !== null && <span className="text-xs leading-[18px] text-[var(--dsw-alias-state-error-primary)]" role="status" title={error}>failed to exit plan mode</span>}
    </span>
  )
}
