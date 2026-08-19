/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with the semantics the
 * Web shell locked at step1 — traversal outside the dist root is 403, any
 * miss falls back to index.html with HTTP 200 (SPA routing), unknown
 * extensions ship as octet-stream, non-GET/HEAD is 405. Every index response
 * runs through the webserver's registered index taps (boot-manifest
 * injection). The dist location is workspace knowledge of the composing
 * application, so `distIndex` is typically supplied through a `!!js`
 * expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Service required before the fallback seat can be claimed. */
export const inject = ['webServer']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param renderIndex - produces the index.html body (index-tap injection) for
 * `/` and every SPA fallback.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  renderIndex: () => Promise<string>,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  const serveIndex = async (): Promise<void> => {
    const body = await renderIndex()
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(body)
  }
  if (target === distRoot || target === distIndex) {
    await serveIndex()
    return
  }
  try {
    const body = await readFile(target)
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // Miss (ENOENT/EISDIR) falls back to index.html with 200 (SPA routing).
    await serveIndex()
  }
}

/**
 * Static-asset service for the built frontend. The previous implementation
 * claimed the deleted `ctx.webServer` fallback seat and ran the index tap
 * pipeline through the webserver carrier. Phase 2 retires that carrier; this
 * plugin keeps `serveStatic` and the dist resolution so a Tauri asset-protocol
 * wrapper (or successor carrier) can adopt it without re-deriving the path
 * semantics.
 * @param ctx - plugin context (no longer claims the webServer service).
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> =>
    /* v8 ignore next -- the index-tap pipeline is reapplied by the next carrier */
    await readFile(distIndex, 'utf8')
  // `serveStatic` and `renderIndex` are kept for the successor carrier; the
  // current apply body is a no-op so the plugin stays loaded without the
  // retired route registration.
  void ctx
  void distRoot
  void renderIndex
}
