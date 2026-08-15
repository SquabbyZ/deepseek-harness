// Queue dock entry: renders the authoritative transient inbox snapshot and
// addresses per-row mutations through the session-scoped conversation face.
//
// The 'conversation.input.dock' SlotMap declaration lives in
// ../contract/slots.ts beside the other input-region slots.
import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useId, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, IconQueueOutline14, IconSendOutline14, IconTrashOutline16, ShadcnButton, ShadcnInput, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueAction, QueueItemId } from '../contract/queue.ts'
import { NS } from '../locales.ts'

/** Shared 28px circular icon-button chrome for the per-row queue actions. */
const ACTION_CLASS =
  'grid h-7 w-7 flex-none place-items-center rounded-full bg-transparent p-0 text-[var(--dsw-alias-label-tertiary)] hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-label-tertiary)] focus-visible:outline-offset-[-2px] focus-visible:ring-0 disabled:cursor-default disabled:opacity-45'

/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
  updateQueue: (itemId: QueueItemId, action: QueueAction) => Promise<void>
  notify: (level: 'info' | 'error', text: string) => void
}

/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>

/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header; an empty queue renders nothing.
 */
export function QueueDock({ useSession, updateQueue, notify, t }: QueueDockProps) {
  const inbox = useSession(s => s.queue)
  const queue = useMemo(() => inbox.filter(row => row.placement === 'queued'), [inbox])
  const running = useSession(s => s.running)
  const queueMutable = useSession(s => s.subagent === null)
  const [editing, setEditing] = useState<{ id: QueueItemId; text: string } | null>(null)
  const [busy, setBusy] = useState<QueueItemId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()

  useEffect(() => {
    if (queue.length === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!queueMutable || !queue.some(row => row.id === editing.id))) setEditing(null)
  }, [collapsed, editing, queue, queueMutable])

  if (queue.length === 0) return null

  const interactionActive = queueMutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive
  const listVisible = queue.length === 1 || expanded

  const applyAction = async (
    itemId: QueueItemId,
    action: QueueAction,
    failure: string,
  ): Promise<boolean> => {
    setBusy(itemId)
    try {
      await updateQueue(itemId, action)
      return true
    } catch {
      notify('error', failure)
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null || editing.text.trim() === '') return
    if (await applyAction(
      editing.id,
      { kind: 'edit', content: [{ type: 'text', text: editing.text }] },
      t('queue.editFailed'),
    )) setEditing(null)
  }

  return (
    <div className="box-border mx-auto mb-[calc(0px_-_var(--dsh-composer-stack-gap)_-_3px)] w-[calc(100%_-_2*var(--dsh-composer-side-clearance)_-_2*var(--dsh-composer-dock-inset))] max-w-[calc(var(--dsh-composer-card-max-width)_-_2*var(--dsh-composer-dock-inset))] flex-none px-[var(--dsh-composer-dock-inset)]" data-queue-dock="">
      <div className="relative w-full overflow-hidden rounded-t-xl bg-[var(--dsw-specific-tip)] py-0.5 dsh-queue-panel [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)]">
        {queue.length > 1 && (
          <ShadcnButton
            variant="ghost"
            className="box-border flex h-9 w-full items-center justify-start gap-2.5 rounded-lg bg-transparent px-3 py-1 text-left text-foreground hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-label-tertiary)] focus-visible:outline-offset-[-2px] focus-visible:ring-0 disabled:cursor-default"
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <span className="grid flex-none place-items-center text-[var(--dsw-alias-label-tertiary)]" aria-hidden><IconQueueOutline14 /></span>
            <span className="min-w-0 flex-auto text-[13px] font-medium leading-6 [font-family:Inter,var(--dsw-font-family)]">{t('queue.count', { n: queue.length })}</span>
            <span className="grid h-[14px] w-[14px] flex-none place-items-center text-[var(--dsw-alias-label-tertiary)]" aria-hidden>
              {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
            </span>
          </ShadcnButton>
        )}
        <ul id={listId} className="m-0 max-h-[180px] list-none overflow-y-auto p-0" hidden={!listVisible}>
          {listVisible && queue.map(row => (
            <li key={row.id} className="box-border flex h-9 w-full items-center gap-2.5 rounded-lg pt-1 pr-[5px] pb-1 pl-3 not-first:shadow-[inset_0_1px_0_var(--dsw-alias-border-l1)]">
              {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
              {queue.length === 1 && <span className="grid flex-none place-items-center text-[var(--dsw-alias-label-tertiary)]" aria-hidden><IconQueueOutline14 /></span>}
              {editing?.id === row.id
                ? (
                  <ShadcnInput
                    autoFocus
                    className="h-7 w-auto min-w-0 flex-auto rounded-md border border-border bg-background px-2 py-0 text-[13px] leading-5 text-foreground [font-family:Inter,var(--dsw-font-family)] shadow-none outline-none focus-visible:ring-0 focus-visible:border-[var(--dsw-alias-state-business-primary)]"
                    aria-label={t('queue.edit')}
                    value={editing.text}
                    onChange={(event) => { setEditing({ id: row.id, text: event.currentTarget.value }) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditing(null)
                        return
                      }
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void saveEdit()
                      }
                    }}
                  />
                )
                : <span className="min-w-0 flex-auto overflow-hidden text-[13px] leading-5 text-[var(--dsw-alias-label-primary-dimmed)] text-ellipsis whitespace-nowrap break-words [font-family:Inter,var(--dsw-font-family)]">{row.preview}</span>}
              {queueMutable && <div className="flex flex-none items-center gap-2.5">
                {editing?.id === row.id
                  ? (
                    <>
                      <Tooltip label={t('queue.save')} side="bottom" delayMs={500}>
                        <ShadcnButton
                          variant="ghost"
                          className={ACTION_CLASS}
                          aria-label={t('queue.save')}
                          disabled={busy !== null || editing.text.trim() === ''}
                          onClick={() => { void saveEdit() }}
                        >
                          <IconCheckOutline16 size={14} />
                        </ShadcnButton>
                      </Tooltip>
                      <Tooltip label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                        <ShadcnButton
                          variant="ghost"
                          className={ACTION_CLASS}
                          aria-label={t('queue.cancelEdit')}
                          disabled={busy !== null}
                          onClick={() => { setEditing(null) }}
                        >
                          <IconCloseOutline16 size={14} />
                        </ShadcnButton>
                      </Tooltip>
                    </>
                  )
                  : (
                    <>
                      <Tooltip label={t('queue.edit')} side="bottom" delayMs={500} disabled={row.text === null}>
                        <ShadcnButton
                          variant="ghost"
                          className={ACTION_CLASS}
                          aria-label={t('queue.edit')}
                          // Disabled buttons fire no hover events, so the
                          // unsupported hint stays a native title.
                          title={row.text === null ? t('queue.edit.unsupported') : undefined}
                          disabled={busy !== null || row.text === null}
                          onClick={() => {
                            if (row.text !== null) setEditing({ id: row.id, text: row.text })
                          }}
                        >
                          <IconEditOutline16 size={14} />
                        </ShadcnButton>
                      </Tooltip>
                      <Tooltip label={t('queue.remove')} side="bottom" delayMs={500}>
                        <ShadcnButton
                          variant="ghost"
                          className={ACTION_CLASS}
                          aria-label={t('queue.remove')}
                          disabled={busy !== null}
                          onClick={() => {
                            void applyAction(
                              row.id,
                              { kind: 'remove' },
                              t('queue.removeFailed'),
                            )
                          }}
                        >
                          <IconTrashOutline16 size={14} />
                        </ShadcnButton>
                      </Tooltip>
                      <Tooltip label={t('queue.steer')} side="bottom" delayMs={500} disabled={!running}>
                        <ShadcnButton
                          variant="ghost"
                          className={ACTION_CLASS}
                          aria-label={t('queue.steer')}
                          title={running ? undefined : t('queue.steer.unavailable')}
                          disabled={busy !== null || !running}
                          onClick={() => {
                            void applyAction(
                              row.id,
                              { kind: 'steer' },
                              t('queue.steerFailed'),
                            )
                          }}
                        >
                          <IconSendOutline14 />
                        </ShadcnButton>
                      </Tooltip>
                    </>
                  )}
              </div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * The dock entry as a plain registrant plugin. The conversation service is
 * the action contract; the slot declaration has an independent lifecycle boundary.
 */
export const queueDockEntry = {
  name: 'conversation-queue-dock',
  inject: ['slots', 'conversation', 'sessions'],
  /**
   * Register the queue strip as the terminal input-dock entry (order 20).
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'queue',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId): QueueDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
        const conversation = actx.get('conversation')
        if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
        return {
          updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
          notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
        }
      },
    }, QueueDock))
  },
}
