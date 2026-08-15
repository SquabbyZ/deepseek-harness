/**
 * Shadcn-style DropdownMenu built on @radix-ui/react-dropdown-menu, matching
 * the `button.tsx` / `cn.ts` shadcn pattern (Radix trigger + Content + Item,
 * composed with `cn`). The card skin and item rows reuse the existing
 * `--dsw-*` tokens (the same `--dsw-specific-menu` surface, inverted hairline,
 * and `--dsw-alias-interactive-bg-hover` item fill as `Menu.tsx`), so the menu
 * reads as the same figma menu surface while exposing the standard shadcn
 * `DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` /
 * `DropdownMenuItem` API.
 */

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from './cn.ts'

/** Controlled/uncontrolled root (radix). */
const DropdownMenu = DropdownMenuPrimitive.Root

/** Portal mount target; Content portals to document.body by default (radix). */
const DropdownMenuPortal = DropdownMenuPrimitive.Portal

/**
 * The trigger. Forwarded so `asChild` works — the consumer renders its own
 * button (e.g. an avatar) and Radix injects the open/close behavior.
 */
const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Trigger
    ref={ref}
    className={cn('outline-none', className)}
    {...props}
  />
))
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName

/**
 * The menu card. Portaled and positioned by radix against the trigger; the
 * tokens are the same surface as `Menu.tsx`'s `.menu-card` (figma MenuDropdown).
 */
const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, align = 'end', ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        'z-[1100] min-w-[180px] max-w-[360px] rounded-[12px] border border-[var(--dsw-alias-border-inverted)] bg-[var(--dsw-specific-menu)] p-1 shadow-[var(--dsw-shadow-lv3)]',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

/**
 * One selectable row (figma `.Menu_cell`): min-h 40, r10, 14/22 primary ink,
 * hover fill. Keyboard navigation highlights via radix's `data-highlighted`.
 */
const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-[10px] px-[10px] py-2 text-sm leading-[22px] text-[var(--dsw-alias-label-primary)] outline-none',
      'hover:bg-[var(--dsw-alias-interactive-bg-hover)] focus:bg-[var(--dsw-alias-interactive-bg-hover)] data-[highlighted]:bg-[var(--dsw-alias-interactive-bg-hover)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
}
