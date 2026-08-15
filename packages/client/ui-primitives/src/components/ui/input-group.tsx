// Shadcn-style InputGroup: wraps a text Input and styles its leading/trailing
// edges (addon, text label, or button).
import * as React from 'react'
import { cn } from './cn.ts'

const InputGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex w-full items-stretch', className)} {...props} />
  ),
)
InputGroup.displayName = 'InputGroup'

const InputGroupAddon = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-center border border-input bg-muted px-3 text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
)
InputGroupAddon.displayName = 'InputGroupAddon'

const InputGroupText = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
)
InputGroupText.displayName = 'InputGroupText'

const InputGroupButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'flex items-center justify-center border border-input bg-muted px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
InputGroupButton.displayName = 'InputGroupButton'

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText }
