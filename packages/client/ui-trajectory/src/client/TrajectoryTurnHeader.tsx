// TrajectoryTurnHeader: sticky per-turn bar with Input/Output/Think/Time labels.

const COLUMN_LABELS = ['Input', 'Output', 'Think', 'Time'] as const

export interface TrajectoryTurnHeaderProps {
  /** 1-based turn index shown as `Turn N`. */
  turn: number
}

/**
 * Render the sticky turn header row.
 * @param props.turn - turn index.
 * @returns the sticky header element.
 */
export function TrajectoryTurnHeader({ turn }: TrajectoryTurnHeaderProps) {
  return (
    <div className="sticky top-0 z-[1] h-11 w-full box-border bg-[var(--dsw-alias-button-ghost-active-fill)]">
      <div className="mx-auto flex h-full w-full max-w-[880px] items-center justify-between box-border px-4">
        <span className="flex-none text-foreground [font:var(--dsw-font-xs-strong-13)]">Turn {turn}</span>
        <div className="mr-2 flex w-80 flex-none items-center gap-3" aria-hidden="true">
          {COLUMN_LABELS.map(label => (
            <span key={label} className="w-[71px] flex-none text-left text-[var(--dsw-alias-label-secondary)] [font:var(--dsw-font-xs-13)]">{label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
