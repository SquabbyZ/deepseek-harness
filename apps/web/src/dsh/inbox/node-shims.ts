// Browser-safe stub for Node built-ins. Phase 2 in-box plugins import a
// long tail of `node:*` symbols at module-evaluation time. Each export
// below is a class/function that throws on USE (not on import) with a clear
// message; the boot-error overlay (follow-up #3) surfaces any actual call
// that needs porting. The Proxy trick on `default` makes any *unknown* name
// resolve to the same throw-stub, so the next plugin that introduces e.g.
// `mkdirSync` doesn't require editing this file again.
//
// Phase 2 follow-up #11 (drop vite-plugin-node-polyfills): this file now
// serves as the destination for EVERY `node:*` import — including
// subpaths like `node:fs/promises`, `node:util/types`. The
// `nodeShimPlugin` registered in `apps/web/vite.config.ts` rewrites
// `id.startsWith('node:')` to this file before any other resolver runs.
// The util/types predicates (`isUint8Array`, `isArrayBuffer`, etc.)
// live here too (moved from `util-types-stub.ts` in #11) because undici's
// web/fetch body helpers destructure them at evaluation time and the
// named-export check fails without an explicit named export. The
// predicates return real booleans, not throw-stubs, because undici's
// runtime guards (`if (isPromise(x)) ...`) treat the boolean as
// control flow, not as evidence of a working call.

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
// node:events — chokidar does `import { EventEmitter } from 'node:events'`
// at top-level. Rollup's named-export check on node-shims.ts fails
// without an explicit named export even though the import is only
// structural (chokidar is excluded from the browser bundle by
// `optimizeDeps.exclude` so the EventEmitter binding never runs).
export const EventEmitter = _stub
export const fileURLToPath = _stub
export const pathToFileURL = _stub
export const formatURL = _stub
export const URL = _stub
export const randomUUID = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
export const randomBytes = _stub
export const createHash = _stub
export const createHmac = _stub
export const scrypt = _stub
export const AsyncLocalStorage = _stub
export const accessSync = _stub
export const timingSafeEqual = _stub
export const StringDecoder = _stub
export const promisify = _stub
export const types = _stub
export const inspect = _stub
export const format2 = _stub
export const deprecate = _stub
export const isDeepStrictEqual = _stub
export const isIP = _stub
export const parseArgs = _stub
export const parseEnv = _stub
export const stripTypeScriptTypes = _stub
export const TextDecoder = _stub
export const Buffer = _stub
export const SlowBuffer = _stub
export const constants = _stub
export const createInterface = _stub
export const readline = _stub
export const scheduler = _stub
export const setImmediate = _stub
export const setInterval = _stub
export const setTimeout = _stub
export const clearImmediate = _stub
export const clearInterval = _stub
export const clearTimeout = _stub
export const active = _stub
export const asyncLocalStorage = _stub
export const createHook = _stub
export const enabled = _stub
export const channel = _stub
export const hasSubscribers = _stub
export const publish = _stub
export const register = _stub
export const subscribe = _stub
export const unsubscribe = _stub
export const tracing = _stub
export const monitor = _stub
export const performance = _stub
export const PerformanceObserver = _stub
export const PerformanceEntry = _stub
export const createServer = _stub
export const request = _stub
export const Server = _stub
export const IncomingMessage = _stub
export const OutgoingMessage = _stub
export const ServerResponse = _stub
export const AddressInfo = _stub
export const IncomingHttpHeaders = _stub
export const connect = _stub
export const createConnection = _stub
export const isIPv4 = _stub
export const isIPv6 = _stub
export const Socket = _stub
export const Agent = _stub
export const Stats = _stub
export const BigIntStats = _stub
export const Dirent = _stub
export const FileHandle = _stub
export const appendFile = _stub
export const appendFileSync = _stub
export const chmod = _stub
export const chmodSync = _stub
export const chown = _stub
export const chownSync = _stub
export const closeSync = _stub
export const copyFile = _stub
export const cp = _stub
export const cpSync = _stub
export const fchmod = _stub
export const fchmodSync = _stub
export const fchown = _stub
export const fchownSync = _stub
export const fdatasync = _stub
export const fdatasyncSync = _stub
export const fstat = _stub
export const fstatSync = _stub
export const fsync = _stub
export const fsyncSync = _stub
export const ftruncate = _stub
export const ftruncateSync = _stub
export const futimes = _stub
export const futimesSync = _stub
export const link = _stub
export const linkSync = _stub
export const lstat = _stub
export const mkdtemp = _stub
export const mkdtempSync = _stub
export const open = _stub
export const openSync = _stub
export const opendir = _stub
export const opendirSync = _stub
export const readSync = _stub
export const realpath = _stub
export const rename = _stub
export const rm = _stub
export const rmSync = _stub
export const truncate = _stub
export const truncateSync = _stub
export const unlink = _stub
export const unwatchFile = _stub
export const utimes = _stub
export const watchFile = _stub
export const writeSync = _stub
export const win = _stub
export const toNamespacedPath = _stub
export const once = _stub
export const captureRejections = _stub
export const defaultMaxListeners = _stub
export const getEventListeners = _stub
export const listenerCount = _stub
export const on = _stub
export const prependListener = _stub
export const prependOnceListener = _stub
export const rawListeners = _stub
export const removeAllListeners = _stub
export const removeListener = _stub
export const setMaxListeners = _stub
export const emit = _stub
export const eventNames = _stub
export const getMaxListeners = _stub
export const off = _stub
export const abort = _stub
export const addListener = _stub
export const resume = _stub
export const pause = _stub
export const createContext = _stub
export const runInContext = _stub
export const runInNewContext = _stub
export const runInThisContext = _stub
export const compileFunction = _stub
export const measureMemory = _stub
export const Script = _stub
export const SourceTextModule = _stub
export const SyntheticModule = _stub
export const MemoryMeasurement = _stub
export const Console = _stub
export const debuglog = _stub
export const inherits = _stub
export const log = _stub
export const styleText = _stub
export const systemPreferences = _stub
export const transferableAbortSignal = _stub
export const transferableAbortController = _stub
export const aborted = _stub
export const MessagePort = _stub
export const MessageChannel = _stub
export const BroadcastChannel = _stub
export const Worker = _stub
export const parentPort = _stub
export const share = _stub
export const markAsUntransferable = _stub
export const moveMessagePortToContext = _stub
export const receiveMessageOnPort = _stub
export const getEnvironmentData = _stub
export const setEnvironmentData = _stub
export const isMainThread = _stub
export const threadId = _stub
export const resourceLimits = _stub
export const createXHR = _stub
export const DatabaseSync = _stub
export const StatementSync = _stub
export const allowSetAugmentedPublicKey = _stub
export const certificate = _stub
export const Cipher = _stub
export const Cipheriv = _stub
export const Decipher = _stub
export const Decipheriv = _stub
export const DiffieHellman = _stub
export const DiffieHellmanGroup = _stub
export const ECDH = _stub
export const ECIES = _stub
export const Hash = _stub
export const Hmac = _stub
export const KeyObject = _stub
export const Sign = _stub
export const Verify = _stub
export const X509Certificate = _stub
export const checkPrime = _stub
export const checkPrimeSync = _stub
export const constants2 = _stub
export const diffieHellman = _stub
export const generateKey = _stub
export const generateKeyPair = _stub
export const generateKeyPairSync = _stub
export const generateKeySync = _stub
export const getCipherInfo = _stub
export const getCiphers = _stub
export const getCurves = _stub
export const getDiffieHellman = _stub
export const getHashes = _stub
export const hkdf = _stub
export const hkdfSync = _stub
export const pbkdf2 = _stub
export const pbkdf2Sync = _stub
export const privateDecrypt = _stub
export const privateEncrypt = _stub
export const prng = _stub
export const pseudoRandomBytes = _stub
export const publicDecrypt = _stub
export const publicEncrypt = _stub
export const randomFill = _stub
export const randomFillSync = _stub
export const randomInt = _stub
export const randomUUID2 = _stub
export const rsa = _stub
export const rsaPrivateKey = _stub
export const rsaPublicKey = _stub
export const secureHeapUsed = _stub
export const setEngine = _stub
export const sign = _stub
export const subtle = _stub
export const verify = _stub
export const webcrypto = _stub
export const createDeflate = _stub
export const createDeflateRaw = _stub
export const createGunzip = _stub
export const createGzip = _stub
export const createInflate = _stub
export const createInflateRaw = _stub
export const createUnzip = _stub
export const createBrotliCompress = _stub
export const createBrotliDecompress = _stub
export const brotliCompress = _stub
export const brotliCompressSync = _stub
export const brotliDecompress = _stub
export const brotliDecompressSync = _stub
export const deflate = _stub
export const deflateRaw = _stub
export const deflateRawSync = _stub
export const deflateSync = _stub
export const gunzip = _stub
export const gzip = _stub
export const gzipSync = _stub
export const inflate = _stub
export const inflateRaw = _stub
export const inflateRawSync = _stub
export const inflateSync = _stub
export const unzip = _stub
export const unzipSync = _stub
export const zlib = _stub
export const zstdCompress = _stub
export const zstdCompressSync = _stub
export const zstdDecompress = _stub
export const createZstdCompress = _stub
export const constants3 = _stub
// util/types — undici's body.js / fetch/util.js destructure these at
// evaluation time. They are NOT throw-stubs: undici treats the boolean
// as runtime control flow (e.g. `if (isPromise(x)) gate()`), so a
// throw would surface as a real bug instead of a wrong gate. Same
// semantics the previous util-types-stub.ts provided — moved here in
// follow-up #11 so the single node-shims.ts file owns every `node:*`
// destination.
export function isUint8Array(value: unknown): boolean {
  // WebView2 always exposes the global Uint8Array; a direct instanceof
  // check works across realms. Bare typed-array detection is enough —
  // Node's `isUint8Array` is the same predicate for the purposes
  // undici / fetch utilities need it for.
  return value instanceof Uint8Array
}

