import { invoke } from '@tauri-apps/api/core'

export const credentialsApi = {
  get: (key: string) => invoke<string | null>('credentials_get', { key }),
  set: (key: string, value: string) =>
    invoke<void>('credentials_set', { key, value }),
  delete: (key: string) => invoke<void>('credentials_delete', { key }),
}
