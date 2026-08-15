// StateDot: session state indicator (figma nodes 14:3303/3305/3312, 122:9182).
// done/warning/error: 10x10 halo (same color, 10% opacity) around a 6x6 solid
// core. ongoing: a pixel-art chase — the 8 outer cells of a 3x3 matrix light
// up clockwise with a stepped trail. Colors resolve through --dsw-* tokens only.

import { cn } from './components/ui/cn.ts'

/** Four-color state semantic (green done / amber user-attention / blue running ring / red error). */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error'

/** Outer 3x3 matrix cells (2px pixels on a 10px grid), clockwise from top-left. */
const MATRIX_CELLS: readonly (readonly [number, number])[] = [
  [0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4],
]

/** Solid-state dot: inline-block host for the ::before/::after halo + core. */
const DOT = 'state-dot relative inline-block flex-none'
/** Ongoing blue has no alias token (state-business-primary is the 500 step, not
 * this 450) — pinned to the static scale instead. */
const MATRIX = 'flex-none text-[var(--dsw-static-deepseek-450)]'
/** Per-state color for the solid dot; the halo/core ride currentColor. */
const DOT_STATE: Record<Exclude<StateDotState, 'ongoing'>, string> = {
  done: 'data-[state=done]:text-[var(--dsw-alias-state-success-primary)]',
  warning: 'data-[state=warning]:text-[var(--dsw-alias-state-warn-primary)]',
  error: 'data-[state=error]:text-[var(--dsw-alias-state-error-primary)]',
}

/**
 * Render a state dot.
 * @param props.state - which of the four states to show.
 * @param props.size - outer diameter in px (default 10, the figma size).
 * @param props.className - extra class for layout placement.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
export function StateDot({ state, size = 10, className }: {
  state: StateDotState
  size?: number | undefined
  className?: string | undefined
}) {
  if (state === 'ongoing') {
    return (
      <svg
        className={cn(MATRIX, className)}
        data-state="ongoing"
        width={size}
        height={size}
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {MATRIX_CELLS.map(([x, y], index) => (
          <rect
            key={`${x}-${y}`}
            className="state-dot-cell"
            x={x}
            y={y}
            width="2"
            height="2"
            /* Negative delay phases the chase so every cell animates from mount. */
            style={{ animationDelay: `${(index - MATRIX_CELLS.length) * 125}ms` }}
          />
        ))}
      </svg>
    )
  }
  return (
    <span
      className={cn(DOT, DOT_STATE[state], className)}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
