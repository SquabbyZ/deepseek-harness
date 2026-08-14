/** Account registrations: the settings section seat, its dictionaries, and the inject face. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { AccountSection } from '../src/client/AccountSection.tsx'
import type { AccountSectionInjected } from '../src/client/AccountSection.tsx'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A fetch double answering the changed status shape with no linked identity. */
function fetchDouble() {
  return vi.fn(async () => ({ json: async () => ({ identity: null, error: null }) }))
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

/** Declare the settings section the way ui-settings' entry does. */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function accountEntry(slots: SlotRegistry) {
  return slots.entries('settings.section')[0]!
}

function injectedOf(slots: SlotRegistry): AccountSectionInjected {
  return (accountEntry(slots).inject as unknown as () => AccountSectionInjected)()
}

describe('ui-account apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('fills the section seat for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = accountEntry(before.slots)
    expect(entry.component).toBe(AccountSection)
    expect(entry.options).toMatchObject({ id: 'account', order: 100 })
    expect(resolveSlotLabel(entry.options.label)).toBe('账户')
    expect(entry.locale).toBe('account')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(accountEntry(after.slots).component).toBe(AccountSection)
  })

  it('exposes the account snapshot and routes the injected actions to the controller', async () => {
    const fetchImpl = fetchDouble()
    vi.stubGlobal('fetch', fetchImpl)
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = injectedOf(b.slots)
    expect(injected.hooks.account.getSnapshot()).toEqual({ status: 'checking', identity: null, error: null })

    await injected.load()
    expect(injected.hooks.account.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: null })
    expect(fetchImpl).toHaveBeenCalledWith('/auth/github/status')

    await injected.logout()
    expect(fetchImpl).toHaveBeenCalledWith('/auth/github/logout', { method: 'POST' })
  })

  it('polls through the injected login action until the window expires', async () => {
    const fetchImpl = fetchDouble()
    vi.stubGlobal('fetch', fetchImpl)
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = injectedOf(b.slots)

    vi.useFakeTimers()
    const pending = injected.login()
    await vi.advanceTimersByTimeAsync(300 * 1000 + 1)
    await pending
    expect(injected.hooks.account.getSnapshot()).toMatchObject({ status: 'signed-out', error: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledWith('/auth/github/start', { method: 'POST' })
  })

  it('registers the zh/en account dictionaries and frees the namespace on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('account')('nav')).toBe('账户')
    b.locale.setLocale('en')
    expect(b.locale.bind('account')('nav')).toBe('Account')
    b.locale.setLocale('zh')
    await fiber.dispose()
    expect(() => b.locale.register('account', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('account', 'en', {})).not.toThrow()
  })

  it('removes the section seat on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })
})
