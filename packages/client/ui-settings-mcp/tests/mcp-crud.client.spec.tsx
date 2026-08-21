// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
// Type-only side effect: loads the plugin's `declare module` LocaleNamespaceMap
// merge (index.ts owns the 'settings.mcp' namespace seat) so PropsLocale
// resolves `t` for this test program, mirroring how the sibling plugin-inventory
// suite loads its merge through a test importing the plugin entry.
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
} from '../src/client/inventory-store.ts'
import { en, type McpInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

function id(value: string): McpEntryId {
  return value as McpEntryId
}

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
  }
}

const ENTRIES: readonly McpInventoryEntry[] = [
  { entryId: id('existing'), serverName: 'existing', transport: 'stdio', target: 'node', enabled: true },
]

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

function buildProps({
  store,
  setEnabled = vi.fn(async () => undefined),
  upsertServer = vi.fn(async () => undefined),
  deleteServer = vi.fn(async () => undefined),
  list = vi.fn(async () => ({ entries: store.getSnapshot().entries })),
  refresh = vi.fn(),
}: {
  store: McpInventoryStore
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
    close: () => undefined,
    t: (key: McpInventoryLocaleKey, params?: Record<string, string>) => translate(en, key, params),
  } as McpInventorySettingsTabProps
}

/** Build a store whose port records upsert/delete calls and re-lists them. */
function buildCrudStore(initial: readonly McpInventoryEntry[]) {
  const specs = new Map<string, McpServerSpec>()
  for (const entry of initial) {
    specs.set(entry.entryId, {
      transport: entry.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
      serverName: entry.serverName,
      command: entry.target,
      args: [],
      env: {},
      cwd: '',
    } as McpServerSpec)
  }
  const upserted: McpServerSpec[] = []
  const deleted: string[] = []
  const store = createMcpInventoryStore({
    list: async () => {
      const entries: McpInventoryEntry[] = []
      for (const [entryId, spec] of specs) {
        entries.push({ entryId: entryId as McpEntryId, serverName: spec.serverName, transport: spec.transport, target: spec.transport === 'stdio' ? spec.command.split(/\s+/)[0] ?? '' : spec.url, enabled: true })
      }
      for (const spec of upserted) entries.push(project(spec))
      return { entries }
    },
    upsertServer: async (spec) => {
      upserted.push(spec)
    },
    deleteServer: async (entryId) => {
      deleted.push(entryId)
      specs.delete(entryId)
    },
  }, () => undefined)
  return { store, upserted, deleted, specs }
}

describe('McpInventorySettingsTab CRUD', () => {
  it('adds a stdio server through the form and re-lists it after the upsert refresh', async () => {
    const { store, upserted } = buildCrudStore([])
    const upsertServer = vi.fn(async (spec: McpServerSpec) => { await store.upsertServer(spec) })
    render(<McpInventorySettingsTab {...buildProps({ store, upsertServer })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'filesystem' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'npx' } })
    fireEvent.change(screen.getByLabelText(en.args), { target: { value: '@modelcontextprotocol/server-filesystem /tmp' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(upsertServer).toHaveBeenCalledOnce() })
    expect(upsertServer).toHaveBeenCalledWith({
      transport: 'stdio',
      serverName: 'filesystem',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: {},
      cwd: '',
    })
    // The store refresh (inside store.upsertServer) re-reads the list → new entry visible.
    await waitFor(() => { expect(screen.getByText('filesystem')).toBeTruthy() })
    expect(upserted).toContainEqual({
      transport: 'stdio',
      serverName: 'filesystem',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: {},
      cwd: '',
    })
  })

  it('adds a streamable-http server', async () => {
    const { store } = buildCrudStore([])
    const upsertServer = vi.fn(async (spec: McpServerSpec) => { await store.upsertServer(spec) })
    render(<McpInventorySettingsTab {...buildProps({ store, upsertServer })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    fireEvent.change(screen.getByLabelText(en.transport), { target: { value: 'streamable-http' } })
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'remote' } })
    fireEvent.change(screen.getByLabelText(en.url), { target: { value: 'https://mcp.example.com/sse' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(upsertServer).toHaveBeenCalledOnce() })
    expect(upsertServer).toHaveBeenCalledWith({
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'https://mcp.example.com/sse',
      headers: {},
    })
    await waitFor(() => { expect(screen.getByText('remote')).toBeTruthy() })
  })

  it('blocks an empty submit with a validation message and does not call upsertServer', async () => {
    const { store } = buildCrudStore([])
    const upsertServer = vi.fn(async () => undefined)
    render(<McpInventorySettingsTab {...buildProps({ store, upsertServer })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.validationRequired) })
    expect(upsertServer).not.toHaveBeenCalled()
  })

  it('deletes an existing row through deleteServer and re-lists it gone', async () => {
    const { store, deleted } = buildCrudStore(ENTRIES)
    const deleteServer = vi.fn(async (entryId: string) => { await store.deleteServer(entryId) })
    render(<McpInventorySettingsTab {...buildProps({ store, deleteServer })} />)

    await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    await waitFor(() => { expect(deleteServer).toHaveBeenCalledWith('existing') })
    expect(deleted).toContain('existing')

    // The row disappears after the delete-driven refresh re-reads the empty list.
    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })
  })

  it('pre-fills the form when editing a row and keeps the same entry on save', async () => {
    const { store } = buildCrudStore(ENTRIES)
    const upsertServer = vi.fn(async (spec: McpServerSpec) => { await store.upsertServer(spec) })
    render(<McpInventorySettingsTab {...buildProps({ store, upsertServer })} />)

    await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    const nameInput = screen.getByLabelText(en.serverName) as HTMLInputElement
    expect(nameInput.value).toBe('existing')
    expect((screen.getByLabelText(en.command) as HTMLInputElement).value).toBe('node')

    fireEvent.change(nameInput, { target: { value: 'existing-v2' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(upsertServer).toHaveBeenCalledOnce() })
    expect(upsertServer).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'existing-v2', command: 'node' }))
    await waitFor(() => { expect(screen.getByText('existing-v2')).toBeTruthy() })
  })
})
