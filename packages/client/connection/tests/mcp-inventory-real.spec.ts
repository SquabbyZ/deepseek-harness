/**
 * MCP inventory persistence (Task 3): with a Tauri bridge installed
 * (`__TAURI_INTERNALS__`), `mcpInventory/list` must project the persisted
 * `mcp-inventory` namespace's `servers` map (target = command 首词 or url),
 * overlay the persisted `enabled` map, and `setEnabled` / `upsertServer` /
 * `deleteServer` must persist through `settings_update('mcp-inventory', ...)`.
 * Without a bridge the fixture mirrors the Tauri branch: it seeds the
 * persisted `mcp-inventory` namespace and projects the in-memory `mcpServers`
 * map (the source of truth) — there is no longer a hardcoded fallback array.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '../src/client/api.ts'
import { createFixtureFaces } from '../src/client/fixture.ts'

const sid = (id: string): SessionId => id as SessionId

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

interface TauriMockOpts {
  settingsGet?: Record<string, unknown>
  settingsUpdate?: Array<{ key: string; value: unknown }>
}

/** Install a fake `__TAURI_INTERNALS__.invoke` and record every settings_update call. */
function installTauriMock(opts: TauriMockOpts = {}): { calls: Array<{ cmd: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  const invoke: InvokeFn = async (cmd, args) => {
    calls.push(args === undefined ? { cmd } : { cmd, args })
    switch (cmd) {
      case 'settings_get':
        return opts.settingsGet?.[String(args?.key)] ?? null
      case 'settings_update':
        opts.settingsUpdate?.push({ key: String(args?.key), value: args?.value })
        return null
      default:
        return null
    }
  }
  ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke }
  return { calls }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

/** Drive the fixture's mcpInventory/list Remote endpoint. */
async function mcpList(rpc: ReturnType<typeof createFixtureFaces>['rpc']): Promise<Array<Record<string, unknown>>> {
  const result = await rpc.call('/api', 'mcpInventory/list', { args: { agentId: sid('fx-alpha') } })
  if (!result.ok) throw new Error(`mcpInventory/list failed: ${result.error.code}`)
  return (result.value as { entries: Array<Record<string, unknown>> }).entries
}

/** Drive the fixture's mcpInventory/upsertServer Remote endpoint. */
async function mcpUpsert(rpc: ReturnType<typeof createFixtureFaces>['rpc'], spec: Record<string, unknown>): Promise<void> {
  const result = await rpc.call('/api', 'mcpInventory/upsertServer', {
    args: { agentId: sid('fx-alpha'), spec },
  })
  if (!result.ok) throw new Error(`mcpInventory/upsertServer failed: ${result.error.code}`)
}

/** Drive the fixture's mcpInventory/setEnabled Remote endpoint. */
async function mcpSetEnabled(rpc: ReturnType<typeof createFixtureFaces>['rpc'], entryId: string, enabled: boolean): Promise<void> {
  const result = await rpc.call('/api', 'mcpInventory/setEnabled', {
    args: { agentId: sid('fx-alpha'), entry: { entryId, enabled } },
  })
  if (!result.ok) throw new Error(`mcpInventory/setEnabled failed: ${result.error.code}`)
}

/** Drive the fixture's mcpInventory/deleteServer Remote endpoint. */
async function mcpDelete(rpc: ReturnType<typeof createFixtureFaces>['rpc'], entryId: string): Promise<void> {
  const result = await rpc.call('/api', 'mcpInventory/deleteServer', {
    args: { agentId: sid('fx-alpha'), entry: { entryId } },
  })
  if (!result.ok) throw new Error(`mcpInventory/deleteServer failed: ${result.error.code}`)
}

const STDIO_SPEC = {
  transport: 'stdio',
  serverName: 'filesystem',
  command: 'npx',
  args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
  env: {},
  cwd: '',
}
const HTTP_SPEC = {
  transport: 'streamable-http',
  serverName: 'remote',
  url: 'https://mcp.example.com/sse',
  headers: {},
}

describe('mcpInventory/list — persisted namespace under Tauri', () => {
  it('projects the persisted servers map (command 首词 / url) with the enabled overlay', async () => {
    installTauriMock({
      settingsGet: {
        'mcp-inventory': {
          servers: {
            filesystem: STDIO_SPEC,
            remote: HTTP_SPEC,
          },
          enabled: { filesystem: false },
        },
      },
    })
    const { rpc } = createFixtureFaces()
    const entries = await mcpList(rpc)
    expect(entries).toEqual([
      { entryId: 'filesystem', serverName: 'filesystem', transport: 'stdio', target: 'npx', enabled: false, spec: STDIO_SPEC },
      { entryId: 'remote', serverName: 'remote', transport: 'streamable-http', target: 'https://mcp.example.com/sse', enabled: true, spec: HTTP_SPEC },
    ])
  })

  it('returns an empty server list without a Tauri bridge', async () => {
    const { rpc } = createFixtureFaces()
    const entries = await mcpList(rpc)
    expect(entries).toEqual([]) // mcpServers is empty; the persisted namespace is only readable under Tauri.
  })
})

describe('mcpInventory CRUD — persistence', () => {
  it('persists upsertServer through settings_update(mcp-inventory)', async () => {
    const settingsUpdate: Array<{ key: string; value: unknown }> = []
    installTauriMock({ settingsUpdate })
    const { rpc } = createFixtureFaces()
    await mcpUpsert(rpc, STDIO_SPEC)
    const last = settingsUpdate.at(-1)
    expect(last?.key).toBe('mcp-inventory')
    expect(last?.value).toEqual({ servers: { filesystem: STDIO_SPEC }, enabled: { filesystem: true } })
  })

  it('re-applies a persisted server on a subsequent list', async () => {
    const settingsUpdate: Array<{ key: string; value: unknown }> = []
    installTauriMock({ settingsUpdate })
    const { rpc } = createFixtureFaces()
    await mcpUpsert(rpc, STDIO_SPEC)
    const entries = await mcpList(rpc)
    expect(entries).toEqual([
      { entryId: 'filesystem', serverName: 'filesystem', transport: 'stdio', target: 'npx', enabled: true, spec: STDIO_SPEC },
    ])
  })

  it('persists setEnabled into the same namespace alongside the servers', async () => {
    const settingsUpdate: Array<{ key: string; value: unknown }> = []
    installTauriMock({ settingsUpdate })
    const { rpc } = createFixtureFaces()
    await mcpUpsert(rpc, STDIO_SPEC)
    settingsUpdate.length = 0 // isolate the setEnabled write
    await mcpSetEnabled(rpc, 'filesystem', false)
    const last = settingsUpdate.at(-1)
    expect(last?.key).toBe('mcp-inventory')
    expect(last?.value).toEqual({ servers: { filesystem: STDIO_SPEC }, enabled: { filesystem: false } })
  })

  it('deleteServer removes the entry from both maps and persists', async () => {
    const settingsUpdate: Array<{ key: string; value: unknown }> = []
    installTauriMock({ settingsUpdate })
    const { rpc } = createFixtureFaces()
    await mcpUpsert(rpc, STDIO_SPEC)
    await mcpUpsert(rpc, HTTP_SPEC)
    settingsUpdate.length = 0
    await mcpDelete(rpc, 'filesystem')
    const last = settingsUpdate.at(-1)
    expect(last?.key).toBe('mcp-inventory')
    expect(last?.value).toEqual({ servers: { remote: HTTP_SPEC }, enabled: { remote: true } })
    const entries = await mcpList(rpc)
    expect(entries.map(e => e.entryId)).toEqual(['remote'])
  })
})
