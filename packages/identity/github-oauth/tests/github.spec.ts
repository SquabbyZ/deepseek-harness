import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubIdentityProvider } from '../src/github.ts'

const config = {
  clientId: 'test-client',
  redirectUri: 'http://127.0.0.1:3846/callback',
  tokenUrl: 'https://example.test/token',
  authorizeUrl: 'https://example.test/authorize',
  apiBase: 'https://example.test/api',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('GitHubIdentityProvider', () => {
  it('begin() builds a PKCE authorize URL with S256 and no client_secret', () => {
    const provider = new GitHubIdentityProvider(config, { randomUUIDImpl: () => 'fixed-state' })
    const { verifier, state, authorizeUrl } = provider.begin()
    const url = new URL(authorizeUrl)
    expect(state).toBe('fixed-state')
    expect(url.searchParams.get('client_id')).toBe('test-client')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3846/callback')
    expect(verifier).toBeTruthy()
  })

  it('begin() preserves an authorizeUrl that already carries a query string', () => {
    const provider = new GitHubIdentityProvider({ ...config, authorizeUrl: 'https://example.test/authorize?prompt=consent' })
    const url = new URL(provider.begin().authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://example.test/authorize')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('client_id')).toBe('test-client')
  })

  it('begin() falls back to the GitHub authorize URL and default scope', () => {
    const provider = new GitHubIdentityProvider({ clientId: 'test-client', redirectUri: 'http://127.0.0.1:3846/callback' })
    const url = new URL(provider.begin().authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe('read:user user:email')
  })

  it('exchangeCodeForToken posts code_verifier and no client_secret', async () => {
    const calls: RequestInit[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return jsonResponse({ access_token: 'tok-1' })
    })
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    const token = await provider.exchangeCodeForToken('code-1', 'verifier-1')
    expect(token).toBe('tok-1')
    const body = new URLSearchParams(calls[0]?.body as string)
    expect(body.get('code_verifier')).toBe('verifier-1')
    expect(body.get('client_secret')).toBeNull()
  })

  it('exchangeCodeForToken falls back to the GitHub token URL', async () => {
    let seenUrl = ''
    const fetchImpl = (async (url: string) => {
      seenUrl = url
      return jsonResponse({ access_token: 'tok-1' })
    }) as typeof fetch
    const provider = new GitHubIdentityProvider({ clientId: 'test-client', redirectUri: 'http://127.0.0.1:3846/callback' }, { fetchImpl })
    await provider.exchangeCodeForToken('code-1', 'verifier-1')
    expect(seenUrl).toBe('https://github.com/login/oauth/access_token')
  })

  it('exchangeCodeForToken uses the global fetch when none is injected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'tok-1' }))
    vi.stubGlobal('fetch', fetchImpl)
    const provider = new GitHubIdentityProvider({ clientId: 'test-client', redirectUri: 'http://127.0.0.1:3846/callback' })
    await expect(provider.exchangeCodeForToken('c', 'v')).resolves.toBe('tok-1')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('exchangeCodeForToken throws when the token endpoint responds not-ok', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad_verification_code' }, 400)) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    await expect(provider.exchangeCodeForToken('c', 'v')).rejects.toThrow(/token exchange failed \(400\)/)
  })

  it('exchangeCodeForToken throws a clear error when the token exchange reports an error', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad_verification_code', error_description: 'nope' })) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    await expect(provider.exchangeCodeForToken('c', 'v')).rejects.toThrow(/bad_verification_code: nope/)
  })

  it('exchangeCodeForToken tolerates a missing error_description', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad_verification_code' })) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    await expect(provider.exchangeCodeForToken('c', 'v')).rejects.toThrow(/bad_verification_code/)
  })

  it('exchangeCodeForToken throws when the response has no access_token', async () => {
    const fetchImpl = (async () => jsonResponse({})) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    await expect(provider.exchangeCodeForToken('c', 'v')).rejects.toThrow(/no access_token/)
  })

  it('fetchIdentity maps the GitHub user to a provider-agnostic Identity', async () => {
    const fetchImpl = (async () => jsonResponse({
      id: 42, login: 'octocat', name: 'Octo Cat', email: 'octo@example.com', avatar_url: 'https://a.b/av.png',
    })) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    const identity = await provider.fetchIdentity('tok-1')
    expect(identity).toEqual({
      id: 'github:42', provider: 'github', name: 'Octo Cat',
      email: 'octo@example.com', avatar: 'https://a.b/av.png',
    })
  })

  it('fetchIdentity falls back to the api base and global fetch when none injected', async () => {
    let seenUrl = ''
    const fetchImpl = vi.fn(async (url: string) => {
      seenUrl = url
      return jsonResponse({ id: 1, login: 'octocat', name: 'Octo', email: null, avatar_url: null })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const provider = new GitHubIdentityProvider({ clientId: 'test-client', redirectUri: 'http://127.0.0.1:3846/callback' })
    const identity = await provider.fetchIdentity('tok-1')
    expect(seenUrl).toBe('https://api.github.com/user')
    expect(identity).toEqual({ id: 'github:1', provider: 'github', name: 'Octo' })
  })

  it('fetchIdentity throws when the user endpoint responds not-ok', async () => {
    const fetchImpl = (async () => jsonResponse({ message: 'bad token' }, 401)) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    await expect(provider.fetchIdentity('tok-1')).rejects.toThrow(/user fetch failed \(401\)/)
  })

  it('fetchIdentity falls back to login and omits null email/avatar', async () => {
    const fetchImpl = (async () => jsonResponse({ id: 7, login: 'octo', name: null, email: null, avatar_url: null })) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    const identity = await provider.fetchIdentity('tok-1')
    expect(identity).toEqual({ id: 'github:7', provider: 'github', name: 'octo' })
    expect('email' in identity).toBe(false)
    expect('avatar' in identity).toBe(false)
  })
})
