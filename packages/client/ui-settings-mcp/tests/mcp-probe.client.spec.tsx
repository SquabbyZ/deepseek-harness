// @vitest-environment jsdom
/**
 * MCP connection probe (Task 6): a REAL initialize + tools/list handshake.
 *
 * Two lanes:
 *  1. `probeMcpServer` — streamable-http POSTs `initialize` then `tools/list`
 *     over the mocked `__TAURI_INTERNALS__` `http_request` bridge (echoing the
 *     initialize `Mcp-Session-Id` header), and stdio exchanges JSON-RPC lines
 *     through the mocked `mcp_stdio_spawn/write/read/close` bridge.
 *  2. `McpInventorySettingsTab` — the per-row 测试 button runs the real probe
 *     and renders a green "N tools" badge on success / a red error badge on
 *     failure, with other rows' test buttons disabled while one is in flight.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
// Type-only side effect: loads the plugin's LocaleNamespaceMap merge.
import type {} from '../src/client/index.ts'
import { probeMcpServer, type ProbeResult } from '../src/client/mcp-probe.ts'
import {
  McpInventorySettingsTab,
  type McpInventorySettingsTabInjected,
  type McpInventorySettingsTabProps,
} from '../src/client/McpInventorySettingsTab.tsx'
import {
  createMcpInventoryStore,
  type McpEntryId,
  type McpInventoryEntry,
  type McpInventoryStore,
  type McpServerSpec,
} from '../src/client/inventory-store.ts'
import { en, type McpInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

function id(value: string): McpEntryId {
  return value as McpEntryId
}

function slug(serverName: string): string {
  const clean = serverName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return clean.length > 0 ? clean : 'mcp'
}

/** Mirror the fixture's entry projection, now carrying the full spec. */
function project(spec: McpServerSpec): McpInventoryEntry {
  return {
    entryId: id(slug(spec.serverName)),
    serverName: spec.serverName,
    transport: spec.transport,
    target: spec.transport === 'stdio' ? spec.command.split(/\s+/)[0] ?? '' : spec.url,
    enabled: true,
    spec,
  }
}

