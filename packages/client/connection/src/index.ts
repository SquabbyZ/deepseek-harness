/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
// Activates the webServer Context merge used below.
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-apiproxy'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
export const inject = ['webServer']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for every `/api` request. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Methods gated to loopback even on a trusted-host deployment. Native dialogs
 * act on the host machine; the settings and credential domains mutate the
 * user's configuration and secret store, and READING them is equally
 * privileged — `settings.describe` returns every exposed namespace's
 * configuration and `credentials.describe` reports whether an arbitrary
 * environment-variable name is configured and where from, which is
 * reconnaissance no anonymous caller should have. `trustedHosts` is a
 * DNS-rebinding fence, explicitly not authentication, so the whole
 * configuration plane stays loopback-same-origin until a real authentication
 * layer exists. `llm.discoverModels` belongs to that plane on both counts: it
 * carries a draft credential, and it makes the HOST issue a GET to a URL the
 * caller chose and reports back the status or the parsed body — an anonymous
 * LAN caller would have a probe for whatever the host can reach and the
 * browser cannot.
 *
 * The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
 * it carries provider ids, display names, and model lists — no endpoints,
 * keys, or key state — and a LAN client's model picker legitimately needs it.
 */
const PRIVILEGED_METHODS = new Set([
  // A preset composition names the plugins a session runs, so reading one is
  // reconnaissance; copy and remove rearrange what the deployment offers, and
  // openDocument drives the host desktop — all more than the roster beside
  // them. (Authoring is copy-only, so no method here accepts composition text
  // or a path; the pin is about who may manage the roster at all.)
  //
  // CHOOSING one is not pinned, and `agentPreset.list` is not either. Picking a
  // preset looks like escalation — one of them mounts the toolset that edits the
  // live runtime — but `session.create` already takes an `agentPreset`, so
  // pinning only the switch would leave the same capability one method over.
  // The deeper reason is that the capability is not the preset's to grant: the
  // deployment's own default already carries `bash` and the filesystem tools, so
  // any caller that may start a session at all can already run commands as this
  // process. Pinning the switch would be a fence beside an open gate.
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

/**
 * Inject `window.__DSH_API_BASE__` — the sidecar's own loopback origin — ahead
 * of the shell bundle. The desktop shell (Tauri) serves the frontend from a
 * custom-protocol origin (`tauri://localhost` / `*.tauri.localhost`) that does
 * not name this sidecar, so the browser's `location.origin` cannot reach `/api`
 * or the WebSocket downlinks; the client carrier (`resolveBase`) prefers this
 * injected origin for exactly that case. A normal browser (same-origin or LAN)
 * has a reachable `location.origin` and ignores the injected value.
 * @param html - the index.html source.
 * @param host - the bound host literal (`127.0.0.1` loopback, `0.0.0.0` all-interfaces).
 * @param port - the bound listening port.
 * @returns the html with the origin script injected.
 */
function injectApiBase(html: string, host: string, port: number): string {
  const script = `<script>window.__DSH_API_BASE__ = ${JSON.stringify(`http://${host}:${port}`)}</script>`
  const head = html.indexOf('<head>')
  if (head !== -1) return `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
  return `${script}${html}`
}

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * privileged methods additionally pass it with an empty trust list, which
 * pins them to loopback.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(ctx, trustedHosts)
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const method = pathname.startsWith(`${API_PATH}/`)
        ? pathname.slice(API_PATH.length + 1)
        : undefined
      if (method !== undefined
        && PRIVILEGED_METHODS.has(method)
        && !isTrustedApiRequest(request, [])) {
        return new Response('forbidden', { status: 403 })
      }
      if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', {
          status: 426,
          headers: { connection: 'Upgrade', upgrade: 'websocket' },
        })
      }
      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined) return new Response('not found', { status: 404 })
      return toFetchHandler(apiProxy).fetch(request)
    },
  })
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      // CORS for the desktop shell: Tauri serves its frontend from a
      // custom-protocol origin and fetches the loopback sidecar cross-origin, so
      // the browser preflights JSON POSTs and must read an allow header on every
      // response. Echo the request origin — the trust fence below still gates
      // the request itself, so a foreign page gets a 403 (no data) even though
      // it can read that 403. Headers are set via setHeader so bridge()'s
      // writeHead merges them onto the real response.
      const requestOrigin = req.headers.origin
      if (typeof requestOrigin === 'string') {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin)
        res.setHeader('Vary', 'Origin')
        // WebView2 enforces Private Network Access for cross-origin requests
        // into the loopback address space; ack it on the preflight and the
        // response alike.
        res.setHeader('Access-Control-Allow-Private-Network', 'true')
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.setHeader('Access-Control-Max-Age', '600')
        res.writeHead(204)
        res.end()
        return
      }
      if (!isTrustedApiRequest(req, trustedHosts)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  // Inject the sidecar's own origin so the desktop shell's custom-protocol page
  // can still reach /api and the downlinks (see injectApiBase).
  ctx.effect(
    () => ctx.webServer.tapIndex(html => injectApiBase(html, ctx.webServer.host, ctx.webServer.port)),
    'client-connection: api base injection',
  )
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    const registerDownlink = (
      path: string,
      handle: WebUpgradeRoute['handler'],
    ): void => {
      apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
        path,
        handler: (req, socket, head) => {
          if (!isTrustedApiRequest(req, trustedHosts)) {
            rejectWebSocketUpgrade(socket)
            return
          }
          return handle(req, socket, head)
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => { downlinks.handleMux(req, socket, head) })
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => { downlinks.handleHost(req, socket, head) })
  })
}
