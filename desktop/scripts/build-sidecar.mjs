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
  renameSync,
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
 * Hoist the lazily-loaded Mistral SDK into the deploy's top-level node_modules.
 *
 * `@mistralai/mistralai` is a hard dependency of `@earendil-works/pi-ai` (the
 * pi-ai LLM provider); pi-ai reaches it through a dynamic import
 * (`dist/api/mistral-conversations.lazy.js` -> `import("./mistral-conversations.js")`
 * -> `import { Mistral } from "@mistralai/mistralai"`). The web Models-settings
 * page still lists a `mistral` provider, so the SDK must stay loadable rather
 * than be pruned.
 *
 * pnpm's legacy deploy nests mistral beside pi-ai
 * (`pi-ai/node_modules/@mistralai/mistralai`) because mistral peers on the
 * optional `@opentelemetry/api@^1.9.0`. That deep nesting pushes its
 * OpenAPI-generated `esm/models/operations/*` files past Windows MAX_PATH and
 * aborts NSIS. Moving the package to the deploy root shortens the path below
 * MAX_PATH AND keeps the provider functional: Node resolves the bare-name import
 * by walking up from `pi-ai/.../mistral-conversations.js` to the top-level
 * `node_modules/@mistralai/mistralai`, and mistral's dependencies (`ws`, `zod`,
 * `zod-to-json-schema`, `@opentelemetry/semantic-conventions`) plus the optional
 * `@opentelemetry/api` peer are already hoisted at the deploy root.
 */
function hoistLazyMistral(dshDir) {
  const hoisted = join(dshDir, 'node_modules', '@mistralai', 'mistralai')
  const nested = join(dshDir, 'node_modules', '@earendil-works', 'pi-ai', 'node_modules', '@mistralai', 'mistralai')

  if (existsSync(nested)) {
    if (!existsSync(hoisted)) {
      mkdirSync(dirname(hoisted), { recursive: true })
      renameSync(nested, hoisted)
      console.log(`  hoisted @mistralai/mistralai to deploy root (MAX_PATH)`)
    } else {
      // The peer already resolved to the shared tree: the nested copy is
      // redundant dead weight carrying the long path — drop it.
      rmSync(nested, { recursive: true, force: true })
      console.log(`  dropped redundant nested @mistralai/mistralai (already hoisted)`)
    }
  } else if (!existsSync(hoisted)) {
    console.log('  note: @mistralai/mistralai absent from deploy (mistral provider unavailable)')
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

// 2. Verify the dependency-only manifest's closure is complete before deploy:
//    a missing required workspace peer would otherwise surface only at runtime
//    when Cordis loads the packaged plugin (ERR_MODULE_NOT_FOUND), so fail the
//    build here rather than ship a broken runtime. `--manifest` is forwarded
//    verbatim (no `--` separator: pnpm 11 would pass the literal `--` through).
run('pnpm run verify-runtime-closure --manifest desktop/sidecar-runtime/package.json')

// 3. Deploy the web-profile closure self-contained (manifest + node_modules).
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
    // Dev-only patches (tsdown) are legitimately absent from a --prod closure;
    // downgrade the UNUSED_PATCH error to a warning rather than fail the deploy.
    '--config.allow-unused-patches=true',
    dshDir,
  ].join(' '),
)
restoreLegacyHoists(dshDir)
materializeLinks(join(dshDir, 'node_modules'))
hoistLazyMistral(dshDir)

// 4. Lay the dsh app files (lib/*.js + config/) over the deployed manifest,
//    matching @deepseek-ai/dsh's `files` field so bin.js + shipped presets
//    resolve from the same install anchor Task 8 expects.
cpSync(join(dshApp, 'lib'), join(dshDir, 'lib'), { recursive: true })
cpSync(join(dshApp, 'config'), join(dshDir, 'config'), { recursive: true })

// 5. Copy the Node runtime binary.
copyFileSync(process.execPath, join(runtime, isWin ? 'node.exe' : 'node'))

// 6. Restore the workspace node_modules. The deploy's --config.node-linker=hoisted
//    leaves pnpm's deps-status check out of sync, so the NEXT `pnpm run` would
//    trigger an internal `install --production` that purges dev deps
//    (lefthook/typescript/react/…). A full reinstall undoes that purge so the
//    developer's workspace stays buildable.
run('pnpm install')

console.log(`sidecar runtime ready at ${runtime}`)
