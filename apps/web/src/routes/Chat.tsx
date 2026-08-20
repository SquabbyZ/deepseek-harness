/**
 * Chat — official DSH conversation view, reused from
 * `@deepseek-ai/dsh-client-ui-conversation` (master `ChatView`).
 *
 * `ChatView` expects `ChatViewSlotProps` — a large bundle of host-observable
 * hooks (`useSession`, `useSessions`, `useStore`, `renderSlot`, ...) and
 * imperative callbacks (`openFile`, `loadOlder`, `loadImage`, `inspectCall`,
 * `chatScroll`, `forkAt`, `fileMentions`, `t`). Most of those come from
 * the master `dsh_session_persistence` + `dsh_jobs_local` + `dsh_workspace`
 * services that aren't in the vite-dev barrel yet (Phase 2 S5/S6 work per
 * spec §6.4). We wire minimal stubs that satisfy the destructured
 * shapes so the component renders its empty-state layout.
 */
import { type ReactNode } from 'react'
import { ChatView } from '@deepseek-ai/dsh-client-ui-conversation'

/** Empty-state session: a queue with no items, an empty chat ledger,
 * a finished run state, and a no-op openState. Each field is read by
 * ChatView at render time; the exact shape mirrors `ConversationTimelineSnapshot`
 * from `@deepseek-ai/dsh-client-runtime`. */
const emptySession = {
  chat: { order: [], nodes: new Map(), timeline: { order: [] } },
  queue: [] as Array<{ id: string; placement: 'queued' | 'running' }>,
  running: undefined,
  openState: { kind: 'idle' as const },
}

export function Chat(): ReactNode {
  // ChatView passes selectors like `s => s.queue` — emulate the host by
  // calling the selector against an empty-state stub so reads like
  // `s.chat.order` / `s.queue` / `s.byId[sessionId]?.cwd` resolve to
  // sensible empty values.
  const sessionSelector = (sel: (s: typeof emptySession) => unknown) => sel(emptySession)
  const sessionsSelector = (sel: (s: { byId: Record<string, unknown> }) => unknown) =>
    sel({ byId: {} })
  const noopSnapshot = (sel: (s: unknown) => unknown) => sel({
    selection: undefined,
    context: undefined,
    intake: { value: '', placeholder: '' },
  })
  return (
    <div data-testid="chat-root" data-conversation-scroll="" className="flex-1 min-h-0">
      <ChatView
        useSession={sessionSelector}
        useSessions={sessionsSelector}
        useStore={noopSnapshot}
        renderSlot={() => null}
        sessionId={''}
        openFile={() => undefined}
        loadOlder={() => undefined}
        loadImage={() => undefined}
        inspectCall={() => undefined}
        chatScroll={{ canPrepend: false, canScroll: false, scrollToBottom: () => undefined }}
        forkAt={() => undefined}
        fileMentions={[]}
        t={(label: string) => label}
      />
    </div>
  )
}
