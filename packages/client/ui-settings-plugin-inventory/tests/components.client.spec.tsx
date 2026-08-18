// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginEntryId, PluginInventoryEntry } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { createPluginInventoryStore, type PluginInventoryStore } from '../src/client/inventory-store.ts'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

function id(value: string): PluginEntryId {
  return value as PluginEntryId
}

const ENTRIES: readonly PluginInventoryEntry[] = [
  { entryId: id('8a1b2c3d'), moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, disabledReason: null, fiberPhase: 'active' },
  { entryId: id('pending'), moduleName: 'cordis:pending-name', enabled: true, disabledReason: null, fiberPhase: 'pending' },
  { entryId: id('loading'), moduleName: '@fixture/loading-name', enabled: true, disabledReason: null, fiberPhase: 'loading' },
  { entryId: id('failed'), moduleName: '@fixture/failed-name', enabled: true, disabledReason: null, fiberPhase: 'failed' },
  { entryId: id('unloading'), moduleName: '@fixture/unloading-name', enabled: true, disabledReason: null, fiberPhase: 'unloading' },
  { entryId: id('unobserved'), moduleName: '@fixture/unobserved-name', enabled: true, disabledReason: null, fiberPhase: null },
  { entryId: id('disabled-entry'), moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, disabledReason: 'cordis', fiberPhase: null },
]

function buildProps({
  store,
  setEnabled = vi.fn(async () => undefined),
  list = vi.fn(async () => ({ entries: store.getSnapshot().entries })),
  refresh = vi.fn(),
}: {
  store: PluginInventoryStore
  setEnabled?: PluginInventorySettingsTabInjected['setEnabled']
  list?: PluginInventorySettingsTabInjected['list']
  refresh?: PluginInventorySettingsTabInjected['refresh']
}): PluginInventorySettingsTabProps {
  return {
    store,
    setEnabled,
    list,
    refresh,
    t: (key: PluginInventoryLocaleKey, params?: Record<string, string>) => translate(en, key, params),
  } as PluginInventorySettingsTabProps
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

describe('PluginInventorySettingsTab', () => {
  it('renders one row per entry with phase dot, caption, and switch', async () => {
    const setEnabled = vi.fn(async () => undefined)
    const store = createPluginInventoryStore(
      { list: async () => ({ entries: ENTRIES }) },
      () => undefined,
    )
    const view = render(<PluginInventorySettingsTab {...buildProps({ store, setEnabled })} />)

    // Wait for the snapshot to settle (read=true).
    await waitFor(() => {
      expect(screen.getAllByRole('listitem').length).toBe(ENTRIES.length)
    })
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe(String(ENTRIES.length))

    // Each entry has one switch.
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(ENTRIES.length)
    // The disabled entry's switch starts off.
    const disabled = switches[ENTRIES.length - 1] as HTMLButtonElement
    expect(disabled.getAttribute('data-state')).toBe('unchecked')
    // The other six are on.
    for (let i = 0; i < ENTRIES.length - 1; i += 1) {
      expect((switches[i] as HTMLButtonElement).getAttribute('data-state')).toBe('checked')
    }
  })

  it('filters the list by module name or Loader entry id', async () => {
    const store = createPluginInventoryStore(
      { list: async () => ({ entries: ENTRIES }) },
      () => undefined,
    )
    render(<PluginInventorySettingsTab {...buildProps({ store })} />)
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
    render(<PluginInventorySettingsTab {...buildProps({ store, setEnabled })} />)
    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(ENTRIES.length)
    })

    const target = screen.getAllByRole('switch')[0] as HTMLButtonElement
    // 5 rapid toggles on/off/on/off/on collapse into the final state.
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(target)
    }
    // Within the debounce window, no RPC has fired yet.
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
    render(<PluginInventorySettingsTab {...buildProps({ store, setEnabled })} />)
    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(ENTRIES.length)
    })

    const target = screen.getAllByRole('switch')[0] as HTMLButtonElement
    fireEvent.click(target)

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledOnce()
    })
    // Switch rolls back to committed state.
    await waitFor(() => {
      expect(target.getAttribute('data-state')).toBe('checked')
    })
    // Error toast surfaces.
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
    render(<PluginInventorySettingsTab {...buildProps({ store })} />)
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    })

    await act(async () => { store.refresh() })
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(ENTRIES.length)
    })
  })
})
