// Shadcn-style ButtonGroup: horizontal flex row that joins buttons into a
// segmented control.
import * as React from 'react'
import { cn } from './cn.ts'

const ButtonGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      className={cn(
        'inline-flex items-stretch [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none',
        className,
      )}
      {...props}
    />
  ),
)
ButtonGroup.displayName = 'ButtonGroup'

const ButtonGroupText = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('inline-flex items-center px-3 text-sm text-muted-foreground', className)}
      {...props}
    />
  ),
)
ButtonGroupText.displayName = 'ButtonGroupText'

export { ButtonGroup, ButtonGroupText }
