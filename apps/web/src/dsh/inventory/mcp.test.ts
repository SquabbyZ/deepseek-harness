// @vitest-environment jsdom

import { invoke } from '@tauri-apps/api/core'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type PluginInfo } from '../bridge/plugin.ts'
import { useMcpInventory, useToggleMcp } from './mcp.ts'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mcp: PluginInfo = {
  id: 'mcp-one',
  name: 'MCP One',
  version: '0.5.0',
  manifest: {
    name: 'mcp-one',
    version: '0.5.0',
    kind: 'mcp',
    host: 'node',
    permissions: ['net.connect'],
    entry: 'dist/index.js',
  },
  enabled: false,
}

const pluginOfOtherKind: PluginInfo = {
  id: 'plugin-of-other-kind',
  name: 'Plugin Of Other Kind',
  version: '1.0.0',
  manifest: {
    name: 'plugin-of-other-kind',
    version: '1.0.0',
    kind: 'plugin',
    host: 'browser',
    permissions: ['fs.read'],
    entry: 'dist/index.js',
  },
  enabled: true,
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('mcp inventory hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters the plugin list to mcp-kind entries', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin_list') return [mcp, pluginOfOtherKind]
      throw new Error(`unexpected command: ${cmd}`)
    })

    const { result } = renderHook(() => useMcpInventory(), {
      wrapper: wrapperFor(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{
      id: 'mcp-one',
      name: 'MCP One',
      version: '0.5.0',
      enabled: false,
    }])
  })

  it('persists the selected enabled state through the Tauri command', async () => {
    const queryClient = new QueryClient()
    vi.mocked(invoke).mockResolvedValue(undefined)

    const { result } = renderHook(() => useToggleMcp(), {
      wrapper: wrapperFor(queryClient),
    })

    await result.current.mutateAsync({ id: 'mcp-one', enabled: true })
    expect(invoke).toHaveBeenCalledWith('inventory_set_enabled', { id: 'mcp-one', enabled: true })
  })
})
