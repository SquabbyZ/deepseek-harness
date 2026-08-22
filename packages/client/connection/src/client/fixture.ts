// FixtureApi: standalone UI development without a server. Real contract shape: unary takes
// RpcRequest<P> and returns RpcResponse<T> (echoing the rpcId); streams yield RpcRequest<frame>
// (the fixture IS the fake server, so it mints frame rpcIds); root respond takes ClientResponse
// and returns RpcReceipt. fx-alpha carries a hand-built history script (74 turns, pageable);
// prompt triggers a chunked streaming replay; cancel stops the replay; resident pending
// approval/question requests exercise replay and composer takeover with stable rpcIds.

import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  isTokenDelta,
} from '@deepseek-ai/dsh-llm/message'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import type {
  AssistantMessage,
  ContentBlock,
  MessageSource,
  TokenUsage,
  ToolResultMessage,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  SessionEvent,
  SessionId,
  TodoItem,
} from '@deepseek-ai/dsh-session/types'
// Type-only: the brand constructor is host-side; the fixture casts at its
// wire-fabrication boundary (the schema layer's one-cast-point posture).
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandDescriptor, CommandExecution, CommandResult } from '@deepseek-ai/dsh-commands/types'
import { deriveEventMessage, foldSurface } from '@deepseek-ai/dsh-session/surface'
import type {
  ApiProxy, ClientRequest, ClientResponse, HistoryEntry, HostFrame, MuxFrame, RpcReceipt,
  ModelProviderGroup, ModelSelection, RpcRequest, RpcResponse, RpcResult, ServerRequest, ServerResponse, SessionSummary,
  ToolCallView, ToolEventView, ToolResultView, WorkspaceId, WorkspaceView,
} from './api.ts'
import type { RequestPayload, ResponseValue, RpcMethodMap } from '@deepseek-ai/dsh-host-apiproxy/api'
import { AbstractApiClient, RpcId, SESSION_SEARCH_RESULT_LIMIT } from './api.ts'
import { randomUuid } from './random-uuid.ts'
import { callRealLlm, tauriCredentialBackend, tauriInvoke, type RealLlmReply } from './real-llm.ts'
import { mountEnabledMcpServers } from './mcp-mount.ts'

/**
 * Fetch a provider's model list from its official `/models` endpoint. OpenAI-
 * compatible and Anthropic shapes are handled; the request rides the Tauri
 * reqwest client (proxy-aware) when present, else the browser fetch.
 */
async function fetchProviderModels(
  baseURL: string,
  api: string,
  apiKey: string,
): Promise<Array<{ id: string; name: string }>> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`
  const headers = api === 'anthropic-messages'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` }
  const invoke = tauriInvoke()
  const bodyText = invoke === undefined
    ? await fetch(url, { headers }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
    : await invoke<{ status: number; body: number[] }>('http_request', {
      req: { method: 'GET', url, headers, timeout_ms: 30_000 },
    }).then((res) => {
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
      return new TextDecoder().decode(new Uint8Array(res.body))
    })
  const data = JSON.parse(bodyText) as { data?: unknown; models?: unknown }
  const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : [])
  return list.flatMap((raw: { id?: unknown; name?: unknown }) => {
    const id = typeof raw?.id === 'string' ? raw.id : ''
    const name = typeof raw?.name === 'string' ? raw.name : (id || String(raw?.id ?? ''))
    return id === '' ? [] : [{ id, name }]
  })
}
import z from '@deepseek-ai/schemastery'
import type { ClientConnectionRpc } from '../rpc.ts'
import type { Context } from '@deepseek-ai/cordis'

/**
 * Detect whether the fixture is running on Windows via the same
 * `navigator.userAgent` sniff used elsewhere in the ecosystem
 * (`subagent-codex`, `subagent-claude-code`). The desktop shell whitelist
 * (`services::platform` in `desktop/src-tauri`) matches shell binaries
 * exactly — `tar.exe` on Windows, bare `tar` on macOS/Linux — so the skills.sh
 * install flow must send the platform-correct binary name or the spawn is
 * rejected with PermissionDenied.
 */
function isWindowsHost(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
    return navigator.userAgent.toLowerCase().includes('windows')
  }
  return false
}

/**
 * Parse YAML frontmatter from a skill's SKILL.md (`---\n...\n---`) with simple
 * line parsing (no YAML dependency). Only top-level string fields feed the
 * inventory: `name`, `description`, `whenToUse`. Quoted scalars and folded
 * block scalars (`|` / `>`) are handled; everything else is ignored. A block
 * scalar with no indented content before `---` yields `''` (rather than being
 * dropped), and trailing blank block lines are trimmed from the folded value.
 */
export function parseSkillFrontmatter(markdown: string): { name?: string; description?: string; whenToUse?: string } {
  const out: { name?: string; description?: string; whenToUse?: string } = {}
  const lines = markdown.split(/\r?\n/)
  const text = (n: number): string => lines[n] ?? ''
  let i = 0
  while (i < lines.length && text(i).trim() === '') i++
  if (text(i).trim() !== '---') return out
  i++
  for (; i < lines.length; i++) {
    const line = text(i)
    if (line.trim() === '---') break
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    if (key !== 'name' && key !== 'description' && key !== 'whenToUse') continue
    let value = line.slice(colon + 1).trim()
    let isBlockScalar = false
    if (value === '|' || value === '>') {
      isBlockScalar = true
      const block: string[] = []
      i++
      while (i < lines.length && text(i).trim() !== '---' && (text(i).startsWith(' ') || text(i).startsWith('\t'))) {
        block.push(text(i).trim())
        i++
      }
      // Fold the block into one line; trailing indented blank lines would
      // otherwise inject a trailing space (and an empty block yields '').
      value = block.join(' ').replace(/\s+$/, '')
      i--
    } else if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    // A block scalar is stored even when empty (''), so `description: |` with
    // no content still surfaces a (blank) description rather than no key.
    if (value !== '' || isBlockScalar) out[key as 'name' | 'description' | 'whenToUse'] = value
  }
  return out
}

/**
 * Derive the user's home directory from the DSH config dir (`~/.dsh`): strip
 * any trailing path separators, then the final path segment.
 * `C:/Users/x/.dsh` → `C:/Users/x`; `C:/Users/x/.dsh/` → `C:/Users/x`.
 */
export function homeFromDshConfigDir(dshConfigDir: string): string {
  return dshConfigDir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')
}

/**
 * Structural face of the client-side Loader the fixture reaches for the real
 * plugin inventory. The Loader (cordis-plugin-loader) augments `Context.loader`
 * with the full EntryTree API; the fixture only needs enumeration + one-entry
 * option updates, so it declares the minimal shape instead of importing the
 * loader package (which would drag the whole tree into the connection bundle).
 */
interface FixtureLoaderLike {
  entries(): Iterable<FixtureLoaderEntryLike>
  remove(id: string): Promise<void>
}
interface FixtureLoaderEntryLike {
  id: string
  options: { name?: string; disabled?: boolean | null }
  disabled: boolean
  fiber?: { state: number } | undefined
  update(options: { disabled?: boolean }): Promise<void>
}

/** Cordis FiberState ordinal → the phase string the inventory UI renders. */
const FIBER_PHASE_LABEL: Record<number, string> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: 'disposed',
  5: 'unloading',
}

/**
 * Shell-critical plugin ids that must never be disabled from the inventory
 * panel: turning them off would cut off the settings UI (or its RPC fabric)
 * with no way back in the client-first desktop shell.
 */
const SHELL_CRITICAL = new Set([
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  // Service providers that runtime testing showed cascade when disabled in the
  // single-process shell (their services are consumed at child-fiber level the
  // inject-edge check cannot see). Keep them locked.
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-settings-general',
])

/** The fake carrier mints like a real one (business code never mints). */
function rpcRequest<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(randomUuid()), payload }
}

function text(t: string): ContentBlock[] {
  return [{ type: 'text', text: t }]
}

/**
 * Split a real-LLM reply into content blocks: a leading `<think>…</think>`
 * reasoning block (MiniMax/DeepSeek stream it inline) renders through the
 * Think disclosure row instead of as raw text; the rest stays a text block.
 */
function contentBlocksFromReply(reply: string): ContentBlock[] {
  const match = /^\s*<think>([\s\S]*?)<\/think>\s*/i.exec(reply)
  if (match === null) return text(reply)
  const blocks: ContentBlock[] = [{ type: 'reasoning', text: match[1] ?? '' }]
  const rest = reply.slice(match[0].length)
  if (rest.trim().length > 0) blocks.push({ type: 'text', text: rest })
  return blocks
}

function userMessage(content: ContentBlock[], source: MessageSource = { kind: 'user' }): UserMessage {
  return createUserMessage({ content, source })
}

function assistantMessage(content: ContentBlock[], model = 'fx-1'): AssistantMessage {
  return createAssistantMessage({
    content,
    source: { provider: 'fixture', model },
  })
}

function toolResultMessage(callId: string, content: ContentBlock[], isError: boolean): ToolResultMessage {
  return createToolResultMessage({ callId: CallId(callId), content, isError })
}

const MARKDOWN_FIXTURE = [
  '# Markdown fixture',
  '',
  'Assistant output renders **strong text**, *emphasis*, and `inline code`.',
  '',
  '- first item',
  '  - nested item',
  '',
  '| Area | State |',
  '| --- | --- |',
  '| history | rendered |',
  '| streaming | stable |',
  '',
  '[DeepSeek](https://www.deepseek.com)',
  '',
  '```ts',
  'const markdown = true',
  '```',
].join('\n')

const USER_MARKDOWN_LITERAL = '用户字面量：# 不渲染 `code` [link](https://example.com)'

/**
 * SGR wrapper for the terminal output sample below: authoring the escapes as
 * `\u001b` keeps literal control bytes out of this source file.
 * @param code - the SGR parameter (an ANSI color or attribute number).
 * @param body - the text the attribute applies to.
 * @returns the body wrapped in the attribute and a reset.
 */
function sgr(code: number, body: string): string {
  return `\u001b[${code}m${body}\u001b[0m`
}

/**
 * Terminal output sample for fixture turn 66, authored to carry every feature
 * the terminal card draws that turn 60's two prompt rows cannot reach:
 * basic-16 SGR foreground runs (green, red, bright-black) that must resolve to
 * `--dsw-*` tokens, a bold run, column-aligned table rows that must scroll
 * rather than fold, more than DEFAULT_TERMINAL_MAX_LINES (16) lines so the
 * height cap collapses the middle. The exit status is authored separately in
 * TERMINAL_EXIT_STATUS and deliberately absent from this text: the real bash
 * presenter CONSUMES its `[exit code: N]` marker out of the body, because a
 * terminal card shows the exit as its own pill and leaving the marker in would
 * render it twice (packages/shell/tool-bash/src/render.ts).
 */
const TERMINAL_OUTPUT_FIXTURE = [
  sgr(1, 'Running 4 checks'),
  `${sgr(32, '\u2713')} typecheck                                          1.82s`,
  `${sgr(32, '\u2713')} lint                                               0.94s`,
  `${sgr(32, '\u2713')} duplication                                        2.10s`,
  `${sgr(31, '\u2717')} unit                                               8.41s`,
  '',
  sgr(90, 'packages/client/ui-primitives/tests/terminal-block.client.spec.tsx'),
  `  ${sgr(31, 'FAIL')} caps output at the configured line budget`,
  '    expected 16 lines, received 24',
  '',
  'NAME                        LINES    BRANCHES    FUNCTIONS    UNCOVERED',
  'TerminalBlock.tsx           100%     100%        100%         -',
  'ansi.ts                     100%     100%        100%         -',
  'clipboard.ts                100%     100%        100%         -',
  'CodeBlock.tsx               98.4%    96.2%       100%         41-43',
  'highlight.ts                100%     100%        100%         -',
  'Pill.tsx                    100%     100%        100%         -',
  'StateDot.tsx                100%     100%        100%         -',
  'markdown/Markdown.tsx       100%     100%        100%         -',
  '',
  sgr(31, '1 of 4 checks failed'),
].join('\n')

/**
 * Exit status for each terminal sample, keyed by its output text. Authored
 * alongside the sample rather than parsed back out of its trailing marker,
 * which is the bash tool's own job and not something to reimplement here.
 */
const TERMINAL_EXIT_STATUS: Record<string, { exitCode: number } | { signal: string }> = {
  [TERMINAL_OUTPUT_FIXTURE]: { exitCode: 1 },
}

/**
 * Structured grep result for the search sample (turn 67): matches grouped by
 * file, authored inline because the client-side fixture cannot import the tool
 * that produces the canonical value. `truncated` with a larger `total` than the
 * retained match count exercises the search card's capped indicator; the file
 * with more than CHAT_SEARCH_MAX_LINES rows exercises its head/tail height cap.
 */
const SEARCH_MATCHES_FIXTURE: { path: string; matches: { lineNumber: number; line: string }[] }[] = [
  {
    path: 'packages/client/ui-primitives/src/SearchBlock.tsx',
    matches: [
      { lineNumber: 16, line: 'export const DEFAULT_SEARCH_MAX_LINES = 16' },
      { lineNumber: 138, line: 'export function SearchBlock(props: SearchBlockProps) {' },
      { lineNumber: 141, line: '  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())' },
    ],
  },
  {
    path: 'packages/client/ui-tool/src/client/tool/models/search-card-model.ts',
    matches: [
      { lineNumber: 45, line: 'export const CHAT_SEARCH_MAX_LINES = 8' },
      { lineNumber: 130, line: 'export function searchCardModel(block: ToolCallBlock): SearchCardModel | null {' },
    ],
  },
  {
    path: 'packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx',
    matches: [
      { lineNumber: 34, line: 'export function SearchRow({ toolName, block, inspect, t }: SearchRowProps) {' },
      { lineNumber: 36, line: '  const search = searchCardModel(block)' },
      { lineNumber: 56, line: '      search={search}' },
      { lineNumber: 78, line: "      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow)" },
    ],
  },
]

/**
 * The model-facing grep render text for the sample — what a UI without a search
 * card shows, attached as the view's `content`. Mirrors the real grep
 * presenter's shape (see formatGrepOutput in dsh-tool-fs-search): a
 * `Found X of Y matches` header, the matches grouped under file headers with
 * `Line N:` rows, then a spill-recovery footer.
 */
const SEARCH_MATCHES_TEXT = [
  'Found 9 of 42 matches',
  '',
  ...SEARCH_MATCHES_FIXTURE.map(file =>
    [file.path, ...file.matches.map(m => `Line ${m.lineNumber}: ${m.line}`)].join('\n')),
  '',
  '(Full grep result stored at: fixture://spill/grep-66. Read it to see every match.)',
].join('\n')

/**
 * Structured glob result for the search sample (turn 68): a flat path list,
 * truncated with a larger `total` so the path card shows its capped indicator.
 */
const SEARCH_PATHS_FIXTURE = [
  'packages/client/ui-primitives/src/SearchBlock.tsx',
  'packages/client/ui-primitives/src/SearchBlock.module.css',
  'packages/client/ui-tool/src/client/tool/models/search-card-model.ts',
  'packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx',
  'packages/client/ui-tool/tests/search-card.client.spec.tsx',
]

/**
 * The model-facing glob render text — the newline-joined path list plus a
 * spill-recovery footer, mirroring the real glob presenter's shape (see
 * formatGlobOutput in dsh-tool-fs-search).
 */
const SEARCH_PATHS_TEXT = [
  ...SEARCH_PATHS_FIXTURE,
  '',
  '(Showing 5 of 23 paths. Full sorted result stored at: fixture://spill/glob-67. Read it to see every path.)',
].join('\n')

/**
 * Read-card sample for the read turn: a WINDOW past an offset, so the line
 * numbers start above 1 (the card's gutter keeps the file's own numbering) and
 * `totalLines` exceeds the window (the card shows a "showing N of M" note). The
 * fixture is client-side and cannot import the read tool, so the structured
 * window is authored inline exactly as the tool would project it through
 * `presentationMeta`. `lang` is a `ts` hint so the shiki path highlights it.
 */
const READ_SAMPLE_FIRST_LINE = 41
const READ_SAMPLE_SOURCE = [
  'export interface ReadBlockProps {',
  '  label?: string | undefined',
  '  lines: readonly ReadBlockLine[]',
  '  totalLines: number',
  '  lang?: string | undefined',
  '  maxLines?: number | undefined',
  '  className?: string | undefined',
  '}',
  '',
  '// A windowed read keeps the file line numbers in the gutter.',
  'const marker = "fixture read sample"',
]
const READ_SAMPLE_LINES = READ_SAMPLE_SOURCE.map((text, index) => ({ number: READ_SAMPLE_FIRST_LINE + index, text }))
const READ_SAMPLE_PATH = 'packages/client/ui-primitives/src/ReadBlock.tsx'
const READ_SAMPLE_TOTAL = 180
const READ_SAMPLE_TEXT = READ_SAMPLE_SOURCE.map((text, index) => `${READ_SAMPLE_FIRST_LINE + index}: ${text}`).join('\n')

/**
 * The structured `web_search` result view for the web-search turn, authored inline
 * because this client-side fixture cannot import the web tool that projects it.
 * The sources exercise the citation list's features: a titled source with a
 * snippet and a date, a source with no title (its hostname labels the link) and
 * a snippet but no date, and a source with a title and a date but no snippet.
 * `truncated` marks the capped indicator. The shape is the contract's own
 * search view minus its wire discriminants.
 */
const WEB_SEARCH_RESULT: Omit<Extract<ToolResultView, { card: 'web'; kind: 'search' }>, 'card' | 'kind'> = {
  answer: 'DeepSeek Harness is a plugin-based agent harness on vendored Cordis where **every capability is a plugin**.',
  sources: [
    {
      url: 'https://github.com/deepseek-ai/deepseek-harness',
      title: 'DeepSeek Harness — plugin-based agent harness',
      snippet: 'Everything is a plugin: session, tools, agent-loop, and LLM adapters all mount on the same Cordis context.',
      publishedAt: '2026-07-01',
    },
    {
      url: 'https://www.deepseek.com/blog/harness-architecture',
      snippet: 'The capability-seam pattern splits each capability into interface, implementation, and consumer packages.',
    },
    {
      url: 'https://docs.deepseek.com/harness/plugins',
      title: 'Writing a harness plugin',
      publishedAt: '2026-06-15',
    },
  ],
  truncated: true,
}

/** The `web_fetch` result view for the web-fetch turn, authored inline for the same reason. */
const WEB_FETCH_RESULT: Omit<Extract<ToolResultView, { card: 'web'; kind: 'fetch' }>, 'card' | 'kind'> = {
  url: 'https://www.deepseek.com/blog/harness-architecture',
  statusCode: 200,
  truncated: false,
}

const DEEPSEEK_REASONING = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
}

const OPENAI_REASONING = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'medium',
}

/** Catalog served by `session.models` and `llm.models` alike (fresh copies per call). */
function fixtureModelGroups(): ModelProviderGroup[] {
  return [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', description: '快速响应', reasoning: DEEPSEEK_REASONING },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: '复杂任务', reasoning: DEEPSEEK_REASONING },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI GPT',
      models: [
        { id: 'gpt-5', name: 'GPT-5', reasoning: OPENAI_REASONING },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini', reasoning: OPENAI_REASONING },
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      models: [
        { id: 'claude-opus-4', name: 'Claude Opus 4', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium' } },
        { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium' } },
      ],
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      models: [{ id: 'codex-1', name: 'Codex-1', reasoning: OPENAI_REASONING }],
    },
    {
      id: 'minimax',
      name: 'MiniMax',
      models: [{ id: 'minimax-text-01', name: 'MiniMax-Text-01' }, { id: 'abab7-chat', name: 'Abab7-Chat' }],
    },
    {
      id: 'glm',
      name: '智谱 GLM',
      models: [{ id: 'glm-4.7', name: 'GLM-4.7' }, { id: 'glm-4.5-flash', name: 'GLM-4.5-Flash' }],
    },
    {
      id: 'kimi',
      name: 'Moonshot Kimi',
      models: [{ id: 'kimi-k2', name: 'Kimi-K2' }, { id: 'kimi-k2-turbo', name: 'Kimi-K2-Turbo' }],
    },
  ]
}

/**
 * Declared provider routes the Models section offers: their default endpoint
 * (ConfigurableProviderView.baseUrl) pre-fills the editor's API 地址 field and
 * is the fallback baseUrl for model discovery / real-LLM calls when the user
 * hasn't saved an override.
 */
const DECLARED_PROVIDERS: ReadonlyArray<{
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  baseUrl: string
}> = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: ['providers', 'deepseek-official'], baseUrl: 'https://api.deepseek.com' },
  { provider: 'openai', displayName: 'OpenAI GPT', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], baseUrl: 'https://api.openai.com/v1' },
  { provider: 'anthropic', displayName: 'Anthropic Claude', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], baseUrl: 'https://api.anthropic.com' },
  { provider: 'codex', displayName: 'OpenAI Codex', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'codex'], baseUrl: 'https://api.openai.com/v1' },
  { provider: 'minimax', displayName: 'MiniMax', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'minimax'], baseUrl: 'https://api.minimaxi.com/v1' },
  { provider: 'glm', displayName: '智谱 GLM', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'glm'], baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { provider: 'kimi', displayName: 'Moonshot Kimi', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'kimi'], baseUrl: 'https://api.moonshot.cn/v1' },
  { provider: 'acme-gateway', displayName: 'Acme Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme-gateway'], baseUrl: 'https://gateway.example/v1' },
]

/** The default endpoint for a declared provider route, or undefined. */
function declaredProviderBaseUrl(provider: string): string | undefined {
  return DECLARED_PROVIDERS.find(entry => entry.provider === provider)?.baseUrl
}

/**
 * The model catalog a session sees: the providers the user actually configured
 * in 设置-模型 (llm-deepseek + llm-pi-ai), each with its saved models. Falls
 * back to the hardcoded defaults only when nothing is configured, so the
 * composer picker always has choices.
 */
function configuredModelGroups(
  deepseek: Record<string, unknown>,
  piAi: Record<string, unknown>,
): ModelProviderGroup[] {
  const groups: ModelProviderGroup[] = []
  const dsProfile = deepseek.providers as Record<string, { displayName?: string; models?: ModelProviderGroup['models'] }> | undefined
  const ds = dsProfile?.['deepseek-official']
  if (ds !== undefined) {
    // DeepSeek ships with its default models even before the user edits them.
    const defaultDs = fixtureModelGroups().find(group => group.id === 'deepseek-official')
    groups.push({
      id: 'deepseek-official',
      name: ds.displayName ?? 'DeepSeek',
      models: ds.models !== undefined && ds.models.length > 0 ? ds.models : (defaultDs?.models ?? []),
    })
  }
  const pi = piAi.providers as Record<string, { displayName?: string; models?: ModelProviderGroup['models'] }> | undefined
  if (pi !== undefined) {
    for (const [pid, profile] of Object.entries(pi)) {
      if (profile?.models !== undefined && profile.models.length > 0) {
        groups.push({ id: pid, name: profile.displayName ?? pid, models: profile.models })
      }
    }
  }
  return groups.length > 0 ? groups : fixtureModelGroups()
}

function sid(id: string): SessionId {
  return id as SessionId
}

const FIXTURE_IMAGE_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAAvklEQVR42u3SMQ0AAAjAMIyhELM4AAe8PD1qYFlk9cCXEAEDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGxIBCYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIAYEAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQDIgB4bYWLb6pnOb1xAAAAABJRU5ErkJggg=='
const FIXTURE_IMAGE_REF: ImageAttachmentRef = {
  attachmentId: 'fixture:image' as AttachmentIdType,
  mediaType: 'image/png',
  bytes: 247,
  width: 160,
  height: 90,
  name: 'fixture-image.png',
}

/** Deterministic provider billing attached to fixture assistant messages. */
function fixtureUsage(turn: number, step: number): TokenUsage {
  return {
    inputTokens: 20 + turn % 5,
    outputTokens: 8 + step,
    cacheReadTokens: turn === 0 ? 0 : 80,
    cacheWriteTokens: turn % 10 === 0 ? 4 : 0,
  }
}

/** fx-alpha history script: 75 turns (~150+ messages -> 4 pages at PAGE_MESSAGES=50),
 *  mixing reasoning blocks / tool call+result / context. */
