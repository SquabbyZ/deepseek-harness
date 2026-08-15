// DiffBlock: the inline-diff surface for a file mutation (write/edit) — a copy
// control over one or more per-file hunks, each a bold path header followed by
// the removed block (`-`, error color) and the added block (`+`, success
// color), with a dim `└ +A -R · N file(s)` footer. Unlike the TUI's exact
// changed-row comparison, this block renders the old and new sides in full.
// Both front ends share the line-terminator rule and distinct-path file count.
// Output never soft-wraps — an aligned source line keeps its indentation and
// scrolls horizontally instead of folding. Colors resolve through --dsw-*
// tokens; geometry mirrors CodeBlock.

import { useCallback, useMemo, useState } from 'react'
import { writeClipboard } from './clipboard.ts'
import { cn } from './components/ui/cn.ts'

/**
 * Output lines shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a diff card and a terminal card cut a
 * long body at the same place.
 */
export const DEFAULT_DIFF_MAX_LINES = 16

/**
 * One file's change, in the shape {@link DiffBlock} draws. Structurally the
 * render-intent contract's `FileDiff`, redeclared here so this primitive stays
 * free of the tool contract (the terminal card's decoupling, applied to diffs).
 */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header (the tool's model-facing path). */
  path: string
  /** Prior content, or `null` for a new file / an overwrite (nothing on the removed side). */
  oldText: string | null
  /** Content after the change (the added side). */
  newText: string
}

