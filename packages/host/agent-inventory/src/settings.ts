/**
 * Settings overlay schema for the user-controlled agent-preset inventory.
 *
 * The overlay lives in `~/.dsh/settings.yaml` under `agent-inventory.enabled`.
 * It is an *incremental* dictionary: entries absent from this map default to
 * the filesystem-discovered preset's status, and `setEnabled` writes the
 * new boolean.
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace owning the user override map. */
export const AGENT_INVENTORY_SETTINGS_NAMESPACE = settingsNamespace('agent-inventory')

/** Per-entry user override: `true` forces on, `false` forces off. */
export type AgentInventoryEnabled = Record<string, boolean>

/** Full user overlay section. */
export const agentInventorySettingsSchema = z.object({
  enabled: z.dict(z.boolean()).default({} as AgentInventoryEnabled),
})

/** Resolved type of the section under {@link AGENT_INVENTORY_SETTINGS_NAMESPACE}. */
export type AgentInventorySettings = {
  enabled: AgentInventoryEnabled
}