function buildAlphaLog(): SessionEvent[] {
  const events: Record<string, unknown>[] = []
  let time = Date.now() - 3_600_000
  const push = (e: Record<string, unknown>): number => {
    const seq = events.length
    const data = e['data'] as Record<string, unknown> | undefined
    const authored = e['type'] === 'assistant/message' && data !== undefined
      ? {
        ...e,
        data: {
          ...data,
          usage: fixtureUsage(data['turn'] as number, data['step'] as number),
        },
      }
      : e
    events.push({ seq, time: (time += 800), ...authored })
    return seq
  }
  // This resident history represents completed model requests, so retain the
  // route capacity that accompanied them just as the live prompt path does.
  push({
    type: 'request/context',
    data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 128_000 },
  })
  for (let turn = 0; turn < 60; turn++) {
    push({ type: 'turn/start', data: { turn } })
    const userSeq = push({
      type: 'user/message', surfaceOp: 'append',
      data: userMessage(text(turn === 59 ? USER_MARKDOWN_LITERAL : `问题 ${turn}：fixture 历史消息，用于翻页与渲染验收。`)),
    })
    if (turn === 0) {
      push({
        type: 'session/title',
        data: { title: 'Fixture 历史会话', messageSeqs: [userSeq], source: { kind: 'fallback' } },
      })
    }
    if (turn % 9 === 4) {
      push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`[fixture] 上下文注入（turn ${turn}）`), { kind: 'plugin', plugin: 'fixture' }) })
    }
    push({ type: 'step/start', data: { turn, step: 0 } })
    const withTool = turn % 5 === 2
    const withReasoning = turn % 3 === 1
    const blocks: ContentBlock[] = []
    if (withReasoning) blocks.push({ type: 'reasoning', text: `思考过程 ${turn}：这是一段可折叠的 reasoning 内容。` })
    blocks.push({ type: 'text', text: turn === 59 ? MARKDOWN_FIXTURE : `回答 ${turn}：这是 fixture 生成的历史回复正文。` })
    if (withTool) {
      const callId = `fx-call-${turn}`
      blocks.push({ type: 'tool-call', id: callId, name: 'echo', arguments: `{"text":"turn ${turn}"}` } as ContentBlock)
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 0, message: assistantMessage(blocks) } })
      push({ type: 'tool/call', data: { turn, step: 0, callId, name: 'echo', arguments: `{"text":"turn ${turn}"}` } })
      push({ type: 'tool/result', surfaceOp: 'append', data: { turn, step: 0, message: toolResultMessage(callId, text(`ECHO: TURN ${turn}`), turn % 25 === 12) } })
      push({ type: 'step/end', data: { turn, step: 0 } })
      push({ type: 'step/start', data: { turn, step: 1 } })
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: assistantMessage(text(`工具结果已消化（turn ${turn}）。`)) } })
      push({ type: 'step/end', data: { turn, step: 1 } })
    } else {
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 0, message: assistantMessage(blocks) } })
      push({ type: 'step/end', data: { turn, step: 0 } })
    }
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  // Three view-sample turns (60-62) cover the built-in card types. The real filesystem names in
  // turns 62-63 also exercise their dedicated generic-row icon/title/path summaries. `echo` above
  // stays presenter-less as the unknown fallback.
  const toolTurn = (turn: number, name: string, args: string, resultText: string): void => {
    const callId = `fx-call-${turn}`
    push({ type: 'turn/start', data: { turn } })
    push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`问题 ${turn}：${name} 样本。`)) })
    push({ type: 'step/start', data: { turn, step: 0 } })
    push({
      type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 0, message: assistantMessage([{ type: 'tool-call', id: callId, name, arguments: args } as ContentBlock]) },
    })
    push({ type: 'tool/call', data: { turn, step: 0, callId, name, arguments: args } })
    push({ type: 'tool/result', surfaceOp: 'append', data: { turn, step: 0, message: toolResultMessage(callId, text(resultText), false) } })
    push({ type: 'step/end', data: { turn, step: 0 } })
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  // A two-line command, so the fixture covers the terminal card's one-row-per-
  // command-line prompt (and that the card still marks the call exactly once).
  toolTurn(60, 'fx-bash', '{"command":"ls -la\\necho done","cwd":"/tmp/fixture"}', 'total 2\ndrwxr-xr-x fixture\n-rw-r--r-- demo.txt')
  toolTurn(61, 'fx-write', '{"path":"notes/demo.txt","content":"hello fixture\\n"}', 'wrote notes/demo.txt')
  toolTurn(62, 'edit', '{"file_path":"notes/demo.txt","old_string":"hello","new_string":"hello fixture"}', '已编辑')
  toolTurn(63, 'write', '{"file_path":"notes/new-demo.txt","content":"hello fixture\\n"}', '已写入')
  // Turn 64: a multi-hunk edit — two scattered replacements in one file. Named
  // `edit` so it lands on the keyed FileMutationRow (the resident diff card the
  // single-hunk turn 62 also uses), and file_path `src/config.ts` is the marker
  // the presenter reads to emit the two-hunk sample: the card draws one path
  // header, the first hunk, a `⋯` gap, then the second (the same-file
  // second-hunk arm turns 62/63 cannot reach).
  toolTurn(64, 'edit', '{"file_path":"src/config.ts","old_string":"const timeout = 30","new_string":"const timeout = 60"}', '已编辑')
  // Turn 65: one run_code turn with three logged sub-dispatches — the Code
  // Mode acceptance surface (parent code row + nested native-identical rows,
  // including an isError sub-call and a bash sub-call that must hit the same
  // keyed registration a top-level bash row uses).
  {
    const turn = 65
    const callId = `fx-call-${turn}`
    const program = 'const listing = await tools.bash({ command: "ls notes", description: "List notes" })\n'
      + 'const demo = await tools.read({ file_path: "notes/demo.txt" })\n'
      + 'await tools.read({ file_path: "notes/missing.txt" }).catch(() => "tolerated")\n'
      + 'return { listing, demo }'
    const args = JSON.stringify({ code: program, description: 'Read the notes files and summarize' })
    push({ type: 'turn/start', data: { turn } })
    push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`问题 ${turn}：run_code 样本。`)) })
    push({ type: 'step/start', data: { turn, step: 0 } })
    push({
      type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 0, message: assistantMessage([{ type: 'tool-call', id: callId, name: 'run_code', arguments: args } as ContentBlock]) },
    })
    push({ type: 'tool/call', data: { turn, step: 0, callId, name: 'run_code', arguments: args } })
    const dispatchPair = (n: number, name: string, dispatchArgs: Record<string, unknown>, resultText: string, isError = false): void => {
      push({
        type: 'tool/code-dispatch-start',
        data: { rootCallId: callId, parentCallId: callId, subCallId: `${callId}:code:${n}`, name, arguments: dispatchArgs },
      })
      push({
        type: 'tool/code-dispatch',
        data: {
          rootCallId: callId, parentCallId: callId, subCallId: `${callId}:code:${n}`, name,
          arguments: dispatchArgs, isError, content: [{ type: 'text', text: resultText }],
        },
      })
    }
    dispatchPair(1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt\nnew-demo.txt')
    dispatchPair(2, 'read', { file_path: 'notes/demo.txt' }, 'hello fixture\n')
    dispatchPair(3, 'read', { file_path: 'notes/missing.txt' }, 'Error: ENOENT: notes/missing.txt not found', true)
    push({
      type: 'tool/result', surfaceOp: 'append',
      data: { turn, step: 0, message: toolResultMessage(callId, text('{"listing":"demo.txt\\nnew-demo.txt","demo":"hello fixture\\n"}'), false) },
    })
    push({ type: 'step/end', data: { turn, step: 0 } })
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  // Turn 74: todo_write sample — the TodoRow toolview in the flow plus the
  // todo/write snapshot event feeding the TodoPanel plan strip. Two items are
  // in_progress: this fixture chooses the parallel policy, so both surfaces
  // must render a parallel plan rather than the first active item alone.
  const fixtureTodos = [
    { content: '梳理需求', status: 'completed' },
    { content: '实现 fixture 样本', status: 'in_progress' },
    { content: '跑后台构建', status: 'in_progress' },
    { content: '浏览器验收', status: 'pending' },
  ]
  // Turn 66: the terminal sample turn 60's two clean prompt rows cannot cover —
  // ANSI SGR coloring, output past the terminal card's height cap, a nested cwd
  // whose prompt label is its last segment, and a non-zero exit authored beside
  // the sample in TERMINAL_EXIT_STATUS — its body deliberately carries no
  // `[exit code: N]` marker, since the real presenter consumes that one out of
  // the body. Named `bash`, so it also covers
  // the keyed toolview row (turn 60's `fx-bash` covers the render-site fallback
  // row) — the two chat-row shapes the terminal card renders in.
  //
  // Ordered BEFORE the todo turn deliberately: the standing plan retires at the
  // next `turn/start`, so a turn appended after it would leave the dock's plan
  // strip empty and take the todo surfaces' own coverage with it.
  toolTurn(66, 'bash', '{"command":"pnpm run check","cwd":"/tmp/fixture/deep/nested"}', TERMINAL_OUTPUT_FIXTURE)

  // Turns 67-68: the search card's two shapes. `grep` emits a `card: 'search'`
  // `shape: 'matches'` result view (grouped-by-file matches, truncated with a
  // larger `total`), `glob` emits `shape: 'paths'` (a flat path list, likewise
  // truncated). Both ride the keyed SearchRow registration under their own
  // names; the render-site fallback row is covered by the model derivation
  // tests, since every fixture search tool has a keyed row. Ordered before the
  // todo turn for the same standing-plan reason the bash turn is.
  toolTurn(67, 'grep', '{"pattern":"SEARCH_MAX_LINES","path":"packages/client"}', SEARCH_MATCHES_TEXT)
  toolTurn(68, 'glob', '{"pattern":"**/SearchBlock*","path":"packages/client"}', SEARCH_PATHS_TEXT)

  // Turn 69: the read sample — a WINDOW past an offset so the card draws file
  // line numbers starting above 1 and a "showing N of M" note (the window is
  // shorter than READ_SAMPLE_TOTAL), with a `ts` language hint the shiki path
  // highlights. Named `read`, so it exercises the keyed ReadRow registration.
  // The render-site fallback ROW SHAPE (a read call on the generic flattened
  // path) is covered by the turn 65 run_code read sub-dispatches, which
  // session.ts folds with resultView: null; the fallback-row + read-CARD
  // combination is pinned by the web_fetch case in read-card.spec.tsx, not by
  // this fixture. The read render intent is result-side only, so its pending
  // call stays a generic `kind: 'read'` card; presentResult carries the
  // structured window.
  toolTurn(69, 'read', `{"file_path":${JSON.stringify(READ_SAMPLE_PATH)},"offset":${READ_SAMPLE_FIRST_LINE}}`, READ_SAMPLE_TEXT)

  // Turns 70-71: the web render intent — a web_search whose result view carries
  // structured sources plus an answer (the citation list, one source lacking a
  // title so its hostname labels the link, the capped indicator on), and a
  // web_fetch whose result view carries the fetched URL and its HTTP status.
  // Both keep a generic pending call view and add the `web` card only at
  // result time, which is the contract's result-only web shape. Named after
  // the real tools so they hit the keyed WebRow registration. Ordered BEFORE
  // the todo turn for the same reason turn 66 is: the standing plan retires at
  // the next turn/start, so a turn after it would empty the dock's plan strip.
  toolTurn(70, 'web_search', '{"query":"deepseek harness architecture"}', 'Search results for deepseek harness architecture.')
  toolTurn(71, 'web_fetch', '{"url":"https://www.deepseek.com/blog/harness-architecture"}', '# Harness architecture\n\nEverything is a plugin.')

  // Turn 72: max-tokens sample — the provider ends the turn at its output cap
  // mid-sentence, so the chat flow must render the turn-max-tokens notice
  // instead of ending silently. Ordered before the todo turn for the same
  // standing-plan reason the bash turn is.
  push({ type: 'turn/start', data: { turn: 72 } })
  push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text('问题 72：请完整列出全部一百条条目。')) })
  push({ type: 'step/start', data: { turn: 72, step: 0 } })
  push({
    type: 'assistant/message',
    surfaceOp: 'append',
    data: { turn: 72, step: 0, message: assistantMessage(text('条目 1：第一条。条目 2：第二条。条目 3：这一条写到一半被')) },
  })
  push({ type: 'step/end', data: { turn: 72, step: 0 } })
  push({ type: 'turn/end', data: { turn: 72, reason: { kind: 'max-tokens' } } })

  // Turn 73: user and assistant images share one durable fixture object.
  // The todo turn remains last so its standing projection stays visible.
  push({ type: 'turn/start', data: { turn: 73 } })
  push({
    type: 'user/message',
    surfaceOp: 'append',
    data: userMessage([{ type: 'image', attachment: FIXTURE_IMAGE_REF }, ...text('历史用户图片')]),
  })
  push({ type: 'step/start', data: { turn: 73, step: 0 } })
  push({
    type: 'assistant/message',
    surfaceOp: 'append',
    data: {
      turn: 73,
      step: 0,
      message: assistantMessage(
        [...text('结构化模型图片：'), { type: 'image', attachment: FIXTURE_IMAGE_REF }],
        'fx-vision',
      ),
    },
  })
  push({ type: 'step/end', data: { turn: 73, step: 0 } })
  push({ type: 'turn/end', data: { turn: 73, reason: { kind: 'completed' } } })

  const todoArgs = JSON.stringify({ todos: fixtureTodos })
  toolTurn(74, 'todo_write', todoArgs, 'Updated todo list: 1 pending, 2 in progress, 1 completed.')
  // The real tool appends the snapshot mid-execution — between tool/call and
  // tool/result — so the fixture reproduces that exact ordering (the last
  // toolTurn events run ... tool/call, tool/result, step/end, turn/end).
  const callIndex = events.length - 4
  const callTime = events[callIndex]?.time as number
  events.splice(callIndex + 1, 0, { type: 'todo/write', time: callTime + 400, data: { todos: fixtureTodos } })
  events.forEach((e, i) => { e.seq = i })
  return events as unknown as SessionEvent[]
}

/** Narrows a parsed-JSON field to string; fixture args are authored in-file, so non-strings only mean a typo here. */
/* v8 ignore next -- the fallback arm is the same in-file-typo guard as the JSON.parse catch above. */
const str = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

/** Fixture presenter registry (mirrors host viewFor): pure derivation, undefined = no view. */
function presentCall(name: string, argsRaw: string): ToolCallView | undefined {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsRaw) as Record<string, unknown>
  } catch {
    /* v8 ignore next 2 -- defensive: fixture args are authored in-file as valid JSON; only an in-file typo could reach the catch. */
    return undefined
  }
  switch (name) {
    // Both names present the same terminal card: `fx-bash` lands on the
    // render-site fallback row, `bash` on the keyed BashRow registration.
    case 'fx-bash':
    case 'bash':
      return { card: 'terminal', title: str(args.command), cwd: str(args.cwd, '/tmp/fixture'), description: 'fixture 终端样本' }
    case 'fx-write':
      return {
        card: 'diff', title: `Write ${str(args.path)}`,
        diffs: [{ path: str(args.path), oldText: null, newText: str(args.content) }],
      }
    // A read pending call is a GENERIC card (kind: 'read', a follow-along
    // location): the read render intent is result-side only, because a call
    // carries no file content until execute returns. The rich read card arrives
    // in presentResult.
    case 'read':
      return { card: 'generic', title: `Read ${str(args.file_path)}`, kind: 'read', locations: [{ path: str(args.file_path) }] }
    case 'edit':
      // The multi-hunk sample (turn 64) is keyed on its file_path, so the two
      // scattered hunks share one path header and the card draws the `⋯` gap.
      if (str(args.file_path) === 'src/config.ts') {
        return {
          card: 'diff', title: `Edit ${str(args.file_path)}`,
          diffs: [
            { path: str(args.file_path), oldText: 'const timeout = 30', newText: 'const timeout = 60' },
            { path: str(args.file_path), oldText: 'retries: 1', newText: 'retries: 3' },
          ],
        }
      }
      return {
        card: 'diff', title: `Edit ${str(args.file_path)}`,
        diffs: [{ path: str(args.file_path), oldText: str(args.old_string), newText: str(args.new_string) }],
      }
    case 'write':
      return {
        card: 'diff', title: `Write ${str(args.file_path)}`,
        diffs: [{ path: str(args.file_path), oldText: null, newText: str(args.content) }],
      }
    // A search call stays a generic card (kind: 'search'): the structured
    // matches/paths exist only after execute, so the search card is result-time
    // only (presentResult builds it). This mirrors the real grep/glob presenters.
    case 'grep':
      return { card: 'generic', title: `Grep ${str(args.pattern)}`, kind: 'search', rawInput: args }
    case 'glob':
      return { card: 'generic', title: `Glob ${str(args.pattern)}`, kind: 'search', rawInput: args }
    // The web tools keep a GENERIC pending card and add the `web` result card
    // only at result time (the contract's result-only web shape); their pending
    // kind matches the result kind so a call and its result read as one category.
    case 'web_search':
      return { card: 'generic', title: `Search ${str(args.query)}`, kind: 'search', rawInput: args }
    case 'web_fetch':
      return { card: 'generic', title: `Fetch ${str(args.url)}`, kind: 'fetch', rawInput: args }
    default:
      return undefined // echo et al: the documented no-view fallback path
  }
}

function presentResult(name: string, argsRaw: string, resultText: string): ToolResultView | undefined {
  const call = presentCall(name, argsRaw)
  if (call === undefined) return undefined
  // Search is result-time only: the call stays a generic search card, and the
  // result view carries the structured shape the card renders. The view holds no
  // result text — a UI without a search card falls back to the raw tool/result
  // content — so the truncation recovery footer rides that raw content (the
  // `toolTurn` message text), not the view. `total` exceeds the retained count so
  // the card shows its capped indicator.
  if (name === 'grep') {
    return { card: 'search', shape: 'matches', files: SEARCH_MATCHES_FIXTURE, truncated: true, total: 42 }
  }
  if (name === 'glob') {
    return { card: 'search', shape: 'paths', paths: SEARCH_PATHS_FIXTURE, truncated: true, total: 23 }
  }
  // The read result is the structured window the tool projects through
  // `presentationMeta`; the fixture authors it inline (it cannot import the
  // tool). Keyed on the name because the read pending call is a generic card,
  // so `call.card` alone does not distinguish it from edit/write.
  if (name === 'read') {
    return {
      card: 'read', path: READ_SAMPLE_PATH, offset: READ_SAMPLE_FIRST_LINE, lines: READ_SAMPLE_LINES,
      totalLines: READ_SAMPLE_TOTAL, lang: 'ts', content: text(resultText),
    }
  }
  // The web tools keep a generic pending card, so their result card is chosen
  // by tool name rather than by the pending card tag: the structured `web` card
  // the frontend consumes. The view carries no `content` copy (per the contract
  // and the web-result-card note); a capability-less UI falls back to the raw
  // `tool/result` content, which this fixture emits from `resultText`.
  if (name === 'web_search') {
    return { card: 'web', kind: 'search', ...WEB_SEARCH_RESULT }
  }
  if (name === 'web_fetch') {
    return { card: 'web', kind: 'fetch', ...WEB_FETCH_RESULT }
  }
  switch (call.card) {
    case 'terminal':
      // The sample's own exit status, authored beside it: re-parsing the
      // trailing marker here would duplicate the bash tool's `parseExitStatus`,
      // which this client-side fixture cannot import.
      return { card: 'terminal', output: resultText, ...(TERMINAL_EXIT_STATUS[resultText] ?? { exitCode: 0 }) }
    case 'diff':
      return { card: 'diff', diffs: call.diffs }
    case 'generic':
      return { card: 'generic', content: text(resultText) }
  }
}

/** Host-side viewFor mirror: tool/call presents from its own args; tool/result back-scans the log for the paired call. */
function viewFor(event: SessionEvent, log: readonly SessionEvent[]): ToolEventView | undefined {
  if (event.type === 'tool/call') {
    const view = presentCall(event.data.name, event.data.arguments)
    return view === undefined ? undefined : { for: 'call', view }
  }
  if (event.type === 'tool/result') {
    const callId = String(event.data.message.source.callId)
    for (let i = log.length - 1; i >= 0; i--) {
      const candidate = log[i]
      /* v8 ignore next -- dense-array guard: i stays within [0, log.length),
      so the undefined arm needs a sparse log no code path builds. */
      if (candidate !== undefined && candidate.type === 'tool/call' && String(candidate.data.callId) === callId) {
        const resultText = event.data.message.content[0].content.map(b => (b.type === 'text' ? b.text : '')).join('')
        const view = presentResult(candidate.data.name, candidate.data.arguments, resultText)
        return view === undefined ? undefined : { for: 'result', view }
      }
    }
    return undefined // cross-page unpaired: documented default
  }
  return undefined
}

/**
 * Fixture parallel of the plan unit's double-event fold: `command/run`
 * records named `plan` with recorded input set the wanted target (`off` →
 * false, else true); `plan/mode` commits and clears it. `wanted` is exposed
 * for the prompt boundary (the fixture's step/start parallel).
 */
function foldPlan(log: readonly SessionEvent[]): { active: boolean; pending: boolean; wanted: boolean | null } {
  let active = false
  let wanted: boolean | null = null
  for (const event of log) {
    const item = event as unknown as { type: string; data?: Record<string, unknown> }
    if (item.type === 'command/run' && item.data?.['name'] === 'plan') {
      const args = item.data['args']
      if (typeof args !== 'string') continue
      wanted = args.trim() !== 'off'
    } else if (item.type === 'plan/mode') {
      active = item.data?.['active'] === true
      wanted = null
    }
  }
  return { active, pending: wanted !== null && wanted !== active, wanted }
}

/** The plan projection's wire view over the full log. */
function planViewOf(log: readonly SessionEvent[]): { active: boolean; pending: boolean } {
  const plan = foldPlan(log)
  return { active: plan.active, pending: plan.pending }
}

/** Fixture parallel of the host's projection units: whole current values per key over the full log. */
/** Fixture preset table (the host PermissionPresetService defaults). */
const PERMISSION_PRESETS: Record<string, { sandbox: string; approval: string; description: string }> = {
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never', description: 'Full file access without approval prompts.' },
  'read-only': { sandbox: 'read-only', approval: 'never', description: 'Read-only access to the workspace; no writes or state changes.' },
}

