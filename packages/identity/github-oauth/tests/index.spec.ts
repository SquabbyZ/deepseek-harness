import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, type GithubOauthConfig, type IdentityService } from '../src/index.ts'

interface Route {
  kind: 'exact'
  path: string
  handler: (req: unknown, res: Res) => void | Promise<void>
}

interface Res {
  statusCode: number
  body: string
  writeHead: (status: number, headers?: Record<string, string>) => void
  end: (body?: string) => void
}

function mockRes(): Res {
  const res = { statusCode: 0, body: '' } as Res
  res.writeHead = (status) => { res.statusCode = status }
  res.end = (body) => { res.body = body ?? '' }
  return res
}

function mount(config: GithubOauthConfig) {
  let disposer: (() => void) | undefined
  const routes = new Map<string, Route>()
  const provided = new Map<string, unknown>()
  const warn = vi.fn()
  const ctx = {
    provide: (name: string, value: unknown) => {
      provided.set(name, value)
      return () => { provided.delete(name) }
    },
    effect: (cb: () => (() => void)) => { disposer = cb() },
    webServer: {
      register: (route: Route) => {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    },
    logger: { warn },
    get identity() { return provided.get('identity') as IdentityService },
  } as unknown as Context
  apply(ctx, config)
  return { routes, warn, dispose: () => disposer?.(), identity: () => provided.get('identity') as IdentityService }
}

describe('apply', () => {
  let originalHome: string | undefined

  beforeEach(() => {
    originalHome = process.env.DSH_HOME
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-oauth-'))
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
  })

  it('registers the start, status, and logout routes', () => {
    const { routes } = mount({ redirectUri: 'r', clientId: 'c' })
    expect([...routes.keys()].sort()).toEqual(['/auth/github/logout', '/auth/github/start', '/auth/github/status'])
  })

  it('start responds 202 and reports started', () => {
    const { routes } = mount({ redirectUri: 'r', clientId: 'c' })
    const start = routes.get('/auth/github/start')
    if (!start) throw new Error('start route not registered')
    const res = mockRes()
    void start.handler({}, res)
    expect(res.statusCode).toBe(202)
    expect(JSON.parse(res.body)).toEqual({ started: true })
  })

  it('status returns the identity and last error', () => {
    const { routes } = mount({ redirectUri: 'r', clientId: 'c' })
    const status = routes.get('/auth/github/status')
    if (!status) throw new Error('status route not registered')
    const res = mockRes()
    void status.handler({}, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ identity: null, error: null })
  })

  it('surfaces the client-id failure through status and logs it', async () => {
    const { routes, warn } = mount({ redirectUri: 'r' })
    const start = routes.get('/auth/github/start')
    const status = routes.get('/auth/github/status')
    if (!start || !status) throw new Error('routes not registered')
    void start.handler({}, mockRes())
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(1) })
    const res = mockRes()
    void status.handler({}, res)
    const body = JSON.parse(res.body) as { identity: null; error: string }
    expect(body.identity).toBeNull()
    expect(body.error).toMatch(/client id not configured/)
  })

  it('logout responds 200 with null', async () => {
    const { routes } = mount({ redirectUri: 'r', clientId: 'c' })
    const logout = routes.get('/auth/github/logout')
    if (!logout) throw new Error('logout route not registered')
    const res = mockRes()
    await logout.handler({}, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('null')
  })

  it('the effect disposer removes every route', () => {
    const { routes, dispose } = mount({ redirectUri: 'r', clientId: 'c' })
    expect(routes.size).toBe(3)
    dispose()
    expect(routes.size).toBe(0)
  })
})
