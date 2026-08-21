/**
 * MCP server mount service for the interim agent loop (Task 7).
 *
 * When a user enables MCP servers in 设置 → MCP 管理, the persisted
 * `mcp-inventory` settings namespace (`{ servers: { [id]: McpServerSpec },
 * enabled: { [id]: boolean } }`) is the source of truth. This module turns the
 * enabled servers into LIVE JSON-RPC connections and exposes their tools to the
 * real-LLM agent loop in the fixture:
 *
 *   mountEnabledMcpServers({ servers }) → connect each enabled server once
 *     (stdio: `mcp_stdio_spawn` and hold the connId; streamable-http: POST
 *     `initialize` and hold the `Mcp-Session-Id`) → `tools/list` → convert each
 *     raw tool into an OpenAI tool definition named `mcp__<serverName>__<rawName>`
 *     with the inputSchema passed through as `parameters`.
 *
 *   result.dispatch(name, argumentsText) → route `mcp__<serverName>__<rawName>`
 *     back to the owning server's `tools/call` (stdio via the bridge connId,
 *     http via `http_request` echoing the session id) and return the text result.
 *
 * The module is pure browser code with no cordis dependency; it reaches the
 * Tauri commands through the same `__TAURI_INTERNALS__` wrapper real-llm.ts
 * uses. Outside Tauri (no bridge) it returns an empty mount.
 *
 * Connection lifecycle: one connect per mount, held warm for the caller's
 * lifetime and torn down via `close()` (the fixture mounts per agent turn and
 * closes when the turn ends, so stdio children are not leaked across turns). A
 * full MCP session manager is out of scope for the interim loop.
 */

import { tauriInvoke } from './real-llm.ts'

/**
 * The persisted spec of one MCP server, kept exact to ui-settings-mcp's
 * `McpServerSpec` (the `mcp-inventory` settings shape).
 */
export type McpMountSpec =
  | {
    readonly transport: 'stdio'
    readonly serverName: string
    readonly command: string
    readonly args: string[]
    readonly env: Record<string, string>
    readonly cwd: string
  }
  | {
    readonly transport: 'streamable-http'
    readonly serverName: string
    readonly url: string
    readonly headers: Record<string, string>
  }

/** One enabled server to mount. */
export interface McpMountServer {
  readonly serverName: string
  readonly spec: McpMountSpec
}

/** The context consumed by `mountEnabledMcpServers` (the enabled list, resolved by the caller). */
export interface McpMountContext {
  readonly servers: ReadonlyArray<McpMountServer>
  /** Overrides the stdio exchange timeout (tests shorten this). */
  readonly timeoutMs?: number
}

/** A tool definition advertised to the LLM (OpenAI tool shape, schema passthrough). */
export interface MountedMcpTool {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description?: string
    readonly parameters?: unknown
  }
}

/** The mounted surface the agent loop consumes. */
export interface McpMount {
  readonly tools: readonly MountedMcpTool[]
  /** Route one `mcp__<server>__<tool>` call to its server; resolves to the result text. */
  readonly dispatch: (name: string, argumentsText: string) => Promise<string>
  /** Tear down the live connections (stdio children are closed, http sessions dropped). */
  readonly close: () => Promise<void>
  /** Servers that failed to mount — best-effort: one failing server does not block the rest. */
  readonly errors: ReadonlyArray<{ serverName: string; error: string }>
}

/** Tauri invoke face — mirrors real-llm.ts's local interface (same shape). */
interface TauriInvoke {
  <T>(cmd: string, args?: Record<string, unknown>): Promise<T>
}

/** Tauri buffered http response (the Rust reqwest client returns Vec<u8>). */
interface TauriHttpResponse {
  status: number
  headers: Record<string, string>
  body: number[]
}

const MCP_PROTOCOL_VERSION = '2025-03-26'
const MCP_CLIENT_NAME = 'deepseek-harness'
const MCP_CLIENT_VERSION = '0.1.0'
/** How long a stdio exchange waits for a complete response line before giving up. */
const STDIO_TIMEOUT_MS = 30_000
/** Pause between stdio read polls (each bridge read already waits ~50ms internally). */
const STDIO_POLL_MS = 10

function decodeBytes(body: number[]): string {
  return new TextDecoder().decode(new Uint8Array(body))
}

function jsonBytes(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)))
}

/** Case-insensitive header lookup (reqwest lowercases response header names). */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

/** A JSON-RPC response message (the fields this module consumes). */
interface JsonRpcMessage {
  result?: unknown
  error?: { code?: number; message?: string }
}

