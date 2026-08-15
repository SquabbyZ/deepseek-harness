// @vitest-environment jsdom
/** BackgroundRow behavior: the URL input writes the background, a local file
 * upload reads to a data URL via FileReader, and the clear button resets. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { BackgroundRow } from '../src/client/BackgroundRow.tsx'
import type { BackgroundRowComponentProps } from '../src/client/BackgroundRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const COPY: Record<string, string> = {
  'background.title': 'Background image',
  'background.upload': 'Upload image',
  'background.url': 'Image URL',
  'background.urlPlaceholder': 'https://example.com/image.png',
  'background.clear': 'Clear',
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

function mount(background = '') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync('system', 'default', background, 0)
  const setBackground = vi.fn()
  const props: BackgroundRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setBackground,
  }
  render(<BackgroundRow {...props} />)
  return { store, setBackground }
}

const urlInput = (): HTMLInputElement => screen.getByLabelText('Image URL') as HTMLInputElement

describe('BackgroundRow', () => {
  it('renders the title, upload trigger, and URL input without a clear button when empty', () => {
    mount('')
    expect(screen.getByText('Background image')).toBeDefined()
    expect(screen.getByLabelText('Upload image')).toBeDefined()
    expect(urlInput()).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('writes the URL input value through setBackground', () => {
    const b = mount('')
    fireEvent.change(urlInput(), { target: { value: 'https://example.com/bg.png' } })
    expect(b.setBackground).toHaveBeenCalledWith('https://example.com/bg.png')
  })

  it('echoes a remote URL and clears through the clear button', () => {
    const b = mount('https://example.com/bg.png')
    expect(urlInput().value).toBe('https://example.com/bg.png')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(b.setBackground).toHaveBeenCalledWith('')
  })

  it('hides a data URL from the URL input and offers a clear button', () => {
    mount('data:image/png;base64,AAAA')
    expect(urlInput().value).toBe('')
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDefined()
  })

  it('ignores an empty file selection', () => {
    const b = mount('')
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [] } })
    expect(b.setBackground).not.toHaveBeenCalled()
  })

  it('reads a local file to a data URL through FileReader', () => {
    class MockFileReader {
      result: string | null = null
      onload: (() => void) | null = null
      readAsDataURL(_file: Blob): void {
        this.result = 'data:image/png;base64,AAAA'
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', MockFileReader)

    const b = mount('')
    const file = new File(['image-bytes'], 'bg.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [file] } })
    expect(b.setBackground).toHaveBeenCalledWith('data:image/png;base64,AAAA')
  })

  it('drops a non-string FileReader result', () => {
    class ArrayBufferReader {
      result: string | ArrayBuffer | null = null
      onload: (() => void) | null = null
      readAsDataURL(_file: Blob): void {
        this.result = new ArrayBuffer(4)
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', ArrayBufferReader)

    const b = mount('')
    const file = new File(['image-bytes'], 'bg.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [file] } })
    expect(b.setBackground).not.toHaveBeenCalled()
  })
})
