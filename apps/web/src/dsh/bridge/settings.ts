import { invoke } from '@tauri-apps/api/core'

export const settingsApi = {
  get: <T = unknown>(key: string) => invoke<T | null>('settings_get', { key }),
  update: <T = unknown>(key: string, value: T) =>
    invoke<void>('settings_update', { key, value }),
}