/** Throw the JSON-RPC error message (or its code) when the response carries an error. */
function throwIfRpcError(message: JsonRpcMessage): void {
  if (message.error === undefined) return
  const text = typeof message.error.message === 'string' && message.error.message.length > 0
    ? message.error.message
    : `JSON-RPC error ${String(message.error.code ?? '')}`
  throw new Error(text)
}

/** Parse a JSON-RPC response body, surfacing JSON-RPC errors as thrown Errors. */
function parseJsonRpc(text: string): JsonRpcMessage {
  const parsed = JSON.parse(text) as JsonRpcMessage
  throwIfRpcError(parsed)
  return parsed
}

/** The `tools` array of a tools/list result; malformed results throw. */
function toolsOf(result: unknown): unknown[] {
  const tools = (result as { tools?: unknown } | undefined)?.tools
  if (!Array.isArray(tools)) throw new Error('tools/list returned no tools array')
  return tools
}

/** POST one JSON-RPC request through the Tauri http bridge and return the raw response. */
async function httpPost(
  invoke: TauriInvoke,
  url: string,
  request: { id: number; method: string; params?: unknown },
  headers: Record<string, string>,
): Promise<TauriHttpResponse> {
  const res = await invoke<TauriHttpResponse>('http_request', {
    req: { method: 'POST', url, headers, body: jsonBytes({ jsonrpc: '2.0', ...request }), timeout_ms: 30_000 },
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${decodeBytes(res.body).slice(0, 400)}`)
  }
  return res
}

/** A live per-server JSON-RPC connection (stdio connId held warm, or http session). */
interface McpConnection {
  listTools(): Promise<unknown[]>
  callTool(name: string, args: unknown): Promise<unknown>
  close(): Promise<void>
}

const initializeParams = {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
}

/** Connect a streamable-http server: initialize once, keep the session id for tools/call. */
async function connectHttp(invoke: TauriInvoke, spec: Extract<McpMountSpec, { transport: 'streamable-http' }>): Promise<McpConnection> {
  const baseHeaders: Record<string, string> = { 'content-type': 'application/json', ...spec.headers }
  const initialize = await httpPost(invoke, spec.url, { id: 1, method: 'initialize', params: initializeParams }, baseHeaders)
  // Surface a JSON-RPC error on initialize; its result body is otherwise unused
  // beyond proving the handshake (the session id is the state carried forward).
  parseJsonRpc(decodeBytes(initialize.body))
  const sessionId = headerValue(initialize.headers, 'mcp-session-id')
  let nextId = 2
  const request = async (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId++
    const headers = { ...baseHeaders }
    if (sessionId !== undefined) headers['mcp-session-id'] = sessionId
    const res = await httpPost(invoke, spec.url, { id, method, ...(params === undefined ? {} : { params }) }, headers)
    return parseJsonRpc(decodeBytes(res.body)).result
  }
  return {
    listTools: async () => toolsOf(await request('tools/list')),
    callTool: async (name, args) => request('tools/call', { name, arguments: args }),
    close: async () => {},
  }
}

/** Connect a stdio server: spawn once, keep the connId warm across requests. */
async function connectStdio(
  invoke: TauriInvoke,
  spec: Extract<McpMountSpec, { transport: 'stdio' }>,
  timeoutMs: number,
): Promise<McpConnection> {
  // An empty cwd must be omitted — the Rust bridge rejects a spawn whose cwd
  // does not live under the config dir, and an empty string never does.
  const spawnSpec: Record<string, unknown> = { command: spec.command, args: spec.args, env: spec.env }
  if (spec.cwd !== '') spawnSpec.cwd = spec.cwd
  const connId = await invoke<number>('mcp_stdio_spawn', { spec: spawnSpec })
  let nextId = 1
  const request = async (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId++
    await invoke<void>('mcp_stdio_write', {
      connId,
      line: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }),
    })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const line = await invoke<string | null>('mcp_stdio_read', { connId })
      if (line !== null) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        let parsed: JsonRpcMessage & { id?: unknown }
        try {
          parsed = JSON.parse(trimmed) as typeof parsed
        } catch {
          continue // not a JSON-RPC frame (a stray log line); keep polling
        }
        if (parsed.id === id) {
          throwIfRpcError(parsed)
          return parsed.result
        }
        // A notification or another connection's frame; keep polling.
      }
      await new Promise<void>(resolve => setTimeout(resolve, STDIO_POLL_MS))
    }
    throw new Error(`mcp_stdio: timed out waiting for ${method} response`)
  }
  try {
    await request('initialize', initializeParams)
  } catch (error) {
    // The spawn succeeded but the handshake failed — close the child so it is
    // not orphaned, then rethrow so the caller can skip the server.
    try {
      await invoke<void>('mcp_stdio_close', { connId })
    } catch {
      /* already closed */
    }
    throw error
  }
  return {
    listTools: async () => toolsOf(await request('tools/list')),
    callTool: async (name, args) => request('tools/call', { name, arguments: args }),
    close: async () => {
      try {
        await invoke<void>('mcp_stdio_close', { connId })
      } catch {
        /* best-effort teardown; the mount verdict already stands */
      }
    },
  }
}

/**
 * Slug the display serverName into the `mcp__<server>__<tool>` prefix. OpenAI
 * tool names must match `[a-zA-Z0-9_-]`, and a user-chosen display name ("My
 * Server") must not produce an invalid tool name. The dispatch routes through a
 * name → connection map, so the slugged prefix stays consistent on both sides.
 */
function toolNamePrefix(serverName: string): string {
  const slug = serverName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'mcp'
}

/** Build one OpenAI tool definition from a raw tools/list entry (schema passthrough). */
function toToolDef(serverName: string, raw: { name?: unknown; description?: unknown; inputSchema?: unknown }): MountedMcpTool | null {
  const rawName = typeof raw?.name === 'string' && raw.name.trim() !== '' ? raw.name : ''
  if (rawName === '') return null
  const description = typeof raw?.description === 'string' && raw.description.length > 0 ? raw.description : undefined
  const parameters = raw?.inputSchema
  return {
    type: 'function',
    function: {
      name: `mcp__${toolNamePrefix(serverName)}__${rawName}`,
      ...(description !== undefined ? { description } : {}),
      ...(parameters !== undefined && parameters !== null ? { parameters } : {}),
    },
  }
}

/** Project a tools/call result into the text the agent loop feeds back to the model. */
function toolResultText(result: unknown): string {
  const content = (result as { content?: unknown } | undefined)?.content
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        const block = item as { type?: unknown; text?: unknown }
        return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
      })
      .join('\n')
      .trim()
    if (text.length > 0) return text
  }
  const isError = (result as { isError?: unknown } | undefined)?.isError === true
  const payload = typeof result === 'string' ? result : JSON.stringify(result ?? null)
  return isError ? `(MCP 工具返回错误) ${payload}` : payload
}

/**
 * Mount the enabled MCP servers: connect each (spawn / initialize), read its
 * tools, and expose `mcp__<server>__<tool>` definitions plus a dispatch that
 * routes calls back to the owning server's `tools/call`.
 *
 * Best-effort per server: a server that fails to connect or list its tools is
 * skipped (recorded in `errors`) so one broken server does not break the turn.
 * With no servers (or no Tauri bridge) this is a no-op returning an empty mount.
 */
export async function mountEnabledMcpServers(ctx: McpMountContext): Promise<McpMount> {
  const empty: McpMount = {
    tools: [],
    dispatch: async (name) => {
      throw new Error(`MCP 工具未挂载：${name}`)
    },
    close: async () => {},
    errors: [],
  }
  const invoke = tauriInvoke()
  if (invoke === undefined || ctx.servers.length === 0) return empty

  const timeoutMs = ctx.timeoutMs ?? STDIO_TIMEOUT_MS
  const tools: MountedMcpTool[] = []
  const routes = new Map<string, { conn: McpConnection; rawName: string }>()
  const conns: McpConnection[] = []
  const errors: Array<{ serverName: string; error: string }> = []

  for (const { serverName, spec } of ctx.servers) {
    let conn: McpConnection
    try {
      conn = spec.transport === 'stdio'
        ? await connectStdio(invoke, spec, timeoutMs)
        : await connectHttp(invoke, spec)
    } catch (error) {
      errors.push({ serverName, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    conns.push(conn)
    let listed: unknown[]
    try {
      listed = await conn.listTools()
    } catch (error) {
      errors.push({ serverName, error: error instanceof Error ? error.message : String(error) })
      await conn.close()
      continue
    }
    for (const raw of listed) {
      const entry = raw as { name?: unknown; description?: unknown; inputSchema?: unknown }
      const def = toToolDef(serverName, entry)
      if (def === null) continue
      tools.push(def)
      const rawName = typeof entry.name === 'string' ? entry.name : ''
      routes.set(def.function.name, { conn, rawName })
    }
  }

  const dispatch = async (name: string, argumentsText: string): Promise<string> => {
    const route = routes.get(name)
    if (route === undefined) throw new Error(`MCP 工具未挂载：${name}`)
    let args: unknown
    try {
      args = JSON.parse(argumentsText || '{}')
    } catch {
      args = {}
    }
    const result = await route.conn.callTool(route.rawName, args)
    return toolResultText(result)
  }

  const close = async (): Promise<void> => {
    for (const conn of conns) {
      try {
        await conn.close()
      } catch {
        /* best-effort teardown */
      }
    }
  }

  return { tools, dispatch, close, errors }
}
