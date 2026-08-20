/**
 * Settings — Phase 2 task 2.6.4 placeholder.
 *
 * Lists the three known settings (theme, language, autoLaunch) and binds each
 * to the existing `useSettings` / `useUpdateSettings` TanStack Query hooks.
 * The settings API is the in-place Tauri `settings_get` / `settings_update`
 * pair bridged in `apps/web/src/dsh/bridge/settings.ts` — no new commands.
 *
 * The full `SettingsRoot` shell (nav + chrome + sidebar.trigger + every
 * ui-settings-* section in a tab list) lives in
 * `dsh-client-ui-settings-general`. Wiring it back in is a Phase 2 S5 task
 * that needs the master bundle layer (`dsh_client_modules` + per-key
 * `ui-stores`) ported into the vite-dev inbox first — see plan §6.4.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useSettings, useUpdateSettings } from '../dsh/query/queries'

type ThemeValue = 'light' | 'dark' | 'auto'
type LanguageValue = 'en' | 'zh'
type AutoLaunchValue = boolean

const THEME_OPTIONS: readonly { readonly value: ThemeValue; readonly label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
]

const LANGUAGE_OPTIONS: readonly { value: LanguageValue; readonly label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
]

function readValue<T>(value: T | null | undefined, fallback: T): T {
  return value === null || value === undefined ? fallback : value
}

function applyTheme(theme: ThemeValue): void {
  const root = document.documentElement
  if (theme === 'auto') {
    delete root.dataset.theme
  } else {
    root.dataset.theme = theme
  }
}

export function Settings(): ReactNode {
  const themeQ = useSettings<ThemeValue>('theme')
  const updateTheme = useUpdateSettings<ThemeValue>('theme')
  const theme = readValue<ThemeValue>(themeQ.data, 'auto')

  const languageQ = useSettings<LanguageValue>('language')
  const updateLanguage = useUpdateSettings<LanguageValue>('language')
  const language = readValue<LanguageValue>(languageQ.data, 'en')

  const autoLaunchQ = useSettings<AutoLaunchValue>('autoLaunch')
  const updateAutoLaunch = useUpdateSettings<AutoLaunchValue>('autoLaunch')
  const autoLaunch = readValue<AutoLaunchValue>(autoLaunchQ.data, false)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function selectTheme(next: ThemeValue): void {
    applyTheme(next)
    updateTheme.mutate(next)
  }

  function selectLanguage(next: LanguageValue): void {
    updateLanguage.mutate(next)
  }

  function toggleAutoLaunch(): void {
    updateAutoLaunch.mutate(!autoLaunch)
  }

  return (
    <div className="p-4 max-w-3xl mx-auto" data-testid="settings-root">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500">
          Theme, language, and startup preferences.
        </p>
      </header>

      <section
        aria-label="Theme"
        data-setting-key="theme"
        className="rounded border border-white/10 p-4 mb-3"
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-medium">Theme</h2>
            <p className="text-xs text-gray-500">Color scheme used across the app.</p>
          </div>
          <span className="text-xs text-gray-500 font-mono">{theme}</span>
        </div>
        <div role="radiogroup" aria-label="Theme" className="flex gap-1">
          {THEME_OPTIONS.map((option) => {
            const selected = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-theme-option={option.value}
                onClick={() => selectTheme(option.value)}
                disabled={updateTheme.isPending}
                className={`px-3 py-1 rounded text-sm border ${
                  selected
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-transparent text-gray-300 border-white/10 hover:bg-white/5'
                } disabled:opacity-50`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </section>

      <section
        aria-label="Language"
        data-setting-key="language"
        className="rounded border border-white/10 p-4 mb-3"
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-medium">Language</h2>
            <p className="text-xs text-gray-500">Interface text language.</p>
          </div>
          <span className="text-xs text-gray-500 font-mono">{language}</span>
        </div>
        <div role="radiogroup" aria-label="Language" className="flex gap-1">
          {LANGUAGE_OPTIONS.map((option) => {
            const selected = language === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-language-option={option.value}
                onClick={() => selectLanguage(option.value)}
                disabled={updateLanguage.isPending}
                className={`px-3 py-1 rounded text-sm border ${
                  selected
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-transparent text-gray-300 border-white/10 hover:bg-white/5'
                } disabled:opacity-50`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </section>

      <section
        aria-label="Auto launch"
        data-setting-key="autoLaunch"
        className="rounded border border-white/10 p-4 mb-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Launch on system startup</h2>
            <p className="text-xs text-gray-500">Start the app when you log in.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoLaunch}
            aria-label="Auto launch"
            data-auto-launch
            onClick={toggleAutoLaunch}
            disabled={updateAutoLaunch.isPending}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
              autoLaunch ? 'bg-blue-600' : 'bg-white/20'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${
                autoLaunch ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {(themeQ.isError || languageQ.isError || autoLaunchQ.isError) && (
        <div
          role="alert"
          className="mt-2 text-red-600 text-sm"
          data-testid="settings-error"
        >
          Failed to load settings.
        </div>
      )}
    </div>
  )
}
