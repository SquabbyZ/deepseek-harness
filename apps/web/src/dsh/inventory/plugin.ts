import { invoke } from '@tauri-apps/api/core'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { pluginApi } from '../bridge/plugin.ts'

export interface PluginInventoryEntry {
  id: string
  name: string
  version: string
  enabled: boolean
}

type TogglePluginInput = { id: string; enabled: boolean }

/** Query the installed plugins and their persisted enabled state. */
export function usePluginInventory(): UseQueryResult<PluginInventoryEntry[], Error> {
  return useQuery<PluginInventoryEntry[], Error>({
    queryKey: ['inventory', 'plugins'],
    queryFn: async (): Promise<PluginInventoryEntry[]> => {
      const list = await pluginApi.list()
      return list.map(plugin => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        enabled: plugin.enabled,
      }))
    },
    staleTime: 30_000,
  })
}

/** Persist an installed plugin's enabled state and refresh the inventory. */
export function useTogglePlugin(): UseMutationResult<void, Error, TogglePluginInput> {
  const qc = useQueryClient()
  return useMutation<void, Error, TogglePluginInput>({
    mutationFn: ({ id, enabled }) => invoke<void>('inventory_set_enabled', { id, enabled }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['inventory', 'plugins'] }),
  })
}
