/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema } from './theme-settings.ts'

export {
  DEFAULT_PREFERENCE, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/**
 * Register the durable theme section. The pre-plugin index transform previously
 * hooked the deleted `ctx.webServer.tapIndex`; Phase 2 ships the theme section
 * only and the boot-theme injection will be re-added once the Tauri asset
 * protocol replays the index.
 * @param ctx - Host context that may acquire settings services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
}
