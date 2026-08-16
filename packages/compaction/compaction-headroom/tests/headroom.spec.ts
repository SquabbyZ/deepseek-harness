import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { compress } from 'headroom-ai'
import LlmRuntime, { CallId, createMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SurfaceEvent } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import HeadroomCompressor, {
  DEFAULTS,
  codePointLength,
  resolveConfig,
} from '@deepseek-ai/dsh-compaction-headroom'
import type { HeadroomCompressConfig } from '@deepseek-ai/dsh-compaction-headroom'

vi.mock('headroom-ai', () => ({
  compress: vi.fn(),
}))

const compressMock = vi.mocked(compress)

const MODEL = 'test-model'
const ENABLED: HeadroomCompressConfig = { enabled: true, thresholdChars: 50 }

/** Pricing oracle mirroring the service's estimator for expectations. */
const METER = new TokenMeter(new Context())

function service(config: HeadroomCompressConfig = ENABLED): HeadroomCompressor {
  const ctx = new Context()
  // Service constructors self-register, so `ctx.tokenMeter` resolves for the
  // shadow-price pricing without a full plugin boot.
  void new LlmRuntime(ctx)
  void new TokenMeter(ctx)
  return new HeadroomCompressor(ctx, config)
}

/** Default proxy stub: a short deterministic compressed string. */
function stubCompressed(input: string): string {
  return `compressed:${input.slice(0, 12)}`
}

beforeEach(() => {
  compressMock.mockReset()
  compressMock.mockImplementation(async (messages) => {
    const head = messages[0] as { role: string; content: string; tool_call_id: string }
    const content = stubCompressed(head.content)
    return {
      messages: [{ role: 'tool', content, tool_call_id: head.tool_call_id }],
      tokensBefore: 100,
      tokensAfter: 10,
      tokensSaved: 90,
      compressionRatio: 0.1,
      transformsApplied: ['test-transform'],
      ccrHashes: [],
      compressed: true,
    }
  })
})

function appendToolStep(
  session: Session,
  turn: number,
  call: string,
  content: ContentBlock[],
  extra: Record<string, unknown> = {},
): number {
  const callId = CallId(call)
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
      source: {
        kind: 'model',
        ...{ provider: MODEL, model: MODEL },
      },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn, step: 1, callId, name: 'bash', arguments: '{}' })
  const result = session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({ callId, content, isError: false }),
    ...extra,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return result.seq
}

describe('headroom compression configuration', () => {
  it('resolves detached immutable defaults and partial overrides', () => {
    const raw: HeadroomCompressConfig = { enabled: true, thresholdChars: 100, timeout: 9000 }
    const resolved = resolveConfig(raw)
    raw.thresholdChars = 1
    expect(resolved).toEqual({
      enabled: true,
      thresholdChars: 100,
      model: '',
      baseUrl: '',
      apiKey: '',
      timeout: 9000,
      fallback: true,
    })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(DEFAULTS).toEqual({
      enabled: false,
      thresholdChars: 8192,
      model: '',
      baseUrl: '',
      apiKey: '',
      timeout: 30000,
      fallback: true,
    })
  })

  it('rejects stale keys and invalid scalars', () => {
    const bad = [
      [{ enabled: 'yes' }, /enabled must be a boolean/],
      [{ thresholdChars: 0 }, /thresholdChars .* positive integer/],
      [{ timeout: -1 }, /timeout .* positive integer/],
      [{ tokenBudget: 1.5 }, /tokenBudget .* positive integer/],
      [{ model: 3 }, /model must be a string/],
      [{ threshold: 10 }, /unknown key "threshold"/],
    ] as Array<[unknown, RegExp]>
    for (const [config, pattern] of bad) {
      expect(() => resolveConfig(config as HeadroomCompressConfig)).toThrow(pattern)
    }
  })
})

