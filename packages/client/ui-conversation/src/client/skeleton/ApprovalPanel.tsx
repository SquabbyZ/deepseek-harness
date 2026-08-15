// ApprovalPanel: the composer-takeover approval prompt (designer draft
// approval.png), registered as a selector-routed entry of the
// conversation-declared composer chain. While an approval question is
// pending, this panel occupies the composer slot in place of the InputBar:
// an amber "Waiting for approval" strip on the card top, the model's
// justification as the headline, the paired command in muted code text, and
// a right-aligned refuse/allow action row. Justification and command are
// unbounded model text, so they scroll inside the card at the shared composer
// cap (`data-approval-scroll`) and the action row stays outside it — the
// buttons must be reachable no matter how long the command is.
// One-shot: the buttons disable
// after a click and the panel leaves (the InputBar returns) on the broadcast
// resolved frame.

import { useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { PendingApproval, type ApprovalComposerProps } from '../contract/slots.ts'
import { rootToolCall } from '../chat/tool-node-reader.ts'

/** Extract the shell command from an approval's paired running call (bash-family args carry `command`); undefined hides the line. */
export function commandOf(call: RunningToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    return typeof args.command === 'string' ? args.command : undefined
  } catch {
    // Unparseable model args: the panel still renders, just without the command line.
    return undefined
  }
}

/**
 * Composer takeover boundary: mints the domain face on the carrier's stable
 * identity and remounts the flow per request key, so the one-shot answered
 * latch never leaks to the next pending approval.
 * @param props - the selector-matched pending approval carrier plus the framework standard kit.
 * @returns The approval prompt for this request.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = useMemo(() => new PendingApproval(props.matched), [props.matched])
  const command = props.useSession((snapshot) => {
    if (approval.callId === undefined) return undefined
    const root = rootToolCall(snapshot, approval.callId)
    if (root === undefined) return undefined
    return root.callId === approval.callId && !('kind' in root) ? commandOf(root) : undefined
  })
  return <ApprovalFlow key={approval.key} pending={approval} t={props.t} {...command === undefined ? {} : { command }} />
}

function ApprovalFlow({ pending, command, t }: {
  pending: PendingApproval
  command?: string
  t: ApprovalComposerProps['t']
}) {
  // Local one-shot latch: the panel leaves only when the resolved frame
  // lands; until then the buttons must not re-fire. An answer failure
  // (rejected receipt / transport) re-arms them for retry.
  const [answered, setAnswered] = useState(false)
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    setAnswered(true)
    void pending.answer(outcome).catch(() => { setAnswered(false) })
  }
  return (
    <div className="flex flex-col items-center px-[calc(var(--dsh-composer-side-clearance)_+_16px)] pt-2 pb-3" data-approval-key={pending.key}>
      <div className="w-full max-w-[var(--dsh-chat-content-width)] overflow-hidden rounded-[20px] border border-[var(--dsw-alias-state-warn-secondary)] bg-[var(--dsw-specific-input-major)] shadow-[var(--dsw-shadow-lv2)] [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)]">
        <div className="flex items-center gap-2 bg-[var(--dsw-alias-state-warn-tertiary)] px-4 py-2.5 text-[13px] leading-[18px] text-[var(--dsw-alias-state-warn-primary)]"><span className="h-2 w-2 rounded-full bg-[var(--dsw-alias-state-warn-primary)]" />{t('approval.waiting')}</div>
        {/* Tab stop: the region scrolls once the command passes the cap and
            holds nothing focusable of its own, so without one a keyboard-only
            user cannot reach the command's tail before answering. */}
        <div className="box-border flex max-h-[var(--dsh-composer-text-max-height)] flex-col gap-1.5 overflow-y-auto px-4 pt-3" data-approval-scroll="" tabIndex={0} role="group" aria-label={t('approval.detail.aria')}>
          <div className="text-[15px] font-medium leading-6 text-foreground">{pending.reason ?? t('approval.escalation', { toolName: pending.toolName })}</div>
          {command !== undefined && <div className="break-all text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)] [font-family:var(--ds-font-family-code)]">{command}</div>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3.5">
          <Button variant="outline" className="hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover-danger)] hover:enabled:text-[var(--dsw-alias-state-error-primary)] hover:enabled:border-transparent" disabled={answered} onClick={() => { answer('rejected') }}>
            {t('approval.reject')}
          </Button>
          <Button variant="primary" disabled={answered} onClick={() => { answer('allowed-once') }}>
            {t('approval.allowOnce')}
          </Button>
        </div>
      </div>
    </div>
  )
}
