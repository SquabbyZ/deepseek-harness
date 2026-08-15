// Pill: small rounded label chip (view switcher tabs, filters, badges).

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './components/ui/cn.ts'

/**
 * Render a pill chip. Interactive when onClick is supplied (renders a button);
 * otherwise a static span.
 * @param props.active - selected/active visual state.
 * @returns pill element.
 */
export function Pill({ active = false, className, children, onClick, ...rest }: {
  active?: boolean
  // `| undefined` so a caller can forward an optional class straight through
  // under exactOptionalPropertyTypes.
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  if (!onClick) {
    return <span className={cn(PILL, active && ACTIVE, className)}>{children}</span>
  }
  return (
    <button
      type="button"
      className={cn(PILL, INTERACTIVE, active && ACTIVE, className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  )
}

const PILL =
  'inline-flex items-center gap-1 h-6 px-2 border-none rounded-[12px] text-xs leading-[18px] text-[var(--dsw-alias-label-secondary)] bg-[var(--dsw-alias-bg-layer-2)]'

const INTERACTIVE = 'cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

const ACTIVE =
  'text-[var(--dsw-alias-label-primary)] bg-[var(--dsw-alias-button-ghost-active-fill)] shadow-[inset_0_0_0_1px_var(--dsw-alias-button-ghost-active-border)]'
