// @vitest-environment jsdom
/**
 * MCP server mount (Task 7): `mountEnabledMcpServers` connects the enabled
 * servers (stdio bridge / streamable-http), lists their tools as
 * `mcp__<server>__<tool>` definitions (schema passthrough), and dispatches
 * `mcp__`-prefixed calls back to the owning server's `tools/call`. With zero
 * enabled servers it is a no-op. The mock harness mirrors mcp-probe.client.spec.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mountEnabledMcpServers, type McpMountSpec } from '../src/client/mcp-mount.ts'

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

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

function decodeBody(body: number[]): string {
  return new TextDecoder().decode(new Uint8Array(body))
}

const HTTP_SPEC: McpMountSpec = {
  transport: 'streamable-http',
  serverName: 'remote',
  url: 'https://mcp.example.com/mcp',
  headers: { authorization: 'Bearer tok' },
}

/* ------------------------------------------------------------------ */
/*  streamable-http lane                                                */
/* ------------------------------------------------------------------ */

describe('mountEnabledMcpServers — streamable-http', () => {
  it('mounts tools as mcp__<server>__<tool> with schema passthrough and dispatches tools/call', async () => {
    const mock = installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(decodeBody(req.body)) as {
          method?: string
          id?: number
          params?: { name?: string; arguments?: unknown }
        }
        if (payload.method === 'initialize') {
          return httpResponse(
            200,
            { jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } },
            { 'mcp-session-id': 'sess-42' },
          )
        }
        if (payload.method === 'tools/list') {
          return httpResponse(200, {
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              tools: [
                { name: 'alpha', description: 'A', inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
                { name: 'beta', inputSchema: { type: 'object' } },
              ],
            },
          })
        }
        if (payload.method === 'tools/call') {
          return httpResponse(200, {
            jsonrpc: '2.0',
            id: payload.id,
            result: { content: [{ type: 'text', text: `ran:${payload.params?.name}` }] },
          })
        }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: {} })
      },
    })

    const mount = await mountEnabledMcpServers({ servers: [{ serverName: 'remote', spec: HTTP_SPEC }] })
    expect(mount.errors).toEqual([])
    expect(mount.tools.map(t => t.function.name)).toEqual(['mcp__remote__alpha', 'mcp__remote__beta'])
    // Schema passthrough: MCP inputSchema → OpenAI parameters.
    expect(mount.tools[0]?.function.description).toBe('A')
    expect(mount.tools[0]?.function.parameters).toEqual({ type: 'object', properties: { x: { type: 'string' } }, required: ['x'] })
    expect(mount.tools[1]?.function.description).toBeUndefined()
    expect(mount.tools[1]?.function.parameters).toEqual({ type: 'object' })

    const result = await mount.dispatch('mcp__remote__alpha', '{"x":"hello"}')
    expect(result).toBe('ran:alpha')

    const httpCalls = mock.calls.filter(call => call.cmd === 'http_request')
    expect(httpCalls).toHaveLength(3) // initialize + tools/list + tools/call
    // The initialize response's session id is echoed on tools/list and tools/call.
    for (const call of httpCalls.slice(1)) {
      expect(httpReqOf(call.args ?? {}).headers['mcp-session-id']).toBe('sess-42')
    }
    // The spec's own headers ride the initialize request.
    expect(httpReqOf(httpCalls[0]?.args ?? {}).headers['authorization']).toBe('Bearer tok')
    // The tools/call body carries the raw tool name + parsed arguments.
    const callReq = httpReqOf(httpCalls[2]?.args ?? {})
    const callPayload = JSON.parse(decodeBody(callReq.body)) as { method?: string; params?: { name?: string; arguments?: unknown } }
    expect(callPayload.method).toBe('tools/call')
    expect(callPayload.params?.name).toBe('alpha')
    expect(callPayload.params?.arguments).toEqual({ x: 'hello' })

    await mount.close()
  })

  it('slugs a display serverName into the mcp__ prefix so tool names stay valid for the LLM', async () => {
    installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(decodeBody(req.body)) as { method?: string; id?: number }
        if (payload.method === 'initialize') {
          return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } }, { 'mcp-session-id': 's' })
        }
        if (payload.method === 'tools/list') {
          return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { tools: [{ name: 'alpha' }] } })
        }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { content: [{ type: 'text', text: 'ok' }] } })
      },
    })
    const spec: McpMountSpec = { transport: 'streamable-http', serverName: 'My Server', url: 'https://x.example/mcp', headers: {} }
    const mount = await mountEnabledMcpServers({ servers: [{ serverName: 'My Server', spec }] })
    expect(mount.tools.map(t => t.function.name)).toEqual(['mcp__my-server__alpha'])
    expect(await mount.dispatch('mcp__my-server__alpha', '{}')).toBe('ok')
  })

  it('rejects a dispatch for a tool that is not mounted', async () => {
    installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(decodeBody(req.body)) as { method?: string; id?: number }
        if (payload.method === 'initialize') {
          return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } }, { 'mcp-session-id': 's' })
        }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { tools: [{ name: 'alpha' }] } })
      },
    })
    const mount = await mountEnabledMcpServers({ servers: [{ serverName: 'remote', spec: HTTP_SPEC }] })
    await expect(mount.dispatch('mcp__remote__missing', '{}')).rejects.toThrow('未挂载')
  })

  it('skips a server that fails to connect and still mounts the rest', async () => {
    installTauriMock({
      http_request: (args) => {
        const req = httpReqOf(args)
        const payload = JSON.parse(decodeBody(req.body)) as { method?: string; id?: number }
        if (req.url === 'https://bad.example/mcp') return httpResponse(500, 'boom')
        if (payload.method === 'initialize') {
          return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } }, { 'mcp-session-id': 's' })
        }
        return httpResponse(200, { jsonrpc: '2.0', id: payload.id, result: { tools: [{ name: 'good-tool' }] } })
      },
    })
    const mount = await mountEnabledMcpServers({ servers: [
      { serverName: 'bad', spec: { transport: 'streamable-http', serverName: 'bad', url: 'https://bad.example/mcp', headers: {} } },
      { serverName: 'good', spec: { transport: 'streamable-http', serverName: 'good', url: 'https://good.example/mcp', headers: {} } },
    ] })
    expect(mount.tools.map(t => t.function.name)).toEqual(['mcp__good__good-tool'])
    expect(mount.errors).toEqual([{ serverName: 'bad', error: 'HTTP 500: boom' }])
  })
})

