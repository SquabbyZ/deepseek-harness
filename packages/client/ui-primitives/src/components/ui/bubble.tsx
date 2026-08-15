// Shadcn-style Bubble: chat message bubble primitive.
// Ported from shadcn/ui new-york-v4 registry. Styled with the shadcn semantic
// color utilities wired to --dsw-* tokens in globals.css (upstream
// color-mix/oklch tint formulas swapped for semantic opacity utilities).

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from './cn.ts'

export type BubbleVariant = 'default' | 'secondary' | 'muted' | 'tinted' | 'outline' | 'ghost' | 'destructive'
export type BubbleAlign = 'start' | 'end'
export type BubbleReactionsSide = 'top' | 'bottom'
export type BubbleReactionsAlign = 'start' | 'end'

const BubbleGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="bubble-group" className={cn('flex min-w-0 flex-col gap-2', className)} {...props} />
  ),
)
BubbleGroup.displayName = 'BubbleGroup'

const BUBBLE_BASE =
  'group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full'

const BUBBLE_VARIANTS: Record<BubbleVariant, string> = {
  default:
    '*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/80',
  secondary:
    '*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-secondary/80',
  muted:
    '*:data-[slot=bubble-content]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/80',
  tinted:
    '*:data-[slot=bubble-content]:bg-primary/10 *:data-[slot=bubble-content]:text-foreground dark:*:data-[slot=bubble-content]:bg-primary/20 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/15 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/25',
  outline:
    '*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-input/30',
  ghost:
    'border-none *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/50',
  destructive:
    '*:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-destructive dark:*:data-[slot=bubble-content]:bg-destructive/20 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30',
}

const Bubble = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { variant?: BubbleVariant; align?: BubbleAlign }
>(({ variant = 'default', align = 'start', className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="bubble"
    data-variant={variant}
    data-align={align}
    className={cn(BUBBLE_BASE, BUBBLE_VARIANTS[variant], className)}
    {...props}
  />
))
Bubble.displayName = 'Bubble'

const BubbleContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { asChild?: boolean }
>(({ asChild = false, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={ref}
      data-slot="bubble-content"
      className={cn(
        'w-fit max-w-full min-w-0 overflow-hidden rounded-xl border border-transparent px-3 py-2 text-sm leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-3 [button,a]:focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  )
})
BubbleContent.displayName = 'BubbleContent'

const BUBBLE_REACTIONS_BASE =
  'absolute z-10 flex w-fit shrink-0 items-center justify-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-sm ring-3 ring-card has-[button]:p-0'

const BUBBLE_REACTIONS_SIDES: Record<BubbleReactionsSide, string> = {
  top: 'top-0 -translate-y-3/4',
  bottom: 'bottom-0 translate-y-3/4',
}

const BUBBLE_REACTIONS_ALIGNS: Record<BubbleReactionsAlign, string> = {
  start: 'left-3',
  end: 'right-3',
}

const BubbleReactions = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { align?: BubbleReactionsAlign; side?: BubbleReactionsSide }
>(({ side = 'bottom', align = 'end', className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="bubble-reactions"
    data-align={align}
    data-side={side}
    className={cn(BUBBLE_REACTIONS_BASE, BUBBLE_REACTIONS_SIDES[side], BUBBLE_REACTIONS_ALIGNS[align], className)}
    {...props}
  />
))
BubbleReactions.displayName = 'BubbleReactions'

export { BubbleGroup, Bubble, BubbleContent, BubbleReactions }
