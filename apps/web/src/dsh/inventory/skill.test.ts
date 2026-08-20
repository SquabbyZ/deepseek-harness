// @vitest-environment jsdom

import { invoke } from '@tauri-apps/api/core'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type PluginInfo } from '../bridge/plugin.ts'
import { useSkillInventory, useToggleSkill } from './skill.ts'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const skill: PluginInfo = {
  id: 'skill-one',
  name: 'Skill One',
  version: '2.0.0',
  manifest: {
    name: 'skill-one',
    version: '2.0.0',
    kind: 'skill',
    host: 'browser',
    permissions: ['fs.read'],
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

describe('skill inventory hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters the plugin list to skill-kind entries', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin_list') return [skill, pluginOfOtherKind]
      throw new Error(`unexpected command: ${cmd}`)
    })

    const { result } = renderHook(() => useSkillInventory(), {
      wrapper: wrapperFor(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{
      id: 'skill-one',
      name: 'Skill One',
      version: '2.0.0',
      enabled: true,
    }])
  })

  it('persists the selected enabled state through the Tauri command', async () => {
    const queryClient = new QueryClient()
    vi.mocked(invoke).mockResolvedValue(undefined)

    const { result } = renderHook(() => useToggleSkill(), {
      wrapper: wrapperFor(queryClient),
    })

    await result.current.mutateAsync({ id: 'skill-one', enabled: false })
    expect(invoke).toHaveBeenCalledWith('inventory_set_enabled', { id: 'skill-one', enabled: false })
  })
})
