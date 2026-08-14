import { afterEach, describe, expect, it } from 'vitest'
import { LoopbackCallbackServer } from '../src/loopback.ts'

const servers: LoopbackCallbackServer[] = []

afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close().catch(() => {}))) })

describe('LoopbackCallbackServer', () => {
  it('resolves the code and state from a /callback request', async () => {
    const server = new LoopbackCallbackServer(0) // OS-assigned port for the test
    servers.push(server)
    await server.listen()
    const waiting = server.waitForCallback(1000)
    const res = await fetch(`http://127.0.0.1:${server.boundPort}/callback?code=c1&state=s1`)
    expect(res.status).toBe(200)
    await expect(waiting).resolves.toEqual({ code: 'c1', state: 's1' })
  })

  it('rejects when the callback does not arrive in time', async () => {
    const server = new LoopbackCallbackServer(0)
    servers.push(server)
    await server.listen()
    await expect(server.waitForCallback(50)).rejects.toThrow(/timed out/)
  })

  it('answers non-/callback paths with 404', async () => {
    const server = new LoopbackCallbackServer(0)
    servers.push(server)
    await server.listen()
    const res = await fetch(`http://127.0.0.1:${server.boundPort}/nope`)
    expect(res.status).toBe(404)
  })

  it('defaults missing code/state params to empty strings', async () => {
    const server = new LoopbackCallbackServer(0)
    servers.push(server)
    await server.listen()
    const waiting = server.waitForCallback(1000)
    const res = await fetch(`http://127.0.0.1:${server.boundPort}/callback`)
    expect(res.status).toBe(200)
    await expect(waiting).resolves.toEqual({ code: '', state: '' })
  })

  it('returns an already-captured callback without waiting', async () => {
    const server = new LoopbackCallbackServer(0)
    servers.push(server)
    await server.listen()
    const res = await fetch(`http://127.0.0.1:${server.boundPort}/callback?code=c1&state=s1`)
    expect(res.status).toBe(200)
    await expect(server.waitForCallback(1000)).resolves.toEqual({ code: 'c1', state: 's1' })
  })

  it('close() before listen() is a no-op', async () => {
    const server = new LoopbackCallbackServer(0)
    servers.push(server)
    await expect(server.close()).resolves.toBeUndefined()
  })

  it('close() is idempotent after listen()', async () => {
    const server = new LoopbackCallbackServer(0)
    servers.push(server)
    await server.listen()
    await server.close()
    await expect(server.close()).resolves.toBeUndefined()
  })
})
