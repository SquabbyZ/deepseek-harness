// Shadcn-style Skeleton: pulsing placeholder block.
import { cn } from './cn.ts'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
