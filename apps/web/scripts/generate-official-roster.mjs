/**
 * Generate apps/web/src/dsh/official-roster.generated.json — the static
 * `window.__DSH_BOOT__` entry graph for the official client UI.
 *
 * The official SaaS UI is the client plugin graph from packages/client/*,
 * booted by `@deepseek-ai/dsh-client-web`'s AppWebEntry. On the real host
 * (`dsh web`) the ClientModuleRegistry node half composes this graph from the
 * live loader entries and injects it as window.__DSH_BOOT__. The Phase-2
 * client-first shell has no such host, so this script composes the same graph
 * from the workspace: every package declaring `dsh.client.platform: 'web'` is
 * one entry, its bundle is the package's `exports["./client"]` artifact, and
 * its rev is the sha1 of that bundle's content (mirroring the host's
 * shortHash). Run it whenever a client bundle changes or a package adds/
 * removes a `dsh.client` declaration:
 *
 *     node apps/web/scripts/generate-official-roster.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))

/** sha1 content hash shortened to 12 hex chars — the host's rev scheme. */
function shortHash(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/** Every package.json under packages/one-level/two-level — the workspace surface. */
function workspacePackages() {
  const pjs = []
  for (const area of readdirSync(join(root, 'packages'))) {
    const areaDir = join(root, 'packages', area)
    if (!statSync(areaDir).isDirectory()) continue
    for (const name of readdirSync(areaDir)) {
      const pj = join(areaDir, name, 'package.json')
      if (existsSync(pj)) pjs.push(pj)
    }
  }
  return pjs
}

/** Resolve `exports["./client"]` to a bundle path (string or {default} form). */
function clientBundlePath(pjPath, pkg) {
  const client = pkg.exports?.['./client']
  const rel = typeof client === 'string' ? client : client?.default
  if (typeof rel !== 'string') return undefined
  const path = join(dirname(pjPath), rel)
  return existsSync(path) ? path : undefined
}

/** One graph entry per `dsh.client.platform === 'web'` package. */
function compose() {
  const entries = []
  const seen = new Set()
  for (const pjPath of workspacePackages()) {
    const pkg = JSON.parse(readFileSync(pjPath, 'utf8'))
    const decl = pkg.dsh?.client
    if (decl === undefined || decl.platform !== 'web') continue
    if (seen.has(pkg.name)) {
      throw new Error(`duplicate dsh.client package: ${pkg.name}`)
    }
    seen.add(pkg.name)
    const bundlePath = clientBundlePath(pjPath, pkg)
    if (bundlePath === undefined) {
      throw new Error(`${pkg.name} declares dsh.client but no built ./client export`)
    }
    const rev = shortHash(readFileSync(bundlePath))
    const entry = {
      id: pkg.name,
      url: `/plugins/${pkg.name}/client.js?rev=${rev}`,
      rev,
      ...(decl.inject?.length > 0 ? { inject: decl.inject } : {}),
      ...(decl.immediately === true ? { immediately: true } : {}),
    }
    entries.push(entry)
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { rev: shortHash(JSON.stringify(entries)), entries }
}

const graph = compose()
// AppWebEntry owns the client-modules entry itself (shell-bundled, never
// fetched — see boot.tsx MODULES_ID); exclude it so the loader doesn't try
// to materialize a second fiber for it.
graph.entries = graph.entries.filter(entry => entry.id !== '@deepseek-ai/dsh-client-modules')

// Client-first desktop composition decisions (the web-app bundle patch mounts
// these host-side; the shell composes the client graph directly):
//  - ui-directory-picker-browse: the host's directory-picker-auto row mounts
//    EXACTLY ONE picker backend. On this win32 desktop it resolves to native
//    (packages/host/directory-picker-auto/src/resolve.ts), and both backends
//    register the same `single` slot (conversation.hero.workspace.directoryFlow)
//    at priority 0 — a second registration throws. Keep native.
//  - client-hmr: the web reload chain is idle without a rebuild watcher; the
//    shell has none, so the row would only open a /plugins/events channel that
//    turns to a 404. Drop it (the web-app patch's `hmr.disabled` note for web).
//  - The Phase-2 inventory refactor deleted the HOST-side providers of
//    `remote.agentInventory` / `remote.mcpInventory` / `remote.pluginInventory`
//    / `remote.skillInventory` (inventory) and `remote.dynamicCordisRunner` /
//    `dynamicCordisRunner` (the Cordis tool/runner), but the client plugins
//    consuming them stayed in the roster. Nothing in this repo mounts those
//    services anymore, so those fibers pend forever and the boot sweep fails.
//    Exclude the consumers: the inventory settings tabs (replaced by the
//    Rust-host inventory commands) and the Cordis inspector/runner.
const DESKTOP_EXCLUDES = new Set([
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai/dsh-client-hmr',
  '@deepseek-ai/dsh-client-ui-settings-agent',
  '@deepseek-ai/dsh-client-ui-settings-mcp',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-settings-skill',
  '@deepseek-ai/dsh-client-ui-cordis',
  '@deepseek-ai/dsh-cordis-client-runner',
])
graph.entries = graph.entries.filter(entry => !DESKTOP_EXCLUDES.has(entry.id))
const out = join(root, 'apps/web/src/dsh/official-roster.generated.json')
writeFileSync(out, `${JSON.stringify(graph, null, 2)}\n`)
console.log(`wrote ${graph.entries.length} entries to ${out}`)
