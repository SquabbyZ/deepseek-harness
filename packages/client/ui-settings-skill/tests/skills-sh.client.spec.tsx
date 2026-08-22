// @vitest-environment jsdom
/**
 * skills.sh search + one-click install (Task 4).
 *
 * Two lanes:
 *  1. Fixture RPC — with `__TAURI_INTERNALS__` mocked so `http_request`
 *     returns a fake skills.sh search response, `skillRegistry/search` must
 *     project `{ name, description, installs, source }` (source = owner/repo);
 *     `skillRegistry/installSkill` must download the codeload tarball and drive
 *     `fs_write` + `shell_spawn` to extract it into `~/.dsh/skills/{name}`.
 *  2. Component — `SkillInventorySettingsTab` reuses the search box: a non-empty
 *     query triggers the `search` port and renders remote skill cards with an
 *     install button that calls `install` and refreshes the store on success.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
// Type-only side effect: loads the plugin's `declare module` LocaleNamespaceMap
// merge so PropsLocale resolves `t` for this test program (mirrors mcp-crud).
import type {} from '../src/client/index.ts'
import {
  SkillInventorySettingsTab,
  type SkillInventorySettingsTabInjected,
  type SkillInventorySettingsTabProps,
} from '../src/client/SkillInventorySettingsTab.tsx'
import {
  createSkillInventoryStore,
  type SkillEntryId,
  type SkillInventoryEntry,
  type SkillInventoryStore,
  type SkillRegistrySkill,
} from '../src/client/inventory-store.ts'
import { en, type SkillInventoryLocaleKey } from '../src/client/locales.ts'
import { createFixtureFaces } from '../../connection/src/client/fixture.ts'

afterEach(cleanup)

function id(value: string): SkillEntryId {
  return value as SkillEntryId
}

function translate(
  dict: typeof en,
  key: SkillInventoryLocaleKey,
  params?: Record<string, string>,
): string {
  const template: string = (dict as Record<string, string>)[key] ?? key
  let text = template
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{{${name}}}`, value)
    }
  }
  return text
}

/* ------------------------------------------------------------------ */
/*  Lane 1: fixture RPC via a mocked `__TAURI_INTERNALS__` bridge      */
/* ------------------------------------------------------------------ */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

interface TauriMockOpts {
  httpStatus?: number
  httpBody?: string
  dshConfigDir?: string
}

interface TauriMock {
  calls: Array<{ cmd: string; args?: Record<string, unknown> }>
  /** Reset the recorded call list (e.g. to isolate one mutation). */
  clear(): void
}

