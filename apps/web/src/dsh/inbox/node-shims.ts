// Browser-safe stub for Node built-ins. Phase 2 in-box plugins import a
// long tail of `node:*` symbols at module-evaluation time. Each export
// below is a class/function that throws on USE (not on import) with a clear
// message; the boot-error overlay (follow-up #3) surfaces any actual call
// that needs porting. The Proxy trick on `default` makes any *unknown* name
// resolve to the same throw-stub, so the next plugin that introduces e.g.
// `mkdirSync` doesn't require editing this file again.

const NOT_AVAILABLE_MESSAGE =
  'Node built-in called in WebView2 — this symbol is not ported. ' +
  'See apps/web/src/dsh/inbox/node-shims.ts and docs/migrations/plugin-migration-audit.md'

function notAvailable(): never {
  throw new Error(NOT_AVAILABLE_MESSAGE)
}

function stub(): unknown {
  return new Proxy(function () { notAvailable() }, {
    get: (_, prop) => {
      if (typeof prop === 'symbol') return undefined
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
      if (prop === Symbol.toPrimitive || prop === 'toString') return undefined
      return () => notAvailable()
    },
  })
}

const _stub = stub()
export default _stub
// Re-export _stub under all common Node names so `import { Readable } from
// 'node:stream'` works without a separate shim per module.
export const sep = '/'
export const delimiter = ':'
export const win32 = _stub
export const posix = _stub
export const relative = _stub
export const normalize = _stub
export const isAbsolute = _stub
export const join = _stub
export const dirname = _stub
export const basename = _stub
export const extname = _stub
export const resolve = _stub
export const parse = _stub
export const format = _stub
export const delimiter_ = _stub
export const tmpdir = _stub
export const homedir = _stub
export const platform = _stub
export const arch = _stub
export const cpus = _stub
export const totalmem = _stub
export const freemem = _stub
export const release = _stub
export const type = _stub
export const userInfo = _stub
export const EOL = '\n'
export const hostname = _stub
export const networkInterfaces = _stub
export const endianness = () => 'LE'
export const availableParallelism = () => 1
export const Readable = _stub
export const Writable = _stub
export const Transform = _stub
export const Duplex = _stub
export const PassThrough = _stub
export const pipeline = _stub
export const finished = _stub
export const Stream = _stub
export const fileURLToPath = _stub
export const pathToFileURL = _stub
export const formatURL = _stub
export const URL = _stub
export const randomUUID = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
export const randomBytes = _stub
export const createHash = _stub
export const createHmac = _stub
export const scrypt = _stub
export const timingSafeEqual = _stub
export const StringDecoder = _stub
export const promisify = _stub
export const types = _stub
export const inspect = _stub
export const format2 = _stub
export const deprecate = _stub
// fs
export const readFileSync = _stub
export const writeFileSync = _stub
export const existsSync = _stub
export const statSync = _stub
export const lstatSync = _stub
export const readdirSync = _stub
export const mkdirSync = _stub
export const unlinkSync = _stub
export const rmdirSync = _stub
export const renameSync = _stub
export const copyFileSync = _stub
export const realpathSync = _stub
export const readlinkSync = _stub
export const symlinkSync = _stub
export const utimesSync = _stub
export const promises = _stub
export const createReadStream = _stub
export const createWriteStream = _stub
export const watch = _stub
export const stat = _stub
export const readFile = _stub
export const writeFile = _stub
export const readdir = _stub
export const mkdir = _stub
export const access = _stub
// process
export const env = _stub
export const argv = _stub
export const pid = 0
export const platform2 = 'browser'
export const version2 = 'v0.0.0'
export const versions = _stub
export const exit = () => { throw new Error('process.exit in WebView2') }
export const nextTick = (fn: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(() => fn(...args), 0)
export const cwd = () => '/'
export const chdir = () => { throw new Error('process.chdir in WebView2') }
export const stdout = _stub
export const stderr = _stub
export const stdin = _stub
export const memoryUsage = () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 })
export const hrtime = () => [0, 0] as [number, number]
export const uptime = () => 0
export const kill = _stub
