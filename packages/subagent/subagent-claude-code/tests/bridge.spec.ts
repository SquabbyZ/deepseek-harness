/**
 * Integration smoke test for `@deepseek-ai/dsh-subagent-claude-code`'s
 * platform detection bridge.
 *
 * Phase 2 of the refactor forbids `node:process.platform` in client-facing
 * packages — Claude Code's argv selection moved into
 * {@link detectHostPlatform}, which sniffs `navigator.userAgent`. This file
 * pins that WebView2-safe mapping by stubbing the UA the package reads
 * (per the documented contract: no third-party module is mocked).
 *
 * The fallback — when no UA is available — returns `linux` (a POSIX shell)
 * to keep `claudeSpawnSpec` correct on hosts the package does not yet
 * recognise.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { detectHostPlatform } = await import('../src/bridge.ts')

let originalDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
})

afterEach(() => {
  if (originalDescriptor === undefined) {
    delete (globalThis as { navigator?: unknown }).navigator
  } else {
    Object.defineProperty(globalThis, 'navigator', originalDescriptor)
  }
})

function setUserAgent(ua: string | undefined): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua },
    writable: true,
    configurable: true,
  })
}

describe('subagent-claude-code platform bridge', () => {
  it('maps a Windows-style UA to the "win32" Claude Code platform', async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) like Gecko')
    await expect(detectHostPlatform()).resolves.toBe('win32')
  })

  it('maps a macOS-style UA to the "darwin" Claude Code platform', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) like Gecko')
    await expect(detectHostPlatform()).resolves.toBe('darwin')
  })

  it('maps a Linux-style UA to the "linux" Claude Code platform', async () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) like Gecko')
    await expect(detectHostPlatform()).resolves.toBe('linux')
  })

  it('falls back to "linux" when no UA hint is available', async () => {
    setUserAgent(undefined)
    await expect(detectHostPlatform()).resolves.toBe('linux')
  })
})
