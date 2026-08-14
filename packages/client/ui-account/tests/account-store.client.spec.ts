/** Account controller: the identity read, the login poll, logout, and the fetch wire adapter. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountController, fetchAccountApi } from '../src/client/account-store.ts'
import type { AccountApi, AccountIdentity, AccountStatusResult } from '../src/client/account-store.ts'

afterEach(() => { vi.unstubAllGlobals() })

const IDENTITY: AccountIdentity = { id: 'u1', provider: 'github', name: 'octocat' }

function api(overrides: Partial<AccountApi> = {}): AccountApi {
  return {
    status: vi.fn(async () => ({ identity: null, error: null })),
    start: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    ...overrides,
  }
}

function controller(
  overrides: Partial<AccountApi> = {},
  poll: { intervalMs: number; attempts: number } = { intervalMs: 0, attempts: 2 },
): { c: AccountController; wire: AccountApi } {
  const wire = api(overrides)
  return { c: new AccountController(wire, poll), wire }
}

describe('AccountController.load', () => {
  it('marks a linked identity signed-in', async () => {
    const { c } = controller({ status: async () => ({ identity: IDENTITY, error: null }) })
    await c.load()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-in', identity: IDENTITY, error: null })
  })

  it('marks an absent identity signed-out', async () => {
    const { c } = controller({ status: async () => ({ identity: null, error: null }) })
    await c.load()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: null })
  })

  it('surfaces a server error as the localized error key', async () => {
    const { c } = controller({ status: async () => ({ identity: null, error: 'token expired' }) })
    await c.load()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: 'error' })
  })

  it('surfaces a wire failure as the localized error key', async () => {
    const { c } = controller({ status: async () => { throw new Error('offline') } })
    await c.load()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: 'error' })
  })

  it('ignores a stale completion once superseded', async () => {
    let resolveStatus!: (result: AccountStatusResult) => void
    const { c } = controller({
      status: vi.fn(() => new Promise<AccountStatusResult>((resolve) => { resolveStatus = resolve })),
    })
    const stale = c.load()
    c.dispose()
    resolveStatus({ identity: IDENTITY, error: null })
    await stale
    expect(c.store.getSnapshot()).toEqual({ status: 'checking', identity: null, error: null })
  })

  it('ignores a stale failure once superseded', async () => {
    let rejectStatus!: (reason: unknown) => void
    const { c } = controller({
      status: vi.fn(() => new Promise<AccountStatusResult>((_, reject) => { rejectStatus = reject })),
    })
    const stale = c.load()
    c.dispose()
    rejectStatus(new Error('offline'))
    await stale
    expect(c.store.getSnapshot()).toEqual({ status: 'checking', identity: null, error: null })
  })
})

describe('AccountController.login', () => {
  it('polls until the identity appears', async () => {
    const status = vi.fn()
      .mockResolvedValueOnce({ identity: null, error: null })
      .mockResolvedValueOnce({ identity: IDENTITY, error: null })
    const { c } = controller({ status }, { intervalMs: 0, attempts: 3 })
    await c.login()
    expect(status).toHaveBeenCalledTimes(2)
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-in', identity: IDENTITY, error: null })
  })

  it('surfaces a server error reported mid-poll', async () => {
    const { c } = controller({ status: async () => ({ identity: null, error: 'denied' }) }, { intervalMs: 0, attempts: 3 })
    await c.login()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: 'error' })
  })

  it('times out when the poll window expires without a result', async () => {
    const { c } = controller({ status: async () => ({ identity: null, error: null }) }, { intervalMs: 0, attempts: 1 })
    await c.login()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: 'timeout' })
  })

  it('surfaces a start failure', async () => {
    const { c } = controller({ start: async () => { throw new Error('unavailable') } })
    await c.login()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: 'error' })
  })

  it('surfaces a poll failure', async () => {
    const { c } = controller({ status: async () => { throw new Error('offline') } })
    await c.login()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: 'error' })
  })

  it('stops polling once disposed during a status read', async () => {
    let resolveStatus!: (result: AccountStatusResult) => void
    const status = vi.fn(() => new Promise<AccountStatusResult>((resolve) => { resolveStatus = resolve }))
    const { c } = controller({ status }, { intervalMs: 0, attempts: 3 })
    const pending = c.login()
    await vi.waitFor(() => { expect(status).toHaveBeenCalled() })
    c.dispose()
    resolveStatus({ identity: IDENTITY, error: null })
    await pending
    expect(status).toHaveBeenCalledTimes(1)
    expect(c.store.getSnapshot()).toEqual({ status: 'signing-in', identity: null, error: null })
  })

  it('ignores a stale start failure once superseded', async () => {
    let rejectStart!: (reason: unknown) => void
    const { c } = controller({
      start: vi.fn(() => new Promise<void>((_, reject) => { rejectStart = reject })),
    })
    const pending = c.login()
    c.dispose()
    rejectStart(new Error('unavailable'))
    await pending
    expect(c.store.getSnapshot()).toEqual({ status: 'signing-in', identity: null, error: null })
  })
})

describe('AccountController.logout', () => {
  it('clears the identity on success', async () => {
    const { c } = controller()
    c.store.set({ status: 'signed-in', identity: IDENTITY, error: null })
    await c.logout()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: null, error: null })
  })

  it('keeps the identity and surfaces a failure when the wire throws', async () => {
    const { c } = controller({ logout: async () => { throw new Error('offline') } })
    c.store.set({ status: 'signed-in', identity: IDENTITY, error: null })
    await c.logout()
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-out', identity: IDENTITY, error: 'error' })
  })

  it('ignores a stale completion once superseded', async () => {
    let resolveLogout!: () => void
    const { c } = controller({
      logout: vi.fn(() => new Promise<void>((resolve) => { resolveLogout = resolve })),
    })
    c.store.set({ status: 'signed-in', identity: IDENTITY, error: null })
    const pending = c.logout()
    c.dispose()
    resolveLogout()
    await pending
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-in', identity: IDENTITY, error: null })
  })

  it('ignores a stale failure once superseded', async () => {
    let rejectLogout!: (reason: unknown) => void
    const { c } = controller({
      logout: vi.fn(() => new Promise<void>((_, reject) => { rejectLogout = reject })),
    })
    c.store.set({ status: 'signed-in', identity: IDENTITY, error: null })
    const pending = c.logout()
    c.dispose()
    rejectLogout(new Error('offline'))
    await pending
    expect(c.store.getSnapshot()).toEqual({ status: 'signed-in', identity: IDENTITY, error: null })
  })
})

describe('fetchAccountApi', () => {
  it('reads the changed status shape through an injected fetch', async () => {
    const json = vi.fn(async () => ({ identity: IDENTITY, error: 'boom' }))
    const fetchImpl = vi.fn(async () => ({ json }))
    const wire = fetchAccountApi(fetchImpl as unknown as typeof fetch)
    await expect(wire.status()).resolves.toEqual({ identity: IDENTITY, error: 'boom' })
    expect(fetchImpl).toHaveBeenCalledWith('/auth/github/status')
  })

  it('posts start and logout', async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({}) }))
    const wire = fetchAccountApi(fetchImpl as unknown as typeof fetch)
    await wire.start()
    await wire.logout()
    expect(fetchImpl).toHaveBeenCalledWith('/auth/github/start', { method: 'POST' })
    expect(fetchImpl).toHaveBeenCalledWith('/auth/github/logout', { method: 'POST' })
  })

  it('falls back to the global fetch by default', async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ identity: null, error: null }) }))
    vi.stubGlobal('fetch', fetchImpl)
    const wire = fetchAccountApi()
    await expect(wire.status()).resolves.toEqual({ identity: null, error: null })
    expect(fetchImpl).toHaveBeenCalledWith('/auth/github/status')
  })
})
