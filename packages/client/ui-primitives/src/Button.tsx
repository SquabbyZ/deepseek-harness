// Button: token-styled button atom, now rendered with Tailwind utilities
// (arbitrary-value `var(--dsw-alias-*)` refs preserve the exact token values)
// instead of CSS Modules. The public API is unchanged: same variant/size/icon
// props, so every consuming package is unaffected.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './components/ui/cn.ts'

/** Visual variant, each backed by its --dsw-alias-button-* token family. */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

/**
 * Render a button.
 * @param props.variant - visual family (default 'ghost').
 * @param props.size - 'md' 36px capsule (figma Button) or 'sm' 28px compact.
 * @param props.icon - optional leading 16px icon node.
 * @returns the button element; native button attributes pass through.
 */
export function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }: {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  icon?: ReactNode
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...rest}>
      {icon != null && <span className="inline-flex size-4 items-center justify-center">{icon}</span>}
      {children}
    </button>
  )
}

const BASE =
  'inline-flex items-center justify-center gap-1 border-none rounded-[18px] cursor-pointer text-sm leading-[22px] text-[var(--dsw-alias-label-primary)] bg-transparent px-[14px] disabled:cursor-not-allowed disabled:opacity-40'

const SIZES: Record<'md' | 'sm', string> = {
  md: 'h-9',
  sm: 'h-7 px-2.5 text-xs leading-[18px] rounded-[14px]',
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--dsw-alias-button-primary-fill)] text-[var(--dsw-alias-label-primary-foreground)] hover:bg-[var(--dsw-static-neutral-bluish-750)]',
  ghost:
    'hover:bg-[var(--dsw-alias-interactive-bg-hover)] active:bg-[var(--dsw-alias-interactive-bg-active)]',
  outline: 'border border-[var(--dsw-alias-border-l2)] hover:bg-[var(--dsw-alias-interactive-bg-hover)]',
  toolbar:
    'bg-[var(--dsw-alias-button-tool-bar-fill)] hover:bg-[var(--dsw-alias-button-tool-bar-hover)]',
}
