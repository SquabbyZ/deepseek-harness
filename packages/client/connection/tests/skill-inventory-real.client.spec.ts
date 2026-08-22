/**
 * Skill inventory real-directory read + persistence (Task 2 + aggregation fix):
 * with a Tauri bridge installed (`__TAURI_INTERNALS__`), `skillInventory/list`
 * must first invoke `skill_roots_ensure` (Rust creates `~/.dsh/skills` and
 * links every `~/.agents/skills/<name>` skill into it), then project the real
 * `~/.dsh/skills` directory — the SINGLE aggregation root — through
 * `fs_list`/`fs_read`, overlay the persisted `enabled` map, and
 * `skillInventory/setEnabled` must persist through `settings_update`. Without a
 * bridge the fixture falls back to the hardcoded list.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionId } from '../src/client/api.ts'
import { createFixtureFaces, homeFromDshConfigDir, parseSkillFrontmatter } from '../src/client/fixture.ts'

const sid = (id: string): SessionId => id as SessionId

type FsEntry = { name: string; is_dir: boolean; size: number }
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

interface TauriMockOpts {
  list?: Record<string, FsEntry[]>
  /** Dirs whose `fs_list` rejects (permission-denied simulation). */
  listErrors?: string[]
  read?: Record<string, string>
  settingsGet?: Record<string, unknown>
  settingsUpdate?: Array<{ key: string; value: unknown }>
  dshConfigDir?: string
}

/** Install a fake `__TAURI_INTERNALS__.invoke` and record every call. */
function installTauriMock(opts: TauriMockOpts = {}): { calls: Array<{ cmd: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  const invoke: InvokeFn = async (cmd, args) => {
    calls.push(args === undefined ? { cmd } : { cmd, args })
    switch (cmd) {
      case 'fs_list': {
        const dir = String(args?.dir)
        if (opts.listErrors?.includes(dir)) throw new Error('FsPermissionDenied')
        return opts.list?.[dir] ?? []
      }
      case 'fs_read': {
        const path = String(args?.path)
        const text = opts.read?.[path]
        if (text === undefined) throw new Error(`fs_read: no mock for ${path}`)
        return Array.from(new TextEncoder().encode(text))
      }
      case 'settings_get': {
        const key = String(args?.key)
        return opts.settingsGet?.[key] ?? null
      }
      case 'settings_update':
        opts.settingsUpdate?.push({ key: String(args?.key), value: args?.value })
        return null
      case 'skill_roots_ensure':
        // Aggregation root creation + agent-skill linking: a no-op in the mock.
        return null
      case 'dsh_config_dir':
        return opts.dshConfigDir ?? 'C:/Users/test/.dsh'
      case 'search_skills_sh': {
        // Rust `search_skills_sh` is the canonical registry search; the fixture
        // routes through it instead of the `http_request` bridge. Return a
        // minimal valid shape so callers see a non-null result and can run the
        // projection.
        return { skills: [], totalCount: 0, query: String(args?.query ?? '') }
      }
      default:
        return null
    }
  }
  ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke }
  return { calls }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
})

/** Drive the fixture's skillInventory/list Remote endpoint. */
async function skillList(rpc: ReturnType<typeof createFixtureFaces>['rpc']): Promise<Array<Record<string, unknown>>> {
  const result = await rpc.call('/api', 'skillInventory/list', { args: { agentId: sid('fx-alpha') } })
  if (!result.ok) throw new Error(`skillInventory/list failed: ${result.error.code}`)
  return (result.value as { entries: Array<Record<string, unknown>> }).entries
}

/** Drive the fixture's skillInventory/setEnabled Remote endpoint. */
async function skillSetEnabled(
  rpc: ReturnType<typeof createFixtureFaces>['rpc'],
  entryId: string,
  enabled: boolean,
): Promise<void> {
  const result = await rpc.call('/api', 'skillInventory/setEnabled', {
    args: { agentId: sid('fx-alpha'), entry: { entryId, enabled } },
  })
  if (!result.ok) throw new Error(`skillInventory/setEnabled failed: ${result.error.code}`)
}

