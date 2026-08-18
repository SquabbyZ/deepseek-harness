import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  PLUGIN_INVENTORY_ERROR_ENTRY_NOT_FOUND,
  PLUGIN_INVENTORY_ERROR_LOADER_UPDATE,
  PLUGIN_INVENTORY_ERROR_SETTINGS_UPDATE,
  PLUGIN_INVENTORY_SETTINGS_NAMESPACE,
  PluginInventoryGateway,
} from '../src/index.ts'

/** In-memory settings provider for tests: exposes raw `doc` and observed `persisted` writes. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>
  persisted: Array<{ ns: SettingsNamespace; section: Record<string, unknown> }> = []

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: {
    doc?: Record<string, unknown>
  }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.persisted.push({ ns, section: structuredClone(section) })
    this.doc[ns] = structuredClone(section)
  }

  /** Simulate an external storage change reaching the provider. */
  pushExternal(doc: Record<string, unknown>): void {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
}

/** `ctx.loader.entries()` is a generator; tests need an array lookup. */
function findLoaderEntry(ctx: Context, id: string) {
  for (const candidate of ctx.loader.entries()) {
    if (candidate.id === id) return candidate
  }
  return undefined
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
  settings: MemorySettings
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(MemorySettings)
  const settings = ctx.get('settings') as MemorySettings
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory, settings }
}

describe('PluginInventoryGateway', () => {
  it('publishes two direct list methods under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        disabledReason: null,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        disabledReason: null,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        disabledReason: 'cordis',
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      disabledReason: 'cordis',
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })
})

describe('PluginInventoryGateway disabledReason overlay', () => {
  it("marks `disabledReason: 'user'` when the override disables an otherwise-on entry", async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:active' })
    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, { enabled: { [id]: false } })
    const entry = inventory.list().entries.find(candidate => candidate.entryId === id)
    expect(entry).toEqual({
      entryId: id,
      moduleName: 'cordis:active',
      enabled: false,
      disabledReason: 'user',
      fiberPhase: 'active',
    })
  })

  it("prefers `'user'` over `'cordis'` when both would disable the entry", async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:active', disabled: true })
    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, { enabled: { [id]: false } })
    const entry = inventory.list().entries.find(candidate => candidate.entryId === id)
    expect(entry?.disabledReason).toBe('user')
    expect(entry?.enabled).toBe(false)
  })

  it('re-enables an entry the user previously disabled', async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:active' })
    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, { enabled: { [id]: false } })
    expect(inventory.list().entries.find(candidate => candidate.entryId === id)?.enabled).toBe(false)
    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, { enabled: { [id]: true } })
    const entry = inventory.list().entries.find(candidate => candidate.entryId === id)
    expect(entry).toMatchObject({ enabled: true, disabledReason: null })
  })

  it('ignores override keys whose entry id is not in the Loader tree', async () => {
    const { ctx, inventory } = await harness()
    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, {
      enabled: { 'orphan-entry': false },
    })
    expect(inventory.list().entries).toEqual([])
  })
})

describe('PluginInventoryGateway setEnabled', () => {
  it('persists the override and applies it to the Loader entry', async () => {
    const { ctx, inventory, settings } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:active' })
    await inventory.setEnabled({ entryId: id, enabled: false }, new AbortController().signal)

    expect(settings.doc[PLUGIN_INVENTORY_SETTINGS_NAMESPACE]).toEqual({ enabled: { [id]: false } })
    const entry = findLoaderEntry(ctx, id)
    expect(entry?.disabled).toBe(true)
    const projection = inventory.list().entries.find(candidate => candidate.entryId === id)
    expect(projection).toMatchObject({ enabled: false, disabledReason: 'user' })
  })

  it('clears a prior user override when enabled=true is committed', async () => {
    const { ctx, inventory, settings } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:active' })
    await inventory.setEnabled({ entryId: id, enabled: false }, new AbortController().signal)
    await inventory.setEnabled({ entryId: id, enabled: true }, new AbortController().signal)

    expect(settings.doc[PLUGIN_INVENTORY_SETTINGS_NAMESPACE]).toEqual({ enabled: { [id]: true } })
    const entry = findLoaderEntry(ctx, id)
    expect(entry?.disabled).toBe(false)
  })

  it('rejects an unknown entryId with a typed entry-not-found error', async () => {
    const { inventory } = await harness()
    await expect(inventory.setEnabled({ entryId: 'no-such-entry', enabled: false }, new AbortController().signal))
      .rejects.toMatchObject({ code: PLUGIN_INVENTORY_ERROR_ENTRY_NOT_FOUND })
  })

  it('rolls back the settings write when the Loader entry update throws', async () => {
    const { ctx, inventory, settings } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:active' })
    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, { enabled: {} })

    const entry = findLoaderEntry(ctx, id)!
    const originalUpdate = entry.update.bind(entry)
    entry.update = (async (options: Parameters<typeof entry.update>[0]) => {
      if (options.disabled === true) throw new Error('forced loader update failure')
      return originalUpdate(options as never)
    }) as typeof entry.update

    await expect(inventory.setEnabled({ entryId: id, enabled: false }, new AbortController().signal))
      .rejects.toMatchObject({ code: PLUGIN_INVENTORY_ERROR_LOADER_UPDATE })

    expect(settings.doc[PLUGIN_INVENTORY_SETTINGS_NAMESPACE]).toEqual({ enabled: {} })
  })

  it('surfaces the settings update failure without touching the Loader', async () => {
    const { ctx, inventory } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:active' })
    const settings = ctx.settings
    const originalUpdate = settings.update.bind(settings)
    let attempts = 0
    settings.update = (async (ns: never, patch: never) => {
      attempts += 1
      if (attempts === 1) throw new Error('forced settings failure')
      return originalUpdate(ns, patch)
    }) as typeof settings.update

    await expect(inventory.setEnabled({ entryId: id, enabled: false }, new AbortController().signal))
      .rejects.toMatchObject({ code: PLUGIN_INVENTORY_ERROR_SETTINGS_UPDATE })

    const entry = findLoaderEntry(ctx, id)
    expect(entry?.disabled).toBe(false)
  })

  it('throws synchronously when the AbortSignal is already aborted', async () => {
    const { inventory } = await harness()
    const controller = new AbortController()
    controller.abort()
    await expect(inventory.setEnabled({ entryId: 'any', enabled: true }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('PluginInventoryGateway event emission', () => {
  it("emits `'plugin-inventory/changed'` after every settings commit on its namespace", async () => {
    const { ctx } = await harness()
    const events: unknown[] = []
    ctx.on('plugin-inventory/changed', (payload: unknown) => { events.push(payload) })

    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, { enabled: { x: false } })
    await ctx.settings.update(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, { enabled: { x: false, y: true } })

    expect(events).toHaveLength(2)
    expect(events.every(event => typeof event === 'object' && event !== null && 'snapshot' in event)).toBe(true)
  })

  it('does not emit when an unrelated settings namespace updates', async () => {
    const { ctx, settings } = await harness()
    const events: unknown[] = []
    ctx.on('plugin-inventory/changed', (payload: unknown) => { events.push(payload) })

    // Persist externally through the provider — `commit` still fires, but on a
    // namespace the gateway does not own, so no emission should reach us.
    settings.pushExternal({ 'unrelated-ns': { x: 1 } })

    expect(events).toEqual([])
  })
})
