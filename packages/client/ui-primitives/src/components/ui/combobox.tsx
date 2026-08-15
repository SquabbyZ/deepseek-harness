// Shadcn-style Combobox: a searchable single-select built on Popover + Command.
import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { IconCheckOutline14 } from '../../icons/index.tsx'
import { cn } from './cn.ts'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './command.tsx'

/** ChevronsUpDown glyph (not in the icon set) — inline SVG, fill currentColor. */
const ChevronsUpDown = ({ className }: { className?: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M11.6464 6.35355L8 2.70711L4.35355 6.35355L5.06066 7.06066L8 4.12132L10.9393 7.06066L11.6464 6.35355Z" fill="currentColor" />
    <path d="M4.35355 9.64645L8 13.2929L11.6464 9.64645L10.9393 8.93934L8 11.8787L5.06066 8.93934L4.35355 9.64645Z" fill="currentColor" />
  </svg>
)

export interface ComboboxOption {
  value: string
  label: React.ReactNode
}

export interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  triggerClassName?: string
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select an option...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  className,
  triggerClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const selectedOption = options.find(option => option.value === value)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
            triggerClassName,
          )}
        >
          {selectedOption ? (
            selectedOption.label
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          className="z-50 w-[--radix-popover-trigger-width] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} className="h-9" />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map(option => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={(currentValue) => {
                      onChange?.(currentValue === value ? '' : currentValue)
                      setOpen(false)
                    }}
                  >
                    {option.label}
                    <IconCheckOutline14
                      className={cn('ml-auto', value === option.value ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
Combobox.displayName = 'Combobox'
