// Shadcn-style Button (spike): Tailwind-utility-styled atom, additive to the
// existing token-styled Button in ../Button.tsx. Uses the shadcn theme color
// utilities wired to --dsw-* tokens in packages/client/web/src/globals.css.

import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn.ts'

export type ShadcnButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive'
export type ShadcnButtonSize = 'default' | 'sm' | 'lg' | 'icon'

export interface ShadcnButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ShadcnButtonVariant
  size?: ShadcnButtonSize
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

const variants: Record<ShadcnButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-muted hover:text-muted-foreground',
  outline: 'border border-input bg-transparent hover:bg-muted hover:text-muted-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}

const sizes: Record<ShadcnButtonSize, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-10 rounded-md px-6',
  icon: 'h-9 w-9',
}

export function ShadcnButton({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ShadcnButtonProps) {
  return <button type="button" className={cn(base, variants[variant], sizes[size], className)} {...props} />
}
