// Shadcn-style Resizable: resizable panels built on react-resizable-panels.
import * as React from 'react'
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from './cn.ts'

const ResizablePanelGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ResizablePrimitive.Group>
>(({ className, ...props }, ref) => (
  <ResizablePrimitive.Group
    elementRef={ref}
    className={cn('flex h-full w-full', className)}
    {...props}
  />
))
ResizablePanelGroup.displayName = 'ResizablePanelGroup'

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ResizablePrimitive.Separator> & {
    withHandle?: boolean
  }
>(({ className, withHandle, ...props }, ref) => (
  <ResizablePrimitive.Separator
    elementRef={ref}
    className={cn(
      'relative flex items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
      'w-px aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full',
      '[&[aria-orientation=horizontal]>div]:rotate-90',
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex size-3 items-center justify-center rounded-sm border bg-border">
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="size-2.5 text-muted-foreground"
        >
          <circle cx="5.5" cy="3.5" r="1.25" fill="currentColor" />
          <circle cx="10.5" cy="3.5" r="1.25" fill="currentColor" />
          <circle cx="5.5" cy="8" r="1.25" fill="currentColor" />
          <circle cx="10.5" cy="8" r="1.25" fill="currentColor" />
          <circle cx="5.5" cy="12.5" r="1.25" fill="currentColor" />
          <circle cx="10.5" cy="12.5" r="1.25" fill="currentColor" />
        </svg>
      </div>
    )}
  </ResizablePrimitive.Separator>
))
ResizableHandle.displayName = 'ResizableHandle'

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
