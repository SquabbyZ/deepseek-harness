/**
 * MCP connection probe: a REAL initialize + tools/list handshake against an MCP
 * server, backing the per-row 测试 button in the MCP inventory tab.
 *
 * streamable-http: POST `initialize` then `tools/list` over `http_request` (the
 *   Tauri reqwest bridge — proxy-aware, no CORS). The initialize response's
 *   `Mcp-Session-Id` header is echoed on tools/list.
 * stdio: spawn the server via `mcp_stdio_spawn`, exchange newline-delimited
 *   JSON-RPC lines via `mcp_stdio_write`/`mcp_stdio_read` (polling for the
 *   response line), then `mcp_stdio_close`.
 *
 * The module is pure browser code with no cordis dependency; it reaches the
 * Tauri commands through the same `__TAURI_INTERNALS__` wrapper the fixture's
 * http_request path uses. Outside Tauri (no bridge) it returns
 * `{ ok: false, error: 'unavailable' }` instead of throwing.
 */

import type { McpServerSpec } from './inventory-store.ts'

/**
 * The probe result contract (ok=false always carries a human-readable `error`,
 * so failure badges never need a fallback string).
 */
export type ProbeResult =
  | { readonly ok: true; readonly toolCount: number }
  | { readonly ok: false; readonly toolCount: 0; readonly error: string }

/** Tauri invoke face — mirrors real-llm.ts; duplicated to avoid a cross-package dependency. */
interface TauriInvoke {
  <T>(cmd: string, args?: Record<string, unknown>): Promise<T>
}

/** Tauri buffered http response (the Rust reqwest client returns Vec<u8>). */
interface TauriHttpResponse {
  status: number
  headers: Record<string, string>
  body: number[]
}

/** The MCP protocol version this probe speaks (latest released at authoring time). */
const MCP_PROTOCOL_VERSION = '2025-03-26'
const MCP_CLIENT_NAME = 'deepseek-harness'
const MCP_CLIENT_VERSION = '0.1.0'
/** How long a stdio exchange waits for a complete response line before giving up. */
const STDIO_TIMEOUT_MS = 5000
/** Default timeout for each streamable-http POST (overridable via `opts.timeoutMs`). */
const HTTP_TIMEOUT_MS = 30_000
/** Pause between stdio read polls (each bridge read already waits ~50ms internally). */
const STDIO_POLL_MS = 10

/** The same `__TAURI_INTERNALS__` lookup real-llm.ts uses. */
function tauriInvoke(): TauriInvoke | undefined {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__
  const invoke = internals?.invoke
  return typeof invoke === 'function' ? (invoke as unknown as TauriInvoke) : undefined
}

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

/** A JSON-RPC response message (the fields this probe consumes). */
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

/** Count the tools in a tools/list result; malformed results throw. */
function toolsOf(result: unknown): number {
  const tools = (result as { tools?: unknown } | undefined)?.tools
  if (!Array.isArray(tools)) throw new Error('tools/list returned no tools array')
  return tools.length
}

/** POST one JSON-RPC request through the Tauri http bridge and return the raw response. */
async function httpPost(
  invoke: TauriInvoke,
  url: string,
  request: { id: number; method: string; params?: unknown },
  sessionId?: string,
  timeoutMs?: number,
): Promise<TauriHttpResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sessionId !== undefined) headers['mcp-session-id'] = sessionId
  const res = await invoke<TauriHttpResponse>('http_request', {
    req: { method: 'POST', url, headers, body: jsonBytes({ jsonrpc: '2.0', ...request }), timeout_ms: timeoutMs ?? HTTP_TIMEOUT_MS },
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${decodeBytes(res.body).slice(0, 400)}`)
  }
  return res
}

async function probeStreamableHttp(
  invoke: TauriInvoke,
  spec: Extract<McpServerSpec, { transport: 'streamable-http' }>,
  timeoutMs?: number,
): Promise<ProbeResult> {
  const initialize = await httpPost(invoke, spec.url, {
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    },
  }, undefined, timeoutMs)
  // Surface a JSON-RPC error on initialize; its result body is otherwise unused
  // beyond proving the handshake (the session id is the state we carry forward).
  parseJsonRpc(decodeBytes(initialize.body))
  const sessionId = headerValue(initialize.headers, 'mcp-session-id')
  const list = await httpPost(invoke, spec.url, { id: 2, method: 'tools/list' }, sessionId, timeoutMs)
  const parsed = parseJsonRpc(decodeBytes(list.body))
  return { ok: true, toolCount: toolsOf(parsed.result) }
}

/** Write one JSON-RPC line and poll reads until the matching response line arrives. */
async function stdioRequest(
  invoke: TauriInvoke,
  connId: number,
  id: number,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<JsonRpcMessage> {
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
        return { result: parsed.result }
      }
      // A notification or another connection's frame; keep polling.
    }
    await new Promise<void>(resolve => setTimeout(resolve, STDIO_POLL_MS))
  }
  throw new Error(`mcp_stdio: timed out waiting for ${method} response`)
}

async function probeStdio(
  invoke: TauriInvoke,
  spec: Extract<McpServerSpec, { transport: 'stdio' }>,
  timeoutMs: number,
): Promise<ProbeResult> {
  // An empty cwd must be omitted — the Rust bridge rejects a spawn whose cwd
  // does not live under the config dir, and an empty string never does.
  const spawnSpec: Record<string, unknown> = { command: spec.command, args: spec.args, env: spec.env }
  if (spec.cwd !== '') spawnSpec.cwd = spec.cwd
  const connId = await invoke<number>('mcp_stdio_spawn', { spec: spawnSpec })
  try {
    await stdioRequest(invoke, connId, 1, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    }, timeoutMs)
    const list = await stdioRequest(invoke, connId, 2, 'tools/list', undefined, timeoutMs)
    return { ok: true, toolCount: toolsOf(list.result) }
  } finally {
    // Best-effort teardown: a close failure after a successful handshake must
    // not turn the probe into a failure.
    try {
      await invoke<void>('mcp_stdio_close', { connId })
    } catch {
      /* the child is orphaned; the probe verdict already stands */
    }
  }
}

/**
 * Probe one MCP server with a real connection handshake.
 * @param spec - the persisted server spec (stdio or streamable-http).
 * @param opts - optional probe knobs; `timeoutMs` bounds the stdio exchange
 *   (default 5s) and each streamable-http POST (default 30s), shortened by tests.
 * @returns `{ ok, toolCount, error? }` per the plan contract.
 */
export async function probeMcpServer(
  spec: McpServerSpec,
  opts?: { timeoutMs?: number },
): Promise<ProbeResult> {
  const invoke = tauriInvoke()
  if (invoke === undefined) return { ok: false, toolCount: 0, error: 'unavailable' }
  try {
    if (spec.transport === 'stdio') {
      return await probeStdio(invoke, spec, opts?.timeoutMs ?? STDIO_TIMEOUT_MS)
    }
    return await probeStreamableHttp(invoke, spec, opts?.timeoutMs ?? HTTP_TIMEOUT_MS)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, toolCount: 0, error: reason }
  }
}
