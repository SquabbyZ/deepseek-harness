// SearchInput: a search box with a leading search icon and a clear (×) button
// that appears once the user types. Reusable for plugin inventory / skill / mcp /
// agent lists so the four share one search affordance.

import type { InputHTMLAttributes } from 'react'
import { IconCloseOutline16, IconSearchOutline16 } from './icons/index.tsx'
import { cn } from './components/ui/cn.ts'

const WRAP =
  'relative flex w-full items-center text-[var(--dsw-alias-label-tertiary)]'

const LEADING_ICON =
  'pointer-events-none absolute left-3 inline-flex size-4 items-center justify-center'

const INPUT =
  'h-9 w-full rounded-lg border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-alias-bg-layer-1)] py-0 pl-9 pr-9 text-[13px] leading-5 text-[var(--dsw-alias-label-primary)] shadow-none outline-none placeholder:text-[var(--dsw-alias-label-tertiary)] focus-visible:border-[var(--dsw-alias-state-business-primary)] focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--dsw-alias-state-business-primary)_18%,transparent)]'

const CLEAR_BUTTON =
  'absolute right-2 inline-flex size-5 items-center justify-center rounded text-[var(--dsw-alias-label-tertiary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-state-business-primary)] focus-visible:-outline-offset-2'

/**
 * Render a search input with a leading search icon and an in-input clear button.
 * @param props.value - controlled value; the clear button only renders when this is non-empty.
 * @param props.onClear - called when the user clicks the × button. Omit to hide the button.
 * @param props.className - extra class for the outer wrapper.
 * @returns the search field.
 */
export function SearchInput({
  value,
  onClear,
  className,
  type = 'search',
  ...rest
}: {
  value: string
  onClear?: () => void
  className?: string | undefined
  type?: 'search' | 'text'
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'type'>) {
  const hasClear = onClear !== undefined && value.length > 0
  return (
    <span className={cn(WRAP, className)}>
      <IconSearchOutline16 size={16} className={LEADING_ICON} aria-hidden="true" />
      <input
        {...rest}
        type={type}
        className={INPUT}
        value={value}
        aria-label={rest['aria-label'] ?? rest.placeholder ?? 'Search'}
      />
      {hasClear ? (
        <button
          type="button"
          className={CLEAR_BUTTON}
          aria-label="Clear search"
          onClick={onClear}
        >
          <IconCloseOutline16 size={12} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  )
}
