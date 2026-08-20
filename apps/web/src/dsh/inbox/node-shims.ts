// Browser-safe shims for Node built-ins that some in-box plugins accidentally
// import at top-level. Phase 1 + Phase 2's `vite.config.ts` aliases these
// modules to this file. We provide just enough of the API surface that the
// 136 browser-safe plugins touch at module-evaluation time; if a plugin needs
// more, that plugin is misclassified (should be in the "needs-port" set, not
// the in-box set).
const isWindows = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

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
