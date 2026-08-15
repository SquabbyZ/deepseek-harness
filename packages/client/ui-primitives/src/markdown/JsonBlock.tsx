// JsonBlock: collapsible JSON block (conversation side; independent from the RPC panel's PayloadJson to avoid cross-panel coupling).

import { useMemo, useState } from 'react'

const MAX_CHARS = 20_000

/** Default truncation footer; the owner passes a localized formatter. */
function defaultTruncatedLabel(total: number): string {
  return `… 已截断，共 ${total} 字符`
}

const ROOT = 'my-1'

const TOGGLE =
  'rounded-[6px] border-none bg-transparent cursor-pointer text-xs leading-[18px] text-[var(--dsw-alias-label-secondary)] px-1.5 py-0.5 hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

const BODY =
  'mt-1 p-2 max-h-[200px] overflow-auto bg-[var(--dsw-alias-markdown-code-block)] border border-[var(--dsw-alias-border-l1)] rounded-[6px] [font-family:var(--ds-font-family-code)] text-[11px] leading-4 text-[var(--dsw-alias-label-primary)]'

export function JsonBlock({ label, payload, defaultOpen = false, truncatedLabel = defaultTruncatedLabel }: {
  label: string
  payload: unknown
  defaultOpen?: boolean
  /** Footer appended when the body exceeds the char cap, given the full length (this package is cordis-free, so copy arrives via props). */
  truncatedLabel?: ((total: number) => string) | undefined
}) {
  const [open, setOpen] = useState(defaultOpen)
  const body = useMemo(() => {
    if (!open) return ''
    let s: string
    try {
      // lib typing hides stringify's undefined arm (undefined/function/symbol payloads).
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      s = JSON.stringify(payload, null, 2) ?? String(payload)
    } catch {
      s = String(payload)
    }
    return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n${truncatedLabel(s.length)}` : s
  }, [open, payload, truncatedLabel])
  return (
    <div className={ROOT}>
      <button type="button" className={TOGGLE} onClick={() => { setOpen(v => !v) }}>
        {open ? '▾' : '▸'} {label}
      </button>
      {open && <pre className={BODY}>{body}</pre>}
    </div>
  )
}
