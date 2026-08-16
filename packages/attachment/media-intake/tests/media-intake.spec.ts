// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentTextCache, digest } from '../src/cache.ts'
import { convertWithAnydoc } from '../src/files.ts'
import { recognizeWithLightOcr } from '../src/ocr.ts'

vi.mock('@arcships/light-ocr', () => ({
  createEngine: vi.fn(async () => ({
    recognizeEncoded: vi.fn(async () => ({
      lines: [
        { text: 'hello', confidence: 0.9, box: null },
        { text: 'world', confidence: 0.8, box: null },
      ],
    })),
    close: vi.fn(async () => {}),
  })),
}))

vi.mock('@firecrawl/anydoc', () => ({
  toMarkdownBytes: vi.fn(async (_bytes: Uint8Array, format: string) => `# doc (${format})`),
  formatFromBytes: vi.fn(() => 'docx'),
  formatFromExtension: vi.fn((ext: string) => (ext === '.csv' ? 'csv' : null)),
}))

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const key = (n: number) => digest(new Uint8Array([n]))

describe('ContentTextCache', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  async function cache(overrides: Omit<ConstructorParameters<typeof ContentTextCache>[0], 'root'> = {}): Promise<ContentTextCache> {
    dir = await mkdtemp(join(tmpdir(), 'media-intake-'))
    return new ContentTextCache({ root: dir, ...overrides })
  }

  it('round-trips text by content hash', async () => {
    const c = await cache()
    await c.set(key(1), 'hello')
    expect(await c.get(key(1))).toBe('hello')
    expect(await c.get(key(2))).toBeUndefined()
  })

  it('expires entries past the ttl', async () => {
    const c = await cache({ ttlMs: 25 })
    await c.set(key(1), 'hello')
    expect(await c.get(key(1))).toBe('hello')
    await sleep(40)
    expect(await c.get(key(1))).toBeUndefined()
  })

  it('evicts least-recently-used beyond maxEntries', async () => {
    const c = await cache({ maxEntries: 2 })
    await c.set(key(1), 'one')
    await sleep(5)
    await c.set(key(2), 'two')
    await sleep(5)
    await c.set(key(3), 'three')
    expect(await c.get(key(1))).toBeUndefined()
    expect(await c.get(key(2))).toBe('two')
    expect(await c.get(key(3))).toBe('three')
  })
})

describe('recognizeWithLightOcr', () => {
  it('joins recognized lines', async () => {
    expect(await recognizeWithLightOcr(new Uint8Array([1]))).toBe('hello\nworld')
  })
})

describe('convertWithAnydoc', () => {
  it('converts detected bytes to markdown', async () => {
    expect(await convertWithAnydoc(new Uint8Array([1]))).toBe('# doc (docx)')
  })

  it('returns null for an unrecognized format', async () => {
    const anydoc = await import('@firecrawl/anydoc')
    vi.mocked(anydoc.formatFromBytes).mockReturnValueOnce(null)
    expect(await convertWithAnydoc(new Uint8Array([1]))).toBeNull()
  })
})