describe('HeadroomCompressor content transform', () => {
  it('measures text code points only and skips content within threshold', async () => {
    const compressor = service()
    const blocks = [
      { type: 'text', text: 'a😀b' },
      { type: 'reasoning', text: 'not measured' },
    ] satisfies ContentBlock[]
    expect(compressor.measureContent(blocks)).toBe(3)
    expect(codePointLength('a😀b')).toBe(3)

    const session = Session.create(SessionId('within'))
    appendToolStep(session, 1, 'a', [{ type: 'text', text: 'x'.repeat(10) }])
    session.append('turn/start', { turn: 2 })
    const result = await compressor.compressSession(session)
    expect(result).toEqual({ compressed: [], charsRemoved: 0 })
    expect(compressMock).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', async () => {
    const compressor = service({ enabled: false, thresholdChars: 5 })
    const session = Session.create(SessionId('disabled'))
    appendToolStep(session, 1, 'a', [{ type: 'text', text: 'x'.repeat(100) }])
    session.append('turn/start', { turn: 2 })
    const result = await compressor.compressSession(session)
    expect(result).toEqual({ compressed: [], charsRemoved: 0 })
    expect(compressMock).not.toHaveBeenCalled()
  })

  it('skips content the proxy did not shrink', async () => {
    compressMock.mockResolvedValueOnce({
      messages: [{ role: 'tool', content: 'x'.repeat(200), tool_call_id: 'one' }],
      tokensBefore: 100,
      tokensAfter: 120,
      tokensSaved: 0,
      compressionRatio: 1,
      transformsApplied: [],
      ccrHashes: [],
      compressed: true,
    })
    const session = Session.create(SessionId('no-shrink'))
    appendToolStep(session, 1, 'a', [{ type: 'text', text: 'x'.repeat(100) }])
    session.append('turn/start', { turn: 2 })
    const result = await service().compressSession(session)
    expect(result).toEqual({ compressed: [], charsRemoved: 0 })
  })
})

describe('HeadroomCompressor session transaction', () => {
  it('compresses a stable snapshot, preserves all data, and cites the replaced result', async () => {
    const session = Session.create(SessionId('preserve'))
    const originalSeq = appendToolStep(session, 1, 'one', [{
      type: 'text',
      text: 'x'.repeat(100),
    }], {
      isError: true,
      error: { name: 'ExitError', code: 'EXIT_1' },
      meta: { diff: ['a', 'b'] },
      futureField: { nested: true },
    })
    session.append('turn/start', { turn: 2 })

    const result = await service().compressSession(session)
    expect(result.compressed).toHaveLength(1)
    expect(result.charsRemoved).toBeGreaterThan(0)
    const entry = result.compressed[0]!
    expect(entry).toMatchObject({ originalSeq, callId: CallId('one'), charsBefore: 100 })
    expect(entry.charsAfter).toBeLessThan(100)

    const original = session.events[originalSeq]!
    const replacement = session.events[entry.replacementSeq]! as SurfaceEvent
    expect(original).toMatchObject({
      type: 'tool/result',
      data: {
        message: {
          content: [{
            type: 'tool-result',
            content: [{ type: 'text', text: 'x'.repeat(100) }],
          }],
        },
      },
    })
    expect(replacement).toMatchObject({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        isError: true,
        message: {
          source: { kind: 'tool', callId: CallId('one') },
          content: [{
            type: 'tool-result',
            toolCallId: CallId('one'),
            content: [{ type: 'text', text: stubCompressed('x'.repeat(100)) }],
          }],
        },
        error: { name: 'ExitError', code: 'EXIT_1' },
        meta: { diff: ['a', 'b'] },
        futureField: { nested: true },
      },
      surfaceOp: { op: 'replace', start: originalSeq, end: originalSeq },
      sourceEventSeqs: [originalSeq],
    })
    expect(session.surface.nodes).not.toContain(originalSeq)

    // Shadow-price protocol: the metering event sits directly before the
    // replacement and prices the shadowed node with the shared estimator.
    if (original.type !== 'tool/result') throw new Error('original is not a tool/result')
    expect(session.events[entry.replacementSeq - 1]).toMatchObject({
      type: 'compaction/prune',
      data: {
        shadowedRange: { start: originalSeq, end: originalSeq },
        shadowedSeqs: [originalSeq],
        shadowedTokenCount: METER.estimateMessage(original.data.message),
      },
    })
  })

  it('replays to the identical compressed model messages', async () => {
    const session = Session.create(SessionId('replay'))
    appendToolStep(session, 1, 'a', [{ type: 'text', text: 'A'.repeat(100) }])
    session.append('turn/start', { turn: 2 })
    await service().compressSession(session)
    const replay = Session.create(session.id, [...session.events])
    expect(replay.deriveMessages()).toEqual(session.deriveMessages())
    expect(replay.surface.replaceGeneration).toBe(session.surface.replaceGeneration)
  })
})

describe('headroom loader composition', () => {
  it('registers the service and its settings namespace', async () => {
    const ctx = new Context()
    void new LlmRuntime(ctx)
    void new TokenMeter(ctx)
    await ctx.plugin(HeadroomCompressor, { enabled: true, thresholdChars: 100 })
    expect(ctx.get('headroomCompressor')).toBeInstanceOf(HeadroomCompressor)
    expect(ctx.headroomCompressor.config.enabled).toBe(true)
    expect(ctx.headroomCompressor.config.thresholdChars).toBe(100)
    await ctx.fiber.dispose()
  })
})