const SKILLS_DIR = 'C:/Users/test/.dsh/skills'
const AGENTS_DIR = 'C:/Users/test/.agents/skills'

describe('parseSkillFrontmatter', () => {
  it('extracts top-level name/description/whenToUse string fields', () => {
    expect(parseSkillFrontmatter(`---
name: shell
description: 在受控范围内执行 shell 命令
whenToUse: 需要执行 shell 时
---

# Body`)).toEqual({
      name: 'shell',
      description: '在受控范围内执行 shell 命令',
      whenToUse: '需要执行 shell 时',
    })
  })

  it('handles quoted values and a folded `|` description block', () => {
    expect(parseSkillFrontmatter(`---
name: "web-search"
description: |
  第一行描述
  第二行描述
---`)).toEqual({
      name: 'web-search',
      description: '第一行描述 第二行描述',
    })
  })

  it('returns empty when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# No frontmatter\n\ntext')).toEqual({})
  })

  it('produces an empty string for an empty block scalar (`description: |` then `---`)', () => {
    expect(parseSkillFrontmatter(`---
name: shell
description: |
---`)).toEqual({ name: 'shell', description: '' })
  })

  it('trims trailing indented blank lines from a folded block scalar', () => {
    expect(parseSkillFrontmatter(`---
description: |
  第一行
  ${'  '}
  ${'  '}
---`)).toEqual({ description: '第一行' })
  })

  it('folds a `>` block scalar the same way as `|`', () => {
    expect(parseSkillFrontmatter(`---
description: >
  第一行
  第二行
---`)).toEqual({ description: '第一行 第二行' })
  })
})

describe('homeFromDshConfigDir', () => {
  it('strips trailing separators and the final path segment', () => {
    expect(homeFromDshConfigDir('C:/Users/test/.dsh')).toBe('C:/Users/test')
    expect(homeFromDshConfigDir('C:/Users/test/.dsh/')).toBe('C:/Users/test')
    expect(homeFromDshConfigDir('/home/test/.dsh')).toBe('/home/test')
  })
})

