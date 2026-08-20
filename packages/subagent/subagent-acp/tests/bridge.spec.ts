/**
 * Integration smoke test for `@deepseek-ai/dsh-subagent-acp`'s cwd bridge.
 *
 * Phase 2 Task 2.7.2 replaced the package's `node:fs`/`node:path` cwd
 * validation with a Tauri-mediated call to `commands::fs::cwd_resolve`. The
 * package's cwd resolution runs through one singleton facade:
 * {@link cwdApi.resolve}, which dispatches via `invoke('cwd_resolve', ...)`.
 *
 * This file pins that single contract:
 *
 * - `cwdApi.resolve(path)` forwards `path` to `invoke('cwd_resolve', { path })`.
 *
 * Production goes through the real Tauri command; tests inject a mock so the
 * renderer bridge stays the single source of truth (no parallel Node-side
 * service). That mirror is what the existing `subagent-acp.spec.ts` test
 * also relies on — this file stays narrowly focused on the dispatch contract
 * of the bridge itself.
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * The mock is registered BEFORE the bridge module is imported so vitest
 * hoists `vi.mock` and replaces `@tauri-apps/api/core`'s export. The capture
 * array tracks every invoke call so the dispatch contract is asserted by
 * value, not by spy identity alone.
 */
const invokeCalls: Array<{ command: string; args: unknown }> = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: unknown) => {
    invokeCalls.push({ command, args })
    if (command === 'cwd_resolve') return '/mocked/cwd/resolution'
    throw new Error(`mock: unexpected command ${command}`)
  }),
}))

const { cwdApi } = await import('../src/bridge.ts')

describe('subagent-acp cwd bridge', () => {
  it('cwdApi.resolve forwards the path to invoke("cwd_resolve")', async () => {
    invokeCalls.length = 0
    const result = await cwdApi.resolve('/workspace/child')
    expect(invokeCalls).toEqual([{ command: 'cwd_resolve', args: { path: '/workspace/child' } }])
    expect(result).toBe('/mocked/cwd/resolution')
  })
})
