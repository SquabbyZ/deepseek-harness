// CodeBlock: one code surface for every consumer — markdown fences, the
// run_code program body, and the details panel's raw args/output — with
// shiki highlighting for the registered grammars and an identical-geometry
// plain fallback for everything else. Chrome (language banner + copy) matches
// deepsuite `@deepseek/md` code blocks; token colors stay on `--shiki-*`.

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { writeClipboard } from '../clipboard.ts'
import { grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from './highlight.ts'
import { cn } from '../components/ui/cn.ts'

export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Copy-button idle label; the owner passes localized copy (this package is cordis-free, so copy arrives via props). */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

/* The --dsl-code-block-* rebindable contract, the card margin rhythm, and the
 * pre/code descendant rules live in primitives.css (.code-block); the rest
 * are Tailwind utilities. */
const BLOCK =
  'code-block relative text-[var(--dsw-alias-label-primary)] bg-[var(--dsw-alias-markdown-code-block)] rounded-[var(--dsl-code-block-border-radius)]'

const BANNER_WRAP =
  'sticky top-0 z-[6] bg-[var(--dsw-alias-bg-base)] rounded-t-[var(--dsl-code-block-border-radius)]'

const BANNER =
  'flex justify-between items-center gap-3 px-[14px] py-[9px] bg-[var(--dsl-code-block-banner-background-color)] rounded-t-[var(--dsl-code-block-border-radius)] [font:var(--dsl-code-block-banner-font)]'

const INFO_STRING =
  'min-w-0 truncate text-[var(--dsw-alias-label-primary)] [font-family:var(--ds-font-family-code)] text-xs leading-[18px]'

const ACTION = 'flex items-center shrink-0'

const COPY_BUTTON = 'bg-transparent border-none p-0 m-0 text-inherit cursor-pointer'

const PLAIN = 'text-[var(--dsw-alias-label-primary)]'

export function CodeBlock({ code, lang, className, copyLabel = '复制', copiedLabel = '复制成功' }: CodeBlockProps) {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  // Re-render when a lazy grammar finishes loading, so a fence that showed plain
  // text while its language's grammar imported picks up highlighting. The
  // snapshot value is opaque; only its change across renders drives the memo.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const html = useMemo(() => highlightToHtml(trimmed, lang), [trimmed, lang, loaded])
  const rootRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    /* v8 ignore next -- both arms always mount a <pre>; trimmed is the
       typed fallback if the DOM shape ever diverges. */
    const text = rootRef.current?.querySelector('pre')?.textContent ?? trimmed
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])

  const body = html === undefined
    ? (
      <pre className={PLAIN}><code>{trimmed}</code></pre>
    )
    : (
  // shiki's output is a static span tree it generated from `code` (no user
  // HTML passes through), the sanctioned innerHTML consumption path per
  // shiki's own docs.
      <div dangerouslySetInnerHTML={{ __html: html }} />
    )

  return (
    <div ref={rootRef} className={cn(BLOCK, 'md-code-block', className)}>
      <div className={BANNER_WRAP}>
        <div className={BANNER}>
          <div className={INFO_STRING}>{lang ?? ''}</div>
          <div className={ACTION}>
            <button type="button" className={COPY_BUTTON} onClick={onCopy}>
              {copied ? copiedLabel : copyLabel}
            </button>
          </div>
        </div>
      </div>
      {body}
    </div>
  )
}
