/** Card-aware output body for the selected Tool call in details. */
import { DiffBlock, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolDetailsProps } from '../contract/slots.ts'
import { diffCardModel } from './models/diff-card-model.ts'
import { readCardModel } from './models/read-card-model.ts'
import { searchCardModel } from './models/search-card-model.ts'
import { terminalBlockLabels, terminalCardModel } from './models/terminal-card-model.ts'
import { resultText } from './models/tool-call-model.ts'
import { webCardModel } from './models/web-card-model.ts'

/** Pure details-body inputs; framework session seats stay at the slot boundary. */
interface ToolDetailsContentProps {
  block: ToolDetailsProps['block']
  cwd?: ToolDetailsProps['cwd']
  t: ToolDetailsProps['t']
}

/**
 * Render the selected Tool call's structured output when its presentation
 * intent is known, otherwise preserve the flattened result text.
 * @param props - selected call slice, workspace root, and locale seat.
 * @returns the details output body.
 */
export function ToolDetails({ block, cwd, t }: ToolDetailsContentProps) {
  const terminal = terminalCardModel(block, cwd)
  if (terminal !== null) {
    return (
      <>
        {terminal.description !== undefined ? (
          <div className="mb-1.5 text-[var(--dsw-alias-label-secondary)] [font:var(--dsw-font-xs-13)]">{terminal.description}</div>
        ) : null}
        <TerminalBlock {...terminal.card} labels={terminalBlockLabels(t)} className="m-0" />
      </>
    )
  }
  const read = readCardModel(block, cwd)
  if (read !== null) return <ReadBlock {...read} className="m-0" />
  const diff = diffCardModel(block)
  if (diff !== null) return <DiffBlock {...diff.card} className="m-0" />
  const search = searchCardModel(block)
  if (search !== null) {
    return (
      <>
        <SearchBlock {...search.card} className="m-0" />
        {search.recovery !== undefined ? <div className="mt-1.5 whitespace-pre-wrap text-[var(--dsw-alias-label-tertiary)] [overflow-wrap:anywhere] [font:var(--dsw-font-xs-13)]">{search.recovery}</div> : null}
      </>
    )
  }
  const web = webCardModel(block)
  if (web !== null) {
    const body = 'kind' in block ? resultText(block) : ''
    return (
      <>
        <WebBlock {...web} className="m-0" />
        {body !== '' ? <pre className="m-0 whitespace-pre-wrap rounded-xl bg-[var(--dsw-alias-markdown-code-block)] p-4 text-[13px] leading-[22px] text-foreground [font-family:var(--ds-font-family-code)] [word-break:break-word]">{body}</pre> : null}
      </>
    )
  }
  if (!('kind' in block)) return <div className="py-2 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]">{t('details.running')}</div>
  return (
    <pre className="m-0 whitespace-pre-wrap rounded-xl bg-[var(--dsw-alias-markdown-code-block)] p-4 text-[13px] leading-[22px] text-foreground [font-family:var(--ds-font-family-code)] [word-break:break-word] data-[error]:text-[var(--dsw-alias-state-error-primary)]" data-error={block.isError || undefined}>
      {resultText(block)}
    </pre>
  )
}
