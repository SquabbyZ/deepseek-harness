import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { cn } from './components/ui/cn.ts'
import { IconChevronDownOutline14 } from './icons/index.tsx'

/** Shared 24px disclosure chrome for compact flow rows. */
export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  const collapsedLeading = previewChevron
    ? (
      <>
        <span className={ICON_IDLE}>{icon}</span>
        <IconChevronDownOutline14 className={cn(chevronClassName, CHEVRON_HOVER)} />
      </>
    )
    : icon
  const leading = open
    ? <IconChevronDownOutline14 className={chevronClassName} />
    : collapsedLeading

  return (
    <div className={cn(ROOT, className)} data-open={open || undefined}>
      <div
        className={cn(ROW, rowClassName)}
        data-disclosure-row
        data-expandable={rowExpands || undefined}
        role={rowExpands ? 'button' : undefined}
        tabIndex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowExpands ? (
          <button
            type="button"
            className={cn(LEADING, 'cursor-pointer', leadingClassName)}
            aria-expanded={open}
            onClick={toggleFromLeading}
          >
            {leading}
          </button>
        ) : (
          <span className={cn(LEADING, leadingClassName)}>
            {leading}
          </span>
        )}
        <span className={cn(TITLE, titleClassName)}>{title}</span>
        {(keepContentWhenOpen || !open) && collapsedContent}
      </div>
      {open && children}
    </div>
  )
}

const ROOT = 'flex flex-col w-full min-w-0'

const ROW =
  'group relative overflow-hidden flex items-center h-6 min-w-0 data-[expandable]:cursor-pointer'

const LEADING =
  'relative flex-none size-4 inline-flex items-center justify-center mr-1.5 p-0 border-none bg-transparent text-[var(--dsw-alias-label-tertiary)]'

const ICON_IDLE =
  'inline-flex opacity-100 transition-opacity duration-100 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:opacity-0'

const CHEVRON_HOVER =
  'absolute inset-0 m-auto opacity-0 transition-opacity duration-100 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:opacity-100'

const TITLE = 'flex-none text-sm leading-6 text-[var(--dsw-alias-label-secondary)]'
