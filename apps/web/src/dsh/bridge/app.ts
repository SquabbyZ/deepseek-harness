import { invoke } from '@tauri-apps/api/core'

export const appApi = {
  version: () => invoke<string>('app_version'),
  crashLogPath: () => invoke<string>('crash_log_path'),
}
