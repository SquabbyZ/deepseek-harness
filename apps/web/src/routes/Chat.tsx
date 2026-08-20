/**
 * Chat — composer mock + slot registry dump.
 *
 * The original DSH Chat (`ui-conversation/ChatView`) needs a fully-mounted
 * session runtime (current session id, session list store, conversation
 * timeline). Those plugins (`dsh_session_*`, `dsh_jobs_local`) are
 * commented out of the inbox while their Tauri-side equivalents land,
 * so we can't drive a real conversation here yet.
 *
 * What this route DOES render: every `conversation.*` slot registered by the
 * in-box ui plugins (ui-goal's chat-node slot, ui-model-selection's input
 * slot, ui-trajectory's view slot, etc.). That way the dev loop confirms
 * each plugin's apply() actually ran, even before sessions land.
 *
 * The composer mock (textarea + echo) is preserved from the 2.6.3 stub so
 * the route is still usable for typing-tests once sessions land.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useHost } from '../dsh/host-context.tsx'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

interface Message {
  readonly id: number
  readonly role: 'user'
  readonly text: string
}

/** Pull every slot entry whose key starts with `conversation.`. */
function useConversationSlots(): readonly { key: string; entries: readonly StoredEntry[] }[] {
  const { ctx } = useHost()
  // The SlotRegistry keeps a private map of declared slots. We don't have
  // an "all keys" accessor, so list the candidate keys the ui-* plugins
  // document and read each one. Adding a new plugin slot here is intentional.
  const keys = [
    'conversation.chat.node',
    'conversation.input.model',
    'conversation.input.dock',
    'conversation.input.overlay',
    'conversation.input.plan',
    'conversation.chat.assistant-actions',
    'conversation.view',
    'conversation.hero.workspace.directoryFlow',
  ] as const
  const [slots, setSlots] = useState(() => readAll())
  function readAll(): readonly { key: string; entries: readonly StoredEntry[] }[] {
    return keys.map(key => ({
      key,
      entries: ctx.slots.entries(key) as readonly StoredEntry[],
    }))
  }
  useEffect(() => {
    const offs = keys.map(key => ctx.on('slots/changed', (changed: string) => {
      if (changed === key) setSlots(readAll())
    }))
    return () => { offs.forEach((off) => { void off }) }
  }, [ctx])
  return slots
}

export function Chat(): ReactNode {
  const [draft, setDraft] = useState<string>('')
  const [messages, setMessages] = useState<readonly Message[]>([])
  const slots = useConversationSlots()

  function handleSend(): void {
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    setMessages(prev => [...prev, { id: prev.length + 1, role: 'user', text: trimmed }])
    setDraft('')
  }

  const registeredSlots = slots.filter(s => s.entries.length > 0)
  const total = registeredSlots.reduce((n, s) => n + s.entries.length, 0)

  return (
    <div className="p-4 max-w-3xl mx-auto flex flex-col h-[calc(100vh-3rem)]" data-testid="chat-root">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-gray-500">
          {total === 0
            ? 'No conversation slots registered yet — the session runtime (Phase 2 S6) is the gate for a real chat timeline.'
            : `${total} conversation slot entry${total === 1 ? '' : 'ies'} registered by in-box ui-* plugins (Phase 2 S9 wiring TBD).`}
        </p>
      </header>

      <ul className="flex-1 overflow-y-auto mb-3 space-y-2">
        {messages.length === 0 && (
          <li className="text-gray-500 text-sm">No messages yet.</li>
        )}
        {messages.map(m => (
          <li
            key={m.id}
            className="rounded bg-white/5 px-3 py-2 text-sm whitespace-pre-wrap"
          >
            <span className="text-xs text-gray-500 mr-2 font-mono">user</span>
            {m.text}
          </li>
        ))}
      </ul>

      {registeredSlots.length > 0 && (
        <details className="mb-3 text-xs text-gray-500">
          <summary className="cursor-pointer">Registered slots ({total})</summary>
          <ul className="mt-2 space-y-1 pl-3">
            {registeredSlots.map(s => (
              <li key={s.key}>
                <code className="font-mono">{s.key}</code> · {s.entries.length} entr{s.entries.length === 1 ? 'y' : 'ies'}
              </li>
            ))}
          </ul>
        </details>
      )}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          handleSend()
        }}
      >
        <textarea
          aria-label="Message draft"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          rows={2}
          placeholder="Type a message…"
          className="flex-1 resize-none rounded border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          className="px-4 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}
