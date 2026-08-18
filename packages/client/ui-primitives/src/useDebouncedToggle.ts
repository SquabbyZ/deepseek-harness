// useDebouncedToggle: a per-entry-id toggle orchestrator shared by every UI
// list that flips a Cordis-controlled switch (plugin inventory, skill, mcp,
// agent). It coalesces rapid clicks into one RPC, aborts any in-flight commit
// when a new click arrives, and never subscribes to anything external — it is
// purely component-local state under the packages/client/AGENTS.md rule 4
// carve-out.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Default debounce window. Matches the original spec for plugin inventory. */
const DEFAULT_DEBOUNCE_MS = 500

/** Action one commit dispatches. */
export interface DebouncedToggleAction<TId extends string = string> {
  readonly entryId: TId
  readonly enabled: boolean
}

/** Options passed to {@link useDebouncedToggle}. */
export interface UseDebouncedToggleOptions<TId extends string> {
  /** RPC commit handler. Receives a fresh `AbortSignal` for every flush. */
  readonly commit: (action: DebouncedToggleAction<TId>, signal: AbortSignal) => Promise<void>
  /** Debounce window in ms. Default 500. */
  readonly debounceMs?: number
  /** Invoked on commit failure (excluding abort-driven cancellations). */
  readonly onError?: (action: DebouncedToggleAction<TId>, error: unknown) => void
  /**
   * Optional no-op skip: when this returns true the schedule is treated as a
   * no-op (no debounce timer, no commit). Useful when an entry's intended
   * value already matches the committed one.
   */
  readonly isCommitted?: (entryId: TId, intended: boolean) => boolean
}

/** Imperative surface returned by {@link useDebouncedToggle}. */
export interface UseDebouncedToggleApi<TId extends string> {
  /** True while a commit for `entryId` is in flight. */
  readonly isPending: (entryId: TId) => boolean
  /** Record an intended state; coalesces into one commit after `debounceMs`. */
  readonly schedule: (entryId: TId, enabled: boolean) => void
  /**
   * Cancel every pending timer and abort every in-flight commit. Does NOT
   * force a flush — uncommitted toggles are lost; the next mount re-reads
   * the persisted state.
   */
  readonly reset: () => void
  /**
   * Optimistic intended state per entry id. The renderer reads
   * `intended.get(id) ?? committed[id]` to draw the optimistic switch.
   * Returns a fresh empty Map when no entry has a pending intended value.
   */
  readonly intendedSnapshot: () => ReadonlyMap<TId, boolean>
}

/**
 * Per-entry debounced toggle orchestrator.
 * @param options - commit handler, debounce window, and optional error/commited callbacks.
 * @returns imperative `isPending`/`schedule`/`reset` API.
 */
export function useDebouncedToggle<TId extends string = string>(
  options: UseDebouncedToggleOptions<TId>,
): UseDebouncedToggleApi<TId> {
  const { commit, onError, isCommitted } = options
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  // `options` is intentionally referenced only via its destructured members;
  // linting flags the alias as unused.
  void options

  // Refs survive renders without invalidating the callbacks below.
  const timersRef = useRef<Map<TId, ReturnType<typeof setTimeout>>>(new Map())
  const controllersRef = useRef<Map<TId, AbortController>>(new Map())
  const pendingRef = useRef<Set<TId>>(new Set())
  // Bumped on every schedule/flush so the unmount effect can drop stale work.
  const generationRef = useRef(0)

  // `intended` is local optimistic state the render layer reads. It does NOT
  // subscribe to anything external; the commit success path clears the entry.
  const [intended, setIntended] = useState<Map<TId, boolean>>(() => new Map())

  // Latest callbacks in refs so the stable schedule/reset never go stale.
  const commitRef = useRef(commit)
  const onErrorRef = useRef(onError)
  const isCommittedRef = useRef(isCommitted)
  commitRef.current = commit
  onErrorRef.current = onError
  isCommittedRef.current = isCommitted

  const flush = useCallback((entryId: TId, enabled: boolean): void => {
    // Abort any in-flight commit for this id so its success path can't
    // overwrite the new in-flight one's intended state.
    const existing = controllersRef.current.get(entryId)
    if (existing !== undefined) existing.abort()

    const controller = new AbortController()
    controllersRef.current.set(entryId, controller)
    pendingRef.current.add(entryId)
    setIntended((prev) => {
      const next = new Map(prev)
      next.set(entryId, enabled)
      return next
    })

    const generation = generationRef.current
    commitRef.current({ entryId, enabled }, controller.signal).then(
      () => {
        if (generation !== generationRef.current) return
        controllersRef.current.delete(entryId)
        pendingRef.current.delete(entryId)
        setIntended((prev) => {
          if (!prev.has(entryId)) return prev
          const next = new Map(prev)
          next.delete(entryId)
          return next
        })
      },
      (error: unknown) => {
        if (generation !== generationRef.current) return
        controllersRef.current.delete(entryId)
        pendingRef.current.delete(entryId)
        // AbortError is the expected path when a new click supersedes an
        // in-flight one — silently drop it.
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (controller.signal.aborted) return
        // Roll back optimistic state so the UI reverts.
        setIntended((prev) => {
          if (!prev.has(entryId)) return prev
          const next = new Map(prev)
          next.delete(entryId)
          return next
        })
        onErrorRef.current?.({ entryId, enabled }, error)
      },
    )
  }, [])

  const schedule = useCallback((entryId: TId, enabled: boolean): void => {
    if (isCommittedRef.current?.(entryId, enabled) === true) return

    setIntended((prev) => {
      const next = new Map(prev)
      next.set(entryId, enabled)
      return next
    })

    const existing = timersRef.current.get(entryId)
    if (existing !== undefined) clearTimeout(existing)

    const timer = setTimeout(() => {
      timersRef.current.delete(entryId)
      flush(entryId, enabled)
    }, debounceMs)
    timersRef.current.set(entryId, timer)
  }, [debounceMs, flush])

  const reset = useCallback((): void => {
    generationRef.current += 1
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    pendingRef.current.clear()
    setIntended(new Map())
  }, [])

  // Abort in-flight work on unmount; do NOT force-flush pending timers.
  useEffect(() => {
    return () => {
      generationRef.current += 1
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      for (const controller of controllersRef.current.values()) controller.abort()
    }
  }, [])

  const isPending = useCallback((entryId: TId): boolean => pendingRef.current.has(entryId), [])

  const intendedSnapshot = useCallback((): ReadonlyMap<TId, boolean> => intended, [intended])

  return useMemo<UseDebouncedToggleApi<TId>>(
    () => ({ isPending, schedule, reset, intendedSnapshot }),
    [isPending, schedule, reset, intendedSnapshot],
  )
}
