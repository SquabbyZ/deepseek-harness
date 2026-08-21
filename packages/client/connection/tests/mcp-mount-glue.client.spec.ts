/**
 * Fixture agent-loop MCP glue (Task 7): the interim pi-agent loop mounts the
 * ENABLED MCP servers and routes `mcp__<server>__<tool>` calls back through the
 * mount. The mount MODULE has its own suite (ui-settings-mcp mcp-mount); this
 * one covers the FIXTURE glue the module tests never reach:
 *
 *   • `[...STATIC_AGENT_TOOLS, ...mount.tools]` — the mounted tools ride the
 *     tools array advertised to the real-LLM call. This is LOAD-BEARING here:
 *     the completions mock refuses to emit the `mcp__brave__alpha` tool_call
 *     unless the request it received actually advertises that tool in its
 *     `tools` array, so a concat regression that dropped `...mount.tools`
 *     makes the loop fall straight to text and the dispatch assertions fail;
 *   • the async `executeAgentTool` → `mount.dispatch` routing for the `mcp__`
 *     prefix — `mcp__brave__alpha` lands on the owning server's `tools/call`
 *     with the RAW name + parsed args;
 *   • the `finally { await mount.close() }` teardown after the turn.
 *
 * Chosen approach: drive the REAL loop end-to-end. `runAgentTurn` is a fixture
 * closure (not exported), so it is reached through `session.prompt` in realLlm
 * mode. The `__TAURI_INTERNALS__` bridge serves both http lanes — the MCP
 * streamable-http server (initialize / tools/list / tools/call) and the
 * chat-completions endpoint (a deterministic two-round exchange: tool_calls
 * first, then the final text) — plus the settings + keyring commands the loop
 * needs. `vi.mock` wraps only the mount module's exported entry so `close` can
 * be observed; the mount itself (connect / list / dispatch) is the real one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MuxFrame, RpcRequest } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import { createFixtureApi } from '../src/client/fixture.ts'

let reqCount = 0
const req = <P>(payload: P): RpcRequest<P> => ({ rpcId: RpcId(`t-${reqCount++}`), payload })

const MCP_URL = 'https://mcp.example.com/mcp'
const COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions'

/** The persisted `mcp-inventory` namespace: one ENABLED streamable-http server. */
const MCP_INVENTORY = {
  servers: {
    brave: { transport: 'streamable-http', serverName: 'brave', url: MCP_URL, headers: {} },
  },
  enabled: { brave: true },
}

/** Capture the mounts the fixture creates so the teardown can be asserted. */
const { mountCalls, closeSpy } = vi.hoisted(() => ({
  mountCalls: [] as Array<{ servers: unknown; mount: { close: unknown } }>,
  closeSpy: vi.fn(),
}))

// Wrap only the mount MODULE's entry so the real connect/list/dispatch runs
// while the fixture-glue teardown (`finally { await mount.close() }`) is visible.
vi.mock('../src/client/mcp-mount.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/client/mcp-mount.ts')>()
  return {
    ...mod,
    mountEnabledMcpServers: vi.fn(async (ctx: Parameters<typeof mod.mountEnabledMcpServers>[0]) => {
      const mount = await mod.mountEnabledMcpServers(ctx)
      const wrapped = {
        ...mount,
        close: async (): Promise<void> => {
          closeSpy()
          await mount.close()
        },
      }
      mountCalls.push({ servers: ctx.servers, mount: wrapped })
      return wrapped
    }),
  }
})

/* ------------------------------------------------------------------ */
/*  Tauri bridge mock                                                  */
/* ------------------------------------------------------------------ */

interface HttpReq {
  method: string
  url: string
  headers: Record<string, string>
  body: number[]
  timeout_ms: number
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function decodeBody(body: number[]): string {
  return new TextDecoder().decode(new Uint8Array(body))
}

function jsonBytes(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)))
}

function jsonRpcResponse(id: number, result: unknown, headers: Record<string, string> = {}): unknown {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
    body: jsonBytes({ jsonrpc: '2.0', id, result }),
  }
}

interface TauriMock {
  calls: Array<{ cmd: string; args?: Record<string, unknown> }>
  httpRequests: HttpReq[]
  toolCalls: Array<{ name: string; arguments: unknown }>
}

