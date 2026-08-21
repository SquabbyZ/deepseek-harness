import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { strToU8, zipSync } from 'fflate'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { workspaceResolver } from './src/dsh/inbox/workspace-resolver.ts'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

/** sha1 content hash shortened to 12 hex chars — the host's rev scheme. */
function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/**
 * Fetch one raw text URL, preferring curl (honors HTTP(S)_PROXY, which the
 * desktop needs to reach GitHub) and falling back to Node's global fetch when
 * curl is not on PATH. Non-2xx responses reject with the status.
 */
/**
 * CONNECT-tunneled HTTPS GET through an http proxy, in pure Node. The desktop
 * needs the local proxy to reach GitHub; Node's global fetch ignores
 * HTTP(S)_PROXY and curl may be absent, so this is the deterministic path.
 */
function httpsViaProxy(urlStr: string, proxy: string, timeoutMs: number): Promise<string> {
  const url = new URL(urlStr)
  const [proxyHost, proxyPortRaw] = proxy.replace(/^https?:\/\//, '').split(':')
  const proxyPort = Number(proxyPortRaw) || 443
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxyHost, port: proxyPort, timeout: timeoutMs })
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('proxy tunnel timeout')) }, timeoutMs)
    socket.on('error', (error) => { clearTimeout(timer); reject(error) })
    socket.on('timeout', () => { clearTimeout(timer); socket.destroy(); reject(new Error('proxy connect timeout')) })
    socket.on('connect', () => {
      socket.write(`CONNECT ${url.hostname}:443 HTTP/1.1\r\nHost: ${url.hostname}:443\r\n\r\n`)
    })
    let buffered = Buffer.alloc(0)
    let handed = false
    socket.on('data', (chunk) => {
      if (handed) return
      buffered = Buffer.concat([buffered, chunk])
      const split = buffered.indexOf('\r\n\r\n')
      if (split === -1) return
      const statusLine = buffered.slice(0, buffered.indexOf('\r\n')).toString('latin1')
      if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
        clearTimeout(timer); socket.destroy(); reject(new Error(`proxy CONNECT failed: ${statusLine}`)); return
      }
      const rest = buffered.slice(split + 4)
      handed = true
      socket.removeAllListeners('data')
      const tls = tlsConnect({ socket, servername: url.hostname })
      tls.on('error', (error) => { clearTimeout(timer); reject(error) })
      // TLS bytes that arrived inside the CONNECT response chunk.
      if (rest.length > 0) tls.push(rest)
      tls.on('secureConnect', () => {
        const req = httpRequest({
          hostname: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          method: 'GET',
          createConnection: () => tls,
          headers: { Host: url.hostname, 'User-Agent': 'dsh-desktop' },
        }, (res) => {
          if (res.statusCode !== 200) { clearTimeout(timer); reject(new Error(`HTTP ${res.statusCode}`)); return }
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (part) => { body += part })
          res.on('end', () => { clearTimeout(timer); resolve(body) })
        })
        req.on('error', (error) => { clearTimeout(timer); reject(error) })
        req.end()
      })
    })
  })
}

/** Working outbound proxy, detected once (env vars, then common local ports). */
let detectedProxyUrl: string | undefined

/**
 * Probe a proxy by opening a fast CONNECT tunnel to a neutral host. Returns
 * true when the proxy answers 200 — a live local proxy that can carry HTTPS.
 */
function probeProxy(proxy: string, timeoutMs = 2000): Promise<boolean> {
  const [host, portRaw] = proxy.replace(/^https?:\/\//, '').split(':')
  const port = Number(portRaw) || 443
  return new Promise((resolve) => {
    const socket = netConnect({ host, port, timeout: timeoutMs })
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, timeoutMs)
    socket.on('error', () => { clearTimeout(timer); resolve(false) })
    socket.on('timeout', () => { clearTimeout(timer); socket.destroy(); resolve(false) })
    socket.on('connect', () => {
      socket.write('CONNECT raw.githubusercontent.com:443 HTTP/1.1\r\nHost: raw.githubusercontent.com:443\r\n\r\n')
      socket.once('data', (chunk) => {
        clearTimeout(timer)
        resolve(/^HTTP\/1\.[01] 200/.test(chunk.toString('latin1')))
        socket.destroy()
      })
    })
  })
}

