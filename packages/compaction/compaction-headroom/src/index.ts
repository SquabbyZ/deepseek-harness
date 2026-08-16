/**
 * Semantic, LLM-backed tool-result compression through the Headroom proxy.
 *
 * @module @deepseek-ai/dsh-compaction-headroom
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { CallId, ContentBlock, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: the `compaction/*` SessionEventMap merges (the shadow-price event).
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@deepseek-ai/dsh-token-meter'
import { compress as headroomCompress } from 'headroom-ai'
import type {
  CompressOptions as HeadroomCompressOptions,
  CompressResult as HeadroomCompressResult,
} from 'headroom-ai'
import { codePointLength, resolveConfig } from './config.ts'
import type {
  CompressedEntry,
  CompressResult,
  HeadroomCompressConfig,
  ResolvedConfig,
} from './types.ts'

export { codePointLength, DEFAULTS, resolveConfig } from './config.ts'
export type {
  CompressedEntry,
  CompressResult,
  HeadroomCompressConfig,
  ResolvedConfig,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    headroomCompressor: HeadroomCompressor
  }
}

/** Settings namespace owning the live semantic-compression policy. */
const NS = settingsNamespace('headroom')

interface SnapshotCandidate {
  readonly seq: number
  readonly event: SessionEvent<'tool/result'>
}

/** One OpenAI-shaped tool message carrying a single result's text to the proxy. */
function toolMessage(
  text: string,
  callId: CallId,
): { role: 'tool'; content: string; tool_call_id: string } {
  return { role: 'tool', content: text, tool_call_id: callId }
}

/** Resolve the routed model name for headroom's token-counting hint. */
function routedModel(session: Session): string | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.model.length === 0) return undefined
  return config.model
}

/** Semantic, LLM-backed tool-result compression service. */
export class HeadroomCompressor extends Service {
  // `llm` is declared so semantic compression only composes where an LLM seam
  // exists; the compression itself routes through the Headroom proxy, and the
  // token meter prices each shadowed node for its logged shadow-price event.
  static inject = ['llm', 'tokenMeter']

  static Config: z<HeadroomCompressConfig> = z.object({
    enabled: z.boolean(),
    thresholdChars: z.number().step(1).min(1),
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
    timeout: z.number().step(1).min(1),
    fallback: z.boolean(),
    tokenBudget: z.number().step(1).min(1),
  })

  /** Resolved and validated compression configuration, re-derived on settings changes. */
  config: ResolvedConfig

  constructor(ctx: Context, config: HeadroomCompressConfig = {}) {
    super(ctx, 'headroomCompressor')
    let current: () => HeadroomCompressConfig = () => config
    this.config = resolveConfig(config)
    installSettingsSection(this.ctx, NS, HeadroomCompressor.Config, config, {
      validate: (value) => { void resolveConfig(value) },
      setSource: (source) => { current = source },
      onChange: () => { this.config = resolveConfig(current()) },
    })
  }

  /**
   * Measure text content in Unicode code points; non-text blocks cost zero.
   * @param blocks - tool-result content to measure.
   * @returns total Unicode code points across text blocks.
   */
  measureContent(blocks: readonly ContentBlock[]): number {
    let chars = 0
    for (const block of blocks) {
      if (block.type === 'text') chars += codePointLength(block.text)
    }
    return chars
  }

  /**
   * Join every text block into one proxy input string, preserving block order.
   * @param blocks - tool-result content to serialize.
   * @returns the concatenated text, or the empty string for text-free content.
   */
  private joinText(blocks: readonly ContentBlock[]): string {
    const parts: string[] = []
    for (const block of blocks) {
      if (block.type === 'text') parts.push(block.text)
    }
    return parts.join('\n\n')
  }

  /**
   * Build the proxy options for one compression call, omitting unset fields so
   * headroom's own environment-variable fallbacks stay authoritative.
   * @param model - session-routed model used when the configured model is empty.
   * @returns the complete options object.
   */
  private headroomOptions(model: string | undefined): HeadroomCompressOptions {
    const config = this.config
    const resolvedModel = config.model.length > 0 ? config.model : model
    return {
      ...resolvedModel === undefined ? {} : { model: resolvedModel },
      ...config.baseUrl.length === 0 ? {} : { baseUrl: config.baseUrl },
      ...config.apiKey.length === 0 ? {} : { apiKey: config.apiKey },
      timeout: config.timeout,
      fallback: config.fallback,
      ...config.tokenBudget === undefined ? {} : { tokenBudget: config.tokenBudget },
    }
  }

