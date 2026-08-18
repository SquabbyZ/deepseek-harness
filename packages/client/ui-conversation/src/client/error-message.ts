/**
 * Extract a presentable message from an unknown thrown value.
 *
 * The runtime surfaces error reasons through a few shapes: a thrown `Error`,
 * an RPC failure (`{ ok: false, error: { message } }`), or any other value
 * (string, plain object). Settings / onboarding dialogs prefer the message
 * verbatim because the host has already localized it; this helper unwraps the
 * common shapes so a single line carries the reason to the toast.
 *
 * Reused from {@link ../skeleton/ConversationRoot.tsx} and the input-bar
 * promptError toast; the package-private copy avoids a cross-package helper
 * import (client bundle purity gate).
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
