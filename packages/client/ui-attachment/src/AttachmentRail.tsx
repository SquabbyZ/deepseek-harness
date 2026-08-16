/** Draft-attachment thumbnail rail: scrollbar-less horizontal overflow paged
 * by edge arrows, hover-revealed per-item remove, single-click open. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseFill14, ShadcnButton, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Edge arrow: 24px circle overlaid at the rail edges. */
const ARROW_BASE = 'absolute top-1/2 z-[2] grid size-6 place-items-center rounded-full border border-[var(--dsw-alias-border-l2-darkmode-thin)] bg-[var(--dsw-specific-input-major)] p-0 text-[var(--dsw-alias-label-secondary)] shadow-[var(--dsw-shadow-lv2)] cursor-pointer -translate-y-1/2 hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)] hover:text-[var(--dsw-alias-label-secondary)]'

/** Thumbnail card: 64px rounded cover with a zoom cursor. */
const THUMBNAIL_BASE = 'size-16 cursor-zoom-in overflow-hidden rounded-2xl border border-[var(--dsw-alias-border-l2-darkmode-thin)] bg-[var(--dsw-alias-interactive-bg-hover)] p-0 hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

/** Hover/focus-revealed remove control (coarse pointers keep it visible). */
const REMOVE_BASE = 'absolute top-1 right-1 z-[1] grid size-[18px] cursor-pointer place-items-center rounded-full border-none bg-[var(--dsw-alias-button-contrast-fill)] p-0 text-[var(--dsw-alias-label-primary-inverted)] opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none hover:bg-[var(--dsw-alias-button-contrast-fill)] hover:text-[var(--dsw-alias-label-primary-inverted)]'

/** One rail thumbnail; strings arrive resolved (zero-cordis atom). */
export interface AttachmentRailItem {
  /** Stable identity for the React key. */
  id: string
  /** Thumbnail kind; files render a name card instead of an image preview. */
  kind?: 'image' | 'file'
  /** Object or data URL rendered as the thumbnail (image kind only). */
  previewUrl: string
  /** Display name — the image's alt text or the file's label. */
  alt: string
  /** Accessible label of the item's remove control. */
  removeLabel: string
}

/** Rail-level strings the owner resolves from its own locale namespace. */
export interface AttachmentRailLabels {
  /** Accessible name of the rail group. */
  group: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
  /** Accessible label of the left paging arrow. */
  scrollLeft: string
  /** Accessible label of the right paging arrow. */
  scrollRight: string
}

/** Approximate pixels per wheel step for `deltaMode` LINE deltas (Firefox
 * notch wheels report lines, not pixels). */
const WHEEL_LINE_PX = 16

