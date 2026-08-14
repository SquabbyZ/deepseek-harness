import { describe, expect, it } from 'vitest'
import { IdentityService, type IdentityServiceDeps } from '../src/index.ts'
import type { Identity, IdentityId } from '../src/identity.ts'

function makeService(overrides: Partial<IdentityServiceDeps> = {}) {
  const store: { value: Identity | null } = { value: null }
  const service = new IdentityService(
    { redirectUri: 'http://127.0.0.1:3846/callback', clientId: 'c' },
    {
      load: () => store.value,
      save: (i) => { store.value = i },
      clear: () => { store.value = null },
      providerFactory: () => ({
        begin: () => ({ verifier: 'v', state: 's', authorizeUrl: 'https://a.b/authorize' }),
        exchangeCodeForToken: async (_c, _v) => 'tok',
        fetchIdentity: async () => ({ id: 'github:1' as IdentityId, provider: 'github', name: 'Octo' }),
      }),
      loopbackFactory: () => ({
        listen: async () => {},
        boundPort: 3846,
        waitForCallback: async () => ({ code: 'c', state: 's' }),
        close: async () => {},
      }),
      openBrowser: () => {},
      ...overrides,
    },
  )
  return service
}

describe('IdentityService', () => {
  it('logs in, persists, and exposes the identity', async () => {
    const service = makeService()
    expect(service.current()).toBeNull()
    const identity = await service.login()
    expect(identity).toEqual({ id: 'github:1', provider: 'github', name: 'Octo' })
    expect(service.current()).toEqual(identity)
  })

  it('rejects when the callback state mismatches', async () => {
    const service = makeService({
      loopbackFactory: () => ({
        listen: async () => {}, boundPort: 3846,
        waitForCallback: async () => ({ code: 'c', state: 'OTHER' }),
        close: async () => {},
      }),
    })
    await expect(service.login()).rejects.toThrow(/state mismatch/)
  })

  it('clears the identity on logout', async () => {
    const service = makeService()
    await service.login()
    await service.logout()
    expect(service.current()).toBeNull()
  })
})
