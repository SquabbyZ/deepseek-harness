/**
 * Browser-safe Tauri shell bridge for `@deepseek-ai/dsh-subagent-spawn-in-process`.
 *
 * The package historically reached for `node:child_process.spawn` to start a
 * child subagent; Phase 2 of the ecosystem refactor forbids that — packages
 * must run inside WebView2 with no Node runtime. The Tauri `shell_spawn`
 * command (Phase 1 Task 1.7, `desktop/src-tauri/src/commands/shell.rs`) is the
 * host-side counterpart and is the only path through which this package may
 * launch a new process.
 *
 * Every call into `@tauri-apps/api/core` lives here so the rest of the package
 * stays mock-friendly (`vi.mock('@tauri-apps/api/core', ...)`) and so adding
 * new Tauri commands never forces a rewrite of the spawn provider.
 *
 * @module @deepseek-ai/dsh-subagent-spawn-in-process/bridge
 */

import { invoke } from '@tauri-apps/api/core'

/** Mirror of `desktop/src-tauri/src/commands/shell.rs::ShellSpec`. */
export interface ShellSpec {
  cmd: string
  args: string[]
  cwd?: string
  env: Record<string, string>
}

/** Mirror of the `shell_spawn` Tauri command return value (the child pid). */
export type SpawnHandleId = number

/**
 * The browser-side handle returned by `shellApi.spawn`. Mirrors the pid field
 * of `node:child_process.ChildProcess` so callers familiar with Node's API can
 * reach for it directly, but it is intentionally NOT a full ChildProcess: the
 * host owns process lifecycle and the renderer cannot `.kill()` or pipe stdio
 * from a WebView2 context. Callers that need richer control must extend the
 * Tauri command surface on the host side.
 */
export interface SpawnHandle {
  /** Host-assigned OS pid (0 if the host could not resolve one). */
  readonly pid: SpawnHandleId
}

export interface ShellApi {
  /**
   * Forward a `ShellSpec` to the Tauri host, which validates `cmd` against
   * `services::platform::allowed_shell_binaries()` and confines `cwd` to the
   * config dir before spawning via `tokio::process::Command`. Returns the
   * host-assigned pid wrapped in a {@link SpawnHandle}.
   */
  spawn(spec: ShellSpec): Promise<SpawnHandle>
}

/**
 * Singleton facade over `invoke('shell_spawn', ...)`. Tests inject a mock via
 * `vi.mock('@tauri-apps/api/core', () => ({ invoke: ... }))`; production code
 * imports this constant and never touches `invoke` directly.
 */
export const shellApi: ShellApi = {
  async spawn(spec: ShellSpec): Promise<SpawnHandle> {
    const pid = await invoke<SpawnHandleId>('shell_spawn', { spec })
    return { pid }
  },
}
