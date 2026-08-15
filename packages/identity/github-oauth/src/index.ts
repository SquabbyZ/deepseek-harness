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
  /** OAuth App client secret; when set, the confidential flow is used instead of PKCE. */
  clientSecret?: string
  redirectUri: string
  callbackPort?: number
}

/** Injectable seams so the service is unit-testable without real network/browser. */
export interface IdentityServiceDeps {
  load?: () => Identity | null
  save?: (identity: Identity) => void
  clear?: () => void
  providerFactory?: () => Pick<GitHubIdentityProvider, 'begin' | 'exchangeCodeForToken' | 'fetchIdentity'>
  loopbackFactory?: () => Pick<LoopbackCallbackServer, 'listen' | 'boundPort' | 'waitForCallback' | 'close'>
  openBrowser?: (url: string) => void
}

export class IdentityService {
  private currentValue: Identity | null
  private lastErrorValue: string | null = null
  private inFlight: Promise<Identity> | null = null
  /** Bumped on logout (and each fresh login) so a stale in-flight result is discarded. */
  private generation = 0

  constructor(
    private readonly config: GithubOauthConfig,
    private readonly deps: IdentityServiceDeps = {},
  ) {
    this.currentValue = (deps.load ?? loadIdentity)()
  }

  current(): Identity | null {
    return this.currentValue
  }

  /** The message of the most recent login failure, or null while none is outstanding. */
  lastError(): string | null {
    return this.lastErrorValue
  }

  /** Begin a login if none is in flight; concurrent callers share the same attempt. */
  login(): Promise<Identity> {
    if (this.inFlight === null) {
      this.lastErrorValue = null
      const attempt = this.runLogin(++this.generation)
      const tracked = attempt.finally(() => {
        if (this.inFlight === tracked) this.inFlight = null
      })
      this.inFlight = tracked
    }
    return this.inFlight
  }

  logout(): Promise<void> {
    this.generation += 1
    this.inFlight = null
    this.currentValue = null
    this.lastErrorValue = null
    ;(this.deps.clear ?? clearIdentity)()
    return Promise.resolve()
  }

  private async runLogin(generation: number): Promise<Identity> {
    const clientId = this.config.clientId
    if (!clientId) {
      this.lastErrorValue = 'github oauth: client id not configured (set DSH_GITHUB_CLIENT_ID)'
      throw new Error(this.lastErrorValue)
    }
    const provider = (this.deps.providerFactory ?? (() => new GitHubIdentityProvider({
      clientId,
      redirectUri: this.config.redirectUri,
      ...(this.config.clientSecret ? { clientSecret: this.config.clientSecret } : {}),
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
      if (generation !== this.generation) throw new Error('github oauth: login superseded by logout')
      this.currentValue = identity
      this.lastErrorValue = null
      ;(this.deps.save ?? saveIdentity)(identity)
      return identity
    } catch (error) {
      // A logout-superseded attempt is not an error to surface: the user asked for it.
      if (generation === this.generation) {
        this.lastErrorValue = error instanceof Error ? error.message : String(error)
      }
      throw error
    } finally {
      await loopback.close()
    }
  }
}

/** Open `url` in the OS default browser, detached, without keeping the child in the tree. */
function openInSystemBrowser(url: string): void {
  const platform = process.platform
  if (platform === 'win32') {
    // `rundll32 url.dll,FileProtocolHandler` opens the URL in the default browser
    // via ShellExecute, spawned directly (no cmd.exe), so the percent-encoded
    // authorize URL's `%`/`&` are passed through intact.
    spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  const command = platform === 'darwin' ? 'open' : 'xdg-open'
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref()
}

/** Mount the identity service and the /auth/github/* HTTP routes. */
export function apply(ctx: Context, config: GithubOauthConfig): void {
  ctx.provide('identity', new IdentityService(config))

  ctx.effect(() => {
    const offStart = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/start',
      handler: (_req, res) => {
        void ctx.identity.login().catch((error: unknown) => { ctx.logger.warn(error) })
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ started: true }))
      },
    })
    const offStatus = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/status',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: ctx.identity.current(), error: ctx.identity.lastError() }))
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