  /**
   * Compress one text string through the Headroom proxy.
   * @param text - text to compress.
   * @param callId - tool call correlating the input tool message.
   * @param model - routed model hint for token counting.
   * @returns the compressed text, or `null` when the proxy declined or fell back.
   */
  private async compressText(
    text: string,
    callId: CallId,
    model: string | undefined,
  ): Promise<string | null> {
    const result: HeadroomCompressResult = await headroomCompress(
      [toolMessage(text, callId)],
      this.headroomOptions(model),
    )
    // A `compressed: false` result is the fallback path: the proxy was
    // unreachable and returned the input unchanged.
    if (!result.compressed) return null
    const first = result.messages[0] as { content?: unknown } | undefined
    const content: unknown = first?.content
    if (typeof content !== 'string' || content.length === 0) return null
    return content
  }

  /**
   * Semantically compress an over-budget tool-result content, or leave it be.
   * A compression that does not shrink the text is refused so a later pass
   * cannot rewrite the same node forever.
   * @param blocks - original tool-result content.
   * @param callId - tool call shared by the input and the proxy message.
   * @param model - routed model hint for token counting.
   * @returns compressed content, or `null` when within budget or unshrinkable.
   */
  private async compressContent(
    blocks: readonly ContentBlock[],
    callId: CallId,
    model: string | undefined,
  ): Promise<ContentBlock[] | null> {
    const totalChars = this.measureContent(blocks)
    if (totalChars <= this.config.thresholdChars) return null

    const text = this.joinText(blocks)
    const compressedText = await this.compressText(text, callId, model)
    if (compressedText === null) return null
    if (compressedText === text || codePointLength(compressedText) >= totalChars) return null

    // Collapse every text block into one compressed text block at the first
    // text position; non-text blocks keep their original relative order.
    const result: ContentBlock[] = []
    let placed = false
    for (const block of blocks) {
      if (block.type !== 'text') {
        result.push(block)
        continue
      }
      if (placed) continue
      result.push({ type: 'text', text: compressedText })
      placed = true
    }
    return result
  }

  /**
   * Compress every over-budget tool result from one stable current-surface
   * snapshot through the Headroom proxy. Each replacement preserves the
   * complete event data except for `content`, cites the shadowed node so replay
   * can recover the replacement input, and is immediately preceded by a
   * `compaction/prune` shadow-price event pricing the shadowed node through the
   * injected token meter, so pure consumers can subtract it without per-node
   * state.
   * @param session - session whose current surface is rewritten.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   */
  async compressSession(session: Session): Promise<CompressResult> {
    if (!this.config.enabled) return { compressed: [], charsRemoved: 0 }
    const model = routedModel(session)

    const candidates: SnapshotCandidate[] = []
    for (const seq of [...session.surface.nodes]) {
      const event = session.events[seq]
      /* v8 ignore next -- surface seqs are validated contiguous log references. */
      if (event?.type === 'tool/result') candidates.push({ seq, event })
    }

    const compressed: CompressedEntry[] = []
    let charsRemoved = 0
    for (const { seq, event } of candidates) {
      const result = event.data.message.content[0]
      const content = await this.compressContent(
        result.content,
        event.data.message.source.callId,
        model,
      )
      if (content === null) continue
      const charsBefore = this.measureContent(result.content)
      const charsAfter = this.measureContent(content)
      const message = freezeMessage<ToolResultMessage>({
        ...event.data.message,
        content: [{
          ...result,
          content,
        }] as [typeof result],
      })
      // Shadow-price protocol: the metering event and its replacement are
      // appended synchronously adjacent, so pure consumers subtract the
      // shadowed node's heuristic price without retaining per-node state.
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(event.data.message),
      })
      const replacement = session.append('tool/result', {
        ...event.data,
        message,
      }, {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      compressed.push({
        originalSeq: seq,
        replacementSeq: replacement.seq,
        callId: event.data.message.source.callId,
        charsBefore,
        charsAfter,
      })
      charsRemoved += charsBefore - charsAfter
    }
    return { compressed, charsRemoved }
  }
}

export default HeadroomCompressor