export interface DiffBlockProps {
  /** One entry per applied hunk, in file order; empty renders nothing. */
  diffs: DiffHunk[]
  /** Height cap in body lines before the middle collapses (default {@link DEFAULT_DIFF_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** A single rendered body line and its role, so the height cap slices a flat list. */
interface DiffRow {
  kind: 'path' | 'del' | 'add' | 'gap'
  text: string
}

/** Local exhaustiveness helper — this package does not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable diff row kind: ${String(value)}`)
}

/** Card geometry mirrors CodeBlock/TerminalBlock (12px radius, code-block surface). */
const BLOCK =
  'relative my-4 text-[var(--dsw-alias-label-primary)] bg-[var(--dsw-alias-markdown-code-block)] rounded-[12px]'

/** Copy control floats top-right over the body, so the card has no empty banner row. */
const COPY_BUTTON =
  'absolute top-2 right-3 z-[1] border-none bg-transparent p-0 m-0 text-[color:var(--dsw-alias-label-secondary)] text-[13px] leading-[20px] cursor-pointer'

/** Body keeps its own code font and scrolls horizontally (a source line folds
 * would destroy the indentation a diff is read by). */
const BODY =
  'px-[14px] py-3 text-[13px] leading-[22px] [font-family:var(--ds-font-family-code)] overflow-x-auto overflow-y-hidden'

/** One body line, minimum the code line height, no wrapping. */
const LINE = 'min-h-[22px] whitespace-pre'

/** Collapse toggle. */
const EXPAND =
  'block w-full p-0 border-none bg-transparent text-[var(--dsw-alias-label-tertiary)] cursor-pointer text-left hover:text-[var(--dsw-alias-label-secondary)]'

/** The change summary, dim under the body. */
const FOOTER =
  'px-[14px] pb-3 text-[color:var(--dsw-alias-label-tertiary)] text-[13px] leading-[22px] [font-family:var(--ds-font-family-code)]'

/** The dim class per row kind (path/gap chrome vs the diff's own +/- colors). */
const ROW_CLASS: Record<DiffRow['kind'], string | undefined> = {
  path: 'font-semibold pr-[56px] text-[var(--dsw-alias-label-primary)]',
  del: 'diff-del',
  add: 'diff-add',
  gap: 'text-[var(--dsw-alias-label-tertiary)]',
}

/** Stable `data-*` hook per row kind, so tests pin a row's role without the
 * CSS-module class names the Tailwind migration replaced. */
const ROW_DATA: Record<DiffRow['kind'], Record<string, string>> = {
  path: { 'data-diff-path': '' },
  del: { 'data-diff-del': '' },
  add: { 'data-diff-add': '' },
  gap: { 'data-diff-gap': '' },
}

/**
 * Flatten the hunks into the body's rows plus the footer counts. A path header
 * opens each new file; a same-file second hunk (a scattered edit) opens with a
 * `⋯` gap instead of repeating the path. Every old-side line counts toward
 * `removed` and every new-side line toward `added`. The file count is of
 * DISTINCT paths, matching the TUI diff card's footer, so two hunks in one file
 * read as `1 file` on both front ends.
 * @param diffs - the hunks to render.
 * @returns the body rows, the +/- totals, and the distinct-file count.
 */
function buildRows(diffs: DiffHunk[]): { rows: DiffRow[]; added: number; removed: number; files: number } {
  const rows: DiffRow[] = []
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  let prevPath: string | undefined
  for (const diff of diffs) {
    paths.add(diff.path)
    if (diff.path !== prevPath) rows.push({ kind: 'path', text: diff.path })
    else rows.push({ kind: 'gap', text: '⋯' })
    prevPath = diff.path
    if (diff.oldText !== null) {
      for (const line of contentLines(diff.oldText)) {
        rows.push({ kind: 'del', text: line })
        removed++
      }
    }
    for (const line of contentLines(diff.newText)) {
      rows.push({ kind: 'add', text: line })
      added++
    }
  }
  return { rows, added, removed, files: paths.size }
}

/**
 * Split a side's text into its content lines. Empty text is zero lines (a full
 * deletion's `newText` or a create's absent `oldText` side draws nothing), and a
 * single trailing newline is a line terminator rather than an extra empty line —
 * the same terminator rule TerminalBlock applies to command output. An interior
 * blank line (a genuine `\n\n`) survives.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * The diff text a reader copies: each row's `-`/`+`/path/gap prefix and its
 * content, exactly what the card shows. The removed and added blocks are the
 * change; the path headers keep a multi-file copy attributable.
 * @param rows - the flattened body rows.
 * @returns the diff as plain text.
 */
function copyText(rows: DiffRow[]): string {
  return rows.map((row) => {
    switch (row.kind) {
      case 'del': return `- ${row.text}`
      case 'add': return `+ ${row.text}`
      case 'path': return row.text
      case 'gap': return row.text
      /* v8 ignore next -- closed-union backstop; only reached if a row kind is forged */
      default: return assertNever(row.kind)
    }
  }).join('\n')
}

/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({ diffs, maxLines = DEFAULT_DIFF_MAX_LINES, className }: DiffBlockProps) {
  const { rows, added, removed, files } = useMemo(() => buildRows(diffs), [diffs])
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  if (rows.length === 0) return null

  const hidden = rows.length - maxLines
  const capped = hidden > 0 && !expanded
  // Same split arithmetic as TerminalBlock and the TUI transcript's collapsed
  // card, so a body's head and tail slices agree across the front ends.
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const head = capped ? rows.slice(0, headLines) : rows
  const tail = capped ? rows.slice(rows.length - tailLines) : []

  return (
    <div className={cn(BLOCK, className)} data-diff="">
      <button type="button" className={COPY_BUTTON} onClick={onCopy}>
        {copied ? '复制成功' : '复制'}
      </button>
      <div className={BODY}>
        {head.map((row, index) => (
          <div key={index} className={cn(LINE, ROW_CLASS[row.kind])} data-diff-line="" {...ROW_DATA[row.kind]}>{row.text}</div>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className={EXPAND}
            aria-expanded={expanded}
            aria-label={expanded ? '收起差异' : `展开其余 ${hidden} 行差异`}
            onClick={onToggle}
          >
            {expanded ? '收起' : `… 其余 ${hidden} 行`}
          </button>
        )}
        {tail.map((row, index) => (
          <div key={index} className={cn(LINE, ROW_CLASS[row.kind])} data-diff-line="" {...ROW_DATA[row.kind]}>{row.text}</div>
        ))}
      </div>
      <div className={FOOTER}>└ +{added} -{removed} · {files} file{files === 1 ? '' : 's'}</div>
    </div>
  )
}