/** Host permissions-unit parallel: fold the three knob events, derive the select over the fixture defaults. */
function permissionSelectOf(
  log: readonly SessionEvent[],
): { options: { value: string; name: string; description?: string }[]; currentValue: string } {
  let preset: string | null = null
  let sandbox = 'workspace-write'
  let approval = 'ask'
  for (const event of log) {
    const item = event as { type: string; data: Record<string, unknown> }
    if (item.type === 'permission/preset') preset = item.data['preset'] as string
    else if (item.type === 'sandbox/mode') sandbox = item.data['mode'] as string
    else if (item.type === 'approval/policy') approval = item.data['policy'] as string
  }
  const matches = (spec: { sandbox: string; approval: string }): boolean => spec.sandbox === sandbox && spec.approval === approval
  let currentValue = 'custom'
  const folded = preset === null ? undefined : PERMISSION_PRESETS[preset]
  if (preset !== null && folded !== undefined && matches(folded)) {
    currentValue = preset
  } else {
    for (const [name, spec] of Object.entries(PERMISSION_PRESETS)) {
      if (matches(spec)) { currentValue = name; break }
    }
  }
  return {
    options: [
      ...Object.entries(PERMISSION_PRESETS).map(([value, spec]) => ({ value, name: value, description: spec.description })),
      ...currentValue === 'custom' ? [{ value: 'custom', name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' }] : [],
    ],
    currentValue,
  }
}

interface FixtureTokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface FixtureUsageSample {
  turn: number
  step: number
  usage: TokenUsage
}

/** Read one provider usage sample from either durable carrier. */
function usageSampleOf(event: SessionEvent): FixtureUsageSample | undefined {
  const item = event as unknown as {
    type: string
    data: {
      turn?: number
      step?: number
      usage?: TokenUsage
      chunk?: { type?: string; usage?: TokenUsage }
    }
  }
  const usage = item.type === 'assistant/chunk' && item.data.chunk?.type === 'usage'
    ? item.data.chunk.usage
    : item.type === 'assistant/message'
      ? item.data.usage
      : undefined
  return usage === undefined || item.data.turn === undefined || item.data.step === undefined
    ? undefined
    : { turn: item.data.turn, step: item.data.step, usage }
}

/** Fixture parallel of token-meter's last-sample-replacing usage projection. */
function tokenUsageOf(log: readonly SessionEvent[]): FixtureTokenUsageProjection {
  const totals: FixtureTokenUsageProjection = {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  let last: {
    turn: number
    step: number
    buckets: FixtureTokenUsageProjection
  } | null = null
  for (const event of log) {
    const sample = usageSampleOf(event)
    if (sample === undefined) continue
    const buckets: FixtureTokenUsageProjection = {
      uncachedInputTokens: sample.usage.inputTokens,
      outputTokens: sample.usage.outputTokens,
      cacheReadTokens: sample.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: sample.usage.cacheWriteTokens ?? 0,
    }
    const previous = last?.turn === sample.turn && last.step === sample.step
      ? last.buckets
      : undefined
    totals.uncachedInputTokens += buckets.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0)
    totals.outputTokens += buckets.outputTokens - (previous?.outputTokens ?? 0)
    totals.cacheReadTokens += buckets.cacheReadTokens - (previous?.cacheReadTokens ?? 0)
    totals.cacheWriteTokens += buckets.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0)
    last = { turn: sample.turn, step: sample.step, buckets }
  }
  return totals
}

/** Fixture parallel of session-stats' whole-log counting and wall-time fold. */
function sessionStatsOf(log: readonly SessionEvent[]): {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
} {
  const value = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
  let lastTurn: number | null = null
  let openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null = null
  const pendingCalls = new Map<string, number>()
  for (const event of log) {
    switch (event.type) {
      case 'step/start':
        openStep = { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null }
        break
      case 'assistant/chunk':
        if (openStep !== null && openStep.turn === event.data.turn && openStep.step === event.data.step
          && openStep.firstTokenTime === null && isTokenDelta(event.data.chunk)) {
          openStep.firstTokenTime = event.time
        }
        break
      case 'assistant/message': {
        if (openStep === null || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break
        value.llmMs += Math.max(0, event.time - openStep.startTime)
        if (openStep.firstTokenTime !== null) {
          value.ttftMs += Math.max(0, openStep.firstTokenTime - openStep.startTime)
          value.ttftSteps += 1
          const outputTokens = event.data.usage?.outputTokens
          if (typeof outputTokens === 'number' && Number.isFinite(outputTokens) && outputTokens >= 0) {
            value.decodeMs += Math.max(0, event.time - openStep.firstTokenTime)
            value.decodeTokens += outputTokens
          }
        }
        openStep = null
        break
      }
      case 'tool/call':
        pendingCalls.set(event.data.callId, event.time)
        break
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const dispatched = pendingCalls.get(callId)
        if (dispatched === undefined) break
        pendingCalls.delete(callId)
        value.toolMs += Math.max(0, event.time - dispatched)
        break
      }
      case 'step/end':
        if (event.data.turn !== lastTurn) {
          value.turns += 1
          lastTurn = event.data.turn
        }
        value.steps += 1
        openStep = null
        break
      case 'turn/end':
        pendingCalls.clear()
        break
      default:
        break
    }
  }
  return value
}

interface FixtureRequestContext {
  provider: string
  model: string
  contextWindow?: number
}

interface FixtureContextBreakdownProjection {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

/** Fixed token-meter heuristic constants mirrored by this client-only fixture. */
const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

/** Price fixture content with token-meter's fixed-density heuristic. */
function estimateFixtureContent(blocks: readonly ContentBlock[]): number {
  const densityPrice = (value: string): number => Math.ceil(value.length / CHARS_PER_TOKEN)
  return blocks.reduce((tokens, block) => {
    if (block.type === 'text' || block.type === 'reasoning') {
      return tokens + densityPrice(block.text) + BLOCK_OVERHEAD
    }
    if (block.type === 'tool-call') {
      return tokens + densityPrice(block.name) + densityPrice(block.arguments) + BLOCK_OVERHEAD
    }
    // ContentBlockMap is merge-extensible: this client graph sees only the
    // base four members, but fixture turns do carry extended blocks at
    // runtime, so the structural JSON fallback below is live code.
    if (block.type === 'tool-result') {
      return tokens + estimateFixtureContent(block.content) + BLOCK_OVERHEAD
    }
    return tokens + densityPrice(JSON.stringify(block)) + BLOCK_OVERHEAD
  }, 0)
}

/** Fixture parallel of token-meter's heuristic context-composition projection. */
function contextBreakdownOf(log: readonly SessionEvent[]): FixtureContextBreakdownProjection {
  const headerEvent = log.findLast(event => event.type === 'request/header')
  const header = headerEvent === undefined
    ? undefined
    : headerEvent.data.header
  let messageTokens = 0
  for (const seq of foldSurface(log).nodes) {
    const event = log[seq]
    if (event === undefined) continue
    const message = deriveEventMessage(event)
    if (message !== null) messageTokens += estimateFixtureContent(message.content) + ROLE_OVERHEAD
  }
  return {
    systemTokens: header?.system === undefined
      ? 0
      : Math.ceil(header.system.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD,
    toolsTokens: header?.tools === undefined || header.tools.length === 0
      ? 0
      : Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD,
    messageTokens,
  }
}

/** Latest log-only route context, or undefined before any request ran. */
function lastRequestContext(
  log: readonly SessionEvent[],
): FixtureRequestContext | undefined {
  const event = log.findLast(item => (item as { type: string }).type === 'request/context')
  return event === undefined
    ? undefined
    : (event as unknown as { data: FixtureRequestContext }).data
}

/**
 * Fixture parallel of token-meter's request-pressure projection: the last
 * provider-reported prompt size paired with the last recorded capacity. The
 * two need not come from one request — see the token-meter README. The host's
 * `projectedTokens` is deliberately absent: reproducing it would mean
 * reimplementing the estimator client-side, and every consumer falls back to
 * the bare sample, so a fixture-driven view simply lags a compaction the way
 * the projection did before that field existed.
 */
function contextPressureOf(
  log: readonly SessionEvent[],
): { pressureTokens?: number; contextWindow?: number } {
  let pressureTokens: number | undefined
  for (const event of log) {
    const sample = usageSampleOf(event)
    if (sample === undefined) continue
    pressureTokens = sample.usage.inputTokens
      + (sample.usage.cacheReadTokens ?? 0)
      + (sample.usage.cacheWriteTokens ?? 0)
  }
  const contextWindow = lastRequestContext(log)?.contextWindow
  return {
    ...pressureTokens === undefined ? {} : { pressureTokens },
    ...contextWindow === undefined ? {} : { contextWindow },
  }
}

function projectionValuesOf(log: readonly SessionEvent[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const titleEvent = log.findLast(item => (item as { type: string }).type === 'session/title')
  if (titleEvent !== undefined) {
    values['title'] = (titleEvent as unknown as { data: { title: string } }).data.title
  }
  // Always present (tool-todo unit composed): null when no plan stands.
  values['todos'] = backscanTodos(log) ?? null
  // Always present (permission service composed): the whole select.
  values['permissions'] = permissionSelectOf(log)
  // Always present (plan-mode unit composed): the {active, pending} view.
  values['plan'] = planViewOf(log)
  // Always present (GoalService unit composed): null before create / after clear.
  values['goal'] = backscanGoal(log)
  // Always present (token-meter composed): full-log provider billing.
  values['tokenUsage'] = tokenUsageOf(log)
  // Always present (token-meter composed): last request pressure and capacity.
  values['contextPressure'] = contextPressureOf(log)
  // Always present (token-meter composed): heuristic request composition.
  values['contextBreakdown'] = contextBreakdownOf(log)
  // Always present (session-stats unit composed): whole-log turn/step counts.
  values['sessionStats'] = sessionStatsOf(log)
  // Always present (attachment service composed): the deployment image
  // limits, constant per boot (mirrors the attachment-local defaults).
  // Deliberate host divergence: the real gateway never pushes an imageLimits
  // change frame (constant unit), but the fixture's uniform baseline replay
  // frames every key here, incidentally exercising higher-seq-wins.
  values['imageLimits'] = {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }
  return values
}

/** Host push-frame parallel: emit one session/projection frame per key the given event advanced. */
function projectionFramesOf(id: SessionId, log: readonly SessionEvent[], event: SessionEvent): Extract<MuxFrame, { type: 'session/projection' }>[] {
  const type = (event as { type: string }).type
  const frames: Extract<MuxFrame, { type: 'session/projection' }>[] = []
  // One usage sample advances both token-meter units.
  if (usageSampleOf(event) !== undefined) {
    frames.push(
      { type: 'session/projection', sessionId: id, key: 'tokenUsage', value: tokenUsageOf(log), seq: event.seq },
      { type: 'session/projection', sessionId: id, key: 'contextPressure', value: contextPressureOf(log), seq: event.seq },
    )
  }
  if (type === 'request/context') {
    frames.push({
      type: 'session/projection',
      sessionId: id,
      key: 'contextPressure',
      value: contextPressureOf(log),
      seq: event.seq,
    })
  }
  if (type === 'request/header'
    || type === 'user/message'
    || type === 'assistant/message'
    || type === 'tool/result') {
    frames.push({
      type: 'session/projection',
      sessionId: id,
      key: 'contextBreakdown',
      value: contextBreakdownOf(log),
      seq: event.seq,
    })
  }
  // The stats fold's view advances on message assembly and tool settlement
  // (wall times) and on step close (counts).
  if (type === 'assistant/message' || type === 'tool/result' || type === 'step/end') {
    frames.push({
      type: 'session/projection',
      sessionId: id,
      key: 'sessionStats',
      value: sessionStatsOf(log),
      seq: event.seq,
    })
  }
  if (frames.length > 0) return frames
  if (type === 'session/title') {
    const values = projectionValuesOf(log)
    /* v8 ignore next -- the advancing title event is in the log, so the key is present. */
    if (!Object.hasOwn(values, 'title')) return []
    return [{ type: 'session/projection', sessionId: id, key: 'title', value: values['title'], seq: event.seq }]
  }
  // The goal domain's own durable change advances its projection.
  if (type === 'goal/change') {
    return [{ type: 'session/projection', sessionId: id, key: 'goal', value: backscanGoal(log), seq: event.seq }]
  }
  // Standing-plan fold: writes replace the list; turn/start clears it (null).
  if (type === 'todo/write' || type === 'turn/start') {
    return [{
      type: 'session/projection',
      sessionId: id,
      key: 'todos',
      value: backscanTodos(log) ?? null,
      seq: event.seq,
    }]
  }
  // Knob fold: any of the three whole-value knob events advances the select.
  if (type === 'permission/preset' || type === 'sandbox/mode' || type === 'approval/policy') {
    return [{
      type: 'session/projection',
      sessionId: id,
      key: 'permissions',
      value: permissionSelectOf(log),
      seq: event.seq,
    }]
  }
  // The plan unit advances on its two folded event kinds when the command
  // lifecycle contains the input that represents a plan selection.
  const commandData = event as unknown as { data: { name?: string; args?: unknown } }
  if (type === 'plan/mode' || (type === 'command/run'
    && commandData.data.name === 'plan' && typeof commandData.data.args === 'string')) {
    return [{
      type: 'session/projection',
      sessionId: id,
      key: 'plan',
      value: planViewOf(log),
      seq: event.seq,
    }]
  }
  return []
}

/**
 * Message-boundary paging (mirrors the host's paging contract): count
 * maxMessages messages
 *  backwards from end, cut at a turn/start boundary.
 Entries carry pagination-time views
 *  (the host analogue computes viewFor per entry at page time). */
function pageOf(
  log: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { events: HistoryEntry[]; hasMore: boolean } {
  const end = beforeSeq === undefined ? log.length : Math.max(0, Math.min(beforeSeq, log.length))
  let start = 0
  let messages = 0
  for (let i = end - 1; i >= 0; i--) {
    const event = log[i]
    /* v8 ignore next -- dense-array guard: log seqs are array indexes, i stays within [0, end). */
    if (event === undefined) break
    if (event.type === 'user/message' || event.type === 'assistant/message') messages++
    if (event.type === 'turn/start' && messages >= maxMessages) {
      start = i
      break
    }
  }
  const events = log.slice(start, end).map((event): HistoryEntry => {
    const view = viewFor(event, log)
    return view === undefined ? { event } : { event, view }
  })
  return { events, hasMore: start > 0 }
}

/** Fixture mirror of host session-scoped attachment authorization. */
function logReferencesAttachment(log: readonly SessionEvent[], attachmentId: string): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit)
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    if (record.attachmentId === attachmentId) return true
    return Object.values(record).some(visit)
  }
  return log.some(event => visit(event.data))
}

/** Fixture mirror of first-party message extraction used by session-query. */
function searchBlockText(block: ContentBlock): string[] {
  switch (block.type) {
    case 'text':
      return [block.text]
    case 'reasoning':
      return []
    case 'tool-call':
      return [block.name, block.arguments]
    case 'tool-result':
      return block.content.flatMap(searchBlockText)
    default:
      return []
  }
}

/** One current-surface user/assistant document, if searchable. */
function searchEventText(event: SessionEvent): string {
  const content = event.type === 'user/message'
    ? event.data.content
    : event.type === 'assistant/message'
      ? event.data.message.content
      : undefined
  if (content === undefined) return ''
  return content.flatMap(searchBlockText).map(part => part.trim()).filter(Boolean).join('\n')
}

interface FixtureSearchToken {
  value: string
  /** Inclusive code-point offset in the whitespace-normalized display text. */
  start: number
  /** Exclusive code-point offset in the whitespace-normalized display text. */
  end: number
}

/**
 * Browser-safe approximation of SQLite FTS5 unicode61 token boundaries.
 * Keeping phrase matching token-based prevents the development fixture from
 * promising arbitrary within-token substring behavior that production lacks.
 */
function searchTokenSpans(value: string): { text: string; tokens: FixtureSearchToken[] } {
  const text = value.replace(/\s+/gu, ' ').trim()
  const characters = Array.from(text)
  const tokens: FixtureSearchToken[] = []
  let start: number | undefined
  let raw = ''
  const flush = (end: number): void => {
    if (start !== undefined) {
      const folded = raw.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
      if (folded !== '') tokens.push({ value: folded, start, end })
    }
    start = undefined
    raw = ''
  }
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index] as string
    const tokenBase = character.normalize('NFD').replace(/\p{M}+/gu, '')
    if (tokenBase === '') {
      if (start !== undefined) raw += character
      continue
    }
    if (/^[\p{L}\p{N}\p{Co}]+$/u.test(tokenBase)) {
      start ??= index
      raw += character
    } else {
      flush(index)
    }
  }
  flush(characters.length)
  return { text, tokens }
}

interface FixturePhraseMatch {
  count: number
  start: number
  end: number
}

/** Count exact contiguous token-phrase occurrences and retain the first display span. */
function phraseMatch(document: readonly FixtureSearchToken[], phrase: readonly string[]): FixturePhraseMatch {
  if (phrase.length === 0 || phrase.length > document.length) return { count: 0, start: 0, end: 0 }
  let count = 0
  let firstStart = 0
  let firstEnd = 0
  for (let start = 0; start <= document.length - phrase.length; start++) {
    if (!phrase.every((token, offset) => document[start + offset]?.value === token)) continue
    count++
    if (count === 1) {
      firstStart = document[start]?.start ?? 0
      firstEnd = document[start + phrase.length - 1]?.end ?? firstStart
    }
  }
  return { count, start: firstStart, end: firstEnd }
}

/** Match-centered fixture excerpt, bounded by Unicode code points for the sidebar. */
function searchSnippet(value: string, matchStart: number, matchEnd: number): string {
  const characters = Array.from(value)
  if (characters.length <= 120) return value
  const boundedStart = Math.min(Math.max(0, matchStart), characters.length - 1)
  const boundedEnd = Math.min(
    characters.length,
    Math.max(boundedStart + 1, matchEnd),
  )
  const center = Math.floor((boundedStart + boundedEnd) / 2)
  let start = Math.min(
    characters.length - 118,
    Math.max(0, center - Math.floor(118 / 2)),
  )
  let end = start + 118
  if (start === 0) {
    end = 119
  } else if (end === characters.length) {
    start = characters.length - 119
  }
  return `${start > 0 ? '…' : ''}${characters.slice(start, end).join('')}${end < characters.length ? '…' : ''}`
}

interface FixtureSearchCandidate {
  sessionId: SessionId
  seq: number
  time: number
  text: string
  matchCount: number
  matchStart: number
  matchEnd: number
  documentLength: number
}

/** Mirrors `packages/session-query/session-query-sqlite/src/index.ts`; update both together. */
function compareSearchCandidates(a: FixtureSearchCandidate, b: FixtureSearchCandidate): number {
  if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount
  if (a.documentLength !== b.documentLength) return a.documentLength - b.documentLength
  if (a.time !== b.time) return b.time - a.time
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1
  return b.seq - a.seq
}

/**
 * Current plan projection over the full log (host parallel: latest todo/write
 * with no later turn/start; a new turn retires the previous plan).
 */
function backscanTodos(log: readonly SessionEvent[]): TodoItem[] | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i]
    if (event === undefined) continue
    if (event.type === 'turn/start') return undefined
    if (event.type === 'todo/write') return event.data.todos
  }
  return undefined
}

/** Fixture-local mirror of the goal projection value (dsh-goal's GoalProjection shape). */
interface FxGoalProjection {
  goal: {
    id: string
    revision: number
    objective: string
    phase: 'active' | 'paused' | 'blocked' | 'complete'
    maxGoalRounds: number
  }
  roundsStarted: number
  createdAt: number
  updatedAt: number
}

/** One durable goal change. */
type FxGoalChange =
  | { kind: 'goal/change'; version: 1; operation: 'clear'; cleared: { id: string; revision: number }; clearedAt: number }
  | {
    kind: 'goal/change'
    version: 1
    operation: 'create' | 'edit' | 'pause' | 'resume' | 'complete'
    goal: FxGoalProjection['goal']
    roundsStarted: number
    createdAt: number
    updatedAt: number
  }

/**
 * Current goal projection over the full log (host parallel: the GoalService
 * unit's last-wins fold of goal/change whole values; clear returns null).
 */
function backscanGoal(log: readonly SessionEvent[]): FxGoalProjection | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i] as unknown as {
      type: string
      data?: FxGoalChange
    } | undefined
    if (event === undefined || event.type !== 'goal/change' || event.data === undefined) continue
    const change = event.data
    if (change.operation === 'clear') return null
    return { goal: change.goal, roundsStarted: change.roundsStarted, createdAt: change.createdAt, updatedAt: change.updatedAt }
  }
  return null
}

interface StreamConn<F> {
  push(envelope: RpcRequest<F>): void
}

interface ReasoningChunkStormState {
  sessionId: string
  chunkCount: number
  chunksPerInterval: number
  intervalMs: number
  emitted: number
  marker: string
  emitting: boolean
}

/** One seeded session carried by {@link FixtureSeedDescriptor}. */
export interface FixtureSeedSession {
  /** Session-summary overrides; absent fields take the fixture defaults. */
  summary?: {
    cwd?: string
    running?: boolean
    blank?: boolean
    parentSessionId?: string
  }
  /** The full event log (seq/time already assigned). */
  events: SessionEvent[]
}

/**
 * URL-seed descriptor: materialize arbitrary sessions into the fixture world
 * at boot. The client-first web e2e scaffold builds this from recorded
 * session.jsonl so seeded-history scenarios render without a real host.
 * Purely additive — absent by default, and the resident fx-* sessions and the
 * 164-test fixture behavior are untouched when it is not supplied.
 */
export interface FixtureSeedDescriptor {
  /** Session id → its summary overrides + event log. */
  sessions: Record<string, FixtureSeedSession>
  /** Optional workspace the seeded sessions land under (created when missing). */
  workspace?: { workspaceId: string; path: string; title: string }
}

/** Deterministic fixture branches used by keyless Web assembly tests. */
export interface FixtureOptions {
  /** Start with no real Workspace or Session. */
  empty?: boolean
  /** Reject every prompt before appending its user event. */
  rejectPrompt?: boolean
  /** Publish the Session but fail its Workspace account write. */
  failWorkspaceAttach?: boolean
  /** Publish and frame the Session, then throw instead of returning create. */
  dropSessionCreateResponse?: boolean
  /** Order of the two successful create frames. */
  createFrameOrder?: 'session-first' | 'workspace-first'
  /**
   * Real-LLM mode: `session.prompt` reaches a real chat-completions endpoint
   * (via `callRealLlm`) instead of the canned echo replay, and credentials
   * persist their actual values. Opt-in only — keyless lanes never set it.
   */
  realLlm?: boolean
  /** Override the completions base URL (real-LLM testing against a local mock). */
  llmUrl?: string
  /**
   * Materialize sessions into the fixture world at boot (the web e2e scaffold's
   * URL-seed path). Optional and additive; when absent the world boots the
   * resident fx-* sessions exactly as before.
   */
  seed?: FixtureSeedDescriptor
}

/** Inbox pump shared by both stream generators (FrameQueue pattern: ONE abort listener hung
 *  outside the loop — a per-iteration {once:true} listener never fires for non-final rounds and
 *  piles up for the stream's lifetime). breakNow force-ends the stream without the
 *  client's signal (timing hook: simulated connection loss). */
class FxInbox<F> implements StreamConn<F> {
  private readonly inbox: RpcRequest<F>[] = []
  private wake: (() => void) | null = null
  private broken = false

  push(envelope: RpcRequest<F>): void {
    this.inbox.push(envelope)
    this.wake?.()
  }

  breakNow(): void {
    this.broken = true
    this.wake?.()
  }

  /** Read through a method: breakNow()/abort flip state across yields, so narrowing from the loop condition must not stick. */
  private isLive(signal: AbortSignal): boolean {
    return !signal.aborted && !this.broken
  }

