import { randomUUID } from 'node:crypto'
import type { Identity } from './identity.ts'
import { computeS256Challenge, generateCodeVerifier } from './pkce.ts'

export interface GitHubOAuthConfig {
  clientId: string
  redirectUri: string
  scope?: string
  authorizeUrl?: string
  tokenUrl?: string
  apiBase?: string
}

/** The artifacts a login attempt needs: the verifier to hold, the state to check, and the URL to open. */
export interface AuthorizationRequest {
  verifier: string
  state: string
  authorizeUrl: string
}

interface GitHubUser {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
}

export interface GitHubProviderDeps {
  fetchImpl?: typeof fetch
  randomUUIDImpl?: () => string
}

/** PKCE (S256) GitHub OAuth client. Public client: no client_secret. */
export class GitHubIdentityProvider {
  constructor(
    private readonly config: GitHubOAuthConfig,
    private readonly deps: GitHubProviderDeps = {},
  ) {}

  begin(): AuthorizationRequest {
    const verifier = generateCodeVerifier()
    const state = (this.deps.randomUUIDImpl ?? randomUUID)()
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope ?? 'read:user user:email',
      state,
      code_challenge: computeS256Challenge(verifier),
      code_challenge_method: 'S256',
    })
    const authorizeUrl = `${this.config.authorizeUrl ?? 'https://github.com/login/oauth/authorize'}?${params}`
    return { verifier, state, authorizeUrl }
  }

  async exchangeCodeForToken(code: string, verifier: string): Promise<string> {
    const tokenUrl = this.config.tokenUrl ?? 'https://github.com/login/oauth/access_token'
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    })
    const res = await (this.deps.fetchImpl ?? fetch)(tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`github oauth: token exchange failed (${res.status})`)
    const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string }
    if (json.error) throw new Error(`github oauth: ${json.error}: ${json.error_description ?? ''}`)
    if (!json.access_token) throw new Error('github oauth: response had no access_token')
    return json.access_token
  }

  async fetchIdentity(accessToken: string): Promise<Identity> {
    const apiBase = this.config.apiBase ?? 'https://api.github.com'
    const res = await (this.deps.fetchImpl ?? fetch)(`${apiBase}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dsh-desktop',
      },
    })
    if (!res.ok) throw new Error(`github oauth: user fetch failed (${res.status})`)
    const user = (await res.json()) as GitHubUser
    return {
      id: `github:${user.id}` as Identity['id'],
      provider: 'github',
      name: user.name ?? user.login,
      ...(user.email ? { email: user.email } : {}),
      ...(user.avatar_url ? { avatar: user.avatar_url } : {}),
    }
  }
}
