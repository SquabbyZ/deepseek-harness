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
  parseArgs,
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
    spec,
  }
}

const ENTRIES: readonly McpInventoryEntry[] = [
  { entryId: id('existing'), serverName: 'existing', transport: 'stdio', target: 'node', enabled: true, spec: { transport: 'stdio', serverName: 'existing', command: 'node', args: [], env: {}, cwd: '' } },
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
      // Faithful to the fixture's id-derived-from-name overwrite: an upserted
      // spec replaces any seeded spec with the same slug rather than duplicating it.
      const byId = new Map<string, McpInventoryEntry>()
      for (const [entryId, spec] of specs) {
        byId.set(entryId, { entryId: entryId as McpEntryId, serverName: spec.serverName, transport: spec.transport, target: spec.transport === 'stdio' ? spec.command.split(/\s+/)[0] ?? '' : spec.url, enabled: true, spec })
      }
      for (const spec of upserted) byId.set(slug(spec.serverName), project(spec))
      return { entries: [...byId.values()] }
    },
    upsertServer: async (spec) => {
      upserted.push(spec)
    },
    deleteServer: async (entryId) => {
      deleted.push(entryId)
      specs.delete(entryId)
      const index = upserted.findIndex(spec => slug(spec.serverName) === entryId)
      if (index >= 0) upserted.splice(index, 1)
    },
    search: async () => ({ servers: [] }),
  }, () => undefined)
  return { store, upserted, deleted, specs }
}

describe('parseArgs — quote-aware argv tokenizer', () => {
  it('splits on whitespace', () => {
    expect(parseArgs('@modelcontextprotocol/server-filesystem /tmp')).toEqual([
      '@modelcontextprotocol/server-filesystem',
      '/tmp',
    ])
  })

  it('keeps quoted arguments as one token (double and single quotes)', () => {
    expect(parseArgs('a "b c" d')).toEqual(['a', 'b c', 'd'])
    expect(parseArgs("run --path 'C:/Program Files/app' --flag")).toEqual([
      'run',
      '--path',
      'C:/Program Files/app',
      '--flag',
    ])
  })

  it('returns no args for a blank string and tolerates an unmatched quote', () => {
    expect(parseArgs('')).toEqual([])
    expect(parseArgs('   ')).toEqual([])
    expect(parseArgs('a "b')).toEqual(['a', 'b'])
  })
})

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

  it('deletes an existing row through deleteServer after confirmation, and re-lists it gone', async () => {
    const { store, deleted } = buildCrudStore(ENTRIES)
    const deleteServer = vi.fn(async (entryId: string) => { await store.deleteServer(entryId) })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      render(<McpInventorySettingsTab {...buildProps({ store, deleteServer })} />)

      await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })

      fireEvent.click(screen.getByRole('button', { name: en.delete }))
      expect(confirmSpy).toHaveBeenCalledWith(en.deleteConfirm.replace('{{name}}', 'existing'))
      await waitFor(() => { expect(deleteServer).toHaveBeenCalledWith('existing') })
      expect(deleted).toContain('existing')

      // The row disappears after the delete-driven refresh re-reads the empty list.
      await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('does not delete when the confirm dialog is dismissed', async () => {
    const { store, deleted } = buildCrudStore(ENTRIES)
    const deleteServer = vi.fn(async (entryId: string) => { await store.deleteServer(entryId) })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      render(<McpInventorySettingsTab {...buildProps({ store, deleteServer })} />)

      await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })

      fireEvent.click(screen.getByRole('button', { name: en.delete }))
      expect(confirmSpy).toHaveBeenCalledWith(en.deleteConfirm.replace('{{name}}', 'existing'))
      expect(deleteServer).not.toHaveBeenCalled()
      expect(deleted).toHaveLength(0)
      expect(screen.getByText('existing')).toBeTruthy()
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('pre-fills the form when editing a row and keeps the same entry on save', async () => {
    const { store } = buildCrudStore(ENTRIES)
    const upsertServer = vi.fn(async (spec: McpServerSpec) => { await store.upsertServer(spec) })
    const deleteServer = vi.fn(async (entryId: string) => { await store.deleteServer(entryId) })
    render(<McpInventorySettingsTab {...buildProps({ store, upsertServer, deleteServer })} />)

    await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    const nameInput = screen.getByLabelText(en.serverName) as HTMLInputElement
    expect(nameInput.value).toBe('existing')
    expect((screen.getByLabelText(en.command) as HTMLInputElement).value).toBe('node')

    // Same name, command edited → overwrite in place; no old-entry deletion.
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(upsertServer).toHaveBeenCalledOnce() })
    expect(upsertServer).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'existing', command: 'npx' }))
    expect(deleteServer).not.toHaveBeenCalled()
    await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })
    expect(screen.getAllByText('existing')).toHaveLength(1)
  })

  it('renames a server on edit: upserts the new name and deletes the old entry', async () => {
    const { store } = buildCrudStore(ENTRIES)
    const upsertServer = vi.fn(async (spec: McpServerSpec) => { await store.upsertServer(spec) })
    const deleteServer = vi.fn(async (entryId: string) => { await store.deleteServer(entryId) })
    render(<McpInventorySettingsTab {...buildProps({ store, upsertServer, deleteServer })} />)

    await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    const nameInput = screen.getByLabelText(en.serverName) as HTMLInputElement
    expect(nameInput.value).toBe('existing')
    fireEvent.change(nameInput, { target: { value: 'existing-v2' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(upsertServer).toHaveBeenCalledOnce() })
    expect(upsertServer).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'existing-v2', command: 'node' }))
    // The slug-derived id changed, so the old row must be removed, not duplicated.
    await waitFor(() => { expect(deleteServer).toHaveBeenCalledWith('existing') })
    await waitFor(() => { expect(screen.queryByText('existing')).toBeNull() })
    expect(screen.getByText('existing-v2')).toBeTruthy()
  })

  it('shows the args-loss hint only while editing a stdio server', async () => {
    const { store } = buildCrudStore(ENTRIES)
    render(<McpInventorySettingsTab {...buildProps({ store })} />)

    await waitFor(() => { expect(screen.getByText('existing')).toBeTruthy() })

    // Add form (stdio, not editing): no hint.
    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    expect(screen.queryByRole('note')).toBeNull()

    // Edit the stdio row (turns the open form into edit mode): hint appears.
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    expect(screen.getByRole('note').textContent).toBe(en.editArgsHint)

    // Switching to streamable-http while editing hides the hint.
    fireEvent.change(screen.getByLabelText(en.transport), { target: { value: 'streamable-http' } })
    expect(screen.queryByRole('note')).toBeNull()
  })
})
