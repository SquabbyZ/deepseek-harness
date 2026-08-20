/**
 * Shared filesystem path helpers for DeepSeek Harness user data.
 *
 * Browser-safe: every helper that needs a "home" directory takes it as an
 * explicit parameter, and every path operation is implemented inline so the
 * module never reaches for `node:os` / `node:path` / `node:fs` /
 * `process.env` at module-load time. Node-side callers pass
 * `os.homedir()` and run in the Node runtime where the result string still
 * round-trips through the OS; WebView2 callers pass
 * `appApi.configDir()` (Tauri `app.path().app_config_dir()` per spec §7.1).
 *
 * Path segments are joined with `/` — Rust side normalizes on receive, and
 * Tauri PathBuf accepts both separators on Windows. This keeps the bundle
 * free of any Node built-in.
 *
 * @module @deepseek-ai/dsh-home-paths
 */

/** Directory name for the default DeepSeek Harness home under the OS home. */
export const DSH_HOME_DIR_NAME = '.dsh'

/** Stable user-facing display form for the default DeepSeek Harness home. */
export const DEFAULT_DSH_HOME_DISPLAY = `~/${DSH_HOME_DIR_NAME}`

/** Environment variable that overrides the default DeepSeek Harness home. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Browser-safe path separator. Tauri Rust side normalizes on receive. */
const SEP = '/'

/**
 * Join path segments with `/`, dropping empty parts and normalizing
 * redundant separators. Equivalent to `node:path.join` for forward-slash
 * inputs — DSH home is single-root and the platform-specific separator is
 * restored by the Tauri command consumer.
 */
export function join(...segments: string[]): string {
  const parts: string[] = []
  for (const seg of segments) {
    if (seg.length === 0) continue
    for (const piece of seg.split(SEP)) {
      if (piece.length === 0 || piece === '.') continue
      parts.push(piece)
    }
  }
  return parts.length === 0 ? '.' : parts.join(SEP)
}

/**
 * Resolve a sequence of paths to an absolute form. Browser-safe: returns
 * either `/`-prefixed (when input was absolute) or a normalized relative
 * path. Tauri side re-anchors against the actual config dir.
 */
export function resolve(...segments: string[]): string {
  let absolute = false
  const parts: string[] = []
  for (const seg of segments) {
    if (seg.length === 0) continue
    if (seg.startsWith(SEP)) absolute = true
    for (const piece of seg.split(SEP)) {
      if (piece.length === 0 || piece === '.') continue
      if (piece === '..') parts.pop()
      else parts.push(piece)
    }
  }
  const body = parts.join(SEP)
  return absolute ? SEP + body : (body.length === 0 ? '.' : body)
}

/** Final path segment. Equivalent to `node:path.basename`. */
export function basename(path: string): string {
  if (path.length === 0) return ''
  const trimmed = path.endsWith(SEP) ? path.slice(0, -1) : path
  const idx = trimmed.lastIndexOf(SEP)
  return idx < 0 ? trimmed : trimmed.slice(idx + 1)
}

/** Directory portion. Equivalent to `node:path.dirname`. */
export function dirname(path: string): string {
  if (path.length === 0) return '.'
  const trimmed = path.endsWith(SEP) ? path.slice(0, -1) : path
  const idx = trimmed.lastIndexOf(SEP)
  if (idx < 0) return '.'
  if (idx === 0) return SEP
  return trimmed.slice(0, idx)
}

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through `realpath`; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored.
 *
 * **Node-only**: uses `node:fs/promises` via dynamic import.
 * @param path - Watch target or root.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  const { opendir, realpath } = await import('node:fs/promises')
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Compose the default DeepSeek Harness home from the supplied OS home.
 * @param homedir - absolute OS home directory.
 */
export function defaultDshHome(homedir: string): string {
  return join(homedir, DSH_HOME_DIR_NAME)
}

/**
 * Expand supported tilde prefixes against the supplied OS home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @param homedir - absolute OS home directory the tilde expands to.
 */
export function expandHomePath(path: string, homedir: string): string {
  if (path === '~') return homedir
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir, path.slice(2))
  return path
}

/**
 * Resolve the single-root DeepSeek Harness home.
 *
 * Precedence: explicit configured, `$DSH_HOME`, then `<homedir>/.dsh`.
 * @param homedir - absolute OS home directory (Node: `os.homedir()`;
 * browser: `appApi.configDir()`).
 * @param configured - explicit harness-home override.
 * @param env - environment mapping used to read `DSH_HOME`.
 */
export function resolveDshHome(
  homedir: string,
  configured?: string,
  env: Record<string, string | undefined> = {},
): string {
  const fromEnv = env[DSH_HOME_ENV]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome(homedir))
  return resolve(expandHomePath(selected, homedir))
}

/**
 * Join path segments onto the resolved DeepSeek Harness home.
 */
export function dshHomePath(
  homedir: string,
  env: Record<string, string | undefined>,
  configured: string | undefined,
  ...segments: string[]
): string {
  return join(resolveDshHome(homedir, configured, env), ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 */
export function dshHomeDisplay(resolvedHome: string, homedir: string): string {
  return resolvedHome === resolve(defaultDshHome(homedir)) ? DEFAULT_DSH_HOME_DISPLAY : `$${DSH_HOME_ENV}`
}
