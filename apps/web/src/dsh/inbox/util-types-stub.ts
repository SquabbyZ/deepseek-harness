// Browser-side stub for `node:util/types`. `vite-plugin-node-polyfills`
// aliases `node:util` to the npm `util` package (which exposes its
// `types` namespace as an object property, `util.types.isProxy` etc.),
// but the `node:util/types` SUBPATH that several in-box deps import
// (`const { isUint8Array } = require('node:util/types')`) doesn't have
// a direct polyfill mapping — node-stdlib-browser ships no `types`
// subpath, and the npm `util` package itself only exports `util.types`
// as a property, never as a subpath file. Without this stub the
// commonjs resolver fails at build time with
// `Could not load .../util/types: ENOENT`.
//
// Surface kept minimal: only the symbols actually destructured by the
// transitive graph (currently undici's body.js / fetch/util.js /
// websocket.js — isUint8Array + isArrayBuffer; the headers.js path
// goes through `util.types.isProxy` from `node:util`, which already
// resolves through the plugin). Anything else returns false; nothing
// here throws so misclassified callers surface as a wrong boolean,
// matching the plugin's "import resolves, runtime errors are visible"
// contract from the previous shim.

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
