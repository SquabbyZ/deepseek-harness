import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import type { McpEntryId, McpInventoryEntry } from './inventory-store.ts'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  IconCheckOutline16,
  IconEditOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Label,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShadcnButton,
  ShadcnInput,
  SwitchRow,
  Toast,
  useDebouncedToggle,
  useDebouncedValue,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  type McpInventoryEntryView,
  type McpInventoryStore,
  type McpRegistrySearchResult,
  type McpServerSpec,
  type SmitheryServer,
  resolveSpawnCommand,
} from './inventory-store.ts'
import type { McpInventoryLocaleKey } from './locales.ts'
import { probeMcpServer, type ProbeResult, type ToolSummary } from './mcp-probe.ts'

export interface McpInventorySettingsTabInjected {
  list: () => Promise<{ entries: readonly McpInventoryEntry[] }>
  refresh: () => void
  store: McpInventoryStore
  setEnabled: (action: { entryId: string; enabled: boolean }, options: { signal: AbortSignal }) => Promise<void>
  /** Create or overwrite one server (id derived from serverName); the store re-reads after it settles. */
  upsertServer: (spec: McpServerSpec) => Promise<void>
  /** Remove one server by id; the store re-reads after it settles. */
  deleteServer: (entryId: string) => Promise<void>
  /** Search the Smithery registry for installable remote MCP servers; throws on RPC failure. */
  search: (query: string) => Promise<McpRegistrySearchResult>
  /** One-click install a Smithery server (remote → streamable-http, stdio → throws); throws on RPC failure. */
  installSmithery: (server: SmitheryServer) => Promise<void>
}

export type McpInventorySettingsTabProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly McpInventoryEntryView[] }

type Transport = 'stdio' | 'streamable-http'

const SECTION = 'flex w-full max-w-[760px] flex-col gap-[14px] text-foreground'
const STATUS = 'm-0 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
const FAILURE = 'flex items-center gap-2.5 text-[13px] leading-5 text-[var(--dsw-alias-state-error-primary)]'
const RETRY = 'h-auto rounded-md border-border bg-transparent px-2.5 py-1 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0'
const CATALOG = 'flex flex-col gap-3'
const CATALOG_HEADING = 'flex items-baseline gap-[7px] px-0.5'
const CATALOG_HEADING_H3 = 'm-0 text-[13px] leading-5 font-semibold'
const CATALOG_HEADING_COUNT = 'text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)] [font-variant-numeric:tabular-nums]'
const LIST = 'm-0 flex list-none flex-col gap-2 p-0'
const ROW_ACTION = 'inline-flex h-7 flex-none items-center gap-1 rounded-lg border-none px-2 text-[12px] leading-[18px] text-[var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-[var(--dsw-alias-label-primary)]'
const ROW_ACTION_DANGER = 'text-[var(--dsw-alias-state-error-primary)] hover:text-[var(--dsw-alias-state-error-primary)]'
const PROBE_OK = 'inline-flex h-7 flex-none items-center text-[12px] leading-[18px] text-[var(--dsw-alias-state-success-primary)]'
const PROBE_FAIL = 'inline-flex h-7 max-w-[260px] flex-none items-center gap-1 text-[12px] leading-[18px] text-[var(--dsw-alias-state-error-primary)]'
const PROBE_FAIL_TEXT = 'truncate'
const ADD_TOGGLE = 'self-start rounded-md border-border bg-transparent px-2.5 py-1.5 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground'
const FORM = 'flex flex-col gap-3 rounded-[10px] border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-alias-bg-layer-1)] p-3'
const FORM_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2'
const FORM_FIELD = 'flex min-w-0 flex-col gap-1'
const FORM_ACTIONS = 'flex items-center justify-end gap-2'
const FORM_ERROR = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-state-error-primary)]'
const FORM_NOTE = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const ENV_TEXTAREA =
  'min-h-[80px] w-full resize-y rounded-md border border-input bg-[var(--dsw-alias-bg-layer-1)] px-3 py-2 font-mono text-[12px] leading-[18px] text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const SELECT =
  'flex h-9 w-full rounded-md border border-input bg-[var(--dsw-alias-bg-layer-1)] px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [color-scheme:dark]'
