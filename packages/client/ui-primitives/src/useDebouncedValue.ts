/**
 * useDebouncedValue: returns `value` after it has stayed unchanged for
 * `delayMs` milliseconds. Used by search inputs (Smithery, skills.sh) so the
 * RPC only fires once typing settles instead of once per keystroke.
 *
 * This is purely component-local state; no Cordis subscription. The trailing
 * edge fires `delayMs` after the most recent `value` change, so a fast typer
 * who stops on a final query still gets exactly one resolved search.
 */

import { useEffect, useState } from 'react'

const DEFAULT_DELAY_MS = 300

/**
 * Debounced mirror of `value`. Resets its timer on every change; the returned
 * value only updates after the trailing edge elapses without further input.
 * @param value - live value to mirror (typically a search query).
 * @param delayMs - quiet period required before the debounced value advances.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = DEFAULT_DELAY_MS): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delayMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delayMs])

  return debounced
}
