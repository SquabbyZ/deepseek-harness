/**
 * SkillInventoryGateway: user overlay wrapping `ctx.skills.snapshot/list/get`.
 *
 * The gateway is what makes toggling a skill in 技能管理 actually remove
 * the skill from the next prompt's model-facing catalog (the
 * `dsh-tool-skill` `available_skills` block) and from the `/` palette
 * (`api-proxy.skills.list`). Without the wrap the toggle only updated the
 * inventory UI; the runtime registry kept returning the skill and the
 * `isModelInvocable` / `isUserInvocable` filters were a no-op.
 *
 * The suite boots a Cordis context with the real SkillRegistry (driven by
 * an in-memory provider) and the real Settings stack (driven by
 * MemorySettings) and walks every state transition that matters to the
 * prompt:
 *  - baseline (no overlay): both invocations stay as the cordis defaults,
 *  - toggle off: `modelInvocable: false`, `userInvocable: false`, so the
 *    model-facing catalog filter `isModelInvocable(skill)` drops the row
 *    and `/` palette's `isUserInvocable` filter drops it too,
 *  - toggle back on: `modelInvocable: true`, `userInvocable: true`,
 *    including for cordis-disabled skills the user wants to force-enable,
 *  - `get()` returns the same wrapped invocation shape the prompt sees,
 *  - `skill-inventory/changed` carries a real snapshot, not the historical
 *    empty placeholder.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SkillInventoryGateway, {
  SKILL_INVENTORY_SETTINGS_NAMESPACE,
} from '../src/index.ts'
import type { SkillInventoryChangedPayload } from '../src/types.ts'
import { memoryProvider, type SkillEntrySeed } from './memory-skills.ts'
import { MemorySettings } from './memory-settings.ts'

const seededSkills: SkillEntrySeed[] = [
  { name: 'shell', description: 'Run shell commands.', invocation: { modelInvocable: true, userInvocable: true } },
  { name: 'web-search', description: 'Search the web.', invocation: { modelInvocable: true, userInvocable: true } },
  // Cordis-disabled model surface: provider says `disable-model-invocation`,
  // and the user can still flip it back on through the inventory toggle.
  { name: 'agent-loop', description: 'Internal agent loop.', invocation: { modelInvocable: false, userInvocable: true } },
  // Cordis-disabled both surfaces: a bundled README-style helper that
  // neither model nor `/` palette should normally surface.
  { name: 'notes', description: 'Local notes.', invocation: { modelInvocable: false, userInvocable: false } },
]

interface BootResult {
  ctx: Context
  cleanup: () => Promise<void>
}

async function boot(): Promise<BootResult> {
  const ctx = new Context()
  const skillsFiber = ctx.plugin(SkillRegistry)
  await skillsFiber
  ctx.skills.registerProvider(() => memoryProvider(seededSkills))
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber
  const gatewayFiber = ctx.plugin(SkillInventoryGateway)
  await gatewayFiber
  return {
    ctx,
    cleanup: async () => {
      await gatewayFiber.dispose()
      await settingsFiber.dispose()
      await skillsFiber.dispose()
    },
  }
}

const cleanupFns: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanupFns.length > 0) {
    const fn = cleanupFns.pop()
    if (fn !== undefined) await fn()
  }
})

/**
 * Wait for one microtask tick so the gateway's async refresh path
 * (settings/updated → refreshInventoryAndNotify → skill-inventory/changed)
 * completes before the test inspects the emitted payload. The listener
 * fires inside the settings commit synchronously, but its inner emit is
 * reached only after the awaited registry snapshot settles.
 */
