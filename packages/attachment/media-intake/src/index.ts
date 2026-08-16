/**
 * Media intake for text-only models: image OCR and document-to-markdown.
 *
 * DeepSeek chat completions accept text only, so an uploaded image or office
 * document must be reduced to text before it can reach the model. This service
 * owns that reduction: light-ocr (PP-OCRv6) recognizes raster text, and anydoc
 * (Rust) converts office/ebook documents to GitHub-flavored markdown. Both are
 * cached behind a bounded, content-addressed store (SHA-256 keyed, LRU + TTL,
 * atomic writes) so a repeated upload costs one digest lookup, not a re-OCR.
 *
 * @module @deepseek-ai/dsh-media-intake
 */

import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { convertWithAnydoc } from './files.ts'
import {
  ContentTextCache,
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_CACHE_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  digest,
} from './cache.ts'
import { recognizeWithLightOcr } from './ocr.ts'

export {
  ContentTextCache,
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_CACHE_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  digest,
} from './cache.ts'

/** Media intake configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Enable image OCR for text-only models. */
  ocrEnabled?: boolean
  /** Enable document-to-markdown conversion for text-only models. */
  fileEnabled?: boolean
  /** Maximum aggregate cached bytes before eviction. */
  cacheMaxBytes?: number
  /** Maximum cached entries before eviction. */
  cacheMaxEntries?: number
  /** Cached entry lifetime before it is treated as expired. */
  cacheTtlMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mediaIntake: MediaIntake
  }
}

/** Image OCR + document-to-markdown intake with a bounded content-addressed cache. */
export class MediaIntake extends Service {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    ocrEnabled: z.boolean().default(true),
    fileEnabled: z.boolean().default(true),
    cacheMaxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_CACHE_BYTES),
    cacheMaxEntries: z.number().step(1).min(1).default(DEFAULT_MAX_CACHE_ENTRIES),
    cacheTtlMs: z.number().step(1).min(1).default(DEFAULT_CACHE_TTL_MS),
  })

  readonly cache: ContentTextCache
  private readonly ocrEnabled: boolean
  private readonly fileEnabled: boolean
  private readonly inflight = new Map<string, Promise<string>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mediaIntake')
    this.ocrEnabled = config.ocrEnabled ?? true
    this.fileEnabled = config.fileEnabled ?? true
    this.cache = new ContentTextCache({
      root: resolve(join(resolveDshHome(config.dshHome), 'media-intake', 'v1')),
      maxBytes: config.cacheMaxBytes ?? DEFAULT_MAX_CACHE_BYTES,
      maxEntries: config.cacheMaxEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
      ttlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    })
  }

  /**
   * Extract text from one image via OCR, cached by content hash.
   * @param bytes - encoded image bytes.
   * @returns recognized text (possibly empty).
   */
  async recognizeImage(bytes: Uint8Array): Promise<string> {
    if (!this.ocrEnabled) throw new AttachmentError('Image text extraction is disabled.', 'OCR_DISABLED')
    try {
      return await this.cached(bytes, () => recognizeWithLightOcr(bytes))
    } catch (error) {
      if (error instanceof AttachmentError) throw error
      throw new AttachmentError('Image text extraction failed.', 'OCR_FAILED', { cause: error })
    }
  }

  /**
   * Convert one document to markdown, cached by content hash.
   * @param bytes - encoded document bytes.
   * @param name - optional original filename, used only to disambiguate signature-less formats.
   * @returns markdown, or `null` when the format is unrecognized.
   */
  async convertFile(bytes: Uint8Array, name?: string): Promise<string | null> {
    if (!this.fileEnabled) throw new AttachmentError('Document conversion is disabled.', 'FILE_CONVERSION_DISABLED')
    try {
      const key = digest(bytes)
      const cached = await this.cache.get(key)
      if (cached !== undefined) return cached
      const markdown = await convertWithAnydoc(bytes, name)
      if (markdown === null) return null
      await this.cache.set(key, markdown)
      return markdown
    } catch (error) {
      if (error instanceof AttachmentError) throw error
      throw new AttachmentError('Document conversion failed.', 'FILE_CONVERSION_FAILED', { cause: error })
    }
  }

  /** Dedup concurrent requests for the same content hash into one production. */
  private async cached(bytes: Uint8Array, produce: () => Promise<string>): Promise<string> {
    const key = digest(bytes)
    const cached = await this.cache.get(key)
    if (cached !== undefined) return cached
    const existing = this.inflight.get(key)
    if (existing !== undefined) return existing
    const task = produce()
      .then(async (text) => {
        await this.cache.set(key, text)
        return text
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, task)
    return task
  }
}

export default MediaIntake
