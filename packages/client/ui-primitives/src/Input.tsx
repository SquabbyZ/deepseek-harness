// Input: single-line text input atom (search boxes, inline forms). Composer
// textareas are NOT this atom — they live with the conversation package.

import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from './components/ui/cn.ts'

/**
 * Render a text input with an optional leading icon.
 * @param props.icon - optional 16px leading icon node.
 * @returns wrapper span containing the native input; input attributes pass through.
 */
export function Input({ icon, className, ...rest }: {
  icon?: ReactNode
  className?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cn(WRAP, className)}>
      {icon != null && <span className={ICON}>{icon}</span>}
      <input className={INPUT} {...rest} />
    </span>
  )
}

const WRAP =
  'inline-flex items-center gap-1.5 h-8 px-2 border border-[var(--dsw-alias-border-l2)] rounded-[8px] bg-[var(--dsw-alias-bg-layer-1)] focus-within:border-[var(--dsw-alias-brand-primary)]'

const ICON = 'inline-flex size-4 items-center justify-center text-[var(--dsw-alias-label-tertiary)]'

const INPUT =
  'flex-1 min-w-0 border-none outline-none bg-transparent text-sm leading-[22px] text-[var(--dsw-alias-label-primary)] placeholder:text-[var(--dsw-alias-label-dimmed)]'
