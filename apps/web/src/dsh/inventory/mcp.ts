import { invoke } from '@tauri-apps/api/core'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { type PluginInfo } from '../bridge/plugin.ts'

export interface McpInventoryEntry {
  id: string
  name: string
  version: string
  enabled: boolean
}

type ToggleMcpInput = { id: string; enabled: boolean }

/** Query the installed MCP servers and their persisted enabled state. */
export function useMcpInventory(): UseQueryResult<McpInventoryEntry[], Error> {
  return useQuery<McpInventoryEntry[], Error>({
    queryKey: ['inventory', 'mcp'],
    queryFn: async (): Promise<McpInventoryEntry[]> => {
      const list = await invoke<PluginInfo[]>('plugin_list')
      return list
        .filter(plugin => plugin.manifest.kind === 'mcp')
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

/** Persist an installed MCP server's enabled state and refresh the inventory. */
export function useToggleMcp(): UseMutationResult<void, Error, ToggleMcpInput> {
  const qc = useQueryClient()
  return useMutation<void, Error, ToggleMcpInput>({
    mutationFn: ({ id, enabled }) => invoke<void>('inventory_set_enabled', { id, enabled }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['inventory', 'mcp'] }),
  })
}
