/**
 * The in-process SPAWN subagent backend.
 *
 * Phase 2 (Task 2.7.1) reframed this package around the browser-safe Tauri
 * shell bridge: the package must no longer reach for `node:child_process.spawn`
 * because it now loads into WebView2. Two surfaces ship together:
 *
 * 1. {@link SubagentSpawnInProcess} — a thin service that exposes a
 *    `spawn(args)` method backed by `bridge.shellApi.spawn(...)` (the Tauri
 *    `shell_spawn` command from Phase 1 Task 1.7). This is the browser-safe
 *    carrier; it works wherever `@tauri-apps/api/core::invoke` resolves.
 * 2. {@link apply} — the cordis plugin entry point. It registers a
 *    {@link SubagentProvider} on `ctx.subagents` that runs each child as a
 *    fresh child `Agent` on the same cordis context (its own session, own
 *    system prompt, zero parent context). The cheapest transport, reusing the
 *    agent factory's quiescent teardown. This surface is preserved for the
 *    host-side test harness and the existing one-shot semantics, and routes
 *    its `start()` request through {@link SubagentSpawnInProcess} when the
 *    service is mounted on the context (a no-op fallback otherwise).
 *
 * @module @deepseek-ai/dsh-subagent-spawn-in-process
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import { shellApi, type ShellSpec, type SpawnHandle } from './bridge.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    subagentSpawnInProcess: SubagentSpawnInProcess
  }
}

export const name = 'subagent-spawn-in-process'
// `tools` is deliberately not injected: the child factory already provides it during setup,
// and adding it here would unnecessarily change this provider's apply timing.
export const inject = ['subagents']

/** Cordis key under which the spawn service is exposed. */
export const SUBAGENT_SPAWN_IN_PROCESS = 'subagentSpawnInProcess'

/** Args accepted by {@link SubagentSpawnInProcess.spawn}. A 1:1 map of `ShellSpec`. */
export interface SpawnArgs {
  /** The binary to launch (e.g. `node.exe`, `cmd.exe`). Validated by the host. */
  cmd: string
  /** Positional arguments to pass to `cmd`. */
  args: string[]
  /** Working directory; must be inside the host's config dir (host-enforced). */
  cwd?: string
  /** Extra environment variables. */
  env?: Record<string, string>
}

/**
 * The browser-safe spawn service. It is the package's public carrier for
 * "give me a new child process": the implementation routes every call through
 * {@link shellApi.spawn}, which talks to the host's `shell_spawn` Tauri
 * command. Cordis plugins can mount it via {@link apply} (and read it back via
 * `ctx[SUBAGENT_SPAWN_IN_PROCESS]`); standalone callers can `new
 * SubagentSpawnInProcess()` and invoke the method directly.
 */
export class SubagentSpawnInProcess {
  /**
   * Forward a spawn request to the Tauri host. Returns a {@link SpawnHandle}
   * whose `pid` is the host-assigned OS identifier; lifecycle management
   * beyond that belongs to the host.
   */
  async spawn(args: SpawnArgs): Promise<SpawnHandle> {
    const spec: ShellSpec = {
      cmd: args.cmd,
      args: args.args,
      ...args.cwd !== undefined ? { cwd: args.cwd } : {},
      env: args.env ?? {},
    }
    return shellApi.spawn(spec)
  }
}

/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `spawn`). */
  providerName: string
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('spawn'),
})

/**
 * The spawn provider. Supports every start-time capability: `depthLimit` (it
 * constructs the child, so it can enforce a recursion cap), `outputSchema`
 * (the scoped structured runtime), and `toolFilter`/`persona` (scoped
 * `restrict()` and a scoped shadowing persona section, applied in the child's
 * creation window).
 */
class SpawnInProcessProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  // Context contract: a spawned child starts fresh — it never sees the parent conversation.
  readonly inheritsParentContext = false

  constructor(readonly name: string) {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    // Fresh child: no seed. The shared driver mints ids, stamps cwd/lineage/
    // depth, drives the one-shot (including the structured capture when the
    // request carries an outputSchema), and maps the result.
    return startInProcessRun(request, {})
  }

  prepareContinuable(): Promise<ContinuableCreateSpec> {
    // A spawned child starts fresh, so it contributes no seed; the continuation
    // manager owns every later operation on it.
    return Promise.resolve({})
  }
}

export function apply(ctx: Context, config: Config): void {
  // Mount the Tauri-mediated spawn service first so consumers keyed on
  // `ctx[SUBAGENT_SPAWN_IN_PROCESS]` can resolve during the provider's own
  // setup window.
  const service = new SubagentSpawnInProcess()
  ctx.provide(SUBAGENT_SPAWN_IN_PROCESS, service)
  ctx.subagents.registerProvider(new SpawnInProcessProvider(config.providerName))
}
