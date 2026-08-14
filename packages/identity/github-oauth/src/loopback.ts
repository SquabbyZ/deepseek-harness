import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface CallbackResult {
  code: string
  state: string
}

/**
 * A loopback (127.0.0.1) HTTP listener that catches GitHub's redirect back to
 * the registered callback path and resolves the `code`/`state` query params.
 * The port is fixed in production (3846) because the redirect_uri is fixed in
 * the OAuth App registration; tests pass 0 for an OS-assigned port.
 */
export class LoopbackCallbackServer {
  private server: Server | undefined
  private result: CallbackResult | undefined
  private waiter: { resolve: (r: CallbackResult) => void; reject: (e: Error) => void } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private listenedPort = 0

  constructor(private readonly port = 3846) {}

  /** The bound port (OS-assigned value when constructed with 0). */
  get boundPort(): number {
    return this.listenedPort
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><title>dsh</title><p>You can close this window and return to the app.</p>')
        const result = { code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? '' }
        this.result = result
        if (this.waiter !== undefined) this.settle(result)
      })
      server.once('error', reject)
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server
        this.listenedPort = (server.address() as AddressInfo).port
        resolve()
      })
    })
  }

  /** Resolve with the callback's code+state, or reject once `timeoutMs` elapses. */
  waitForCallback(timeoutMs = 5 * 60_000): Promise<CallbackResult> {
    if (this.result !== undefined) return Promise.resolve(this.result)
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject }
      this.timer = setTimeout(() => reject(new Error('github oauth: callback timed out')), timeoutMs)
    })
  }

  close(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const server = this.server
    if (server === undefined) return Promise.resolve()
    return new Promise((resolve) => { server.close(() => resolve()) })
  }

  private settle(result: CallbackResult): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.waiter?.resolve(result)
    this.waiter = undefined
  }
}
