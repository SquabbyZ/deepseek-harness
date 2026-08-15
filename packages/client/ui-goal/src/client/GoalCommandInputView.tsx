import { memo } from 'react'
import { MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalCommandInputData } from './goal-command-input.ts'

type GoalCommandInputViewProps =
  PropsRuntime<'conversation.chat.node', 'command-input'>
  & PropsLocale<'goal'>

/** Right-aligned `/goal` input bubble without ordinary message actions. */
export const GoalCommandInputView = memo(function GoalCommandInputView({
  node, t,
}: GoalCommandInputViewProps) {
  const data: GoalCommandInputData = node.data
  return (
    <div
      className="flex flex-col items-end gap-1.5"
      data-command-input=""
      role="group"
      aria-label={t('commandInput.aria')}
    >
      <div className="flex min-w-0 max-w-[min(525px,82%)] flex-col items-end">
        <div className="max-w-full rounded-[22px] bg-[var(--dsw-specific-bubble)] px-4 py-2.5 text-foreground [font:var(--dsw-font-markdown-code)] whitespace-pre-wrap [overflow-wrap:anywhere]">
          <MessageText text={data.text} />
        </div>
      </div>
    </div>
  )
})
