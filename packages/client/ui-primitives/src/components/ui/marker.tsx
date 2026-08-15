// Shadcn-style Marker: small labelled divider/annotation between chat turns.
// Ported from shadcn/ui new-york-v4 registry. Styled with the shadcn semantic
// color utilities wired to --dsw-* tokens in globals.css.

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from './cn.ts'

export type MarkerVariant = 'default' | 'separator' | 'border'

const MARKER_BASE =
  'group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*="size-"])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground'

const MARKER_VARIANTS: Record<MarkerVariant, string> = {
  default: '',
  separator:
    'before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border',
  border: 'border-b border-border pb-2',
}

const Marker = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { variant?: MarkerVariant; asChild?: boolean }
>(({ className, variant = 'default', asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={ref}
      data-slot="marker"
      data-variant={variant}
      className={cn(MARKER_BASE, MARKER_VARIANTS[variant], className)}
      {...props}
    />
  )
})
Marker.displayName = 'Marker'

const MarkerIcon = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn('size-4 shrink-0 [&_svg:not([class*="size-"])]:size-4', className)}
      {...props}
    />
  ),
)
MarkerIcon.displayName = 'MarkerIcon'

const MarkerContent = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="marker-content"
      className={cn(
        'min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  ),
)
MarkerContent.displayName = 'MarkerContent'

export { Marker, MarkerIcon, MarkerContent, MARKER_VARIANTS }
