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
 *  1. Tauri runtime (`__TAURI_INTERNALS__`): `invoke('http_request_stream')` →
 *     the Rust reqwest client streams chunks back through Tauri events
 *     (`dsh-http-stream:<id>:start|chunk|end|error`). No CORS, no buffering.
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
  /** Tool-call requests from the model, when the request advertised tools. */
  toolCalls?: RealLlmToolCall[]
}

/** Streaming-mode SSE completion payload (the fields we consume). */
interface ChatDelta {
  choices?: Array<{
    delta?: {
      content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
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
interface TauriInternals {
  invoke?: TauriInvoke
  transformCallback?: <T>(callback: (response: T) => void, once: boolean) => number
}

export function tauriInvoke(): TauriInvoke | undefined {
  const internals = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  const invoke = internals?.invoke
  return typeof invoke === 'function' ? (invoke as unknown as TauriInvoke) : undefined
}

/**
 * One envelope Tauri 2 wraps every emitted payload in. The user's data lives
 * at `payload`; `event` is the topic name, `id` is a per-emission counter.
 * The previous shape passed the user payload straight through (Tauri 1 / a
 * few plugins still do), and reading `payload.status` silently returned
 * `undefined` — which is exactly what broke the first streaming call.
 */
interface TauriEvent<T> {
  readonly event: string
  readonly id: number
  readonly payload: T
}

/**
 * Tauri 2 event listen, without `@tauri-apps/api/event`. The webview IPC
 * exposes `__TAURI_INTERNALS__.transformCallback` to wrap a JS callback into
 * a callback id, then `invoke('plugin:event|listen', { event, target, handler })`
 * registers it on the event plugin. The returned `unlisten` calls
 * `plugin:event|unlisten` to deregister — without it the listener leaks
 * across calls. The wrapper returns a single Promise so the streaming code
 * stays `await`-linear.
 */
export function tauriListen<T>(
  event: string,
  handler: (event: TauriEvent<T>) => void,
): Promise<() => void> {
  const internals = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  const invoke = internals?.invoke
  const transform = internals?.transformCallback
  if (typeof invoke !== 'function' || typeof transform !== 'function') {
    return Promise.reject(new Error('tauriListen: __TAURI_INTERNALS__ unavailable'))
  }
  const callbackId = transform(handler as (response: unknown) => void, false)
  return invoke<number>('plugin:event|listen', {
    event,
    target: { kind: 'Any' },
    handler: callbackId,
  }).then(listenId => () => {
    void invoke('plugin:event|unlisten', {
      event,
      eventId: listenId,
    })
  })
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
async function readSseStream(response: Response, onDelta?: (text: string) => void): Promise<{ text: string; usage?: ChatDelta['usage'] }> {
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
        if (typeof piece === 'string') {
          text += piece
          onDelta?.(piece)
        }
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
  /** OpenAI tool definitions; when present the request advertises tools. */
  tools?: unknown[]
  /**
   * Optional streaming hook: invoked with each incremental text delta. The
   * completion payload arrives as small fragments (often 1-3 chars per
   * chunk) — pushing them to the UI on every call paints the response
   * token-by-token instead of waiting for the whole completion. Without
   * this, the conversation pane shows the reply all-at-once even though the
   * underlying transport is stream-shaped end-to-end.
   */
  onDelta?: (text: string) => void
}): Promise<RealLlmReply> {
  const { apiKey, model, messages, signal, baseUrl, api, tools, onDelta } = options
  // A provider's baseURL is the API root (…/v1); the completions path must be
  // appended unless the caller already passed a full endpoint.
  const url = baseUrl === undefined
    ? DEEPSEEK_COMPLETIONS_URL
    : /\/chat\/completions$/.test(baseUrl)
      ? baseUrl
      : `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body = JSON.stringify({
    model: realModelOf(model),
    messages,
    stream: true,
    ...(tools === undefined || tools.length === 0 ? {} : { tools, tool_choice: 'auto' }),
  })
  const headers = api === 'anthropic-messages'
    ? { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }

  // Tauri: streaming Rust reqwest (no CORS, no full-body buffering). The
  // `http_request` command used to read `resp.bytes().await` — that single
  // await held back every token until the LLM flushed the whole completion,
  // which made the official UI's first response arrive all-at-once instead
  // of streaming. `http_request_stream` mirrors the network chunks to Tauri
  // events one-for-one so the agent's first `assistant/chunk` lands while
  // the upstream is still producing later deltas.
  const invoke = tauriInvoke()
  if (invoke !== undefined) {
    return await callRealLlmTauriStream({
      apiKey, url, headers, body, signal, invoke,
      ...(onDelta === undefined ? {} : { onDelta }),
    })
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
  const { text, usage } = await readSseStream(response, onDelta)
  const reply: RealLlmReply = { text }
  if (usage != null) {
    reply.usage = {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      ...(usage.prompt_cache_hit_tokens !== undefined ? { cacheReadTokens: usage.prompt_cache_hit_tokens } : {}),
      ...(usage.prompt_cache_miss_tokens !== undefined ? { cacheWriteTokens: usage.prompt_cache_miss_tokens } : {}),
    }
  }
  return reply
}

/** Event-name prefix matching `STREAM_EVENT_PREFIX` in `commands/http.rs`. */
const TAURI_STREAM_PREFIX = 'dsh-http-stream'

interface TauriStreamStart {
  status: number
  headers: Record<string, string>
}
interface TauriStreamChunk {
  bytes: number[]
}
interface TauriStreamEnd {
  ok: boolean
}
interface TauriStreamError {
  message: string
}

/**
 * Tauri-side real LLM call. Subscribes to the four `dsh-http-stream:<id>:*`
 * events, invokes `http_request_stream` (which spawns a Rust task), and
 * assembles the reply from the chunks that arrive. The first `assistant/chunk`
 * from the agent sees text that has already streamed at least one delta, so
 * the UI renders progressively rather than all-at-once.
 *
 * `signal` is optional: when supplied, aborting it cancels the Rust task via
 * `http_request`'s `timeout_ms` expiry isn't possible, so we instead drop the
 * in-flight reply on `signal.aborted` and let the task drain server-side
 * (the listener is unregistered as soon as `end`/`error` fires either way).
 */
async function callRealLlmTauriStream(options: {
  apiKey: string
  url: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal | undefined
  invoke: TauriInvoke
  onDelta?: (text: string) => void
}): Promise<RealLlmReply> {
  const { url, headers, body, signal, invoke, onDelta } = options
  const streamId = cryptoRandomId()
  const startTopic = `${TAURI_STREAM_PREFIX}:${streamId}:start`
  const chunkTopic = `${TAURI_STREAM_PREFIX}:${streamId}:chunk`
  const endTopic = `${TAURI_STREAM_PREFIX}:${streamId}:end`
  const errorTopic = `${TAURI_STREAM_PREFIX}:${streamId}:error`

  // Single subscription set; we capture each `unlisten` as it resolves and
  // tear them all down when the terminal event fires (or the user aborts).
  const off: Array<() => void> = []
  const offAll = (): void => {
    while (off.length > 0) {
      const unlisten = off.shift()
      if (unlisten !== undefined) unlisten()
    }
  }

  try {
    return await new Promise<RealLlmReply>((resolve, reject) => {
      let status = 0
      let sseBuffer = ''
      let text = ''
      let usage: ChatDelta['usage']
      let toolCalls: RealLlmToolCall[] | undefined
      let finished = false
      const settle = (err?: string): void => {
        if (finished) return
        finished = true
        // Tear down inside the settle so a chunk that lands between
        // `end` and our cleanup can't push text onto a returned promise.
        offAll()
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
        if (err !== undefined) {
          reject(new Error(`real-llm: ${err}`))
          return
        }
        if (status < 200 || status >= 300) {
          reject(new Error(`real-llm: HTTP ${status}`))
          return
        }
        // Flush any tail SSE the last chunk left in the buffer (server didn't
        // terminate on a newline).
        if (sseBuffer.length > 0) {
          const tail = drainSseBuffer(`${sseBuffer}\n`)
          if (tail.text !== '') text += tail.text
          if (tail.usage !== undefined) usage = tail.usage
          if (tail.toolCalls !== undefined) toolCalls = mergeToolCalls(toolCalls, tail.toolCalls)
          sseBuffer = ''
        }
        const reply: RealLlmReply = { text }
        if (toolCalls !== undefined && toolCalls.length > 0) reply.toolCalls = toolCalls
        if (usage != null) {
          reply.usage = {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            ...(usage.prompt_cache_hit_tokens !== undefined ? { cacheReadTokens: usage.prompt_cache_hit_tokens } : {}),
            ...(usage.prompt_cache_miss_tokens !== undefined ? { cacheWriteTokens: usage.prompt_cache_miss_tokens } : {}),
          }
        }
        resolve(reply)
      }
      const onAbort = (): void => {
        settle('aborted')
      }

      // Subscribe BEFORE invoking so the first emit never lands in the void
      // (Rust only emits after `spawn` → `execute_streaming` reaches its
      // first `on_chunk`, which is well past the JS `await invoke(...)`
      // round-trip).
      void tauriListen<TauriStreamStart>(startTopic, (event) => {
        // Tauri 2 wraps every emitted payload in `{ event, id, payload }` — the
        // user-supplied data lives at `event.payload`. Accessing `event.status`
        // (the previous shape) silently produced `undefined` and the
        // accumulator never filled, so the UI saw an empty assistant message.
        status = event.payload.status
        if (status < 200 || status >= 300) settle(`HTTP ${status}`)
      }).then((unlisten) => { off.push(unlisten) }, (err: unknown) => {
        settle(err instanceof Error ? err.message : String(err))
      })
      void tauriListen<TauriStreamChunk>(chunkTopic, (event) => {
        if (finished) return
        sseBuffer += decodeBytes(event.payload.bytes)
        const parsed = drainSseBuffer(sseBuffer)
        sseBuffer = parsed.remainder
        if (parsed.text !== '') {
          text += parsed.text
          // Push the freshly-arrived fragment to the consumer immediately
          // (the conversation pane paints as deltas arrive). When the
          // consumer passes no hook, the underlying stream still
          // completes — the final reply text is the same — but the UI
          // renders in one shot at the end.
          onDelta?.(parsed.text)
        }
        if (parsed.usage !== undefined) usage = parsed.usage
        if (parsed.toolCalls !== undefined) {
          toolCalls = mergeToolCalls(toolCalls, parsed.toolCalls)
        }
      }).then((unlisten) => { off.push(unlisten) }, (err: unknown) => {
        settle(err instanceof Error ? err.message : String(err))
      })
      void tauriListen<TauriStreamEnd>(endTopic, () => { settle() }).then((unlisten) => { off.push(unlisten) })
      void tauriListen<TauriStreamError>(errorTopic, (event) => {
        settle(event.payload.message)
      }).then((unlisten) => { off.push(unlisten) })

      if (signal !== undefined && !signal.aborted) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      void invoke('http_request_stream', {
        streamId,
        req: {
          method: 'POST',
          url,
          headers,
          body: [...new TextEncoder().encode(body)],
          timeout_ms: 120_000,
        },
      }).catch((err: unknown) => {
        settle(err instanceof Error ? err.message : String(err))
      })
    })
  } catch (error) {
    // Safety net: even if `settle` couldn't fire (e.g. `offAll` threw), make
    // sure listeners don't leak past the awaited call.
    offAll()
    throw error
  }
}

/** Per-call unique id for the Tauri event subscription. */
function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Fallback for environments without crypto.randomUUID (older Safari).
  return `dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Drain SSE lines from `buffer`. Mirrors `parseBufferedSse` but only on
 * complete lines so a chunk arriving mid-line doesn't split a JSON payload.
 * The remainder is whatever's left of the partial line for the next chunk.
 */
function drainSseBuffer(buffer: string): {
  text: string
  usage?: ChatDelta['usage']
  toolCalls?: RealLlmToolCall[]
  remainder: string
} {
  let text = ''
  let usage: ChatDelta['usage']
  let toolCalls: RealLlmToolCall[] | undefined
  const lines = buffer.split('\n')
  const remainder = lines.pop() ?? ''
  for (const raw of lines) {
    const trimmed = raw.trim()
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
      const calls = parsed.choices?.[0]?.delta?.tool_calls
      if (Array.isArray(calls)) {
        for (const call of calls) {
          const index = call.index ?? 0
          toolCalls ??= []
          toolCalls[index] ??= { id: call.id ?? '', name: '', arguments: '' }
          if (typeof call.id === 'string' && call.id.length > 0) toolCalls[index].id = call.id
          if (typeof call.function?.name === 'string') toolCalls[index].name += call.function.name
          if (typeof call.function?.arguments === 'string') toolCalls[index].arguments += call.function.arguments
        }
      }
      if (parsed.usage !== undefined) usage = parsed.usage
    }
  }
  return {
    text,
    ...(usage === undefined ? {} : { usage }),
    ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { toolCalls }),
    remainder,
  }
}

/** Merge new tool-call deltas into an existing accumulator by index. */
function mergeToolCalls(
  previous: RealLlmToolCall[] | undefined,
  next: RealLlmToolCall[],
): RealLlmToolCall[] {
  const merged = previous !== undefined ? previous.slice() : []
  for (const call of next) {
    const index = merged.length // caller passed index 0 in normal flow
    merged[index] = merged[index] ?? { id: '', name: '', arguments: '' }
    if (call.id !== '') merged[index].id = call.id
    if (call.name !== '') merged[index].name += call.name
    if (call.arguments !== '') merged[index].arguments += call.arguments
  }
  return merged
}

/** One streamed tool-call fragment, concatenated by index across deltas. */
export interface RealLlmToolCall {
  /** Server-side call id (the `id` field on the first fragment). */
  id: string
  name: string
  /** Concatenated JSON argument string. */
  arguments: string
}

/** Per-call unique id for the Tauri event subscription. */