/* ------------------------------------------------------------------ */
/*  stdio lane                                                          */
/* ------------------------------------------------------------------ */

describe('mountEnabledMcpServers — stdio', () => {
  it('spawns once, exchanges initialize + tools/list, dispatches tools/call, then closes', async () => {
    const readQueue = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake', version: '1.0' }, capabilities: {} } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'alpha', inputSchema: { type: 'object' } }] } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'ok' }] } }),
    ]
    const mock = installTauriMock({
      mcp_stdio_spawn: () => 7,
      mcp_stdio_write: () => undefined,
      mcp_stdio_read: () => readQueue.shift() ?? null,
      mcp_stdio_close: () => undefined,
    })

    const spec: McpMountSpec = { transport: 'stdio', serverName: 'local', command: 'npx', args: ['-y', 'mcp-server'], env: {}, cwd: '' }
    const mount = await mountEnabledMcpServers({ servers: [{ serverName: 'local', spec }] })
    expect(mount.tools.map(t => t.function.name)).toEqual(['mcp__local__alpha'])
    expect(await mount.dispatch('mcp__local__alpha', '{}')).toBe('ok')
    await mount.close()

    // An empty cwd is omitted so the Rust bridge does not reject the spawn.
    expect(mock.calls).toContainEqual(expect.objectContaining({
      cmd: 'mcp_stdio_spawn',
      args: { spec: { command: 'npx', args: ['-y', 'mcp-server'], env: {} } },
    }))
    // Tauri v2 maps snake_case `conn_id` params to camelCase `connId` — every
    // flat stdio arg must carry `connId` (never `conn_id`).
    for (const call of mock.calls) {
      if (call.cmd === 'mcp_stdio_spawn') continue
      if (call.cmd.startsWith('mcp_stdio_')) {
        expect(call.args).toHaveProperty('connId')
        expect(call.args).not.toHaveProperty('conn_id')
        expect(call.args?.connId).toBe(7)
      }
    }
    const writes = mock.calls
      .filter(call => call.cmd === 'mcp_stdio_write')
      .map(call => JSON.parse(call.args?.line as string) as { method?: string })
    expect(writes.map(w => w.method)).toEqual(['initialize', 'tools/list', 'tools/call'])
    expect(mock.calls.some(call => call.cmd === 'mcp_stdio_close' && call.args?.connId === 7)).toBe(true)
  })

  it('returns an empty mount without a Tauri bridge', async () => {
    const mount = await mountEnabledMcpServers({ servers: [{ serverName: 'remote', spec: HTTP_SPEC }] })
    expect(mount.tools).toEqual([])
    expect(mount.errors).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/*  zero-servers fast path                                              */
/* ------------------------------------------------------------------ */

describe('mountEnabledMcpServers — zero enabled servers', () => {
  it('returns an empty mount and makes no bridge calls', async () => {
    const mock = installTauriMock({})
    const mount = await mountEnabledMcpServers({ servers: [] })
    expect(mount.tools).toEqual([])
    expect(mount.errors).toEqual([])
    await expect(mount.dispatch('mcp__x__y', '{}')).rejects.toThrow('未挂载')
    await mount.close()
    expect(mock.calls).toEqual([])
  })
})
