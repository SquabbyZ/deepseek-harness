// Shadcn-style NativeSelect: styled native <select> with a chevron indicator.
import * as React from 'react'
import { IconChevronDownOutline14 } from '../../icons/index.tsx'
import { cn } from './cn.ts'

const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-8 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <IconChevronDownOutline14 className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
)
NativeSelect.displayName = 'NativeSelect'

const NativeSelectGroup = React.forwardRef<
  HTMLOptGroupElement,
  React.ComponentProps<'optgroup'>
>(({ className, ...props }, ref) => (
  <optgroup ref={ref} className={cn('font-medium text-foreground', className)} {...props} />
))
NativeSelectGroup.displayName = 'NativeSelectGroup'

export { NativeSelect, NativeSelectGroup }
