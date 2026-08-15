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
  /** When set, use the confidential flow (client_secret); otherwise PKCE. */
  clientSecret?: string
}

/** The artifacts a login attempt needs: the verifier to hold (null for the confidential flow), the state to check, and the URL to open. */
export interface AuthorizationRequest {
  verifier: string | null
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

/** GitHub OAuth client: PKCE (S256) when no client_secret is configured, else the confidential flow. */
export class GitHubIdentityProvider {
  constructor(
    private readonly config: GitHubOAuthConfig,
    private readonly deps: GitHubProviderDeps = {},
  ) {}

  begin(): AuthorizationRequest {
    const clientSecret = this.config.clientSecret
    const verifier = clientSecret ? null : generateCodeVerifier()
    const state = (this.deps.randomUUIDImpl ?? randomUUID)()
    // Built on `URL` so an already-query-stringed authorizeUrl is preserved
    // rather than clobbered by a naive `?${params}` concat.
    const authorize = new URL(this.config.authorizeUrl ?? 'https://github.com/login/oauth/authorize')
    authorize.searchParams.set('client_id', this.config.clientId)
    authorize.searchParams.set('redirect_uri', this.config.redirectUri)
    authorize.searchParams.set('scope', this.config.scope ?? 'read:user user:email')
    authorize.searchParams.set('state', state)
    if (verifier !== null) {
      authorize.searchParams.set('code_challenge', computeS256Challenge(verifier))
      authorize.searchParams.set('code_challenge_method', 'S256')
    }
    return { verifier, state, authorizeUrl: authorize.toString() }
  }

  async exchangeCodeForToken(code: string, verifier: string | null): Promise<string> {
    const tokenUrl = this.config.tokenUrl ?? 'https://github.com/login/oauth/access_token'
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      code,
      redirect_uri: this.config.redirectUri,
    })
    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret)
    } else if (verifier !== null) {
      body.set('code_verifier', verifier)
    }
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
