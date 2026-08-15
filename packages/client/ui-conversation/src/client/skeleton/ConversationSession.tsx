/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useEffect, useSyncExternalStore } from 'react'
import { cn, ShadcnButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
}

const DEFAULT_VIEW_ID = 'chat'

/** Resolve by id and keep stale persisted selections on the stable Chat fallback. */
function resolveActiveView(tabs: readonly ViewTab[], selectedId: string | null): ViewTab | undefined {
  const requestedId = selectedId ?? DEFAULT_VIEW_ID
  return tabs.find(view => view.id === requestedId)
    ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({ id: summary.id, displayTitle: summary.displayTitle })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/** Shared breadcrumb-button chrome; the current (disabled) crumb swaps the tint and cursor. */
const CRUMB_BASE =
  'inline-flex h-auto max-w-[220px] items-center justify-start gap-0 overflow-hidden rounded-xl bg-transparent px-2 py-1 text-sm leading-5 text-ellipsis whitespace-nowrap font-normal hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] disabled:opacity-100'

/** Shared tab-button chrome; the active tab swaps the underline and ink. */
const TAB_BASE =
  'relative inline-flex h-auto items-center justify-start gap-0 rounded-none bg-transparent px-0 pt-0 pb-[11px] text-[13px] leading-4 font-medium text-[var(--dsw-alias-label-tertiary)] hover:bg-transparent hover:text-[var(--dsw-alias-label-tertiary)] disabled:opacity-100 dsh-session-tab'

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useStore, actions,
  renderSlot, views, open, t,
}: ConversationSessionHeaderProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const tabs = views.list()
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const hideChrome = blank && composerPhase === 'blank'

  return (
    <header
      className={cn('relative flex-none border-b border-transparent pl-5 pr-7 pt-3 dsh-session-header', hideChrome && 'hidden')}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className="flex min-h-8 items-center gap-0">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <nav className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap" aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  return (
                    <span key={summary.id} className="inline-flex min-w-0 items-center gap-1">
                      {index > 0 && <span className="text-sm leading-5 text-[var(--dsw-alias-label-caption)]">/</span>}
                      <ShadcnButton
                        variant="ghost"
                        className={cn(CRUMB_BASE, last ? 'font-medium text-foreground cursor-default' : 'text-[var(--dsw-alias-label-tertiary)] cursor-pointer')}
                        disabled={last}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </ShadcnButton>
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className="font-medium text-foreground">{sessionId}</span>}
              </nav>
              <div className="flex flex-none items-center gap-2">
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className="ml-5 flex flex-none items-center gap-2 empty:hidden">
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </div>
          {tabs.length > 1 && (
            <div className="relative z-[1] mt-1 flex gap-9 pl-2" role="tablist">
              {tabs.map(viewTab => (
                <ShadcnButton
                  key={viewTab.id}
                  variant="ghost"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  className={cn(TAB_BASE, viewTab.id === active?.id && 'text-[var(--dsw-alias-state-business-primary)] hover:text-[var(--dsw-alias-state-business-primary)] dsh-session-tab-active')}
                  onClick={() => { actions.setView(viewTab.id) }}
                >
                  {viewTab.label}
                </ShadcnButton>
              ))}
            </div>
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  sessionId, useSession, useInput, inputActions, useStore, actions,
  renderSlot, views, bindDraftMirror, releaseSessionImages,
}: ConversationSessionProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const tabs = views.list()
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  // `?? null`: persisted snapshots from before the inspect field rehydrate without it.
  const inspect = useStore(s => s.inspect ?? null)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  useEffect(() => () => {
    releaseSessionImages(sessionId)
  }, [releaseSessionImages, sessionId])

  if (blank && composerPhase === 'blank') return null
  return (
    <div className="flex min-h-0 flex-1 flex-col dsh-session-view">
      {active !== undefined && renderSlot('conversation.view', {
        inspect,
        onInspectDone: () => { actions.setInspect(null) },
      }, { only: active.id })}
    </div>
  )
}
