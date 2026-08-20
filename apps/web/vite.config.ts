import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { workspaceResolver } from './src/dsh/inbox/workspace-resolver.ts'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

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
    exclude: ['chokidar', 'fsevents', 'readdirp'],
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
