// @vitest-environment jsdom

import { invoke } from '@tauri-apps/api/core'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginApi, type PluginInfo } from '../bridge/plugin.ts'
import { usePluginInventory, useTogglePlugin } from './plugin.ts'

vi.mock('../bridge/plugin.ts', () => ({
  pluginApi: {
    list: vi.fn(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const plugin: PluginInfo = {
  id: 'plugin-one',
  name: 'Plugin One',
  version: '1.2.3',
  manifest: {
    name: 'plugin-one',
    version: '1.2.3',
    kind: 'plugin',
    host: 'browser',
    permissions: [],
    entry: 'dist/index.js',
  },
  enabled: false,
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('plugin inventory hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps the plugin list into inventory entries', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(pluginApi.list).mockResolvedValue([plugin])

    const { result } = renderHook(() => usePluginInventory(), {
      wrapper: wrapperFor(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{
      id: 'plugin-one',
      name: 'Plugin One',
      version: '1.2.3',
      enabled: false,
    }])
  })

  it('persists the selected enabled state through the Tauri command', async () => {
    const queryClient = new QueryClient()
    vi.mocked(invoke).mockResolvedValue(undefined)

    const { result } = renderHook(() => useTogglePlugin(), {
      wrapper: wrapperFor(queryClient),
    })

    await result.current.mutateAsync({ id: 'plugin-one', enabled: true })
    expect(invoke).toHaveBeenCalledWith('inventory_set_enabled', { id: 'plugin-one', enabled: true })
  })
})
