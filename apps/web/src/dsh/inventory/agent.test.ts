// @vitest-environment jsdom

import { invoke } from '@tauri-apps/api/core'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type PluginInfo } from '../bridge/plugin.ts'
import { useAgentInventory, useToggleAgent } from './agent.ts'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const agent: PluginInfo = {
  id: 'agent-one',
  name: 'Agent One',
  version: '3.1.4',
  manifest: {
    name: 'agent-one',
    version: '3.1.4',
    kind: 'agent',
    host: 'node',
    permissions: ['shell.spawn'],
    entry: 'dist/index.js',
  },
  enabled: true,
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
  enabled: false,
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('agent inventory hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters the plugin list to agent-kind entries', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin_list') return [agent, pluginOfOtherKind]
      throw new Error(`unexpected command: ${cmd}`)
    })

    const { result } = renderHook(() => useAgentInventory(), {
      wrapper: wrapperFor(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{
      id: 'agent-one',
      name: 'Agent One',
      version: '3.1.4',
      enabled: true,
    }])
  })

  it('persists the selected enabled state through the Tauri command', async () => {
    const queryClient = new QueryClient()
    vi.mocked(invoke).mockResolvedValue(undefined)

    const { result } = renderHook(() => useToggleAgent(), {
      wrapper: wrapperFor(queryClient),
    })

    await result.current.mutateAsync({ id: 'agent-one', enabled: false })
    expect(invoke).toHaveBeenCalledWith('inventory_set_enabled', { id: 'agent-one', enabled: false })
  })
})
