/**
 * Shell root: boot loading page → (boot settled) → real UI in one switch.
 * Pure kernel component with zero plugin dependencies — before settled it may
 * only rely on itself (the fail-loud presentation must not depend on the
 * system whose failure it reports; the status/signal stores are kernel-own,
 * shell self-sufficiency rule); the real UI is produced by the
 * app-shell entry once every entry is active. A failed boot keeps the
 * loading page, lists the per-entry fiber states and the sweep report (fail
 * loud, no partial UI).
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KernelSignal, LoaderStatus } from './loader-status.ts'

/**
 * Boot page styles are self-contained: the theme base stylesheets are linked
 * by the shell, but the loading page must render acceptably even before/without
 * them. The keyframe below is inlined here (not in primitives.css) so the boot
 * page never depends on the themed stylesheet.
 */
const BOOT_KEYFRAMES = `
@keyframes boot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
`

/** AppRoot props: settled signal, fiber-state projection feed, boot failure report, deferred real-UI factory. */
export interface AppRootProps {
  /** True once the boot chain settled (loader quiesced + all entries ACTIVE); the boot closure flips it. */
  settled: KernelSignal<boolean>
  /** Per-entry fiber-state projection store (drives loading/failed rendering). */
  status: KernelSignal<LoaderStatus>
  /** Boot failure report (the settle rejection message); undefined while loading or after success. */
  error: KernelSignal<string | undefined>
  /** Builds the real UI; called only after settled. */
  renderApp: () => ReactNode
}

/** Boot gate: loading page until the boot settles; failures stay here. */
export function AppRoot(props: AppRootProps) {
  const settled = useSyncExternalStore(props.settled.subscribe, props.settled.getSnapshot)
  const status = useSyncExternalStore(props.status.subscribe, props.status.getSnapshot)
  const error = useSyncExternalStore(props.error.subscribe, props.error.getSnapshot)
  const failed = Object.entries(status).filter(([, s]) => s === 'failed')

  if (settled) return (
    <>
      {/* Global watermark layer + reserved Live2D anchor, mounted before the
          real UI (renderApp → the 'root' slot / AppFrame). Both are
          non-focusable and never intercept pointer events. */}
      <div className="app-watermark-layer" aria-hidden="true" />
      <div className="app-live2d-anchor" data-live2d-mount />
      {props.renderApp()}
    </>
  )

  const loud = error !== undefined || failed.length > 0

  return (
    <>
      <style>{BOOT_KEYFRAMES}</style>
      <div className="grid h-full place-items-center bg-[var(--dsw-alias-bg-base,#f9fafb)]">
        <div className="flex flex-col items-center gap-4">
          <div className="text-[var(--dsw-alias-label-primary,#0f1115)]">
            <FishLogo size={48} className="animate-[boot-blink_1.4s_ease-in-out_infinite]" />
          </div>
          {loud && (
            <div className="flex max-w-[480px] flex-col gap-2">
              <div className="text-sm font-semibold leading-[22px] text-[var(--dsw-alias-label-primary,#0f1115)]">Failed to load plugins</div>
              {failed.map(([id]) => <div key={id} className="text-xs leading-[18px] text-[var(--dsw-alias-label-secondary,#61666b)] [font-family:var(--ds-font-family-code,ui-monospace,'SF_Mono',Menlo,Consolas,'Courier_New')]">{id}</div>)}
              {error !== undefined && <div className="text-xs leading-[18px] text-[var(--dsw-alias-label-secondary,#61666b)] [font-family:var(--ds-font-family-code,ui-monospace,'SF_Mono',Menlo,Consolas,'Courier_New')]">{error}</div>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
