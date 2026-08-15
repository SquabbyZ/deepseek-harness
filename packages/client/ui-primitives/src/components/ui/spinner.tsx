// Shadcn-style Spinner: animated loading ring, optionally with a label.
import * as React from 'react'
import { cn } from './cn.ts'

const Spinner = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-label="Loading"
      className={cn(
        'size-4 animate-spin rounded-full border-2 border-muted border-t-primary',
        className,
      )}
      {...props}
    />
  ),
)
Spinner.displayName = 'Spinner'

const SpinnerWithText = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}
      {...props}
    >
      <Spinner />
      {children}
    </div>
  ),
)
SpinnerWithText.displayName = 'SpinnerWithText'

export { Spinner, SpinnerWithText }
