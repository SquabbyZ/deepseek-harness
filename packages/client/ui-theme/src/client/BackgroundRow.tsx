/**
 * Background-image row registered into the Personalization section item slot.
 * Two sources write the same persisted string: a local file upload (read to a
 * data URL via FileReader) and a URL text input (a remote URL). The value is
 * a raw URL or data URL — no `url(...)` wrapping here; the presenter layers
 * that on later. A clear button resets to empty. When a value is set, a
 * preview thumbnail doubles as a crop minimap: dragging on it selects a
 * sub-region stored as fractions (top-left origin, 0–1), and a clear-crop
 * affordance restores full-image cover. Local uploads also capture the file
 * name for display (the full path is unavailable by browser security).
 */
import { useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ShadcnButton, ShadcnInput } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { BackgroundCrop } from '../theme-settings.ts'
import type { createAppearanceRowStore } from './settings-store.ts'

/** Injected business face: the background write (t rides the standard locale seat). */
export interface BackgroundRowInjected {
  /** Set the global background image (raw URL or data URL; empty = none). */
  setBackground: (value: string) => void
  /** Set the local upload's file name (empty clears it). */
  setBackgroundName: (value: string) => void
  /** Set the crop region as fractions (null = full-image cover). */
  setBackgroundCrop: (value: BackgroundCrop | null) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type BackgroundRowComponentProps =
  PropsRuntime<'settings.personalization.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & BackgroundRowInjected

/** A value is a local upload (data URL) rather than a remote URL. */
function isDataUrl(value: string): boolean {
  return value.startsWith('data:')
}

/** Clamp a coordinate into [0, 1]; non-finite input collapses to 0. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * Map a pointer event to fractions of an element's box (top-left origin).
 * @param e - the pointer event carrying client coordinates.
 * @param rect - the preview element's bounding rect.
 * @returns the fraction pair, clamped to [0, 1].
 */
export function pointToFraction(
  e: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const x = rect.width <= 0 ? 0 : (e.clientX - rect.left) / rect.width
  const y = rect.height <= 0 ? 0 : (e.clientY - rect.top) / rect.height
  return { x: clamp01(x), y: clamp01(y) }
}

/**
 * Normalize a drag's start and end fractions into a top-left-origin crop box.
 * @param start - the drag start fraction.
 * @param end - the drag end fraction.
 * @returns a crop region with non-negative width/height.
 */
export function normalizeCropBox(start: { x: number; y: number }, end: { x: number; y: number }): BackgroundCrop {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  }
}

/** A drag smaller than this fraction on either axis is treated as a clear. */
const MIN_CROP = 0.01

/**
 * Render the Background-image row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function BackgroundRow({ t, setBackground, setBackgroundName, setBackgroundCrop, useStore }: BackgroundRowComponentProps) {
  const background = useStore(s => s.background)
  const backgroundName = useStore(s => s.backgroundName)
  const backgroundCrop = useStore(s => s.backgroundCrop)

  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const lastPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const [draftCrop, setDraftCrop] = useState<BackgroundCrop | null>(null)

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    // Clear the selection so re-choosing the same file re-fires a change.
    event.target.value = ''
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBackground(reader.result)
        setBackgroundName(file.name)
        setBackgroundCrop(null)
      }
    }
    reader.readAsDataURL(file)
  }

  // The URL field only echoes remote URLs; an uploaded data URL is too long
  // to be useful as editable text (the clear button still reflects it).
  const urlValue = isDataUrl(background) ? '' : background

  const onCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (background === '') return
    const start = pointToFraction(event, event.currentTarget.getBoundingClientRect())
    dragStart.current = start
    lastPoint.current = start
    setDraftCrop({ x: start.x, y: start.y, w: 0, h: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragStart.current
    if (start === null) return
    const current = pointToFraction(event, event.currentTarget.getBoundingClientRect())
    lastPoint.current = current
    setDraftCrop(normalizeCropBox(start, current))
  }

  const onCropPointerEnd = (): void => {
    const start = dragStart.current
    dragStart.current = null
    if (start === null) return
    const box = normalizeCropBox(start, lastPoint.current)
    setDraftCrop(null)
    if (box.w < MIN_CROP || box.h < MIN_CROP) {
      setBackgroundCrop(null)
      return
    }
    setBackgroundCrop(box)
  }

  // While dragging the draft box wins; otherwise the persisted crop shows.
  const activeCrop = draftCrop ?? backgroundCrop

  return (
    <div className="flex flex-col gap-2 border-b border-border py-4">
      <div className="text-sm font-normal leading-[22px] text-foreground">{t('background.title')}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-border px-4 py-1.5 text-sm leading-[22px] text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)]">
          <ShadcnInput type="file" accept="image/*" className="sr-only" onChange={onFileChange} />
          {t('background.upload')}
        </label>
        <label className="inline-flex flex-[1_1_240px] items-center gap-2">
          <span className="text-sm leading-[22px] text-[var(--dsw-alias-label-secondary)]">{t('background.url')}</span>
          <ShadcnInput
            type="text"
            className="box-border h-auto min-w-0 flex-[1_1_0] rounded-lg border border-border bg-card px-3 py-1.5 text-sm leading-[22px] text-foreground shadow-none focus-visible:ring-0"
            placeholder={t('background.urlPlaceholder')}
            value={urlValue}
            onChange={(event) => {
              setBackground(event.target.value)
              setBackgroundName('')
              setBackgroundCrop(null)
            }}
          />
        </label>
        {background !== '' && (
          <ShadcnButton
            variant="ghost"
            className="rounded-lg border border-border bg-transparent px-4 py-1.5 text-sm font-normal leading-[22px] text-foreground cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)]"
            onClick={() => {
              setBackground('')
              setBackgroundName('')
              setBackgroundCrop(null)
            }}
          >
            {t('background.clear')}
          </ShadcnButton>
        )}
      </div>
      {backgroundName !== '' && (
        <div className="flex items-center gap-2 text-[13px] leading-5">
          <span className="text-[var(--dsw-alias-label-secondary)]">{t('background.fileName')}</span>
          <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{backgroundName}</span>
        </div>
      )}
      {background !== '' && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] leading-5 text-[var(--dsw-alias-label-secondary)]">{t('background.cropLabel')}</div>
          <div
            className="relative inline-block max-w-full cursor-crosshair touch-none select-none self-start align-top leading-[0]"
            aria-label={t('background.cropLabel')}
            onPointerDown={onCropPointerDown}
            onPointerMove={onCropPointerMove}
            onPointerUp={onCropPointerEnd}
            onPointerCancel={onCropPointerEnd}
          >
            <img className="block h-auto w-auto max-h-[180px] max-w-full pointer-events-none" src={background} alt="" draggable={false} />
            {activeCrop !== null && (
              <div
                className="pointer-events-none absolute border border-[var(--dsw-alias-brand-primary)] bg-[color-mix(in_srgb,var(--dsw-alias-brand-primary)_18%,transparent)]"
                style={{
                  left: `${activeCrop.x * 100}%`,
                  top: `${activeCrop.y * 100}%`,
                  width: `${activeCrop.w * 100}%`,
                  height: `${activeCrop.h * 100}%`,
                }}
              />
            )}
          </div>
          {backgroundCrop !== null && (
            <ShadcnButton
              variant="ghost"
              className="self-start rounded-lg border border-border bg-transparent px-3 py-1 text-[13px] font-normal leading-5 text-foreground cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)]"
              onClick={() => { setBackgroundCrop(null) }}
            >
              {t('background.clearCrop')}
            </ShadcnButton>
          )}
        </div>
      )}
    </div>
  )
}
