// StatusDot: a small fiber-phase indicator (active/loading/failed/pending/unloading).
// Distinct from StateDot, which carries a four-color semantic (done/warning/ongoing/error).
// Both render a 7px dot but use different color aliases, so they are not interchangeable.

import { cn } from './components/ui/cn.ts'

/** Six-state fiber phase plus the unobserved null branch. */
export type StatusDotPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Default size (matches the existing plugin-inventory card grid). */
const DEFAULT_SIZE = 7

/** Color alias per phase. */
const PHASE_COLOR: Record<Exclude<StatusDotPhase, null>, string> = {
  active: 'data-[phase=active]:bg-[var(--dsw-alias-state-success-primary)]',
  loading: 'data-[phase=loading]:bg-[var(--dsw-alias-state-business-primary)]',
  failed: 'data-[phase=failed]:bg-[var(--dsw-alias-state-error-primary)]',
  pending: 'data-[phase=pending]:bg-[var(--dsw-alias-label-tertiary)]',
  unloading: 'data-[phase=unloading]:bg-[var(--dsw-alias-state-warn-primary)]',
}

const ROOT = 'inline-block flex-none rounded-full'

/**
 * Render a fiber-phase dot.
 * @param props.phase - the fiber phase; `null` renders the muted tertiary color.
 * @param props.size - outer diameter in px (default 7).
 * @param props.className - extra class for layout placement.
 * @param props.tooltip - optional title text; the parent can pass an aria-label separately.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
export function StatusDot({
  phase,
  size = DEFAULT_SIZE,
  className,
  tooltip,
}: {
  phase: StatusDotPhase
  size?: number | undefined
  className?: string | undefined
  tooltip?: string | undefined
}) {
  const colorClass = phase === null ? '' : PHASE_COLOR[phase]
  return (
    <span
      className={cn(ROOT, colorClass, className)}
      data-phase={phase ?? 'unobserved'}
      style={{ width: size, height: size }}
      title={tooltip}
      aria-hidden="true"
    />
  )
}
