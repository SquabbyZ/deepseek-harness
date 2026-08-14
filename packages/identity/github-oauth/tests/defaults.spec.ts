import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentityService } from '../src/index.ts'
import { GitHubIdentityProvider } from '../src/github.ts'
import { LoopbackCallbackServer } from '../src/loopback.ts'
import { IDENTITY_FILE } from '../src/persistence.ts'
import type { IdentityId } from '../src/identity.ts'

vi.mock('../src/github.ts', () => ({
  GitHubIdentityProvider: vi.fn(function () {
    return {
      begin: () => ({ verifier: 'v', state: 's', authorizeUrl: 'https://a.b/authorize' }),
      exchangeCodeForToken: async () => 'tok',
      fetchIdentity: async () => ({ id: 'github:1' as IdentityId, provider: 'github', name: 'Octo' }),
    }
  }),
}))

vi.mock('../src/loopback.ts', () => ({
  LoopbackCallbackServer: vi.fn(function () {
    return {
      listen: async () => {},
      get boundPort() { return 3846 },
      waitForCallback: async () => ({ code: 'c', state: 's' }),
      close: async () => {},
    }
  }),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

const ProviderMock = GitHubIdentityProvider as unknown as ReturnType<typeof vi.fn>
const LoopbackMock = LoopbackCallbackServer as unknown as ReturnType<typeof vi.fn>
const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>

const config = { redirectUri: 'http://127.0.0.1:3846/callback', clientId: 'c' }

let home = ''

describe('IdentityService production defaults', () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-oauth-defaults-'))
    process.env.DSH_HOME = home
    ProviderMock.mockClear()
    LoopbackMock.mockClear()
    spawnMock.mockClear()
  })

  afterEach(() => { delete process.env.DSH_HOME })

  it('loads the persisted identity when no load seam is injected', () => {
    const identity = { id: 'github:9' as IdentityId, provider: 'github', name: 'Nine' }
    writeFileSync(join(home, IDENTITY_FILE), JSON.stringify(identity), 'utf8')
    const service = new IdentityService(config)
    expect(service.current()).toEqual(identity)
  })

  it('composes the real provider, loopback, browser opener, and persistence', async () => {
    const service = new IdentityService(config)
    expect(service.current()).toBeNull()
    const identity = await service.login()
    expect(identity).toEqual({ id: 'github:1', provider: 'github', name: 'Octo' })
    expect(service.current()).toEqual(identity)
    // Provider was built with the client id + redirect uri.
    expect(ProviderMock).toHaveBeenCalledWith({ clientId: 'c', redirectUri: 'http://127.0.0.1:3846/callback' })
    // Loopback defaults to the fixed callback port when none is configured.
    expect(LoopbackMock).toHaveBeenCalledWith(3846)
    // The default OS browser opener ran (spawn was invoked).
    expect(spawnMock).toHaveBeenCalled()
    // Identity was persisted through the default saveIdentity.
    expect(JSON.parse(readFileSync(join(home, IDENTITY_FILE), 'utf8'))).toEqual(identity)
  })

  it('clears the persisted identity on logout when no clear seam is injected', async () => {
    const identity = { id: 'github:9' as IdentityId, provider: 'github', name: 'Nine' }
    writeFileSync(join(home, IDENTITY_FILE), JSON.stringify(identity), 'utf8')
    const service = new IdentityService(config)
    await service.logout()
    expect(existsSync(join(home, IDENTITY_FILE))).toBe(false)
    expect(service.current()).toBeNull()
  })
})
