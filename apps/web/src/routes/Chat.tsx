/**
 * Chat — Phase 2 task 2.6.3 placeholder.
 *
 * Deliberately minimal: a composer mock (textarea + send button) plus an
 * echo of the messages typed so far. No Tauri command, no real LLM call —
 * the real conversation UI rides the in-box `dsh_client_ui_conversation`
 * plugin and lands in Phase 2 S6 (session runtime) once `dsh_storage` /
 * `dsh_session_persistence` land in the inbox via the spec §6.4 work.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

interface Message {
  readonly id: number
  readonly role: 'user'
  readonly text: string
}

export function Chat(): ReactNode {
  const [draft, setDraft] = useState<string>('')
  const [messages, setMessages] = useState<readonly Message[]>([])

  function handleSend(): void {
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    setMessages(prev => [
      ...prev,
      { id: prev.length + 1, role: 'user', text: trimmed },
    ])
    setDraft('')
  }

  return (
    <div className="p-4 max-w-3xl mx-auto flex flex-col h-[calc(100vh-3rem)]">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-gray-500">
          Placeholder composer — the real conversation UI lands in Phase 2 S6.
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
