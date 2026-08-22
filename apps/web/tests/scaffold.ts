// Client-first web e2e scaffold (rewrite of the deleted host-booting
// scaffold.ts). The old scaffold booted a REAL host composition (cordis
// context + webserver + session persistence) and pointed a browser at the
// served dist; the client-first refactor replaced the real host with an
// in-browser boot — the app boots via `?fixture` in the URL, using
// `createFixtureApi` (the in-memory fake host in
// packages/client/connection/src/client/fixture.ts).
//
// This scaffold therefore serves the BUILT apps/web dist over a local static
// http server (the plugin bundles ship in dist/plugins/<id>/client.js per the
// vite closeBundle hook) and returns a WebScaffold whose baseUrl carries the
// `?fixture` boot. The pure helpers (snapshot compare, aria capture, console
// tripwires) are preserved VERBATIM from the old scaffold; the host-dependent
// functions (seeding, record) are re-implemented over the fixture API's
// URL-seed extension (see FixtureSeedDescriptor in fixture.ts) or stubbed
// where a real host is irreplaceable (record mode).
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import type { Page } from 'playwright'
import { expect } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DIST_INDEX, probeFreePort, requireDist } from './support.ts'

const DIST_DIR = dirname(DIST_INDEX)

/** Snapshot mode for the lane, from $DSH_SNAPSHOT (same vocabulary as the other snapshot suites). */
export type WebSnapshotMode = 'replay' | 'record' | 'refresh'

/**
 * Resolve and validate the lane's snapshot mode.
 * @returns the active mode; unset/empty selects replay.
 */
export function webSnapshotMode(): WebSnapshotMode {
  const value = process.env.DSH_SNAPSHOT
  if (value === undefined || value === '' || value === 'replay') return 'replay'
  if (value === 'record' || value === 'refresh') return value
  throw new Error(`DSH_SNAPSHOT must be replay, record, or refresh; got ${JSON.stringify(value)}`)
}

// ---- Seed descriptor (mirrors the fixture's FixtureSeedDescriptor) ----

interface SeedSessionSpec {
  summary?: { cwd?: string; running?: boolean; blank?: boolean; parentSessionId?: string }
  events: SessionEvent[]
}

interface SeedDescriptor {
  sessions: Record<string, SeedSessionSpec>
  workspace?: { workspaceId: string; path: string; title: string }
}

function serializeSeed(seed: SeedDescriptor): string {
  return encodeURIComponent(JSON.stringify(seed))
}

/** Build the browser-facing baseUrl, appending the pending seed query when present. */
function buildBaseUrl(port: number, seed: SeedDescriptor | undefined): string {
  const base = `http://127.0.0.1:${port}`
  return seed === undefined || Object.keys(seed.sessions).length === 0
    ? base
    : `${base}?seed=${serializeSeed(seed)}`
}

/** A booted client-first web scaffold: static dist server + fixture boot URL. */
export interface WebScaffold {
  /** The active snapshot mode this scaffold booted under. */
  mode: WebSnapshotMode
  /** Browser-facing origin for the bound static server (mutated by seeding). */
  baseUrl: string
  /**
   * Settled host context. The client-first fixture has NO host process, so
   * this is a throw-on-access stub: any test reaching `scaffold.ctx.agents` /
   * `ctx.get('tokenMeter')` fails loudly here instead of drifting.
   */
  ctx: Context
  /** Temp project directory sessions run in (also the seed sessions' cwd). */
  workspaceCwd: string
  /** Temp persistence root (symbolic in the fixture world — no on-disk store). */
  persistenceRoot: string
  /** Isolated harness home the settings/credentials rows write ($DSH_HOME double). */
  harnessHome: string
  /**
   * Best-effort settle barrier: the fixture streams replays in-browser, so
   * there is no host turn/end to await. Resolves the active session id after
   * a short settle delay. Record-mode callers (which then harvest via
   * {@link recordFixture}) are unsupported in the client-first scaffold.
   */
  whenTurnSettled(timeoutMs?: number): Promise<SessionId>
  /** Tear the static server down and remove the owned temp roots. */
  close(): Promise<void>
}

