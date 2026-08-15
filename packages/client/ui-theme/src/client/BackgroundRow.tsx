/**
 * Background-image row registered into the Personalization section item slot.
 * Two sources write the same persisted string: a local file upload (read to a
 * data URL via FileReader) and a URL text input (a remote URL). The value is
 * a raw URL or data URL — no `url(...)` wrapping here; the presenter layers
 * that on later. A clear button resets to empty.
 */
import type { ChangeEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './BackgroundRow.module.css'

/** Injected business face: the background write (t rides the standard locale seat). */
export interface BackgroundRowInjected {
  /** Set the global background image (raw URL or data URL; empty = none). */
  setBackground: (value: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type BackgroundRowComponentProps =
  PropsRuntime<'settings.personalization.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & BackgroundRowInjected

/** A value is a local upload (data URL) rather than a remote URL. */
function isDataUrl(value: string): boolean {
  return value.startsWith('data:')
}

/**
 * Render the Background-image row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function BackgroundRow({ t, setBackground, useStore }: BackgroundRowComponentProps) {
  const background = useStore(s => s.background)

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    // Clear the selection so re-choosing the same file re-fires a change.
    event.target.value = ''
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setBackground(reader.result)
    }
    reader.readAsDataURL(file)
  }

  // The URL field only echoes remote URLs; an uploaded data URL is too long
  // to be useful as editable text (the clear button still reflects it).
  const urlValue = isDataUrl(background) ? '' : background

  return (
    <div className={css.group}>
      <div className={css.title}>{t('background.title')}</div>
      <div className={css.body}>
        <label className={css.upload}>
          <input type="file" accept="image/*" className={css.hiddenInput} onChange={onFileChange} />
          {t('background.upload')}
        </label>
        <label className={css.url}>
          <span className={css.urlLabel}>{t('background.url')}</span>
          <input
            type="text"
            className={css.urlInput}
            placeholder={t('background.urlPlaceholder')}
            value={urlValue}
            onChange={(event) => { setBackground(event.target.value) }}
          />
        </label>
        {background !== '' && (
          <button type="button" className={css.clear} onClick={() => { setBackground('') }}>
            {t('background.clear')}
          </button>
        )}
      </div>
    </div>
  )
}
