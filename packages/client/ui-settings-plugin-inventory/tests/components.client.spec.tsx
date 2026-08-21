// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginManagementSection } from '../src/client/PluginManagementSection.tsx'
import type {
  PluginManagementSectionInjected,
  PluginManagementSectionProps,
} from '../src/client/PluginManagementSection.tsx'
import {
  createPluginInventoryStore,
  type PluginEntryId,
  type PluginInventoryEntry,
  type PluginInventoryStore,
} from '../src/client/inventory-store.ts'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

function id(value: string): PluginEntryId {
  return value as PluginEntryId
}

const ENTRIES: readonly PluginInventoryEntry[] = [
  { entryId: id('8a1b2c3d'), moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, disabledReason: null, fiberPhase: 'active', scope: 'builtin' },
  { entryId: id('pending'), moduleName: 'cordis:pending-name', enabled: true, disabledReason: null, fiberPhase: 'pending', scope: 'builtin' },
  { entryId: id('loading'), moduleName: '@fixture/loading-name', enabled: true, disabledReason: null, fiberPhase: 'loading', scope: 'builtin' },
  { entryId: id('failed'), moduleName: '@fixture/failed-name', enabled: true, disabledReason: null, fiberPhase: 'failed', scope: 'builtin' },
  { entryId: id('unloading'), moduleName: '@fixture/unloading-name', enabled: true, disabledReason: null, fiberPhase: 'unloading', scope: 'builtin' },
  { entryId: id('external-entry'), moduleName: 'dshmarket', enabled: true, disabledReason: null, fiberPhase: 'active', scope: 'external' },
  { entryId: id('disabled-entry'), moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, disabledReason: 'cordis', fiberPhase: null, scope: 'builtin' },
]

function buildProps({
  store,
  setEnabled = vi.fn(async () => undefined),
  uninstall = vi.fn(async () => undefined),
  list = vi.fn(async () => ({ entries: store.getSnapshot().entries })),
  refresh = vi.fn(),
}: {
  store: PluginInventoryStore
  setEnabled?: PluginManagementSectionInjected['setEnabled']
  uninstall?: PluginManagementSectionInjected['uninstall']
  list?: PluginManagementSectionInjected['list']
  refresh?: PluginManagementSectionInjected['refresh']
}): PluginManagementSectionProps {
  return {
    store,
    setEnabled,
    uninstall,
    list,
    refresh,
    close: () => undefined,
    t: (key: PluginInventoryLocaleKey, params?: Record<string, string>) => translate(en, key, params),
  } as PluginManagementSectionProps
}

function translate(
  dict: typeof en,
  key: PluginInventoryLocaleKey,
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

describe('PluginManagementSection', () => {
  it('renders a heading, tabs, and one row per entry in the built-in tab', async () => {
    const store = createPluginInventoryStore(
      { list: async () => ({ entries: ENTRIES }) },
      () => undefined,
    )
    render(<PluginManagementSection {...buildProps({ store })} />)

    await waitFor(() => {
      expect(screen.getAllByRole('listitem').length).toBe(ENTRIES.length - 1) // built-in tab hides the external row
    })
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByRole('tab', { name: new RegExp(`^${en.builtin}`) })).toBeTruthy()
    expect(screen.getByRole('tab', { name: new RegExp(`^${en.external}`) })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()

    // Each built-in row has one switch.
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(ENTRIES.length - 1)
    const disabled = switches[switches.length - 1] as HTMLButtonElement
    expect(disabled.getAttribute('data-state')).toBe('unchecked')
    // External rows only: no uninstall on built-in rows.
    expect(screen.queryAllByRole('button', { name: en.uninstall })).toHaveLength(0)
  })

  it('filters the list by module name or Loader entry id', async () => {
    const store = createPluginInventoryStore(
      { list: async () => ({ entries: ENTRIES }) },
      () => undefined,
    )
    render(<PluginManagementSection {...buildProps({ store })} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
    })

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
    })
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    await waitFor(() => {
      expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    })
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('debounces 5 rapid clicks into a single setEnabled commit', async () => {
    const store = createPluginInventoryStore(
      { list: async () => ({ entries: ENTRIES }) },
      () => undefined,
    )
    const setEnabled = vi.fn(async () => undefined)
    render(<PluginManagementSection {...buildProps({ store, setEnabled })} />)
    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(ENTRIES.length - 1)
    })

    const target = screen.getAllByRole('switch')[0] as HTMLButtonElement
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(target)
    }
    expect(setEnabled).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledOnce()
    })
  })

  it('rolls back the optimistic switch when setEnabled rejects', async () => {
    const store = createPluginInventoryStore(
      { list: async () => ({ entries: ENTRIES }) },
      () => undefined,
    )
    const setEnabled = vi.fn(async () => { throw new Error('RPC failed') })
    render(<PluginManagementSection {...buildProps({ store, setEnabled })} />)
    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(ENTRIES.length - 1)
    })

    const target = screen.getAllByRole('switch')[0] as HTMLButtonElement
    fireEvent.click(target)

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledOnce()
    })
    await waitFor(() => {
      expect(target.getAttribute('data-state')).toBe('checked')
    })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('RPC failed')
    })
  })

  it('refreshes when refresh() is invoked and re-renders new entries', async () => {
    const first: { entries: readonly PluginInventoryEntry[] } = { entries: ENTRIES.slice(0, 2) }
    const second: { entries: readonly PluginInventoryEntry[] } = { entries: ENTRIES }
    let index = 0
    const responses = [first, second]
    const store = createPluginInventoryStore(
      { list: async () => responses[index++] ?? { entries: [] } },
      () => undefined,
    )
    render(<PluginManagementSection {...buildProps({ store })} />)
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    })

    await act(async () => { store.refresh() })
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(ENTRIES.length - 1)
    })
  })
})
