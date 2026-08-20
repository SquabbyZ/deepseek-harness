// Browser-safe shims for Node built-ins that some in-box plugins accidentally
// import at top-level. Phase 1 + Phase 2's `vite.config.ts` aliases these
// modules to this file. We provide just enough of the API surface that the
// 136 browser-safe plugins touch at module-evaluation time; if a plugin needs
// more, that plugin is misclassified (should be in the "needs-port" set, not
// the in-box set).
//
// All runtime helpers throw a helpful error so misclassified plugins surface
// via the error overlay instead of silently producing wrong results. The goal
// of this shim is "boot succeeds, runtime errors are visible".
const isWindows = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

/** Throw a consistent "not available in WebView2" error for any stub call. */
function unavailable(mod: string, name: string): never {
  throw new Error(`node:${mod}.${name} is not available in WebView2`)
}

// ─── node:path ───────────────────────────────────────────────────────────────
export const sep = '/'
export const delimiter = ':'

export function normalize(p: string): string {
  if (!p) return p
  // Collapse multiple slashes
  return p.replace(/[\\/]+/g, '/')
}

export function isAbsolute(p: string): boolean {
  if (!p) return false
  return p.startsWith('/') || isWindows(p)
}

export function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/[\\/]+/g, '/')
}

export function dirname(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx === -1 ? '.' : (idx === 0 ? '/' : p.slice(0, idx))
}

export function basename(p: string, ext?: string): string {
  let base = p.slice(p.lastIndexOf('/') + 1)
  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length)
  return base || ''
}

export function extname(p: string): string {
  const base = basename(p)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot)
}

export const posix = { sep, delimiter, normalize, isAbsolute, join, dirname, basename, extname }
export const win32 = posix
export default posix

// ─── node:stream ─────────────────────────────────────────────────────────────
export class Readable {
  constructor() { unavailable('stream', 'Readable') }
}
export class Writable {
  constructor() { unavailable('stream', 'Writable') }
}
export class Transform extends Readable {
  constructor() { super(); unavailable('stream', 'Transform') }
}
export class Duplex extends Readable {
  constructor() { super(); unavailable('stream', 'Duplex') }
}
export class PassThrough extends Transform {
  constructor() { super(); unavailable('stream', 'PassThrough') }
}
export function pipeline(): never { unavailable('stream', 'pipeline') }
export function finished(): never { unavailable('stream', 'finished') }

// ─── node:fs ─────────────────────────────────────────────────────────────────
export function readFileSync(): never { unavailable('fs', 'readFileSync') }
export function writeFileSync(): never { unavailable('fs', 'writeFileSync') }
export function existsSync(): never { unavailable('fs', 'existsSync') }
export function statSync(): never { unavailable('fs', 'statSync') }
export function readdirSync(): never { unavailable('fs', 'readdirSync') }
export function mkdirSync(): never { unavailable('fs', 'mkdirSync') }
export function unlinkSync(): never { unavailable('fs', 'unlinkSync') }
export function rmdirSync(): never { unavailable('fs', 'rmdirSync') }
export function createReadStream(): never { unavailable('fs', 'createReadStream') }
export function createWriteStream(): never { unavailable('fs', 'createWriteStream') }
export function realpathSync(): never { unavailable('fs', 'realpathSync') }
export const promises = {
  readFile: () => unavailable('fs', 'promises.readFile'),
  writeFile: () => unavailable('fs', 'promises.writeFile'),
}

// ─── node:os ─────────────────────────────────────────────────────────────────
export const platform: NodeJS.Platform = 'browser'
export const arch: string = 'web'
export function homedir(): string { return '/' }
export function tmpdir(): string { return '/' }
export function cpus(): never { unavailable('os', 'cpus') }
export function totalmem(): never { unavailable('os', 'totalmem') }
export function freemem(): never { unavailable('os', 'freemem') }
export const release: string = ''
export const type: string = 'WebView2'
export function userInfo(): never { unavailable('os', 'userInfo') }
export const EOL: string = '\n'

// ─── node:url ────────────────────────────────────────────────────────────────
export const URL: typeof globalThis.URL = globalThis.URL
export function fileURLToPath(): never { unavailable('url', 'fileURLToPath') }
export function pathToFileURL(): never { unavailable('url', 'pathToFileURL') }
export function format(): never { unavailable('url', 'format') }

// ─── node:crypto ─────────────────────────────────────────────────────────────
export function randomUUID(): string {
  // Browser-safe fallback so plugins that only *call* randomUUID at module-
  // init get a usable value. WebView2 always exposes crypto.randomUUID.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  // Last-resort v4-ish stand-in. Real UUID strength isn't required for the
  // shim's "import resolves" contract.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
export function createHash(): never { unavailable('crypto', 'createHash') }
export function randomBytes(): never { unavailable('crypto', 'randomBytes') }
export function scrypt(): never { unavailable('crypto', 'scrypt') }
export function timingSafeEqual(): never { unavailable('crypto', 'timingSafeEqual') }
export function createHmac(): never { unavailable('crypto', 'createHmac') }

// ─── node:string_decoder ─────────────────────────────────────────────────────
export class StringDecoder {
  constructor() { unavailable('string_decoder', 'StringDecoder') }
}