import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'

/** Why a catalog-addressed conversation cannot accept human input. */
export interface SubagentReadOnlyMatch {
  reason: 'one-shot' | 'parent-unavailable'
}

/** Full chain props after the read-only subagent selector accepts the owner currency. */
export type SubagentReadOnlyComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: SubagentReadOnlyMatch } & PropsLocale<typeof NS>

/**
 * Explain why the normal composer is unavailable for an addressed child.
 * @param props - selector-owned read-only reason plus standard slot props.
 * @returns A read-only composer replacement.
 */
export function SubagentReadOnlyComposer({
  matched, t,
}: Pick<SubagentReadOnlyComposerProps, 'matched' | 't'>) {
  const oneShot = matched.reason === 'one-shot'
  return (
    <div
      className="mx-6 mb-5 flex min-h-[54px] items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 py-2.5 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]"
      role="status"
    >
      <strong className="text-foreground [font-weight:510]">{t(oneShot ? 'readonly.oneShot.title' : 'readonly.title')}</strong>
      <span>
        {t(oneShot ? 'readonly.oneShot.body' : 'readonly.body')}
      </span>
    </div>
  )
}