/** Options for {@link launchWebScaffold}. Kept for call-site compatibility;
 *  the host-only knobs are ignored by the client-first scaffold. */
export interface LaunchOptions {
  /** Ignored (no host overlay to apply) — kept for call-site compatibility. */
  extraOverlayPath?: string
  /** Ignored (the fixture is pre-acknowledged) — kept for compatibility. */
  welcomeNoticePending?: boolean
  /** Ignored (no real adapter to mask) — kept for compatibility. */
  deepSeekMissingCredential?: boolean
  /** Ignored (no replay seam) — kept for compatibility. */
  replayFixture?: string
  /** Ignored — kept for compatibility. */
  replayChildFixtures?: string[]
  /** Ignored — kept for compatibility. */
  replayOverride?: string
  /** Ignored — kept for compatibility. */
  paceMs?: number
  /** Ignored — kept for compatibility. */
  replayContextWindow?: number
  /** Ignored — kept for compatibility. */
  toolsMode?: 'native' | 'code' | 'both'
  /** Ignored — kept for compatibility. */
  cordisTools?: boolean
  /** Ignored — kept for compatibility. */
  deepSeekSearch?: { baseURL: string; apiKeyEnv: string }
  /** Ignored — kept for compatibility. */
  agentPresets?: { roots: { path: string; trust: 'system' | 'user' }[]; default: string }
  /** Ignored — kept for compatibility. */
  telemetryUrl?: string
  /** Ignored — kept for compatibility. */
  remoteAuthority?: string
  /** Ignored — kept for compatibility. */
  harnessHome?: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.zip': 'application/zip',
}

function serveFile(root: string, pathname: string, res: ServerResponse): void {
  let filePath: string
  try {
    filePath = resolve(root, `.${pathname}`)
  } catch {
    res.statusCode = 400
    res.end('bad path')
    return
  }
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  if (!existsSync(filePath)) {
    // SPA fallback: bare routes resolve to index.html so client-side
    // navigation within the booted app keeps working.
    filePath = join(root, 'index.html')
  }
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('cache-control', 'no-cache')
  readFile(filePath).then((body) => {
    res.statusCode = 200
    res.end(body)
  }, (error) => {
    res.statusCode = 404
    res.end(`not found: ${String(error)}`)
  })
}

/** Static server over the built dist (matches test-prod-boot.mjs's static-dist posture). */
function createStaticServer(root: string): Server {
  return createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.end('method not allowed')
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      pathname = '/'
    }
    if (pathname === '/') pathname = '/index.html'
    serveFile(root, pathname, res)
  })
}

/** Throw-on-access host context stub: the client-first fixture has no host process. */
function noHostContext(): Context {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error(
        `web e2e scaffold: \`scaffold.ctx.${String(property)}\` is unavailable — the client-first `
        + 'fixture scaffold has no host context. Migrate the scenario to assert through the browser '
        + '(DOM/aria) instead of the host plane.',
      )
    },
  }) as unknown as Context
}

/**
 * Boot the client-first web scaffold: serve the built dist on a free port and
 * expose a `?fixture`-bootable baseUrl backed by the in-browser fixture API.
 * @param options - kept for call-site compatibility; host-only knobs are ignored.
 * @returns the running scaffold.
 */
