/**
 * @deepseek-ai/dsh-web-app — the browser-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field). The plugin owns the browser-surface glue: it resolves
 * the built frontend dist (workspace knowledge of this bundle, never user
 * config), mounts the `frontend-static` fallback owner over it, registers the
 * harness-source and web-surface prompt sections, the bash-visible web runtime
 * variable, and the URL line. App command-line values arrive through the
 * `webStartup` service expressions in the bundle patch.
 * @module @deepseek-ai/dsh-web-app
 */

import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-shell-env'

/** Stable Cordis plugin name. */
export const name = 'web-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
void SOURCE_ROOT

/** Runtime service that releases Web rows after bind-dependent values resolve. */
const WEB_RUNTIME_SERVICE = 'webRuntime'

/** Services required before the web runtime can mount. */
export const inject = ['webServer']

/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Print the URL line on activation; a non-interactive layer can turn it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `DSH_WEB_URL` bash variable). A one-shot non-interactive
   * layer can turn it off when its user is not in the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /** Explicit `--trusted-host` authorities from this invocation. */
  trustedHosts: string[]
  /**
   * Product (brand) name injected into the index and rendered by the sidebar
   * wordmark. A deployment sets this via `DSH_PRODUCT_NAME` (the desktop shell
   * maps `PRODUCT_NAME` onto it); omitted, the schema default keeps the shipped
   * brand.
   */
  productName?: string
}

/** Shipped brand the Web surface falls back to when no product name is configured. */
export const DEFAULT_PRODUCT_NAME = 'DeepSeek Harness'

export const Config: z<Config> = z.object({
  printUrl: z.boolean().default(true),
  surfaceContext: z.boolean().default(true),
  trustedHosts: z.array(String).default([]),
  productName: z.string().default(DEFAULT_PRODUCT_NAME),
})

/** Bind-dependent Web values shared by the trust fence and URL display. */
export interface WebRuntimeValues {
  /** LAN IPv4 literals sampled once when the server binds all interfaces. */
  lanAddresses: string[]
  /** LAN literals followed by explicit invocation authorities. */
  trustedHosts: string[]
}

/** Environment variable naming the canonical local URL of this Web GUI. */
const DSH_WEB_URL = 'DSH_WEB_URL' as const
void DSH_WEB_URL

// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1'
/** The webserver schema's all-interfaces bind literal. */
const ALL_INTERFACES_HOST = '0.0.0.0'

/**
 * Resolve one LAN-trust snapshot from the active server bind.
 *
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, while an IP-literal Host is safe on any port and
 * an OS-assigned port is unknowable before bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(bindHost: string, extra: readonly string[]): WebRuntimeValues {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] }
}

/** Model-visible orientation and acceptance boundary for sessions created through `dsh web`. */
function webSurfacePrompt(webUrl: string): string {
  const updateContract = 'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while '
    + '`pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. '
    + 'Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. '
  return `You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}. `
    + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
    + 'The browser provides no implicit DOM, route, or screenshot context. '
    + updateContract
    + 'Starting another server does not update this GUI. '
    + 'The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. '
    + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.'
}

/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx: Context): string {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('web-app: webServer service missing while resolving Web runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/** Dist location is workspace knowledge of this bundle: resolved through the frontend package exports, not configured. */
function resolveDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree builds it */
    throw new Error('web-app: frontend dist not built; run pnpm run build from the repository root first')
  }
}

/** Test hook: hosts with no built frontend dist substitute the resolver; production never touches this. */
export const internals: { resolveDistIndex: () => string } = { resolveDistIndex }

/**
 * Inject the product (brand) name into `window.__DSH_PRODUCT_NAME__` as the
 * first script in <head>, before the shell bundle reads it. The value is
 * JSON-encoded with `<` escaped so a config-controlled name cannot break out
 * of the script element (same hardening as the boot manifest).
 * @param html - the index.html source.
 * @param productName - the resolved product name (schema default applied).
 * @returns the html with the bootstrap script injected.
 */
export function injectProductName(html: string, productName: string): string {
  const script = `<script>window.__DSH_PRODUCT_NAME__ = ${JSON.stringify(productName).replaceAll('<', '\\u003c')}</script>`
  const head = html.indexOf('<head>')
  if (head !== -1) return `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
  // Headless fixture pages may lack <head>; prepending keeps the read-before-shell ordering.
  return `${script}${html}`
}

/**
 * Mount the Web runtime: dist serving, surface prompt, the bash runtime
 * variable, and the URL line.
 *
 * TODO(phase2-h5/b2): the Phase 1 `webServer` carrier that owned bind host /
 * port / index-tap / `addHarnessSourceSection` is retired in favor of the
 * Tauri asset-protocol carrier. Until that lands, this `apply()` no-ops on
 * the bind-dependent sides — `ctx.provide(WEB_RUNTIME_SERVICE)` still ships so
 * dependents compile and the desktop shell loads without a runtime crash;
 * `surfaceContext`, the URL line, and the harness-source prompt section stay
 * registered but inert.
 * @param ctx - host plugin context (no longer carries the deleted webServer service).
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // TODO(phase2-h5/b2): `ctx.webServer.host` was the bind host. With the
  // carrier retired, no LAN literals are sampled; loopback-only deployments
  // still produce an empty trust list, which the /api trust fence accepts.
  const runtime: WebRuntimeValues = { lanAddresses: [], trustedHosts: config.trustedHosts }
  // Release dependent rows only after bind-dependent trust has been sampled once.
  ctx.provide(WEB_RUNTIME_SERVICE, runtime)
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  // TODO(phase2-h5/b2): `ctx.webServer.tapIndex(html => …)` injected the
  // product-name script into the served index.html. The Tauri shell ships the
  // dist as a static asset, so the bootstrap has to live in the shell bundle
  // itself; this hook is a no-op placeholder until the carrier is wired.
  void injectProductName
  void config
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      // TODO(phase2-h5/b2): `addHarnessSourceSection` registered the harness
      // checkout root into the system prompt. Its replacement lives in the
      // system-prompt bundle and will be re-imported once the Tauri carrier
      // lands; the section below preserves the order and name so dependents
      // keyed by `app:web-surface` keep resolving.
      promptCtx.systemPrompt.section({
        name: 'app:web-surface',
        order: -98,
        text: () => webSurfacePrompt(localWebUrl(promptCtx)),
      })
    })
    ctx.inject(['shellEnv'], (runtimeCtx) => {
      // TODO(phase2-h5/b2): the runtime variable registration moves with the
      // Tauri carrier. With no server to resolve against, `localWebUrl` would
      // throw; the registration is kept so dependents compile but inert.
      void runtimeCtx
    })
  }
  if (config.printUrl) {
    // The URL line is a readiness signal: supervisors (and the keyless CLI
    // smoke) RPC as soon as they observe it. With the Tauri carrier pending,
    // there is no bind host to print against, so the line stays quiet; once
    // the carrier lands, restore the original `printUrl` body that reads
    // `runtime.lanAddresses` and `ctx.webServer.port`.
    void runtime
  }
}
