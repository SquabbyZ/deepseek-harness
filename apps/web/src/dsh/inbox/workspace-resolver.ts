// Resolve `@deepseek-ai/dsh-X` (and any /subpath suffix) to the matching
// workspace package's source entry. Each package.json declares its `exports`
// pointing at `lib/` (built output that does not yet exist), so node's
// default resolution fails — Vite needs an explicit redirect to `src/`.
//
// The redirect is computed from the package's own `exports` field:
//   1. Resolve `@deepseek-ai/<pkg>` (or `<pkg>/<sub>`) the way node would,
//      using the `packages/<group>/<basename>/package.json` lookup.
//   2. Translate the declared `default` (`./lib/types/...js` or `./lib/...js`)
//      back to the matching `src/...ts` source file.
//
// This keeps every package's source location declared by its own
// `package.json` — no global `paths` table, no per-package alias row.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ResolveIdResult } from 'rollup'

interface PackageEntry {
  readonly srcDir: string
  readonly exports: Record<string, unknown> | undefined
}

const PKG_DIR_RE = /^@deepseek-ai\/(dsh-[a-z0-9-]+)(\/.*)?$/

/** Cache the parsed package.json for each npm name we resolve. */
const pkgCache = new Map<string, PackageEntry | undefined>()

function workspaceRoot(): string {
  // workspace-resolver.ts lives at apps/web/src/dsh/inbox/ — five `..`s
  // walk up through dsh/, src/, web/, apps/, then land at the workspace root.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../')
}

function lookupPackage(name: string): PackageEntry | undefined {
  const cached = pkgCache.get(name)
  if (cached !== undefined || pkgCache.has(name)) return cached
  const root = workspaceRoot()
  // Walk packages/*/package.json looking for the matching `name`.
  const dirs = fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue
    const group = path.join(root, 'packages', dirent.name)
    const subdirs = fs.readdirSync(group, { withFileTypes: true })
    for (const sub of subdirs) {
      if (!sub.isDirectory()) continue
      const pkgDir = path.join(group, sub.name)
      const pkgPath = path.join(pkgDir, 'package.json')
      if (!fs.existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.name !== name) continue
        const entry: PackageEntry = {
          srcDir: pkgDir,
          exports: typeof pkg.exports === 'object' ? pkg.exports as Record<string, unknown> : undefined,
        }
        pkgCache.set(name, entry)
        return entry
      } catch {
        continue
      }
    }
  }
  pkgCache.set(name, undefined)
  return undefined
}

/**
 * Translate a `default` export target (`./lib/types/...js` or `./lib/...js`)
 * to the matching `src/...ts` source file. Assumes the lib and src trees
 * mirror each other (`lib/types/<x>.js` ↔ `src/<x>.ts`; `lib/<x>.js` ↔
 * `src/<x>.ts`). Strip the `lib/` or `lib/types/` prefix, the trailing
 * `.js`, and try both `<rel>.ts` and `<rel>/index.ts`.
 */
function libPathToSrc(pkgDir: string, libPath: string): string | undefined {
  let rel = libPath.replace(/^\.\//, '')
  // Strip every leading `lib/` or `lib/types/` segment — the lib tree mirrors
  // src but its top-level folder may be either `lib/` (most packages) or
  // `lib/types/` (packages that tsdown emits to lib/types).
  rel = rel.replace(/^lib\/(types\/)?/, '')
  rel = rel.replace(/\.js$/, '')
  const candidate = path.join(pkgDir, 'src', `${rel}.ts`)
  if (fs.existsSync(candidate)) return candidate
  const candidateIndex = path.join(pkgDir, 'src', rel, 'index.ts')
  if (fs.existsSync(candidateIndex)) return candidateIndex
  return undefined
}

/**
 * Match a subpath import like `/client` against the package's `exports`
 * table. Returns the lib path declared by the first matching entry.
 */
function matchExports(exportsTable: Record<string, unknown>, subpath: string): string | undefined {
  const candidates = subpath === '' ? ['.', './'] : [subpath, `.${subpath}`]
  for (const key of candidates) {
    const entry = exportsTable[key]
    if (entry === undefined) continue
    if (typeof entry === 'string') return entry
    if (typeof entry === 'object' && entry !== null && 'default' in entry) {
      const def = (entry as Record<string, unknown>).default
      if (typeof def === 'string') return def
    }
  }
  return undefined
}

/**
 * Fall back to a `<pkgDir>/src/<basename>.ts` or `<pkgDir>/src/<basename>/index.ts`
 * lookup. Mirrors the npm-name → package-dir convention: package name suffix
 * matches the basename inside `src/`.
 */
function fallbackSrc(pkgDir: string, subpath: string): string | undefined {
  if (subpath !== '') return undefined
  const indexTs = path.join(pkgDir, 'src/index.ts')
  if (fs.existsSync(indexTs)) return indexTs
  const candidateDirs = fs.readdirSync(path.join(pkgDir, 'src'), { withFileTypes: true }).filter((d) => d.isDirectory())
  for (const d of candidateDirs) {
    const idx = path.join(pkgDir, 'src', d.name, 'index.ts')
    if (fs.existsSync(idx)) return idx
    const file = path.join(pkgDir, 'src', `${d.name}.ts`)
    if (fs.existsSync(file)) return file
  }
  return undefined
}

function resolveSource(source: string): string | undefined {
  const match = PKG_DIR_RE.exec(source)
  if (!match) return undefined
  const name = `@deepseek-ai/${match[1]!}`
  const subpath = match[2] ?? ''
  const pkg = lookupPackage(name)
  if (!pkg) return undefined
  if (pkg.exports) {
    const libPath = matchExports(pkg.exports, subpath)
    if (libPath) {
      const src = libPathToSrc(pkg.srcDir, libPath)
      if (src) return src
    }
  }
  return fallbackSrc(pkg.srcDir, subpath)
}

export function workspaceResolver(): Plugin {
  return {
    name: 'dsh-workspace-resolver',
    enforce: 'pre',
    async resolveId(source: string, _importer: string | undefined): Promise<ResolveIdResult | undefined> {
      // Skip virtual / data: / absolute paths.
      if (!source.startsWith('@deepseek-ai/dsh-')) return undefined
      const src = resolveSource(source)
      if (src) return src
      return undefined
    },
  }
}
