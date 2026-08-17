/**
 * On-demand downloader for the lazily-imported provider SDKs.
 *
 * `@earendil-works/pi-ai` imports each provider's SDK by bare name inside a
 * lazy chunk (`mistral-conversations.js` → `@mistralai/mistralai`, etc.), so
 * those packages are only loaded when the operator actually configures that
 * provider. The desktop runtime prunes them (see scripts/prune-browser-only.mjs)
 * to shrink the installer; this module makes the first such import download the
 * SDK from the npm registry into the writable `~/.dsh/sdks` tree and resolve it,
 * keeping the install self-contained while the optional providers stay available.
 *
 * Registered as a `node:module` `registerHooks` resolve hook from `bin.ts`, so
 * the bare specifier resolves before the default loader's `ERR_MODULE_NOT_FOUND`.
 *
 * @module @deepseek-ai/dsh/bin/lazy-sdk
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

/** Provider SDKs pi-ai imports by bare name; downloaded on first use. */
export const LAZY_SDK_EXACT: readonly string[] = [
  '@mistralai/mistralai',
  '@anthropic-ai/sdk',
  'openai',
  '@google/genai',
]

/** SDK families imported as subpackages (AWS Bedrock); matched by prefix. */
export const LAZY_SDK_PREFIX: readonly string[] = ['@aws-sdk/', '@smithy/']

/** Whether a bare specifier names a lazily-downloaded provider SDK. */
export function isLazySdk(specifier: string): boolean {
  return LAZY_SDK_EXACT.includes(specifier)
    || LAZY_SDK_PREFIX.some(prefix => specifier.startsWith(prefix))
}

/** The package name of a bare specifier (strips any subpath). */
function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0] ?? specifier
}

/** Writable cache root: `<home>/.dsh/sdks/node_modules/<pkg>`. */
function sdkRoot(): string {
  return join(homedir(), '.dsh', 'sdks', 'node_modules')
}

/** In-flight downloads, keyed by package, so concurrent imports download once. */
const inFlight = new Map<string, Promise<string>>()

/** Packages already materialized under `~/.dsh/sdks` (dedup across the recursive closure). */
const downloaded = new Set<string>()

/**
 * Ensure one provider SDK is present and return the file URL of its entry.
 * @param specifier - the bare specifier being imported.
 * @returns the resolved `file://` URL for the package entry.
 */
export function ensureSdk(specifier: string): Promise<string> {
  const pkg = packageName(specifier)
  const existing = inFlight.get(pkg)
  if (existing !== undefined) return existing
  const pending = doEnsure(specifier, pkg)
  inFlight.set(pkg, pending)
  void pending.catch(() => inFlight.delete(pkg))
  return pending
}

async function doEnsure(specifier: string, pkg: string): Promise<string> {
  const dir = join(sdkRoot(), ...pkg.split('/'))
  let entry = resolveEntry(dir, specifier)
  if (entry === undefined) {
    await download(pkg, dir)
    entry = resolveEntry(dir, specifier)
    if (entry === undefined) throw new Error(`lazy SDK "${pkg}" downloaded but has no resolvable entry`)
  }
  return pathToFileURL(entry).href
}

/**
 * Fetch the package's latest tarball, extract it, and recursively fetch its
 * runtime dependencies — a minimal `npm install` so the downloaded SDK's own
 * bare imports (`zod`, `ws`, `bowser`, …) resolve against the cache rather than
 * the read-only bundled node_modules. Lazy SDKs are skipped: the loader downloads
 * each on its own import, and peers are skipped (the SDK tolerates their absence).
 */
async function download(pkg: string, dir: string): Promise<void> {
  if (downloaded.has(pkg)) return
  downloaded.add(pkg)
  const meta = (await (await fetch(`https://registry.npmjs.org/${pkg}`)).json()) as {
    'dist-tags'?: { latest?: string }
    versions?: Record<string, { dist?: { tarball?: string }; dependencies?: Record<string, string> }>
  }
  const version = meta['dist-tags']?.latest
  const tarball = version === undefined ? undefined : meta.versions?.[version]?.dist?.tarball
  if (version === undefined || tarball === undefined) {
    throw new Error(`lazy SDK "${pkg}": cannot resolve a tarball from the npm registry`)
  }
  const body = Buffer.from(await (await fetch(tarball)).arrayBuffer())
  extractTar(gunzipSync(body), dir)
  console.error(`[dsh] downloaded provider SDK dependency ${pkg}@${version}`)

  const dependencies = meta.versions?.[version]?.dependencies ?? {}
  for (const [dep] of Object.entries(dependencies)) {
    if (isLazySdk(dep)) continue
    await download(dep, join(sdkRoot(), ...dep.split('/')))
  }
}

