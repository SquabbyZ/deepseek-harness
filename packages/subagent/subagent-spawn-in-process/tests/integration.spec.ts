/**
 * Integration smoke test for `@deepseek-ai/dsh-subagent-spawn-in-process`.
 *
 * Phase 2 Task 2.7.5 verifies the package's wiring:
 *
 * - `SubagentSpawnInProcess` (the browser-safe Tauri-mediated spawn service)
 *   mounts under the documented `SUBAGENT_SPAWN_IN_PROCESS` cordis key.
 * - The spawn provider registers on `ctx.subagents` under the configured name
 *   and advertises every start-time capability the in-process backend
 *   supports (`outputSchema`/`depthLimit`/`toolFilter`/`persona`).
 * - The plugin namespace export shape (loader metadata: `name`, `inject`,
 *   `apply`) survives the cordis loader's `unwrapExports` so a reload cannot
 *   drop the dependencies the package declared.
 *
 * Smoke-level: we exercise only the plugin's `apply()` entry point and the
 * resulting service / provider state on the cordis context — there is no real
 * spawn, no model, and no Tauri runtime (`@tauri-apps/api/core` is never
 * reached because no `spawn()` call runs).
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import {
  SUBAGENT_SPAWN_IN_PROCESS,
  SubagentSpawnInProcess,
  inject,
  name as pluginName,
} from '../src/index.ts'
import * as spawnPlugin from '../src/index.ts'

describe('subagent-spawn-in-process wiring', () => {
  it('apply() exposes SubagentSpawnInProcess under the SUBAGENT_SPAWN_IN_PROCESS cordis key', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawnPlugin, { providerName: 'spawn' })
    expect(ctx[SUBAGENT_SPAWN_IN_PROCESS]).toBeInstanceOf(SubagentSpawnInProcess)
  })

  it('apply() registers the spawn provider under the configured providerName', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawnPlugin, { providerName: 'spawn' })
    expect(ctx.subagents.getProvider('spawn')).toBeDefined()
  })

  it('the spawn provider advertises every supported start-time capability', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawnPlugin, { providerName: 'spawn' })
    const provider = ctx.subagents.getProvider('spawn')!
    expect(provider.capabilities).toEqual({ outputSchema: true, depthLimit: true, toolFilter: true, persona: true })
  })

  it('the plugin export shape survives cordis unwrapExports (name, inject, apply all preserved)', () => {
    // Mirrors the loader's name+inject extraction so a package that loses
    // either field cannot be re-loaded by HMR.
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(spawnPlugin) as Record<string, unknown>
    expect(unwrapped.name).toBe(pluginName)
    expect(unwrapped.inject).toEqual(inject)
    expect(typeof unwrapped.apply).toBe('function')
  })
})
