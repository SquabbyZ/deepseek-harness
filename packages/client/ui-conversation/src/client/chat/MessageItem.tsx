// MessageItem: simple chat nodes — user and consumed-steering bubbles
// (right-aligned, with clock + copy IconActions; branch lives only under
// assistant answers), pending steering (copy only), context injection,
// compaction marker, retry disclosure, and unknown-surface JSON rows.

import { memo, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ModelRetryNode, TurnErrorNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconApiOutline14, IconPaperclipOutline16, JsonBlock, MarkdownText, MessageText, Progress,
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import { ImageGallery, type ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'
import { messageImageLabels } from '../image-labels.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>

function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  documents: { name: string; content: string; format: 'markdown' | 'text' }[]
  rest: unknown[]
} {
  const texts: string[] = []
  const images: { attachment: UserImage['attachment'] }[] = []
  const documents: { name: string; content: string; format: 'markdown' | 'text' }[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown; name?: string; content?: string; format?: string }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    }
    else if (b.type === 'document' && typeof b.name === 'string' && typeof b.content === 'string') {
      documents.push({ name: b.name, content: b.content, format: b.format === 'text' ? 'text' : 'markdown' })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), images, documents, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className="retry-row text-[13px] leading-[20px] text-[var(--dsw-alias-label-tertiary)]" data-active={active || undefined}>
      <summary className="retry-summary inline-flex items-center w-fit py-0.5 gap-[7px] rounded-[3px] text-inherit cursor-pointer list-none select-none hover:text-[var(--dsw-alias-label-secondary)] focus-visible:outline-[1.5px] focus-visible:outline-[var(--dsw-alias-button-info-fill)] focus-visible:outline-offset-2">
        <span className="retry-text" role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className="grid gap-0.5 mt-[3px] pl-[14px] [overflow-wrap:anywhere] text-xs leading-[18px]">
        <div>
          <span className="text-[var(--dsw-alias-label-secondary)]">{t('message.retry.delay')}</span>
          {Math.round(node.delayMs)}ms
        </div>
        <div>
          <span className="text-[var(--dsw-alias-label-secondary)]">{t('message.retry.failure')}</span>
          {node.failure.message}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-2 items-start py-0.5 text-[13px] leading-[20px]" role="status">
      <StateDot state="error" className="mt-[5px]" />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <span className="mr-[6px] text-[var(--dsw-alias-state-error-primary)] font-semibold">{t('message.turnError')}</span>
        <span className="text-[var(--dsw-alias-label-secondary)]">{node.message}</span>
      </div>
      {node.code !== undefined && <code className="text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-markdown-code-block-small)]">{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-2 items-start py-0.5 text-[13px] leading-[20px]" role="status">
      <StateDot state="warning" className="mt-[5px]" />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <span className="mr-[6px] text-[var(--dsw-alias-state-warn-primary)] font-semibold">{t('message.maxTokens')}</span>
        <span className="text-[var(--dsw-alias-label-secondary)]">{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * Display projection of reference forms in a user bubble (free geometry — no
 * textarea alignment constraint here); everything else stays plain text. The
 * logged model text remains the single truth; this is presentation only.
 * Plain-text `/name` / `@name` word-boundary tokens decorate (the sent text
 * IS the reference — the bubble uses the same plainest token
 * scan as the composer, minus the lexicon: sent tokens were validated at
 * compose time, so shape alone decorates).
 */
function projectUserText(text: string): ReactNode {
  const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: ReactNode[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1]?.length ?? 0)
    const label = m[2] ?? ''
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    parts.push(
      <span key={tokenStart} className="inline-block mx-0.5 px-2 rounded-[6px] bg-[rgba(97,135,216,0.22)] text-[var(--dsw-alias-label-primary)] text-[0.85em] leading-[1.6] whitespace-nowrap align-baseline" data-ref-chip={label.startsWith('@') ? 'subagent' : 'skill'}>
        {label}
      </span>,
    )
    cursor = tokenStart + label.length
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return <>{parts}</>
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, imageLoader, actions, pending = false, t,
}: {
  content: readonly unknown[]
  imageLoader: ImageLoader
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, images, documents, rest } = contentParts(content)
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div className="userRow flex flex-col items-end gap-[6px]" data-pending-steering={pending || undefined} data-time-hover-root>
      <div className="flex flex-col items-end gap-2 min-w-0 max-w-[min(525px,82%)]">
        <ImageGallery images={images} load={imageLoader} align="end" labels={messageImageLabels(t)} />
        {documents.length > 0 && (
          <div className="flex flex-col items-end gap-2">
            {documents.map((doc, index) => (
              <Sheet key={index}>
                <SheetTrigger asChild>
                  <button type="button" className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-lg border border-[var(--dsw-alias-border-l2-darkmode-thin)] bg-[var(--dsw-specific-bubble)] px-2.5 text-xs text-[var(--dsw-alias-label-primary)] hover:bg-[var(--dsw-alias-interactive-bg-hover-solid)] cursor-pointer">
                    <IconPaperclipOutline16 className="flex-none size-3.5" aria-hidden />
                    <span className="truncate">{doc.name}</span>
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="flex w-[520px] flex-col gap-0 p-0" style={{ maxWidth: 'min(520px, 90vw)' }}>
                  <SheetHeader className="flex items-center justify-between gap-2 border-b border-[var(--dsw-alias-border-l2-darkmode-thin)] px-4 py-3">
                    <SheetTitle className="truncate text-sm">{doc.name}</SheetTitle>
                  </SheetHeader>
                  {doc.format === 'text' ? (
                    <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6 text-[var(--dsw-alias-label-primary)] font-sans">
                      {doc.content}
                    </pre>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                      <MarkdownText text={doc.content} />
                    </div>
                  )}
                </SheetContent>
              </Sheet>
            ))}
          </div>
        )}
        {showBubble && <div className="max-w-full rounded-[22px] px-4 py-[10px] text-base leading-6 text-[var(--dsw-alias-label-primary)] bg-[var(--dsw-specific-bubble)]">
          {projectUserText(text)}
          {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
      </div>
      {actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, loadImage, t }: {
  content: readonly unknown[]
  loadImage?: ImageLoader
  t: ChatViewSlotProps['t']
}): ReactNode {
  const imageLoader = loadImage ?? (() => Promise.reject(new Error(t('image.serviceUnavailable'))))
  return (
    <UserStyleBubble
      content={content}
      imageLoader={imageLoader}
      pending
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          t={t}
        />
      )}
    />
  )
}

/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, loadImage, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  return (
    <UserStyleBubble
      content={data.content}
      imageLoader={loadImage}
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** In-flight automatic compaction keyed Chat renderer (before its checkpoint lands). */
export const CompactionRunningNodeView = memo(function CompactionRunningNodeView({ node, t }: ChatNodeViewProps<'compaction-running'>) {
  return (
    <div className="flex flex-col py-0.5" data-compaction-running={node.data.compactionId}>
      <div className="flex items-center h-6 min-w-0">
        <span className="relative flex-none size-4 inline-flex items-center justify-center mr-[6px] text-[var(--dsw-alias-label-secondary)]" aria-hidden>
          <IconApiOutline14 />
        </span>
        <span className="flex-none text-sm leading-6 text-[var(--dsw-alias-label-primary-dimmed)]">{t('message.compaction')}</span>
        <span className="flex-none size-0.5 mx-2 rounded-[1px] bg-[var(--dsw-alias-label-caption)]" aria-hidden />
        <span className="min-w-0 flex-1 overflow-hidden text-sm leading-6 text-[var(--dsw-alias-label-tertiary)] text-ellipsis whitespace-nowrap">{t('message.compaction.running')}</span>
      </div>
      <Progress value={50} className="mt-1 h-1 animate-pulse" aria-hidden />
    </div>
  )
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>) {
  return <TurnErrorItem node={node.data} t={t} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className="py-0.5">
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
