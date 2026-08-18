// Web e2e: the agent-preset inventory toggle flow.
//
// Open Settings → Plugins → 代理预设, flip one entry's Switch, confirm the
// override lands in `~/.dsh/settings.yaml` under `agent-inventory.enabled`,
// and verify the toggle survives a page reload. Zero model calls: the
// scenario uses only Settings UI plus Host settings + agent preset reads,
// so it runs keyless under the standard web replay scaffold.
//
// The shipped composition ships with three agent presets (code / cordis /
// minimal / standard — see apps/cli/config/agent-presets/), so the toggle
// path is fully exercised here. The settings write is the canonical signal:
// the user overlay layer is
// `~/.dsh/settings.yaml:agent-inventory.enabled.<preset-id>`. Both the
// overlay and the rolled-back switch state are checked after each commit.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { join } from 'node:path'
import {
  acknowledgeReloadConnectionLoss,
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-inventory-toggle', import.meta.url))
const READY_EXPECTED = join(SNAPSHOT_DIR, 'ready.expected.md')
const MODE = webSnapshotMode()

/** Selector for one inventory row in the rendered tab. */
const ROW_SELECTOR = '[data-agent-entry]'
/** Preset id the shipped composition is guaranteed to include. */
const TARGET_PRESET_ID = 'code'

describe('web e2e: agent inventory toggle', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Open the Settings modal, switch to the Plugins section, and select the
   * 代理预设 tab. Returns the dialog locator.
   */
  async function openAgentInventory(): Promise<Locator> {
    if (await page.getByRole('dialog', { name: '设置' }).count() > 0) {
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('dialog', { name: '设置' }).count(), { timeout: 5_000 }).toBe(0)
    }
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '插件', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('button', { name: '插件', exact: true }).getAttribute('aria-current'), { timeout: 5_000 })
      .toBe('true')
    await dialog.getByRole('tab', { name: '代理预设', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('tab', { name: '代理预设', exact: true }).getAttribute('aria-selected'), { timeout: 5_000 })
      .toBe('true')
    await expect
      .poll(() => dialog.locator(ROW_SELECTOR).count(), { timeout: 15_000 })
      .toBeGreaterThan(0)
    return dialog
  }

  /** Read the user overlay section. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => '')
  }

  /** Find the row whose preset id matches `presetId`. */
  async function findRow(dialog: Locator, presetId: string): Promise<Locator | null> {
    const rows = dialog.locator(ROW_SELECTOR)
    const count = await rows.count()
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i)
      const entryId = await row.getAttribute('data-agent-entry')
      if (entryId === presetId) return row
    }
    return null
  }

  it('renders one row per agent preset with the expected copy', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-inventory-render'))
    const dialog = await openAgentInventory()

    // The shipped composition ships at least the `code` preset. Find it and
    // assert the switch starts on (its default is enabled; the user overlay
    // has no entry yet).
    const row = await findRow(dialog, TARGET_PRESET_ID)
    expect(row).not.toBeNull()
    const switchEl = row!.getByRole('switch')
    expect(await switchEl.getAttribute('data-state')).toBe('checked')

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(READY_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('toggles a preset off, persists the override, and survives a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-inventory-toggle'))
    const dialog = await openAgentInventory()
    const row = await findRow(dialog, TARGET_PRESET_ID)
    expect(row).not.toBeNull()

    const switchEl = row!.getByRole('switch')
    expect(await switchEl.getAttribute('data-state')).toBe('checked')

    await switchEl.click()
    await expect
      .poll(() => switchEl.getAttribute('data-state'), { timeout: 10_000 })
      .toBe('unchecked')

    await expect
      .poll(async () => (await settingsDocument()).includes('agent-inventory:'), { timeout: 10_000 })
      .toBe(true)
    await expect
      .poll(async () => {
        const doc = await settingsDocument()
        return /agent-inventory:\s*\n\s*enabled:\s*\n\s*['"]?[^\n'"]+['"]?:\s*false/.test(doc)
      }, { timeout: 10_000 })
      .toBe(true)

    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    const reopened = await openAgentInventory()
    const reloadedRow = await findRow(reopened, TARGET_PRESET_ID)
    expect(reloadedRow).not.toBeNull()
    const reloadedSwitch = reloadedRow!.getByRole('switch')
    await expect
      .poll(() => reloadedSwitch.getAttribute('data-state'), { timeout: 10_000 })
      .toBe('unchecked')
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('rolls back the optimistic state when setEnabled rejects', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-inventory-rollback'))
    const dialog = await openAgentInventory()
    const row = await findRow(dialog, TARGET_PRESET_ID)
    expect(row).not.toBeNull()

    const switchEl = row!.getByRole('switch')

    await page.route('**/api/agentInventory/**', async (route) => {
      const request = route.request()
      const body = request.postDataJSON() as { method?: string; rpcId: string; payload: unknown } | undefined
      if (body?.method !== 'agentInventory/setEnabled') return route.fallback()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId: body.rpcId,
          result: {
            ok: false,
            error: { code: 'forced', message: 'forced setEnabled failure', details: {} },
          },
        }),
      })
    })

    await switchEl.click()
    await expect
      .poll(() => switchEl.getAttribute('data-state'), { timeout: 10_000 })
      .toBe('checked')
    await expect.poll(async () => (await page.getByRole('alert').count()) > 0, { timeout: 5_000 })
      .toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ready.expected.md'])
  })
})
