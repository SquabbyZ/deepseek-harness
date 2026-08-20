/**
 * Projection from the shared managed-process handle to the official Claude
 * Agent SDK's custom-spawn process interface.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/process
 */

import type {
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

const WINDOWS_BATCH_EXECUTABLE_ENV = 'DSH_CLAUDE_CODE_EXECUTABLE'

/**
 * Minimal event emitter used to project the shared managed-process lifecycle
 * to the official SDK. Replaces `node:events::EventEmitter` so this package
 * loads into WebView2 without a Node runtime.
 */
class LifecycleEmitter {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void): void {
    let set = this.listeners.get(event)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
  }

  once(event: string, listener: (...args: unknown[]) => void): void {
    const wrap = (...args: unknown[]): void => {
      this.off(event, wrap)
      listener(...args)
    }
    this.on(event, wrap)
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event)
    if (set === undefined) return
    for (const listener of [...set]) listener(...args)
  }
}

/**
 * Extract the lowercase file extension from a path string. Mirrors the
 * behaviour of `node:path::extname` without pulling in the Node module —
 * strips any directory prefix before scanning for the final dot.
 */
function pathExtname(command: string): string {
  const lastSep = Math.max(command.lastIndexOf('/'), command.lastIndexOf('\\'))
  const lastDot = command.lastIndexOf('.')
  if (lastDot < 0 || lastDot <= lastSep) return ''
  return command.slice(lastDot).toLowerCase()
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- the subprocess seam rejects with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Encode the SDK's complete child environment as a subprocess overlay.
 * @param env - SDK-composed child environment after its removals and replacements.
 * @returns explicit values plus tombstones for surviving ambient names the SDK removed.
 */
export function sdkEnvironmentOverlay(
  env: SpawnOptions['env'],
): Record<string, string | undefined> {
  const overlay: Record<string, string | undefined> = { ...env }
  for (const name of Object.keys(scrubbedParentEnv())) {
    if (!(name in env)) overlay[name] = undefined
  }
  return overlay
}

/**
 * Translate one official SDK spawn request to the shared process owner.
 * @param options - command, arguments, workspace, environment, and forwarded signal from the SDK.
 * @param graceMs - process-tree termination grace.
 * @param platform - host platform selecting the Windows batch-shim boundary.
 * @returns the fully explicit shared subprocess request.
 * @remarks The batch-shim path quotes only the resolved executable. The pinned SDK
 * supplies fixed flag arguments without cmd metacharacters; cmd reparses that tail.
 */
export function claudeSpawnSpec(
  options: SpawnOptions,
  graceMs: number,
  platform: string,
): SubprocessSpawnSpec {
  if (options.cwd === undefined || options.cwd.length === 0) {
    throw new Error('subagent-claude-code: SDK spawn request omitted its workspace')
  }
  const extension = pathExtname(options.command)
  const batchShim = platform === 'win32' && (extension === '.cmd' || extension === '.bat')
  const env = sdkEnvironmentOverlay(options.env)
  const argv = batchShim
    ? ['cmd.exe', '/d', '/v:off', '/s', '/c', `%${WINDOWS_BATCH_EXECUTABLE_ENV}%`, ...options.args]
    : [options.command, ...options.args]
  if (batchShim) env[WINDOWS_BATCH_EXECUTABLE_ENV] = `"${options.command}"`
  return {
    argv,
    cwd: options.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs,
    signal: options.signal,
    env,
  }
}

/**
 * SDK-facing view of one shared managed process. Protocol transport remains
 * in the official SDK; this adapter only projects streams and exit events.
 */
export class ManagedClaudeCodeProcess implements SpawnedProcess {
  readonly stdin
  readonly stdout
  private readonly events = new LifecycleEmitter()
  private exitCodeValue: number | null = null
  private signalCodeValue: NodeJS.Signals | null = null
  private killRequested = false

  /**
   * Project a managed process with piped stdin and stdout.
   * @param child - shared handle that remains the process-tree authority.
   */
  constructor(private readonly child: SubprocessHandle) {
    this.stdin = child.stdin as NonNullable<SubprocessHandle['stdin']>
    this.stdout = child.stdout as NonNullable<SubprocessHandle['stdout']>
    // Node's EventEmitter throws on an unlistened `error` event. The SDK
    // attaches its listener synchronously after custom spawn returns, but
    // an already-rejected spawn handle could resolve before that attach,
    // so the no-op listener keeps the race from blowing up.
    this.events.on('error', () => {})
    void child.done.then(
      (outcome) => {
        this.exitCodeValue = outcome.exitCode
        this.signalCodeValue = outcome.signal
        this.events.emit('exit', outcome.exitCode, outcome.signal)
      },
      (error: unknown) => {
        this.events.emit('error', thrown(error))
      },
    )
  }

  /** Whether the SDK has requested managed tree termination. */
  get killed(): boolean {
    return this.killRequested
  }

  /** Direct-child exit code, or null while running or after signal exit. */
  get exitCode(): number | null {
    return this.exitCodeValue
  }

  /** Direct-child terminating signal, if any. */
  get signalCode(): NodeJS.Signals | null {
    return this.signalCodeValue
  }

  /**
   * Route the SDK's termination request to the tree-scoped process owner.
   * @param _signal - SDK-selected signal; the shared seam owns its escalation ladder.
   * @returns false only after exit or a previous termination request.
   */
  kill(_signal: NodeJS.Signals): boolean {
    if (
      this.killRequested
      || this.exitCodeValue !== null
      || this.signalCodeValue !== null
    ) {
      return false
    }
    this.killRequested = true
    this.child.terminate()
    return true
  }

  /** Register a persistent process lifecycle listener. */
  on(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ): void {
    this.events.on(event, listener as (...args: unknown[]) => void)
  }

  /** Register a one-shot process lifecycle listener. */
  once(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ): void {
    this.events.once(event, listener as (...args: unknown[]) => void)
  }

  /** Remove a process lifecycle listener. */
  off(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ): void {
    this.events.off(event, listener as (...args: unknown[]) => void)
  }
}
