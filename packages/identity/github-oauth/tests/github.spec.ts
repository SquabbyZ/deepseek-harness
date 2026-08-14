import { describe, expect, it } from 'vitest'
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

  it('exchangeCodeForToken posts code_verifier and no client_secret', async () => {
    const calls: RequestInit[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return jsonResponse({ access_token: 'tok-1' })
    }) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    const token = await provider.exchangeCodeForToken('code-1', 'verifier-1')
    expect(token).toBe('tok-1')
    const body = new URLSearchParams(calls[0]?.body as string)
    expect(body.get('code_verifier')).toBe('verifier-1')
    expect(body.get('client_secret')).toBeNull()
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

  it('throws a clear error when the token exchange reports an error', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad_verification_code', error_description: 'nope' })) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    await expect(provider.exchangeCodeForToken('c', 'v')).rejects.toThrow(/bad_verification_code/)
  })
})