/** Install a fake `__TAURI_INTERNALS__.invoke` and record every call. */
function installTauriMock(opts: TauriMockOpts = {}): TauriMock {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  const invoke: InvokeFn = async (cmd, args) => {
    calls.push(args === undefined ? { cmd } : { cmd, args })
    switch (cmd) {
      case 'http_request': {
        const status = opts.httpStatus ?? 200
        const body = opts.httpBody ?? '{}'
        return { status, headers: {}, body: Array.from(new TextEncoder().encode(body)) }
      }
      case 'fs_write':
        return null
      case 'shell_spawn':
        return 42
      case 'dsh_config_dir':
        return opts.dshConfigDir ?? 'C:/Users/test/.dsh'
      default:
        return null
    }
  }
  ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke }
  return {
    calls,
    clear() { calls.length = 0 },
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

/** Drive the fixture's skillRegistry/search Remote endpoint. */
async function searchSkills(
  rpc: ReturnType<typeof createFixtureFaces>['rpc'],
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await rpc.call('/api', 'skillRegistry/search', { args: { agentId: 'fx-alpha' as never, query } })
  if (!result.ok) throw new Error(`skillRegistry/search failed: ${result.error.code}`)
  return (result.value as { skills: Array<Record<string, unknown>> }).skills
}

/** Drive the fixture's skillRegistry/installSkill Remote endpoint. */
async function installSkill(
  rpc: ReturnType<typeof createFixtureFaces>['rpc'],
  target: { name: string; source: string },
): Promise<Record<string, unknown>> {
  const result = await rpc.call('/api', 'skillRegistry/installSkill', {
    args: { agentId: 'fx-alpha' as never, target },
  })
  if (!result.ok) throw new Error(`skillRegistry/installSkill failed: ${result.error.code}`)
  return result.value as Record<string, unknown>
}

const SEARCH_BODY = JSON.stringify({
  count: 2,
  skills: [
    { id: 'wshobson/agents/shellcheck-configuration', skillId: 'shellcheck-configuration', name: 'shellcheck-configuration', installs: 9187, source: 'wshobson/agents' },
    { id: 'vercel/ai-skill/plan', skillId: 'plan', name: 'Plan', installs: 300, source: 'vercel/ai-skill' },
  ],
})

describe('skillRegistry/search — skills.sh projection', () => {
  it('projects { name, description, installs, source } and defaults a missing description to ""', async () => {
    installTauriMock({ httpBody: SEARCH_BODY })
    const { rpc } = createFixtureFaces()
    const skills = await searchSkills(rpc, 'shell')
    expect(skills).toEqual([
      { name: 'shellcheck-configuration', description: '', installs: 9187, source: 'wshobson/agents' },
      { name: 'Plan', description: '', installs: 300, source: 'vercel/ai-skill' },
    ])
  })

  it('returns an empty skill list without a Tauri bridge (browser fallback)', async () => {
    const { rpc } = createFixtureFaces()
    const skills = await searchSkills(rpc, 'shell')
    expect(skills).toEqual([])
  })
})

describe('skillRegistry/installSkill — tarball download + extract', () => {
  it('downloads the codeload tarball and drives fs_write + shell_spawn, returning { ok }', async () => {
    const bridge = installTauriMock({
      httpBody: 'not-a-real-tarball', // the fixture only transports the bytes
    })
    const { rpc } = createFixtureFaces()
    const value = await installSkill(rpc, { name: 'shellcheck-configuration', source: 'wshobson/agents' })
    expect(value).toEqual({ ok: true })
    // The tarball must be downloaded from the owner/repo codeload URL.
    expect(bridge.calls).toContainEqual({
      cmd: 'http_request',
      args: {
        req: {
          method: 'GET',
          url: 'https://codeload.github.com/wshobson/agents/tar.gz/HEAD',
          headers: {},
          timeout_ms: 120_000,
        },
      },
    })
    // The downloaded bytes are persisted under a temp dir, then extracted by
    // the system tar with the {repo}-{sha} top dir stripped. The spawn cmd is
    // platform-correct: the jsdom test UA (`(win32)`, no "windows" marker)
    // resolves to the POSIX `tar`; the Windows branch is covered below.
    expect(bridge.calls).toContainEqual({
      cmd: 'fs_write',
      args: { path: 'C:/Users/test/.dsh/skills/.dsh-tmp/shellcheck-configuration/source.tar.gz', content: expect.any(Array) },
    })
    expect(bridge.calls).toContainEqual(expect.objectContaining({
      cmd: 'shell_spawn',
      args: expect.objectContaining({
        spec: expect.objectContaining({
          cmd: 'tar',
          args: expect.arrayContaining(['-xzf']),
        }),
      }),
    }))
  })

  it('sends tar.exe on a Windows host (shell whitelist gate is exact-match)', async () => {
    // jsdom exposes a read-only-ish navigator; replace it for this test with a
    // Windows-style UA (the same surface `isWindowsHost` sniffs), then restore.
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 like Gecko' },
      writable: true,
      configurable: true,
    })
    try {
      const bridge = installTauriMock({ httpBody: 'not-a-real-tarball' })
      const { rpc } = createFixtureFaces()
      const value = await installSkill(rpc, { name: 'shellcheck-configuration', source: 'wshobson/agents' })
      expect(value).toEqual({ ok: true })
      expect(bridge.calls).toContainEqual(expect.objectContaining({
        cmd: 'shell_spawn',
        args: expect.objectContaining({
          spec: expect.objectContaining({
            cmd: 'tar.exe',
            args: expect.arrayContaining(['-xzf']),
          }),
        }),
      }))
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator
      } else {
        Object.defineProperty(globalThis, 'navigator', originalNavigator)
      }
    }
  })

  it('fails gracefully without a Tauri bridge', async () => {
    const { rpc } = createFixtureFaces()
    const result = await rpc.call('/api', 'skillRegistry/installSkill', {
      args: { agentId: 'fx-alpha' as never, target: { name: 'x', source: 'a/b' } },
    })
    expect(result.ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  Lane 2: SkillInventorySettingsTab component                        */
/* ------------------------------------------------------------------ */

const REMOTE_SKILLS: readonly SkillRegistrySkill[] = [
  { name: 'shellcheck-configuration', description: '', installs: 9187, source: 'wshobson/agents' },
  { name: 'Plan', description: 'Plan skill', installs: 300, source: 'vercel/ai-skill' },
]

/** Build a store whose ports record search/install calls and re-list on install. */
function buildSearchStore(initial: readonly SkillInventoryEntry[]) {
  const installed: Array<{ name: string; source: string }> = []
  const searched: string[] = []
  const entries = new Map<string, SkillInventoryEntry>()
  for (const entry of initial) entries.set(entry.entryId, entry)
  const store = createSkillInventoryStore({
    list: async () => ({ entries: [...entries.values()] }),
    search: async (query: string) => {
      searched.push(query)
      const normalized = query.toLowerCase()
      return { skills: REMOTE_SKILLS.filter(skill => skill.name.toLowerCase().includes(normalized)) }
    },
    install: async (target: { name: string; source: string }) => {
      installed.push(target)
      const entry: SkillInventoryEntry = {
        entryId: id(target.name),
        name: target.name,
        description: '',
        source: 'user-dsh',
        provider: 'dsh',
        modelInvocable: true,
        userInvocable: true,
        enabled: true,
      }
      entries.set(entry.entryId, entry)
    },
  }, () => undefined)
  return { store, installed, searched }
}

function buildProps({
  store,
  search,
  install,
  setEnabled = vi.fn(async () => undefined),
  list = vi.fn(async () => ({ entries: store.getSnapshot().entries })),
  refresh = vi.fn(),
}: {
  store: SkillInventoryStore
  search?: SkillInventorySettingsTabInjected['search']
  install?: SkillInventorySettingsTabInjected['install']
  setEnabled?: SkillInventorySettingsTabInjected['setEnabled']
  list?: SkillInventorySettingsTabInjected['list']
  refresh?: SkillInventorySettingsTabInjected['refresh']
}): SkillInventorySettingsTabProps {
  return {
    store,
    setEnabled,
    search: search ?? (() => Promise.resolve({ skills: [] })),
    install: install ?? (() => Promise.resolve()),
    list,
    refresh,
    close: () => undefined,
    t: (key: SkillInventoryLocaleKey, params?: Record<string, string>) => translate(en, key, params),
  } as SkillInventorySettingsTabProps
}

describe('createSkillInventoryStore install — awaits the re-read', () => {
  it('publishes the freshly installed entry before the install promise settles', async () => {
    const { store, installed } = buildSearchStore([])
    await store.install({ name: 'Plan', source: 'vercel/ai-skill' })
    expect(installed).toContainEqual({ name: 'Plan', source: 'vercel/ai-skill' })
    // The store re-read the inventory and published before install resolved.
    expect(store.getSnapshot().entries.map(entry => entry.entryId)).toEqual(['Plan'])
    expect(store.getSnapshot().read).toBe(true)
  })
})

describe('SkillInventorySettingsTab skills.sh search + install', () => {
  it('triggers the search port on a non-empty query and renders remote cards', async () => {
    const { store, searched } = buildSearchStore([])
    const search = vi.fn((query: string) => store.search(query))
    render(<SkillInventorySettingsTab {...buildProps({ store, search })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'shell' } })

    await waitFor(() => { expect(searched).toContain('shell') })
    // The remote card for the matching skill renders under the search section.
    await waitFor(() => { expect(screen.getByText('shellcheck-configuration')).toBeTruthy() })
    expect(screen.queryByText('Plan')).toBeNull()
  })

  it('installs a remote skill through the install port and refreshes the list', async () => {
    const { store, installed } = buildSearchStore([])
    const search = vi.fn((query: string) => store.search(query))
    const install = vi.fn(async (target: { name: string; source: string }) => { await store.install(target) })
    const refresh = vi.fn(() => { store.refresh() })
    render(<SkillInventorySettingsTab {...buildProps({ store, search, install, refresh })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'plan' } })
    await waitFor(() => { expect(screen.getByText('Plan')).toBeTruthy() })

    // The install button is labeled with the localized 安装 copy.
    const installButton = screen.getAllByRole('button', { name: en.install })[0]
    if (installButton !== undefined) fireEvent.click(installButton)

    await waitFor(() => { expect(installed).toContainEqual({ name: 'Plan', source: 'vercel/ai-skill' }) })
    expect(install).toHaveBeenCalledWith({ name: 'Plan', source: 'vercel/ai-skill' })
    // A successful install refreshes the inventory → the new local entry appears.
    await waitFor(() => { expect(screen.getByText(en.installSuccess.replace('{{name}}', 'Plan'))).toBeTruthy() })
  })

  it('flashes an error toast when the install fails', async () => {
    const { store } = buildSearchStore([])
    const search = vi.fn((query: string) => store.search(query))
    const install = vi.fn(async () => { throw new Error('boom') })
    const refresh = vi.fn()
    render(<SkillInventorySettingsTab {...buildProps({ store, search, install, refresh })} />)

    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'plan' } })
    await waitFor(() => { expect(screen.getByText('Plan')).toBeTruthy() })

    const installButton = screen.getAllByRole('button', { name: en.install })[0]
    if (installButton !== undefined) fireEvent.click(installButton)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.installFailed.replace('{{name}}', 'Plan').replace('{{reason}}', 'boom'))
    })
    expect(refresh).not.toHaveBeenCalled()
  })
})