/** Resolve the first usable outbound proxy (env order, then common local ports). */
async function detectProxy(): Promise<string | undefined> {
  if (detectedProxyUrl !== undefined) return detectedProxyUrl
  const env = [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  const candidates = [
    ...new Set([...env, 'http://127.0.0.1:7890', 'http://127.0.0.1:7897', 'http://127.0.0.1:10809', 'http://127.0.0.1:1080', 'http://127.0.0.1:2080', 'http://127.0.0.1:58309']),
  ]
  // Probe all candidates in parallel (1s each) so a dead env proxy never delays
  // a working local one; first hit wins.
  const results = await Promise.all(candidates.map(async (proxy) => ({ proxy, ok: await probeProxy(proxy, 1000) })))
  const working = results.find((r) => r.ok)
  detectedProxyUrl = working?.proxy
  return detectedProxyUrl
}

/**
 * Fetch one raw text URL: curl first (honors HTTP(S)_PROXY), then the pure-Node
 * CONNECT tunnel through the detected local proxy, then direct fetch.
 */
function fetchViaCurl(url: string, timeoutMs: number): Promise<string> {
  const direct = (): Promise<string> => fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text() })
  return new Promise((resolve) => {
    execFile('curl', ['-sS', '-f', '--max-time', String(Math.ceil(timeoutMs / 1000)), url], {
      encoding: 'utf8', timeout: timeoutMs,
    }, (error, stdout) => {
      if (error === null) return resolve(stdout)
      void detectProxy().then((proxy) => {
        if (proxy !== undefined) {
          httpsViaProxy(url, proxy, timeoutMs).then(resolve, () => resolve(direct()))
        } else {
          resolve(direct())
        }
      })
    })
  })
}

/**
 * Drop-in replacement for `vite-plugin-node-polyfills`. The upstream
 * plugin keeps pulling in `undici` (used by `node:fetch`) which has its
 * own broken subpath imports (`require('node:fs/promises')` from a
 * relative path the polyfill's cjs walker can't satisfy). Excluding
 * `undici` / `util` / `fs` / `path` / `string_decoder` / `buffer` /
 * `buffer_ieee754` / `ieee754` (Phase 2 follow-up #10) only papers over
 * the problem: undici still gets pre-bundled transitively, and the
 * cjs walker still runs against any bundled `require('node:*')` call.
 *
 * The manual shim approach: every `node:*` import (both `node:fs` and
 * `node:fs/promises`, `node:util` and `node:util/types`, etc.) is
 * redirected to a single hand-written stub module. The stub exports
 * named proxies for the ~80 symbols the in-box plugins reach for at
 * module-evaluation time; unknown names resolve to a throw-stub so the
 * next plugin that introduces e.g. `mkdirSync` doesn't need an edit.
 * `enforce: 'pre'` puts this hook ahead of Vite's `resolve.alias`
 * pass, so the worktree's explicit `node:module` -> `node-module-stub`
 * alias (loader compat) still wins for that one id.
 */
function nodeShimPlugin(): Plugin {
  return {
    name: 'dsh-node-shim',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id.startsWith('node:')) {
        return src('./src/dsh/inbox/node-shims.ts')
      }
      return null
    },
  }
}

/**
 * The official client-plugin bundle server. AppWebEntry's module system
 * fetches each graph row's bundle from `/plugins/<id>/client.js?rev=<rev>`
 * (default classic `<script src>` loadBundle). On the real host the
 * ClientModuleRegistry node half serves those from the workspace; the
 * client-first shell has no host, so this middleware serves the same built
 * `lib/client.js` artifact from the package's `exports["./client"]`.
 *
 * The bundle map is scanned once at config load (same source the roster
 * generator uses), so a package added after server start needs a dev-server
 * restart. Built bundles only — regenerate the roster and restart the server
 * after `pnpm run build:lib:client` changes a bundle's content hash.
 */
