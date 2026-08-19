/**
 * Out-of-process ACP subagent backend. Each child has its own process, session, model, and
 * tools, so it shares no Cordis context and advertises no parent-enforced start capabilities;
 * the ONE thing it reads off `request.parent` is the session's workspace cwd (see
 * {@link resolveCwd}). This plugin uses named exports only; a default would hide its
 * loader metadata (see `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 *
 * Phase 2 Task 2.7.2 made the package browser-safe: the cwd-validation logic that
 * previously imported `node:fs` and `node:path` is replaced by a Tauri-mediated
 * call (`bridge.cwdApi.resolve` → `commands::fs::cwd_resolve`). The plugin
 * applies a synchronous shape-only check at load (empty + non-string), and
 * delegates the directory existence / search-bit probe to the host — the
 * renderer never touches a filesystem.
 *
 * @module @deepseek-ai/dsh-subagent-acp
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { cwdApi } from './bridge.ts'
import { type AcpRunSpec, DEFAULT_DISPOSE_EOF_GRACE_MS, DEFAULT_DISPOSE_GRACE_MS, type PermissionPolicy, startAcpRun } from './run.ts'

export const name = 'subagent-acp'
export const inject = ['subagents', 'subprocess']

/** Config: how to spawn and drive the child ACP agent process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `acp`). */
  providerName: string
  /** The executable to spawn for each run (the child ACP agent). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * Working directory override for the child process and its ACP session.
   * Must be non-empty; a relative path is resolved against the host's launch
   * directory at first start, and the result must be an existing directory.
   * When omitted, each child inherits its delegating parent session's cwd —
   * and starting one from a parent session that has no cwd fails.
   */
  cwd?: string
  /**
   * How to auto-answer the child's `session/request_permission` prompts:
   * `reject` (default — decline every prompt) or `allow` (approve via the first
   * `allow_once` or `allow_always` option). No prompt is surfaced to a human.
   */
  permission: PermissionPolicy
  /**
   * Extra environment variables for the child process — e.g. the child
   * harness's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed
   * copy of the parent env, so an explicit key here reaches the child while
   * ambient secrets do not leak implicitly.
   */
  env: Record<string, string>
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal. Must not exceed
   * `MAX_TIMER_DELAY_MS`.
   */
  disposeEofGraceMs?: number
  /** Termination-escalation grace (ms); must not exceed `MAX_TIMER_DELAY_MS`. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('acp'),
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
  permission: z.union(['allow', 'reject'] as const).default('reject'),
  env: z.dict(z.string()).default({}),
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** A dispose grace must fit the single Node timer that owns its teardown tier. */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`subagent-acp: ${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** The shape after schemastery applied the defaults (cwd has none). */
type ResolvedConfig = Required<Omit<Config, 'cwd'>> & Pick<Config, 'cwd'>

/**
 * Whether `path` is absolute on POSIX or Windows. Browser-safe replacement
 * for `node:path::isAbsolute` (avoids the Node import for a pure string check
 * that the package needs to enforce at apply() time and again on the parent
 * session cwd).
 *
 * - POSIX: leading `/`.
 * - Windows: `<drive>:\...`, `<drive>:/...`, or UNC `\\server\share\...`.
 */
function isAbsolutePath(path: string): boolean {
  if (path.length === 0) return false
  if (path.charCodeAt(0) === 47 /* '/' */) return true
  // `<drive>:<sep>` — a drive letter followed by `:` and a separator.
  if (path.length >= 3) {
    const drive = path.charCodeAt(0)
    const colon = path.charCodeAt(1)
    const sep = path.charCodeAt(2)
    if (((drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122)) && colon === 58 && (sep === 47 || sep === 92)) return true
  }
  // UNC: leading `\\` or `//`.
  if (path.length >= 2) {
    const a = path.charCodeAt(0)
    const b = path.charCodeAt(1)
    if ((a === 92 || a === 47) && (b === 92 || b === 47)) return true
  }
  return false
}

/**
 * Resolve `path` against the host's launch directory (when relative) and
 * validate that the result names an existing, searchable directory. Throws
 * with the host's diagnostic verbatim so a misconfigured cwd surfaces the
 * same shape of error it did under the old `node:fs` check.
 *
 * @param label - which source supplied the value, for the diagnostic prefix.
 * @param path - the candidate path; may be relative (resolved against the
 *   host launch directory) or absolute.
 */
async function assertUsableCwd(label: string, path: string): Promise<string> {
  try {
    return await cwdApi.resolve(path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`subagent-acp: ${label} is not an accessible directory: ${message}`)
  }
}

/**
 * Resolve the child's working directory: the deployment `cwd` override when
 * configured, else the parent session's workspace cwd. The configured value
 * accepts a relative path (resolved against the host's launch directory at
 * first start — the same behaviour the package previously implemented with
 * `node:path::resolve`); the parent session's cwd MUST be absolute, because
 * `SessionHeader.cwd` is documented as absolute and a relative value there
 * is a broken header that resolving against a launch directory would
 * silently paper over. Fails loud when neither source exists.
 */
async function resolveCwd(configured: string | undefined, request: SubagentStartRequest): Promise<string> {
  if (configured !== undefined) return assertUsableCwd('config cwd', configured)
  const parentCwd = request.parent.session.header.cwd
  if (parentCwd === undefined) {
    throw new Error('subagent-acp: no working directory for the child — configure `cwd` or delegate from a parent session that has one')
  }
  if (!isAbsolutePath(parentCwd)) {
    throw new Error(`subagent-acp: parent session cwd must be an absolute path: ${parentCwd}`)
  }
  return assertUsableCwd('parent session cwd', parentCwd)
}

/**
 * The ACP provider. Advertises NO start-time capabilities: an out-of-process
 * child cannot honor `outputSchema`/`maxDepth`/`toolFilter` (the service rejects
 * a request needing any of them before `start` runs).
 */
class AcpProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: false, depthLimit: false, toolFilter: false, persona: false }
  // Context contract: an out-of-process ACP child starts fresh — no parent conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const cwd = await resolveCwd(this.config.cwd, request)
    const spec: AcpRunSpec = {
      command: this.config.command,
      args: this.config.args,
      cwd,
      permission: this.config.permission,
      env: this.config.env,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`subagent-acp "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startAcpRun(request, spec)
  }
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveFinite('disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('disposeGraceMs', resolved.disposeGraceMs)
  // The empty-string guard stays synchronous and browser-safe: an empty cwd
  // would silently re-introduce the launch-directory fallback the cwd
  // resolution removes (`cwdApi.resolve('')` would still bind to the host
  // launch dir, which is never the intended workspace).
  if (resolved.cwd === '') {
    throw new Error('subagent-acp: config cwd must not be empty — omit the key to inherit the parent session cwd')
  }
  // The cwd validation that used to live in `node:fs`/`node:path` now runs
  // lazily through `resolveCwd` (which `AcpProvider.start` awaits before
  // handing the spec to the subprocess seam). `apply()` stays synchronous —
  // cordis plugin entry points are not awaited — and keeps only the
  // empty-string guard above. A misconfigured cwd therefore fails loud on
  // the first `start()` call instead of at load; the error still names the
  // source (`config cwd` vs. `parent session cwd`) and still preserves the
  // host's filesystem diagnostic verbatim.
  ctx.subagents.registerProvider(new AcpProvider(resolved.providerName, ctx, resolved))
}
