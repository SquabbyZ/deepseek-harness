import { invoke } from '@tauri-apps/api/core'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { type PluginInfo } from '../bridge/plugin.ts'

export interface AgentInventoryEntry {
  id: string
  name: string
  version: string
  enabled: boolean
}

type ToggleAgentInput = { id: string; enabled: boolean }

/** Query the installed agents and their persisted enabled state. */
export function useAgentInventory(): UseQueryResult<AgentInventoryEntry[], Error> {
  return useQuery<AgentInventoryEntry[], Error>({
    queryKey: ['inventory', 'agents'],
    queryFn: async (): Promise<AgentInventoryEntry[]> => {
      const list = await invoke<PluginInfo[]>('plugin_list')
      return list
        .filter(plugin => plugin.manifest.kind === 'agent')
        .map(plugin => ({
          id: plugin.id,
          name: plugin.name,
          version: plugin.version,
          enabled: plugin.enabled,
        }))
    },
    staleTime: 30_000,
  })
}

/** Persist an installed agent's enabled state and refresh the inventory. */
export function useToggleAgent(): UseMutationResult<void, Error, ToggleAgentInput> {
  const qc = useQueryClient()
  return useMutation<void, Error, ToggleAgentInput>({
    mutationFn: ({ id, enabled }) => invoke<void>('inventory_set_enabled', { id, enabled }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['inventory', 'agents'] }),
  })
}