/**
 * Market-installed plugin bundles fetched from GitHub at install time, keyed by
 * plugin id. `officialBundleServer` serves them at `/plugins/<id>/client.js`
 * (falling back after the workspace package map) and `dshMarketServer`
 * publishes them via `/dsh-market/installed` so the boot graph can pick them up
 * after the market's install → restart flow.
 */
const installedBundles = new Map<string, { rev: string; code: string }>()

/**
 * Scan every `dsh.client.platform: 'web'` workspace/external package for its
 * built client bundle (the same source the roster generator reads). Returns
 * plugin id -> bundle path.
 */
function scanClientBundles(): Map<string, string> {
  const bundles = new Map<string, string>()
  for (const root of [src('../../packages'), src('../../external')]) {
    if (!existsSync(root)) continue
    for (const area of readdirSync(root)) {
      const areaDir = join(root, area)
      if (!statSync(areaDir).isDirectory()) continue
      const flat = existsSync(join(areaDir, 'package.json'))
      const names = flat ? [area] : readdirSync(areaDir)
      for (const name of names) {
        const pjPath = flat ? join(areaDir, 'package.json') : join(areaDir, name, 'package.json')
        if (!existsSync(pjPath)) continue
        const pkg = JSON.parse(readFileSync(pjPath, 'utf8')) as {
          name: string
          dsh?: { client?: { platform?: string } }
          exports?: Record<string, string | { default?: string }>
        }
        if (pkg.dsh?.client?.platform !== 'web') continue
        const client = pkg.exports?.['./client']
        const rel = typeof client === 'string' ? client : client?.default
        if (typeof rel !== 'string') continue
        const bundlePath = join(dirname(pjPath), rel)
        if (existsSync(bundlePath)) bundles.set(pkg.name, bundlePath)
      }
    }
  }
  return bundles
}

/**
 * Build-time copy of every client plugin bundle into `dist/plugins/<id>/`
 * so the Tauri production build (which has no vite dev middleware) can serve
 * the `/plugins/<id>/client.js` URLs the boot graph fetches.
 */
function packagePluginBundles(): Plugin {
  let outDir = 'dist'
  return {
    name: 'dsh-package-plugin-bundles',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      for (const [id, bundlePath] of scanClientBundles()) {
        const dest = join(outDir, 'plugins', id, 'client.js')
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(bundlePath, dest)
      }
    },
  }
}

function officialBundleServer(): Plugin {
  const bundles = scanClientBundles()
  return {
    name: 'dsh-official-bundles',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? ''
        const match = /^\/plugins\/(.+)\/client\.js(?:\?.*)?$/.exec(url)
        if (match === null) {
          next()
          return
        }
        // The graph id may carry a scope slash (@deepseek-ai/dsh-…), which is
        // a literal path segment, so the captured group is already decoded.
        const id = match[1] as string
        // Workspace package bundles first; market-installed plugin bundles
        // (fetched from GitHub at install time) second.
        const installed = installedBundles.get(id)
        const bundlePath = installed === undefined ? bundles.get(id) : undefined
        if (bundlePath === undefined && installed === undefined) {
          res.statusCode = 404
          res.end(`unknown client bundle ${id}`)
          return
        }
        try {
          const code = installed !== undefined ? installed.code : readFileSync(bundlePath as string, 'utf8')
          res.statusCode = 200
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          res.setHeader('cache-control', 'no-cache')
          res.end(code)
        } catch (error) {
          res.statusCode = 500
          res.end(`failed to serve ${id}: ${String(error)}`)
        }
      })
    },
  }
}

/**
 * The session-log export endpoint. The official Session Header's download
 * button (session-log-export) HEADs `/api/session.export` then downloads the
 * ZIP the host streams. The client-first shell has no host, so this dev
 * middleware serves a real ZIP (fflate) so the download works in the desktop
 * app; the payload is the session summary + a dev-mode marker rather than the
 * full transcript a host deployment would stream.
 */
