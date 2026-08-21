// @vitest-environment jsdom
/**
 * Smithery MCP search + one-click install (Task 5).
 *
 * Two lanes:
 *  1. Fixture RPC — with `__TAURI_INTERNALS__` mocked so `http_request`
 *     returns a fake Smithery search response, `mcpRegistry/search` must
 *     project `{ qualifiedName, displayName, description, remote, useCount }`
 *     (skipping servers with an empty qualifiedName/displayName, defaulting a
 *     missing description to "").
 *  2. Component — `McpInventorySettingsTab` renders remote server cards under
 *     the "从 Smithery 搜索" section. Clicking 安装 on a REMOTE server converts
 *     it to a streamable-http spec (`https://server.smithery.ai/{qualifiedName}`)
 *     and writes it through the existing `upsertServer` path, then refreshes.
 *     A STDIO server's install is downgraded: the button is disabled and a
 *     manual-command hint is shown, and no broken spec is ever written.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
// Type-only side effect: loads the plugin's `declare module` LocaleNamespaceMap
// merge so PropsLocale resolves `t` for this test program (mirrors mcp-crud).
import type {} from '../src/client/index.ts'
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
  type SmitheryServer,
} from '../src/client/inventory-store.ts'
import { en, type McpInventoryLocaleKey } from '../src/client/locales.ts'
import { createFixtureFaces } from '../../connection/src/client/fixture.ts'

afterEach(cleanup)

function id(value: string): McpEntryId {
  return value as McpEntryId
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

/* ------------------------------------------------------------------ */
/*  Lane 1: fixture RPC via a mocked `__TAURI_INTERNALS__` bridge      */
/* ------------------------------------------------------------------ */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

interface TauriMockOpts {
  httpStatus?: number
  httpBody?: string
}

interface TauriMock {
  calls: Array<{ cmd: string; args?: Record<string, unknown> }>
  clear(): void
}