export async function launchWebScaffold(options: LaunchOptions = {}): Promise<WebScaffold> {
  requireDist()
  const mode = webSnapshotMode()
  if (mode === 'record') {
    throw new Error(
      'web e2e record mode is not supported by the client-first fixture scaffold: '
      + 'recordFixture needs the real host agent loop. Use DSH_SNAPSHOT=refresh to regenerate goldens, '
      + 'or DSH_SNAPSHOT=replay to compare them.',
    )
  }
  const port = await probeFreePort()
  const server = createStaticServer(DIST_DIR)
  await new Promise<void>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolvePort())
  })

  const workspaceCwd = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-ws-'))
  const harnessHome = options.harnessHome ?? join(workspaceCwd, '.dsh-home')
  await mkdir(harnessHome, { recursive: true })
  const persistenceRoot = join(workspaceCwd, '.dsh-sessions')

  let seed: SeedDescriptor | undefined
  const baseUrl = buildBaseUrl(port, seed)

  const scaffold = {
    _port: port,
    mode,
    baseUrl,
    ctx: noHostContext(),
    workspaceCwd,
    persistenceRoot,
    harnessHome,
    whenTurnSettled(timeoutMs = 30_000): Promise<SessionId> {
      // Client-first: the fixture streams replays in-browser with no host
      // turn/end to await. A short settle delay keeps replay-mode callers
      // deterministic; record-mode callers are unsupported (see launchWebScaffold).
      const timeout = Number.isFinite(timeoutMs) ? Math.min(250, Math.max(0, timeoutMs)) : 250
      return new Promise<SessionId>((resolveSettled) => {
        setTimeout(() => resolveSettled(SessionId('fx-alpha')), timeout)
      })
    },
    async close(): Promise<void> {
      const failures: unknown[] = []
      await new Promise<void>((resolveClosed) => {
        server.close(() => resolveClosed())
      })
      await rm(workspaceCwd, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
      if (failures.length > 0) throw new AggregateError(failures, 'web scaffold teardown failed')
    },
  }
  return scaffold
}

// ---- Seeding (re-implemented over the fixture URL-seed extension) ----

/** Access (or initialize) the scaffold's pending seed descriptor. */
function ensureSeed(scaffold: WebScaffold): SeedDescriptor {
  const holder = scaffold as { _seed?: SeedDescriptor }
  holder._seed ??= { sessions: {} }
  return holder._seed
}

/** Refresh the scaffold's baseUrl after the pending seed changed. */
function commitSeed(scaffold: WebScaffold): void {
  const holder = scaffold as { _seed?: SeedDescriptor; _port?: number; baseUrl: string }
  const port = holder._port ?? 0
  holder.baseUrl = buildBaseUrl(port, holder._seed)
}

/**
 * Realize a recorded seed fixture against one scaffold: substitute the
 * `{{sessionId}}`/`{{cwd}}` placeholders and rewrite the recorded cwd to the
 * scaffold's workspace. Idempotent, so a caller may realize early (e.g. to
 * price content exactly as the host will fold it) and still pass the result
 * through {@link seedSession}.
 * @param scaffold - the booted scaffold whose workspace the seed targets.
 * @param fixtureText - the committed seed fixture text.
 * @param id - the session id the seed is realized for.
 * @returns the realized fixture text.
 */
export function realizeSeedFixture(scaffold: WebScaffold, fixtureText: string, id: string): string {
  const realized = fixtureText
    .split('{{sessionId}}').join(id)
    .split('{{cwd}}').join(scaffold.workspaceCwd)
  const fixtureCwd = (JSON.parse(realized.split('\n', 1)[0]!) as { cwd?: string }).cwd
  return fixtureCwd === undefined
    ? realized
    : realized.split(fixtureCwd).join(scaffold.workspaceCwd)
}

/**
 * Seed a recorded session fixture into the fixture world through the URL-seed
 * extension (the client-first parallel of the old real-API seeding). The seed
 * is queued on the scaffold and materialized when the browser next navigates
 * to `scaffold.baseUrl` (which carries the `seed` query).
 * @param scaffold - the target scaffold.
 * @param fixtureText - raw recorded session.jsonl contents.
 * @param id - the seeded session id (stable for deterministic goldens).
 * @param agentPreset - ignored (no host agent to report a running preset); kept for compatibility.
 * @returns the seeded id.
 */
export async function seedSession(
  scaffold: WebScaffold,
  fixtureText: string,
  id: string,
  agentPreset?: string,
): Promise<SessionId> {
  void agentPreset
  const events = parseSessionLog(realizeSeedFixture(scaffold, fixtureText, id))
  if (events.length === 0) throw new Error('seed fixture has no events')
  const last = events[events.length - 1]!
  // An open final turn would be mutated by resume's crash repair on first
  // open; a committed seed must be a closed recording.
  if (last.type !== 'turn/end') throw new Error(`seed fixture must end in turn/end, got ${last.type}`)
  const seed = ensureSeed(scaffold)
  seed.sessions[id] = { summary: { cwd: scaffold.workspaceCwd }, events }
  seed.workspace ??= { workspaceId: 'fx-ws-fixture', path: scaffold.workspaceCwd, title: 'fixture' }
  commitSeed(scaffold)
  return SessionId(id)
}

