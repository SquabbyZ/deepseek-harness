// TrajectoryTurn: sticky Turn header plus the padded Message/Step body.

import type { ReactNode } from 'react'
import { TrajectoryTurnHeader } from './TrajectoryTurnHeader.tsx'

export interface TrajectoryTurnProps {
  /** 1-based turn index for the sticky header. */
  turn: number
  /** Message / Step headers and TrajectoryCell rows. */
  children?: ReactNode
}

/**
 * Render one turn section (sticky header + body).
 * @param props - turn index and body children.
 * @returns the turn section element.
 */
export function TrajectoryTurn({ turn, children }: TrajectoryTurnProps) {
  return (
    <section className="w-full" data-turn={turn}>
      <TrajectoryTurnHeader turn={turn} />
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-2.5 box-border px-4 pt-2 pb-[22px]">{children}</div>
    </section>
  )
}
