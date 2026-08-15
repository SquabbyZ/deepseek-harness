// Shadcn-style Badge: small status pill. Tailwind utilities resolve through
// the --dsw-* semantic tokens (globals.css maps --primary/--secondary/--destructive
// to the design tokens), so variants render in the ui-primitives theme.
import type { HTMLAttributes } from 'react'
import { cn } from './cn.ts'

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant
}

const BASE =
  'inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const VARIANTS: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
  secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
  destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
  outline: 'text-foreground',
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <div className={cn(BASE, VARIANTS[variant], className)} {...props} />
}