  async *drain(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
    const onAbort = (): void => this.wake?.()
    signal.addEventListener('abort', onAbort)
    try {
      while (this.isLive(signal)) {
        while (this.inbox.length > 0) yield this.inbox.shift() as RpcRequest<F>
        if (!this.isLive(signal)) break
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
        this.wake = null
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * In-memory fake host: fx-alpha carries history and replay scripts; fx-beta is fx-alpha's child session (lineage indent material).
 * @param options - fixture branches for empty state and failure timing.
 * @returns an ApiProxy backed entirely by in-memory state — no host process, no network.
 */
export function createFixtureApi(options: FixtureOptions = {}, ctx?: Context): ApiProxy {
  return createFixtureWorld(options, ctx).api
}

/** Both fixture faces over one state graph. */
export interface FixtureWorld {
  /** Legacy unary/stream API the fixture still answers. */
  readonly api: ApiProxy
  /** Generic Remote caller for the endpoints business services own. */
  readonly rpc: ClientConnectionRpc
}

/**
 * Build both fixture faces so a caller can drive the Remote endpoints and the
 * legacy API against one in-memory state graph.
 * @param options - fixture branches for empty state and failure timing.
 * @returns the legacy API face and the Remote RPC face.
 */
export function createFixtureFaces(options: FixtureOptions = {}, ctx?: Context): FixtureWorld {
  return createFixtureWorld(options, ctx)
}

/** Build the fixture's legacy API and Remote RPC faces over one state graph. */
function createFixtureWorld(options: FixtureOptions, ctx?: Context): FixtureWorld {
  // The resident fixture sessions all carry history, so none of them is blank.
  let sessions: SessionSummary[] = options.empty ? [] : [
    { sessionId: sid('fx-alpha'), updatedAt: Date.now(), running: true, blank: false, cwd: '/tmp/fixture' },
    { sessionId: sid('fx-beta'), updatedAt: Date.now() - 60_000, running: false, blank: false, parentSessionId: sid('fx-alpha'), cwd: '/tmp/fixture' },
    { sessionId: sid('fx-gamma'), updatedAt: Date.now() - 120_000, running: false, blank: false, cwd: '/tmp/fixture' },
  ]
  const logs = new Map<SessionId, SessionEvent[]>([[sid('fx-alpha'), buildAlphaLog()]])
  const modelSelections = new Map<SessionId, ModelSelection>(sessions.map(session => [
    session.sessionId,
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  ]))
  const attachments = new Map<string, { attachment: ImageAttachmentRef; data: string }>([[
    String(FIXTURE_IMAGE_REF.attachmentId),
    { attachment: FIXTURE_IMAGE_REF, data: FIXTURE_IMAGE_DATA },
  ]])
  /** Credential store double: set/unset flip the describe badge, values never read back. */
  const fixtureCredentials = new Map<string, true>([
    // The assembled fixture represents an already-configured shipped
    // DeepSeek route so unrelated GUI journeys do not enter first-run setup.
    ['DEEPSEEK_API_KEY', true],
  ])
  /**
   * Real credential values (realLlm mode): the credentials UI's `set` writes
   * the actual secret here and persists it in localStorage (durable in the
   * WebView2), and `session.prompt` reads the DeepSeek key back for the real
   * call. Keyless lanes never touch this — `options.realLlm` gates it.
   */
  const CREDENTIAL_STORAGE_KEY = 'dsh:fixture:credentials'
  const realCredentialValues = new Map<string, string>()
  if (options.realLlm) {
    try {
      const raw = localStorage.getItem(CREDENTIAL_STORAGE_KEY)
      if (raw !== null) {
        for (const [ref, value] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
          if (typeof value === 'string') realCredentialValues.set(ref, value)
        }
      }
    } catch {
      // Ignore malformed/blocked storage — real mode still works per-session.
    }
    // Share the DSH CLI's `~/.dsh/.credentials.yaml` so keys the CLI stores are
    // usable in the desktop without re-entering them.
    const invoke = tauriInvoke()
    if (invoke !== undefined) {
      void invoke<Record<string, string>>('dsh_read_credentials').then((file) => {
        if (file !== undefined) {
          for (const [ref, value] of Object.entries(file)) {
            if (typeof value === 'string') realCredentialValues.set(ref, value)
          }
        }
      }).catch(() => {})
    }
  }
  const persistRealCredentials = (): void => {
    if (!options.realLlm) return
    try {
      localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(Object.fromEntries(realCredentialValues)))
    } catch {
      // storage quota / privacy mode: keep the in-memory value for this session.
    }
  }
  /** Tauri keyring backend (real mode only); undefined outside the desktop shell. */
  const tauriCreds = options.realLlm ? tauriCredentialBackend() : undefined
  /** Read one real credential value: Rust keyring first (Tauri), then localStorage. */
  const readRealCredential = async (ref: string): Promise<string | null> => {
    if (tauriCreds !== undefined) {
      const value = await tauriCreds.get(ref)
      if (value !== null) return value
    }
    return realCredentialValues.get(ref) ?? null
  }
  /**
   * Welcome-notice acknowledgement double. Mirrors the host's `ui-onboarding`
   * settings namespace (ui-settings-models onboarding-copy.ts): describe
   * serves it (pre-acknowledged, same "already onboarded" posture as the
   * shipped credential above), mutate accepts a set on its ack field. A
   * pre-acknowledged fixture keeps the official welcome dialog from wedging
   * a standalone boot that has no host settings backend to persist to.
   */
  const WELCOME_NOTICE_NS = 'ui-onboarding'
  const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'
  const WELCOME_NOTICE_VERSION = '2026-08-13.1'
  let fixtureWelcomeAck: string = WELCOME_NOTICE_VERSION
  /**
   * The DeepSeek provider profile served under the `llm-deepseek` settings
   * namespace. Held as layered state (base value + user layer + revision) so
   * the official Models editor's describe→rehydrate→mutate round-trip works:
   * the editor rehydrates `schema` (must be a real schemastery envelope — an
   * empty `{}` throws "unsupported type undefined") and writes profile edits
   * back through `settings.mutate`.
   */
  const LLM_DEEPSEEK_NS = 'llm-deepseek'
  /**
   * The DeepSeek route lives at `providers.deepseek-official` under the user
   * layer (mirroring the real adapter's `Config = { providers: { … } }`), NOT
   * the base layer. Serving it as a user-layer profile makes it a removable
   * provider in the Models editor (the official store marks a provider
   * removable exactly when its profile is in `namespace.user` and absent from
   * `namespace.base`) — deleting it unsets the profile and credential, so a
   * user who adds another vendor can drop DeepSeek. On a fresh boot it is
   * pre-seeded so the shipped route is still there until removed.
   */
  let llmDeepseekUser: Record<string, unknown> = {
    providers: { 'deepseek-official': { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  }
  let llmDeepseekRevision = 0
  /** Custom provider profiles under `llm-pi-ai` (the Models editor's add card). */
  let llmPiAiUser: Record<string, unknown> = { providers: {} }
  let llmPiAiRevision = 0
  /** Outbound-proxy settings (`ui-settings-proxy` reads the `proxy` namespace). */
  const PROXY_SETTINGS_NS = 'proxy'
  let proxyUrl: string | undefined
  let proxyRevision = 0
  /**
   * Agent harness system prompt, configurable so the assistant's persona/name
   * can be renamed by the user (the default avoids inviting the model to
   * self-identify with a specific vendor).
   */
  const AGENT_SETTINGS_NS = 'agent'
  let agentSystemPrompt = '你是 DSH Agent，一个帮助用户的智能体助手。你会根据用户需求规划任务步骤、必要时调用可用工具，并基于工具结果给出专业回答。'
  let agentSettingsRevision = 0
  const AGENT_SETTINGS_SCHEMA = z.object({
    systemPrompt: z.string(),
  }).toJSON()

  /**
   * New-session permission default (`ui-permission-presets` reads
   * `defaultPreset`). The union choices carry the product labels so the
   * settings row renders 工作区写入 / 完全访问 / 只读.
   */
  const PERMISSION_NS = 'permission'
  let permissionDefault = 'workspace-write'
  const PERMISSION_SCHEMA = z.object({
    defaultPreset: z.union([
      z.const('workspace-write').description('工作区写入'),
      z.const('danger-full-access').description('完全访问'),
      z.const('read-only').description('只读'),
    ]),
  }).toJSON()

  /**
   * Persist one settings namespace to ~/.dsh/settings.yaml when running under
   * Tauri (the settings_update command writes the YAML the real DSH CLI
   * shares). Browser no-op.
   */
  const persistSettings = (ns: string, value: Record<string, unknown>): void => {
    const invoke = tauriInvoke()
    if (invoke !== undefined) {
      void invoke('settings_update', { key: ns, value })
    }
  }

  /** Generic (unregistered) settings namespaces the app wrote; persisted on save. */
  const genericSettings = new Map<string, Record<string, unknown>>()

  /**
   * Seed the known settings namespaces from ~/.dsh/settings.yaml (via the
   * Tauri settings_get command) so the app boots with the real config instead
   * of defaults. Runs once; browser builds skip it (no Tauri).
   */
  let settingsSeeded: Promise<void> | undefined
  const seedSettings = (): Promise<void> => {
    if (settingsSeeded !== undefined) return settingsSeeded
    settingsSeeded = (async () => {
      const invoke = tauriInvoke()
      if (invoke === undefined) return
      try {
        const read = async (key: string): Promise<Record<string, unknown> | null> => {
          const value = await invoke<Record<string, unknown> | null>('settings_get', { key })
          return value ?? null
        }
        const [llmDs, pi, proxyNs, perm, preset, agentNs, skillInv, mcpInv] = await Promise.all([
          read(LLM_DEEPSEEK_NS), read('llm-pi-ai'), read(PROXY_SETTINGS_NS), read(PERMISSION_NS), read(AGENT_PRESET_SETTINGS_NS), read(AGENT_SETTINGS_NS), read(SKILL_INVENTORY_NS), read(MCP_INVENTORY_NS),
        ])
        if (llmDs !== null) llmDeepseekUser = { ...llmDeepseekUser, ...llmDs }
        if (pi?.providers) llmPiAiUser = { ...llmPiAiUser, ...pi }
        const pUrl = proxyNs?.url
        if (typeof pUrl === 'string') proxyUrl = pUrl
        const pDef = perm?.defaultPreset
        if (typeof pDef === 'string' && pDef in PERMISSION_PRESETS) permissionDefault = pDef
        const pPreset = preset?.default
        if (typeof pPreset === 'string' && pPreset.length > 0) fixtureDefaultPreset = pPreset
        const aPrompt = agentNs?.systemPrompt
        if (typeof aPrompt === 'string' && aPrompt.length > 0) agentSystemPrompt = aPrompt
        // Skill inventory persistence (`skill-inventory` namespace, shape
        // `{ enabled: { [id]: boolean } }`). Apply the persisted map so the
        // toggles survive a restart; entries absent from the map stay enabled.
        const sInvEnabled = (skillInv as { enabled?: unknown } | null)?.enabled
        if (typeof sInvEnabled === 'object' && sInvEnabled !== null) {
          for (const [id, enabled] of Object.entries(sInvEnabled as Record<string, unknown>)) {
            if (typeof enabled === 'boolean') skillEnabled.set(id, enabled)
          }
        }
        // MCP inventory persistence (`mcp-inventory` namespace, shape
        // `{ servers: { [id]: McpServerSpec }, enabled: { [id]: boolean } }`).
        // The persisted servers are the source of truth for `mcpInventory/list`
        // under Tauri; the enabled map overlays the toggles.
        const mInv = mcpInv as { servers?: unknown; enabled?: unknown } | null
        const mInvServers = mInv?.servers
        if (typeof mInvServers === 'object' && mInvServers !== null) {
          for (const [id, spec] of Object.entries(mInvServers as Record<string, unknown>)) {
            if (isFixtureMcpSpec(spec)) mcpServers.set(id, spec)
          }
        }
        const mInvEnabled = mInv?.enabled
        if (typeof mInvEnabled === 'object' && mInvEnabled !== null) {
          for (const [id, enabled] of Object.entries(mInvEnabled as Record<string, unknown>)) {
            if (typeof enabled === 'boolean') mcpEnabled.set(id, enabled)
          }
        }
      } catch {
        // ~/.dsh unreadable or not under Tauri: keep the in-memory defaults.
      }
    })()
    return settingsSeeded
  }
  /** The default agent-preset setting (`ui-agent-preset` writes it via settings.update). */
  const AGENT_PRESET_SETTINGS_NS = 'agent-presets'
  /**
   * Settings namespaces the Plugins section's configurable cards read
   * (ui-settings-plugins binds each card's scope to its namespace): shell
   * (BashCard), agent-loop (AgentLoopCard), web-search-deepseek
   * (WebSearchCard). Served so the cards render their fields instead of an
   * unavailable state.
   */
  const SHELL_SETTINGS_NS = 'shell'
  const AGENT_LOOP_SETTINGS_NS = 'agent-loop'
  const WEB_SEARCH_SETTINGS_NS = 'web-search-deepseek'
  // Schemas must be real schemastery envelopes (z.object().toJSON()) — a
  // hand-written {type:'object',dict:{}} cannot be rehydrated by the settings
  // scope's new Schema(json), which marks the namespace unavailable and hides
  // the card.
  const SHELL_SETTINGS_SCHEMA = z.object({ timeoutMs: z.number().step(1).min(0), maxOutputBytes: z.number().step(1).min(0) }).toJSON()
  const AGENT_LOOP_SETTINGS_SCHEMA = z.object({ maxParallelToolCalls: z.number().step(1).min(1) }).toJSON()
  const WEB_SEARCH_SETTINGS_SCHEMA = z.object({ apiKeyEnv: z.string(), baseURL: z.string(), maxUses: z.number().step(1).min(1) }).toJSON()
  const shellSettings: Record<string, unknown> = { timeoutMs: 30_000, maxOutputBytes: 1_048_576 }
  const agentLoopSettings: Record<string, unknown> = { maxParallelToolCalls: 4 }
  const webSearchSettings: Record<string, unknown> = { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: '', maxUses: 4 }
  /**
   * Serialized schemastery envelope for the `llm-deepseek` namespace, built
   * through the real schema library and `.toJSON()`ed — exactly what the host's
   * settings service serves — so the official Models editor's
   * `new Schema(json)` rehydrates a node tree with working `.meta.default`
   * (the DeepSeek profile's `models` default feeds `inheritedModels`).
   */
  const LLM_DEEPSEEK_SCHEMA = z.object({
    providers: z.dict(z.object({
      apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
      baseURL: z.string(),
      models: z.array(z.object({
        id: z.string().required(),
        name: z.string(),
        contextWindow: z.number().min(1),
      })).default([
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000 },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 },
      ]),
    })).default({}),
  }).toJSON()
  /**
   * The `llm-pi-ai` namespace schema: the Models editor reads the custom-provider
   * protocol union out of `providers.<route>.api` (protocolChoices) to enable
   * the 添加自定义提供方 flow. Mirror the adapter's Config shape so the choices
   * match what a declared route may name.
   */
  const LLM_PI_AI_SCHEMA = z.object({
    providers: z.dict(z.object({
      api: z.union(['openai-completions', 'openai-responses', 'anthropic-messages']),
    })).default({}),
  }).toJSON()
  /** Set a value at a path (creating intermediate objects), mutating `target`. */
  const setPath = (target: Record<string, unknown>, path: readonly string[], value: unknown): void => {
    let node: Record<string, unknown> = target
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i] as string
      const existing = node[key]
      if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
        node[key] = {}
      }
      node = node[key] as Record<string, unknown>
    }
    node[path[path.length - 1] as string] = value
  }
  /** Remove a value at a path (Reflect avoids the dynamic-delete lint). */
  const deletePath = (target: Record<string, unknown>, path: readonly string[]): void => {
    if (path.length === 0) return
    const parentPath = path.slice(0, -1)
    const key = path[path.length - 1] as string
    let node: Record<string, unknown> = target
    for (const segment of parentPath) {
      const next = node[segment]
      if (typeof next !== 'object' || next === null || Array.isArray(next)) return
      node = next as Record<string, unknown>
    }
    Reflect.deleteProperty(node, key)
  }
  /**
   * Preset compositions the fixture serves. Held as state rather than
   * constants so the settings editor's save and delete are exercisable: the
   * roster a GUI journey sees after writing is the text it wrote.
   */
  const STANDARD_PRESET_CONTENT = [
    "- id: persona\n  name: '@deepseek-ai/dsh-persona'",
    "- id: agent-instructions\n  name: '@deepseek-ai/dsh-agent-instructions'",
    "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'",
    "- id: tool-pwsh\n  name: '@deepseek-ai/dsh-tool-pwsh'",
    "- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'",
    "- id: tool-fs-search\n  name: '@deepseek-ai/dsh-tool-fs-search'",
    "- id: tool-jobs\n  name: '@deepseek-ai/dsh-tool-jobs'",
    "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'",
    "- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'",
    "- id: tool-goal\n  name: '@deepseek-ai/dsh-tool-goal'",
    "- id: tool-ask-user\n  name: '@deepseek-ai/dsh-tool-ask-user'",
    "- id: tool-todo\n  name: '@deepseek-ai/dsh-tool-todo'",
    "- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'",
  ].join('\n') + '\n'
  /**
   * The shipped preset roster, mirroring the deployment's four defaults
   * (display copy lives in ui-agent-preset's BUILT_IN_PRESET_KEYS): standard,
   * code (PTC 模式: standard + Code Mode presentation), minimal, cordis
   * (创造模式: standard + preset-authoring tool). `my-agent` demonstrates a
   * locally authored user preset.
   */
  const fixturePresets = new Map<string, { trust: 'system' | 'user'; content: string }>([
    ['standard', { trust: 'system', content: STANDARD_PRESET_CONTENT }],
    ['code', {
      trust: 'system',
      content: STANDARD_PRESET_CONTENT
        + "- id: tool-presentation\n  name: '@deepseek-ai/dsh-tool-presentation'\n"
        + "- id: tool-code-runtime\n  name: '@deepseek-ai/dsh-code-runtime-worker-thread'\n",
    }],
    ['minimal', { trust: 'system', content: [
      "- id: persona\n  name: '@deepseek-ai/dsh-persona'",
      "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'",
      "- id: tool-str-replace-editor\n  name: '@deepseek-ai/dsh-tool-str-replace-editor'",
    ].join('\n') + '\n' }],
    ['cordis', {
      trust: 'system',
      content: STANDARD_PRESET_CONTENT
        + "- id: tool-cordis\n  name: '@deepseek-ai/dsh-tool-cordis'\n"
        + "- id: agent-presets\n  name: '@deepseek-ai/dsh-agent-presets'\n",
    }],
    ['my-agent', { trust: 'user', content: "- id: tool-read\n  name: '@deepseek-ai/dsh-tool-read'\n" }],
  ])
  let fixtureDefaultPreset = 'standard'
  /**
   * Plugin inventory served to the ui-settings-plugin-inventory tab. Built-in
   * entries are the official client plugins; external entries are market /
   * user-installed plugins (dsh-market), enabled state kept in the map so
   * toggling persists for the session.
   */
  const BUILTIN_PLUGINS: ReadonlyArray<readonly [string, string]> = [
    ['@deepseek-ai/dsh-client-ui-sidebar', 'Sidebar'],
    ['@deepseek-ai/dsh-client-ui-layout', 'Layout'],
    ['@deepseek-ai/dsh-client-ui-conversation', 'Conversation'],
    ['@deepseek-ai/dsh-client-ui-settings', 'Settings'],
    ['@deepseek-ai/dsh-client-ui-settings-general', 'General Settings'],
    ['@deepseek-ai/dsh-client-ui-settings-models', 'Model Settings'],
    ['@deepseek-ai/dsh-client-ui-settings-plugins', 'Plugin Settings'],
    ['@deepseek-ai/dsh-client-ui-workspace', 'Workspace'],
    ['@deepseek-ai/dsh-client-ui-tool', 'Tool Views'],
    ['@deepseek-ai/dsh-client-ui-agent-preset', 'Agent Presets'],
    ['@deepseek-ai/dsh-client-ui-theme', 'Theme'],
    ['@deepseek-ai/dsh-client-ui-input-trigger', 'Input Triggers'],
    ['@deepseek-ai/dsh-client-ui-commands', 'Commands'],
    ['@deepseek-ai/dsh-client-ui-goal', 'Goal'],
    ['@deepseek-ai/dsh-client-runtime', 'Client Runtime'],
    ['@deepseek-ai/dsh-client-locale', 'Locale'],
  ]
  const EXTERNAL_PLUGINS: ReadonlyArray<readonly [string, string]> = []
  const pluginEnabled = new Map<string, boolean>()
  const fixturePluginEntries = (): Array<{
    entryId: string
    moduleName: string
    enabled: boolean
    disabledReason: 'user' | 'cordis' | null
    fiberPhase: string
    scope: 'builtin' | 'external'
  }> => [
    ...BUILTIN_PLUGINS.map(([entryId, name]) => ({
      entryId,
      moduleName: name,
      enabled: pluginEnabled.get(entryId) ?? true,
      disabledReason: null,
      fiberPhase: 'active',
      scope: 'builtin' as 'builtin' | 'external',
    })),
    ...EXTERNAL_PLUGINS.map(([entryId, name]) => ({
      entryId,
      moduleName: name,
      enabled: pluginEnabled.get(entryId) ?? true,
      disabledReason: null,
      fiberPhase: 'active',
      scope: 'external' as 'builtin' | 'external',
    })),
  ]
  /**
   * The real plugin inventory: every entry the client Loader actually mounted.
   * When the fixture runs inside the client graph (it does — `?fixture` boots
   * the connection plugin in-browser), the client `ctx.loader` IS the plugin
   * graph the official UI is made of, so the list shows the genuine built-in
   * plugins with their live fiber phase instead of the stale stub table above.
   * Shell and modules entries are not user-facing plugins and stay hidden.
   */
  /**
   * Service-injection ground truth: which loader entry provides each live
   * service, read from the cordis reflect registry (`ctx.reflect.store`).
   * A service that a DIFFERENT entry's fiber injects makes its provider
   * "needed" — disabling the provider would strand the dependent fiber and
   * cascade (the single-process shell has no host to re-serve it).
   */
  const neededEntryNames = (): ReadonlySet<string> => {
    const loader = ctx === undefined
      ? undefined
      : (ctx as { loader?: FixtureLoaderLike }).loader
    if (loader === undefined) return new Set()
    const entries = [...loader.entries()]
    const nameOf = (e: FixtureLoaderEntryLike | undefined): string | undefined => e?.options.name
    // service name → providing entry name
    const providerByService = new Map<string, string>()
    type ReflectStore = Record<PropertyKey, { name?: string; fiber?: { entry?: FixtureLoaderEntryLike } }>
    const reflect = (ctx as { reflect?: { store?: ReflectStore } }).reflect
    if (reflect?.store !== undefined) {
      // The store is keyed by a per-service symbol (`Symbol(serviceName)`), so
      // `Object.values` is blind to it — enumerate own keys and index each.
      const store = reflect.store
      for (const key of Reflect.ownKeys(store)) {
        const impl = store[key]
        const provider = nameOf(impl?.fiber?.entry)
        if (impl?.name !== undefined && provider !== undefined) {
          providerByService.set(impl.name, provider)
        }
      }
    }
    const needed = new Set<string>()
    for (const dependent of entries) {
      const dependentName = nameOf(dependent)
      if (dependentName === undefined) continue
      // Services this fiber injects (requires).
      const injectMap = (dependent.fiber as { inject?: Record<string, unknown> } | undefined)?.inject
      if (injectMap === undefined) continue
      for (const service of Object.keys(injectMap)) {
        const provider = providerByService.get(service)
        if (provider !== undefined && provider !== dependentName) {
          needed.add(provider)
        }
      }
    }
    // The shell owns the layout/settings/RPC chain structurally; those rows
    // stay locked even if no explicit service edge is visible.
    for (const name of SHELL_CRITICAL) needed.add(name)
    return needed
  }

  const realInventoryEntries = (): Array<{
    entryId: string
    moduleName: string
    enabled: boolean
    disabledReason: 'user' | 'cordis' | null
    fiberPhase: string
    scope: 'builtin' | 'external'
  }> | null => {
    const loader = ctx === undefined
      ? undefined
      : (ctx as { loader?: FixtureLoaderLike }).loader
    if (loader === undefined) return null
    const needed = neededEntryNames()
    const entries: Array<{
      entryId: string
      moduleName: string
      enabled: boolean
      disabledReason: 'user' | 'cordis' | null
      fiberPhase: string
      scope: 'builtin' | 'external'
    }> = []
    const seen = new Set<string>()
    for (const entry of loader.entries()) {
      const name = entry.options.name
      if (name === undefined || name === '') continue
      if (name.startsWith('@deepseek-ai/dsh-client-modules')) continue
      if (name.startsWith('@deepseek-ai/dsh-client-app-shell')) continue
      if (seen.has(name)) continue
      seen.add(name)
      // "needed" rows are locked ON — disabling would strand a dependent fiber
      // (or the settings shell itself). Only true leaves stay toggleable.
      const locked = needed.has(name)
      entries.push({
        entryId: name,
        moduleName: name,
        enabled: !entry.disabled,
        disabledReason: locked ? 'cordis' : (entry.disabled ? 'user' : null),
        fiberPhase: entry.fiber === undefined
          ? 'inactive'
          : FIBER_PHASE_LABEL[entry.fiber.state] ?? 'unknown',
        scope: name.startsWith('@deepseek-ai/') ? 'builtin' : 'external',
      })
    }
    // Loader iteration order is boot creation order; keep it stable.
    return entries
  }
  const nextTurn = new Map<SessionId, number>([[sid('fx-alpha'), 75]])
  let nextSession = 1
  let nextRpc = 1
  let attachedSessions = options.empty ? 0 : 1
  // Workspace entities mirroring the host registry: the fixture sessions all
  // live under one workspace, whose account carries them in attach order.
  const wid = (raw: string): WorkspaceId => raw as WorkspaceId
  const fixtureEpoch = new Date(Date.now() - 300_000).toISOString()
  let workspaces: WorkspaceView[] = options.empty ? [] : [{
    workspaceId: wid('fx-ws-fixture'),
    path: '/tmp/fixture',
    title: 'fixture',
    sessionIds: [sid('fx-alpha'), sid('fx-beta'), sid('fx-gamma')],
    createdAt: fixtureEpoch,
    updatedAt: fixtureEpoch,
  }]
  let nextWorkspace = 1
  // Under Tauri the fixture starts empty (no demo data); replace that with the
  // user's REAL workspaces + sessions from ~/.dsh/storages/workspace.json so
  // the sidebar shows their actual state after reinstall.
  let workspacesLoaded: Promise<void> | undefined
  const loadRealWorkspaces = (): Promise<void> => {
    if (workspacesLoaded !== undefined) return workspacesLoaded
    const invoke = tauriInvoke()
    if (invoke === undefined) {
      workspacesLoaded = Promise.resolve()
      return workspacesLoaded
    }
    workspacesLoaded = invoke<Array<{ workspaceId: string; path: string; title: string; sessionIds: string[] }>>('dsh_read_workspaces')
      .then((rows) => {
        if (rows === undefined || rows.length === 0) return
        const epoch = new Date(Date.now() - 300_000).toISOString()
        workspaces = rows.map(row => ({
          workspaceId: wid(row.workspaceId),
          path: row.path,
          title: row.title,
          sessionIds: row.sessionIds.map(sid),
          createdAt: epoch,
          updatedAt: epoch,
        }))
        sessions = rows.flatMap(row => row.sessionIds.map(sessionId => ({
          sessionId: sid(sessionId),
          updatedAt: Date.now() - 60_000,
          running: false,
          blank: true,
          cwd: row.path,
        })))
      })
      .catch(() => {})
    return workspacesLoaded
  }
  void loadRealWorkspaces()
  // Registry-global archive set mirroring the host: archived sessions keep
  // their workspace accounting slot and only grouping surfaces hide them.
  const archivedSessionIds: SessionId[] = []

  // In-memory browse tree behind the fixture's `browse` picker capability —
  // deterministic content mirroring the design mock so assembled Web tests
  // and snapshots can walk it. Leaves are materialized lazily: a child listed
  // by its parent lists as empty until something is created inside it.
  const FIXTURE_HOME = '/home/fixture'
  const directoryTree = new Map<string, string[]>([
    ['/', ['home']],
    ['/home', ['fixture']],
    [FIXTURE_HOME, ['Documents', 'Downloads', '.config']],
    [`${FIXTURE_HOME}/Documents`, [
      'project', 'deepseek-iOS', 'deepseek-android', 'deepseek-platform',
      'deepseek-web', 'deepseek-harness', 'deepseek-app', 'deepseek-landing-blog',
    ]],
  ])
  const childrenOf = (path: string): string[] | undefined => {
    const known = directoryTree.get(path)
    if (known !== undefined) return known
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    const name = path.slice(path.lastIndexOf('/') + 1)
    return directoryTree.get(parent)?.includes(name) === true ? [] : undefined
  }
  const crumbsOf = (path: string): { name: string; path: string; hidden: boolean }[] => {
    const crumbs = [{ name: '/', path: '/', hidden: false }]
    let acc = ''
    for (const segment of path.split('/').filter(Boolean)) {
      acc += `/${segment}`
      crumbs.push({ name: segment, path: acc, hidden: false })
    }
    return crumbs
  }
  const mint = (): ReturnType<typeof RpcId> => RpcId(`fx-rpc-${nextRpc++}`)
  /** Resident pending approval (stable rpcId: every mux open replays the same id while unanswered, matching host replay semantics). */
  const pendingApprovalRpcId = mint()
  const pendingApprovalId = 'fx-approval-1' as Extract<MuxFrame, { type: 'approval/requested' }>['approvalId']
  /** Cleared once answered through respond; replay stops and approval/resolved is broadcast. */
  let approvalPending = true
  const pendingQuestionRpcId = mint()
  let questionPending = true
  const fixtureQuestions: Extract<MuxFrame, { type: 'question/requested' }>['questions'] = [
    {
      id: 'harness-profile',
      header: '偏好',
      question: '你现在更想招哪类 Agent/Harness 候选人？',
      options: [
        { label: '工程落地型 (Recommended)', description: '更看重能直接做 runtime、tool executor、sandbox、trace 和线上问题排查。' },
        { label: '研究潜力型', description: '更看重 Agent 理解、训练评测思路和长期成长空间。' },
        { label: '均衡型', description: '同时要求工程能力和 Agent 认知，但可能筛选门槛更高。' },
      ],
    },
    {
      id: 'work-mode',
      header: '方式',
      question: '你希望候选人优先展示哪种工作方式？',
      options: [
        { label: '先做小型原型 (Recommended)', description: '用可运行结果尽快验证关键假设。' },
        { label: '先写完整设计', description: '先收敛边界、协议和风险，再开始实现。' },
      ],
    },
    {
      id: 'signals',
      header: '信号',
      question: '哪些面试信号最重要？',
      detail: '按当前招聘目标选择；跳过则视为不设偏好。',
      multiSelect: true,
      options: [
        { label: '系统设计' },
        { label: '代码质量' },
        { label: 'Agent 产品判断' },
      ],
    },
  ]

  const muxConns = new Set<StreamConn<MuxFrame>>()
  const hostConns = new Set<StreamConn<HostFrame>>()
  const emitMux = (frame: MuxFrame): void => {
    for (const conn of muxConns) conn.push({ rpcId: mint(), payload: frame })
  }
  const emitHost = (frame: HostFrame): void => {
    for (const conn of hostConns) conn.push({ rpcId: mint(), payload: frame })
  }

  /** OK response echoing the caller's rpcId (contract: responses always backfill, never mint). */
  function ok<P, T>(request: RpcRequest<P>, value: T): Promise<RpcResponse<T>> {
    return Promise.resolve({ rpcId: request.rpcId, result: { ok: true, value } })
  }
  function err<P, T>(request: RpcRequest<P>, error: Extract<RpcResult<T>, { ok: false }>['error']): Promise<RpcResponse<T>> {
    return Promise.resolve({ rpcId: request.rpcId, result: { ok: false, error } })
  }