/** Install a fake `__TAURI_INTERNALS__.invoke` and record every call. */
function installTauriMock(opts: TauriMockOpts = {}): TauriMock {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  const invoke: InvokeFn = async (cmd, args) => {
    calls.push(args === undefined ? { cmd } : { cmd, args })
    switch (cmd) {
      case 'http_request': {
        const status = opts.httpStatus ?? 200
        const body = opts.httpBody ?? '{}'
        return { status, headers: {}, body: Array.from(new TextEncoder().encode(body)) }
      }
      default:
        return null
    }
  }
  ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke }
  return {
    calls,
    clear() { calls.length = 0 },
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

/** Drive the fixture's mcpRegistry/search Remote endpoint. */
async function searchMcpServers(
  rpc: ReturnType<typeof createFixtureFaces>['rpc'],
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await rpc.call('/api', 'mcpRegistry/search', { args: { agentId: 'fx-alpha' as never, query } })
  if (!result.ok) throw new Error(`mcpRegistry/search failed: ${result.error.code}`)
  return (result.value as { servers: Array<Record<string, unknown>> }).servers
}

const SEARCH_BODY = JSON.stringify({
  servers: [
    {
      id: 'mcp-server-brave',
      qualifiedName: 'brave',
      displayName: 'Brave Search',
      description: 'Search the web with Brave',
      remote: true,
      useCount: 87579,
      isDeployed: true,
    },
    {
      id: 'mcp-server-stdio',
      qualifiedName: 'local-tool',
      displayName: 'Local Tool',
      remote: false,
      useCount: 42,
    },
    {
      // A registry row with no qualifiedName/displayName must be skipped.
      id: 'broken',
      remote: true,
      useCount: 1,
    },
  ],
})

describe('mcpRegistry/search — Smithery projection', () => {
  it('projects { qualifiedName, displayName, description, remote, useCount } and defaults a missing description to ""', async () => {
    installTauriMock({ httpBody: SEARCH_BODY })
    const { rpc } = createFixtureFaces()
    const servers = await searchMcpServers(rpc, 'brave')
    expect(servers).toEqual([
      { qualifiedName: 'brave', displayName: 'Brave Search', description: 'Search the web with Brave', remote: true, useCount: 87579 },
      { qualifiedName: 'local-tool', displayName: 'Local Tool', description: '', remote: false, useCount: 42 },
    ])
  })

  it('returns an empty server list without a Tauri bridge (browser fallback)', async () => {
    const { rpc } = createFixtureFaces()
    const servers = await searchMcpServers(rpc, 'brave')
    expect(servers).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/*  Lane 2: McpInventorySettingsTab component                          */
/* ------------------------------------------------------------------ */

const REMOTE_SERVERS: readonly SmitheryServer[] = [
  { qualifiedName: 'brave', displayName: 'Brave Search', description: 'Search the web with Brave', remote: true, useCount: 87579 },
  { qualifiedName: 'local-tool', displayName: 'Local Tool', description: '', remote: false, useCount: 42 },
]

/** Mirror the fixture's serverName → entryId slug so the fake list projects the same ids. */
function slug(serverName: string): string {
  const clean = serverName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return clean.length > 0 ? clean : 'mcp'
}

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

/** Build a store whose ports record search/install calls and re-list on install. */
function buildSearchStore(initial: readonly McpInventoryEntry[]) {
  const upserted: McpServerSpec[] = []
  const searched: string[] = []
  const entries = new Map<string, McpInventoryEntry>()
  for (const entry of initial) entries.set(entry.entryId, entry)
  const store = createMcpInventoryStore({
    list: async () => ({ entries: [...entries.values()] }),
    search: async (query: string) => {
      searched.push(query)
      const normalized = query.toLowerCase()
      return {
        servers: REMOTE_SERVERS.filter(server =>
          server.qualifiedName.toLowerCase().includes(normalized)
          || server.displayName.toLowerCase().includes(normalized)),
      }
    },
    upsertServer: async (spec) => {
      upserted.push(spec)
      entries.set(slug(spec.serverName), project(spec))
    },
    deleteServer: async () => undefined,
  }, () => undefined)
  return { store, upserted, searched }
}

function buildProps({
  store,
  search,
  installSmithery,
  setEnabled = vi.fn(async () => undefined),
  upsertServer = vi.fn(async () => undefined),
  deleteServer = vi.fn(async () => undefined),
  list = vi.fn(async () => ({ entries: store.getSnapshot().entries })),
  refresh = vi.fn(),
}: {
  store: McpInventoryStore
  search?: McpInventorySettingsTabInjected['search']
  installSmithery?: McpInventorySettingsTabInjected['installSmithery']
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
    search: search ?? (() => Promise.resolve({ servers: [] })),
    installSmithery: installSmithery ?? (() => Promise.resolve()),
    close: () => undefined,
    t: (key: McpInventoryLocaleKey, params?: Record<string, string>) => translate(en, key, params),
  } as McpInventorySettingsTabProps
}

describe('McpInventorySettingsTab Smithery search + install', () => {
  it('triggers the search port on a non-empty query and renders remote cards', async () => {
    const { store, searched } = buildSearchStore([])
    const search = vi.fn((query: string) => store.search(query))
    render(<McpInventorySettingsTab {...buildProps({ store, search })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'brave' } })

    await waitFor(() => { expect(searched).toContain('brave') })
    // The remote card for the matching server renders under the search section.
    await waitFor(() => { expect(screen.getByText('Brave Search')).toBeTruthy() })
    expect(screen.queryByText('Local Tool')).toBeNull()
  })

  it('installs a REMOTE server through the upsertServer path and refreshes the list', async () => {
    const { store, upserted } = buildSearchStore([])
    const search = vi.fn((query: string) => store.search(query))
    const installSmithery = vi.fn(async (server: SmitheryServer) => { await store.installSmithery(server) })
    const refresh = vi.fn(() => { store.refresh() })
    render(<McpInventorySettingsTab {...buildProps({ store, search, installSmithery, refresh })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'brave' } })
    await waitFor(() => { expect(screen.getByText('Brave Search')).toBeTruthy() })

    const installButton = screen.getAllByRole('button', { name: en.install })[0]
    if (installButton !== undefined) fireEvent.click(installButton)

    await waitFor(() => { expect(installSmithery).toHaveBeenCalledWith(REMOTE_SERVERS[0]) })
    // The install writes through the EXISTING upsertServer path: a streamable-http
    // spec pointed at the Smithery hosted endpoint for the qualifiedName.
    expect(upserted).toContainEqual({
      transport: 'streamable-http',
      serverName: 'brave',
      url: 'https://server.smithery.ai/brave',
      headers: {},
    })
    // A successful install refreshes the inventory → the new local entry appears.
    await waitFor(() => { expect(screen.getByText(en.installSuccess.replace('{{name}}', 'Brave Search'))).toBeTruthy() })
  })

  it('downgrades a STDIO server: install button disabled with a manual-command hint, no spec written', async () => {
    const { store, upserted } = buildSearchStore([])
    const search = vi.fn((query: string) => store.search(query))
    const installSmithery = vi.fn(async (server: SmitheryServer) => { await store.installSmithery(server) })
    render(<McpInventorySettingsTab {...buildProps({ store, search, installSmithery })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'local' } })
    await waitFor(() => { expect(screen.getByText('Local Tool')).toBeTruthy() })

    // The stdio card's install button is disabled and the manual-command hint shows.
    const installButton = screen.getAllByRole('button', { name: en.install })[0] as HTMLButtonElement | undefined
    expect(installButton?.disabled).toBe(true)
    expect(screen.getByText(en.stdioManualHint)).toBeTruthy()

    // Clicking the disabled button must not write any spec.
    if (installButton !== undefined) fireEvent.click(installButton)
    expect(installSmithery).not.toHaveBeenCalled()
    expect(upserted).toHaveLength(0)
  })

  it('flashes an error toast when the install fails', async () => {
    const { store } = buildSearchStore([])
    const search = vi.fn((query: string) => store.search(query))
    const installSmithery = vi.fn(async () => { throw new Error('boom') })
    const refresh = vi.fn()
    render(<McpInventorySettingsTab {...buildProps({ store, search, installSmithery, refresh })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'brave' } })
    await waitFor(() => { expect(screen.getByText('Brave Search')).toBeTruthy() })

    const installButton = screen.getAllByRole('button', { name: en.install })[0]
    if (installButton !== undefined) fireEvent.click(installButton)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        en.installFailed.replace('{{name}}', 'Brave Search').replace('{{reason}}', 'boom'),
      )
    })
    expect(refresh).not.toHaveBeenCalled()
  })
})
