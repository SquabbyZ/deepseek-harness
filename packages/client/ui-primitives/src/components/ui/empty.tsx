// Shadcn-style Empty: centered empty-state card with image/title/description.
import * as React from 'react'
import { cn } from './cn.ts'

const Empty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-center',
        className,
      )}
      {...props}
    />
  ),
)
Empty.displayName = 'Empty'

const EmptyImage = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-center text-muted-foreground', className)}
      {...props}
    />
  ),
)
EmptyImage.displayName = 'EmptyImage'

const EmptyTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-base font-semibold text-foreground', className)}
    {...props}
  />
))
EmptyTitle.displayName = 'EmptyTitle'

const EmptyDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('max-w-sm text-sm text-muted-foreground', className)} {...props} />
))
EmptyDescription.displayName = 'EmptyDescription'

const EmptyContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-4 flex flex-col items-center gap-2', className)} {...props} />
  ),
)
EmptyContent.displayName = 'EmptyContent'

export { Empty, EmptyImage, EmptyTitle, EmptyDescription, EmptyContent }