  const summaryOf = (id: SessionId): SessionSummary | undefined => sessions.find(s => s.sessionId === id)
  // URL-seed materialization (client-first e2e scaffold): when `options.seed`
  // is present, push its sessions into the in-memory state graph before any
  // RPC is served. Additive — absent by default, so the resident fx-* world
  // and the 164-test fixture behavior are unchanged.
  if (options.seed !== undefined) {
    const seed = options.seed
    const seedWs = seed.workspace
    let seedWorkspace = seedWs === undefined
      ? undefined
      : workspaces.find(w => w.workspaceId === wid(seedWs.workspaceId))
    if (seed.workspace !== undefined && seedWorkspace === undefined) {
      seedWorkspace = {
        workspaceId: wid(seed.workspace.workspaceId),
        path: seed.workspace.path,
        title: seed.workspace.title,
        sessionIds: [],
        createdAt: fixtureEpoch,
        updatedAt: fixtureEpoch,
      }
      workspaces.push(seedWorkspace)
    }
    for (const [rawId, spec] of Object.entries(seed.sessions)) {
      const sessionId = sid(rawId)
      const existing = sessions.find(s => s.sessionId === sessionId)
      const summary: SessionSummary = {
        sessionId,
        updatedAt: Date.now(),
        running: spec.summary?.running ?? false,
        blank: spec.summary?.blank ?? true,
        cwd: spec.summary?.cwd ?? '/tmp/fixture',
        ...spec.summary?.parentSessionId === undefined
          ? {}
          : { parentSessionId: sid(spec.summary.parentSessionId) },
      }
      if (existing === undefined) sessions.push(summary)
      else Object.assign(existing, summary)
      logs.set(sessionId, spec.events)
      modelSelections.set(sessionId, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
      if (seedWorkspace !== undefined && !seedWorkspace.sessionIds.includes(sessionId)) {
        seedWorkspace.sessionIds = [sessionId, ...seedWorkspace.sessionIds]
      }
    }
  }
  /** Shared session guard for sessionId-addressed catalog routes: the error
   *  response when the session is unknown, undefined when it exists. */
  const requireSession = (request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<never>> | undefined => {
    if (summaryOf(request.payload.sessionId) !== undefined) return undefined
    return err<{ sessionId: SessionId }, never>(request, {
      code: 'session-not-found',
      message: `no session ${request.payload.sessionId}`,
      details: { sessionId: request.payload.sessionId },
    })
  }
  const setRunning = (id: SessionId, running: boolean): void => {
    const summary = summaryOf(id)
    if (summary === undefined || summary.running === running) return
    summary.running = running
    emitHost({ type: 'host/session-status', sessionId: id, running })
  }
  const logOf = (id: SessionId): SessionEvent[] => {
    let log = logs.get(id)
    if (log === undefined) {
      log = []
      logs.set(id, log)
    }
    return log
  }
  const append = (id: SessionId, e: Record<string, unknown>): void => {
    const log = logOf(id)
    const event = { seq: log.length, time: Date.now(), ...e } as unknown as SessionEvent
    log.push(event)
    // Emission-time view derivation (mirrors the host's live path).
    const view = viewFor(event, log)
    /* v8 ignore next 3 -- the view-present arm needs a live tool/call emission,
    but the fixture replay produces text-only turns; view vocabulary is
    exercised through the history samples (turns 60-62). */
    emitMux(view === undefined
      ? { type: 'session/event', sessionId: id, event }
      : { type: 'session/event', sessionId: id, event, view })
    // Host eager-drive parallel: a unit-advancing event pushes its finished value.
    for (const frame of projectionFramesOf(id, log, event)) emitMux(frame)
  }

  /** Append one durable goal/change (host GoalService parallel). */
  const appendGoalChange = (id: SessionId, change: FxGoalChange): FxGoalProjection => {
    const log = logOf(id)
    append(id, {
      type: 'goal/change',
      data: change,
    })
    return backscanGoal(log) as FxGoalProjection
  }

  type FxGoalRef = { id: string; revision: number }
  type FxGoalView = FxGoalProjection['goal'] & {
    roundsStarted: number
    createdAt: number
    updatedAt: number
    activation: 'armed' | 'disarmed'
  }

  const goalFailure = <T>(message: string): RpcResult<T> => ({
    ok: false,
    error: { code: 'internal', message, details: {} },
  })

  const requireGoalSession = (id: SessionId): RpcResult<never> | undefined => (
    summaryOf(id) === undefined
      ? { ok: false, error: { code: 'session-not-found', message: `no session ${id}`, details: { sessionId: id } } }
      : undefined
  )

  /** Canonical fixture implementation of the generated Commands Remote contract. */
  const commandRemotes = {
    list(id: SessionId): RpcResult<readonly CommandDescriptor[]> {
      const missing = requireGoalSession(id)
      if (missing !== undefined) return missing
      return {
        ok: true,
        value: [
          { name: 'compact', description: 'fixture：压缩当前会话上下文' },
          { name: 'echo', description: 'fixture：回显参数', input: { hint: 'text to echo' } },
          { name: 'goal', description: 'set or view the goal for a long-running task', input: { hint: '<objective>' } },
          { name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)', input: { hint: '<preset>' } },
          { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
        ],
      }
    },
    execute(id: SessionId, line: string): RpcResult<CommandExecution | undefined> {
      const missing = requireGoalSession(id)
      if (missing !== undefined) return missing
      // Structured split mirroring the Host parser: name + verbatim rawInput
      // (separator whitespace included) — the run payload carries no line.
      const match = /^\/(\S+)((?:\s.*)?)$/.exec(line.trim())
      const name = match?.[1]
      const args = match?.[2] ?? ''
      if (name === 'permission') {
        const preset = args.trim()
        const commandId = `fx-cmd-${logOf(id).length}` as CommandId
        append(id, { type: 'command/run', data: { commandId, name, args, source: { kind: 'user' } } })
        const spec = PERMISSION_PRESETS[preset]
        let result: CommandResult
        if (preset === '') {
          const current = permissionSelectOf(logOf(id)).currentValue
          result = { kind: 'success', text: `current preset ${current} (available: ${Object.keys(PERMISSION_PRESETS).join(', ')})` }
        } else if (spec === undefined) {
          result = { kind: 'error', text: `unknown preset "${preset}" (available: ${Object.keys(PERMISSION_PRESETS).join(', ')})` }
        } else {
          if (permissionSelectOf(logOf(id)).currentValue !== preset) append(id, { type: 'permission/preset', data: { preset } })
          append(id, { type: 'sandbox/mode', data: { mode: spec.sandbox } })
          append(id, { type: 'approval/policy', data: { policy: spec.approval } })
          result = { kind: 'success', text: `preset ${preset}` }
        }
        append(id, { type: 'command/done', data: { commandId, ...result } })
        return { ok: true, value: { commandId, result } }
      }
      if (name === 'goal') {
        const commandId = `fx-cmd-${logOf(id).length}` as CommandId
        append(id, { type: 'command/run', data: { commandId, name, args, source: { kind: 'user' } } })
        const objective = args.trim()
        const current = backscanGoal(logOf(id))
        let text: string
        if (objective === '') {
          text = current === null ? 'No goal is set. Usage: /goal <objective>' : `Current goal: ${current.goal.objective}`
        } else if (current !== null && current.goal.phase !== 'complete') {
          text = `A goal already exists (${current.goal.objective}). Clear it first.`
        } else {
          const created = appendGoalChange(id, {
            kind: 'goal/change', version: 1, operation: 'create',
            goal: { id: `fx-goal-${logOf(id).length}`, revision: 1, objective, phase: 'active', maxGoalRounds: 256 },
            roundsStarted: 0, createdAt: Date.now(), updatedAt: Date.now(),
          })
          text = `Goal created: ${created.goal.objective}`
        }
        const result: CommandResult = { kind: 'success', text }
        append(id, { type: 'command/done', data: { commandId, ...result } })
        return { ok: true, value: { commandId, result } }
      }
      const running = summaryOf(id)?.running === true
      const outcomes: Record<string, string> = {
        compact: 'fixture：已压缩（假动作）',
        echo: args.trim(),
        plan: args.trim() === 'off'
          ? (running ? 'Leaving plan mode (applies from the next step).' : 'Plan mode off.')
          : (running
            ? 'Entering plan mode (applies from the next step). Use /plan off to leave.'
            : 'Plan mode on. Use /plan off to leave.'),
      }
      const text = name === undefined ? undefined : outcomes[name]
      if (name === undefined || text === undefined) return { ok: true, value: undefined }
      const commandId = `fx-cmd-${logOf(id).length}` as CommandId
      append(id, { type: 'command/run', data: { commandId, name, args, source: { kind: 'user' } } })
      if (name === 'plan' && !running) {
        const plan = foldPlan(logOf(id))
        if (plan.wanted !== null && plan.wanted !== plan.active) {
          append(id, { type: 'plan/mode', data: { active: plan.wanted } })
        }
      }
      const result: CommandResult = { kind: 'success', ...text === '' ? {} : { text } }
      append(id, { type: 'command/done', data: { commandId, ...result } })
      return { ok: true, value: { commandId, result } }
    },
  }

  const goalView = (projection: FxGoalProjection): FxGoalView => ({
    ...projection.goal,
    roundsStarted: projection.roundsStarted,
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
    activation: projection.goal.phase === 'active' ? 'armed' : 'disarmed',
  })

  /** Canonical fixture implementation of the generated Goal Remote contract. */
  const goalRemotes = {
    create(id: SessionId, request: { objective: string; maxGoalRounds?: number }): RpcResult<{ ref: FxGoalRef }> {
      const missing = requireGoalSession(id)
      if (missing !== undefined) return missing
      const current = backscanGoal(logOf(id))
      if (current !== null && current.goal.phase !== 'complete') {
        return goalFailure(`goal "${current.goal.id}" already exists`)
      }
      const now = Date.now()
      const projection = appendGoalChange(id, {
        kind: 'goal/change', version: 1, operation: 'create',
        goal: {
          id: `fx-goal-${logOf(id).length}`,
          revision: 1,
          objective: request.objective,
          phase: 'active',
          maxGoalRounds: request.maxGoalRounds ?? 256,
        },
        roundsStarted: 0, createdAt: now, updatedAt: now,
      })
      return { ok: true, value: { ref: { id: projection.goal.id, revision: projection.goal.revision } } }
    },
    edit(id: SessionId, ref: FxGoalRef, request: { objective?: string; maxGoalRounds?: number }): RpcResult<FxGoalView> {
      return mutateGoal(id, ref, current => ({
        ...current.goal,
        revision: current.goal.revision + 1,
        ...request.objective === undefined ? {} : { objective: request.objective },
        ...request.maxGoalRounds === undefined ? {} : { maxGoalRounds: request.maxGoalRounds },
      }))
    },
    pause(id: SessionId, ref: FxGoalRef): RpcResult<FxGoalView> {
      return mutateGoal(id, ref, current => (
        current.goal.phase === 'active'
          ? { ...current.goal, revision: current.goal.revision + 1, phase: 'paused' }
          : undefined
      ))
    },
    resume(id: SessionId, ref: FxGoalRef): RpcResult<FxGoalView> {
      return mutateGoal(id, ref, current => (
        current.goal.phase === 'paused' || current.goal.phase === 'blocked' || current.goal.phase === 'active'
          ? { ...current.goal, revision: current.goal.revision + 1, phase: 'active' }
          : undefined
      ))
    },
    complete(id: SessionId, ref: FxGoalRef): RpcResult<FxGoalView> {
      return mutateGoal(id, ref, current => (
        current.goal.phase === 'complete'
          ? undefined
          : { ...current.goal, revision: current.goal.revision + 1, phase: 'complete' }
      ))
    },
    clear(id: SessionId, ref: FxGoalRef): RpcResult<FxGoalRef> {
      const resolved = resolveGoal(id, ref)
      if (!resolved.ok) return resolved
      const current = resolved.value
      const tombstone = { id: current.goal.id, revision: current.goal.revision + 1 }
      appendGoalChange(id, {
        kind: 'goal/change', version: 1, operation: 'clear', cleared: tombstone, clearedAt: Date.now(),
      })
      return { ok: true, value: tombstone }
    },
  }

  /** Resolve one current goal revision for a canonical Remote mutation. */
  function resolveGoal(id: SessionId, ref: FxGoalRef): RpcResult<FxGoalProjection> {
    const missing = requireGoalSession(id)
    if (missing !== undefined) return missing
    const current = backscanGoal(logOf(id))
    if (current === null || current.goal.id !== ref.id || current.goal.revision !== ref.revision) {
      return goalFailure('stale or missing goal revision')
    }
    return { ok: true, value: current }
  }

  /** Shared CAS mutation path behind the canonical Remote verbs. */
  function mutateGoal(
    id: SessionId,
    ref: FxGoalRef,
    next: (current: FxGoalProjection) => FxGoalProjection['goal'] | undefined,
  ): RpcResult<FxGoalView> {
    const resolved = resolveGoal(id, ref)
    if (!resolved.ok) return resolved
    const current = resolved.value
    const goal = next(current)
    if (goal === undefined) {
      return goalFailure(`invalid goal transition from "${current.goal.phase}"`)
    }
    const projection = appendGoalChange(id, {
      kind: 'goal/change', version: 1,
      operation: goal.phase === current.goal.phase ? 'edit' : goal.phase === 'paused' ? 'pause' : goal.phase === 'active' ? 'resume' : 'complete',
      goal, roundsStarted: current.roundsStarted, createdAt: current.createdAt, updatedAt: Date.now(),
    })
    return { ok: true, value: goalView(projection) }
  }

  const mapGoalResult = <T, U>(result: RpcResult<T>, map: (value: T) => U): RpcResult<U> => (
    result.ok ? { ok: true, value: map(result.value) } : result
  )

  const goalRefResult = (result: RpcResult<FxGoalView>): RpcResult<{ ref: { id: never; revision: number } }> => (
    mapGoalResult(result, view => ({ ref: { id: view.id as never, revision: view.revision } }))
  )

  const legacyGoalResponse = <P, T>(request: RpcRequest<P>, result: RpcResult<T>): Promise<RpcResponse<T>> => (
    Promise.resolve({ rpcId: request.rpcId, result })
  )

  /** At most one in-flight replay per session; cancel clears it. */
  const replays = new Map<SessionId, { timer: ReturnType<typeof setTimeout>; finish(aborted: boolean): void }>()

  /** history transit delay (timing hooks below); the page snapshot is taken at request time, like a real host. */
  let historyDelayMs = 0
  /** One-shot history failure (timing hook: a pre-disconnect history request already doomed when reconnect lands). */
  let failNextHistory = false
  /** Force-enders for currently open stream generators (timing hook: simulated connection loss). */
  const streamBreakers = new Set<() => void>()
  /** Retry scenarios opened by timing hooks and completed in a later browser assertion phase. */
  const retryScenarios = new Map<SessionId, { turn: number; stepStarted: boolean }>()
  /** The single opt-in browser stress producer; normal fixture journeys never start it. */
  let activeReasoningChunkStorm: ReasoningChunkStormState | null = null

  // Timing-acceptance hooks (browser test backdoor): the in-memory fixture is
  // ideally timed. These let
  // browser acceptance runs create slow-history, lost-frame, and reconnect
  // windows a real host produces naturally.
  const timingHooks = {
    setHistoryDelay(ms: number): void {
      historyDelayMs = ms
    },
    /** Fail the NEXT history call (after its transit delay) with a transport-level throw. */
    failNextHistory(): void {
      failNextHistory = true
    },
    /** Log append + mux emit (the normal live path). */
    appendUser(id: string, msg: string): void {
      append(sid(id), { type: 'user/message', surfaceOp: 'append', data: userMessage(text(msg)) })
    },
    /** Append a later durable title revision through the normal raw-event + control-frame path. */
    appendTitle(id: string, title: string): void {
      const log = logOf(sid(id))
      const messageSeqs = log.filter(event => event.type === 'user/message').map(event => event.seq)
      append(sid(id), { type: 'session/title', data: { title, messageSeqs, source: { kind: 'provider', provider: 'fixture' } } })
    },
    /** Start an externally paced reasoning stream for the opt-in browser stress lane. */
    startReasoningChunkStorm(
      id: string,
      chunkCount: number,
      chunksPerInterval: number,
      intervalMs: number,
    ): string {
      if (!Number.isSafeInteger(chunkCount) || chunkCount < 1) {
        throw new Error('fixture: reasoning chunk count must be a positive safe integer')
      }
      if (!Number.isSafeInteger(chunksPerInterval) || chunksPerInterval < 1) {
        throw new Error('fixture: reasoning chunks per interval must be a positive safe integer')
      }
      if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
        throw new Error('fixture: reasoning interval must be a positive safe integer')
      }
      if (activeReasoningChunkStorm?.emitting === true) {
        throw new Error('fixture: reasoning chunk storm already running')
      }

      const sessionId = sid(id)
      const log = logOf(sessionId)
      let turn = nextTurn.get(sessionId) ?? 0
      for (const event of log) {
        const candidate = (event as unknown as { data?: { turn?: unknown } }).data?.turn
        if (typeof candidate === 'number') turn = Math.max(turn, candidate + 1)
      }
      nextTurn.set(sessionId, turn + 1)
      const marker = `REASONING_STRESS_COMPLETE:${String(turn)}:${String(chunkCount)}`
      const state: ReasoningChunkStormState = {
        sessionId: id,
        chunkCount,
        chunksPerInterval,
        intervalMs,
        emitted: 0,
        marker,
        emitting: true,
      }
      activeReasoningChunkStorm = state

      setRunning(sessionId, true)
      append(sessionId, { type: 'turn/start', data: { turn, trigger: { kind: 'message', source: { kind: 'user' } } } })
      append(sessionId, {
        type: 'user/message', surfaceOp: 'append',
        data: userMessage(text(`Reasoning chunk stress: ${String(chunkCount)} chunks.`)),
      })
      append(sessionId, { type: 'step/start', data: { turn, step: 0 } })
      append(sessionId, {
        type: 'assistant/chunk',
        data: { turn, step: 0, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
      })

      const startedAt = Date.now()
      const pump = (): void => {
        const elapsedIntervals = Math.floor((Date.now() - startedAt) / intervalMs) + 1
        const due = Math.max(state.emitted + chunksPerInterval, elapsedIntervals * chunksPerInterval)
        const end = Math.min(due, chunkCount)
        for (let index = state.emitted; index < end; index++) {
          const chunkText = index === chunkCount - 1
            ? `\n${marker}`
            : index % 64 === 63 ? '推理\n' : '推理'
          append(sessionId, {
            type: 'assistant/chunk',
            data: { turn, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: chunkText } },
          })
        }
        state.emitted = end
        if (end < chunkCount) {
          setTimeout(pump, intervalMs)
        } else {
          state.emitting = false
        }
      }
      setTimeout(pump, 0)
      return marker
    },
    /** Return a copy so browser probes cannot mutate the active producer. */
    reasoningChunkStormState(): ReasoningChunkStormState | null {
      return activeReasoningChunkStorm === null ? null : { ...activeReasoningChunkStorm }
    },
    /** Open one failed model step whose partial remains visible until llm/retry arrives. */
    beginModelRetry(id: string): void {
      const sessionId = sid(id)
      const turn = nextTurn.get(sessionId) ?? 0
      nextTurn.set(sessionId, turn + 1)
      retryScenarios.set(sessionId, { turn, stepStarted: true })
      setRunning(sessionId, true)
      append(sessionId, { type: 'turn/start', data: { turn } })
      append(sessionId, { type: 'user/message', surfaceOp: 'append', data: { content: text('请重试这个请求'), source: { kind: 'user' } } })
      append(sessionId, { type: 'step/start', data: { turn, step: 1 } })
      append(sessionId, { type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } } })
      append(sessionId, { type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'text-delta', index: 0, text: '应撤回的半截回复' } } })
    },
    /** Record one retry decision; the next attempt remains in the same step. */
    scheduleModelRetry(id: string, retry = 1, delayMs = 450): void {
      const sessionId = sid(id)
      const scenario = retryScenarios.get(sessionId)
      if (scenario === undefined) throw new Error(`fixture: no model retry scenario for ${id}`)
      if (!scenario.stepStarted) {
        append(sessionId, { type: 'assistant/chunk', data: { turn: scenario.turn, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } } })
        append(sessionId, { type: 'assistant/chunk', data: { turn: scenario.turn, step: 1, chunk: { type: 'text-delta', index: 0, text: `第 ${String(retry)} 次应撤回的回复` } } })
        scenario.stepStarted = true
      }
      const failure = { code: 'TRANSPORT', message: '连接被重置' }
      append(sessionId, {
        type: 'llm/retry',
        data: {
          turn: scenario.turn, step: 1,
          provider: 'fixture', mode: 'normal', policyKey: 'fixture-normal',
          retry, maxRetries: 2, delayMs, failure,
        },
      })
      scenario.stepStarted = false
    },
    /** Record one retry decision, then cancel its source turn before the retry starts. */
    cancelModelRetryDuringBackoff(id: string, delayMs = 450): void {
      const sessionId = sid(id)
      const scenario = retryScenarios.get(sessionId)
      if (scenario === undefined) throw new Error(`fixture: no model retry scenario for ${id}`)
      const failure = { code: 'TRANSPORT', message: '连接被重置' }
      append(sessionId, {
        type: 'llm/retry',
        data: {
          turn: scenario.turn, step: 1,
          provider: 'fixture', mode: 'normal', policyKey: 'fixture-normal',
          retry: 1, maxRetries: 2, delayMs, failure,
        },
      })
      append(sessionId, { type: 'step/end', data: { turn: scenario.turn, step: 1 } })
      append(sessionId, { type: 'turn/end', data: { turn: scenario.turn, reason: { kind: 'aborted', reason: { kind: 'user' } },
      } })
      retryScenarios.delete(sessionId)
      setRunning(sessionId, false)
    },
    /** Finish the timing-hook retry with a finalized response in the open step. */
    completeModelRetry(id: string): void {
      const sessionId = sid(id)
      const scenario = retryScenarios.get(sessionId)
      if (scenario === undefined) throw new Error(`fixture: no model retry scenario for ${id}`)
      retryScenarios.delete(sessionId)
      append(sessionId, { type: 'assistant/chunk', data: {
        turn: scenario.turn,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      } })
      append(sessionId, {
        type: 'assistant/message',
        surfaceOp: 'append',
        data: {
          turn: scenario.turn,
          step: 1,
          message: assistantMessage(text('重试后的完整回复')),
        },
      })
      append(sessionId, { type: 'step/end', data: { turn: scenario.turn, step: 1 } })
      append(sessionId, { type: 'turn/end', data: { turn: scenario.turn, reason: { kind: 'completed' } } })
      setRunning(sessionId, false)
    },
    /** Log append WITHOUT the mux emit: a frame lost in transit — history still serves it, the client must repull. */
    appendSilent(id: string, msg: string): void {
      const log = logOf(sid(id))
      log.push({ type: 'user/message', surfaceOp: 'append', seq: log.length, time: Date.now(), data: userMessage(text(msg)) } as unknown as SessionEvent)
    },
    /** End every open stream generator (client sees both streams close -> reconnect + resync path). */
    breakStreams(): void {
      for (const breakNow of [...streamBreakers]) breakNow()
    },
  }
  ;(globalThis as Record<string, unknown>).__fxTiming = timingHooks

  /** Prompt replay: chunk typewriter (80ms/frame) -> assistant/message finalize -> turn/end + running flip. */
  const startReply = (id: SessionId, turn: number, replyText: string): void => {
    const step = 0
    append(id, { type: 'step/start', data: { turn, step } })
    append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'block-start', index: 0, blockType: 'text' } } })
    /* v8 ignore next -- the ?? arm needs a null match, but every fixture reply is non-empty. */
    const pieces = replyText.match(/[\s\S]{1,6}/gu) ?? [replyText]
    let i = 0
    const finish = (aborted: boolean): void => {
      replays.delete(id)
      const done = pieces.slice(0, i).join('')
      append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: done } } } })
      append(id, {
        type: 'assistant/message',
        surfaceOp: 'append',
        data: {
          turn,
          step,
          message: assistantMessage(text(aborted ? `${done}（已中断）` : done)),
          usage: fixtureUsage(turn, step),
        },
      })
      append(id, { type: 'step/end', data: { turn, step } })
      append(id, { type: 'turn/end', data: { turn, reason: { kind: aborted ? 'cancelled' : 'completed' } } })
      setRunning(id, false)
    }
    const tick = (): void => {
      const piece = pieces[i]
      if (piece === undefined) {
        finish(false)
        return
      }
      i++
      append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'text-delta', index: 0, text: piece } } })
      replays.set(id, { timer: setTimeout(tick, 80), finish })
    }
    replays.set(id, { timer: setTimeout(tick, 80), finish })
  }

  /** Fold the durable session log into the chat-completions message list. */
  /**
   * Agent harness mediation (interim pi-agent): the conversation runs through
   * a tool-capable agent loop — harness system prompt, model may request tool
   * calls, results feed back, and only the final assistant text surfaces.
   * The real DSH ReactLoopAgent + goal/agent services would replace this once
   * the server core is mounted in the client; this keeps agent semantics.
   */
  /** Static tools every agent turn advertises, independent of mounted MCP servers. */
  const STATIC_AGENT_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'shell_echo',
        description: '执行一条 shell 命令并返回输出',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: '要执行的命令' } },
          required: ['command'],
        },
      },
    },
  ]
  /**
   * Resolve the enabled MCP servers from the in-memory inventory (the persisted
   * `mcp-inventory` namespace is the source of truth under Tauri; a server
   * defaults to enabled, matching `projectMcpEntry`).
   */
  const enabledMcpServers = (): Array<{ serverName: string; spec: FixtureMcpSpec }> =>
    [...mcpServers.entries()]
      .filter(([entryId]) => mcpEnabled.get(entryId) !== false)
      .map(([, spec]) => ({ serverName: spec.serverName, spec }))
  /**
   * Skill context source: append the ENABLED skills' name/description to the
   * harness system prompt as a "可用技能" list (the interim loop's window onto
   * the skill inventory; `skillInventory/list` already overlays the persisted
   * enabled map, so only the enabled entries are surfaced here).
   */
  const skillContextSuffix = (): string => {
    const enabled = fixtureSkills.filter(skill => skillEnabled.get(skill.entryId) ?? skill.enabled)
    if (enabled.length === 0) return ''
    return `\n\n可用技能：\n${enabled.map(skill => `- ${skill.name}：${skill.description}`).join('\n')}`
  }
  /** Execute one requested tool call (fixture-safe mock; real host runs the tool). */
  const executeAgentTool = async (
    name: string,
    argumentsText: string,
    dispatchMcp: (name: string, args: string) => Promise<string>,
  ): Promise<string> => {
    if (name === 'shell_echo') {
      try {
        const args = JSON.parse(argumentsText || '{}') as { command?: unknown }
        return `命令已执行，输出：${typeof args.command === 'string' ? args.command : '(无命令)'}`
      } catch {
        return '命令参数解析失败'
      }
    }
    if (name.startsWith('mcp__')) {
      try {
        return await dispatchMcp(name, argumentsText)
      } catch (error) {
        return `MCP 工具调用失败：${error instanceof Error ? error.message : String(error)}`
      }
    }
    return `未知工具 ${name}`
  }
  const runAgentTurn = async (
    apiKey: string,
    model: string,
    api: string,
    baseUrl: string | undefined,
    history: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<RealLlmReply> => {
    // Mount the enabled MCP servers once per turn (real initialize + tools/list;
    // stdio children stay warm across the loop rounds and are closed below).
    // With no enabled servers this is a no-op and behavior matches the pre-mount
    // loop. Persisted servers are seeded from settings before the first mount.
    await seedSettings()
    const mount = await mountEnabledMcpServers({ servers: enabledMcpServers() })
    try {
      const messages: Array<Record<string, unknown>> = [
        { role: 'system', content: `${agentSystemPrompt}${skillContextSuffix()}` },
        ...history,
      ]
      const agentTools = [...STATIC_AGENT_TOOLS, ...mount.tools]
      for (let round = 0; round < 4; round += 1) {
        const reply = await callRealLlm({
          apiKey,
          model,
          messages: messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
          api,
          ...(baseUrl === undefined ? {} : { baseUrl }),
          tools: agentTools,
        })
        if (reply.toolCalls === undefined || reply.toolCalls.length === 0) return reply
        messages.push({
          role: 'assistant',
          content: reply.text,
          tool_calls: reply.toolCalls.map(call => ({
            id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
          })),
        })
        for (const call of reply.toolCalls) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: await executeAgentTool(call.name, call.arguments, mount.dispatch) })
        }
      }
      return { text: '（已达到最大工具调用轮次，请稍后再试）' }
    } finally {
      await mount.close()
    }
  }

  const buildChatMessages = (id: SessionId): { role: 'system' | 'user' | 'assistant'; content: string }[] => {
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
    for (const seq of foldSurface(logOf(id)).nodes) {
      const event = logOf(id)[seq]
      if (event === undefined) continue
      const message = deriveEventMessage(event)
      if (message === null) continue
      const text = message.content
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim()
      if (text === '') continue
      if (event.type === 'user/message') {
        messages.push({ role: 'user', content: text })
      } else if (event.type === 'assistant/message') {
        messages.push({ role: 'assistant', content: text })
      }
    }
    return messages
  }

  /**
   * Real-LLM reply path (realLlm mode): accepts the prompt (the RPC returns
   * immediately, as the host does) and streams the real completions response
   * through the same turn/step/assistant-event machinery as the canned replay.
   */
  const startRealReply = (id: SessionId, turn: number): void => {
    const step = 0
    const selection = modelSelections.get(id) ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    append(id, { type: 'step/start', data: { turn, step } })
    const finish = (aborted: boolean, replyText: string, usage?: TokenUsage): void => {
      replays.delete(id)
      const blocks = contentBlocksFromReply(aborted ? `${replyText}（已中断）` : replyText)
      const last = blocks[blocks.length - 1] ?? { type: 'text' as const, text: replyText }
      append(id, {
        type: 'assistant/chunk',
        data: { turn, step, chunk: { type: 'block-end', index: 0, block: { type: last.type, text: (last as { text?: string }).text ?? '' } } },
      })
      append(id, {
        type: 'assistant/message',
        surfaceOp: 'append',
        data: { turn, step, message: assistantMessage(blocks), usage: usage ?? fixtureUsage(turn, step) },
      })
      append(id, { type: 'step/end', data: { turn, step } })
      append(id, { type: 'turn/end', data: { turn, reason: { kind: aborted ? 'cancelled' : 'completed' } } })
      setRunning(id, false)
    }
    append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'block-start', index: 0, blockType: 'text' } } })
    // The real call uses the SELECTED model's provider: its endpoint + credential
    // from the 设置-模型 config, not a hardcoded DeepSeek key.
    const providerProfile = ((selection.provider === 'deepseek-official' ? llmDeepseekUser : llmPiAiUser).providers as
      Record<string, { baseURL?: unknown; api?: unknown; apiKeyEnv?: unknown; displayName?: unknown }> | undefined)?.[selection.provider]
    const providerBaseURL = typeof providerProfile?.baseURL === 'string' && providerProfile.baseURL.length > 0
      ? providerProfile.baseURL
      : declaredProviderBaseUrl(selection.provider)
    const providerApi = typeof providerProfile?.api === 'string' ? providerProfile.api : 'openai-completions'
    const providerKeyRef = typeof providerProfile?.apiKeyEnv === 'string' && providerProfile.apiKeyEnv.length > 0
      ? providerProfile.apiKeyEnv
      : (selection.provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : undefined)
    const providerLabel = typeof providerProfile?.displayName === 'string' && providerProfile.displayName.length > 0
      ? providerProfile.displayName
      : selection.provider
    // A custom provider without a configured endpoint must not silently fall
    // back to the DeepSeek URL with its own key.
    if (providerBaseURL === undefined && selection.provider !== 'deepseek-official' && options.llmUrl === undefined) {
      const notice = `提供方 ${providerLabel} 未配置 API 地址：请在 设置 → 模型 中填写后重试。`
      append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'text-delta', index: 0, text: notice } } })
      finish(true, notice)
      return
    }
    void readRealCredential(providerKeyRef ?? 'DEEPSEEK_API_KEY').then((apiKey) => {
      if (apiKey === null || apiKey === '') {
        const notice = `未配置 ${providerLabel} API Key：请在 设置 → 模型 的凭据中填写后重试。`
        append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'text-delta', index: 0, text: notice } } })
        finish(true, notice)
        return
      }
      const effectiveBaseUrl = options.llmUrl ?? providerBaseURL
      // Route through an agent loop (interim pi-agent mediation): the model
      // gets a harness system prompt + tools, may call tools, and only the
      // final assistant text streams — not a bare direct-chat completion.
      return runAgentTurn(apiKey, selection.model, providerApi, effectiveBaseUrl, buildChatMessages(id))
    }).then((reply) => {
      if (reply === undefined) return
      append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'text-delta', index: 0, text: reply.text } } })
      finish(false, reply.text, reply.usage === undefined ? undefined : {
        inputTokens: reply.usage.inputTokens,
        outputTokens: reply.usage.outputTokens,
        cacheReadTokens: reply.usage.cacheReadTokens ?? 0,
        cacheWriteTokens: reply.usage.cacheWriteTokens ?? 0,
      })
    }).catch((error) => {
      const message = `模型调用失败：${error instanceof Error ? error.message : String(error)}`
      append(id, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'text-delta', index: 0, text: message } } })
      finish(true, message)
    })
  }

  const api: ApiProxy = {
    sessions: {
      list: async (request) => {
        await loadRealWorkspaces()
        return ok(request, { items: [...sessions].sort((a, b) => b.updatedAt - a.updatedAt) })
      },
      search: (request, signal) => {
        if (signal.aborted) {
          return err(request, {
            code: 'cancelled',
            message: 'fixture session search was aborted',
            details: {},
          })
        }
        const query = searchTokenSpans(request.payload.query).tokens.map(token => token.value)
        const matches = sessions.flatMap((summary) => {
          const log = logs.get(summary.sessionId) ?? []
          const current = new Set(foldSurface(log).nodes)
          const best = log.flatMap((event): FixtureSearchCandidate[] => {
            if (!current.has(event.seq)) return []
            const eventText = searchEventText(event)
            const document = searchTokenSpans(eventText)
            const match = phraseMatch(document.tokens, query)
            if (match.count === 0) return []
            return [{
              sessionId: summary.sessionId,
              seq: event.seq,
              time: event.time,
              text: document.text,
              matchCount: match.count,
              matchStart: match.start,
              matchEnd: match.end,
              documentLength: Array.from(eventText).length,
            }]
          }).sort(compareSearchCandidates)[0]
          return best === undefined ? [] : [best]
        }).sort(compareSearchCandidates)
        return ok(request, {
          items: matches.slice(0, SESSION_SEARCH_RESULT_LIMIT).map(match => ({
            sessionId: match.sessionId,
            snippet: searchSnippet(match.text, match.matchStart, match.matchEnd),
          })),
          hasMore: matches.length > SESSION_SEARCH_RESULT_LIMIT,
        })
      },
      create: async (request) => {
        const workspace = request.payload.workspaceId === undefined
          ? undefined
          : workspaces.find(w => w.workspaceId === request.payload.workspaceId)
        if (request.payload.workspaceId !== undefined && workspace === undefined) {
          return err(request, {
            code: 'workspace-not-found',
            message: `no workspace ${request.payload.workspaceId}`,
            details: { workspaceId: request.payload.workspaceId },
          })
        }
        const cwd = workspace?.path ?? request.payload.cwd ?? '/tmp/fixture'
        const requestedId = request.payload.sessionId
        const attachWorkspace = (sessionId: SessionId): void => {
          /* v8 ignore next -- callers enter only when a target Workspace exists. */
          if (workspace === undefined || workspace.sessionIds.includes(sessionId)) return
          workspace.sessionIds = [sessionId, ...workspace.sessionIds]
          workspace.updatedAt = new Date().toISOString()
          emitHost({ type: 'host/workspace-changed', workspace: { ...workspace } })
        }
        const attachFailure = (
          sessionId: SessionId,
          workspaceId: WorkspaceId,
        ): Promise<RpcResponse<{ sessionId: SessionId }>> => err(request, {
          code: 'workspace-attach-failed' as const,
          message: `fixture rejected Workspace attachment for ${sessionId}`,
          details: { sessionId, workspaceId },
        })
        if (requestedId !== undefined) {
          const existing = summaryOf(requestedId)
          if (existing !== undefined) {
            if (existing.cwd !== cwd) {
              return err(request, {
                code: 'session-conflict',
                message: `session ${requestedId} already uses ${existing.cwd ?? 'no cwd'}`,
                details: { sessionId: requestedId, requestedCwd: cwd, ...existing.cwd === undefined ? {} : { existingCwd: existing.cwd } },
              })
            }
            if (workspace !== undefined && !workspace.sessionIds.includes(requestedId)) {
              if (options.failWorkspaceAttach) return attachFailure(requestedId, workspace.workspaceId)
              attachWorkspace(requestedId)
            }
            return ok(request, { sessionId: requestedId })
          }
        }
        const created: SessionSummary = {
          sessionId: requestedId ?? sid(`fx-${nextSession++}`), updatedAt: Date.now(), running: false, blank: true, cwd,
        }
        sessions.push(created)
        modelSelections.set(created.sessionId, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
        attachedSessions += 1
        const emitSession = (): void => {
          // Mirrors the host: the frame fires at creation, so blank is constantly true.
          emitHost({ type: 'host/session-added', sessionId: created.sessionId, blank: true, cwd })
        }
        if (workspace !== undefined && options.failWorkspaceAttach) {
          emitSession()
          return attachFailure(created.sessionId, workspace.workspaceId)
        }
        if (workspace !== undefined && options.createFrameOrder === 'workspace-first') {
          attachWorkspace(created.sessionId)
          emitSession()
        } else {
          emitSession()
          if (workspace !== undefined) attachWorkspace(created.sessionId)
        }
        if (options.dropSessionCreateResponse) throw new Error('fixture: dropped session.create response after publication')
        return ok(request, { sessionId: created.sessionId })
      },
      rename: (request) => {
        const missing = requireSession(request)
        if (missing !== undefined) return missing
        const { sessionId, title } = request.payload
        const normalized = title.trim().replace(/\s+/g, ' ')
        if (normalized.length === 0) {
          return err(request, {
            code: 'title-invalid',
            message: 'session title must contain visible characters',
            details: { sessionId },
          })
        }
        // The append emits the session/event and its session/projection frame
        // (host parallel); the unary response settles the caller first.
        append(sessionId, {
          type: 'session/title',
          data: { title: normalized, messageSeqs: [], source: { kind: 'user' } },
        })
        const appended = logOf(sessionId).at(-1) as SessionEvent
        return ok(request, { title: normalized, seq: appended.seq })
      },
      fork: (request) => {
        const { sessionId, atSeq } = request.payload
        const source = summaryOf(sessionId)
        if (source === undefined) {
          return err(request, {
            code: 'session-not-found',
            message: `no session ${sessionId}`,
            details: { sessionId },
          })
        }
        const log = logs.get(sessionId) ?? []
        const lastSeq = log.at(-1)?.seq ?? -1
        const anchoredBoundary = atSeq === undefined
          ? undefined
          : log.find(e => e.type === 'turn/end' && e.seq >= atSeq)
        const boundary = anchoredBoundary
          ?? (atSeq === undefined || atSeq > lastSeq
            ? log.findLast(e => e.type === 'turn/end')
            : undefined)
        if (boundary === undefined) {
          return err(request, {
            code: 'fork-unavailable',
            message: atSeq !== undefined && atSeq <= lastSeq
              ? `session ${sessionId} has not completed the turn containing event ${String(atSeq)}`
              : `session ${sessionId} has no completed turn`,
            details: { sessionId },
          })
        }
        let cut = boundary.seq + 1
        while (cut < log.length && log[cut]?.type !== 'turn/start') cut++
        const child: SessionSummary = {
          sessionId: sid(`fx-${nextSession++}`), updatedAt: Date.now(), running: false, blank: false,
          parentSessionId: sessionId,
          ...source.cwd === undefined ? {} : { cwd: source.cwd },
        }
        logs.set(child.sessionId, log.slice(0, cut))
        sessions.push(child)
        emitHost({
          type: 'host/session-added', sessionId: child.sessionId, blank: false,
          parentSessionId: sessionId,
          ...source.cwd === undefined ? {} : { cwd: source.cwd },
        })
        const workspace = workspaces.find(w => w.sessionIds.includes(sessionId))
        if (workspace !== undefined) {
          workspace.sessionIds = [child.sessionId, ...workspace.sessionIds]
          workspace.updatedAt = new Date().toISOString()
          emitHost({ type: 'host/workspace-changed', workspace: { ...workspace } })
        }
        return ok(request, { sessionId: child.sessionId })
      },
      history: async (request) => {
        const log = logs.get(request.payload.sessionId) ?? []
        // Snapshot at request time, deliver after the transit delay (mirrors a real host under latency).
        const page = pageOf(log, request.payload.beforeSeq, request.payload.maxMessages ?? 50)
        // Tail page carries the projections block (host parallel: one consistent
        // cut over the registered units; asOfSeq = window tail seq, -1 on an
        // empty log — the host's session.seq-1 convention).
        const projections = request.payload.beforeSeq === undefined
          ? { asOfSeq: log.length - 1, values: projectionValuesOf(log) }
          : undefined
        const doomed = failNextHistory
        failNextHistory = false
        const delay = historyDelayMs
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
        if (doomed) throw new Error('fixture: simulated history transport failure')
        return ok(request, { ...page, ...projections === undefined ? {} : { projections } })
      },
      models: request => ok(request, {
        current: modelSelections.get(request.payload.sessionId)
          ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        // The fixture's routes all serve; a surface exercising the blocked
        // posture drives it through its own stub.
        routable: true,
        // The composer picker shows the providers configured in 设置-模型, not
        // the hardcoded fixture catalog.
        groups: configuredModelGroups(llmDeepseekUser, llmPiAiUser),
        failures: [],
      }),
      selectModel: (request) => {
        const selected: ModelSelection = {
          provider: request.payload.provider,
          model: request.payload.model,
          ...request.payload.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: request.payload.reasoningEffort },
        }
        modelSelections.set(request.payload.sessionId, selected)
        return ok(request, { selected })
      },
      prompt: (request) => {
        const { sessionId: id, mode, content } = request.payload
        const summary = summaryOf(id)
        if (summary === undefined) {
          return err(request, { code: 'session-not-found', message: `no session ${id}`, details: { sessionId: id } })
        }
        if (options.rejectPrompt) {
          return err(request, {
            code: 'agent-busy',
            message: 'fixture: prompt rejected before acceptance',
            details: { reason: 'fixture-prompt-rejection' },
          })
        }
        summary.updatedAt = Date.now()
        // First accepted prompt appends events: the summary stops being blank.
        const firstPrompt = summary.blank
        summary.blank = false
        const userText = content.map(b => (b.type === 'text' ? b.text : '')).join('')
        // Derive a default title from the first user message so a new session
        // isn't left as "新会话" after it starts talking.
        if (firstPrompt) {
          const derived = userText.trim().replace(/\s+/g, ' ').slice(0, 30)
          if (derived.length > 0) {
            append(sid(id), {
              type: 'session/title',
              data: { title: derived, messageSeqs: [], source: { kind: 'provider', provider: 'fixture' } },
            })
          }
        }
        const durable: ContentBlock[] = content.map((block) => {
          if (block.type === 'text') return block
          if (block.type === 'file') return { type: 'text', text: `[File: ${block.name ?? 'attached file'}]` }
          const attachment: ImageAttachmentRef = {
            attachmentId: `fixture:${randomUuid()}` as AttachmentIdType,
            mediaType: block.mediaType,
            bytes: Math.max(
              1,
              Math.floor(block.data.length * 3 / 4)
              - (block.data.endsWith('==') ? 2 : block.data.endsWith('=') ? 1 : 0),
            ),
            width: 160,
            height: 90,
            ...block.name === undefined ? {} : { name: block.name },
          }
          attachments.set(String(attachment.attachmentId), { attachment, data: block.data })
          return { type: 'image', attachment }
        })
        if (mode === 'steer' && replays.has(id)) {
          // Steering: the durable user/message lands inside the current turn; the replay continues.
          append(id, { type: 'user/message', surfaceOp: 'append', data: userMessage(durable) })
          return ok(request, { accepted: true as const })
        }
        const turn = nextTurn.get(id) ?? 0
        nextTurn.set(id, turn + 1)
        setRunning(id, true)
        append(id, { type: 'turn/start', data: { turn } })
        // Boundary flush parallel (the host's step/start observer): an outstanding
        // /plan selection commits as plan/mode inside the opened turn.
        const plan = foldPlan(logOf(id))
        if (plan.wanted !== null && plan.wanted !== plan.active) {
          append(id, { type: 'plan/mode', data: { active: plan.wanted } })
        }
        append(id, { type: 'user/message', surfaceOp: 'append', data: userMessage(durable) })
        // Capacity parallel of the host token-meter's request/context record:
        // log-only, appended inside the open turn, and deduplicated against the
        // route already recorded (the fixture never varies contextWindow).
        const selection = modelSelections.get(id) ?? { provider: 'deepseek', model: 'deepseek-v4-flash' }
        if (lastRequestContext(logOf(id))?.model !== selection.model) {
          append(id, {
            type: 'request/context',
            data: { provider: selection.provider, model: selection.model, contextWindow: 128_000 },
          })
        }
        if (options.realLlm) {
          // Real model reply: stream the completions response through the same
          // turn/step events (the RPC still returns `accepted` immediately).
          startRealReply(id, turn)
          return ok(request, { accepted: true as const })
        }
        startReply(
          id,
          turn,
          userText === 'render markdown'
            ? MARKDOWN_FIXTURE
            : userText === 'report model'
              ? (() => {
                const selection = modelSelections.get(id)
                return `当前模型：${selection?.provider ?? 'unknown'}/${selection?.model ?? 'unknown'}`
                  + (selection?.reasoningEffort === undefined ? '' : ` · 推理等级：${selection.reasoningEffort}`)
              })()
              : `回声：${userText}。这是 fixture 的流式回复，用于验证打字机增长与定稿切换。`,
        )
        return ok(request, { accepted: true as const })
      },
      attachment: (request) => {
        const stored = attachments.get(String(request.payload.attachmentId))
        if (stored === undefined) {
          return err(request, {
            code: 'attachment-error',
            message: 'fixture attachment missing',
            details: { reason: 'ATTACHMENT_NOT_FOUND' },
          })
        }
        if (!logReferencesAttachment(
          logs.get(request.payload.sessionId) ?? [],
          String(request.payload.attachmentId),
        )) {
          return err(request, {
            code: 'attachment-error',
            message: 'fixture attachment is not referenced by this session',
            details: { reason: 'ATTACHMENT_NOT_REFERENCED' },
          })
        }
        return ok(request, stored)
      },
      updateQueue: request => err(request, {
        code: 'queue-item-not-found',
        message: 'fixture has no pending queue item',
        details: { itemId: request.payload.itemId },
      }),
      cancel: (request) => {
        const replay = replays.get(request.payload.sessionId)
        if (replay !== undefined) {
          clearTimeout(replay.timer)
          replay.finish(true)
        } else {
          setRunning(request.payload.sessionId, false)
        }
        return ok(request, { accepted: true as const })
      },
    },
    subagents: {
      list: request => ok(request, { entries: [], parentAvailable: true }),
      history: (request) => {
        const log = logs.get(request.payload.childSessionId) ?? []
        return Promise.resolve(ok(
          request,
          pageOf(log, request.payload.beforeSeq, request.payload.maxMessages ?? 50),
        ))
      },
      prompt: request => Promise.resolve(ok(request, {
        messageId: `fixture-message-${request.payload.childSessionId}` as never,
      })),
      interrupt: request => Promise.resolve(ok(request, { accepted: true as const })),
    },
    host: {
      describe: request => ok(request, {
        version: '0.0.0-fixture', cwd: '/tmp/fixture', attachedSessions, canOpenPath: true,
      }),
      // Deterministic native pick: the keyless lanes drive the full
      // pick-then-adopt path without an OS chooser (design-mock content,
      // same tree the browse primitives serve). Under Tauri the desktop app
      // opens the REAL native folder picker so a new workspace selects an
      // actual directory on the computer.
      pickDirectory: async (request) => {
        const invoke = tauriInvoke()
        if (invoke !== undefined) {
          try {
            const picked = await invoke<string | null>('dialog_open', {
              opts: { directory: true, title: '选择工作区' },
            })
            return ok(request, { path: picked })
          } catch (error) {
            return err(request, {
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
              details: {},
            })
          }
        }
        return ok(request, { path: `${FIXTURE_HOME}/Documents/project` })
      },
      listDirectory: (request) => {
        const target = request.payload.path ?? FIXTURE_HOME
        const children = childrenOf(target)
        if (children === undefined) {
          return err(request, { code: 'directory-unreadable', message: `cannot list ${target}: not in the fixture tree`, details: { path: target } })
        }
        return ok(request, {
          path: target,
          home: FIXTURE_HOME,
          crumbs: crumbsOf(target),
          entries: [...children].sort((a, b) => a.localeCompare(b))
            .map(name => ({ name, path: target === '/' ? `/${name}` : `${target}/${name}`, hidden: name.startsWith('.') })),
          // The fixture tree is tiny; no level ever reaches a backend bound.
          truncated: false,
        })
      },
      createDirectory: (request) => {
        const parent = request.payload.path
        const children = childrenOf(parent)
        if (children === undefined) {
          return err(request, { code: 'directory-create-failed', message: `missing parent ${parent}`, details: { path: parent } })
        }
        // Same root special case as listDirectory's entry paths: a plain join
        // under '/' would mint '//name' and fork the tree's identity.
        const target = parent === '/' ? `/${request.payload.name}` : `${parent}/${request.payload.name}`
        if (children.includes(request.payload.name)) {
          return err(request, { code: 'directory-exists', message: `${target} already exists`, details: { path: target } })
        }
        directoryTree.set(parent, [...children, request.payload.name])
        directoryTree.set(target, [])
        return ok(request, { path: target })
      },
      openPath: request => ok(request, { opened: true as const }),
      testProxy: async (request) => {
        // Real probe: under Tauri the Rust proxy_test opens a CONNECT tunnel;
        // in the browser fall back to a format check + a direct fetch attempt.
        const url = (request.payload as { url?: string }).url ?? ''
        const clean = url.trim()
        const invoke = tauriInvoke()
        if (invoke !== undefined) {
          const result = await invoke<{ ok: boolean; latency_ms?: number; error?: string }>('proxy_test', { url: clean })
          return ok(request, {
            ok: result.ok,
            ...(result.latency_ms === undefined ? {} : { latencyMs: result.latency_ms }),
            ...(result.error === undefined ? {} : { error: result.error }),
          })
        }
        if (!/^https?:\/\/[^/]+:\d+/.test(clean)) {
          return ok(request, { ok: false, error: '无效的代理地址（示例：http://127.0.0.1:7890）' })
        }
        try {
          const t0 = performance.now()
          await fetch(clean, { signal: AbortSignal.timeout(5000) }).catch(() => null)
          return ok(request, { ok: true, latencyMs: Math.round(performance.now() - t0) })
        } catch {
          return ok(request, { ok: false, error: '无法连接代理' })
        }
      },
    },
    workspace: {
      list: async (request) => {
        await loadRealWorkspaces()
        return ok(request, {
          items: workspaces.map(w => ({ ...w })),
          archivedSessionIds: [...archivedSessionIds],
        })
      },
      create: (request) => {
        const { path } = request.payload
        const existing = workspaces.find(w => w.path === path)
        if (existing !== undefined) return ok(request, { workspace: { ...existing }, created: false })
        const now = new Date().toISOString()
        const created: WorkspaceView = {
          workspaceId: wid(`fx-ws-${nextWorkspace++}`),
          path,
          // A picked directory can be a Windows path (backslashes) — derive
          // the title from the last segment on either separator.
          title: path.split(/[/\\]/).filter(Boolean).at(-1) ?? path,
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        }
        workspaces.unshift(created)
        emitHost({ type: 'host/workspace-changed', workspace: { ...created } })
        return ok(request, { workspace: { ...created }, created: true })
      },
      rename: (request) => {
        const { workspaceId, title } = request.payload
        const workspace = workspaces.find(w => w.workspaceId === workspaceId)
        if (workspace === undefined) {
          return err(request, {
            code: 'workspace-not-found',
            message: `no workspace ${workspaceId}`,
            details: { workspaceId },
          })
        }
        const trimmed = title.trim()
        if (trimmed !== workspace.title) {
          if (workspaces.some(w => w.workspaceId !== workspaceId && w.title === trimmed)) {
            return err(request, {
              code: 'workspace-name-conflict',
              message: `workspace name '${trimmed}' is already in use`,
              details: { name: trimmed },
            })
          }
          workspace.title = trimmed
          workspace.updatedAt = new Date().toISOString()
          emitHost({ type: 'host/workspace-changed', workspace: { ...workspace } })
        }
        return ok(request, { workspace: { ...workspace } })
      },
      delete: (request) => {
        const { workspaceId } = request.payload
        const index = workspaces.findIndex(workspace => workspace.workspaceId === workspaceId)
        if (index === -1) {
          return err(request, {
            code: 'workspace-not-found',
            message: `no workspace ${workspaceId}`,
            details: { workspaceId },
          })
        }
        workspaces.splice(index, 1)
        emitHost({ type: 'host/workspace-removed', workspaceId })
        return ok(request, { deleted: true as const })
      },
      insertBefore: (request) => {
        const { workspaceId, beforeWorkspaceId } = request.payload
        const source = workspaces.findIndex(workspace => workspace.workspaceId === workspaceId)
        const anchor = beforeWorkspaceId === undefined
          ? workspaces.length
          : workspaces.findIndex(workspace => workspace.workspaceId === beforeWorkspaceId)
        const missing = source === -1 ? workspaceId : anchor === -1 ? beforeWorkspaceId : undefined
        if (missing !== undefined) {
          return err(request, {
            code: 'workspace-not-found',
            message: `no workspace ${missing}`,
            details: { workspaceId: missing },
          })
        }
        if (beforeWorkspaceId !== workspaceId) {
          const previousOrder = workspaces.map(candidate => candidate.workspaceId)
          const [workspace] = workspaces.splice(source, 1)
          /* v8 ignore next -- source was resolved from the same array immediately above. */
          if (workspace === undefined) throw new Error(`fixture lost workspace ${workspaceId}`)
          const at = beforeWorkspaceId === undefined
            ? workspaces.length
            : workspaces.findIndex(candidate => candidate.workspaceId === beforeWorkspaceId)
          workspaces.splice(at, 0, workspace)
          if (workspaces.some((candidate, index) => candidate.workspaceId !== previousOrder[index])) {
            emitHost({
              type: 'host/workspace-order-changed',
              workspaceIds: workspaces.map(candidate => candidate.workspaceId),
            })
          }
        }
        return ok(request, { workspaceIds: workspaces.map(candidate => candidate.workspaceId) })
      },
      insertSessionBefore: (request) => {
        const { workspaceId, sessionId, beforeSessionId } = request.payload
        const workspace = workspaces.find(w => w.workspaceId === workspaceId)
        if (workspace === undefined) {
          return err(request, {
            code: 'workspace-not-found',
            message: `no workspace ${workspaceId}`,
            details: { workspaceId },
          })
        }
        if (!workspace.sessionIds.includes(sessionId)
          || (beforeSessionId !== undefined && !workspace.sessionIds.includes(beforeSessionId))) {
          return err(request, {
            code: 'workspace-move-invalid',
            message: `session or anchor is not accounted by workspace ${workspaceId}`,
            details: { workspaceId, sessionId, ...beforeSessionId === undefined ? {} : { beforeSessionId } },
          })
        }
        const without = workspace.sessionIds.filter(id => id !== sessionId)
        const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
        const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
        if (!sessionIds.every((id, index) => id === workspace.sessionIds[index])) {
          workspace.sessionIds = sessionIds
          workspace.updatedAt = new Date().toISOString()
          emitHost({ type: 'host/workspace-changed', workspace: { ...workspace } })
        }
        return ok(request, { workspace: { ...workspace } })
      },
      archiveSession: (request) => {
        const missing = requireSession(request)
        if (missing !== undefined) return missing
        const { sessionId } = request.payload
        if (!archivedSessionIds.includes(sessionId)) {
          archivedSessionIds.push(sessionId)
          emitHost({ type: 'host/archived-sessions-changed', archivedSessionIds: [...archivedSessionIds] })
        }
        return ok(request, { archivedSessionIds: [...archivedSessionIds] })
      },
    },
    agentPresets: {
      // Both trusts appear, because a surface must present a locally authored
      // preset differently from one the deployment vetted.
      list: request => ok(request, {
        presets: [...fixturePresets].map(([id, preset]) => ({
          id,
          trust: preset.trust,
          isDefault: id === fixtureDefaultPreset,
        })),
        authorable: true,
        hasDocument: true,
      }),
      select: (request) => {
        fixtureDefaultPreset = request.payload.agentPreset
        return ok(request, { agentPreset: request.payload.agentPreset })
      },
      read: (request) => {
        const { agentPreset } = request.payload
        const preset = fixturePresets.get(agentPreset)
        if (preset === undefined) {
          return err(request, {
            code: 'agent-preset-not-found',
            message: `unknown agent preset "${agentPreset}"`,
            details: { agentPreset, available: [...fixturePresets.keys()] },
          })
        }
        return ok(request, {
          agentPreset,
          trust: preset.trust,
          content: preset.content,
        })
      },
      copy: (request) => {
        const { from, agentPreset } = request.payload
        const source = fixturePresets.get(from)
        if (source === undefined) {
          return err(request, {
            code: 'agent-preset-not-found',
            message: `unknown agent preset "${from}"`,
            details: { agentPreset: from, available: [...fixturePresets.keys()] },
          })
        }
        if (fixturePresets.has(agentPreset)) {
          return err(request, {
            code: 'agent-preset-invalid',
            message: `agent preset "${agentPreset}" already exists`,
            details: { agentPreset, reason: 'already exists' },
          })
        }
        fixturePresets.set(agentPreset, { trust: 'user', content: source.content })
        return ok(request, { agentPreset })
      },
      // Native opens are deterministic no-op successes in this fixture, so the
      // open-directory affordance renders and the path-text fallback stays a
      // component-test concern.
      openDocument: (request) => {
        const { agentPreset } = request.payload
        const existing = fixturePresets.get(agentPreset)
        if (existing === undefined || existing.trust === 'system') {
          return err(request, {
            code: 'agent-preset-read-only',
            message: `agent preset "${agentPreset}" ships with the deployment`,
            details: { agentPreset, reason: 'it ships with the deployment' },
          })
        }
        return ok(request, { opened: true as const })
      },
      remove: (request) => {
        const { agentPreset } = request.payload
        const existing = fixturePresets.get(agentPreset)
        if (existing?.trust === 'system') {
          return err(request, {
            code: 'agent-preset-read-only',
            message: `agent preset "${agentPreset}" ships with the deployment`,
            details: { agentPreset, reason: 'it ships with the deployment' },
          })
        }
        fixturePresets.delete(agentPreset)
        return ok(request, {})
      },
    },

    skills: {
      list: (request) => {
        const missing = requireSession(request)
        if (missing !== undefined) return missing
        return ok(request, {
          skills: [
            { name: 'fixture-demo', description: 'fixture 技能样本', whenToUse: '仅供 UI 目录渲染验收', modelInvocable: true },
            { name: 'fixture-user-only', description: 'fixture 仅用户技能样本', modelInvocable: false },
          ],
        })
      },
    },
    goals: {
      // Compatibility face only: old API Proxy payloads and acknowledgements
      // adapt to the canonical fixture Remote implementation above.
      create: request => legacyGoalResponse(
        request,
        mapGoalResult(
          goalRemotes.create(request.payload.sessionId, {
            objective: request.payload.objective,
            ...request.payload.maxGoalRounds === undefined ? {} : { maxGoalRounds: request.payload.maxGoalRounds },
          }),
          value => ({ ref: { id: value.ref.id as never, revision: value.ref.revision } }),
        ),
      ),
      edit: request => legacyGoalResponse(
        request,
        goalRefResult(goalRemotes.edit(request.payload.sessionId, request.payload.ref, {
          ...request.payload.objective === undefined ? {} : { objective: request.payload.objective },
          ...request.payload.maxGoalRounds === undefined ? {} : { maxGoalRounds: request.payload.maxGoalRounds },
        })),
      ),
      pause: request => legacyGoalResponse(
        request,
        goalRefResult(goalRemotes.pause(request.payload.sessionId, request.payload.ref)),
      ),
      resume: request => legacyGoalResponse(
        request,
        goalRefResult(goalRemotes.resume(request.payload.sessionId, request.payload.ref)),
      ),
      complete: request => legacyGoalResponse(
        request,
        goalRefResult(goalRemotes.complete(request.payload.sessionId, request.payload.ref)),
      ),
      clear: request => legacyGoalResponse(
        request,
        mapGoalResult(
          goalRemotes.clear(request.payload.sessionId, request.payload.ref),
          () => ({ cleared: true as const }),
        ),
      ),
    },
    events: {
      async *mux(_request, signal) {
        const conn = new FxInbox<MuxFrame>()
        muxConns.add(conn)
        const breakNow = (): void => { conn.breakNow() }
        streamBreakers.add(breakNow)
        // Open baseline: subscribed sessions + pending interactions replayed with stable rpcIds.
        for (const s of sessions) {
          if (!s.running) continue
          const log = logs.get(s.sessionId) ?? []
          conn.push({ rpcId: mint(), payload: { type: 'session/subscribed', sessionId: s.sessionId, lastSeq: log.length - 1 } })
          // Post-subscribe projection baseline (host parallel: recomputed unit values ride push frames).
          const values = projectionValuesOf(log)
          for (const key of Object.keys(values)) {
            conn.push({ rpcId: mint(), payload: { type: 'session/projection', sessionId: s.sessionId, key, value: values[key], seq: log.length - 1 } })
          }
        }
        if (approvalPending) {
          conn.push({
            rpcId: pendingApprovalRpcId,
            payload: {
              type: 'approval/requested', sessionId: sid('fx-alpha'),
              approvalId: pendingApprovalId,
              toolName: 'dangerous_tool', reason: 'fixture 常驻审批（可答：批准/拒绝后消失）',
            },
          })
        }
        if (questionPending) {
          conn.push({
            rpcId: pendingQuestionRpcId,
            payload: {
              type: 'question/requested', sessionId: sid('fx-alpha'), questions: fixtureQuestions,
            },
          })
        }
        try {
          yield* conn.drain(signal)
        } finally {
          streamBreakers.delete(breakNow)
          muxConns.delete(conn)
        }
      },
      async *host(_request, signal) {
        const conn = new FxInbox<HostFrame>()
        hostConns.add(conn)
        const breakNow = (): void => { conn.breakNow() }
        streamBreakers.add(breakNow)
        // Periodic material (the RPC-panel acceptance's clear-then-new-frames step depends on it): flip fx-gamma every 5s.
        // fx-gamma only: never touch fx-alpha's running semantics (the conversation replay drives that).
        const timer = setInterval(() => {
          const gamma = summaryOf(sid('fx-gamma'))
          /* v8 ignore next -- the undefined arm needs fx-gamma deleted, but the fixture never removes sessions. */
          if (gamma !== undefined) setRunning(gamma.sessionId, !gamma.running)
        }, 5000)
        try {
          yield* conn.drain(signal)
        } finally {
          clearInterval(timer)
          streamBreakers.delete(breakNow)
          hostConns.delete(conn)
        }
      },
    },
    settings: {
      // The DeepSeek provider profile and the welcome-notice acknowledgement
      // are represented here; the former carries a real schemastery envelope
      // so the official Models editor can rehydrate and write it back. Other
      // journeys keep their minimal readiness descriptor.
      describe: async (request) => {
        await seedSettings()
        return ok(request, {
          writable: true,
          hasDocument: true,
          namespaces: [{
            ns: LLM_DEEPSEEK_NS,
            schema: LLM_DEEPSEEK_SCHEMA,
            value: structuredClone(llmDeepseekUser),
            user: { ...llmDeepseekUser },
            applies: 'live',
            secrets: [{ path: ['apiKey'], set: false }],
            revision: llmDeepseekRevision,
          }, {
            ns: 'llm-pi-ai',
            schema: LLM_PI_AI_SCHEMA,
            value: structuredClone(llmPiAiUser),
            user: structuredClone(llmPiAiUser),
            applies: 'live',
            secrets: [],
            revision: llmPiAiRevision,
          }, {
            ns: AGENT_PRESET_SETTINGS_NS,
            schema: { type: 'object', dict: { default: { type: 'string' } } },
            value: { default: fixtureDefaultPreset },
            user: { default: fixtureDefaultPreset },
            applies: 'live',
            secrets: [],
            revision: 0,
          }, {
            ns: SHELL_SETTINGS_NS,
            schema: SHELL_SETTINGS_SCHEMA,
            value: { ...shellSettings },
            user: {},
            applies: 'live',
            secrets: [],
            revision: 0,
          }, {
            ns: AGENT_LOOP_SETTINGS_NS,
            schema: AGENT_LOOP_SETTINGS_SCHEMA,
            value: { ...agentLoopSettings },
            user: {},
            applies: 'live',
            secrets: [],
            revision: 0,
          }, {
            ns: WEB_SEARCH_SETTINGS_NS,
            schema: WEB_SEARCH_SETTINGS_SCHEMA,
            value: { ...webSearchSettings },
            user: {},
            applies: 'live',
            secrets: [],
            revision: 0,
          }, {
            ns: PROXY_SETTINGS_NS,
            schema: { type: 'object', dict: { url: { type: 'string' } } },
            value: proxyUrl === undefined ? {} : { url: proxyUrl },
            user: proxyUrl === undefined ? {} : { url: proxyUrl },
            applies: 'live',
            secrets: [],
            revision: proxyRevision,
          }, {
            ns: WELCOME_NOTICE_NS,
            schema: {},
            value: { [WELCOME_NOTICE_ACK_FIELD]: fixtureWelcomeAck },
            applies: 'live',
            secrets: [],
            revision: 0,
          }, {
            ns: PERMISSION_NS,
            schema: PERMISSION_SCHEMA,
            value: { defaultPreset: permissionDefault },
            user: { defaultPreset: permissionDefault },
            applies: 'live',
            secrets: [],
            revision: 0,
          }, {
            ns: AGENT_SETTINGS_NS,
            schema: AGENT_SETTINGS_SCHEMA,
            value: { systemPrompt: agentSystemPrompt },
            user: { systemPrompt: agentSystemPrompt },
            applies: 'live',
            secrets: [],
            revision: agentSettingsRevision,
          }],
        })
      },
      // Open the settings document. Under Tauri the fixture surfaces the real
      // app-config directory through the Rust shell_spawn (start <config dir>);
      // outside Tauri (browser dev) it is a deterministic no-op success.
      openDocument: async (request) => {
        const invoke = tauriInvoke()
        if (invoke !== undefined) {
          try {
            // The settings panel's 打开配置文件 opens ~/.dsh (the DSH CLI home),
            // not the Tauri app dir.
            const dir = await invoke<string>('dsh_config_dir')
            await invoke('shell_spawn', { spec: { program: 'cmd', args: ['/c', 'start', '', dir] } })
          } catch (error) {
            return err(request, {
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
              details: {},
            })
          }
        }
        return ok(request, { opened: true as const })
      },
      update: (request) => {
        // The default agent preset: the General settings picker writes it via
        // settings.update (ui-agent-preset's writeDefaultPreset), not mutate.
        if (request.payload.ns === AGENT_PRESET_SETTINGS_NS) {
          const patch = request.payload.patch as { default?: unknown } | undefined
          const next = patch?.default
          if (typeof next === 'string' && next.length > 0) fixtureDefaultPreset = next
          persistSettings(AGENT_PRESET_SETTINGS_NS, { default: fixtureDefaultPreset })
          return ok(request, {
            ns: AGENT_PRESET_SETTINGS_NS,
            schema: { type: 'object', dict: { default: { type: 'string' } } },
            value: { default: fixtureDefaultPreset },
            user: { default: fixtureDefaultPreset },
            applies: 'live',
            secrets: [],
            revision: 0,
          })
        }
        return err(request, {
          code: 'settings-rejected',
          message: 'fixture: the minimal readiness settings descriptor is read-only',
          details: { ns: request.payload.ns },
        })
      },
      replace: request => err(request, {
        code: 'settings-rejected',
        message: 'fixture: the minimal readiness settings descriptor is read-only',
        details: { ns: request.payload.ns },
      }),
      mutate: (request) => {
        if (request.payload.ns === LLM_DEEPSEEK_NS) {
          // Apply the patch into the user layer (validate-free: the editor's
          // schema-rehydrated draft already validated), bump the revision.
          const next: Record<string, unknown> = structuredClone(llmDeepseekUser)
          for (const op of request.payload.ops) {
            if (op.op === 'set') {
              setPath(next, op.path, op.value)
            } else if (op.op === 'unset') {
              deletePath(next, op.path)
            }
          }
          llmDeepseekUser = next
          llmDeepseekRevision += 1
          void persistSettings(LLM_DEEPSEEK_NS, next)
          return ok(request, {
            ns: LLM_DEEPSEEK_NS,
            schema: LLM_DEEPSEEK_SCHEMA,
            value: structuredClone(llmDeepseekUser),
            user: { ...llmDeepseekUser },
            applies: 'live',
            secrets: [{ path: ['apiKey'], set: false }],
            revision: llmDeepseekRevision,
          })
        }
        if (request.payload.ns === 'llm-pi-ai') {
          // Custom provider profiles (the Models add card saves here). Apply the
          // patch into the user layer and persist to ~/.dsh when under Tauri.
          const next: Record<string, unknown> = structuredClone(llmPiAiUser)
          for (const op of request.payload.ops) {
            if (op.op === 'set') setPath(next, op.path, op.value)
            else if (op.op === 'unset') deletePath(next, op.path)
          }
          llmPiAiUser = next
          llmPiAiRevision += 1
          void persistSettings('llm-pi-ai', next)
          return ok(request, {
            ns: 'llm-pi-ai',
            schema: LLM_PI_AI_SCHEMA,
            value: structuredClone(next),
            user: structuredClone(next),
            applies: 'live',
            secrets: [],
            revision: llmPiAiRevision,
          })
        }
        if (request.payload.ns === PROXY_SETTINGS_NS) {
          for (const op of request.payload.ops) {
            if (op.op === 'set' && op.path[0] === 'url' && typeof op.value === 'string') {
              proxyUrl = op.value
            } else if (op.op === 'unset' && op.path[0] === 'url') {
              proxyUrl = undefined
            }
          }
          proxyRevision += 1
          // Live-apply the proxy to the Tauri reqwest client and persist it so
          // the real-LLM HTTP path (and the next launch) honor the setting.
          const invoke = tauriInvoke()
          if (invoke !== undefined) {
            void invoke('http_set_proxy', { url: proxyUrl ?? null })
          }
          persistSettings(PROXY_SETTINGS_NS, proxyUrl === undefined ? {} : { url: proxyUrl })
          return ok(request, {
            ns: PROXY_SETTINGS_NS,
            schema: { type: 'object', dict: { url: { type: 'string' } } },
            value: proxyUrl === undefined ? {} : { url: proxyUrl },
            user: proxyUrl === undefined ? {} : { url: proxyUrl },
            applies: 'live',
            secrets: [],
            revision: proxyRevision,
          })
        }
        // The configurable-plugin card namespaces (ui-settings-plugins): apply
        // the card's staged set/unset into the namespace value so saving works.
        if (request.payload.ns === SHELL_SETTINGS_NS
          || request.payload.ns === AGENT_LOOP_SETTINGS_NS
          || request.payload.ns === WEB_SEARCH_SETTINGS_NS) {
          const current = request.payload.ns === SHELL_SETTINGS_NS
            ? shellSettings
            : request.payload.ns === AGENT_LOOP_SETTINGS_NS
              ? agentLoopSettings
              : webSearchSettings
          for (const op of request.payload.ops) {
            if (op.op === 'set' && op.path.length === 1) {
              current[op.path[0] as string] = op.value
            } else if (op.op === 'unset' && op.path.length === 1) {
              Reflect.deleteProperty(current, op.path[0] as string)
            }
          }
          return ok(request, {
            ns: request.payload.ns,
            schema: request.payload.ns === SHELL_SETTINGS_NS
              ? SHELL_SETTINGS_SCHEMA
              : request.payload.ns === AGENT_LOOP_SETTINGS_NS
                ? AGENT_LOOP_SETTINGS_SCHEMA
                : WEB_SEARCH_SETTINGS_SCHEMA,
            value: { ...current },
            user: { ...current },
            applies: 'live',
            secrets: [],
            revision: 1,
          })
        }
        if (request.payload.ns === WELCOME_NOTICE_NS) {
          for (const op of request.payload.ops) {
            if (op.op === 'set' && op.path[0] === WELCOME_NOTICE_ACK_FIELD && typeof op.value === 'string') {
              fixtureWelcomeAck = op.value
            }
          }
          return ok(request, {
            ns: WELCOME_NOTICE_NS,
            schema: {},
            value: { [WELCOME_NOTICE_ACK_FIELD]: fixtureWelcomeAck },
            applies: 'live',
            secrets: [],
            revision: 0,
          })
        }
        if (request.payload.ns === PERMISSION_NS) {
          for (const op of request.payload.ops) {
            if (op.op === 'set' && op.path[0] === 'defaultPreset' && typeof op.value === 'string'
              && op.value in PERMISSION_PRESETS) {
              permissionDefault = op.value
            }
          }
          persistSettings(PERMISSION_NS, { defaultPreset: permissionDefault })
          return ok(request, {
            ns: PERMISSION_NS,
            schema: PERMISSION_SCHEMA,
            value: { defaultPreset: permissionDefault },
            user: { defaultPreset: permissionDefault },
            applies: 'live',
            secrets: [],
            revision: 1,
          })
        }
        if (request.payload.ns === AGENT_SETTINGS_NS) {
          for (const op of request.payload.ops) {
            if (op.op === 'set' && op.path[0] === 'systemPrompt' && typeof op.value === 'string' && op.value.length > 0) {
              agentSystemPrompt = op.value
            }
          }
          agentSettingsRevision += 1
          persistSettings(AGENT_SETTINGS_NS, { systemPrompt: agentSystemPrompt })
          return ok(request, {
            ns: AGENT_SETTINGS_NS,
            schema: AGENT_SETTINGS_SCHEMA,
            value: { systemPrompt: agentSystemPrompt },
            user: { systemPrompt: agentSystemPrompt },
            applies: 'live',
            secrets: [],
            revision: agentSettingsRevision,
          })
        }
        // Generic namespace fallback: accept any namespace the app writes
        // (ui-theme, ui-conversation, agent-default-model, …) into an
        // in-memory map and persist it to ~/.dsh under Tauri, so the
        // client-first shell never hard-fails a settings save.
        {
          const current: Record<string, unknown> = genericSettings.get(request.payload.ns) ?? {}
          for (const op of request.payload.ops) {
            if (op.op === 'set') setPath(current, op.path, op.value)
            else if (op.op === 'unset') deletePath(current, op.path)
          }
          genericSettings.set(request.payload.ns, current)
          persistSettings(request.payload.ns, current)
          return ok(request, {
            ns: request.payload.ns,
            schema: { type: 'object', dict: {} },
            value: { ...current },
            user: { ...current },
            applies: 'live',
            secrets: [],
            revision: 0,
          })
        }
      },
    },
    credentials: {
      describe: async (request) => {
        const entries: Record<string, { configured: boolean; source?: string; writable: boolean }> = {}
        for (const ref of request.payload.refs) {
          const value = options.realLlm ? await readRealCredential(ref) : (fixtureCredentials.has(ref) ? 'fixture-key' : null)
          entries[ref] = {
            configured: value !== null,
            ...(value !== null ? { source: 'file' } : {}),
            writable: true,
          }
        }
        return ok(request, { credentials: entries })
      },
      set: async (request) => {
        if (options.realLlm && typeof request.payload.value === 'string') {
          if (tauriCreds !== undefined) {
            await tauriCreds.set(request.payload.ref, request.payload.value)
          }
          realCredentialValues.set(request.payload.ref, request.payload.value)
          persistRealCredentials()
        } else {
          fixtureCredentials.set(request.payload.ref, true)
        }
        return ok(request, {})
      },
      unset: async (request) => {
        if (options.realLlm) {
          if (tauriCreds !== undefined) {
            await tauriCreds.delete(request.payload.ref)
          }
          realCredentialValues.delete(request.payload.ref)
          persistRealCredentials()
        }
        fixtureCredentials.delete(request.payload.ref)
        return ok(request, {})
      },
      // Fixture reveal: nothing real, but unconfigured references return null
      // so the Models editor can render the same "no stored value" branch it
      // would in production. Real mode returns the stored secret (the Models
      // editor only ever shows a "stored"/"unset" badge, never the value).
      reveal: async (request) => {
        if (!options.realLlm) {
          return ok(request, { value: fixtureCredentials.has(request.payload.ref) ? 'fixture-key' : null })
        }
        return ok(request, { value: await readRealCredential(request.payload.ref) })
      },
    },
    llm: {
      providers: request => ok(request, {
        // The mainstream vendor catalog. Each route carries the adapter's
        // default endpoint (ConfigurableProviderView.baseUrl) so the Models
        // editor pre-fills the API 地址 field; all non-DeepSeek routes live
        // under the generic llm-pi-ai providers dict and are addable/removable.
        providers: DECLARED_PROVIDERS.map(({ provider, displayName, settingsNs, settingsPath, baseUrl }) => ({
          provider,
          displayName,
          settingsNs,
          settingsPath,
          active: true,
          baseUrl,
          ...(provider === 'acme-gateway' ? { declared: true } : { declared: false }),
        })),
      }),
      models: request => ok(request, { groups: fixtureModelGroups(), failures: [] }),
      // The fixture endpoint is imaginary, so the interrogation answers the
      // catalog it already serves — enough for a surface to exercise adopting
      // candidates without a reachable provider.
      discoverModels: async (request) => {
        // Fetch the provider's real model list from its official endpoint.
        // The editor passes the typed URL/key, but on a SAVED provider the key
        // lives in the credential store (apiKeyEnv ref) and the form field is
        // empty — derive both from the saved profile in that case.
        const { settingsNs, provider, baseURL: passedBase, api: passedApi, apiKey: passedKey } = request.payload as {
          settingsNs?: string
          provider?: string
          baseURL?: string
          api?: string
          apiKey?: string
        }
        const profiles = (settingsNs === LLM_DEEPSEEK_NS ? llmDeepseekUser : llmPiAiUser).providers as
          Record<string, { baseURL?: unknown; api?: unknown; apiKeyEnv?: unknown }> | undefined
        const profile = provider === undefined ? undefined : profiles?.[provider]
        const baseURL = passedBase !== undefined && passedBase.length > 0
          ? passedBase
          : (typeof profile?.baseURL === 'string' && profile.baseURL.length > 0
            ? profile.baseURL
            : declaredProviderBaseUrl(provider ?? ''))
        const api = passedApi ?? (typeof profile?.api === 'string' ? profile.api : undefined) ?? 'openai-completions'
        let apiKey = passedKey ?? ''
        if (apiKey.length === 0 && typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0) {
          const stored = await readRealCredential(profile.apiKeyEnv)
          if (stored !== null) apiKey = stored
        }
        if (baseURL === undefined || baseURL.length === 0) {
          return err(request, { code: 'internal', message: 'API 地址未配置，请先在提供方设置里填写', details: {} })
        }
        try {
          const models = await fetchProviderModels(baseURL, api, apiKey)
          return ok(request, { models })
        } catch (error) {
          return err(request, {
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
            details: {},
          })
        }
      },
    },
    usage: {
      query: request => ok(request, {
        totals: { consumption: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheHitRate: null },
        series: [],
        byDate: [],
        providers: [],
      }),
    },
    respond(message: ClientResponse): Promise<RpcReceipt> {
      // Same routing discipline as the host: rpcId first, then the payload's
      // audit correlation; a settled or unknown id is not-pending.
      if (message.rpcId === pendingApprovalRpcId) {
        if (!approvalPending) return Promise.resolve({ accepted: false, reason: 'not-pending' })
        if (!message.result.ok) return Promise.resolve({ accepted: false, reason: 'bad-response' })
        const value = message.result.value as { approvalId?: unknown; outcome?: unknown }
        if (value.approvalId !== pendingApprovalId || (value.outcome !== 'allowed-once' && value.outcome !== 'rejected')) {
          return Promise.resolve({ accepted: false, reason: 'bad-response' })
        }
        approvalPending = false
        emitMux({ type: 'approval/resolved', sessionId: sid('fx-alpha'), approvalId: pendingApprovalId, outcome: value.outcome })
        return Promise.resolve({ accepted: true })
      }
      if (!questionPending || message.rpcId !== pendingQuestionRpcId) {
        return Promise.resolve({ accepted: false, reason: 'not-pending' })
      }
      questionPending = false
      emitMux({
        type: 'question/resolved', sessionId: sid('fx-alpha'),
        questionRpcId: pendingQuestionRpcId,
        outcome: message.result.ok ? 'answered' : 'cancelled',
      })
      return Promise.resolve({ accepted: true })
    },
    // Satisfies the ApiProxy contract type only: the browser export button
    // hands GET /api/session.export to the native download manager, so this
    // stub is never reached through the fixture's dispatch.
    downloads: {
      sessionLog: () => Promise.resolve(new Response('fixture mode does not serve session export', { status: 404 })),
    },
  }

  // In-memory message-feedback store (the 点赞/点踩 system). Real host keeps a
  // durable sidecar; the fixture answers list/put/delete with CAS semantics.
  type FeedbackItem = { messageId: string; rating: string; note?: string; version: string }
  const feedbackStore = new Map<string, Map<string, FeedbackItem>>()
  const feedbackVersion = (): string => randomUuid()

  // Skill / MCP inventories (the 技能管理 / MCP 管理 sections). Under Tauri the
  // skill list reads real ~/.dsh/skills + ~/.agents/skills directories through
  // the fs bridge; the curated defaults below are the no-bridge fallback that
  // mirrors the client's shipped capabilities.
  const fixtureSkills = [
    { entryId: 'shell', name: 'Shell', description: '在受控范围内执行 shell 命令', source: 'builtin', provider: 'dsh', modelInvocable: true, userInvocable: true, enabled: true },
    { entryId: 'web-search', name: 'Web Search', description: '联网搜索并返回结构化证据', source: 'builtin', provider: 'dsh', modelInvocable: true, userInvocable: true, enabled: true },
    { entryId: 'agent-loop', name: 'Agent Loop', description: '编排工具调用与任务规划的智能体循环', source: 'builtin', provider: 'dsh', modelInvocable: true, userInvocable: false, enabled: true },
  ]
  const skillEnabled = new Map<string, boolean>()
  const mcpEnabled = new Map<string, boolean>()
  /** Persistence namespace for skill enable/disable (`{ enabled: { [id]: boolean } }`). */
  const SKILL_INVENTORY_NS = 'skill-inventory'
  /** Persistence namespace for MCP servers (`{ servers: { [id]: McpServerSpec }, enabled: { [id]: boolean } }`). */
  const MCP_INVENTORY_NS = 'mcp-inventory'
  /** One persisted MCP server spec; kept exact to the ui-settings-mcp store type. */
  type FixtureMcpSpec =
    | { transport: 'stdio'; serverName: string; command: string; args: string[]; env: Record<string, string>; cwd: string }
    | { transport: 'streamable-http'; serverName: string; url: string; headers: Record<string, string> }
  /** The persisted servers map (seeded once from settings_get, mutated on upsert/delete). */
  const mcpServers = new Map<string, FixtureMcpSpec>()
  /** Stable entry id derived from a server name (slug); the tab and the fixture agree on it. */
  const mcpServerId = (serverName: string): string => {
    const slug = serverName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return slug.length > 0 ? slug : 'mcp'
  }
  /** Structural guard for an untrusted settings_get `mcp-inventory` server value. */
  const isFixtureMcpSpec = (value: unknown): value is FixtureMcpSpec => {
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    if (typeof record.serverName !== 'string' || typeof record.transport !== 'string') return false
    if (record.transport === 'stdio') {
      return typeof record.command === 'string'
        && Array.isArray(record.args)
        && typeof record.env === 'object' && record.env !== null
        && typeof record.cwd === 'string'
    }
    if (record.transport === 'streamable-http') {
      return typeof record.url === 'string'
        && typeof record.headers === 'object' && record.headers !== null
    }
    return false
  }
  /** Project one persisted `[id, spec]` pair into a list entry (`target` = command 首词 or url). */
  const projectMcpEntry = ([entryId, spec]: [string, FixtureMcpSpec]): {
    entryId: string
    serverName: string
    transport: string
    target: string
    enabled: boolean
    spec: FixtureMcpSpec
  } => ({
    entryId,
    serverName: spec.serverName,
    transport: spec.transport,
    target: spec.transport === 'stdio' ? spec.command.split(/\s+/)[0] ?? '' : spec.url,
    enabled: mcpEnabled.get(entryId) ?? true,
    spec,
  })
  /** Persist the current servers + enabled maps to the `mcp-inventory` namespace. */
  const persistMcpInventory = (): void => {
    persistSettings(MCP_INVENTORY_NS, {
      servers: Object.fromEntries(mcpServers),
      enabled: Object.fromEntries(mcpEnabled),
    })
  }
  /** Project one skill directory (a folder holding SKILL.md) into an entry. */
  const readSkillDir = async (
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    dir: string,
    source: 'user-dsh' | 'user-agents',
  ): Promise<Array<Record<string, unknown>>> => {
    let listing: Array<{ name: string; is_dir: boolean; size: number }>
    try {
      listing = await invoke<Array<{ name: string; is_dir: boolean; size: number }>>('fs_list', { dir })
    } catch {
      return [] // FsPermissionDenied / unreadable → skip this root silently.
    }
    const entries: Array<Record<string, unknown>> = []
    for (const item of listing ?? []) {
      if (!item.is_dir) continue
      const entryId = item.name
      let markdown = ''
      try {
        const bytes = await invoke<number[]>('fs_read', { path: `${dir}/${entryId}/SKILL.md` })
        markdown = new TextDecoder().decode(new Uint8Array(bytes))
      } catch {
        continue // No SKILL.md → not a skill.
      }
      const fm = parseSkillFrontmatter(markdown)
      entries.push({
        entryId,
        name: fm.name ?? entryId,
        description: fm.description ?? '',
        ...(fm.whenToUse !== undefined ? { whenToUse: fm.whenToUse } : {}),
        source,
        provider: 'dsh',
        modelInvocable: true,
        userInvocable: true,
        enabled: skillEnabled.get(entryId) ?? true,
      })
    }
    return entries
  }

  const rpc: ClientConnectionRpc = {
    async call(channel, endpoint, payload) {
      if (channel !== '/api') {
        return Promise.reject(new Error(`fixture connection RPC channel ${JSON.stringify(channel)} is unavailable`))
      }
      const args = (payload as {
        args: {
          agentId: SessionId
          line?: string
          ref?: { id: string; revision: number }
          request?: { objective?: string; maxGoalRounds?: number }
        }
      }).args
      const sessionId = args.agentId
      switch (endpoint) {
        case 'commands/list': return Promise.resolve(commandRemotes.list(sessionId))
        case 'commands/execute': return Promise.resolve(commandRemotes.execute(sessionId, args.line as string))
        case 'goals/create': return Promise.resolve(goalRemotes.create(sessionId, {
          objective: args.request?.objective as string,
          ...args.request?.maxGoalRounds === undefined ? {} : { maxGoalRounds: args.request.maxGoalRounds },
        }))
        case 'goals/edit': return Promise.resolve(goalRemotes.edit(sessionId, args.ref as FxGoalRef, args.request ?? {}))
        case 'goals/pause': return Promise.resolve(goalRemotes.pause(sessionId, args.ref as FxGoalRef))
        case 'goals/resume': return Promise.resolve(goalRemotes.resume(sessionId, args.ref as FxGoalRef))
        case 'goals/complete': return Promise.resolve(goalRemotes.complete(sessionId, args.ref as FxGoalRef))
        case 'goals/clear': return Promise.resolve(goalRemotes.clear(sessionId, args.ref as FxGoalRef))
        case 'messageFeedback/list': {
          const sessionId = (args as { sessionId?: string }).sessionId ?? args.agentId
          const items = [...(feedbackStore.get(sessionId) ?? new Map()).values()]
          return Promise.resolve({ ok: true, value: { ok: true as const, value: { items } } })
        }
        case 'messageFeedback/put': {
          const req = args as { sessionId?: string; messageId?: string; rating?: string; note?: string; ifVersion?: string | null }
          const sessionId = req.sessionId ?? args.agentId
          const messageId = req.messageId ?? ''
          const map = feedbackStore.get(sessionId) ?? new Map()
          const existing = map.get(messageId)
          if (existing !== undefined && existing.version !== req.ifVersion) {
            return Promise.resolve({ ok: true, value: { ok: false as const, error: { code: 'version-conflict', current: existing } } })
          }
          const item: FeedbackItem = {
            messageId,
            rating: req.rating ?? 'positive',
            ...(req.note === undefined ? {} : { note: req.note }),
            version: feedbackVersion(),
          }
          map.set(messageId, item)
          feedbackStore.set(sessionId, map)
          return Promise.resolve({ ok: true, value: { ok: true as const, value: item } })
        }
        case 'messageFeedback/delete': {
          const req = args as { sessionId?: string; messageId?: string; ifVersion?: string | null }
          const sessionId = req.sessionId ?? args.agentId
          const map = feedbackStore.get(sessionId)
          const existing = map?.get(req.messageId ?? '')
          if (existing !== undefined && existing.version !== req.ifVersion) {
            return Promise.resolve({ ok: true, value: { ok: false as const, error: { code: 'version-conflict', current: existing } } })
          }
          map?.delete(req.messageId ?? '')
          return Promise.resolve({ ok: true, value: { ok: true as const, value: null } })
        }
        case 'skillInventory/list': {
          const invoke = tauriInvoke()
          if (invoke === undefined) {
            const entries = fixtureSkills.map(skill => ({ ...skill, enabled: skillEnabled.get(skill.entryId) ?? skill.enabled }))
            return Promise.resolve({ ok: true, value: { entries } })
          }
          // Real mode: resolve ~/.dsh first, then read the ABSOLUTE
          // ~/.dsh/skills path (the fs allowlist now permits reads under
          // dsh_home) + best-effort ~/.agents/skills (a sibling of dsh_home
          // that stays outside the allowlist; a permission error is
          // tolerated). Seed first so the persisted `enabled` overlay is
          // applied to the projected entries.
          await seedSettings()
          const entries: Array<Record<string, unknown>> = []
          try {
            const dshHome = await invoke<string>('dsh_config_dir')
            if (typeof dshHome === 'string' && dshHome.length > 0) {
              const home = homeFromDshConfigDir(dshHome)
              if (home.length > 0) {
                entries.push(...await readSkillDir(invoke, `${home}/.dsh/skills`, 'user-dsh'))
                entries.push(...await readSkillDir(invoke, `${home}/.agents/skills`, 'user-agents'))
              }
            }
          } catch {
            // dsh_config_dir unavailable → no roots; keep the empty list.
          }
          // Real-mode fallback: when the real read yields nothing AND the user
          // has not persisted any skill toggles, surface the curated defaults
          // so an empty (or unreadable) ~/.dsh does not render a blank
          // 技能管理 panel. Persisted toggles are respected — once the user has
          // configured the inventory, the real (possibly empty) result stands.
          if (entries.length === 0 && skillEnabled.size === 0) {
            entries.push(...fixtureSkills.map(skill => ({ ...skill, enabled: skill.enabled })))
          }
          return Promise.resolve({ ok: true, value: { entries } })
        }
        case 'skillInventory/setEnabled': {
          const entry = (args as { entry?: { entryId?: string; enabled?: boolean } }).entry
          if (entry?.entryId !== undefined) {
            skillEnabled.set(entry.entryId, entry.enabled === true)
            persistSettings(SKILL_INVENTORY_NS, { enabled: Object.fromEntries(skillEnabled) })
          }
          return Promise.resolve({ ok: true, value: {} })
        }
        case 'skillRegistry/search': {
          const query = (args as { query?: unknown }).query
          if (typeof query !== 'string' || query.trim().length === 0) {
            return Promise.resolve({ ok: true, value: { skills: [] } })
          }
          const invoke = tauriInvoke()
          if (invoke === undefined) {
            // Browser / no bridge: no registry reachable; the local filter still works.
            return Promise.resolve({ ok: true, value: { skills: [] } })
          }
          const url = `https://skills.sh/api/search?q=${encodeURIComponent(query.trim())}&limit=20`
          const res = await invoke<{ status: number; body: number[] }>('http_request', {
            req: { method: 'GET', url, headers: {}, timeout_ms: 30_000 },
          })
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`skillRegistry/search: HTTP ${res.status}`)
          }
          const text = new TextDecoder().decode(new Uint8Array(res.body))
          const data = JSON.parse(text) as { skills?: Array<Record<string, unknown>> }
          const skills = Array.isArray(data.skills) ? data.skills : []
          const projected = skills.flatMap((raw) => {
            const name = typeof raw?.name === 'string' ? raw.name : ''
            if (name === '') return []
            const description = typeof raw?.description === 'string' ? raw.description : ''
            const installs = typeof raw?.installs === 'number' ? raw.installs : 0
            const source = typeof raw?.source === 'string' && raw.source.length > 0
              ? raw.source
              : (typeof raw?.id === 'string' ? raw.id.split('/').slice(0, 2).join('/') : '')
            if (source === '') return []
            return [{ name, description, installs, source }]
          })
          return Promise.resolve({ ok: true, value: { skills: projected } })
        }
        case 'skillRegistry/installSkill': {
          const invoke = tauriInvoke()
          if (invoke === undefined) {
            return Promise.resolve({
              ok: false,
              error: { code: 'internal', message: 'skill install requires the desktop bridge', details: {} },
            })
          }
          const target = (args as { target?: { name?: unknown; source?: unknown } }).target
          const name = typeof target?.name === 'string' ? target.name.trim() : ''
          const source = typeof target?.source === 'string' ? target.source.trim() : ''
          if (name.length === 0 || source.length === 0) {
            return Promise.resolve({
              ok: false,
              error: { code: 'internal', message: 'skill install missing name or source', details: {} },
            })
          }
          const [owner, repo] = source.split('/')
          if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
            return Promise.resolve({
              ok: false,
              error: { code: 'internal', message: `skill install invalid source ${JSON.stringify(source)}`, details: {} },
            })
          }
          // Resolve ~/.dsh (the fs allowlist roots both the temp dir and the
          // destination, so a fresh ~/.dsh/skills/{name} is creatable).
          const dshHome = await invoke<string>('dsh_config_dir')
          if (typeof dshHome !== 'string' || dshHome.length === 0) {
            return Promise.resolve({
              ok: false,
              error: { code: 'internal', message: 'skill install could not resolve ~/.dsh', details: {} },
            })
          }
          const home = dshHome.replace(/[\\/]+$/, '')
          const dest = `${home}/skills/${name}`
          const tmpTar = `${home}/skills/.dsh-tmp/${name}/source.tar.gz`
          // 1. Download the repo tarball through the desktop proxy client.
          const res = await invoke<{ status: number; body: number[] }>('http_request', {
            req: { method: 'GET', url: `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`, headers: {}, timeout_ms: 120_000 },
          })
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`skillRegistry/installSkill: HTTP ${res.status}`)
          }
          // 2. Persist the bytes (fs_write creates the parent dirs under ~/.dsh).
          await invoke('fs_write', { path: tmpTar, content: res.body })
          // 3. Ensure the destination exists so tar's `-C` resolves.
          await invoke('fs_write', { path: `${dest}/SKILL.md`, content: [] })
          // 4. Extract, stripping the tarball's `{repo}-{sha}` top-level dir so
          //    the skill contents land directly in ~/.dsh/skills/{name}.
          //    The shell whitelist gate is an exact string match, so Windows
          //    requires `tar.exe` (bare `tar` is rejected with PermissionDenied).
          await invoke('shell_spawn', {
            spec: {
              cmd: isWindowsHost() ? 'tar.exe' : 'tar',
              args: ['-xzf', tmpTar, '-C', dest, '--strip-components=1'],
              env: {},
            },
          })
          return Promise.resolve({ ok: true, value: { ok: true as const } })
        }
        case 'mcpInventory/list': {
          // Seed once so the persisted `mcp-inventory` namespace is applied,
          // then project the persisted servers (the source of truth). The
          // no-bridge browser path is identical to the Tauri path: settings_get
          // is a no-op without the bridge, so mcpServers holds only what the
          // session mutated in memory.
          await seedSettings()
          const entries = [...mcpServers.entries()].map(projectMcpEntry)
          return Promise.resolve({ ok: true, value: { entries } })
        }
        case 'mcpInventory/setEnabled': {
          const entry = (args as { entry?: { entryId?: string; enabled?: boolean } }).entry
          if (entry?.entryId !== undefined) {
            mcpEnabled.set(entry.entryId, entry.enabled === true)
            persistMcpInventory()
          }
          return Promise.resolve({ ok: true, value: {} })
        }
        case 'mcpInventory/upsertServer': {
          const spec = (args as { spec?: unknown }).spec
          if (isFixtureMcpSpec(spec) && spec.serverName.trim().length > 0) {
            const entryId = mcpServerId(spec.serverName)
            mcpServers.set(entryId, spec)
            if (!mcpEnabled.has(entryId)) mcpEnabled.set(entryId, true)
            persistMcpInventory()
          }
          return Promise.resolve({ ok: true, value: {} })
        }
        case 'mcpInventory/deleteServer': {
          const entryId = (args as { entry?: { entryId?: string } }).entry?.entryId
          if (typeof entryId === 'string' && entryId.length > 0) {
            mcpServers.delete(entryId)
            mcpEnabled.delete(entryId)
            persistMcpInventory()
          }
          return Promise.resolve({ ok: true, value: {} })
        }
        case 'mcpRegistry/search': {
          // Smithery registry search (Task 5): GET the public servers API through
          // the desktop proxy and project the fields the 从 Smithery 搜索 section
          // renders. Install is a UI-side conversion into an McpServerSpec that
          // reuses the existing `mcpInventory/upsertServer` path — no install RPC.
          const query = (args as { query?: unknown }).query
          if (typeof query !== 'string' || query.trim().length === 0) {
            return Promise.resolve({ ok: true, value: { servers: [] } })
          }
          const invoke = tauriInvoke()
          if (invoke === undefined) {
            // Browser / no bridge: no registry reachable; the local list still works.
            return Promise.resolve({ ok: true, value: { servers: [] } })
          }
          const url = `https://api.smithery.ai/servers?q=${encodeURIComponent(query.trim())}&limit=20`
          const res = await invoke<{ status: number; body: number[] }>('http_request', {
            req: { method: 'GET', url, headers: {}, timeout_ms: 30_000 },
          })
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`mcpRegistry/search: HTTP ${res.status}`)
          }
          const text = new TextDecoder().decode(new Uint8Array(res.body))
          const data = JSON.parse(text) as { servers?: Array<Record<string, unknown>> }
          const servers = Array.isArray(data.servers) ? data.servers : []
          const projected = servers.flatMap((raw) => {
            const qualifiedName = typeof raw?.qualifiedName === 'string' ? raw.qualifiedName : ''
            const displayName = typeof raw?.displayName === 'string' ? raw.displayName : ''
            if (qualifiedName === '' || displayName === '') return []
            const description = typeof raw?.description === 'string' ? raw.description : ''
            const remote = raw?.remote === true
            const useCount = typeof raw?.useCount === 'number' ? raw.useCount : 0
            return [{ qualifiedName, displayName, description, remote, useCount }]
          })
          return Promise.resolve({ ok: true, value: { servers: projected } })
        }
        case 'pluginInventory/list': {
          // Prefer the live Loader graph; fall back to the stub table only when
          // the fixture is not running inside a client (unit tests, isolation).
          const live = realInventoryEntries()
          return Promise.resolve({ ok: true, value: { entries: live ?? fixturePluginEntries() } })
        }
        case 'pluginInventory/setEnabled': {
          const entry = (args as { entry?: { entryId?: string; enabled?: boolean } }).entry
          const entryId = entry?.entryId
          const enabled = entry?.enabled === true
          if (typeof entryId !== 'string') {
            return Promise.resolve({ ok: false, error: { code: 'internal', message: 'missing entry id', details: {} } })
          }
          // Shell-critical rows cannot be disabled — no switch is shown for them.
          if (SHELL_CRITICAL.has(entryId)) {
            return Promise.resolve({ ok: false, error: { code: 'internal', message: 'shell-critical plugin cannot be disabled', details: {} } })
          }
          const loader = ctx === undefined
            ? undefined
            : (ctx as { loader?: FixtureLoaderLike }).loader
          if (loader !== undefined) {
            // Entry ids are boot-generated; find the row by its module name.
            for (const row of loader.entries()) {
              if (row.options.name !== entryId) continue
              // Real enable/disable: restarts the fiber (stop or re-init).
              await row.update({ disabled: !enabled })
              return Promise.resolve({ ok: true, value: {} })
            }
          }
          // Stub path: record the intent only.
          pluginEnabled.set(entryId, enabled)
          return Promise.resolve({ ok: true, value: {} })
        }
        case 'pluginInventory/uninstall': {
          const entry = (args as { entry?: { entryId?: string } }).entry
          const entryId = entry?.entryId
          if (typeof entryId !== 'string') {
            return Promise.resolve({ ok: false, error: { code: 'internal', message: 'missing entry id', details: {} } })
          }
          const loader = ctx === undefined
            ? undefined
            : (ctx as { loader?: FixtureLoaderLike }).loader
          if (loader !== undefined) {
            // Entry ids are boot-generated; find the row by its module name and
            // remove it from the loader tree (disposes the fiber).
            for (const row of loader.entries()) {
              if (row.options.name !== entryId) continue
              await loader.remove(row.id)
              return Promise.resolve({ ok: true, value: {} })
            }
          }
          return Promise.resolve({ ok: false, error: { code: 'internal', message: `plugin not loaded: ${entryId}`, details: {} } })
        }
        default:
          return Promise.reject(new Error(`fixture connection RPC endpoint ${JSON.stringify(endpoint)} is unavailable`))
      }
    },
  }
  return { api, rpc }
}

