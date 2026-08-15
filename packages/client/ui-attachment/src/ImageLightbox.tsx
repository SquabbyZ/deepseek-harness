import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16, ShadcnButton } from '@deepseek-ai/dsh-client-ui-primitives'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] grid place-items-center p-10"
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div className="absolute inset-0 bg-[var(--dsw-alias-bg-mask-1)] [backdrop-filter:var(--dsw-mask-blur)]" aria-hidden="true" onMouseDown={onClose} />
      <img className="relative max-w-[min(100%,1600px)] max-h-[calc(100vh_-_80px)] object-contain rounded-xl bg-[var(--dsw-specific-input-major)] shadow-[var(--dsw-shadow-lv3)]" src={src} alt={alt} />
      <ShadcnButton
        ref={closeRef}
        variant="ghost"
        className="fixed top-5 right-5 z-[1] grid size-9 cursor-pointer place-items-center rounded-full border border-[var(--dsw-alias-border-l2-darkmode-thin)] bg-[var(--dsw-specific-input-major)] p-0 text-foreground hover:bg-[var(--dsw-specific-input-major)] hover:text-foreground"
        aria-label={labels.close}
        onClick={onClose}
      >
        <IconCloseOutline16 size={16} />
      </ShadcnButton>
    </div>,
    document.body,
  )
}
