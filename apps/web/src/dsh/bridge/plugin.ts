import { invoke } from '@tauri-apps/api/core'

export interface Manifest {
  name: string
  version: string
  kind: 'plugin' | 'skill' | 'mcp' | 'agent'
  platforms?: Record<string, string>
  host: 'browser' | 'node'
  permissions: string[]
  entry: string
  client?: string
}

export interface InstallResult {
  id: string
  name: string
  version: string
  manifest: Manifest
  path: string
  hash: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  manifest_json: string
  content_hash: string
  installed_at: number
  source: string
  enabled: boolean
}

export const pluginApi = {
  install: (spec: string) => invoke<InstallResult>('plugin_install', { spec }),
  uninstall: (id: string) => invoke<void>('plugin_uninstall', { id }),
  reload: (id: string) => invoke<void>('plugin_reload', { id }),
  list: () => invoke<PluginInfo[]>('plugin_list'),
  readFile: (id: string, file: string) =>
    invoke<number[]>('plugin_read_file', { id, file }),
  getManifest: (id: string) => invoke<Manifest>('plugin_get_manifest', { id }),
}
