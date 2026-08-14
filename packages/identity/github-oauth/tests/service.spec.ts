import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { IdentityService, type IdentityServiceDeps } from '../src/index.ts'
import type { Identity, IdentityId } from '../src/identity.ts'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

const spawnMock = vi.mocked(spawn)

const identity: Identity = { id: 'github:1' as IdentityId, provider: 'github', name: 'Octo' }

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
        fetchIdentity: async () => identity,
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

/** Same seams as makeService but with `openBrowser` omitted so the OS opener runs. */
function makeBrowserService(): IdentityService {
  return new IdentityService(
    { redirectUri: 'http://127.0.0.1:3846/callback', clientId: 'c' },
    {
      load: () => null,
      save: () => {},
      clear: () => {},
      providerFactory: () => ({
        begin: () => ({ verifier: 'v', state: 's', authorizeUrl: 'https://a.b/authorize?client_id=c&state=s' }),
        exchangeCodeForToken: async () => 'tok',
        fetchIdentity: async () => identity,
      }),
      loopbackFactory: () => ({
        listen: async () => {},
        boundPort: 3846,
        waitForCallback: async () => ({ code: 'c', state: 's' }),
        close: async () => {},
      }),
    },
  )
}

async function withPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    await run()
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

describe('IdentityService', () => {
  it('logs in, persists, and exposes the identity', async () => {
    const service = makeService()
    expect(service.current()).toBeNull()
    const result = await service.login()
    expect(result).toEqual(identity)
    expect(service.current()).toEqual(result)
    expect(service.lastError()).toBeNull()
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
    expect(service.lastError()).toMatch(/state mismatch/)
  })

  it('clears the identity on logout', async () => {
    const service = makeService()
    await service.login()
    await service.logout()
    expect(service.current()).toBeNull()
  })

  it('throws and records lastError when the client id is missing', async () => {
    const service = new IdentityService({ redirectUri: 'http://127.0.0.1:3846/callback' }, {
      load: () => null, save: () => {}, clear: () => {},
    })
    await expect(service.login()).rejects.toThrow(/client id not configured/)
    expect(service.current()).toBeNull()
    expect(service.lastError()).toMatch(/client id not configured/)
  })

  it('records a non-Error rejection as a string error', async () => {
    const service = makeService({
      loopbackFactory: () => ({
        listen: async () => {}, boundPort: 3846,
        waitForCallback: async () => { throw 'boom' },
        close: async () => {},
      }),
    })
    await expect(service.login()).rejects.toBe('boom')
    expect(service.lastError()).toBe('boom')
  })

  it('clears lastError on logout', async () => {
    const service = makeService({
      loopbackFactory: () => ({
        listen: async () => {}, boundPort: 3846,
        waitForCallback: async () => { throw new Error('boom') },
        close: async () => {},
      }),
    })
    await expect(service.login()).rejects.toThrow(/boom/)
    expect(service.lastError()).toBe('boom')
    await service.logout()
    expect(service.lastError()).toBeNull()
  })

  it('shares one in-flight login across concurrent callers', async () => {
    let begins = 0
    const service = makeService({
      providerFactory: () => {
        begins += 1
        return {
          begin: () => ({ verifier: 'v', state: 's', authorizeUrl: 'https://a.b/authorize' }),
          exchangeCodeForToken: async () => 'tok',
          fetchIdentity: async () => identity,
        }
      },
    })
    const [a, b] = await Promise.all([service.login(), service.login()])
    expect(a).toEqual(identity)
    expect(b).toEqual(identity)
    expect(begins).toBe(1)
  })

  it('resets the in-flight guard so a later login starts fresh', async () => {
    let begins = 0
    const service = makeService({
      providerFactory: () => {
        begins += 1
        return {
          begin: () => ({ verifier: 'v', state: 's', authorizeUrl: 'https://a.b/authorize' }),
          exchangeCodeForToken: async () => 'tok',
          fetchIdentity: async () => identity,
        }
      },
    })
    await service.login()
    await service.login()
    expect(begins).toBe(2)
  })

  it('discards an in-flight login that completes after logout', async () => {
    let resolveCallback: (r: { code: string; state: string }) => void = () => {}
    let armed = false
    const saved: Identity[] = []
    const service = makeService({
      save: (i) => { saved.push(i) },
      loopbackFactory: () => ({
        listen: async () => {},
        boundPort: 3846,
        waitForCallback: () => {
          armed = true
          return new Promise((resolve) => { resolveCallback = resolve })
        },
        close: async () => {},
      }),
    })
    const loginPromise = service.login()
    await vi.waitFor(() => { expect(armed).toBe(true) })
    await service.logout()
    resolveCallback({ code: 'c', state: 's' })
    await expect(loginPromise).rejects.toThrow(/superseded/)
    expect(service.current()).toBeNull()
    expect(saved).toHaveLength(0)
    expect(service.lastError()).toBeNull()
  })
})

describe('openInSystemBrowser', () => {
  it('quotes the url for the Windows cmd opener', async () => {
    await withPlatform('win32', async () => {
      spawnMock.mockClear()
      await makeBrowserService().login()
      expect(spawnMock).toHaveBeenCalledWith(
        'cmd',
        ['/c', 'start', '', '"https://a.b/authorize?client_id=c&state=s"'],
        { detached: true, stdio: 'ignore' },
      )
    })
  })

  it('uses open on macOS', async () => {
    await withPlatform('darwin', async () => {
      spawnMock.mockClear()
      await makeBrowserService().login()
      expect(spawnMock).toHaveBeenCalledWith(
        'open',
        ['https://a.b/authorize?client_id=c&state=s'],
        { detached: true, stdio: 'ignore' },
      )
    })
  })

  it('uses xdg-open elsewhere', async () => {
    await withPlatform('linux', async () => {
      spawnMock.mockClear()
      await makeBrowserService().login()
      expect(spawnMock).toHaveBeenCalledWith(
        'xdg-open',
        ['https://a.b/authorize?client_id=c&state=s'],
        { detached: true, stdio: 'ignore' },
      )
    })
  })
})
