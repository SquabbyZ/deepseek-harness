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
