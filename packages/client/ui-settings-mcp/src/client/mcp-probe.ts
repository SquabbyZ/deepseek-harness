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
import { resolveSpawnCommand } from './inventory-store.ts'

/**
 * The probe result contract (ok=false always carries a human-readable `error`,
 * so failure badges never need a fallback string).
 */
export type ProbeResult =
  | {
    readonly ok: true
    readonly toolCount: number
    /** Tool list returned by `tools/list`; surfaces in the details panel. */
    readonly tools: readonly ToolSummary[]
  }
  | { readonly ok: false; readonly toolCount: 0; readonly error: string }

/** Compact view of one MCP tool entry from `tools/list`. */
export interface ToolSummary {
  readonly name: string
  /** Description pulled from the JSON-RPC result, trimmed. */
  readonly description: string
}

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
/** How long a stdio exchange waits for a complete response line before giving up.
 *  Default 30s so `npx -y @modelcontextprotocol/server-…` has time to download
 *  the package on a cold cache (a no-op once npm has it cached). */
const STDIO_TIMEOUT_MS = 30_000
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

/** Project the `tools/list` result into compact summaries; malformed result throws. */
function toolsOf(result: unknown): readonly ToolSummary[] {
  const tools = (result as { tools?: unknown } | undefined)?.tools
  if (!Array.isArray(tools)) throw new Error('tools/list returned no tools array')
  return tools
    .map((raw) => {
      if (raw === null || typeof raw !== 'object') return null
      const entry = raw as { name?: unknown; description?: unknown }
      if (typeof entry.name !== 'string' || entry.name.length === 0) return null
      const description = typeof entry.description === 'string' ? entry.description.trim() : ''
      return { name: entry.name, description }
    })
    .filter((entry): entry is ToolSummary => entry !== null)
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
  const tools = toolsOf(parsed.result)
  return { ok: true, toolCount: tools.length, tools }
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
  // Rewrite the bare command name (e.g. `npx`) to the platform-correct form
  // (e.g. `npx.cmd`) before the Rust spawn gate sees it. This is a no-op for
  // entries that already carry the right extension or a full path, and it
  // makes old entries persisted before the rewrite existed work correctly.
  const resolved = resolveSpawnCommand(spec.command)
  // An empty cwd must be omitted — the Rust bridge rejects a spawn whose cwd
  // does not live under the config dir, and an empty string never does.
  const spawnSpec: Record<string, unknown> = { command: resolved, args: spec.args, env: spec.env }
  if (spec.cwd !== '') spawnSpec.cwd = spec.cwd
  const connId = await invoke<number>('mcp_stdio_spawn', { spec: spawnSpec })
  try {
    await stdioRequest(invoke, connId, 1, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    }, timeoutMs)
    const list = await stdioRequest(invoke, connId, 2, 'tools/list', undefined, timeoutMs)
    const tools = toolsOf(list.result)
    return { ok: true, toolCount: tools.length, tools }
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
 * Render an arbitrary thrown value as a human-readable string. Tauri invoke
 * rejections, JSON-RPC faults, and Promise.allSettled errors all surface as
 * plain objects — `String(err)` on those returns `"[object Object]"` and the
 * failure badge stops being useful. Pull `.message` out of common shapes and
 * fall back to JSON.stringify so a code field survives.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : error.name
  }
  if (typeof error === 'string') return error
  if (error === null) return 'null'
  if (error === undefined) return 'undefined'
  if (typeof error === 'object') {
    const obj = error as { message?: unknown; code?: unknown; reason?: unknown; detail?: unknown }
    // Tauri serializes `AppError` as `{ code, detail }` (no flat `message`).
    // The Rust `#[error("...")]` text never reaches JS, so reconstruct a
    // human-readable message from the structured fields: a `PermissionDenied`
    // surfaces as `{ code: 'PermissionDenied', detail: { cmd: 'npx.cmd' } }`
    // — we want the user to see "Shell permission denied: npx.cmd".
    const codeText = typeof obj.code === 'string' && obj.code.length > 0
      ? formatAppErrorCode(obj.code)
      : null
    if (codeText !== null) {
      const detailText = describeObjectDetail(obj.detail)
      if (detailText !== null) return `${codeText}: ${detailText}`
      return codeText
    }
    if (typeof obj.message === 'string' && obj.message.length > 0) {
      return obj.message
    }
    if (typeof obj.reason === 'string' && obj.reason.length > 0) return obj.reason
    try {
      return JSON.stringify(error)
    } catch {
      return Object.prototype.toString.call(error)
    }
  }
  return String(error)
}

/** Map known Rust `AppError` codes to a short human label, prefixed to the detail. */
function formatAppErrorCode(code: string): string | null {
  switch (code) {
    case 'PermissionDenied': return 'Shell permission denied'
    case 'FsPermissionDenied': return 'Filesystem permission denied'
    case 'FsIo': return 'Filesystem I/O error'
    case 'Network': return 'Network error'
    case 'Shell': return 'Shell error'
    case 'DeeplinkParse': return 'Deeplink parse failed'
    case 'InvalidManifest': return 'Plugin manifest invalid'
    case 'PluginNotBrowserSafe': return 'Plugin not browser-safe'
    case 'PluginHashMismatch': return 'Plugin hash mismatch'
    case 'PluginPermissionDenied': return 'Plugin permission denied'
    case 'Internal': return 'Internal error'
    default: return code
  }
}

/** Render an `AppError.detail` payload (its shape varies per variant) as a one-liner. */
function describeObjectDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null
  if (typeof detail === 'string') return detail
  if (typeof detail !== 'object') return null
  const d = detail as { cmd?: unknown; path?: unknown; message?: unknown; status?: unknown }
  if (typeof d.cmd === 'string') return `command ${d.cmd} is not in the spawn whitelist`
  if (typeof d.path === 'string') return `path ${d.path} is not in the allowlist`
  if (typeof d.message === 'string') return d.message
  if (typeof d.status === 'number') return `status ${d.status}`
  return null
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
    return { ok: false, toolCount: 0, error: describeError(error) }
  }
}