/**
 * Fixture platform subclass: there is no HTTP at all, so instead of a doFetch transport it
 * overrides the protocol-level virtuals (callUnary/openMux/openHost/respond) to dispatch
 * straight into the in-memory ApiProxy — while still minting rpcIds, fabricating the four
 * named full forms, and feeding the same tap as a real carrier. TODO: delete when the fixture
 * moves to the isomorphic pipeline (InProcessApiClient over toFetchHandler(fixtureImpl)).
 */
export class FixtureApiClient extends AbstractApiClient {
  private readonly api: ApiProxy
  /** Generic Remote caller backed by the same in-memory state as the legacy fixture API. */
  readonly rpc: ClientConnectionRpc

  constructor(ctx?: Context) {
    super()
    const world = createFixtureWorld(fixtureOptionsFromLocation(), ctx)
    this.api = world.api
    this.rpc = world.rpc
  }

  protected doFetch(): Promise<Response> {
    throw new Error('FixtureApiClient overrides all protocol paths; doFetch must be unreachable')
  }

  protected override async callUnary<K extends keyof RpcMethodMap>(
    method: K,
    payload: RequestPayload<K>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<ResponseValue<K>>> {
    const request = rpcRequest(payload)
    const full: ClientRequest = { type: 'client-request', rpcId: request.rpcId, method, payload }
    this.onEnvelope(full)
    const response = await this.dispatch(
      method,
      request as RpcRequest<never>,
      signal ?? new AbortController().signal,
    ) as RpcResponse<ResponseValue<K>>
    const fullResponse: ServerResponse = { type: 'server-response', rpcId: response.rpcId, result: response.result }
    this.onEnvelope(fullResponse)
    return response
  }

  /** Method-key dispatch into the in-memory contract impl (a real carrier routes by URL path instead). */
  private dispatch(
    method: keyof RpcMethodMap,
    request: RpcRequest<never>,
    signal: AbortSignal,
  ): Promise<RpcResponse<unknown>> {
    switch (method) {
      case 'session.list': return this.api.sessions.list(request)
      case 'session.search': return this.api.sessions.search(request, signal)
      case 'session.create': return this.api.sessions.create(request)
      case 'session.history': return this.api.sessions.history(request)
      case 'session.models': return this.api.sessions.models(request)
      case 'session.selectModel': return this.api.sessions.selectModel(request)
      case 'session.rename': return this.api.sessions.rename(request)
      case 'session.fork': return this.api.sessions.fork(request)
      case 'session.prompt': return this.api.sessions.prompt(request)
      case 'session.attachment': return this.api.sessions.attachment(request)
      case 'session.updateQueue': return this.api.sessions.updateQueue(request)
      case 'session.cancel': return this.api.sessions.cancel(request)
      case 'subagent.list': return this.api.subagents.list(request)
      case 'subagent.history': return this.api.subagents.history(request)
      case 'subagent.prompt': return this.api.subagents.prompt(request, signal)
      case 'subagent.interrupt': return this.api.subagents.interrupt(request)
      case 'host.describe': return this.api.host.describe(request)
      case 'host.pickDirectory': return this.api.host.pickDirectory(request, new AbortController().signal)
      case 'host.listDirectory': return this.api.host.listDirectory(request, new AbortController().signal)
      case 'host.createDirectory': return this.api.host.createDirectory(request)
      case 'host.openPath': return this.api.host.openPath(request, new AbortController().signal)
      case 'host.testProxy': return this.api.host.testProxy(request, new AbortController().signal)
      case 'workspace.list': return this.api.workspace.list(request)
      case 'workspace.create': return this.api.workspace.create(request)
      case 'workspace.rename': return this.api.workspace.rename(request)
      case 'workspace.delete': return this.api.workspace.delete(request)
      case 'workspace.insertBefore': return this.api.workspace.insertBefore(request)
      case 'workspace.insertSessionBefore': return this.api.workspace.insertSessionBefore(request)
      case 'workspace.archiveSession': return this.api.workspace.archiveSession(request)
      case 'skill.list': return this.api.skills.list(request)
      case 'agentPreset.list': return this.api.agentPresets.list(request)
      case 'agentPreset.select': return this.api.agentPresets.select(request)
      case 'agentPreset.read': return this.api.agentPresets.read(request)
      case 'agentPreset.copy': return this.api.agentPresets.copy(request)
      case 'agentPreset.openDocument': return this.api.agentPresets.openDocument(request, new AbortController().signal)
      case 'agentPreset.remove': return this.api.agentPresets.remove(request)
      case 'goal.create': return this.api.goals.create(request)
      case 'goal.edit': return this.api.goals.edit(request)
      case 'goal.pause': return this.api.goals.pause(request)
      case 'goal.resume': return this.api.goals.resume(request)
      case 'goal.complete': return this.api.goals.complete(request)
      case 'goal.clear': return this.api.goals.clear(request)
      case 'settings.describe': return this.api.settings.describe(request)
      case 'settings.openDocument': return this.api.settings.openDocument(request, signal)
      case 'settings.update': return this.api.settings.update(request)
      case 'settings.replace': return this.api.settings.replace(request)
      case 'settings.mutate': return this.api.settings.mutate(request)
      case 'credentials.describe': return this.api.credentials.describe(request)
      case 'credentials.set': return this.api.credentials.set(request)
      case 'credentials.unset': return this.api.credentials.unset(request)
      case 'credentials.reveal': return this.api.credentials.reveal(request)
      case 'llm.providers': return this.api.llm.providers(request)
      case 'llm.models': return this.api.llm.models(request)
      case 'llm.discoverModels': return this.api.llm.discoverModels(request, signal)
      case 'usage.query': return this.api.usage.query(request)
    }
  }

  protected override openMux(
    payload: { since?: Record<SessionId, number> },
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.tapStream(this.api.events.mux(rpcRequest(payload), signal), onOpen)
  }

  protected override openHost(
    payload: Record<never, never>,
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.tapStream(this.api.events.host(rpcRequest(payload), signal), onOpen)
  }

  private async *tapStream<F extends MuxFrame | HostFrame>(
    stream: AsyncIterable<RpcRequest<F>>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    // No HTTP here: the in-memory stream is established the moment iteration starts (mirrors
    // readSse firing onOpen after response headers, before any frame).
    onOpen?.()
    for await (const envelope of stream) {
      const full: ServerRequest = { type: 'server-request', rpcId: envelope.rpcId, method: envelope.payload.type, payload: envelope.payload }
      this.onEnvelope(full)
      yield envelope
    }
  }

  /**
   * Deliver a client response to the in-memory contract impl (no HTTP POST),
   * echoing the envelope to the observation tap like every other path.
   * @param message - the client-response envelope answering a server request.
   * @returns the carrier receipt from the fixture impl.
   */
  override async respond(message: ClientResponse): Promise<RpcReceipt> {
    this.onEnvelope(message)
    return this.api.respond(message)
  }
}

/** Decode the `seed` query parameter into a seed descriptor, or undefined on malformed input. */
function parseSeedDescriptor(raw: string): FixtureSeedDescriptor | undefined {
  try {
    const value = JSON.parse(raw) as { sessions?: unknown; workspace?: unknown }
    if (value === null || typeof value !== 'object'
      || typeof value.sessions !== 'object' || value.sessions === null) {
      return undefined
    }
    return value as FixtureSeedDescriptor
  } catch {
    // Malformed seed query: boot the resident world (never crash the UI).
    return undefined
  }
}

/** Browser query mapping; direct unit callers pass FixtureOptions explicitly. */
function fixtureOptionsFromLocation(): FixtureOptions {
  if (typeof location === 'undefined') return {}
  const query = new URLSearchParams(location.search)
  // Under Tauri (dev and the installed build) the fixture must not fabricate
  // demo workspaces/sessions — the desktop starts from the real ~/.dsh state.
  const underTauri = typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis
  const seedRaw = query.get('seed')
  const seed = seedRaw === null ? undefined : parseSeedDescriptor(seedRaw)
  return {
    empty: query.get('fixture') === 'empty' || underTauri,
    rejectPrompt: query.get('fixturePrompt') === 'reject',
    failWorkspaceAttach: query.get('fixtureAttach') === 'fail',
    dropSessionCreateResponse: query.get('fixtureSessionCreate') === 'drop-response',
    createFrameOrder: query.get('fixtureFrames') === 'workspace-first' ? 'workspace-first' : 'session-first',
    // Real mode is opt-in (keyless lanes never set it): the fixture reaches a
    // real chat-completions endpoint. `llmUrl` overrides the base URL (tests /
    // self-hosted providers); the WebView2 shell sets both via the URL.
    realLlm: query.get('realLlm') === '1',
    ...(query.get('llmUrl') !== null ? { llmUrl: query.get('llmUrl') as string } : {}),
    ...(seed !== undefined ? { seed } : {}),
  }
}