function sessionExportServer(): Plugin {
  return {
    name: 'dsh-session-export',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://x')
        if (url.pathname !== '/api/session.export') {
          next()
          return
        }
        const sessionId = url.searchParams.get('sessionId') ?? 'unknown'
        const body = [
          '# DeepSeek Harness — session log',
          '',
          `session: ${sessionId}`,
          'exported: dev fixture transport (no host stream)',
          '',
          'A host deployment streams the full session transcript here.',
        ].join('\n')
        const zip = zipSync({ [`session-${sessionId}.md`]: strToU8(body) })
        res.statusCode = 200
        res.setHeader('content-type', 'application/zip')
        res.setHeader('content-disposition', `attachment; filename="session-${sessionId}.zip"`)
        res.end(Buffer.from(zip))
      })
    },
  }
}

/**
 * Serve the dsh-market plugin's HOST endpoints from the dev shell. The market
 * fetches its catalog from `/dsh-market/registry` (the real host serves this
 * from its bundled registry snapshot); the client-first desktop has no host,
 * so this middleware answers from the vendored registry snapshot and returns
 * empty install/update state so the market UI loads.
 */
function dshMarketServer(): Plugin {
  let registry: unknown
  try {
    registry = JSON.parse(readFileSync(src('../../external/dsh-market/data/registry-snapshot.json'), 'utf8'))
  } catch {
    registry = { name: 'awesome-dsh-plugin', plugins: [] }
  }
  // Session-local install bookkeeping so the market's install/installed flow
  // works in the client-first shell (a real host would npm-install + restart).
  const installedMap = new Map<string, string>()
  const liveList: string[] = []
  // Market-facing repo name → the bundle's own module id (the boot graph keys
  // entries on the module id; the market's uninstall sends the repo name).
  const repoModule = new Map<string, string>()

  /**
   * Fetch a plugin's client bundle from its GitHub repo (raw). The bundle path
   * is read from the plugin's `package.json` `exports["./client"]`; DSH client
   * bundles are closure-factory modules (`__ModuleLoader__.load`) the loader
   * can boot directly. The bundle's OWN registered module id is what the boot
   * graph must key on, so it is parsed out of the bundle head.
   */
  async function fetchPluginBundle(owner: string, repo: string): Promise<{ code: string; version: string; moduleId: string }> {
    const raw = async (path: string): Promise<string> => {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`
      // Node's global fetch ignores HTTP(S)_PROXY; curl honors it (the desktop
      // runs behind a local proxy). Fall back to fetch when curl is absent.
      const text = await fetchViaCurl(url, 30000)
      return text
    }
    const pkgText = await raw('package.json')
    const pkg = JSON.parse(pkgText) as { version?: string; exports?: Record<string, unknown> }
    let bundlePath = 'client/client.js'
    const client = pkg.exports?.['./client'] as unknown
    const rel = typeof client === 'string' ? client : (client as { default?: string } | undefined)?.default
    if (typeof rel === 'string' && rel.length > 0) bundlePath = rel.replace(/^\.\//, '')
    const code = await raw(bundlePath)
    if (code.length < 16) throw new Error(`client bundle (${bundlePath}) is empty`)
    const idMatch = /__ModuleLoader__\.load\(\s*\{\s*id:\s*"([^"]+)"/.exec(code)
    if (idMatch === null) throw new Error(`client bundle (${bundlePath}) is not a DSH module (no __ModuleLoader__.load id)`)
    return { code, version: pkg.version ?? '0.0.0', moduleId: idMatch[1] }
  }
  return {
    name: 'dsh-market-server',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://x')
        const m = /^\/dsh-market\/([a-z-]+)/.exec(url.pathname)
        if (m === null) {
          next()
          return
        }
        const json = (body: unknown): void => {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        switch (m[1]) {
          case 'registry':
            json({ registry })
            break
          case 'installed':
            json({
              installed: Object.fromEntries(installedMap),
              live: liveList,
              activation: {},
              // Bundle URLs for the boot graph to pick up after restart.
              bundles: Object.fromEntries([...installedBundles].map(([id, b]) => [id, `/plugins/${id}/client.js?rev=${b.rev}`])),
            })
            break
          case 'status':
            json({ market: 'installed', versions: {} })
            break
          case 'debug-env':
            json({
              HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
              http_proxy: process.env.http_proxy ?? null,
              HTTP_PROXY: process.env.HTTP_PROXY ?? null,
              detectedProxy: detectedProxyUrl,
            })
            break
          case 'updates':
            json({ updates: [] })
            break
          case 'install': {
            let urlRaw = ''
            req.on('data', (chunk) => { urlRaw += chunk })
            req.on('end', () => {
              const body = (() => {
                try { return JSON.parse(urlRaw) as { url?: string } } catch { return {} }
              })()
              const repoUrl = body.url ?? ''
              const m = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(repoUrl)
              if (m === null) {
                json({ ok: false, error: 'invalid GitHub url' })
                return
              }
              const [, owner, repo] = m
              // Try to fetch the plugin's real client bundle; a real host would
              // npm-install + restart. On failure (offline, non-DSH repo) the
              // install is refused with the reason rather than recorded fake.
              void fetchPluginBundle(owner, repo).then((bundle) => {
                installedBundles.set(bundle.moduleId, { rev: shortHash(bundle.code), code: bundle.code })
                installedMap.set(repo, bundle.version)
                liveList.push(repo)
                repoModule.set(repo, bundle.moduleId)
                json({ ok: true, hot: false, activation: {}, bundleUrl: `/plugins/${bundle.moduleId}/client.js?rev=${shortHash(bundle.code)}` })
              }).catch((error: unknown) => {
                json({ ok: false, error: `unable to fetch plugin bundle: ${String(error instanceof Error ? error.message : error)}` })
              })
            })
            break
          }
          case 'restart':
            json({ ok: true })
            break
          case 'uninstall': {
            let raw = ''
            req.on('data', (chunk) => { raw += chunk })
            req.on('end', () => {
              try {
                const body = JSON.parse(raw) as { name?: string }
                const pkg = body.name ?? ''
                if (pkg) {
                  installedMap.delete(pkg)
                  installedBundles.delete(repoModule.get(pkg) ?? pkg)
                  repoModule.delete(pkg)
                  const i = liveList.indexOf(pkg)
                  if (i >= 0) liveList.splice(i, 1)
                }
              } catch {
                // non-JSON body: still report ok
              }
              json({ ok: true })
            })
            break
          }
          case 'update':
          case 'cancel':
          case 'rollback':
            // The dev shell has no real package store to update; acknowledge so
            // the market's operation buttons settle instead of 404ing.
            json({ ok: true })
            break
          case 'approve-builds':
            json({ ok: true, approved: [] })
            break
          case 'check':
            json({ ok: true })
            break
          case 'logs':
            json({ entries: [] })
            break
          default:
            json({})
        }
      })
    },
  }
}

/**
 * Vendored cordis / dsh packages whose main/module exports don't point at
 * source. The WebView2 build compiles source directly so the `define`
 * blocks below (`process.versions.node` etc.) take effect.
 */
const VENDOR_PACKAGE_ALIASES: ReadonlyArray<{ find: RegExp; replacement: string }> = [
  { find: /^@deepseek-ai\/cordis-plugin-timer$/, replacement: src('../../vendor/timer/src/index.ts') },
  { find: /^@deepseek-ai\/cordis-plugin-hmr$/, replacement: src('../../vendor/hmr/src/index.ts') },
  { find: /^@deepseek-ai\/cordis-plugin-include$/, replacement: src('../../vendor/include/src/index.ts') },
  { find: /^@deepseek-ai\/cordis-plugin-group$/, replacement: src('../../vendor/group/src/index.ts') },
  { find: /^@deepseek-ai\/cordis-plugin-logger-console$/, replacement: src('../../vendor/logger-console/src/index.ts') },
  // The `apps/web` routes import specific master UI components directly
  // (not through the inbox barrel). Bypass the workspace-resolver's
  // subpath restriction by aliasing the deep src paths here.
  { find: /^@deepseek-ai\/dsh-client-ui-conversation$/, replacement: src('../../packages/client/ui-conversation/src/client/index.ts') },
  { find: /^@deepseek-ai\/dsh-client-ui-settings-plugins$/, replacement: src('../../packages/client/ui-settings-plugins/src/client/index.ts') },
]
/**
 * Vendor-chunk membership, by exact npm package name — the heavy render
 * families (math, highlight, markdown) that change only on dependency bumps.
 * Only packages workspace code imports DIRECTLY need listing: their private
 * transitive dependencies (oniguruma machinery, character tables, …) are
 * imported solely by these and rollup's chunk coloring pulls them into
 * vendor automatically. A dependency shared with index-side code falls back
 * to index — a few kB of dilution, never a correctness problem. Anything not
 * listed (react family, the vendored cordis workspace, tiny helpers like
 * anser/clsx, all workspace code) stays in the default `index` chunk, so
 * editing shell code re-hashes only index and returning clients keep the
 * cached vendor chunk.
 *
 * Every member must be React-free. A package that
 * imports react/jsx-runtime must never be listed — rollup folds a module
 * shared between the entry and a manual chunk into the manual chunk, so one
 * react-importing member would drag the single shared react copy into
 * vendor. The React side of markdown/math rendering is workspace code and
 * rides index.
 */
const VENDOR_PACKAGES: ReadonlySet<string> = new Set([
  // math
  'katex',
  // syntax highlight (@shikijs/langs is handled separately below —
  // lazy grammars must not land here)
  'shiki',
  // markdown parse pipeline (micromark/mdast; the incremental React renderer
  // over it is workspace code)
  'mdast-util-from-markdown',
  'mdast-util-gfm',
  'mdast-util-math',
  'micromark-core-commonmark',
  'micromark-extension-gfm',
  'micromark-extension-math',
  'micromark-factory-space',
  'micromark-util-character',
  'micromark-util-classify-character',
  'micromark-util-sanitize-uri',
  'micromark-util-symbol',
  'micromark-util-types',
])

/**
 * Boot grammars statically imported by ui-primitives' highlight.ts
 * (`@shikijs/langs/typescript` → `dist/typescript.mjs`, etc.). They live in
 * the same package as the lazy read-card grammars, but unlike those they are
 * part of the initial load and belong in the vendor chunk; the lazy ones must
 * stay unassigned so each keeps its own on-demand chunk.
 */
const BOOT_GRAMMAR_FILES: readonly string[] = [
  'dist/typescript.mjs',
  'dist/shellscript.mjs',
  'dist/json.mjs',
]

/** Font asset extensions routed to assets/fonts/ (KaTeX's woff2/woff/ttf faces). */
const FONT_EXTENSIONS: readonly string[] = ['.woff2', '.woff', '.ttf']

/**
 * npm package name of a resolved module id: the segment after the last
 * `node_modules/`. pnpm nests the real package under an inner node_modules.
 */
function npmPackageOf(id: string): string | undefined {
  const parts = id.split('/node_modules/')
  if (parts.length === 1) return undefined
  const [first, second] = parts[parts.length - 1].split('/')
  if (first.startsWith('.')) return undefined // .pnpm store segment, not a package
  if (first.startsWith('@')) return second === undefined ? undefined : `${first}/${second}`
  return first
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Drop-in replacement for `vite-plugin-node-polyfills`. The upstream
    // plugin keeps pulling in `undici` (used by `node:fetch`) which has
    // its own broken subpath imports (`require('node:fs/promises')` from
    // a relative path the polyfill's cjs walker can't satisfy). The
    // exclude list (Phase 2 follow-up #10) only papers over the symptom.
    //
    // The manual shim: every `node:*` import (including subpaths like
    // `node:fs/promises` and `node:util/types`) resolves to the
    // single hand-written stub module below. The stub exports named
    // proxies for the ~80 symbols the in-box plugins reach for at
    // module-evaluation time; unknown names resolve to a throw-stub
    // so the next plugin that introduces e.g. `mkdirSync` doesn't
    // need an edit. `enforce: 'pre'` puts this hook ahead of Vite's
    // `resolve.alias` pass, so the worktree's explicit `node:module`
    // -> `node-module-stub` alias (loader compat) still wins for
    // that one id.
    nodeShimPlugin(),
    workspaceResolver(),
    officialBundleServer(),
    sessionExportServer(),
    dshMarketServer(),
    packagePluginBundles(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      // No `external` list is needed for `node:*` anymore. The
      // `nodeShimPlugin` (registered above with `enforce: 'pre'`)
      // catches every `id.startsWith('node:')` import and rewrites it
      // to `node-shims.ts`, which exports proxies for every named
      // symbol the in-box plugins reach for at module-evaluation time
      // and throw-stubs for everything else. The previous external
      // list (Phase 2 follow-up #10's `node:fs`, `node:util/types`,
      // `node:sqlite`, etc.) was a workaround for
      // `vite-plugin-node-polyfills`'s broken internal subpath
      // resolver; with the upstream plugin dropped entirely, every
      // `node:*` import compiles cleanly into the bundle and the
      // browser surfaces the boot error overlay only if something
      // accidentally *uses* a stub at runtime.
      output: {
        // Output layout: the two main chunks stay at assets/ root; lazy
        // @shikijs/langs grammar chunks group under assets/langs/; fonts
        // (all KaTeX faces referenced by vendor.css) group under
        // assets/fonts/. Sourcemaps need no arrangement: rollup writes each
        // .map next to its js and references it by bare relative filename.
        chunkFileNames(chunk): string {
          // Grammar chunks are recognized by their member modules, not the
          // facade: shared embedded-grammar chunks (e.g. html+javascript,
          // split out because php/ruby/mdx embed them) have no facade at all.
        // index and vendor are excluded by name — vendor legitimately
        // carries the three boot grammars.
        if (chunk.name === 'index' || chunk.name === 'vendor') return 'assets/[name]-[hash].js'
        const isLangChunk = chunk.moduleIds.some(id => id.includes('/node_modules/@shikijs/langs/'))
        return isLangChunk ? 'assets/langs/[name]-[hash].js' : 'assets/[name]-[hash].js'
        },
        assetFileNames(asset): string {
          const fileName = asset.names[0] ?? ''
          const isFont = FONT_EXTENSIONS.some(ext => fileName.endsWith(ext))
          return isFont ? 'assets/fonts/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'
        },
        manualChunks(id: string): string | undefined {
          const pkg = npmPackageOf(id)
          if (pkg === undefined) return undefined // workspace + vendored cordis: index
          if (pkg === '@shikijs/langs') {
            return BOOT_GRAMMAR_FILES.some(file => id.endsWith(`/${file}`)) ? 'vendor' : undefined
          }
          return VENDOR_PACKAGES.has(pkg) ? 'vendor' : undefined
        },
      },
    },
  },
  resolve: {
    // Workspace packages resolve to SOURCE: package.json exports point at lib
    // for Node/type consumers, but the browser bundle must compile src directly
    // so CSS rides vite's pipeline instead of the CSS-externalized lib bundle.
    // Only the shell's normal package entry is aliased — plugin packages are
    // NEVER bundled here (shell self-sufficiency — see
    // packages/client/web/README.md); they arrive as runtime
    // bundles through the client module system. Order matters — subpath
    // aliases must win over bare-name prefixes.
    alias: [
      // Browserization of the vendored cordis Loader: its only node-only
      // import; the two process probes are mapped by `define` below.
      // The `nodeShimPlugin` (registered above with `enforce: 'pre'`)
      // catches every `node:*` import first and rewrites it to
      // `node-shims.ts`, but `node:module` is special-cased here so
      // the vendored loader's `import { createRequire } from 'node:module'`
      // gets the proper throwing stub (`createRequire` is unreachable
      // in the configured loader path and fails loud if that assumption
      // changes).
      { find: /^node:module$/, replacement: src('./src/node-module-stub.ts') },
      // In-box workspace plugins: every @deepseek-ai/dsh-* package's src entry
      // (./client for dual-half packages whose host entry is Node-only). The
      // shell boot calls ctx.plugin() on these in apps/web/src/dsh/inbox.
      // The `workspaceResolver` plugin below handles the same set via each
      // package's own `exports` → lib/types path; the static alias map stays
      // explicit so the most common specifiers (e.g. ui-slots, ui-primitives)
      // resolve without touching the resolver at all.
      { find: /^@deepseek-ai\/cordis-plugin-loader$/, replacement: src('../../vendor/loader/src/index.ts') },
      { find: /^@deepseek-ai\/cordis$/, replacement: src('../../vendor/cordis/src/index.ts') },
      { find: /^@deepseek-ai\/cosmokit$/, replacement: src('../../vendor/cosmokit/src/index.ts') },
      { find: /^@deepseek-ai\/schemastery$/, replacement: src('../../vendor/schemastery/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-web$/, replacement: src('../../packages/client/web/src/boot.tsx') },
      { find: /^@deepseek-ai\/dsh-client-web-react$/, replacement: src('../../packages/client/web-react/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-slots$/, replacement: src('../../packages/client/ui-slots/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-primitives$/, replacement: src('../../packages/client/ui-primitives/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-attachment$/, replacement: src('../../packages/client/ui-attachment/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-schema-form$/, replacement: src('../../packages/client/schema-form/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-modules\/client$/, replacement: src('../../packages/client/modules/src/client/index.ts') },
      // In-box workspace plugins: the workspaceResolver plugin (registered
      // below) handles every @deepseek-ai/dsh-* import by reading each
      // package's own exports → lib/types/* path and translating back to
      // src/*.ts. Vite aliases can't enumerate the 229 packages cleanly —
      // some project their `./client` half into unusual layouts
      // (`src/client.ts`, `src/fetch/client.ts`, …) the wildcard table
      // would miss.
      ...VENDOR_PACKAGE_ALIASES,
    ],
  },
  // Vite's optimizeDeps pre-bundles dev-time tools discovered via the
  // dependency graph. chokidar is Vite's own dev file-watcher and is
  // intentionally pulled in by the dev-server transform pipeline, NOT
  // runtime client code. The `nodeShimPlugin` (registered above with
  // `enforce: 'pre'`) rewrites `node:fs` to `node-shims.ts` (a
  // browser-only throw-stub) — chokidar's *stat* calls would resolve
  // against that stub and break real file watching, so we keep it
  // excluded from pre-bundling. fsevents and readdirp are chokidar's
  // own optional transitive deps — exclude them so the pre-bundler
  // doesn't try to walk their node:fs-touching paths either.
  optimizeDeps: {
    exclude: [
      'chokidar', 'fsevents', 'readdirp',
      // LLM SDKs bundle dynamic `import('node:buffer')` for image / byte
      // payloads. Esbuild pre-bundling preserves the string literal so
      // `nodeShimPlugin` never sees it; serve them as raw source instead so
      // the dynamic `node:*` specifier is rewritten through the same
      // resolveId hook as every other import.
      '@anthropic-ai/sdk',
      '@google/generative-ai',
      '@google-cloud/vertexai',
    ],
  },
  define: {
    // vendored loader internal.ts: fromInternal() probes the Node major —
    // "0.0.0" takes neither branch, returning undefined (exactly the empty
    // internal slot the shell boot fills with the client module loader).
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    // vendored loader index.ts: envData falls to its default branch.
    'process.env.CORDIS_SHARED': 'undefined',
  },
  // Dev-mode TS transform target. Several in-box packages use the
  // TypeScript 5.2+ `using` declaration (`using d = deadline(...)` in
  // bash-local / jobs-local / timeout-policy) and a stage-3 class
  // decorator (`@Remote` on commands/index.ts). esbuild's default
  // esnext target keeps those as-is in the transform output, which the
  // browser then rejects with `SyntaxError: Invalid or unexpected token`
  // and breaks the entire `import * as dsh_X` graph in apps/web's
  // in-box barrel. Targeting es2024 forces esbuild to downlevel both
  // features to their polyfilled forms — the polyfilled `using` lives
  // inline in the same file (no extra runtime dep) and works in every
  // evergreen browser. Production builds run through Rollup and handle
  // these features via their own plugin chain, so this only constrains
  // the dev-server transform.
  esbuild: {
    target: 'es2024',
  },
})
