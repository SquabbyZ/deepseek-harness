/**
 * Real LLM call for the fixture transport (opt-in `realLlm` mode).
 *
 * The official UI is a thin client: the host answers `session.prompt` by
 * running the agent loop and streaming turn events. The fixture is the
 * in-memory stand-in host; in `realLlm` mode it replaces the canned echo
 * replay with an actual chat-completions call so the official UI reaches a
 * real model end-to-end. The connection plugin's own `?fixture` gate keeps
 * the snapshot-test lanes deterministic (they never set `realLlm`).
 *
 * Transport order:
 *  1. Tauri runtime (`__TAURI_INTERNALS__`): `invoke('http_request')` → the
 *     Rust reqwest client. No CORS, and the response is buffered, so the call
 *     uses `stream: false` and returns the complete reply text.
 *  2. Plain browser: `fetch` streaming (SSE) — works when the provider's
 *     API sends CORS headers (local dev without Tauri).
 *
 * Model-name mapping: the client model catalog (fixture / provider catalog)
 * carries DSH model ids (`deepseek-v4-flash`), while the DeepSeek API serves
 * deployment ids (`deepseek-chat` / `deepseek-reasoner`). Unknown ids pass
 * through unchanged so a configured third-party endpoint keeps its own names.
 */

/** One chat message in the wire vocabulary the completions API accepts. */
export interface ChatCompletionMessageParam {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** One reply from the real endpoint. */
export interface RealLlmReply {
  /** Completed assistant text. */
  text: string
  /** Provider-reported billing (undefined when the endpoint omits it). */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
}

/** Streaming-mode SSE completion payload (the one field we consume). */
interface ChatDelta {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }
}

/** Default DeepSeek chat-completions endpoint. */
const DEEPSEEK_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions'

/** Map a DSH model catalog id onto the DeepSeek deployment id. */
export function realModelOf(model: string): string {
  if (model === 'deepseek-v4-flash') return 'deepseek-chat'
  if (model === 'deepseek-v4-pro') return 'deepseek-reasoner'
  return model
}

interface TauriInvoke {
  <T>(cmd: string, args?: Record<string, unknown>): Promise<T>
}
interface TauriHttpResponse {
  status: number
  headers: Record<string, string>
  body: number[]
}

export function tauriInvoke(): TauriInvoke | undefined {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__
  const invoke = internals?.invoke
  return typeof invoke === 'function' ? (invoke as unknown as TauriInvoke) : undefined
}

/** Credential transport backed by the Rust OS-keyring commands. */
export interface CredentialBackend {
  get(ref: string): Promise<string | null>
  set(ref: string, value: string): Promise<void>
  delete(ref: string): Promise<void>
}

/** The Tauri credential backend (Rust keyring), or undefined outside Tauri. */
export function tauriCredentialBackend(): CredentialBackend | undefined {
  const invoke = tauriInvoke()
  if (invoke === undefined) return undefined
  return {
    get: async (ref) => {
      try {
        const value = await invoke<string | null>('credentials_get', { key: ref })
        return typeof value === 'string' ? value : null
      } catch {
        return null
      }
    },
    set: async (ref, value) => {
      await invoke<void>('credentials_set', { key: ref, value })
    },
    delete: async (ref) => {
      await invoke<void>('credentials_delete', { key: ref })
    },
  }
}

/** Decode the Tauri buffered byte body (Rust reqwest returns Vec<u8>). */
function decodeBytes(body: number[]): string {
  return new TextDecoder().decode(new Uint8Array(body))
}

/** Read an SSE body into concatenated delta text (browser fetch streaming). */
async function readSseStream(response: Response): Promise<{ text: string; usage?: ChatDelta['usage'] }> {
  if (response.body === null) throw new Error('real-llm: response body is null')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage: ChatDelta['usage']
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        let delta: ChatDelta
        try {
          delta = JSON.parse(payload) as ChatDelta
        } catch {
          continue
        }
        const piece = delta.choices?.[0]?.delta?.content
        if (typeof piece === 'string') text += piece
        if (delta.usage !== undefined) usage = delta.usage
      }
    }
  } finally {
    reader.releaseLock()
  }
  return { text, usage }
}

/**
 * Call a real chat-completions endpoint and return the complete assistant text.
 * @param options - the API key, message list, model id, and abort signal.
 * @returns the reply text and provider usage.
 */
export async function callRealLlm(options: {
  apiKey: string
  model: string
  messages: ChatCompletionMessageParam[]
  signal?: AbortSignal
  /** Completions endpoint override (tests / self-hosted providers). */
  baseUrl?: string
  /** Provider protocol: `anthropic-messages` sends x-api-key; default Bearer. */
  api?: string
}): Promise<RealLlmReply> {
  const { apiKey, model, messages, signal, baseUrl, api } = options
  const url = baseUrl ?? DEEPSEEK_COMPLETIONS_URL
  const body = JSON.stringify({ model: realModelOf(model), messages, stream: true })
  const headers = api === 'anthropic-messages'
    ? { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }

  // Tauri: buffered Rust reqwest (no CORS). Non-streaming is unnecessary —
  // the body is complete when the invoke resolves, so parse the SSE body.
  const invoke = tauriInvoke()
  if (invoke !== undefined) {
    const res = await invoke<TauriHttpResponse>('http_request', {
      req: {
        method: 'POST',
        url,
        headers,
        body: [...new TextEncoder().encode(body)],
        timeout_ms: 120_000,
      },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`real-llm: HTTP ${res.status}: ${decodeBytes(res.body).slice(0, 400)}`)
    }
    const sse = decodeBytes(res.body)
    const parsed = parseBufferedSse(sse)
    const reply: RealLlmReply = { text: parsed.text }
    if (parsed.usage !== undefined) {
      reply.usage = {
        inputTokens: parsed.usage.prompt_tokens ?? 0,
        outputTokens: parsed.usage.completion_tokens ?? 0,
        ...(parsed.usage.prompt_cache_hit_tokens !== undefined ? { cacheReadTokens: parsed.usage.prompt_cache_hit_tokens } : {}),
        ...(parsed.usage.prompt_cache_miss_tokens !== undefined ? { cacheWriteTokens: parsed.usage.prompt_cache_miss_tokens } : {}),
      }
    }
    return reply
  }

  // Browser: streaming fetch (needs provider CORS; dev fallback).
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    throw new Error(`real-llm: HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`)
  }
  const { text, usage } = await readSseStream(response)
  const reply: RealLlmReply = { text }
  if (usage !== undefined) {
    reply.usage = {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      ...(usage.prompt_cache_hit_tokens !== undefined ? { cacheReadTokens: usage.prompt_cache_hit_tokens } : {}),
      ...(usage.prompt_cache_miss_tokens !== undefined ? { cacheWriteTokens: usage.prompt_cache_miss_tokens } : {}),
    }
  }
  return reply
}

/** Parse a buffered SSE document (the Tauri path delivers the body whole). */
function parseBufferedSse(body: string): { text: string; usage?: ChatDelta['usage'] } {
  let text = ''
  let usage: ChatDelta['usage']
  const errored = false
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') continue
    if (payload.startsWith('{')) {
      let parsed: ChatDelta
      try {
        parsed = JSON.parse(payload) as ChatDelta
      } catch {
        continue
      }
      const piece = parsed.choices?.[0]?.delta?.content
      if (typeof piece === 'string') text += piece
      if (parsed.usage !== undefined) usage = parsed.usage
      void errored
    }
  }
  return { text, usage }
}
