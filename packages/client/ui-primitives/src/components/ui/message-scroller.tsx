// Shadcn-style MessageScroller: auto-scrolling chat viewport built on
// `@shadcn/react/message-scroller` (shadcn's new runtime). Ported from the
// shadcn/ui new-york-v4 registry; upstream `lucide-react` ArrowDownIcon is
// swapped for the ui-primitives chevron-down glyph.

import * as React from 'react'
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller'
import { IconChevronDownOutline14 } from '../../icons/index.tsx'
import { cn } from './cn.ts'
import { ShadcnButton as Button } from './button.tsx'

function MessageScrollerProvider(props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider {...props} />
}
MessageScrollerProvider.displayName = 'MessageScrollerProvider'

const MessageScroller = React.forwardRef<
  React.ElementRef<typeof MessageScrollerPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MessageScrollerPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MessageScrollerPrimitive.Root
    ref={ref}
    data-slot="message-scroller"
    className={cn('group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden', className)}
    {...props}
  />
))
MessageScroller.displayName = 'MessageScroller'

const MessageScrollerViewport = React.forwardRef<
  React.ElementRef<typeof MessageScrollerPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof MessageScrollerPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <MessageScrollerPrimitive.Viewport
    ref={ref}
    data-slot="message-scroller-viewport"
    className={cn(
      'size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-none',
      className,
    )}
    {...props}
  />
))
MessageScrollerViewport.displayName = 'MessageScrollerViewport'

const MessageScrollerContent = React.forwardRef<
  React.ElementRef<typeof MessageScrollerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MessageScrollerPrimitive.Content>
>(({ className, ...props }, ref) => (
  <MessageScrollerPrimitive.Content
    ref={ref}
    data-slot="message-scroller-content"
    className={cn('flex h-max min-h-full flex-col gap-8', className)}
    {...props}
  />
))
MessageScrollerContent.displayName = 'MessageScrollerContent'

const MessageScrollerItem = React.forwardRef<
  React.ElementRef<typeof MessageScrollerPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MessageScrollerPrimitive.Item>
>(({ className, scrollAnchor = false, ...props }, ref) => (
  <MessageScrollerPrimitive.Item
    ref={ref}
    data-slot="message-scroller-item"
    scrollAnchor={scrollAnchor}
    className={cn('min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]', className)}
    {...props}
  />
))
MessageScrollerItem.displayName = 'MessageScrollerItem'

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  render,
  variant = 'secondary',
  size = 'icon-sm',
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={cn(
        'absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180',
        className,
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <IconChevronDownOutline14 />
          <span className="sr-only">{direction === 'end' ? 'Scroll to end' : 'Scroll to start'}</span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}
MessageScrollerButton.displayName = 'MessageScrollerButton'

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
