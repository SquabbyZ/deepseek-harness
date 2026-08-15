// Shadcn-style Item: list row primitive (media + content + actions).
// Ported from shadcn/ui new-york-v4 registry. Styled with the shadcn semantic
// color utilities wired to --dsw-* tokens in globals.css.

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from './cn.ts'
import { Separator } from './separator.tsx'

export type ItemVariant = 'default' | 'outline' | 'muted'
export type ItemSize = 'default' | 'sm'
export type ItemMediaVariant = 'default' | 'icon' | 'image'

const ItemGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="list"
      data-slot="item-group"
      className={cn('group/item-group flex flex-col', className)}
      {...props}
    />
  ),
)
ItemGroup.displayName = 'ItemGroup'

const ItemSeparator = React.forwardRef<
  React.ElementRef<typeof Separator>,
  React.ComponentPropsWithoutRef<typeof Separator>
>(({ className, ...props }, ref) => (
  <Separator
    ref={ref}
    data-slot="item-separator"
    orientation="horizontal"
    className={cn('my-0', className)}
    {...props}
  />
))
ItemSeparator.displayName = 'ItemSeparator'

const ITEM_BASE =
  'group/item flex flex-wrap items-center rounded-md border border-transparent text-sm transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors [a]:hover:bg-accent/50'

const ITEM_VARIANTS: Record<ItemVariant, string> = {
  default: 'bg-transparent',
  outline: 'border-border',
  muted: 'bg-muted/50',
}

const ITEM_SIZES: Record<ItemSize, string> = {
  default: 'gap-4 p-4',
  sm: 'gap-2.5 px-4 py-3',
}

const Item = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & {
    variant?: ItemVariant
    size?: ItemSize
    asChild?: boolean
  }
>(({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={ref}
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(ITEM_BASE, ITEM_VARIANTS[variant], ITEM_SIZES[size], className)}
      {...props}
    />
  )
})
Item.displayName = 'Item'

const ITEM_MEDIA_BASE =
  'flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:translate-y-0.5 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none'

const ITEM_MEDIA_VARIANTS: Record<ItemMediaVariant, string> = {
  default: 'bg-transparent',
  icon: 'size-8 rounded-sm border bg-muted [&_svg:not([class*="size-"])]:size-4',
  image: 'size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover',
}

const ItemMedia = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { variant?: ItemMediaVariant }
>(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    data-slot="item-media"
    data-variant={variant}
    className={cn(ITEM_MEDIA_BASE, ITEM_MEDIA_VARIANTS[variant], className)}
    {...props}
  />
))
ItemMedia.displayName = 'ItemMedia'

const ItemContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-content"
      className={cn('flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none', className)}
      {...props}
    />
  ),
)
ItemContent.displayName = 'ItemContent'

const ItemTitle = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-title"
      className={cn('flex w-fit items-center gap-2 text-sm leading-snug font-medium', className)}
      {...props}
    />
  ),
)
ItemTitle.displayName = 'ItemTitle'

const ItemDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<'p'>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      data-slot="item-description"
      className={cn(
        'line-clamp-2 text-sm leading-normal font-normal text-balance text-muted-foreground',
        '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  ),
)
ItemDescription.displayName = 'ItemDescription'

const ItemActions = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="item-actions" className={cn('flex items-center gap-2', className)} {...props} />
  ),
)
ItemActions.displayName = 'ItemActions'

const ItemHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-header"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  ),
)
ItemHeader.displayName = 'ItemHeader'

const ItemFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-footer"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  ),
)
ItemFooter.displayName = 'ItemFooter'

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
}
