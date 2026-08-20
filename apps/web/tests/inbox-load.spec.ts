// Playwright smoke for phase 2 task 2.6.6.
//
// Boots the vite dev server through `playwright.config.ts`, navigates to a
// stub HTML fixture that imports `startHost()` from `apps/web/src/dsh/host.ts`,
// waits for Cordis to finish wiring up the in-box plugins, and asserts:
//   1. no console errors / uncaught exceptions during boot
//   2. at least one Cordis runtime was registered (`ctx.registry.size`),
//      which is what `ctx.plugin()` populates — the brief's "≥1 loader
//      entry" was authored against `ctx.loader.entries()` which the
//      in-box wire-up does NOT touch (phase 2 task 2.6.2 routes plugins
//      through `ctx.plugin()` directly, not via the loader config tree).
//   3. a specific known in-box plugin's runtime callback is observable
//
// The fixture writes a structured result to `window.__inboxLoad`, which is
// what the assertions read from. Assertions fail loudly so a future
// regression in the in-box set surfaces immediately.
import type { ConsoleMessage, Page } from '@playwright/test'
import { test, expect } from '@playwright/test'

interface InboxLoadResult {
  ok: boolean
  error?: string
  registrySize: number
  loaderEntryCount: number
  entryIds: string[]
  hasKnownPlugin: boolean
  knownPluginFragment: string
}

const FIXTURE_URL = '/tests/inbox-load/index.html'
// `ctx.registry.entries()` returns `[callback, runtime]` per registered
// plugin. The plugin's runtime.callback is the namespace object; its
// `name` export is what `task 2.6.1`'s audit used to label entries.
const KNOWN_PLUGIN_NAME = 'tool-web'

/** Collect console + page errors so the assertion can read them after settle. */
function installConsoleWatch(page: Page): { errors: string[]; pageErrors: Error[]; allConsole: string[]; failedRequests: string[] } {
  const errors: string[] = []
  const pageErrors: Error[] = []
  const allConsole: string[] = []
  const failedRequests: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    const text = `[${msg.type()}] ${msg.text()}`
    allConsole.push(text)
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err: Error) => {
    pageErrors.push(err)
    allConsole.push(`[pageerror] ${err.name}: ${err.message}\n${err.stack ?? ''}`)
  })
  // Capture any 5xx HTTP responses — vite surfaces transform failures as
  // 500 JSON and that's usually the only way to find the failing file when
  // a parse-time SyntaxError hides its filename.
  page.on('response', (resp) => {
    if (resp.status() >= 500) {
      failedRequests.push(`${resp.status()} ${resp.url()}`)
    }
  })
  return { errors, pageErrors, allConsole, failedRequests }
}

/** Read `window.__inboxLoad`, retrying until the fixture reports completion. */
async function waitForFixtureResult(page: Page): Promise<InboxLoadResult> {
  await page.waitForFunction(
    () => typeof window.__inboxLoad !== 'undefined',
    undefined,
    { timeout: 90_000 },
  )
  return page.evaluate(() => window.__inboxLoad!) as Promise<InboxLoadResult>
}

test('in-box plugins boot via startHost() with no console errors', async ({ page }) => {
  test.setTimeout(180_000)
  const { errors, pageErrors, allConsole, failedRequests } = installConsoleWatch(page)
  await page.goto(FIXTURE_URL, { waitUntil: 'load' })

  let result: InboxLoadResult | null = null
  try {
    result = await waitForFixtureResult(page)
  } catch (waitErr) {
    // Fixture never reported a result; dump every captured console line,
    // any 5xx responses, and the visible body text so the cause is
    // diagnosable from the failure surface alone.
    const bodyText = await page.evaluate(() => document.body && document.body.innerText)
    const consoleDump = allConsole.join('\n  ')
    const requestsDump = failedRequests.join('\n  ')
    throw new Error(
      `fixture never produced window.__inboxLoad: ${waitErr instanceof Error ? waitErr.message : String(waitErr)}\n`
        + `page body: ${bodyText ?? '<empty>'}\n`
        + `console (${allConsole.length} lines):\n  ${consoleDump}\n`
        + `failed requests (${failedRequests.length}):\n  ${requestsDump}`,
    )
  }

  // Brief task 2.6.6 — surface any fixture-level failure with the error
  // text it captured before checking the narrower assertions.
  if (!result.ok || result.error) {
    throw new Error(
      `fixture reported error: ${result.error ?? '(no error field)'}\n`
        + `console (${errors.length}): ${errors.join(' \\n ')}\n`
        + `page-errors (${pageErrors.length}): ${pageErrors.map(e => e.message).join(' \\n ')}`,
    )
  }

  expect(result.error, result.error ?? 'fixture reported an error').toBeUndefined()
  expect(result.ok, 'fixture must report ok=true after startHost() completes').toBe(true)
  // Cordis registry: every `ctx.plugin()` call adds an entry. Phase 2 task
  // 2.6.2 wires in-box plugins through `ctx.plugin()` — this is the
  // truthful "≥1 plugin loaded" assertion for this fixture.
  expect(
    result.registrySize,
    `ctx.registry returned ${result.registrySize} runtimes, expected ≥1`,
  ).toBeGreaterThanOrEqual(1)
  // Brief task 2.6.6 — a specific known plugin is registered. We match
  // by the runtime's `name` export (the cordis loader diagnostic name),
  // which the audit assigned.
  expect(
    result.hasKnownPlugin,
    `expected a plugin whose name contains "${KNOWN_PLUGIN_NAME}", got: ${result.entryIds.join(', ')}`,
  ).toBe(true)

  expect(pageErrors, `uncaught exceptions on the page: ${pageErrors.map(e => e.message).join(' | ')}`).toEqual([])
  expect(
    errors,
    `console errors during boot: ${errors.join(' | ')}`,
  ).toEqual([])
})
