/**
 * AppToggleGroup — reusable per-app toggle group.
 *
 * Renders one icon button per supported app, each reflecting the boolean
 * state for that app in `value`. Used by the inventory routes to toggle a
 * plugin/skill/mcp/agent for each consumer app independently.
 *
 * Pattern: a `Record<AppId, boolean>` flows in; per-app onChange fires with
 * the new boolean for that single app.
 *
 * The component is intentionally UI-only — the per-app persistence model
 * (settings schema + IPC) is not yet wired. Callers can hold the state
 * locally until the backend lands; the visual contract here does not change.
 */

import type { ReactNode } from 'react'

/**
 * Supported consumer apps. UI-only type; backend persistence lives elsewhere.
 * Keep this union in sync with the icon registry below.
 */
export type AppId = 'claude' | 'codex' | 'gemini'

/** Per-app metadata used to render an icon button. */
export interface AppMeta {
  readonly id: AppId
  readonly label: string
  readonly icon: ReactNode
  readonly tooltip: string
}

export interface AppToggleGroupProps {
  /** Current per-app state. Missing keys default to `false`. */
  readonly value: Record<AppId, boolean>
  /** Fired when one app's toggle flips; the whole record is passed back. */
  readonly onChange: (next: Record<AppId, boolean>) => void
  /** Optional override for the app order/icons/labels. */
  readonly apps?: readonly AppMeta[]
  /** Disable every button (e.g. while a parent mutation is pending). */
  readonly disabled?: boolean
  /** Optional stable id used by aria labels; defaults to "app-toggle-group". */
  readonly groupId?: string
}

/**
 * Default icon set — minimal SVG glyphs so the component has no external
 * icon-library dependency. Real apps can replace these with a richer set via
 * the `apps` prop without changing the visual contract.
 */
const DEFAULT_APPS: readonly AppMeta[] = [
  {
    id: 'claude',
    label: 'Claude',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4">
        <circle cx="12" cy="12" r="9" fill="currentColor" />
      </svg>
    ),
    tooltip: 'Toggle for Claude',
  },
  {
    id: 'codex',
    label: 'Codex',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" />
      </svg>
    ),
    tooltip: 'Toggle for Codex',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4">
        <path d="M12 2 L22 20 L2 20 Z" fill="currentColor" />
      </svg>
    ),
    tooltip: 'Toggle for Gemini',
  },
]

/**
 * Render the toggle group. Each button is `aria-pressed` so screen readers
 * announce the state; the visual highlight is `bg-*` so the layout works in
 * both light and dark Tailwind themes.
 */
export function AppToggleGroup(props: AppToggleGroupProps): ReactNode {
  const apps = props.apps ?? DEFAULT_APPS
  const groupId = props.groupId ?? 'app-toggle-group'

  function flip(app: AppId): void {
    if (props.disabled === true) return
    const next: Record<AppId, boolean> = { ...props.value, [app]: !(props.value[app] ?? false) }
    props.onChange(next)
  }

  return (
    <div
      role="group"
      aria-label="Per-app toggle"
      data-testid={groupId}
      className="inline-flex items-center gap-1"
    >
      {apps.map(app => {
        const on = props.value[app.id] ?? false
        const classes = on
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white text-gray-600 border-white hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700'
        return (
          <button
            key={app.id}
            type="button"
            title={app.tooltip}
            aria-label={app.tooltip}
            aria-pressed={on}
            data-app-id={app.id}
            disabled={props.disabled === true}
            onClick={() => flip(app.id)}
            className={`inline-flex items-center justify-center w-7 h-7 rounded border ${classes} disabled:opacity-50`}
          >
            {app.icon}
          </button>
        )
      })}
    </div>
  )
}