/**
 * Browser-safe platform bridge for `@deepseek-ai/dsh-subagent-codex`.
 *
 * The package historically read `process.platform` (a Node-only global) to
 * decide whether to wrap the Codex app-server command in `cmd.exe`. Phase 2
 * of the ecosystem refactor forbids that — packages must load into WebView2
 * with no Node runtime, so `process` is undefined there.
 *
 * Platform detection therefore moves into this module. It uses a
 * WebView2-safe `navigator.userAgent` sniff so the package loads both inside
 * the Tauri host and inside plain browser test harnesses. The Tauri host
 * already knows the canonical platform (`services::platform` in
 * `desktop/src-tauri`) and could surface it via a dedicated Tauri command in
 * a follow-up task, but for now the user-agent sniff is sufficient: the
 * fallback is intentionally conservative — any UA that does not mention
 * Windows, macOS, or Linux is treated as a POSIX shell.
 *
 * Tests inject a mock by stubbing `globalThis.navigator.userAgent` (the same
 * surface the package reads) so the rest of the package stays
 * `vi.mock`-friendly without needing to mock any third-party module.
 *
 * @module @deepseek-ai/dsh-subagent-codex/bridge
 */

/** Possible host platforms the Codex app-server argv selection understands. */
export type CodexHostPlatform = 'win32' | 'linux' | 'darwin'

/** Default platform when no UA hint is available. */
const DEFAULT_PLATFORM: CodexHostPlatform = 'linux'

/**
 * Detect the host platform for the Codex app-server argv selection.
 *
 * Reads `navigator.userAgent` (present in WebView2 and every modern browser)
 * and maps Windows / macOS / Linux substrings to the same shape that
 * `codexAppServerArgv` previously accepted from `process.platform`. The
 * function is intentionally async so a follow-up can swap the UA sniff for
 * a real Tauri host command (e.g. `@tauri-apps/plugin-os::platform`) without
 * touching callers.
 *
 * @returns the platform string in the shape `codexAppServerArgv` expects.
 */
export async function detectHostPlatform(): Promise<CodexHostPlatform> {
  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('windows')) return 'win32'
    if (ua.includes('mac')) return 'darwin'
    if (ua.includes('linux')) return 'linux'
  }
  return DEFAULT_PLATFORM
}
