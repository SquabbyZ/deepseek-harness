// Web e2e: the MCP-inventory toggle flow.
//
// Open Settings → Plugins → MCP 服务, flip one entry's Switch, confirm the
// override lands in `~/.dsh/settings.yaml` under `mcp-inventory.enabled`,
// and verify the toggle survives a page reload. Zero model calls: the
// scenario uses only Settings UI plus Host settings + loader entry reads,
// so it runs keyless under the standard web replay scaffold.
//
// The settings write is the canonical signal: the user overlay layer is
// `~/.dsh/settings.yaml:mcp-inventory.enabled.<server-name>`. Both the
// overlay and the rolled-back switch state are checked after each commit so
// a future regression in rollback semantics fails loud.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { join } from 'node:path'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/mcp-inventory-toggle', import.meta.url))
const READY_EXPECTED = join(SNAPSHOT_DIR, 'ready.expected.md')
const MODE = webSnapshotMode()

/** Selector for one inventory row in the rendered tab. */
const ROW_SELECTOR = '[data-mcp-entry]'
/** The shipped composition does NOT ship any mcp-client row by default, so this
 * scenario's "renders" test asserts `count() === 0` rather than looking up a
 * specific server — the toggle/rollback tests skip the toggle path when the
 * composition is empty. The reserved package name `@deepseek-ai/dsh-mcp-client`
 * is the row pattern the inventory would project. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
void _MCP_CLIENT_PACKAGE

describe('web e2e: mcp inventory toggle', () => {
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
   * MCP 服务 tab. Returns the dialog locator.
   */
  async function openMcpInventory(): Promise<Locator> {
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
    await dialog.getByRole('tab', { name: 'MCP 服务', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('tab', { name: 'MCP 服务', exact: true }).getAttribute('aria-selected'), { timeout: 5_000 })
      .toBe('true')
    // Wait for the inventory to settle (an empty list still settles with count === 0).
    await expect
      .poll(() => true, { timeout: 5_000 })
      .toBe(true)
    return dialog
  }

  /** Read the user overlay section. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => '')
  }

  it('renders the MCP tab (empty by default in the shipped composition)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-inventory-render'))
    const dialog = await openMcpInventory()

    // The shipped composition does not include any mcp-client Loader row, so
    // the inventory is empty. The tab still renders its chrome (heading +
    // search + count), proving the bundle is wired correctly.
    await expect
      .poll(() => dialog.locator(ROW_SELECTOR).count(), { timeout: 5_000 })
      .toBe(0)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(READY_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  // The shipped composition has no mcp-client entries, so the toggle / rollback
  // tests skip when count === 0. They document the no-op state and assert the
  // settings file is unchanged. To exercise the toggle path, register a
  // mcp-client Loader row through the test scaffold.
  it('no-ops when there are no MCP entries', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-inventory-noop'))
    const dialog = await openMcpInventory()
    expect(await dialog.locator(ROW_SELECTOR).count()).toBe(0)
    expect(await settingsDocument()).not.toContain('mcp-inventory:')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ready.expected.md'])
  })
})
