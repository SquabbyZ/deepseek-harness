import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  UIEvent as ReactUIEvent,
} from 'react'
import { IconCheckOutline16, IconCopyOutline16 } from './icons/index.tsx'
import { Menu } from './Menu.tsx'
import type { MenuEntry } from './Menu.tsx'
import { cn } from './components/ui/cn.ts'

const OBJECT_PREVIEW_LIMIT = 4
const ARRAY_PREVIEW_LIMIT = 5
const PREVIEW_DEPTH_LIMIT = 2

/**
 * Display copy for the tree's copy affordance; the owner passes localized
 * labels (this package is cordis-free, so copy arrives via props). Every
 * field defaults to the current built-in value, so existing consumers render
 * unchanged.
 */
export interface JsonTreeLabels {
  /** Menu item: copy the raw primitive value. */
  copyValue: string
  /** Menu item: copy the value as compact JSON (primitive rows). */
  copyJson: string
  /** Menu item: copy the property path. */
  copyPath: string
  /** Menu item: copy the value as pretty-printed JSON. */
  copyPrettyJson: string
  /** Menu item: copy the value as compact JSON (object rows). */
  copyCompactJson: string
  /** Copy-button state label after a successful copy. */
  copied: string
  /** Copy-button state label after a failed copy. */
  copyFailed: string
  /** Expander aria label while expanded. */
  collapseNode: string
  /** Expander aria label while collapsed. */
  expandNode: string
  /** Copy-button tooltip, given the current action label. */
  copyButtonTitle: (action: string) => string
}

const DEFAULT_LABELS: JsonTreeLabels = {
  copyValue: 'Copy value',
  copyJson: 'Copy JSON',
  copyPath: 'Copy property path',
  copyPrettyJson: 'Copy pretty JSON',
  copyCompactJson: 'Copy compact JSON',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  collapseNode: 'Collapse JSON node',
  expandNode: 'Expand JSON node',
  copyButtonTitle: action => `${action}; right-click for copy options`,
}

function valueCopyMenuItems(labels: JsonTreeLabels): readonly MenuEntry[] {
  return [
    { id: 'value', label: labels.copyValue },
    { id: 'json', label: labels.copyJson },
    { id: 'path', label: labels.copyPath },
  ]
}

function objectCopyMenuItems(labels: JsonTreeLabels): readonly MenuEntry[] {
  return [
    { id: 'prettyJson', label: labels.copyPrettyJson },
    { id: 'json', label: labels.copyCompactJson },
    { id: 'path', label: labels.copyPath },
  ]
}

type JsonPath = readonly (number | string)[]

interface RowTarget {
  path: JsonPath
  value: unknown
}

interface CopyTarget extends RowTarget {
  left: number
  side: 'bottom' | 'top'
  top: number
}

function isExpandableValue(value: unknown): value is object | unknown[] {
  return typeof value === 'object' && value !== null && !(value instanceof Date)
}

function entriesOf(value: object | unknown[]): readonly (readonly [string, unknown])[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item] as const)
  }
  return Object.keys(value).map(key => [
    key,
    (value as Record<string, unknown>)[key],
  ] as const)
}

function bracketOf(value: object | unknown[]): readonly [string, string] {
  return Array.isArray(value) ? ['[', ']'] : ['{', '}']
}

