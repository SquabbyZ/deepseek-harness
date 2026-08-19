import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pluginApi, settingsApi, appApi } from '../bridge'

export const useAppVersion = () =>
  useQuery({ queryKey: ['app', 'version'], queryFn: appApi.version })

export const useInstalledPlugins = () =>
  useQuery({
    queryKey: ['plugins'],
    queryFn: pluginApi.list,
    staleTime: Infinity,
  })

export function useInstallPlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (spec: string) => pluginApi.install(spec),
    onSettled: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function useUninstallPlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => pluginApi.uninstall(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function useSettings<T = unknown>(key: string) {
  return useQuery({
    queryKey: ['settings', key],
    queryFn: () => settingsApi.get<T>(key),
  })
}

export function useUpdateSettings<T = unknown>(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (value: T) => settingsApi.update(key, value),
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings', key] }),
  })
}