export function isArrayBuffer(value: unknown): boolean {
  return value instanceof ArrayBuffer
}

const TYPED_ARRAY_CTOR_NAMES: ReadonlySet<string> = new Set([
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
])

export function isArrayBufferView(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const ctor = (value as { constructor?: { name?: string } }).constructor
  if (ctor === undefined || ctor.name === undefined) return false
  return TYPED_ARRAY_CTOR_NAMES.has(ctor.name) || value instanceof DataView
}

export function isPromise(value: unknown): boolean {
  // `value` is a Promise when it has a `.then` callable. We deliberately
  // don't `instanceof Promise` — cross-realm Promises (e.g. ones produced
  // by the React Query internals or by Vite's worker bridge) wouldn't
  // satisfy an instanceof check, and undici's only caller uses this to
  // gate promise-aware flow control, not for type discrimination.
  if (value === null || typeof value !== 'object' && typeof value !== 'function') return false
  return typeof (value as { then?: unknown }).then === 'function'
}

export function isProxy(value: unknown): boolean {
  // Reliable proxy detection requires a brand check that the browser
  // deliberately hides (the engine spec lists it as a hostile-API).
  // Return false unconditionally — undici's only call site
  // (`!util.types.isProxy(V) && iterator === Headers.prototype.entries`)
  // treats false as "not a proxy", which is the correct default for any
  // object the engine gives us.
  void value
  return false
}

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