function translate(
  dict: typeof en,
  key: McpInventoryLocaleKey,
  params?: Record<string, string>,
): string {
  const template: string = (dict as Record<string, string>)[key] ?? key
  let text = template
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{{${name}}}`, value)
    }
  }
  return text
}

/** Narrow a probe result to the failure variant (the test has already asserted `ok === false`). */
function errorOf(result: ProbeResult): string {
  if (result.ok) throw new Error('expected a probe failure')
  return result.error
}

/* ------------------------------------------------------------------ */
/*  Mock `__TAURI_INTERNALS__` bridge                                   */
/* ------------------------------------------------------------------ */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

interface TauriMock {
  calls: Array<{ cmd: string; args?: Record<string, unknown> }>
}

/** Install a fake `__TAURI_INTERNALS__.invoke` and record every call. */
function installTauriMock(handlers: Record<string, (args?: Record<string, unknown>) => unknown>): TauriMock {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  const invoke: InvokeFn = async (cmd, args) => {
    calls.push(args === undefined ? { cmd } : { cmd, args })
    const handler = handlers[cmd]
    if (handler === undefined) return null
    return handler(args)
  }
  ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke }
  return { calls }
}

function httpBody(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

function httpResponse(
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): { status: number; headers: Record<string, string>; body: number[] } {
  return { status, headers, body: httpBody(typeof value === 'string' ? value : JSON.stringify(value)) }
}

/** Parse a mocked http_request req arg into its wire request. */
function httpReqOf(args: Record<string, unknown> | undefined): {
  method: string
  url: string
  headers: Record<string, string>
  body: number[]
} {
  return (args?.req ?? {}) as { method: string; url: string; headers: Record<string, string>; body: number[] }
}

/** A mock http_request handler that answers initialize then tools/list with fixed tool names. */
function httpProbeHandler(toolNames: string[], sessionId = 'sess-42') {
  return (args?: Record<string, unknown>): { status: number; headers: Record<string, string>; body: number[] } => {
    const req = httpReqOf(args)
    const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(req.body))) as { method?: string; id?: number }
    if (payload.method === 'initialize') {
      return httpResponse(
        200,
        { jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } },
        { 'mcp-session-id': sessionId },
      )
    }
    return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { tools: toolNames.map(name => ({ name })) } })
  }
}

const HTTP_SPEC: McpServerSpec = { transport: 'streamable-http', serverName: 'remote', url: 'https://mcp.example.com/mcp', headers: {} }

/* ------------------------------------------------------------------ */
/*  Lane 1: probeMcpServer module                                       */
/* ------------------------------------------------------------------ */

describe('probeMcpServer', () => {
  it('probes streamable-http: initialize then tools/list, echoing the session id header', async () => {
    const mock = installTauriMock({ http_request: httpProbeHandler(['a', 'b']) })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result).toEqual({ ok: true, toolCount: 2 })

    const httpCalls = mock.calls.filter(call => call.cmd === 'http_request')
    expect(httpCalls).toHaveLength(2)
    const initialize = httpReqOf(httpCalls[0]?.args ?? {})
    expect(initialize.method).toBe('POST')
    expect(initialize.url).toBe('https://mcp.example.com/mcp')
    const initializePayload = JSON.parse(new TextDecoder().decode(new Uint8Array(initialize.body))) as Record<string, unknown>
    expect(initializePayload['method']).toBe('initialize')
    expect(initializePayload['params']).toEqual(
      expect.objectContaining({ protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'deepseek-harness', version: '0.1.0' } }),
    )
    // The tools/list request must echo the initialize session id.
    const toolsList = httpReqOf(httpCalls[1]?.args ?? {})
    const toolsListPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(toolsList.body))) as Record<string, unknown>
    expect(toolsListPayload['method']).toBe('tools/list')
    expect(toolsList.headers['mcp-session-id']).toBe('sess-42')
  })

  it('surfaces a non-2xx http response as the probe error', async () => {
    installTauriMock({ http_request: () => httpResponse(500, 'boom') })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result.ok).toBe(false)
    expect(result.toolCount).toBe(0)
    expect(errorOf(result)).toBe('HTTP 500: boom')
  })

  it('surfaces an initialize JSON-RPC error message as the probe error', async () => {
    installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(req.body))) as { id?: number }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, error: { code: -32601, message: 'method not found' } })
      },
    })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBe('method not found')
  })

  it('falls back to the error code when a JSON-RPC error carries no message', async () => {
    installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(req.body))) as { id?: number }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, error: { code: -32000 } })
      },
    })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBe('JSON-RPC error -32000')
  })

  it('renders a bare JSON-RPC error (no code) as an empty-code message', async () => {
    installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(req.body))) as { id?: number }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, error: {} })
      },
    })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBe('JSON-RPC error ')
  })

  it('errors when the initialize response carries no usable session id and tools/list has no tools array', async () => {
    installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(new TextDecoder().decode(new Uint8Array(req.body))) as { method?: string; id?: number }
        if (payload.method === 'initialize') {
          // A foreign header (no mcp-session-id) exercises the case-insensitive miss path.
          return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } }, { 'x-other': 'v' })
        }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { serverInfo: { name: 'fake', version: '1.0' } } })
      },
    })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBe('tools/list returned no tools array')
  })

  it('errors when the http body is not JSON', async () => {
    installTauriMock({ http_request: () => httpResponse(200, 'definitely-not-json') })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBeTruthy()
  })

  it('probes stdio: spawn, write initialize + tools/list, read both, then close', async () => {
    const readQueue = [
      // An empty line, a malformed line, and a notification frame must all be skipped.
      '',
      'this is not json',
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'started' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'x' }] } }),
    ]
    const mock = installTauriMock({
      mcp_stdio_spawn: () => 7,
      mcp_stdio_write: () => undefined,
      mcp_stdio_read: () => readQueue.shift() ?? null,
      // A close failure must not turn a successful probe into a failure.
      mcp_stdio_close: () => { throw new Error('already closed') },
    })

    const spec: McpServerSpec = { transport: 'stdio', serverName: 'local', command: 'npx', args: ['-y', 'mcp-server'], env: {}, cwd: '' }
    const result = await probeMcpServer(spec)
    expect(result).toEqual({ ok: true, toolCount: 1 })

    expect(mock.calls).toContainEqual(expect.objectContaining({
      cmd: 'mcp_stdio_spawn',
      // An empty cwd is omitted so the Rust bridge does not reject the spawn.
      args: { spec: { command: 'npx', args: ['-y', 'mcp-server'], env: {} } },
    }))
    const writes = mock.calls.filter(call => call.cmd === 'mcp_stdio_write').map(call => call.args?.line as string)
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[0] ?? '{}')).toEqual(expect.objectContaining({ id: 1, method: 'initialize' }))
    expect(JSON.parse(writes[1] ?? '{}')).toEqual(expect.objectContaining({ id: 2, method: 'tools/list' }))
    // Tauri v2 maps the Rust snake_case `conn_id` params to camelCase `connId` on
    // the JS side — every flat stdio arg must carry `connId` (never `conn_id`).
    for (const call of mock.calls) {
      if (call.cmd === 'mcp_stdio_spawn') continue // nested `spec` object, no flat connId
      if (call.cmd.startsWith('mcp_stdio_')) {
        expect(call.args).toHaveProperty('connId')
        expect(call.args).not.toHaveProperty('conn_id')
      }
    }
    // The spawn's connId (7) is threaded through every write/read/close call.
    expect(mock.calls.filter(call => call.cmd === 'mcp_stdio_write').every(call => call.args?.connId === 7)).toBe(true)
    expect(mock.calls.filter(call => call.cmd === 'mcp_stdio_read').every(call => call.args?.connId === 7)).toBe(true)
    expect(mock.calls.some(call => call.cmd === 'mcp_stdio_close' && call.args?.connId === 7)).toBe(true)
  })

  it('returns ok:false when the stdio server never answers (timeout)', async () => {
    const mock = installTauriMock({
      mcp_stdio_spawn: () => 1,
      mcp_stdio_write: () => undefined,
      mcp_stdio_read: () => null,
      mcp_stdio_close: () => undefined,
    })
    const spec: McpServerSpec = { transport: 'stdio', serverName: 'local', command: 'npx', args: [], env: {}, cwd: '/tmp' }
    const result = await probeMcpServer(spec, { timeoutMs: 30 })
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toContain('timed out')
    // The spawn carries a non-empty cwd.
    expect(mock.calls).toContainEqual(expect.objectContaining({
      cmd: 'mcp_stdio_spawn',
      args: { spec: { command: 'npx', args: [], env: {}, cwd: '/tmp' } },
    }))
    // The write/read calls still carry the camelCase `connId` (here 1).
    expect(mock.calls.filter(call => call.cmd === 'mcp_stdio_write').every(call => call.args?.connId === 1)).toBe(true)
    expect(mock.calls.filter(call => call.cmd === 'mcp_stdio_read').every(call => call.args?.connId === 1)).toBe(true)
  })

  it('returns unavailable without a Tauri bridge', async () => {
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result).toEqual({ ok: false, toolCount: 0, error: 'unavailable' })
  })

  it('stringifies a non-Error rejection into the probe error', async () => {
    installTauriMock({
      http_request: () => { throw 'kaboom' },
    })
    const result = await probeMcpServer(HTTP_SPEC)
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBe('kaboom')
  })
})

/* ------------------------------------------------------------------ */
/*  Lane 2: McpInventorySettingsTab test button                         */
/* ------------------------------------------------------------------ */

function buildProps({
  store,
  setEnabled = async () => undefined,
  upsertServer = async () => undefined,
  deleteServer = async () => undefined,
  list = async () => ({ entries: store.getSnapshot().entries }),
  refresh = () => undefined,
}: {
  store: McpInventoryStore
  setEnabled?: McpInventorySettingsTabInjected['setEnabled']
  upsertServer?: McpInventorySettingsTabInjected['upsertServer']
  deleteServer?: McpInventorySettingsTabInjected['deleteServer']
  list?: McpInventorySettingsTabInjected['list']
  refresh?: McpInventorySettingsTabInjected['refresh']
}): McpInventorySettingsTabProps {
  return {
    store,
    setEnabled,
    upsertServer,
    deleteServer,
    list,
    refresh,
    search: async () => ({ servers: [] }),
    installSmithery: async () => undefined,
    close: () => undefined,
    t: (key: McpInventoryLocaleKey, params?: Record<string, string>) => translate(en, key, params),
  } as McpInventorySettingsTabProps
}

function buildProbeStore(initial: readonly McpInventoryEntry[]): McpInventoryStore {
  const entries = new Map<string, McpInventoryEntry>()
  for (const entry of initial) entries.set(entry.entryId, entry)
  return createMcpInventoryStore({
    list: async () => ({ entries: [...entries.values()] }),
    upsertServer: async () => undefined,
    deleteServer: async () => undefined,
    search: async () => ({ servers: [] }),
  }, () => undefined)
}

describe('McpInventorySettingsTab test button', () => {
  it('runs a real probe on 测试 and renders the green success badge with the tool count', async () => {
    installTauriMock({ http_request: httpProbeHandler(['a', 'b']) })
    const store = buildProbeStore([project(HTTP_SPEC)])
    render(<McpInventorySettingsTab {...buildProps({ store })} />)

    await waitFor(() => { expect(screen.getByText('remote')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.test }))

    await waitFor(() => {
      expect(screen.getByText(en.probeOk.replace('{{count}}', '2'))).toBeTruthy()
    })
    expect(screen.queryByRole('status')).toBeTruthy()
  })

  it('renders the red failure badge with the probe error message', async () => {
    installTauriMock({ http_request: () => httpResponse(500, 'boom') })
    const store = buildProbeStore([project(HTTP_SPEC)])
    render(<McpInventorySettingsTab {...buildProps({ store })} />)

    await waitFor(() => { expect(screen.getByText('remote')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.test }))

    await waitFor(() => {
      expect(screen.getByText(en.probeFail.replace('{{reason}}', 'HTTP 500: boom'))).toBeTruthy()
    })
  })

  it('disables every test button while one probe is in flight, then restores them', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    installTauriMock({
      http_request: () => gate.then(() => httpResponse(200, { jsonrpc: '2.0', id: 1, result: { tools: [] } })),
    })
    const store = buildProbeStore([
      project({ transport: 'streamable-http', serverName: 'one', url: 'https://one.example/mcp', headers: {} }),
      project({ transport: 'streamable-http', serverName: 'two', url: 'https://two.example/mcp', headers: {} }),
    ])
    render(<McpInventorySettingsTab {...buildProps({ store })} />)

    await waitFor(() => { expect(screen.getByText('one')).toBeTruthy() })
    const testButtons = screen.getAllByRole('button', { name: en.test })
    if (testButtons[0] !== undefined) fireEvent.click(testButtons[0])

    // While in flight: the probing row shows 测试中…, every other 测试 button is disabled.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.testing })).toBeTruthy()
    })
    for (const button of screen.getAllByRole('button', { name: en.test })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }

    release()
    await waitFor(() => {
      expect(screen.getByText(en.probeOk.replace('{{count}}', '0'))).toBeTruthy()
    })
    // After the probe settles both rows return to the 测试 label and re-enable.
    await waitFor(() => {
      const restored = screen.getAllByRole('button', { name: en.test })
      expect(restored).toHaveLength(2)
      for (const button of restored) expect((button as HTMLButtonElement).disabled).toBe(false)
    })
  })
})