const REMOTE_ROW =
  'flex items-center justify-between gap-3 rounded-[10px] border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-alias-bg-layer-1)] px-3 py-2.5'
const REMOTE_LEADING = 'flex min-w-0 flex-col'
const REMOTE_NAME = 'm-0 truncate text-sm leading-5 font-semibold text-[var(--dsw-alias-label-primary)]'
const REMOTE_CAPTION = 'm-0 truncate text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const INSTALL_BUTTON = 'h-auto flex-none rounded-md px-2.5 py-1 text-[13px] leading-5'
const STDIO_HINT = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-state-error-primary)]'
const DETAILS_BUTTON = 'h-auto flex-none rounded-md border-border bg-transparent px-2.5 py-1 text-[12px] leading-[18px] font-normal text-[var(--dsw-alias-label-secondary)] hover:bg-transparent hover:text-foreground focus-visible:ring-0 aria-pressed:bg-[var(--dsw-alias-bg-layer-2)]'
const DETAILS_META_GRID =
  'grid gap-x-3 gap-y-2 ' +
  '[grid-template-columns:max-content_1fr] ' +
  '[@container(min-width(640px))]:[grid-template-columns:max-content_1fr_max-content_1fr] ' +
  '[@container(min-width(960px))]:[grid-template-columns:max-content_1fr_max-content_1fr_max-content_1fr]'
const DETAILS_META_ROW = 'contents'
const DETAILS_META_KEY = 'text-[var(--dsw-alias-label-tertiary)] whitespace-nowrap'
const DETAILS_META_VAL = 'min-w-0 break-words font-mono text-foreground'
const TOOLS_BLOCK = 'mt-2 border-t border-[var(--dsw-alias-border-l2)] pt-2'
const TOOLS_HEADING = 'm-0 mb-1 text-[12px] leading-[18px] font-semibold text-[var(--dsw-alias-label-secondary)]'
const TOOLS_LIST = 'm-0 grid list-none gap-1 p-0 [grid-template-columns:1fr] [@container(min-width(640px))]:[grid-template-columns:1fr_1fr] [@container(min-width(960px))]:[grid-template-columns:1fr_1fr_1fr]'
const TOOL_ITEM = 'rounded-md bg-[var(--dsw-alias-bg-layer-1)] px-2 py-1'
const TOOL_NAME = 'm-0 font-mono text-[12px] leading-[18px] font-semibold text-[var(--dsw-alias-label-primary)]'
const TOOL_DESC = 'm-0 text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]'

/** Smithery registry search section state. */
type RemoteState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly servers: readonly SmitheryServer[] }
  | { readonly status: 'error' }

/** Debounce before a keystroke hits the Smithery registry. */
const SEARCH_DEBOUNCE_MS = 200

/**
 * Split an argument string into argv, respecting single/double quotes so a
 * path or flag containing spaces stays one token (`a "b c" d` → ['a', 'b c', 'd']).
 * Empty string → no args; an unmatched quote consumes the rest as one token.
 */
export function parseArgs(raw: string): string[] {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return []
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const char of trimmed) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

/** Stable entry id derived from a server name (slug); the tab and the fixture agree on it. */
function mcpServerId(serverName: string): string {
  const slug = serverName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'mcp'
}

/**
 * Parse a `KEY=VALUE` textarea into an env map. Empty lines and `#` comments
 * are skipped; unquoted values trim trailing whitespace; `=` with no value
 * records the key with an empty string (so the user can leave a placeholder).
 */
function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key.length === 0) continue
    env[key] = value
  }
  return env
}

/** Render an env map as `KEY=VALUE` lines (sorted by key for deterministic display). */
function serializeEnvText(env: Record<string, string>): string {
  return Object.keys(env)
    .sort()
    .map(key => `${key}=${env[key] ?? ''}`)
    .join('\n')
}