function previewPrimitive(value: unknown): ReactNode {
  if (value === null) return <span className={KEYWORD_VALUE}>null</span>
  if (typeof value === 'string') {
    return <span className={STRING_VALUE}>{JSON.stringify(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className={NUMBER_VALUE}>{String(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span className={KEYWORD_VALUE}>{String(value)}</span>
  }
  if (typeof value === 'bigint') {
    return <span className={OTHER_VALUE}>{value.toString()}</span>
  }
  if (typeof value === 'undefined') {
    return <span className={OTHER_VALUE}>undefined</span>
  }
  if (typeof value === 'symbol') {
    return <span className={OTHER_VALUE}>{value.description ?? 'Symbol'}</span>
  }
  if (typeof value === 'function') {
    return <span className={OTHER_VALUE}>{value.name || 'Function'}</span>
  }
  return null
}

function previewValue(value: unknown, depth: number): ReactNode {
  if (!isExpandableValue(value)) return previewPrimitive(value)

  const array = Array.isArray(value)
  const entries = entriesOf(value)
  const limit = array ? ARRAY_PREVIEW_LIMIT : OBJECT_PREVIEW_LIMIT
  const visible = entries.slice(0, limit)
  const [open, close] = bracketOf(value)

  return (
    <>
      <span className={PUNCTUATION}>{open}</span>
      {depth >= PREVIEW_DEPTH_LIMIT
        ? <span className={PREVIEW_ELLIPSIS}>…</span>
        : visible.map(([key, item], index) => (
          <span key={key}>
            {index > 0 && <span className={PUNCTUATION}>, </span>}
            {!array && (
              <>
                <span className={PREVIEW_PROPERTY}>{key}</span>
                <span className={PUNCTUATION}>: </span>
              </>
            )}
            {previewValue(item, depth + 1)}
          </span>
        ))}
      {depth < PREVIEW_DEPTH_LIMIT && entries.length > limit && (
        <span className={PREVIEW_ELLIPSIS}>, …</span>
      )}
      <span className={PUNCTUATION}>{close}</span>
    </>
  )
}

function primitiveValue(value: unknown): ReactNode {
  if (value === null) return <span className={KEYWORD_VALUE}>null</span>
  if (typeof value === 'string') {
    return <span className={STRING_VALUE}>{JSON.stringify(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span className={KEYWORD_VALUE}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className={NUMBER_VALUE}>{String(value)}</span>
  }
  if (typeof value === 'bigint') {
    return <span className={NUMBER_VALUE}>{`${value.toString()}n`}</span>
  }
  if (value instanceof Date) {
    return <span className={OTHER_VALUE}>{value.toISOString()}</span>
  }
  if (typeof value === 'function') {
    return <span className={OTHER_VALUE}>function() {'{ }'}</span>
  }
  if (typeof value === 'undefined') {
    return <span className={OTHER_VALUE}>undefined</span>
  }
  return <span className={OTHER_VALUE}>{(value as symbol).toString()}</span>
}

function fieldText(field: string): string {
  return field === '' ? '""' : field
}

function pathId(path: JsonPath): string {
  return path.map(part => (
    typeof part === 'number' ? `n${String(part)}` : `s${String(part.length)}:${part}`
  )).join('/')
}

function claimFocus(button: HTMLElement): void {
  button.focus()
}

function moveFocus(button: HTMLElement, direction: -1 | 1): void {
  const tree = button.closest<HTMLElement>('[role="tree"]')
  /* v8 ignore next -- JsonTree attaches expander handlers only beneath its owning role=tree. */
  if (tree === null) return
  const expanders = Array.from(tree.querySelectorAll<HTMLElement>('[data-json-expander]'))
  const current = expanders.indexOf(button)
  /* v8 ignore next -- the current expander is a member of the queried non-empty set. */
  if (current < 0 || expanders.length === 0) return
  const next = (current + direction + expanders.length) % expanders.length
  const nextExpander = expanders[next]
  /* v8 ignore next -- modulo over the non-empty expander set always resolves a member. */
  if (nextExpander !== undefined) claimFocus(nextExpander)
}

function NodeField({
  field,
  expandable,
  onToggle,
}: {
  field: string | undefined
  expandable: boolean
  onToggle: () => void
}) {
  if (field === undefined) return null
  return (
    <span
      className={cn(LABEL, expandable && CLICKABLE_LABEL)}
      onClick={expandable ? onToggle : undefined}
    >
      {fieldText(field)}:
    </span>
  )
}

interface JsonTreeNodeProps {
  field?: string
  initialExpanded: boolean
  labels: JsonTreeLabels
  lastElement: boolean
  onClaimTabStop: (id: string) => void
  onRowHover: (row: HTMLElement, target: RowTarget) => void
  path: JsonPath
  tabStopId: string | null
  value: unknown
}

function JsonTreeNode({
  field,
  initialExpanded,
  labels,
  lastElement,
  onClaimTabStop,
  onRowHover,
  path,
  tabStopId,
  value,
}: JsonTreeNodeProps) {
  const contentsId = useId()
  const expanderRef = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(initialExpanded)
  const nodeId = pathId(path)
  const container = isExpandableValue(value)
  const entries = container ? entriesOf(value) : []
  const expandable = entries.length > 0

  const toggle = () => {
    setExpanded(current => !current)
    claimFocus(expanderRef.current as HTMLSpanElement)
  }

  const onExpanderKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setExpanded(event.key === 'ArrowRight')
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  const row = (children: ReactNode, ariaExpanded?: boolean) => (
    <div
      className={ROW}
      role="treeitem"
      aria-expanded={ariaExpanded}
      onMouseOver={(event) => {
        event.stopPropagation()
        onRowHover(event.currentTarget, { path, value })
      }}
    >
      {children}
    </div>
  )

  if (!container) {
    return row((
      <>
        <NodeField field={field} expandable={false} onToggle={toggle} />
        {primitiveValue(value)}
        {!lastElement && <span className={PUNCTUATION}>,</span>}
      </>
    ))
  }

  const [open, close] = bracketOf(value)
  if (!expandable) {
    return row((
      <>
        <NodeField field={field} expandable={false} onToggle={toggle} />
        <span className={PUNCTUATION}>{open}</span>
        <span className={PUNCTUATION}>{close}</span>
        {!lastElement && <span className={PUNCTUATION}>,</span>}
      </>
    ))
  }

  return row((
    <>
      <span
        ref={expanderRef}
        className={EXPANDER}
        data-json-expander
        role="button"
        aria-label={expanded ? labels.collapseNode : labels.expandNode}
        aria-expanded={expanded}
        aria-controls={expanded ? contentsId : undefined}
        tabIndex={tabStopId === nodeId ? 0 : -1}
        onFocus={() => { onClaimTabStop(nodeId) }}
        onClick={toggle}
        onKeyDown={onExpanderKeyDown}
      />
      <NodeField field={field} expandable onToggle={toggle} />
      <span className={PREVIEW}>{previewValue(value, 0)}</span>
      {!lastElement && <span className={PUNCTUATION}>,</span>}
      {expanded && (
        <ul id={contentsId} role="group" className={CHILDREN}>
          {entries.map(([key, item], index) => (
            <JsonTreeNode
              key={key}
              field={key}
              value={item}
              path={[...path, Array.isArray(value) ? index : key]}
              labels={labels}
              lastElement={index === entries.length - 1}
              initialExpanded={false}
              tabStopId={tabStopId}
              onClaimTabStop={onClaimTabStop}
              onRowHover={onRowHover}
            />
          ))}
        </ul>
      )}
    </>
  ), expanded)
}

function formattedPath(path: JsonPath): string {
  return path.reduce<string>((result, part) => {
    if (typeof part === 'number') return `${result}[${String(part)}]`
    return /^[A-Za-z_$][\w$]*$/.test(part)
      ? `${result}.${part}`
      : `${result}[${JSON.stringify(part)}]`
  }, '$')
}

function copyText(target: CopyTarget, mode: 'json' | 'path' | 'prettyJson' | 'value'): string {
  if (mode === 'path') return formattedPath(target.path)
  if (mode === 'prettyJson') return JSON.stringify(target.value, null, 2)
  if (mode === 'json') return JSON.stringify(target.value)
  if (typeof target.value === 'string') return target.value
  if (typeof target.value === 'undefined') return 'undefined'
  if (typeof target.value === 'bigint') return target.value.toString()
  if (typeof target.value === 'symbol') return target.value.description ?? 'Symbol'
  if (typeof target.value === 'function') return target.value.name || 'Function'
  return JSON.stringify(target.value)
}

/** Props for the read-only, token-themed JSON tree. */
export interface JsonTreeProps {
  /** Parsed JSON object or array. */
  data: object | unknown[]
  /** Accessible label for the tree. */
  label?: string
  /** Optional positioning class owned by the caller. */
  className?: string | undefined
  /** Whether JSON rows expose copy actions. */
  copyable?: boolean
  /** Whether the top-level object or array is always expanded. */
  expandTopLevel?: boolean
  /** Localized display copy; omitted fields keep the built-in defaults. */
  labels?: Partial<JsonTreeLabels> | undefined
}

/**
 * Render parsed JSON as a compact, keyboard-accessible inspector tree.
 * @param props - Parsed data, accessible label, and display options.
 * @returns A read-only JSON tree with an optionally fixed-open top level.
 */
export function JsonTree({
  data,
  label = 'JSON',
  className,
  copyable = true,
  expandTopLevel = true,
  labels,
}: JsonTreeProps) {
  const copyLabels = useMemo<JsonTreeLabels>(
    () => (labels === undefined ? DEFAULT_LABELS : { ...DEFAULT_LABELS, ...labels }),
    [labels],
  )
  const rootEntries = entriesOf(data)
  const firstExpandableIndex = rootEntries.findIndex(([, value]) => (
    isExpandableValue(value) && entriesOf(value).length > 0
  ))
  const firstExpandableEntry = rootEntries[firstExpandableIndex]
  const initialTabStopId = expandTopLevel
    ? firstExpandableEntry === undefined
      ? null
      : pathId([Array.isArray(data) ? firstExpandableIndex : firstExpandableEntry[0]])
    : isExpandableValue(data) && rootEntries.length > 0 ? pathId([]) : null
  const rootRef = useRef<HTMLDivElement>(null)
  const activeRowRef = useRef<HTMLElement>()
  const copyButtonRef = useRef<HTMLButtonElement>(null)
  const copyMenuOpenRef = useRef(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout>>()
  const [copyTarget, setCopyTarget] = useState<CopyTarget>()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const [tabStopId, setTabStopId] = useState<string | null>(initialTabStopId)

  const setActiveRow = (row: HTMLElement | undefined) => {
    activeRowRef.current?.removeAttribute('data-json-copy-active')
    activeRowRef.current = row
    row?.setAttribute('data-json-copy-active', '')
  }

  const clearCopyTarget = () => {
    setActiveRow(undefined)
    setCopyTarget(undefined)
    setCopyState('idle')
    copyMenuOpenRef.current = false
    setCopyMenuOpen(false)
  }

  const copyPosition = (row: HTMLElement): Pick<CopyTarget, 'left' | 'side' | 'top'> => {
    const root = rootRef.current
    /* v8 ignore next -- row events and viewport listeners run only after the root ref mounts. */
    if (root === null) throw new Error('JsonTree root is not mounted')
    const rootRect = root.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    return {
      left: rootRect.left + root.clientWidth - 26,
      side: rowRect.top - rootRect.top > root.clientHeight / 2 ? 'top' : 'bottom',
      top: rowRect.top,
    }
  }

  const positionCopyButton = (row: HTMLElement, target: RowTarget) => {
    const position = copyPosition(row)
    setCopyTarget({ ...target, ...position })
  }

  const repositionCopyButton = (row: HTMLElement) => {
    const position = copyPosition(row)
    setCopyTarget((current) => {
      /* v8 ignore next -- an active row and its copy target are installed together. */
      if (current === undefined) return current
      return { ...current, ...position }
    })
  }

  useEffect(() => () => {
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current)
    activeRowRef.current?.removeAttribute('data-json-copy-active')
  }, [])

  useEffect(() => {
    activeRowRef.current?.removeAttribute('data-json-copy-active')
    activeRowRef.current = undefined
    copyMenuOpenRef.current = false
    setCopyTarget(undefined)
    setCopyState('idle')
    setCopyMenuOpen(false)
    setTabStopId(initialTabStopId)
  }, [data, expandTopLevel, initialTabStopId])

  useEffect(() => {
    const reposition = () => {
      const row = activeRowRef.current
      if (row !== undefined) repositionCopyButton(row)
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [])

  const handleRowHover = (row: HTMLElement, target: RowTarget) => {
    if (!copyable || copyMenuOpenRef.current) return
    if (activeRowRef.current === row) return
    setActiveRow(row)
    setCopyState('idle')
    copyMenuOpenRef.current = false
    setCopyMenuOpen(false)
    positionCopyButton(row, target)
  }

  const handleRootMouseOver = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!copyable || copyMenuOpenRef.current) return
    /* v8 ignore next -- browser mouse events delivered through React target an Element. */
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-json-copy-button]') === null) clearCopyTarget()
  }

  const handleScroll = (_event: ReactUIEvent<HTMLDivElement>) => {
    const row = activeRowRef.current
    if (row !== undefined) repositionCopyButton(row)
  }

  const copy = async (mode: 'json' | 'path' | 'prettyJson' | 'value') => {
    /* v8 ignore next -- copy controls only render while their target exists. */
    if (copyTarget === undefined) return
    try {
      await navigator.clipboard.writeText(copyText(copyTarget, mode))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => { setCopyState('idle') }, 1_500)
  }

  const [rootOpen, rootClose] = bracketOf(data)
  const copyTargetIsObject = typeof copyTarget?.value === 'object' && copyTarget.value !== null
  const defaultCopyMode = copyTargetIsObject ? 'prettyJson' : 'value'
  const copyTitle = copyState === 'copied'
    ? copyLabels.copied
    : copyState === 'failed'
      ? copyLabels.copyFailed
      : copyTargetIsObject ? copyLabels.copyPrettyJson : copyLabels.copyValue

  return (
    <div
      ref={rootRef}
      className={cn(ROOT, className)}
      onMouseOver={handleRootMouseOver}
      onMouseLeave={() => {
        if (!copyMenuOpenRef.current) clearCopyTarget()
      }}
      onScroll={handleScroll}
    >
      {expandTopLevel
        ? (
          <div className={EXPANDED_TOP_LEVEL}>
            <div
              className={cn(ROW, TOP_LEVEL_BRACKET)}
              data-json-root-row
              onMouseOver={(event) => {
                event.stopPropagation()
                handleRowHover(event.currentTarget, { path: [], value: data })
              }}
            >
              <span className={PUNCTUATION}>{rootOpen}</span>
            </div>
            <div
              aria-label={label}
              className={cn(CONTAINER, 'p-0')}
              role="tree"
            >
              {rootEntries.map(([key, value], index) => (
                <JsonTreeNode
                  key={key}
                  field={key}
                  value={value}
                  path={[Array.isArray(data) ? index : key]}
                  labels={copyLabels}
                  lastElement={index === rootEntries.length - 1}
                  initialExpanded={false}
                  tabStopId={tabStopId}
                  onClaimTabStop={setTabStopId}
                  onRowHover={handleRowHover}
                />
              ))}
            </div>
            <div className={cn(ROW, TOP_LEVEL_BRACKET)}>
              <span className={PUNCTUATION}>{rootClose}</span>
            </div>
          </div>
        )
        : (
          <div aria-label={label} className={CONTAINER} role="tree">
            <JsonTreeNode
              value={data}
              path={[]}
              labels={copyLabels}
              lastElement
              initialExpanded
              tabStopId={tabStopId}
              onClaimTabStop={setTabStopId}
              onRowHover={handleRowHover}
            />
          </div>
        )}
      {copyTarget !== undefined && (
        <span
          className={COPY_ANCHOR}
          style={{ left: copyTarget.left, top: copyTarget.top }}
        >
          <Menu
            open={copyMenuOpen}
            compact
            portal
            align="end"
            side={copyTarget.side}
            anchor={(
              <button
                ref={copyButtonRef}
                type="button"
                className={COPY_BUTTON}
                data-json-copy-button
                data-state={copyState}
                aria-label={copyTitle}
                title={copyLabels.copyButtonTitle(copyTitle)}
                onClick={() => void copy(defaultCopyMode)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  copyMenuOpenRef.current = true
                  setCopyMenuOpen(true)
                }}
              >
                {copyState === 'copied'
                  ? <IconCheckOutline16 size={12} />
                  : <IconCopyOutline16 size={12} />}
              </button>
            )}
            items={copyTargetIsObject ? objectCopyMenuItems(copyLabels) : valueCopyMenuItems(copyLabels)}
            onSelect={(id) => {
              void copy(id as 'json' | 'path' | 'prettyJson' | 'value')
              copyMenuOpenRef.current = false
              setCopyMenuOpen(false)
            }}
            onClose={clearCopyTarget}
            getAnchorRect={() => (
              copyButtonRef.current as HTMLButtonElement
            ).getBoundingClientRect()}
          />
        </span>
      )}
    </div>
  )
}

/* Tailwind class strings. Simple single-property rules map to utilities with
 * arbitrary-value var() refs; the complex selectors (:has, the ::before
 * triangle, the ::after row fill, the dark-theme var rebind) live in
 * web/src/primitives.css under the jt- prefix. */
const ROOT =
  'jt-root min-w-0 overflow-auto relative text-xs leading-[16px] [font-family:var(--ds-font-family-code)] text-[color:var(--dsw-alias-label-primary)] bg-[var(--dsw-alias-bg-layer-1)] overscroll-x-contain overscroll-y-auto'
const CONTAINER = 'w-max min-w-full m-0 pt-[6px] px-2 pb-2 whitespace-pre'
const EXPANDED_TOP_LEVEL = 'w-max min-w-full pt-[6px] pr-2 pb-2 pl-[14px] jt-expanded-top-level'
const ROW = 'relative min-w-full min-h-4 m-0 pl-2.5 list-none jt-row'
const TOP_LEVEL_BRACKET = 'jt-top-level-bracket pl-0'
const CHILDREN = 'm-0 p-0 list-none'
const LABEL = 'mr-[3px] text-[var(--json-tree-property)] font-normal'
const CLICKABLE_LABEL = 'cursor-pointer'
const STRING_VALUE = 'text-[var(--json-tree-string)]'
const NUMBER_VALUE = 'text-[var(--json-tree-number)]'
const KEYWORD_VALUE = 'text-[var(--json-tree-keyword)]'
const OTHER_VALUE = 'text-[var(--dsw-alias-label-secondary)]'
/* .preview / .previewProperty share the punctuation color in the source CSS. */
const PUNCTUATION = 'text-[var(--json-tree-punctuation)]'
const PREVIEW = 'text-[var(--json-tree-punctuation)]'
const PREVIEW_PROPERTY = 'text-[var(--json-tree-punctuation)]'
const PREVIEW_ELLIPSIS = 'text-[var(--dsw-alias-label-tertiary)]'
const COPY_ANCHOR = 'fixed z-[3] inline-flex'
const COPY_BUTTON =
  'inline-flex items-center justify-center w-5 h-4 m-0 p-0 border-0 rounded-[3px] text-[var(--dsw-alias-label-secondary)] bg-[var(--dsw-alias-bg-layer-1)] shadow-[-5px_0_5px_var(--dsw-alias-bg-layer-1)] cursor-pointer hover:text-[var(--dsw-alias-label-primary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] focus-visible:outline-1 focus-visible:outline-[var(--dsw-alias-state-business-primary)] focus-visible:outline-offset-[-1px] data-[state=failed]:text-[var(--dsw-alias-state-error-primary)]'
const EXPANDER =
  'jt-expander absolute z-[2] top-0 left-0 inline-flex items-center justify-start w-2 h-4 m-0 text-[var(--json-tree-icon)] cursor-pointer select-none hover:text-[var(--dsw-alias-label-primary)] focus-visible:outline-none'
