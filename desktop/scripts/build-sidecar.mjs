#!/usr/bin/env node
/**
 * Build the portable-Node sidecar: materialize a self-contained `dsh` web
 * profile plus the Node runtime, landing at src-tauri/resources/dsh-runtime/.
 *
 * Task 8 spawns `node dsh/lib/bin.js web --port <p>` from this directory.
 *
 * `pnpm --filter @deepseek-ai/dsh deploy` alone is NOT self-contained: the
 * Cordis Loader resolves plugins by bare-name import, and `dsh`'s plugins
 * declare ~77 non-optional workspace peers that `--prod` deploy omits (they
 * are satisfied only by workspace hoisting). We therefore deploy a
 * dependency-only manifest (`desktop/sidecar-runtime/package.json`, the same
 * pattern as `python/sdk-runtime`) whose dependency closure is the whole web
 * profile, then lay the `dsh` app files (`lib/*.js` + `config/`) on top.
 * `scripts/verify-runtime-closure.ts --manifest desktop/sidecar-runtime/package.json`
 * gates that closure.
 */
import { execSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const runtime = join(root, 'desktop', 'src-tauri', 'resources', 'dsh-runtime')
const dshApp = join(root, 'apps', 'cli')
// The manifest's own resolved node_modules in the workspace, where pnpm's
// legacy hoister leaves the cycle-broken packages it omits from the deploy.
const sourceNodeModules = join(root, 'desktop', 'sidecar-runtime', 'node_modules')
const isWin = process.platform === 'win32'

function run(cmd) {
  console.log(`> ${cmd}`)
  // CI=true matches scripts/build-exe-for-python-sdk.ts: artifact builds must
  // not mutate a developer's Git hooks via postinstall.
  execSync(cmd, { stdio: 'inherit', cwd: root, env: { ...process.env, CI: 'true' } })
}

/** Return the first symbolic link below `directory`, if one exists. */
function findSymlink(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) return path
    if (entry.isDirectory()) {
      const nested = findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Replace symlinks below `directory` with dereferenced real copies. The
 * workspace `overrides` pin `@deepseek-ai/{cosmokit,schemastery}` to
 * `link:vendor/*`, which legacy deploy materializes as links back into the
 * workspace — not self-contained. Mirrors `materializeStagedLinks` in
 * scripts/build-exe-for-python-sdk.ts.
 */
function materializeLinks(directory) {
  let remaining = findSymlink(directory)
  while (remaining !== undefined) {
    const source = realpathSync(remaining)
    const nestedNodeModules = join(source, 'node_modules')
    rmSync(remaining, { recursive: true, force: true })
    cpSync(source, remaining, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = findSymlink(directory)
  }
}

/**
 * Restore direct dependencies that pnpm's legacy deploy omits: packages in
 * workspace cycles (the `dsh-base`/`dsh-web-app`/`dsh-headless` bundles and
 * the shell family) are left beside the manifest instead of copied into the
 * target. Mirrors `restoreLegacyHoists` in scripts/build-exe-for-python-sdk.ts.
 */
function restoreLegacyHoists(dshDir) {
  const manifest = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(dshDir, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(
        `build-sidecar: deployed dependency ${dependency} is absent from both ${destination} and ${source}; run \`pnpm install\` so the manifest's node_modules is materialized.`,
      )
    }
    mkdirSync(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    console.log(`  restored omitted dependency ${dependency}`)
  }
}

// 1. Build the dsh library so every package has its lib/ output.
run('pnpm run build:lib')

// 2. Deploy the web-profile closure self-contained (manifest + node_modules).
const dshDir = join(runtime, 'dsh')
rmSync(dshDir, { recursive: true, force: true })
mkdirSync(runtime, { recursive: true })
run(
  [
    'pnpm',
    '--filter',
    'dsh-desktop-sidecar',
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    dshDir,
  ].join(' '),
)
restoreLegacyHoists(dshDir)
materializeLinks(join(dshDir, 'node_modules'))

// 3. Lay the dsh app files (lib/*.js + config/) over the deployed manifest,
//    matching @deepseek-ai/dsh's `files` field so bin.js + shipped presets
//    resolve from the same install anchor Task 8 expects.
cpSync(join(dshApp, 'lib'), join(dshDir, 'lib'), { recursive: true })
cpSync(join(dshApp, 'config'), join(dshDir, 'config'), { recursive: true })

// 4. Copy the Node runtime binary.
copyFileSync(process.execPath, join(runtime, isWin ? 'node.exe' : 'node'))

console.log(`sidecar runtime ready at ${runtime}`)