/**
 * Best-effort prefill: if `~/.dsh/settings.yaml` has a non-empty
 * `proxy.url`, copy it into both `HTTP_PROXY` and `HTTPS_PROXY` so the
 * spawned MCP stdio child inherits the user's outbound proxy (npm fetches,
 * GitHub downloads, etc.). Tauri exposes the active settings namespace
 * values through `ctx.settings.get`, but the bridge isn't wired into the
 * MCP tab yet — fall back to reading the document through the
 * `settings_get` Tauri command, mirroring the fixture's other call sites.
 */
async function loadProxyUrl(): Promise<string | null> {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__
  const invoke = internals?.invoke
  if (typeof invoke !== 'function') return null
  try {
    const value = await (invoke as (cmd: string, args?: Record<string, unknown>) => Promise<unknown>)(
      'settings_get', { key: 'proxy' },
    )
    if (value === null || typeof value !== 'object') return null
    const url = (value as { url?: unknown }).url
    return typeof url === 'string' && url.trim().length > 0 ? url.trim() : null
  } catch {
    return null
  }
}

export function McpInventorySettingsTab({
  store,
  setEnabled,
  upsertServer,
  deleteServer,
  refresh,
  search,
  installSmithery,
  t,
}: McpInventorySettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [toast, setToast] = useState<{ seq: number; kind: 'success' | 'error'; text: string } | null>(null)
  const toastSeq = useRef(0)
  const [remote, setRemote] = useState<RemoteState>({ status: 'idle' })
  const [installing, setInstalling] = useState<string | null>(null)
  // Per-row connection probe (测试): one row at a time, results keyed by entryId.
  const [probingId, setProbingId] = useState<McpEntryId | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({})
  // Per-row details panel (read from the entry's spec synchronously; no RPC).
  const [detailsOpen, setDetailsOpen] = useState<McpEntryId | null>(null)

  // Collapsible add/edit form state.
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<McpEntryId | null>(null)
  const [transport, setTransport] = useState<Transport>('stdio')
  const [serverName, setServerName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [env, setEnv] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!snapshot.read) store.refresh()
  }, [snapshot.read, store])

  const view = useMemo<ViewState>(() => {
    if (snapshot.read) return { status: 'ready', entries: snapshot.entries }
    if (snapshot.error !== undefined) return { status: 'error' }
    return { status: 'loading' }
  }, [snapshot])

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (view.status !== 'ready') return [] as readonly McpInventoryEntryView[]
    if (normalized.length === 0) return view.entries
    return view.entries.filter(entry =>
      [entry.serverName, entry.target].some(value => value.toLocaleLowerCase().includes(normalized)),
    )
  }, [query, view])

  const flash = useCallback((kind: 'success' | 'error', message: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, kind, text: message })
  }, [])

  const flashError = useCallback((message: string): void => {
    flash('error', message)
  }, [flash])

  const flashSuccess = useCallback((message: string): void => {
    flash('success', message)
  }, [flash])

  const { schedule: scheduleToggle, intendedSnapshot } = useDebouncedToggle<McpEntryId>({
    debounceMs: 500,
    commit: ({ entryId, enabled }, signal) => setEnabled({ entryId, enabled }, { signal }),
    onError: ({ entryId }, error) => {
      const reason = error instanceof Error ? error.message : String(error)
      const entry = view.status === 'ready' ? view.entries.find(e => e.entryId === entryId) : undefined
      const name = entry?.serverName ?? entryId
      flashError(t('toggleError', { name, reason }))
    },
    isCommitted: (entryId, intended) => {
      if (view.status !== 'ready') return false
      const entry = view.entries.find(e => e.entryId === entryId)
      return entry !== undefined && entry.enabled === intended
    },
  })

  const retry = (): void => {
    setRequest(value => value + 1)
    refresh()
  }

  // The injected `search` may be recreated per render; hold the latest in a ref
  // so the debounced effect keys only on the query text.
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  // Debounce the typed query: only fire the registry RPC once typing settles
  // for 300ms, so a fast typer doesn't trigger one search per keystroke.
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)

  useEffect(() => {
    const normalized = debouncedQuery
    if (normalized.length === 0) {
      setRemote({ status: 'idle' })
      return
    }
    setRemote({ status: 'loading' })
    let cancelled = false
    searchRef.current(normalized).then(
      (value) => {
        if (!cancelled) setRemote({ status: 'ready', servers: value.servers })
      },
      () => {
        if (!cancelled) setRemote({ status: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  const handleInstall = useCallback(async (server: SmitheryServer): Promise<void> => {
    setInstalling(server.qualifiedName)
    try {
      await installSmithery(server)
      store.refresh()
      flashSuccess(t('installSuccess', { name: server.displayName }))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      flashError(t('installFailed', { name: server.displayName, reason }))
    } finally {
      setInstalling(null)
    }
  }, [installSmithery, store, t, flashError, flashSuccess])

  // When adding a new stdio server, auto-fill HTTP_PROXY / HTTPS_PROXY from
  // the user's persisted settings proxy — most MCP stdio children need an
  // outbound path to npm/GitHub/PyPI, and the user has already configured
  // a proxy in 设置-代理. Re-evaluated every time the form opens so a
  // late proxy edit is reflected.
  const [proxyHint, setProxyHint] = useState<string | null>(null)
  useEffect(() => {
    if (!formOpen) return
    if (editing !== null) return // editing a saved entry; the spec already carries whatever env was set
    if (transport !== 'stdio') return
    void loadProxyUrl().then((url) => {
      if (url === null) {
        setProxyHint(null)
        setEnv('')
        return
      }
      setEnv(`HTTP_PROXY=${url}\nHTTPS_PROXY=${url}\nNO_PROXY=localhost,127.0.0.1`)
      setProxyHint(t('envProxyPrefilled', { url }))
    })
  }, [formOpen, editing, transport, t])

  const openAdd = (): void => {
    setEditing(null)
    setTransport('stdio')
    setServerName('')
    setCommand('')
    setArgs('')
    setUrl('')
    setEnv('')
    setProxyHint(null)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (entry: McpInventoryEntryView): void => {
    const nextTransport: Transport = entry.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
    setEditing(entry.entryId)
    setTransport(nextTransport)
    setServerName(entry.serverName)
    if (nextTransport === 'stdio') {
      setCommand(entry.target)
      setArgs('')
      // `entry.spec` is the stdio variant here (transport was set above from
      // entry.transport); the discriminated-union narrowing still works but the
      // `env` field lives on the stdio branch only.
      setEnv(entry.spec.transport === 'stdio' ? serializeEnvText(entry.spec.env) : '')
      setProxyHint(null)
    } else {
      setUrl(entry.target)
      setEnv('')
      setProxyHint(null)
    }
    setFormError(null)
    setFormOpen(true)
  }

  const closeForm = (): void => {
    setFormOpen(false)
    setEditing(null)
    setFormError(null)
  }

  const submit = async (): Promise<void> => {
    const name = serverName.trim()
    const requiredMissing = name.length === 0
      || (transport === 'stdio' ? command.trim().length === 0 : url.trim().length === 0)
    if (requiredMissing) {
      setFormError(t('validationRequired'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      // Resolve the bare command name to the platform-correct form before
      // persisting, so the Rust spawn gate sees `npx.cmd` on Windows (where
      // `Command::new("npx")` would otherwise miss the PATH-resolved .cmd).
      const resolvedCommand = resolveSpawnCommand(command)
      const spec: McpServerSpec = transport === 'stdio'
        ? {
          transport: 'stdio',
          serverName: name,
          command: resolvedCommand,
          args: parseArgs(args),
          env: parseEnvText(env),
          cwd: '',
        }
        : { transport: 'streamable-http', serverName: name, url: url.trim(), headers: {} }
      await upsertServer(spec)
      // Renaming derives a fresh id from the new serverName, so the old id would
      // otherwise be left behind as a duplicate row; remove it once the upsert lands.
      if (editing !== null && mcpServerId(name) !== editing) {
        await deleteServer(editing)
      }
      // The probe result is keyed by entryId and goes stale the moment the spec
      // changes, so drop it for both the edited row and the (possibly renamed) target.
      clearProbeResult(mcpServerId(name))
      if (editing !== null) clearProbeResult(editing)
      closeForm()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setFormError(t('upsertError', { name, reason }))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entry: McpInventoryEntryView): Promise<void> => {
    if (!window.confirm(t('deleteConfirm', { name: entry.serverName }))) return
    try {
      await deleteServer(entry.entryId)
      // A deleted row's probe result would otherwise resurface if a server with
      // the same slug is later re-added before being re-tested.
      clearProbeResult(entry.entryId)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      flashError(t('deleteError', { name: entry.serverName, reason }))
    }
  }

  /** Drop the cached probe result for one row (stale after the spec changes or the row is removed). */
  const clearProbeResult = (entryId: string): void => {
    setProbeResults((previous) => {
      if (!Object.hasOwn(previous, entryId)) return previous
      return Object.fromEntries(Object.entries(previous).filter(([key]) => key !== entryId))
    })
  }

  // Concurrent probes are prevented by `disabled={probeBusy}` on every test
  // button, so `runProbe` needs no re-entrancy guard (it only ever starts from
  // `probingId === null`).
  const runProbe = useCallback(async (entry: McpInventoryEntryView): Promise<void> => {
    setProbingId(entry.entryId)
    try {
      const result = await probeMcpServer(entry.spec)
      setProbeResults(previous => ({ ...previous, [entry.entryId]: result }))
    } finally {
      setProbingId(null)
    }
  }, [])

  const sectionRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className={SECTION} aria-busy={view.status === 'loading'} ref={sectionRef}>
      {view.status === 'loading' ? <p className={STATUS}>{t('loading')}</p> : null}
      {view.status === 'error' ? (
        <div className={FAILURE}>
          <p className="m-0" role="alert">{t('error')}</p>
          <ShadcnButton variant="outline" className={RETRY} onClick={retry}>{t('retry')}</ShadcnButton>
        </div>
      ) : null}
      {view.status === 'ready' ? (
        <div className={CATALOG}>
          <SearchInput
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
            onClear={() => setQuery('')}
            placeholder={t('search')}
            aria-label={t('search')}
          />
          <ShadcnButton
            variant="outline"
            className={ADD_TOGGLE}
            onClick={formOpen ? closeForm : openAdd}
            aria-expanded={formOpen}
          >
            <IconPlusOutline16 size={14} />
            {formOpen ? t('cancel') : t('addServer')}
          </ShadcnButton>
          {formOpen ? (
            <form
              className={FORM}
              onSubmit={(event) => { event.preventDefault(); void submit() }}
              aria-label={editing !== null ? t('editServer', { name: serverName }) : t('addServer')}
            >
              <div className={FORM_GRID}>
                <div className={FORM_FIELD}>
                  <Label htmlFor="mcp-transport">{t('transport')}</Label>
                  <Select value={transport} onValueChange={(value) => { setTransport(value as Transport) }}>
                    <SelectTrigger id="mcp-transport" className={SELECT}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stdio">{t('transportStdio')}</SelectItem>
                      <SelectItem value="streamable-http">{t('transportStreamableHttp')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className={FORM_FIELD}>
                  <Label htmlFor="mcp-server-name">{t('serverName')}</Label>
                  <ShadcnInput
                    id="mcp-server-name"
                    value={serverName}
                    onChange={(event) => { setServerName(event.currentTarget.value) }}
                  />
                </div>
                {transport === 'stdio' ? (
                  <>
                    <div className={FORM_FIELD}>
                      <Label htmlFor="mcp-command">{t('command')}</Label>
                      <ShadcnInput
                        id="mcp-command"
                        value={command}
                        onChange={(event) => { setCommand(event.currentTarget.value) }}
                      />
                    </div>
                    <div className={FORM_FIELD}>
                      <Label htmlFor="mcp-args">
                        {t('args')}
                        <span className="ml-2 text-[12px] font-normal text-[var(--dsw-alias-label-tertiary)]">
                          ({t('argsHint')})
                        </span>
                      </Label>
                      <ShadcnInput
                        id="mcp-args"
                        value={args}
                        placeholder={t('argsPlaceholder')}
                        onChange={(event) => { setArgs(event.currentTarget.value) }}
                      />
                    </div>
                    <div className={FORM_FIELD + ' sm:col-span-2'}>
                      <Label htmlFor="mcp-env">
                        {t('env')}
                        <span className="ml-2 text-[12px] font-normal text-[var(--dsw-alias-label-tertiary)]">
                          ({t('envHint')})
                        </span>
                      </Label>
                      <textarea
                        id="mcp-env"
                        className={ENV_TEXTAREA}
                        value={env}
                        placeholder={t('envPlaceholder')}
                        spellCheck={false}
                        onChange={(event) => { setEnv(event.currentTarget.value) }}
                      />
                      {proxyHint !== null ? (
                        <p className={FORM_NOTE} role="note">{proxyHint}</p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className={FORM_FIELD}>
                    <Label htmlFor="mcp-url">{t('url')}</Label>
                    <ShadcnInput
                      id="mcp-url"
                      value={url}
                      onChange={(event) => { setUrl(event.currentTarget.value) }}
                    />
                  </div>
                )}
              </div>
              {transport === 'stdio' && editing !== null ? (
                <p className={FORM_NOTE} role="note">{t('editArgsHint')}</p>
              ) : null}
              {formError ? <p className={FORM_ERROR} role="alert">{formError}</p> : null}
              <div className={FORM_ACTIONS}>
                <ShadcnButton type="button" variant="ghost" onClick={closeForm} disabled={saving}>
                  {t('cancel')}
                </ShadcnButton>
                <ShadcnButton type="submit" disabled={saving}>
                  {saving ? t('saving') : t('save')}
                </ShadcnButton>
              </div>
            </form>
          ) : null}
          <div className={CATALOG_HEADING}>
            <h3 className={CATALOG_HEADING_H3}>{t('catalog')}</h3>
            <span className={CATALOG_HEADING_COUNT} data-mcp-count={filteredEntries.length}>
              {filteredEntries.length}
            </span>
          </div>
          {view.entries.length === 0 ? <p className={STATUS}>{t('empty')}</p> : null}
          {view.entries.length > 0 && filteredEntries.length === 0
            ? <p className={STATUS}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={LIST}>
              {filteredEntries.map((entry) => {
                const intended = intendedSnapshot().get(entry.entryId)
                const effective = intended !== undefined ? intended : entry.enabled
                const transportKey = `transport${entry.transport.charAt(0).toUpperCase()}${entry.transport.slice(1).replace(/-./g, x => x.charAt(1).toUpperCase())}` as McpInventoryLocaleKey
                const transportLabel = t(transportKey)
                const probeResult = probeResults[entry.entryId]
                const probeBusy = probingId !== null
                const probePending = probingId === entry.entryId
                const isDetailsOpen = detailsOpen === entry.entryId
                // stdio rows have args (after the command) that the row caption
                // used to drop, so the user couldn't tell whether their input
                // took effect. Surface them inline so the row matches the spec
                // shape they configured in the form.
                const specArgs = entry.spec.transport === 'stdio' && entry.spec.args.length > 0
                  ? ` ${entry.spec.args.join(' ')}`
                  : ''
                return (
                  <li key={entry.entryId} data-mcp-entry={entry.entryId}>
                    <SwitchRow
                      entryId={entry.entryId}
                      label={entry.serverName}
                      caption={entry.target ? `${transportLabel} · ${entry.target}${specArgs}` : transportLabel}
                      checked={effective}
                      onCheckedChange={(next) => { scheduleToggle(entry.entryId, next) }}
                      actions={
                        <>
                          {probeResult !== undefined ? (
                            probeResult.ok
                              ? (
                                <span className={PROBE_OK} role="status" data-mcp-probe-ok="">
                                  {t('probeOk', { count: String(probeResult.toolCount) })}
                                </span>
                              )
                              : (
                                <span className={PROBE_FAIL} role="status" data-mcp-probe-fail="" title={probeResult.error}>
                                  <IconWarningOutline16 size={14} />
                                  <span className={PROBE_FAIL_TEXT}>{t('probeFail', { reason: probeResult.error })}</span>
                                </span>
                              )
                          ) : null}
                          <ShadcnButton
                            variant="ghost"
                            className={ROW_ACTION}
                            disabled={probeBusy}
                            onClick={() => { void runProbe(entry) }}
                            title={t('test')}
                          >
                            {probePending ? t('testing') : t('test')}
                          </ShadcnButton>
                          <ShadcnButton
                            variant="outline"
                            className={DETAILS_BUTTON}
                            aria-pressed={isDetailsOpen}
                            onClick={() => { setDetailsOpen(isDetailsOpen ? null : entry.entryId) }}
                            data-mcp-action="details"
                          >
                            {t('details')}
                          </ShadcnButton>
                          <ShadcnButton
                            variant="ghost"
                            className={ROW_ACTION}
                            onClick={() => { openEdit(entry) }}
                            title={t('edit')}
                          >
                            <IconEditOutline16 size={14} />
                            {t('edit')}
                          </ShadcnButton>
                          <ShadcnButton
                            variant="ghost"
                            className={`${ROW_ACTION} ${ROW_ACTION_DANGER}`}
                            onClick={() => { void remove(entry) }}
                            title={t('delete')}
                          >
                            <IconTrashOutline16 size={14} />
                            {t('delete')}
                          </ShadcnButton>
                        </>
                      }
                    />
                    <DetailsDrawer
                      entry={entry}
                      spec={entry.spec}
                      transportLabel={transportLabel}
                      enabledLabel={effective ? t('detailsStateEnabled') : t('detailsStateDisabled')}
                      open={isDetailsOpen}
                      onOpenChange={(next) => { setDetailsOpen(next ? entry.entryId : null) }}
                      tools={probeResult?.ok ? probeResult.tools : undefined}
                      t={t}
                    />
                  </li>
                )
              })}
            </ul>
          ) : null}

          {query.trim().length > 0 ? (
            <div className={CATALOG} data-remote-results="">
              <div className={CATALOG_HEADING}>
                <h3 className={CATALOG_HEADING_H3}>{t('searchSmithery')}</h3>
              </div>
              {remote.status === 'loading' ? <p className={STATUS}>{t('searching')}</p> : null}
              {remote.status === 'error' ? <p className={FAILURE} role="alert">{t('registryError')}</p> : null}
              {remote.status === 'ready' && remote.servers.length === 0
                ? <p className={STATUS}>{t('registryEmpty')}</p>
                : null}
              {remote.status === 'ready' && remote.servers.length > 0 ? (
                <ul className={LIST}>
                  {remote.servers.map((server) => {
                    const caption = [
                      server.description,
                      server.remote ? t('remoteBadge') : t('stdioBadge'),
                      server.useCount > 0 ? t('useCount', { count: String(server.useCount) }) : '',
                    ].filter(Boolean).join(' · ')
                    const busy = installing === server.qualifiedName
                    const needsManual = !server.remote
                    return (
                      <li key={server.qualifiedName} data-remote-server={server.qualifiedName}>
                        <div className={REMOTE_ROW}>
                          <div className={REMOTE_LEADING}>
                            <p className={REMOTE_NAME}>{server.displayName}</p>
                            {caption !== '' ? <p className={REMOTE_CAPTION}>{caption}</p> : null}
                            {needsManual ? <p className={STDIO_HINT} role="note">{t('stdioManualHint')}</p> : null}
                          </div>
                          <ShadcnButton
                            size="sm"
                            className={INSTALL_BUTTON}
                            disabled={busy || needsManual}
                            title={needsManual ? t('stdioManualHint') : undefined}
                            onClick={() => { void handleInstall(server) }}
                          >
                            {busy ? t('installing') : t('install')}
                          </ShadcnButton>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {toast ? (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={toast.kind === 'success' ? <IconCheckOutline16 /> : <IconWarningOutline16 />}
          anchor={sectionRef.current}
          onDone={() => {
            if (toast.seq === toastSeq.current) setToast(null)
          }}
        />
      ) : null}
      <span className="sr-only" aria-hidden="true">{request}</span>
    </div>
  )
}

/**
 * Bottom-sheet drawer (shadcn / vaul) for the MCP server details. Opened by
 * the row's 详情 button; the same `entry.entryId`-keyed `isDetailsOpen` flag
 * drives the controlled `open` prop so only one row's drawer shows at a time.
 */
function DetailsDrawer({
  entry,
  spec,
  transportLabel,
  enabledLabel,
  tools,
  open,
  onOpenChange,
  t,
}: {
  readonly entry: McpInventoryEntryView
  readonly spec: McpServerSpec
  readonly transportLabel: string
  readonly enabledLabel: string
  readonly tools: readonly ToolSummary[] | undefined
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly t: (key: McpInventoryLocaleKey, params?: Record<string, string>) => string
}): ReactNode {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[80vh] max-h-[80vh] bg-[var(--dsw-alias-bg-layer-2)] p-0 [grid-template-columns:max-content_1fr] [@container(min-width(640px))]:[grid-template-columns:max-content_1fr_max-content_1fr] [@container(min-width(960px))]:[grid-template-columns:max-content_1fr_max-content_1fr_max-content_1fr]">
        <div className="flex h-full flex-col gap-0">
          <DrawerHeader className="border-b border-[var(--dsw-alias-border-l2)] p-4 text-left">
            <DrawerTitle className="m-0 text-base font-semibold text-foreground">{entry.serverName}</DrawerTitle>
            <DrawerDescription className="text-[12px] leading-[18px] text-[var(--dsw-alias-label-tertiary)]">
              {`${transportLabel} · ${enabledLabel}`}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <div className={DETAILS_META_GRID} data-mcp-details-meta={entry.entryId}>
              <div className={DETAILS_META_ROW}>
                <span className={DETAILS_META_KEY}>{t('detailsTransport')}</span>
                <span className={DETAILS_META_VAL}>{transportLabel}</span>
                <span className={DETAILS_META_KEY}>{t('detailsState')}</span>
                <span className={DETAILS_META_VAL}>{enabledLabel}</span>
              </div>
              {spec.transport === 'stdio' ? (
                <>
                  <div className={DETAILS_META_ROW}>
                    <span className={DETAILS_META_KEY}>{t('detailsCommand')}</span>
                    <span className={DETAILS_META_VAL}>{spec.command}</span>
                    <span className={DETAILS_META_KEY}>{t('detailsArgs')}</span>
                    <span className={DETAILS_META_VAL}>
                      {spec.args.length > 0 ? spec.args.join(' ') : t('detailsEmptyList')}
                    </span>
                  </div>
                  <div className={DETAILS_META_ROW}>
                    <span className={DETAILS_META_KEY}>{t('detailsEnv')}</span>
                    <span className={DETAILS_META_VAL}>
                      {Object.keys(spec.env).length > 0
                        ? Object.entries(spec.env).map(([key, value]) => `${key}=${value}`).join('\n')
                        : t('detailsEmptyList')}
                    </span>
                    {spec.cwd.length > 0 ? (
                      <>
                        <span className={DETAILS_META_KEY}>{t('detailsCwd')}</span>
                        <span className={DETAILS_META_VAL}>{spec.cwd}</span>
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className={DETAILS_META_ROW}>
                  <span className={DETAILS_META_KEY}>{t('detailsUrl')}</span>
                  <span className={DETAILS_META_VAL}>{spec.url}</span>
                  <span className={DETAILS_META_KEY}>{t('detailsHeaders')}</span>
                  <span className={DETAILS_META_VAL}>
                    {Object.keys(spec.headers).length > 0
                      ? Object.entries(spec.headers).map(([key, value]) => `${key}: ${value}`).join('\n')
                      : t('detailsEmptyList')}
                  </span>
                </div>
              )}
            </div>
            {tools !== undefined && tools.length > 0 ? (
              <div className={TOOLS_BLOCK} data-mcp-details-tools={entry.entryId}>
                <p className={TOOLS_HEADING}>{t('detailsTools', { count: String(tools.length) })}</p>
                <ul className={TOOLS_LIST}>
                  {tools.map(tool => (
                    <li key={tool.name} className={TOOL_ITEM} data-mcp-tool={tool.name}>
                      <p className={TOOL_NAME}>{tool.name}</p>
                      {tool.description.length > 0 ? <p className={TOOL_DESC}>{tool.description}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <DrawerFooter className="border-t border-[var(--dsw-alias-border-l2)] p-3">
            <DrawerClose className="h-auto rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)]">
              {t('close')}
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
