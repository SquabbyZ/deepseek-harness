import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable MCP server identity (cordis Loader entry id). */
export type McpEntryId = Branded<'McpEntryId'>

/** Transport kind for an MCP server entry. */
export type McpTransport = 'stdio' | 'streamable-http' | 'unknown' | (string & {})

/** Why the entry currently resolves to `enabled: false`. */
export type McpDisabledReason = 'user' | 'cordis' | null

/** One MCP server in the inventory snapshot. */
export interface McpInventoryEntry {
  readonly entryId: McpEntryId
  /** Stable server name carried by `mcp__<serverName>__<rawName>`. */
  readonly serverName: string
  /** Transport kind as recorded in the entry config. */
  readonly transport: McpTransport
  /** Executable for stdio transports; URL for streamable-http. */
  readonly target: string
  /** Number of tool registrations currently advertised by this server. */
  readonly toolCount: number
  /** Effective enabled state after the user overlay is applied. */
  readonly enabled: boolean
  /** Why the entry is disabled, when it is. */
  readonly disabledReason: McpDisabledReason
}

/** Point-in-time inventory returned by the MCP-inventory Remote. */
export interface McpInventorySnapshot {
  readonly entries: readonly McpInventoryEntry[]
}

/** Payload of the `mcp-inventory/changed` Cordis event. */
export interface McpInventoryChangedPayload {
  /** Full snapshot projected at the moment of emission; clients replace, never diff. */
  readonly snapshot: McpInventorySnapshot
}

/** Declare the one-way Cordis event this gateway emits on every settings commit. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Emitted after every user-overlay commit (UI toggle, settings file reload).
     * @param payload - full snapshot projected at the moment of emission; clients replace, never diff.
     * @mode emit
     */
    'mcp-inventory/changed'(payload: McpInventoryChangedPayload): void
  }
}
