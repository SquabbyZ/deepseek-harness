/**
 * Bridge environment detection.
 *
 * `pnpm dev` (vite only) runs the web app in a plain browser without the
 * Tauri runtime, so every `invoke()` call would throw "Cannot read
 * properties of undefined (reading 'invoke')". To keep the dev loop usable
 * without losing fidelity, every bridge module routes through `tauriInvoke`
 * here: when the page is hosted by Tauri the real `@tauri-apps/api/core`
 * `invoke` runs; in vite dev we fall back to a typed `Promise<unknown>`
 * resolver that the dev environment can override (see
 * `setDevInvokeOverride`).
 *
 * Production builds (`pnpm build` → MSI) always go through the real
 * `invoke` — `__TAURI_INTERNALS__` is present in the Tauri WebView2.
 */
import { invoke as tauriInvokeImpl } from '@tauri-apps/api/core'

/** Detected once at module load: true when running inside Tauri WebView2. */
export const isTauri: boolean = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window

type DevInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

let devInvokeOverride: DevInvoke | undefined

/**
 * Override the dev-only invoke resolver. Pass-through by default (rejects
 * with a clear "no Tauri runtime" error). Tests and the boot error overlay
 * set this to a per-command stub.
 */
export function setDevInvokeOverride(fn: DevInvoke | undefined): void {
  devInvokeOverride = fn
}

function defaultDevInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  // Helpful failure mode in vite dev: name the missing command so the user
  // can wire a stub or switch to `pnpm tauri dev` for the real bridge.
  const argsJson = JSON.stringify(args ?? {})
  const message = 'bridge: dev invoke of "' + cmd + '" with no override — ' +
    'either set a per-command stub via setDevInvokeOverride(), ' +
    'or run `pnpm tauri dev` so the Tauri runtime handles it. ' +
    '(args=' + argsJson + ')'
  return Promise.reject(new Error(message))
}

/**
 * Invoke a Tauri command in a way that gracefully no-ops in vite dev.
 * @param cmd - the Tauri command name (e.g. `"app_config_dir"`).
 * * @param args - the argument payload. Skipped when the dev override is a
 * single-argument resolver.
 */
export function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return tauriInvokeImpl<T>(cmd, args)
  return (devInvokeOverride ?? defaultDevInvoke)(cmd, args) as Promise<T>
}
