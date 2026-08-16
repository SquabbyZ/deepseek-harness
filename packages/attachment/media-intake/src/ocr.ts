/** Light-OCR engine wrapper: lazy singleton, decode-only. */

type LightOcrModule = typeof import('@arcships/light-ocr')
type LightOcrEngine = Awaited<ReturnType<LightOcrModule['createEngine']>>

let engineSingleton: LightOcrEngine | undefined

async function engine(): Promise<LightOcrEngine> {
  if (engineSingleton === undefined) {
    const { createEngine } = await import('@arcships/light-ocr')
    engineSingleton = await createEngine()
  }
  return engineSingleton
}

/**
 * Extract text from one encoded image. The engine is initialized once and kept
 * for the process lifetime: model loading dominates one-off recognition, and a
 * text-only-model host expects a long-lived daemon.
 * @param bytes - encoded raster (png/jpeg/webp/gif).
 * @returns recognized lines joined by newline; empty string when nothing was found.
 */
export async function recognizeWithLightOcr(bytes: Uint8Array): Promise<string> {
  const ocr = await engine()
  const result = await ocr.recognizeEncoded(bytes)
  return result.lines
    .map(line => line.text)
    .filter(text => text.length > 0)
    .join('\n')
}

/**
 * OCR a PDF document to plain text by rasterizing each page and recognizing
 * the rendered pixels, so a PDF whose embedded font lacks a working ToUnicode
 * map (which garbles text extraction) still yields clean UTF-8 text.
 * @param bytes - encoded PDF bytes.
 * @returns page text joined by blank lines; empty string when nothing was found.
 */
export async function recognizePdfWithLightOcr(bytes: Uint8Array): Promise<string> {
  const { recognizeDocument } = await import('@arcships/light-ocr')
  const pages: string[] = []
  for await (const page of recognizeDocument(bytes, { dpi: 200 })) {
    const text = page.lines
      .map(line => line.text)
      .filter(text => text.length > 0)
      .join('\n')
    if (text.length > 0) pages.push(text)
  }
  return pages.join('\n\n')
}
