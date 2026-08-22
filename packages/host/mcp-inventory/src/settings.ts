/**
 * Settings overlay schema for the user-controlled MCP server inventory.
 *
 * The overlay lives in `~/.dsh/settings.yaml` under `mcp-inventory.enabled`.
 * It is an *incremental* dictionary: entries absent from this map default to
 * the Loader-side state, and `setEnabled` writes the new boolean.
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace owning the user override map. */
export const MCP_INVENTORY_SETTINGS_NAMESPACE = settingsNamespace('mcp-inventory')

/** Per-entry user override: `true` forces on, `false` forces off. */
export type McpInventoryEnabled = Record<string, boolean>

/** Full user overlay section. */
export const mcpInventorySettingsSchema = z.object({
  enabled: z.dict(z.boolean()).default({} as McpInventoryEnabled),
})

/** Resolved type of the section under {@link MCP_INVENTORY_SETTINGS_NAMESPACE}. */
export type McpInventorySettings = {
  enabled: McpInventoryEnabled
}
