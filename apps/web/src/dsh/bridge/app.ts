import { tauriInvoke } from './env.ts'

export const appApi = {
  version: () => tauriInvoke<string>('app_version'),
  crashLogPath: () => tauriInvoke<string>('crash_log_path'),
  /**
   * Per-OS app config directory (Tauri `app.path().app_config_dir()`).
   * Spec §7.1 mandates this is the canonical `$DSH_HOME` equivalent on
   * desktop — web-side code MUST NOT use `os.homedir()` or `process.env`
   * to find user data; always go through this bridge.
   */
  configDir: () => tauriInvoke<string>('app_config_dir'),
}
