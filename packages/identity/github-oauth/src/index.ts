import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { GitHubIdentityProvider } from './github.ts'
import type { Identity } from './identity.ts'
import { LoopbackCallbackServer, type CallbackResult } from './loopback.ts'
import { clearIdentity, loadIdentity, saveIdentity } from './persistence.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    identity: IdentityService
  }
}

/** Stable Cordis plugin name. */
export const name = 'github-oauth'

/** Services required before the auth routes can be registered. */
export const inject = ['webServer']

export interface GithubOauthConfig {
  /** OAuth App client id; login throws a clear error when empty. */
  clientId?: string
  redirectUri: string
  callbackPort?: number
}

/** Injectable seams so the service is unit-testable without real network/browser. */
export interface IdentityServiceDeps {
  load?: () => Identity | null
  save?: (identity: Identity) => void
  clear?: () => void
  providerFactory?: () => GitHubIdentityProvider
  loopbackFactory?: () => LoopbackCallbackServer
  openBrowser?: (url: string) => void
}

export class IdentityService {
  private currentValue: Identity | null
  private inFlight: Promise<Identity> | null = null

  constructor(
    private readonly config: GithubOauthConfig,
    private readonly deps: IdentityServiceDeps = {},
  ) {
    this.currentValue = (deps.load ?? loadIdentity)()
  }

  current(): Identity | null {
    return this.currentValue
  }

  /** Begin a login if none is in flight; resolves with the resulting identity. */
  login(): Promise<Identity> {
    if (this.inFlight === null) {
      this.inFlight = this.runLogin().finally(() => { this.inFlight = null })
    }
    return this.inFlight
  }

  async logout(): Promise<void> {
    this.currentValue = null
    ;(this.deps.clear ?? clearIdentity)()
  }

  private async runLogin(): Promise<Identity> {
    const clientId = this.config.clientId
    if (!clientId) {
      throw new Error('github oauth: client id not configured (set DSH_GITHUB_CLIENT_ID)')
    }
    const provider = (this.deps.providerFactory ?? (() => new GitHubIdentityProvider({
      clientId,
      redirectUri: this.config.redirectUri,
    })))()
    const { verifier, state, authorizeUrl } = provider.begin()
    const loopback = (this.deps.loopbackFactory ?? (() => new LoopbackCallbackServer(this.config.callbackPort ?? 3846)))()
    await loopback.listen()
    try {
      ;(this.deps.openBrowser ?? openInSystemBrowser)(authorizeUrl)
      const result: CallbackResult = await loopback.waitForCallback()
      if (result.state !== state) throw new Error('github oauth: state mismatch')
      const token = await provider.exchangeCodeForToken(result.code, verifier)
      const identity = await provider.fetchIdentity(token)
      this.currentValue = identity
      ;(this.deps.save ?? saveIdentity)(identity)
      return identity
    } finally {
      await loopback.close()
    }
  }
}

/** Open `url` in the OS default browser, detached, without keeping the child in the tree. */
function openInSystemBrowser(url: string): void {
  const platform = process.platform
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

/** Mount the identity service and the /auth/github/* HTTP routes. */
export function apply(ctx: Context, config: GithubOauthConfig): void {
  ctx.provide('identity', new IdentityService(config))

  ctx.effect(() => {
    const offStart = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/start',
      handler: (_req, res) => {
        void ctx.identity.login().catch((error: unknown) => ctx.logger.warn(error))
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ started: true }))
      },
    })
    const offStatus = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/status',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(ctx.identity.current()))
      },
    })
    const offLogout = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/logout',
      handler: async (_req, res) => {
        await ctx.identity.logout()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('null')
      },
    })
    return () => { offStart(); offStatus(); offLogout() }
  }, 'github-oauth: routes')
}
