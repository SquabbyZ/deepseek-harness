/**
 * Settings overlay schema for the user-controlled plugin inventory.
 *
 * The overlay lives in `~/.dsh/settings.yaml` under `plugin-inventory.enabled`.
 * It is an *incremental* dictionary: entries absent from this map follow the
 * cordis.yml default, and `setEnabled` writes the new boolean (no per-entry
 * field beyond the boolean).
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace owning the user override map. */
export const PLUGIN_INVENTORY_SETTINGS_NAMESPACE = settingsNamespace('plugin-inventory')

/** Per-entry user override: `true` forces on, `false` forces off. */
export type PluginInventoryEnabled = Record<string, boolean>

/** Full user overlay section. */
export const pluginInventorySettingsSchema = z.object({
  enabled: z.dict(z.boolean()).default({} as PluginInventoryEnabled),
})

/** Resolved type of the section under {@link PLUGIN_INVENTORY_SETTINGS_NAMESPACE}. */
export type PluginInventorySettings = {
  enabled: PluginInventoryEnabled
}
