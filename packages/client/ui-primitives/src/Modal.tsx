// Modal: controlled full-viewport dialog (create-workspace and similar).
// The overlay portals to this document's body so ancestor stacking contexts
// cannot leave sticky page controls above the mask. This is still an in-page
// WebUI dialog; it never creates or targets another browser/native window.

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './components/ui/cn.ts'
import { IconCloseOutline16 } from './icons/index.tsx'

/**
 * Render a centered modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - Escape or mask click.
 * @param props.title - dialog heading (aria-label in every mode).
 * @param props.closeLabel - accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - body (inputs, etc.).
 * @param props.footer - action row (Cancel / Create).
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome) for dialogs whose figma frame owns its own
 * header structure; mask, card, Escape, and aria-label remain.
 * @param props.closeLabel - close-button aria label; the owner passes
 * localized copy (this package is cordis-free, so copy arrives via props).
 * @returns null when closed; otherwise the overlay tree.
 */
export function Modal({
  open, onClose, title, closeLabel = 'Close', description, children, footer, className, contentClassName, headless = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
  headless?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, onClose])

  if (!open) return null

  return createPortal((
    <div className={ROOT} role="presentation">
      <div className={MASK} aria-hidden="true" onClick={onClose} />
      <div
        className={cn(DIALOG, className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {headless
          ? children
          : (
            <>
              <div className={cn(CONTENT, contentClassName)}>
                <div className={HEADER}>
                  <h2 className={TITLE}>{title}</h2>
                  <button type="button" className={CLOSE} aria-label={closeLabel} onClick={onClose}>
                    <IconCloseOutline16 size={14} />
                  </button>
                </div>
                {description !== undefined && description !== '' && (
                  <p className={DESCRIPTION}>{description}</p>
                )}
                {children !== undefined && <div className={BODY}>{children}</div>}
              </div>
              {footer !== undefined && <div className={FOOTER}>{footer}</div>}
            </>
          )}
      </div>
    </div>
  ), document.body)
}

const ROOT = 'fixed inset-0 z-[1000] flex items-center justify-center p-6'

const MASK = 'absolute inset-0 bg-[var(--dsw-alias-bg-mask-1)] [backdrop-filter:var(--dsw-mask-blur)]'

const DIALOG =
  'relative z-[1] flex flex-col gap-5 w-[min(380px,100%)] pb-6 overflow-hidden border border-[var(--dsw-alias-border-inverted)] rounded-[24px] bg-[var(--dsw-alias-bg-layer-2)] shadow-[var(--dsw-shadow-lv3)]'

const CONTENT = 'flex flex-col w-full'

const HEADER = 'flex items-center justify-between gap-2 pt-[22px] pr-[14px] pb-3 pl-6'

const TITLE = 'm-0 text-base leading-6 font-medium text-[var(--dsw-alias-label-primary)]'

const CLOSE =
  'flex-none inline-flex items-center justify-center size-7 border-none rounded-[8px] bg-transparent cursor-pointer text-[var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

const DESCRIPTION = 'm-0 px-6 text-sm leading-[22px] font-normal text-[var(--dsw-alias-label-primary)]'

const BODY = 'flex flex-col min-w-0 mt-5 px-6'

const FOOTER = 'flex items-center justify-end gap-2 px-6'
