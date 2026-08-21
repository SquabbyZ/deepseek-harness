import { describe, expect, it } from 'vitest'
import { mcpEntrySchema, mcpListResultSchema } from '@deepseek-ai/dsh-api-remotes/src/client/index.ts'

/**
 * Strict-codec regression for the MCP inventory list boundary.
 *
 * The connection fixture's `projectMcpEntry` returns a `spec` field (the full
 * persisted `McpServerSpec`, added in Task 6 so the probe can run it). Both the
 * api-remotes client gateway and the host gateway parse the payload with plain
 * zod `schema.parse(...)`, and zod's default object parse DROPS unknown keys —
 * so an entry schema that omitted `spec` silently erased it, and
 * `McpInventorySettingsTab.runProbe` → `probeMcpServer(entry.spec)` threw
 * `Cannot read properties of undefined (reading 'transport')`.
 *
 * This test crosses that boundary directly: it feeds a sample `mcpInventory/list`
 * payload exactly as the fixture projects it and pins that `spec` survives.
 */

const STDIO_SPEC = {
  transport: 'stdio',
  serverName: 'filesystem',
  command: 'npx -y @modelcontextprotocol/server-filesystem',
  args: ['/tmp'],
  env: {},
  cwd: '/tmp',
}

const HTTP_SPEC = {
  transport: 'streamable-http',
  serverName: 'remote-catalog',
  url: 'https://mcp.example.com/catalog',
  headers: { 'x-api-key': 'test' },
}

/** The exact wire shape `projectMcpEntry` emits for a persisted `[id, spec]` pair. */
const FIXTURE_LIST_RESULT = {
  entries: [
    {
      entryId: 'filesystem',
      serverName: 'filesystem',
      transport: 'stdio',
      target: 'npx',
      enabled: true,
      spec: STDIO_SPEC,
    },
    {
      entryId: 'remote-catalog',
      serverName: 'remote-catalog',
      transport: 'streamable-http',
      target: 'https://mcp.example.com/catalog',
      enabled: false,
      spec: HTTP_SPEC,
    },
  ],
}

describe('mcpInventory/list strict-codec boundary', () => {
  it('carries the full McpServerSpec through the list result schema', () => {
    const parsed = mcpListResultSchema.parse(FIXTURE_LIST_RESULT)

    expect(parsed.entries).toHaveLength(2)
    const [stdio, http] = parsed.entries
    expect(stdio.spec).toBeDefined()
    expect(stdio.spec).toMatchObject({
      transport: 'stdio',
      serverName: 'filesystem',
      command: 'npx -y @modelcontextprotocol/server-filesystem',
    })
    expect(stdio.spec.command).toBe(STDIO_SPEC.command)
    expect(http.spec).toBeDefined()
    expect(http.spec).toMatchObject({
      transport: 'streamable-http',
      serverName: 'remote-catalog',
      url: 'https://mcp.example.com/catalog',
    })
    expect(http.spec.url).toBe(HTTP_SPEC.url)
  })

  it('keeps spec on a single entry parsed through the entry schema', () => {
    const parsed = mcpEntrySchema.parse(FIXTURE_LIST_RESULT.entries[0])

    expect(parsed.entryId).toBe('filesystem')
    expect(parsed.spec).toBeDefined()
    expect(parsed.spec).toMatchObject({
      transport: 'stdio',
      serverName: 'filesystem',
      args: ['/tmp'],
      cwd: '/tmp',
    })
  })
})
