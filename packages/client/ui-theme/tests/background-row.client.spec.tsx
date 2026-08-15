// @vitest-environment jsdom
/** BackgroundRow behavior: the URL input writes the background, a local file
 * upload reads to a data URL via FileReader and captures the file name, the
 * clear button resets, the preview minimap drag-selects a crop region stored
 * as fractions, and the clear-crop affordance resets it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { BackgroundRow, normalizeCropBox, pointToFraction } from '../src/client/BackgroundRow.tsx'
import type { BackgroundRowComponentProps } from '../src/client/BackgroundRow.tsx'
import type { BackgroundCrop } from '../src/theme-settings.ts'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

beforeEach(() => {
  // jsdom lacks pointer capture; stub it so the crop drag handlers can run.
  Element.prototype.setPointerCapture = vi.fn()
})

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
  'background.fileName': 'File name',
  'background.cropLabel': 'Drag to crop region',
  'background.clearCrop': 'Clear crop',
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

function mount(background = '', backgroundName = '', backgroundCrop: BackgroundCrop | null = null) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync('system', 'default', background, backgroundName, backgroundCrop, 0)
  const setBackground = vi.fn()
  const setBackgroundName = vi.fn()
  const setBackgroundCrop = vi.fn()
  const props: BackgroundRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setBackground,
    setBackgroundName,
    setBackgroundCrop,
  }
  const view = render(<BackgroundRow {...props} />)
  return { store, setBackground, setBackgroundName, setBackgroundCrop, ...view }
}

const urlInput = (): HTMLInputElement => screen.getByLabelText('Image URL') as HTMLInputElement

/** The crop minimap region, mocked to a 200x100 box for deterministic drags. */
function cropArea(): HTMLElement {
  const area = screen.getByLabelText('Drag to crop region')
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100,
    toJSON: () => ({}),
  })
  return area
}

describe('BackgroundRow', () => {
  it('renders the title, upload trigger, and URL input without a clear button when empty', () => {
    mount('')
    expect(screen.getByText('Background image')).toBeDefined()
    expect(screen.getByLabelText('Upload image')).toBeDefined()
    expect(urlInput()).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    expect(screen.queryByLabelText('Drag to crop region')).toBeNull()
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

  it('the clear button also resets the file name and crop', () => {
    const b = mount('data:image/png;base64,AAAA', 'bg.png', { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(b.setBackground).toHaveBeenCalledWith('')
    expect(b.setBackgroundName).toHaveBeenCalledWith('')
    expect(b.setBackgroundCrop).toHaveBeenCalledWith(null)
  })

  it('entering a remote URL resets the file name and crop', () => {
    const b = mount('data:image/png;base64,AAAA', 'bg.png', { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    fireEvent.change(urlInput(), { target: { value: 'https://example.com/bg.png' } })
    expect(b.setBackground).toHaveBeenCalledWith('https://example.com/bg.png')
    expect(b.setBackgroundName).toHaveBeenCalledWith('')
    expect(b.setBackgroundCrop).toHaveBeenCalledWith(null)
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
    expect(b.setBackgroundName).not.toHaveBeenCalled()
  })

  it('reads a local file to a data URL through FileReader and captures the file name', () => {
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
    expect(b.setBackgroundName).toHaveBeenCalledWith('bg.png')
  })

  it('uploading a local file resets the crop', () => {
    class MockFileReader {
      result: string | null = null
      onload: (() => void) | null = null
      readAsDataURL(_file: Blob): void {
        this.result = 'data:image/png;base64,AAAA'
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', MockFileReader)

    const b = mount('data:image/png;base64,AAAA', 'old.png', { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    const file = new File(['image-bytes'], 'bg.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [file] } })
    expect(b.setBackgroundCrop).toHaveBeenCalledWith(null)
  })

  it('shows the local file name when one is stored', () => {
    mount('data:image/png;base64,AAAA', 'bg.png')
    expect(screen.getByText('File name')).toBeDefined()
    expect(screen.getByText('bg.png')).toBeDefined()
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

  it('drag on the preview commits a crop region as fractions', () => {
    const b = mount('https://example.com/bg.png')
    const area = cropArea()
    fireEvent.pointerDown(area, { button: 0, clientX: 50, clientY: 25, pointerId: 1 })
    fireEvent.pointerMove(area, { clientX: 150, clientY: 75, pointerId: 1 })
    fireEvent.pointerUp(area, { clientX: 150, clientY: 75, pointerId: 1 })
    expect(b.setBackgroundCrop).toHaveBeenCalledWith({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })

  it('a tiny drag clears the crop', () => {
    const b = mount('https://example.com/bg.png', '', { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    const area = cropArea()
    fireEvent.pointerDown(area, { button: 0, clientX: 50, clientY: 25, pointerId: 1 })
    fireEvent.pointerMove(area, { clientX: 50, clientY: 25, pointerId: 1 })
    fireEvent.pointerUp(area, { clientX: 50, clientY: 25, pointerId: 1 })
    expect(b.setBackgroundCrop).toHaveBeenCalledWith(null)
  })

  it('the clear-crop button resets a stored crop', () => {
    const b = mount('https://example.com/bg.png', '', { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    fireEvent.click(screen.getByRole('button', { name: 'Clear crop' }))
    expect(b.setBackgroundCrop).toHaveBeenCalledWith(null)
  })

  it('shows no clear-crop button when no crop is stored', () => {
    mount('https://example.com/bg.png')
    expect(screen.queryByRole('button', { name: 'Clear crop' })).toBeNull()
  })
})

describe('crop helpers', () => {
  it('pointToFraction maps client coordinates to clamped fractions', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 }
    expect(pointToFraction({ clientX: 60, clientY: 70 }, rect)).toEqual({ x: 0.25, y: 0.5 })
    // Out-of-bounds coordinates clamp into [0, 1].
    expect(pointToFraction({ clientX: -10, clientY: 9999 }, rect)).toEqual({ x: 0, y: 1 })
  })

  it('normalizeCropBox returns a top-left-origin box regardless of drag direction', () => {
    expect(normalizeCropBox({ x: 0.75, y: 0.75 }, { x: 0.25, y: 0.25 })).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    expect(normalizeCropBox({ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 })).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })
})
