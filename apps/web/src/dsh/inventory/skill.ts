import { invoke } from '@tauri-apps/api/core'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { type PluginInfo } from '../bridge/plugin.ts'

export interface SkillInventoryEntry {
  id: string
  name: string
  version: string
  enabled: boolean
}

type ToggleSkillInput = { id: string; enabled: boolean }

/** Query the installed skills and their persisted enabled state. */
export function useSkillInventory(): UseQueryResult<SkillInventoryEntry[], Error> {
  return useQuery<SkillInventoryEntry[], Error>({
    queryKey: ['inventory', 'skills'],
    queryFn: async (): Promise<SkillInventoryEntry[]> => {
      const list = await invoke<PluginInfo[]>('plugin_list')
      return list
        .filter(plugin => plugin.manifest.kind === 'skill')
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

/** Persist an installed skill's enabled state and refresh the inventory. */
export function useToggleSkill(): UseMutationResult<void, Error, ToggleSkillInput> {
  const qc = useQueryClient()
  return useMutation<void, Error, ToggleSkillInput>({
    mutationFn: ({ id, enabled }) => invoke<void>('inventory_set_enabled', { id, enabled }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['inventory', 'skills'] }),
  })
}