describe('skillInventory/list — real directories under Tauri', () => {
  it('ensures the aggregation root then projects ~/.dsh/skills', async () => {
    const { calls } = installTauriMock({
      list: {
        [SKILLS_DIR]: [
          { name: 'shell', is_dir: true, size: 0 },
          { name: 'web-search', is_dir: true, size: 0 },
          { name: 'README.md', is_dir: false, size: 120 },
        ],
      },
      read: {
        [`${SKILLS_DIR}/shell/SKILL.md`]: '---\nname: Shell\n描述\n---',
        [`${SKILLS_DIR}/web-search/SKILL.md`]: '---\nname: Web Search\ndescription: 联网搜索并返回结构化证据\n---',
      },
    })
    const { rpc } = createFixtureFaces()
    const entries = await skillList(rpc)
    // The browser first ensures the aggregation root (+ agent links), then
    // reads ONLY the ABSOLUTE ~/.dsh/skills path (derived from dsh_config_dir)
    // — never the relative `skills` that canonicalizes against the (unset)
    // process CWD and fails the Rust fs allowlist, and never a separate
    // ~/.agents/skills read (agent skills are linked into ~/.dsh/skills).
    expect(calls).toContainEqual({ cmd: 'skill_roots_ensure' })
    expect(calls).toContainEqual({ cmd: 'fs_list', args: { dir: SKILLS_DIR } })
    expect(calls).not.toContainEqual({ cmd: 'fs_list', args: { dir: 'skills' } })
    expect(calls).not.toContainEqual({ cmd: 'fs_list', args: { dir: AGENTS_DIR } })
    expect(entries.map(e => e.entryId)).toEqual(['shell', 'web-search'])
    expect(entries[0]).toMatchObject({
      entryId: 'shell',
      name: 'Shell',
      source: 'user-dsh',
      provider: 'dsh',
      modelInvocable: true,
      userInvocable: true,
      enabled: true,
    })
  })

  it('falls back to frontmatter name and skips files (non-directories)', async () => {
    installTauriMock({
      list: {
        [SKILLS_DIR]: [
          { name: 'no-frontmatter', is_dir: true, size: 0 },
          { name: 'NOT-A-DIR.md', is_dir: false, size: 10 },
        ],
      },
      read: {
        [`${SKILLS_DIR}/no-frontmatter/SKILL.md`]: '# Just a body',
      },
    })
    const { rpc } = createFixtureFaces()
    const entries = await skillList(rpc)
    expect(entries).toEqual([
      {
        entryId: 'no-frontmatter',
        name: 'no-frontmatter',
        description: '',
        source: 'user-dsh',
        provider: 'dsh',
        modelInvocable: true,
        userInvocable: true,
        enabled: true,
      },
    ])
  })

  it('overlays the persisted enabled map from settings_get(skill-inventory)', async () => {
    installTauriMock({
      list: {
        [SKILLS_DIR]: [
          { name: 'shell', is_dir: true, size: 0 },
          { name: 'web-search', is_dir: true, size: 0 },
        ],
      },
      read: {
        [`${SKILLS_DIR}/shell/SKILL.md`]: '---\nname: Shell\n---',
        [`${SKILLS_DIR}/web-search/SKILL.md`]: '---\nname: Web Search\n---',
      },
      settingsGet: {
        'skill-inventory': { enabled: { shell: false } },
      },
    })
    const { rpc } = createFixtureFaces()
    const entries = await skillList(rpc)
    const shell = entries.find(e => e.entryId === 'shell')
    const web = entries.find(e => e.entryId === 'web-search')
    expect(shell?.enabled).toBe(false)
    expect(web?.enabled).toBe(true)
  })

  it('falls back to the hardcoded fixture list without a Tauri bridge', async () => {
    const { rpc } = createFixtureFaces()
    const entries = await skillList(rpc)
    expect(entries.map(e => e.entryId)).toEqual(['shell', 'web-search', 'agent-loop'])
    expect(entries[0]?.source).toBe('builtin')
  })

  it('degrades to the curated defaults when the real root is unreadable and no toggles are persisted', async () => {
    installTauriMock({
      listErrors: [SKILLS_DIR],
    })
    const { rpc } = createFixtureFaces()
    const entries = await skillList(rpc)
    expect(entries.map(e => e.entryId)).toEqual(['shell', 'web-search', 'agent-loop'])
    expect(entries[0]?.source).toBe('builtin')
  })

  it('keeps the empty real list when the user has persisted toggles (no default fallback)', async () => {
    installTauriMock({
      listErrors: [SKILLS_DIR],
      settingsGet: { 'skill-inventory': { enabled: { shell: false } } },
    })
    const { rpc } = createFixtureFaces()
    const entries = await skillList(rpc)
    expect(entries).toEqual([])
  })
})

describe('skillInventory/setEnabled — persistence', () => {
  it('persists the enabled map through settings_update(skill-inventory)', async () => {
    const settingsUpdate: Array<{ key: string; value: unknown }> = []
    installTauriMock({ settingsUpdate })
    const { rpc } = createFixtureFaces()
    await skillSetEnabled(rpc, 'shell', false)
    await skillSetEnabled(rpc, 'web-search', true)
    const last = settingsUpdate.at(-1)
    expect(last?.key).toBe('skill-inventory')
    expect(last?.value).toEqual({ enabled: { shell: false, 'web-search': true } })
  })

  it('re-applies the persisted toggle on a subsequent list', async () => {
    const settingsUpdate: Array<{ key: string; value: unknown }> = []
    installTauriMock({
      list: {
        [SKILLS_DIR]: [{ name: 'shell', is_dir: true, size: 0 }],
      },
      read: {
        [`${SKILLS_DIR}/shell/SKILL.md`]: '---\nname: Shell\n---',
      },
      settingsUpdate,
    })
    const { rpc } = createFixtureFaces()
    await skillSetEnabled(rpc, 'shell', false)
    const entries = await skillList(rpc)
    expect(entries[0]?.enabled).toBe(false)
    expect(settingsUpdate).toContainEqual({
      key: 'skill-inventory',
      value: { enabled: { shell: false } },
    })
  })
})
