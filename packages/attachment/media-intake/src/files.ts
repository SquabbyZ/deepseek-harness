/** Anydoc wrapper: document bytes to GitHub-flavored markdown. */

import { extname } from 'node:path'

/**
 * Convert one document to markdown, detecting the format from its bytes with
 * the filename extension as a fallback for signature-less formats (CSV).
 * @param bytes - encoded document bytes.
 * @param name - optional original filename, used only for the extension fallback.
 * @returns markdown, or `null` when the format cannot be recognized.
 */
export async function convertWithAnydoc(bytes: Uint8Array, name?: string): Promise<string | null> {
  const { toMarkdownBytes, formatFromBytes, formatFromExtension } = await import('@firecrawl/anydoc')
  let format = formatFromBytes(bytes)
  if (format === null && name !== undefined) {
    const ext = extname(name).toLowerCase()
    if (ext.length > 1) format = formatFromExtension(ext)
  }
  if (format === null) return null
  return toMarkdownBytes(bytes, format)
}
