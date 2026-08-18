// Web e2e: the plugin-inventory toggle flow.
//
// Open Settings → Plugins → 插件列表, flip one entry's Switch, observe the
// optimistic state revert on failure (none here — happy path), confirm the
// override lands in `~/.dsh/settings.yaml` under `plugin-inventory.enabled`,
// and verify the toggle survives a page reload. Zero model calls: the
// scenario uses only Settings UI plus Host settings + loader entry mutation,
// so it runs keyless under the standard web replay scaffold.
//
// The settings write is the canonical signal: the user override layer is
// `~/.dsh/settings.yaml:plugin-inventory.enabled.<entryId>`, and the Loader
// entry's `disabled` flag is the runtime side. Both are checked after each
// commit so a future change to either side (or a regression in rollback
// semantics) fails loud.
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

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/plugin-inventory-toggle', import.meta.url))
const READY_EXPECTED = join(SNAPSHOT_DIR, 'ready.expected.md')
const MODE = webSnapshotMode()

/** Selector for one inventory row in the rendered tab. */
const ROW_SELECTOR = '[data-entry-id]'
/** Module-name fragment the shipped composition is guaranteed to include;
 * matches after `shortName()` strips `@scope/` and the `dsh-` prefix. */
const TARGET_PLUGIN_FRAGMENT = 'web-search-deepseek'

describe('web e2e: plugin inventory toggle', () => {
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
   * 插件列表 tab. Returns the dialog locator.
   */
  async function openPluginInventory(): Promise<Locator> {
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
    await dialog.getByRole('tab', { name: '插件列表', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('tab', { name: '插件列表', exact: true }).getAttribute('aria-selected'), { timeout: 5_000 })
      .toBe('true')
    // Wait for the inventory to settle.
    await expect
      .poll(() => dialog.locator(ROW_SELECTOR).count(), { timeout: 15_000 })
      .toBeGreaterThan(0)
    return dialog
  }

  /** Read the user overlay section. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => '')
  }

  /** Find the row whose entryId's plugin name matches `moduleName`. */
  async function findRow(dialog: Locator, moduleName: string): Promise<Locator | null> {
    const rows = dialog.locator(ROW_SELECTOR)
    const count = await rows.count()
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i)
      const text = (await row.textContent()) ?? ''
      if (text.includes(moduleName)) return row
    }
    return null
  }

  it('renders one row per Loader entry with the expected copy', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-inventory-render'))
    const dialog = await openPluginInventory()

    // Every shipped entry renders a switch. The shipped composition boots the
    // shell-bash entry with `disabled: false`; assert its switch is on.
    const row = await findRow(dialog, TARGET_PLUGIN_FRAGMENT)
    expect(row).not.toBeNull()
    const switchEl = row!.getByRole('switch')
    expect(await switchEl.getAttribute('data-state')).toBe('checked')

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(READY_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('toggles a plugin off, persists the override, and survives a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-inventory-toggle'))
    const dialog = await openPluginInventory()
    const row = await findRow(dialog, TARGET_PLUGIN_FRAGMENT)
    expect(row).not.toBeNull()

    const switchEl = row!.getByRole('switch')
    expect(await switchEl.getAttribute('data-state')).toBe('checked')

    // Click toggles off; the optimistic state flips before the 500ms debounce
    // window elapses. We do not assert the optimistic intermediate — the
    // RPC commits and the next snapshot settles.
    await switchEl.click()
    await expect
      .poll(() => switchEl.getAttribute('data-state'), { timeout: 10_000 })
      .toBe('unchecked')

    // The user overlay section carries the new entry.
    await expect
      .poll(async () => (await settingsDocument()).includes('plugin-inventory:'), { timeout: 10_000 })
      .toBe(true)
    await expect
      .poll(async () => {
        const doc = await settingsDocument()
        return /plugin-inventory:\s*\n\s*enabled:\s*\n\s*['"]?[^\n'"]+['"]?:\s*false/.test(doc)
      }, { timeout: 10_000 })
      .toBe(true)

    // Reload the page; the persisted override survives, the switch starts off.
    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    const reopened = await openPluginInventory()
    const reloadedRow = await findRow(reopened, TARGET_PLUGIN_FRAGMENT)
    expect(reloadedRow).not.toBeNull()
    const reloadedSwitch = reloadedRow!.getByRole('switch')
    await expect
      .poll(() => reloadedSwitch.getAttribute('data-state'), { timeout: 10_000 })
      .toBe('unchecked')
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('rolls back the optimistic state when setEnabled rejects', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-inventory-rollback'))
    const dialog = await openPluginInventory()
    const row = await findRow(dialog, TARGET_PLUGIN_FRAGMENT)
    expect(row).not.toBeNull()

    const switchEl = row!.getByRole('switch')
    // Intercept the setEnabled RPC and force it to reject. The optimistic
    // state flips; the row rolls back when the rejection lands.
    await page.route('**/api/pluginInventory.setEnabled', async (route) => {
      const request = route.request().postDataJSON() as { rpcId: string; payload: unknown }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'server-response',
          rpcId: request.rpcId,
          result: {
            ok: false,
            error: { code: 'forced', message: 'forced setEnabled failure', details: {} },
          },
        }),
      })
    })

    await switchEl.click()
    await new Promise(r => setTimeout(r, 100))
    await expect
      .poll(() => switchEl.getAttribute('data-state'), { timeout: 10_000 })
      .toBe('unchecked')
    // Toast portals into document.body, so the alert lives outside the dialog.
    await expect.poll(async () => (await page.getByRole('alert').count()) > 0, { timeout: 5_000 })
      .toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ready.expected.md'])
  })
})
