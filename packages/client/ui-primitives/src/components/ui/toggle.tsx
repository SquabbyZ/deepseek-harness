// Shadcn-style Toggle (Radix).
import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cn } from './cn.ts'

export type ToggleVariant = 'default' | 'outline'
export type ToggleSize = 'default' | 'sm' | 'lg'

const VARIANTS: Record<ToggleVariant, string> = {
  default: 'bg-transparent',
  outline: 'border border-input bg-transparent shadow-sm hover:bg-muted hover:text-muted-foreground',
}

const SIZES: Record<ToggleSize, string> = {
  default: 'h-9 px-3',
  sm: 'h-8 px-2.5',
  lg: 'h-10 px-5',
}

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & {
    variant?: ToggleVariant
    size?: ToggleSize
  }
>(({ className, variant = 'default', size = 'default', ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
      VARIANTS[variant],
      SIZES[size],
      className,
    )}
    {...props}
  />
))
Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle }
