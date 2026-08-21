/**
 * MCP server mount — thin re-export of the wire-layer mount service.
 *
 * The mount logic (connect → tools/list → tools/call dispatch) lives in
 * `@deepseek-ai/dsh-client-connection` because the interim agent loop that
 * consumes it (the fixture) is owned by that package, and the UI layer cannot
 * be a dependency of the wire layer. This file surfaces the mount API at the
 * UI-settings layer per the plan's file layout, so future UI (e.g. a mount
 * status badge) can reach it through the same entry the agent loop uses.
 */

export {
  mountEnabledMcpServers,
} from '@deepseek-ai/dsh-client-connection/src/client/mcp-mount.ts'
export type {
  McpMount,
  McpMountContext,
  McpMountServer,
  McpMountSpec,
  MountedMcpTool,
} from '@deepseek-ai/dsh-client-connection/src/client/mcp-mount.ts'