/** Smooth paging unless the user asked for reduced motion. */
function pageBehavior(): ScrollBehavior {
  // jsdom (the unit lane) implements no matchMedia despite lib.dom's
  // non-optional typing; the optional call keeps that lane on the default.
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/**
 * Horizontal thumbnail rail over the caller's draft attachments.
 *
 * The rail scrolls with its scrollbar hidden; overflow is announced by edge
 * arrows recomputed from scroll geometry on scroll, item-count changes, and
 * rail size changes (a ResizeObserver on the rail element, so sidebar or
 * panel resizes count, not only window resizes). A vertical wheel pans the
 * rail horizontally and is consumed exclusively (non-passive listener), a
 * newly added item is revealed at the rail's end while a rail that mounts
 * over an existing draft keeps its start position, and each thumbnail opens
 * on a single click while its remove control sits inside the card and
 * reveals on hover or focus. The owner decides mounting; it renders the rail
 * only while items exist.
 *
 * @param props.items - resolved thumbnails in draft order.
 * @param props.labels - rail-level strings (group name, open tooltip, arrows).
 * @param props.onOpen - single-click open of one item's original image.
 * @param props.onRemove - remove one item from the draft.
 * @returns the rail group with its paging arrows.
 */
export function AttachmentRail<T extends AttachmentRailItem>({ items, labels, onOpen, onRemove }: {
  items: readonly T[]
  labels: AttachmentRailLabels
  onOpen: (item: T) => void
  onRemove: (item: T) => void
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  // null marks the first layout pass: a rail that MOUNTS over an existing
  // draft (session switch back to held images) is initial display, not
  // growth, and must not jump to the end.
  const countRef = useRef<number | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const updateEdges = useCallback(() => {
    const el = railRef.current
    /* v8 ignore next -- defensive: every caller runs while the rail element is mounted. */
    if (el === null) return
    // 1px slack: engines report fractional scroll positions at the edges.
    const left = el.scrollLeft > 1
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    setEdges(prev => prev.left === left && prev.right === right ? prev : { left, right })
  }, [])
  useLayoutEffect(() => {
    const grew = countRef.current !== null && items.length > countRef.current
    countRef.current = items.length
    const el = railRef.current
    /* v8 ignore next -- defensive: the rail div renders unconditionally, so the layout effect always finds it. */
    if (el === null) return
    // A newly added attachment lands at the rail's end: reveal it.
    if (grew) el.scrollLeft = el.scrollWidth - el.clientWidth
    updateEdges()
  }, [items.length, updateEdges])
  useEffect(() => {
    const el = railRef.current
    /* v8 ignore next -- defensive: the rail div renders unconditionally, so the mount effect always finds it. */
    if (el === null) return
    // The rail's width follows the composer, which resizes with sidebars and
    // panels, not only the window — observe the element itself. jsdom (the
    // unit lane) implements no ResizeObserver; every browser gets the
    // subscription.
    let disconnect = (): void => {}
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateEdges)
      observer.observe(el)
      disconnect = () => { observer.disconnect() }
    }
    // The rail scrolls horizontally ONLY: any wheel tick with a vertical
    // component is consumed — without preventDefault it would also scroll the
    // conversation behind the composer, and React's root wheel listener is
    // passive, so the exclusion needs this manually attached non-passive
    // listener. A diagonal trackpad pan keeps its horizontal intent; a pure
    // vertical wheel converts to a horizontal step, with LINE and PAGE deltas
    // (Firefox notch wheels) normalized to pixels before the per-tick clamp
    // that keeps a fast wheel followable. A purely horizontal pan stays
    // native.
    const onWheel = (event: globalThis.WheelEvent): void => {
      if (event.deltaY === 0) return
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientWidth : 1
      event.preventDefault()
      el.scrollBy({
        left: event.deltaX !== 0
          ? event.deltaX * scale
          : Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * scale, 60),
        behavior: 'auto',
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [updateEdges])
  const page = (direction: -1 | 1): void => {
    const el = railRef.current
    /* v8 ignore next -- defensive: the arrows render only while the rail is mounted, so a click cannot find a null ref. */
    if (el === null) return
    // One viewport minus a card keeps the last visible thumbnail as context;
    // the floor keeps narrow rails paging a useful distance.
    el.scrollBy({ left: direction * Math.max(el.clientWidth - 64, 200), behavior: pageBehavior() })
  }
  return (
    <div className="relative min-w-0">
      {edges.left && (
        <ShadcnButton
          variant="ghost"
          className={clsx(ARROW_BASE, 'left-1')}
          aria-label={labels.scrollLeft}
          onClick={() => { page(-1) }}
        >
          <IconChevronLeftOutline14 />
        </ShadcnButton>
      )}
      <div
        ref={railRef}
        className="flex gap-2.5 overflow-x-auto overflow-y-hidden dsh-scrollbar-hidden [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)]"
        role="group"
        aria-label={labels.group}
        onScroll={updateEdges}
      >
        {items.map(item => (
          item.kind === 'file' ? (
            <div
              key={item.id}
              className="flex h-8 flex-none items-center self-center gap-1.5 rounded-lg border border-[var(--dsw-alias-border-l2-darkmode-thin)] bg-[var(--dsw-alias-interactive-bg-hover)] pl-2.5 pr-1"
            >
              <Tooltip label={item.alt} side="top">
                <span className="max-w-[200px] truncate text-xs text-[var(--dsw-alias-label-secondary)]">
                  {item.alt}
                </span>
              </Tooltip>
              <ShadcnButton
                variant="ghost"
                className="grid size-5 flex-none place-items-center rounded-full border-none p-0 text-[var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)] hover:text-[var(--dsw-alias-label-primary)]"
                aria-label={item.removeLabel}
                onClick={() => { onRemove(item) }}
              >
                <IconCloseFill14 size={12} />
              </ShadcnButton>
            </div>
          ) : (
            <div key={item.id} className="group relative flex-none size-16">
              <ShadcnButton
                variant="ghost"
                className={THUMBNAIL_BASE}
                title={labels.open}
                onClick={() => { onOpen(item) }}
              >
                <img className="block h-full w-full object-cover" src={item.previewUrl} alt={item.alt} />
              </ShadcnButton>
              <ShadcnButton
                variant="ghost"
                className={REMOVE_BASE}
                aria-label={item.removeLabel}
                onClick={() => { onRemove(item) }}
              >
                <IconCloseFill14 size={12} />
              </ShadcnButton>
            </div>
          )
        ))}
      </div>
      {edges.right && (
        <ShadcnButton
          variant="ghost"
          className={clsx(ARROW_BASE, 'right-1')}
          aria-label={labels.scrollRight}
          onClick={() => { page(1) }}
        >
          <IconChevronRightOutline14 />
        </ShadcnButton>
      )}
    </div>
  )
}