async function flushGatewayEmit(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('SkillInventoryGateway — registry override', () => {
  let bootResult: BootResult

  beforeEach(async () => {
    bootResult = await boot()
    cleanupFns.push(bootResult.cleanup)
  })

  it('leaves the catalog unchanged when no user overlay exists', async () => {
    const { ctx } = bootResult
    const snapshot = await ctx.skills.snapshot()
    const listed = await ctx.skills.list()
    expect(snapshot.complete).toBe(true)
    expect(snapshot.skills.map(skill => [skill.name, skill.invocation])).toEqual([
      ['agent-loop', { modelInvocable: false, userInvocable: true }],
      ['notes', { modelInvocable: false, userInvocable: false }],
      ['shell', { modelInvocable: true, userInvocable: true }],
      ['web-search', { modelInvocable: true, userInvocable: true }],
    ])
    expect(listed.map(skill => skill.name)).toEqual(['agent-loop', 'notes', 'shell', 'web-search'])
  })

  it('drops a toggled-off skill from the model-facing catalog and the user palette', async () => {
    const { ctx } = bootResult
    await ctx.skills.snapshot() // warm the cache; the override must still apply on the next read.
    await ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: { shell: false } })

    const snapshot = await ctx.skills.snapshot()
    expect(snapshot.skills.find(skill => skill.name === 'shell')?.invocation).toEqual({
      modelInvocable: false,
      userInvocable: false,
    })
    // The prompt-facing catalog filters `isModelInvocable`; only web-search
    // survives (cordis model+user; no override). agent-loop and notes are
    // cordis model-disabled, shell is user-disabled via this toggle.
    const modelVisible = snapshot.skills.filter(isModelInvocable).map(skill => skill.name)
    const userVisible = snapshot.skills.filter(isUserInvocable).map(skill => skill.name)
    expect(modelVisible).toEqual(['web-search'])
    expect(userVisible).toEqual(['agent-loop', 'web-search'])
  })

  it('force-enables a cordis-disabled skill when the user toggles it back on', async () => {
    const { ctx } = bootResult
    await ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: { 'agent-loop': true } })

    const snapshot = await ctx.skills.snapshot()
    const reenabled = snapshot.skills.find(skill => skill.name === 'agent-loop')
    expect(reenabled?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('lets a fresh toggle over an existing one win (no merge-induced leak)', async () => {
    const { ctx } = bootResult
    await ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: { shell: false } })
    expect((await ctx.skills.snapshot()).skills.find(skill => skill.name === 'shell')?.invocation).toEqual({
      modelInvocable: false,
      userInvocable: false,
    })
    await ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: { shell: true } })
    expect((await ctx.skills.snapshot()).skills.find(skill => skill.name === 'shell')?.invocation).toEqual({
      modelInvocable: true,
      userInvocable: true,
    })
  })

  it('keeps list() and get() consistent with snapshot() under the override', async () => {
    const { ctx } = bootResult
    await ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: { shell: false, notes: true } })

    const list = await ctx.skills.list()
    expect(list.find(skill => skill.name === 'shell')?.invocation).toEqual({
      modelInvocable: false,
      userInvocable: false,
    })
    expect(list.find(skill => skill.name === 'notes')?.invocation).toEqual({
      modelInvocable: true,
      userInvocable: true,
    })

    const shellBody = await ctx.skills.get('shell')
    expect(shellBody?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    const notesBody = await ctx.skills.get('notes')
    expect(notesBody?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(shellBody?.content).toBe('shell body.')
    expect(notesBody?.content).toBe('notes body.')
  })

  it('emits skill-inventory/changed with a recomputed snapshot after a settings commit', async () => {
    const { ctx } = bootResult
    const events: SkillInventoryChangedPayload[] = []
    ctx.on('skill-inventory/changed', (payload) => {
      events.push(payload)
    })

    await ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: { shell: false } })
    await flushGatewayEmit()

    expect(events.length).toBeGreaterThan(0)
    const last = events.at(-1)?.snapshot
    expect(last).toBeDefined()
    const shell = last?.entries.find(entry => entry.name === 'shell')
    expect(shell?.enabled).toBe(false)
    expect(shell?.disabledReason).toBe('user')
  })
})
