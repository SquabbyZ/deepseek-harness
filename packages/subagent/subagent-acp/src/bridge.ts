/**
 * Browser-safe Tauri cwd bridge for `@deepseek-ai/dsh-subagent-acp`.
 *
 * Phase 2 of the ecosystem refactor forbids Node built-ins in client-facing
 * packages — they must load into WebView2 with no Node runtime. The package
 * historically imported `node:fs` and `node:path` to validate that the
 * configured / parent-session cwd names an existing, searchable directory
 * before handing it to the subprocess seam; the Tauri host already owns the
 * filesystem, so the check moves here and runs through
 * `commands::fs::cwd_resolve` (Phase 2 Task 2.7.2).
 *
 * Every call into `@tauri-apps/api/core` lives in this module so the rest of
 * the package stays mock-friendly (`vi.mock('@tauri-apps/api/core', ...)`)
 * and so adding new Tauri commands never forces a rewrite of the cwd
 * resolver.
 *
 * @module @deepseek-ai/dsh-subagent-acp/bridge
 */

import { invoke } from '@tauri-apps/api/core'

/**
 * Resolve `path` (relative or absolute) against the host's launch directory
 * and validate that the result names an existing, searchable directory.
 * Returns the canonical absolute path so a symlinked parent (macOS
 * `/tmp` → `/private/tmp`) reports the same value the child will see in its
 * real `process.cwd()`.
 */
export interface CwdApi {
  /**
   * Forward `path` to the Tauri host's `cwd_resolve` command. A relative
   * path is re-anchored to the host's launch directory (mirroring
   * `node:path::resolve`); the host then `stat`s it, checks `is_dir()` and
   * (POSIX) the search bit, and returns the canonical absolute path.
   * @throws when `path` does not name an existing, searchable directory —
   * the host's diagnostic is preserved verbatim so callers can surface the
   * same text they previously produced from `node:fs` errors.
   */
  resolve(path: string): Promise<string>
}

/**
 * Singleton facade over `invoke('cwd_resolve', ...)`. Tests inject a mock
 * via `vi.mock('@tauri-apps/api/core', () => ({ invoke: ... }))`; production
 * code imports this constant and never touches `invoke` directly.
 */
export const cwdApi: CwdApi = {
  async resolve(path: string): Promise<string> {
    return await invoke<string>('cwd_resolve', { path })
  },
}