/** Seed one materialized cold Session whose log has no turn/start event. */
export async function seedBlankSession(
  scaffold: WebScaffold,
  id: string,
  cwd: string,
): Promise<SessionId> {
  const seed = ensureSeed(scaffold)
  seed.sessions[id] = {
    summary: { cwd, blank: true },
    events: [{
      type: 'session/end-seed',
      seq: 0,
      time: Date.now() - 60_000,
      data: {},
    }] as unknown as SessionEvent[],
  }
  seed.workspace ??= { workspaceId: 'fx-ws-fixture', path: cwd, title: 'fixture' }
  commitSeed(scaffold)
  return SessionId(id)
}

/**
 * Record-mode fixture write-back. UNSUPPORTED in the client-first scaffold:
 * recording harvests the live host agent loop, which the in-browser fixture
 * does not have. Deferred — callers fail loud here instead of drifting.
 * @throws always.
 */
export async function recordFixture(scaffold: WebScaffold, sessionId: SessionId, fixturePath: string): Promise<void> {
  void scaffold
  void sessionId
  void fixturePath
  throw new Error(
    'recordFixture is not supported by the client-first fixture scaffold (record mode needs the real '
    + 'host agent loop). Drive the scenario in DSH_SNAPSHOT=refresh mode to regenerate goldens, and '
    + 'maintain the seed.jsonl fixtures by hand or via the host-side snapshot lane.',
  )
}

/**
 * The user prompts recorded in a fixture, in order — the single source tying
 * spec drive steps to recorded reality so script and fixture cannot drift.
 * @param fixtureText - raw session.jsonl contents.
 * @returns the recorded user prompt texts.
 */
export function fixtureUserPrompts(fixtureText: string): string[] {
  return parseSessionLog(fixtureText).flatMap((event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    return text.length > 0 ? [text] : []
  })
}

// ---- Pure helpers (copied verbatim from the old scaffold) ----

/**
 * Normalize an aria snapshot: uuid, cwd, workspace-basename, duration,
 * decode-throughput, and path-sensitive compaction estimates collapse to
 * stable tokens.
 *
 * Throughput needs a token for the same reason durations do, and no fixture
 * can supply one: the figure divides a replayed step's output tokens by the
 * wall time the local run took to stream them, so it moves between two runs
 * on one machine (measured 69 → 70 tok/s) and swings wildly on a fast replay
 * (26333 tok/s for a 3 ms stream).
 */
function normalizeAria(snapshot: string, workspaceCwd: string): string {
  // The session heading renders the workspace's basename, not the full
  // path, so both spellings must collapse to the token.
  const base = workspaceCwd.split('/').pop()!
  return snapshot
    .split(workspaceCwd).join('{{cwd}}')
    .split(base).join('{{workspace}}')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{{uuid}}')
    // The optional space in `\d+m ?\d+s` covers both minute spellings: the
    // stats line's compact `2m42s` and the message-chrome template's `2m 42s`.
    .replace(
      /~\d+(?:y(?: \d+mo)?|mo(?: \d+d)?)|\b(?:\d+d(?: \d+h(?: \d+m \d+s)?)?|\d+h \d+m \d+s|\d+m ?\d+s|\d+(?:\.\d+)?s|\d+(?:\.\d+)?ms)\b/g,
      duration => duration.startsWith('~') ? duration : '{{duration}}',
    )
    .replace(
      /约\d+(?:年(?:\d+个月)?|个月(?:\d+天)?)|\d+(?:天(?:\d+小时(?:\d+分\d+秒)?)?|小时\d+分\d+秒|分\d+秒|(?:\.\d+)?秒)/g,
      duration => duration.startsWith('约') ? duration : '{{duration}}',
    )
    .replace(/\d+(?:\.\d+)?(?= tok\/s(?!\w))/g, '{{throughput}}')
    // Seeded compaction prices realized file paths, whose length differs
    // between local worktrees and CI scratch directories.
    .replace(/(Compacted \d+ history items \(~)\d+( tokens\))/g, '$1{{tokens}}$2')
    // Message IconActions clocks widen by calendar day/year; collapse every
    // format so goldens stay stable across midnight and year changes.
    .replace(/\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/g, '{{clock}}')
    .replace(/\d{1,2}月\d{1,2}日 \d{2}:\d{2}/g, '{{clock}}')
    .replace(/(?<!\d)\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:\s*[AP]M)?(?!\d)/gi, '{{clock}}')
    .replace(/(?<!\d)\d{2}:\d{2}(?!\d)/g, '{{clock}}')
}

