// @vitest-environment jsdom
/** SkinRow behavior: three cubes, selection follows the persisted skin id,
 * clicks drive setSkin. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { SkinRow } from '../src/client/SkinRow.tsx'
import type { SkinRowComponentProps } from '../src/client/SkinRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { SkinId } from '../src/client/index.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'skin.title': 'Skin',
  'skin.default': 'Default',
  'skin.glass': 'Glass',
  'skin.cyber': 'Cyber',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(skin: SkinId = 'default') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync('system', skin, '', '', null, 0)
  const setSkin = vi.fn()
  const props: SkinRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setSkin,
  }
  render(<SkinRow {...props} />)
  return { store, setSkin }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('SkinRow', () => {
  it('renders the title and three cubes with the current skin cube selected', () => {
    mount('glass')
    expect(screen.getByText('Skin')).toBeDefined()
    expect(pressed(/Default/)).toBe('false')
    expect(pressed(/Glass/)).toBe('true')
    expect(pressed(/Cyber/)).toBe('false')
  })

  it('click drives setSkin; selection follows the store mirror, not the click echo', () => {
    const b = mount('glass')
    fireEvent.click(screen.getByRole('button', { name: /Cyber/ }))
    expect(b.setSkin).toHaveBeenCalledWith('cyber')
    // No store write yet: selection is unchanged.
    expect(pressed(/Glass/)).toBe('true')
    act(() => { b.store.actions.sync('system', 'cyber', '', '', null, 1) })
    expect(pressed(/Cyber/)).toBe('true')
    expect(pressed(/Glass/)).toBe('false')
  })
})
