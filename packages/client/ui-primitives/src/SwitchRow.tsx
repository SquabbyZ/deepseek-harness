// SwitchRow: a one-line toggle row shared by the plugin / skill / mcp / agent
// lists. The label is the entity's display name, the caption is its current
// fiber-phase or status sentence, the optional status dot carries fiber state,
// and the switch is a Radix Switch bound to the entry's effective enabled
// state. Optional error and pending flags drive the row's visual affordance.

import type { ReactNode } from 'react'
import { Switch } from './components/ui/switch.tsx'
import { StatusDot, type StatusDotPhase } from './StatusDot.tsx'
import { cn } from './components/ui/cn.ts'

const ROOT =
  'group flex w-full min-w-0 items-center justify-between gap-3 rounded-[10px] border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-alias-bg-layer-1)] px-3 py-2.5 data-[state=error]:border-[var(--dsw-alias-state-error-primary)] data-[state=error]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--dsw-alias-state-error-primary)_22%,transparent)] data-[state=pending]:opacity-80 motion-safe:transition-colors'

const LEADING = 'flex min-w-0 items-center gap-2.5'

const LABEL_GROUP = 'flex min-w-0 flex-col'

const LABEL =
  'm-0 truncate text-sm leading-5 font-semibold text-[var(--dsw-alias-label-primary)]'

const CAPTION =
  'm-0 truncate text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'

const TRAILING = 'inline-flex flex-none items-center gap-2'

const STATUS_LIKE = 'text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'

/**
 * Render a one-line switch row.
 * @param props.label - primary display text (the entry's short name).
 * @param props.caption - secondary text describing current state.
 * @param props.checked - switch state (effective enabled).
 * @param props.disabled - whether the switch is disabled.
 * @param props.phase - optional fiber phase to render alongside the caption.
 * @param props.pending - true while a debounced commit is in flight; renders a pending state.
 * @param props.error - true to flash the row red after a failed commit.
 * @param props.entryId - forwarded to `data-entry-id` for e2e selectors.
 * @param props.onCheckedChange - called when the user toggles the switch.
 * @returns the row element.
 */
export function SwitchRow({
  label,
  caption,
  checked,
  disabled = false,
  phase,
  pending = false,
  error = false,
  entryId,
  onCheckedChange,
  className,
}: {
  label: ReactNode
  caption?: ReactNode
  checked: boolean
  disabled?: boolean | undefined
  phase?: StatusDotPhase | undefined
  pending?: boolean | undefined
  error?: boolean | undefined
  entryId?: string | undefined
  onCheckedChange: (checked: boolean) => void
  className?: string | undefined
}) {
  const state: 'error' | 'pending' | 'idle' = error ? 'error' : pending ? 'pending' : 'idle'
  return (
    <div
      className={cn(ROOT, className)}
      data-entry-id={entryId}
      data-state={state === 'idle' ? undefined : state}
    >
      <div className={LEADING}>
        {phase !== undefined ? <StatusDot phase={phase} tooltip={typeof caption === 'string' ? caption : undefined} /> : null}
        <div className={LABEL_GROUP}>
          <p className={LABEL} title={typeof label === 'string' ? label : undefined}>{label}</p>
          {caption !== undefined && caption !== null ? <p className={CAPTION}>{caption}</p> : null}
        </div>
      </div>
      <div className={TRAILING}>
        {state === 'pending' ? <span className={STATUS_LIKE} data-pending="true">…</span> : null}
        <Switch
          checked={checked}
          disabled={disabled || pending}
          onCheckedChange={onCheckedChange}
          aria-label={typeof label === 'string' ? label : undefined}
        />
      </div>
    </div>
  )
}