/**
 * Capture the region's aria snapshot at a settled milestone: poll until two
 * consecutive normalized captures are equal — a single-shot capture races the
 * last React commits.
 * @param page - the page under test.
 * @param selector - the region locator selector.
 * @param workspaceCwd - normalization input.
 * @returns the stable normalized snapshot.
 */
export async function captureStableAria(page: Page, selector: string, workspaceCwd: string): Promise<string> {
  const region = page.locator(selector).first()
  let previous = normalizeAria(await region.ariaSnapshot(), workspaceCwd)
  await expect.poll(async () => {
    const current = normalizeAria(await region.ariaSnapshot(), workspaceCwd)
    const stable = current === previous
    previous = current
    return stable
  }, { timeout: 5_000, message: 'aria snapshot did not stabilize' }).toBe(true)
  return previous
}

/**
 * Compare a normalized golden, or rewrite it under refresh. Refresh is the
 * ONLY writer: a missing golden in replay mode fails with the healing command
 * instead of silently self-bootstrapping.
 * @param goldenPath - the committed ui.expected.md path.
 * @param actual - the stable normalized snapshot.
 * @param mode - the active snapshot mode.
 */
export async function compareOrRefreshGolden(goldenPath: string, actual: string, mode: WebSnapshotMode): Promise<void> {
  const payload = `${actual}\n`
  if (mode === 'refresh') {
    await mkdir(dirname(goldenPath), { recursive: true })
    await writeFile(goldenPath, payload)
    return
  }
  if (!existsSync(goldenPath)) {
    throw new Error(`missing golden ${goldenPath} — run DSH_SNAPSHOT=refresh pnpm run test:web to generate it`)
  }
  expect(payload).toBe(await readFile(goldenPath, 'utf8'))
}

/**
 * Fixture-inventory guard: the scenario directory holds exactly the expected
 * files and every committed JSONL is a scrub fixed-point without a run-local
 * browser RPC id.
 * @param dir - the scenario snapshot directory.
 * @param expected - the exact expected file inventory.
 */
export async function assertFixtureInventory(dir: string, expected: string[]): Promise<void> {
  const entries = (await readdir(dir)).sort()
  expect(entries).toEqual([...expected].sort())
  for (const entry of entries.filter(name => name.endsWith('.jsonl'))) {
    const content = await readFile(join(dir, entry), 'utf8')
    expect(content, `${dir}/${entry} carries a run-local rpcId`)
      .not.toMatch(/"rpcId":"(?!\{\{rpcId\}\})[^"]+"/)
  }
}

/**
 * Console tripwires: reconnect/gap-repair self-healing or a pageerror must
 * fail the scenario, not mask a dead wire behind eventual consistency.
 * @param page - the page under test.
 * @returns live warning/pageerror collectors to assert empty at scenario end.
 */
export function watchConsole(page: Page): { warnings: string[]; pageErrors: string[] } {
  const warnings: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/connection lost|gap repair|discontinuous/i.test(text)) warnings.push(text)
  })
  page.on('pageerror', (error) => { pageErrors.push(String(error)) })
  return { warnings, pageErrors }
}

/**
 * Remove only connection-loss warnings emitted after an intentional reload.
 * Earlier warnings and all gap-repair/discontinuity warnings remain fatal.
 * @param tripwire - the live console-warning collector.
 * @param warningStart - warning count captured immediately before reloading.
 */
export function acknowledgeReloadConnectionLoss(
  tripwire: ReturnType<typeof watchConsole>,
  warningStart: number,
): void {
  const reloadWarnings = tripwire.warnings.splice(warningStart)
  tripwire.warnings.push(...reloadWarnings.filter(text => !/connection lost/i.test(text)))
}