/** Resolve a package's entry file for a bare specifier, or undefined when absent. */
function resolveEntry(dir: string, specifier: string): string | undefined {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  let json: {
    exports?: unknown
    main?: string
    module?: string
  }
  try { json = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { return undefined }

  // The subpath ('' for the bare package); pi-ai imports the bare package.
  const subpath = specifier.slice(packageName(specifier).length) || '.'

  const candidate = exportsTarget(json.exports, subpath)
    ?? (subpath === '.' ? json.module ?? json.main : undefined)
  if (candidate === undefined) return undefined
  return join(dir, candidate)
}

/** Pick the `import`/`node`/`default`/`require` arm of an `exports` target. */
function exportsTarget(exportsValue: unknown, subpath: string): string | undefined {
  if (typeof exportsValue === 'string') return exportsValue
  if (exportsValue === null || typeof exportsValue !== 'object') return undefined
  if (Array.isArray(exportsValue)) return exportsTarget(exportsValue[0], subpath)
  // A subpath map: `{ ".": {...}, "./x": {...} }`. Prefer the exact subpath, else ".".
  const keys = Object.keys(exportsValue)
  const hasSubpath = keys.some(k => k !== '.' && !k.startsWith('.') === false)
  void hasSubpath
  const target = (exportsValue as Record<string, unknown>)[subpath]
    ?? (subpath === '.' ? undefined : (exportsValue as Record<string, unknown>)['.'])
  if (target === undefined) return undefined
  // Conditional exports object: prefer import > node > default > require > string.
  if (typeof target === 'string') return target
  if (Array.isArray(target)) return exportsTarget(target[0], subpath)
  if (target !== null && typeof target === 'object') {
    for (const cond of ['import', 'node', 'default', 'require']) {
      const arm = (target as Record<string, unknown>)[cond]
      if (typeof arm === 'string') return arm
    }
    for (const value of Object.values(target as Record<string, unknown>)) {
      const arm = exportsTarget(value, subpath)
      if (arm !== undefined) return arm
    }
  }
  return undefined
}

/**
 * Minimal npm-tarball extractor: regular files, directories, and GNU longname
 * entries, stripping the `package/` prefix npm writes. Enough for the provider
 * SDKs (no symlinks or sparse files).
 */
function extractTar(buf: Buffer, dest: string): void {
  let offset = 0
  let pendingName: string | undefined
  while (offset + 512 <= buf.length) {
    const block = buf.subarray(offset, offset + 512)
    if (block.every(b => b === 0)) break
    const name = block.subarray(0, 100).toString('ascii').replace(/\0.*$/, '')
    const prefix = block.subarray(345, 500).toString('ascii').replace(/\0.*$/, '')
    const size = parseInt(block.subarray(124, 136).toString('ascii').trim() || '0', 8) || 0
    const typeflag = String.fromCharCode(block[156] ?? 0)
    offset += 512
    const padded = Math.ceil(size / 512) * 512
    if (typeflag === 'L') {
      pendingName = buf.subarray(offset, offset + size).toString('ascii').replace(/\0.*$/, '')
      offset += padded
      continue
    }
    if (typeflag === 'x' || typeflag === 'g') {
      // PAX extended header: carries the real `path=` for the following entry
      // (long OpenAPI filenames in the provider SDKs exceed the 100-byte name).
      const paxData = buf.subarray(offset, offset + size).toString('ascii')
      const pathMatch = /path=([^\n]+)/.exec(paxData)
      if (pathMatch !== null) pendingName = pathMatch[1]
      offset += padded
      continue
    }
    const finalName = pendingName ?? (prefix !== '' ? `${prefix}/${name}` : name)
    pendingName = undefined
    offset += padded
    if (finalName === '') continue
    const rel = finalName.replace(/^package\//, '')
    if (rel === '' || rel === '.') continue
    if (typeflag === '5') {
      mkdirSync(join(dest, rel), { recursive: true })
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
      const data = buf.subarray(offset - padded, offset - padded + size)
      mkdirSync(dirname(join(dest, rel)), { recursive: true })
      writeFileSync(join(dest, rel), data)
    }
  }
}