/** Install a fake `__TAURI_INTERNALS__` serving settings, the keyring, and both http lanes. */
function installTauriMock(): TauriMock {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  const httpRequests: HttpReq[] = []
  const toolCalls: Array<{ name: string; arguments: unknown }> = []
  let completionsRound = 0
  let lastToolResult = ''

  const invoke: InvokeFn = async (cmd, args) => {
    calls.push(args === undefined ? { cmd } : { cmd, args })
    switch (cmd) {
      case 'settings_get':
        return { 'mcp-inventory': MCP_INVENTORY }[String(args?.key)] ?? null
      case 'credentials_get':
        return 'test-key'
      case 'dsh_read_credentials':
        return undefined
      case 'http_request': {
        const httpReq = args?.req as HttpReq
        httpRequests.push(httpReq)
        if (httpReq.url === MCP_URL) {
          const payload = JSON.parse(decodeBody(httpReq.body)) as {
            id: number
            method: string
            params?: unknown
          }
          switch (payload.method) {
            case 'initialize':
              return jsonRpcResponse(
                payload.id,
                { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'brave', version: '1.0.0' } },
                { 'mcp-session-id': 'sess-1' },
              )
            case 'tools/list':
              return jsonRpcResponse(payload.id, {
                tools: [{
                  name: 'alpha',
                  description: 'Alpha search',
                  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
                }],
              })
            case 'tools/call': {
              const params = payload.params as { name: string; arguments: unknown }
              toolCalls.push({ name: params.name, arguments: params.arguments })
              lastToolResult = `brave-result: ${JSON.stringify(params.arguments)}`
              return jsonRpcResponse(payload.id, { content: [{ type: 'text', text: lastToolResult }] })
            }
            default:
              throw new Error(`unexpected MCP method ${payload.method}`)
          }
        }
        if (httpReq.url === COMPLETIONS_URL) {
          completionsRound += 1
          // The request carries the AGENT_TOOLS concat
          // (`[...STATIC_AGENT_TOOLS, ...mount.tools]`) as its `tools` array.
          // Emit the mounted tool_call ONLY when the request advertises it;
          // if the concat dropped `...mount.tools` the mock falls straight to
          // text, the loop never issues the mcp__ call, and the dispatch +
          // assistant-text assertions below fail.
          const completionsReq = JSON.parse(decodeBody(httpReq.body)) as {
            tools?: Array<{ function?: { name?: string } }>
          }
          const mcpToolAdvertised = (completionsReq.tools ?? []).some(tool => tool.function?.name === 'mcp__brave__alpha')
          const isToolRound = mcpToolAdvertised && completionsRound === 1
          // Round 1 advertises the mounted tool call; round 2 answers with text
          // built from the tools/call result recorded above (models the model
          // reading the `role: tool` message it was fed back).
          const delta = isToolRound
            ? { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'mcp__brave__alpha', arguments: '{"q":"x"}' } }] }
            : { content: `The alpha tool returned: ${lastToolResult}` }
          const sse = `data: ${JSON.stringify({ choices: [{ delta, finish_reason: isToolRound ? null : 'stop' }] })}\n\ndata: [DONE]\n`
          return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: Array.from(new TextEncoder().encode(sse)) }
        }
        throw new Error(`http_request: unexpected url ${httpReq.url}`)
      }
      default:
        return null
    }
  }
  ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke }
  return { calls, httpRequests, toolCalls }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
  closeSpy.mockClear()
  mountCalls.length = 0
})

/* ------------------------------------------------------------------ */
/*  the fixture glue                                                   */
/* ------------------------------------------------------------------ */

describe('fixture agent-loop MCP glue', () => {
  it('mounts enabled servers into AGENT_TOOLS, routes mcp__ calls through dispatch, and closes the mount', async () => {
    const mock = installTauriMock()
    const api = createFixtureApi({ realLlm: true })

    const created = await api.sessions.create(req({}))
    if (!created.result.ok) throw new Error('session create failed')
    const id = created.result.value.sessionId

    // Subscribe before prompting so the whole turn streams into `frames`.
    const abort = new AbortController()
    const frames: MuxFrame[] = []
    const consuming = (async () => {
      for await (const envelope of api.events.mux(req({}), abort.signal)) {
        frames.push(envelope.payload)
        if (envelope.payload.type === 'session/event' && envelope.payload.event.type === 'turn/end') {
          abort.abort()
        }
      }
    })()
    await new Promise(resolve => setTimeout(resolve, 10))

    const prompt = await api.sessions.prompt(req({
      sessionId: id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'search brave for x' }],
    }))
    expect(prompt.result).toMatchObject({ ok: true, value: { accepted: true } })
    await consuming

    // 1. The mount ran once with the ENABLED server (concat source).
    expect(mountCalls.length).toBeGreaterThan(0)
    expect(mountCalls[0]?.servers).toEqual([{ serverName: 'brave', spec: MCP_INVENTORY.servers.brave }])

    // 2. The mount connected and listed its tools over http (proves the mounted
    //    tools were available for the AGENT_TOOLS concat).
    expect(mock.httpRequests.some(req => req.url === MCP_URL && JSON.parse(decodeBody(req.body)).method === 'tools/list')).toBe(true)

    // 3. The mcp__ tool call was dispatched to the owning server's tools/call
    //    with the RAW name and the PARSED arguments — not the mcp__-prefixed
    //    name, not a string blob.
    const toolCall = mock.toolCalls.find(call => call.name === 'alpha')
    expect(toolCall).toBeTruthy()
    expect(toolCall?.arguments).toEqual({ q: 'x' })

    // 4. The final assistant text reflects the tools/call result (the tool
    //    result fed back as a `role: tool` message reached the model's reply).
    const assistant = frames.find(frame =>
      frame.type === 'session/event'
      && frame.event.type === 'assistant/message'
      && JSON.stringify(frame.event.data).includes('The alpha tool returned: brave-result'))
    expect(assistant).toBeTruthy()

    // 5. Teardown ran: the fixture's `finally { await mount.close() }` invoked
    //    the mount's close once the turn ended.
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
