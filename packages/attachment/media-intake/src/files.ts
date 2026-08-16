/** Document intake: anydoc for office/ebook bytes, light-ocr for PDFs. */

import { extname } from 'node:path'
import type { Format } from '@firecrawl/anydoc'
import { recognizePdfWithLightOcr } from './ocr.ts'

/** The converted-content kind: markdown (anydoc) or plain text (OCR). */
export type DocumentFormat = 'markdown' | 'text'

/** One converted document: the text plus the kind the UI should render it as. */
export interface DocumentConversion {
  content: string
  format: DocumentFormat
}

/** Detect the anydoc format, or `null` when unrecognized. */
async function detectAnyDocFormat(bytes: Uint8Array, name?: string): Promise<Format | null> {
  const { formatFromBytes, formatFromExtension } = await import('@firecrawl/anydoc')
  let format = formatFromBytes(bytes)
  if (format === null && name !== undefined) {
    const ext = extname(name).toLowerCase()
    if (ext.length > 1) format = formatFromExtension(ext)
  }
  return format
}

/**
 * Convert one document to text, detecting the format from its bytes with the
 * filename extension as a fallback for signature-less formats (CSV). Office and
 * ebook formats go through anydoc (markdown); PDFs go through OCR, because a
 * PDF whose embedded font lacks a working ToUnicode map garbles text extraction
 * regardless of output encoding, while OCR reads the rendered pixels.
 * @param bytes - encoded document bytes.
 * @param name - optional original filename, used only for the extension fallback.
 * @returns the converted text and its kind, or `null` when the format is unrecognized.
 */
export async function convertDocument(bytes: Uint8Array, name?: string): Promise<DocumentConversion | null> {
  const { toMarkdownBytes } = await import('@firecrawl/anydoc')
  const format = await detectAnyDocFormat(bytes, name)
  if (format === null) return null
  if (format === 'pdf') return { content: await recognizePdfWithLightOcr(bytes), format: 'text' }
  return { content: await toMarkdownBytes(bytes, format), format: 'markdown' }
}

/** Cheap format-kind detection, reused for cache hits without re-converting. */
export async function detectDocumentFormat(bytes: Uint8Array, name?: string): Promise<DocumentFormat | null> {
  const format = await detectAnyDocFormat(bytes, name)
  if (format === null) return null
  return format === 'pdf' ? 'text' : 'markdown'
}
