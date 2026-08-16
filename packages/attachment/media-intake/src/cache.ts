/** Content-addressed extracted-text cache with bounded LRU + TTL eviction. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Default maximum aggregate cached bytes before eviction (50 MiB). */
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024
/** Default maximum cached entries before eviction. */
export const DEFAULT_MAX_CACHE_ENTRIES = 5000
/** Default entry lifetime before it is treated as expired (30 days). */
export const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const KEY_PATTERN = /^[a-f0-9]{64}$/

export interface ContentTextCacheOptions {
  /** Absolute root; entries live under `root/objects/<prefix>/<key>`. */
  root: string
  maxBytes?: number
  maxEntries?: number
  ttlMs?: number
}

interface Entry { path: string; mtimeMs: number; size: number }

/** SHA-256 hex digest of immutable bytes — the content-addressed cache key. */
export function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * A durable, bounded cache of extracted text keyed by the SHA-256 of the source
 * bytes. Reads are content-addressed (no metadata), writes are atomic (temp +
 * rename), and growth is bounded by a lazy least-recently-used sweep plus a
 * time-to-live so an unbounded attachment history cannot exhaust disk.
 */
export class ContentTextCache {
  readonly root: string
  readonly maxBytes: number
  readonly maxEntries: number
  readonly ttlMs: number
  private bytes = 0
  private entries = 0

  constructor(options: ContentTextCacheOptions) {
    this.root = options.root
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS
  }

  private path(key: string): string {
    return join(this.root, 'objects', key.slice(0, 2), key)
  }

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new Error(`content-cache: invalid key "${key}"`)
  }

  async get(key: string): Promise<string | undefined> {
    this.assertKey(key)
    const target = this.path(key)
    let info
    try {
      info = await stat(target)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    if (Date.now() - info.mtimeMs > this.ttlMs) {
      await rm(target, { force: true })
      this.entries = Math.max(0, this.entries - 1)
      this.bytes = Math.max(0, this.bytes - info.size)
      return undefined
    }
    // Touch access time so the sweep evicts least-recently-used first.
    const now = new Date()
    await utimes(target, now, now)
    return readFile(target, 'utf8')
  }

  async set(key: string, value: string): Promise<void> {
    this.assertKey(key)
    const target = this.path(key)
    const bucket = dirname(target)
    const staging = join(this.root, 'tmp')
    await mkdir(bucket, { recursive: true, mode: 0o700 })
    await mkdir(staging, { recursive: true, mode: 0o700 })
    const temporary = join(staging, randomUUID())
    await writeFile(temporary, value, { mode: 0o600 })
    await rename(temporary, target)
    this.bytes += Buffer.byteLength(value, 'utf8')
    this.entries += 1
    await this.sweepIfNeeded()
  }

  private async sweepIfNeeded(): Promise<void> {
    if (this.entries <= this.maxEntries && this.bytes <= this.maxBytes) return
    const entries = await this.listEntries()
    // Evict oldest-first until within both budgets. TTL-expired entries are
    // dropped regardless of budget so dead entries never pin live ones.
    let bytes = 0
    const survivors: Entry[] = []
    for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (Date.now() - entry.mtimeMs > this.ttlMs) {
        await rm(entry.path, { force: true })
        continue
      }
      survivors.push(entry)
      bytes += entry.size
    }
    let index = 0
    while ((survivors.length - index) > this.maxEntries || bytes > this.maxBytes) {
      const entry = survivors[index]
      /* v8 ignore next -- the loop condition guarantees an index within bounds. */
      if (entry === undefined) break
      bytes -= entry.size
      await rm(entry.path, { force: true })
      index += 1
    }
    this.bytes = bytes
    this.entries = survivors.length - index
  }

  private async listEntries(): Promise<Entry[]> {
    const entries: Entry[] = []
    const prefixes = await readdir(join(this.root, 'objects')).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [] as string[]
      throw error
    })
    for (const prefix of prefixes) {
      const keys = await readdir(join(this.root, 'objects', prefix))
      for (const key of keys) {
        const target = join(this.root, 'objects', prefix, key)
        const info = await stat(target)
        entries.push({ path: target, mtimeMs: info.mtimeMs, size: info.size })
      }
    }
    return entries
  }
}
