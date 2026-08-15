// Legacy standalone trajectory cell retained for direct consumers and specs.

import {
  formatElapsedSeconds,
  type TrajectoryCellKind,
  type TrajectoryCellProps,
} from './trajectory-record.ts'

export { formatElapsedSeconds }
export type {
  AssistantMetricDetail,
  TrajectoryCellKind,
  TrajectoryCellProps,
} from './trajectory-record.ts'

/** Display label per kind (matches the design tags). */
const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'System',
  user: 'User',
  context: 'Context',
  compacted: 'Compacted',
  message: 'Message',
  tool: 'Tool',
  subtool: 'Sub',
}

const TAG_CLASS: Record<TrajectoryCellKind, string | undefined> = {
  system: 'text-[var(--dsw-alias-label-secondary)] bg-[var(--dsw-alias-bg-module-platform)]',
  user: 'text-[var(--dsw-alias-state-success-primary)] bg-[var(--dsw-alias-state-success-tertiary)]',
  context: 'text-[color-mix(in_srgb,var(--dsw-alias-state-success-primary)_68%,var(--dsw-alias-label-secondary))] bg-[var(--dsw-alias-state-success-tertiary)]',
  compacted: 'text-[var(--dsw-alias-label-secondary)] bg-[var(--dsw-alias-bg-module-platform)]',
  message: 'text-[color-mix(in_srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color)_60%,var(--dsw-alias-state-error-secondary))] bg-[color-mix(in_srgb,color-mix(in_srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color)_55%,var(--dsw-alias-state-error-secondary))_15%,var(--dsw-alias-bg-layer-1))]',
  tool: 'text-[var(--dsw-alias-state-warn-label)] bg-[var(--dsw-alias-state-warn-tertiary)]',
  subtool: 'text-[color-mix(in_srgb,var(--dsw-alias-state-warn-label)_62%,var(--dsw-alias-label-tertiary))] bg-[color-mix(in_srgb,var(--dsw-alias-state-warn-tertiary)_58%,var(--dsw-alias-bg-layer-1))]',
}

/**
 * Render one trajectory step cell.
 * @param props - index, kind, text, time, and optional Message metrics.
 * @returns the cell element.
 */
export function TrajectoryCell({
  index,
  kind,
  text,
  inputDetail: _inputDetail,
  promptDetail: _promptDetail,
  previousPromptDetail: _previousPromptDetail,
  outputDetail: _outputDetail,
  thinkingDetail: _thinkingDetail,
  sourceBlocks: _sourceBlocks,
  outputBlocks: _outputBlocks,
  schemaDetail: _schemaDetail,
  assistantMetrics: _assistantMetrics,
  result: _result,
  callId: _callId,
  isError: _isError,
  timeSeconds,
  startedAt: _startedAt,
  input,
  output,
  think,
  selected = false,
  className,
  ...rest
}: TrajectoryCellProps) {
  const rootClass = [
    'flex h-[38px] min-w-0 items-center gap-6 box-border rounded-lg border border-border bg-popover pl-5 pr-2 data-[kind=subtool]:pl-7',
    selected ? 'border-transparent [box-shadow:inset_0_0_0_2px_var(--dsw-alias-brand-primary-new-colorprimary-new-color)]' : undefined,
    className,
  ].filter((c): c is string => c !== undefined).join(' ')
  const showMetrics = kind === 'message'
  return (
    <div className={rootClass} data-kind={kind} data-selected={selected || undefined} {...rest}>
      <span className="w-6 flex-none text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xs-13)]">#{index}</span>
      <span className="flex w-20 min-w-0 flex-none items-center">
        <span className={['inline-flex h-[22px] max-w-full items-center whitespace-nowrap rounded-md px-1 box-border [font:var(--dsw-font-xs-strong-13)]', TAG_CLASS[kind]].filter((c): c is string => c !== undefined).join(' ')}>{KIND_LABEL[kind]}</span>
      </span>
      <span className="min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap text-foreground [font:var(--dsw-font-xs-13)]">{text}</span>
      <span className="flex w-80 min-w-0 flex-none items-center justify-end gap-3">
        {showMetrics ? (
          <>
            <span className="w-[71px] flex-none whitespace-nowrap text-left text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xs-13)]">{input ?? ''}</span>
            <span className="w-[71px] flex-none whitespace-nowrap text-left text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xs-13)]">{output ?? ''}</span>
            <span className="w-[71px] flex-none whitespace-nowrap text-left text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xs-13)]">{think ?? ''}</span>
          </>
        ) : null}
        <span className="w-[71px] flex-none whitespace-nowrap text-left text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xs-13)]">{formatElapsedSeconds(timeSeconds)}</span>
      </span>
    </div>
  )
}
