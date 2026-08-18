/**
 * Settings overlay schema for the user-controlled skill inventory.
 *
 * The overlay lives in `~/.dsh/settings.yaml` under `skill-inventory.enabled`.
 * It is an *incremental* dictionary: entries absent from this map follow the
 * cordis runtime registry default, and `setEnabled` writes the new boolean
 * (no per-entry field beyond the boolean).
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace owning the user override map. */
export const SKILL_INVENTORY_SETTINGS_NAMESPACE = settingsNamespace('skill-inventory')

/** Per-entry user override: `true` forces on, `false` forces off. */
export type SkillInventoryEnabled = Record<string, boolean>

/** Full user overlay section. */
export const skillInventorySettingsSchema = z.object({
  enabled: z.dict(z.boolean()).default({} as SkillInventoryEnabled),
})

/** Resolved type of the section under {@link SKILL_INVENTORY_SETTINGS_NAMESPACE}. */
export type SkillInventorySettings = {
  enabled: SkillInventoryEnabled
}
