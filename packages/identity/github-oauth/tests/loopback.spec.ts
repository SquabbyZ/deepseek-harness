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
})
