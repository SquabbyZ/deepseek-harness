/** Trajectory toolbar: timeline and ledger fold controls. */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'

export interface TrajectoryToolbarProps {
  /** Whether timeline blocks use recorded durations instead of equal widths. */
  actualDuration: boolean
  /** Select recorded-duration or equal-width blocks. */
  onActualDurationChange: (actualDuration: boolean) => void
  /** Whether recorded timing retains idle gaps between operations. */
  actualTime: boolean
  /** Select complete wall-clock timing or idle-compressed timing. */
  onActualTimeChange: (actualTime: boolean) => void
  /** Whether every collapsible turn is currently folded. */
  allTurnsCollapsed: boolean
  /** Fold or expand every collapsible turn. */
  onToggleAllTurns: () => void
  /** Whether every collapsible assistant's tool calls are currently folded. */
  allAssistantsCollapsed: boolean
  /** Fold or expand tool calls under every collapsible assistant. */
  onToggleAllAssistants: () => void
  /** Current live ledger search query. */
  searchQuery: string
  /** Update the live ledger search query. */
  onSearchQueryChange: (query: string) => void
  /** Translate a toolbar dictionary key. */
  t: TranslateNS<typeof NS>
}

/**
 * Render the sticky trajectory toolbar.
 * @param props - rendered counts and whole-list fold state.
 * @returns the toolbar element.
 */
export function TrajectoryToolbar({
  actualDuration,
  onActualDurationChange,
  actualTime,
  onActualTimeChange,
  allTurnsCollapsed,
  onToggleAllTurns,
  allAssistantsCollapsed,
  onToggleAllAssistants,
  searchQuery,
  onSearchQueryChange,
  t,
}: TrajectoryToolbarProps) {
  return (
    <div className="sticky top-0 z-[4] h-[var(--dsh-trajectory-toolbar-height)] w-full box-border border-b border-border bg-card" role="toolbar" aria-label={t('toolbar.aria')}>
      <div className="flex h-full w-full items-center gap-2 box-border px-1.5">
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            className="inline-flex h-5 flex-none items-center gap-1 rounded-[3px] border-0 bg-transparent px-[7px] text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xxs-12)] cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-foreground aria-pressed:bg-[var(--dsw-alias-interactive-bg-hover)] aria-pressed:text-foreground focus-visible:[outline:1px_solid_var(--dsw-alias-state-business-primary)] focus-visible:[outline-offset:1px]"
            aria-label={t('toolbar.useActualDuration')}
            aria-pressed={actualDuration}
            title={actualDuration ? t('toolbar.useEqualWidth') : t('toolbar.useActualDuration')}
            onClick={() => { onActualDurationChange(!actualDuration) }}
          >
            <svg
              className="h-3 w-3 flex-none [stroke:currentColor] [stroke-width:1.25] [stroke-linecap:round] [stroke-linejoin:round]"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.25" />
              <path d="M8 4.75V8l2.25 1.5" />
            </svg>
            {t('toolbar.duration')}
          </button>
          <button
            type="button"
            className="hidden"
            role="switch"
            aria-checked={actualTime}
            onClick={() => { onActualTimeChange(!actualTime) }}
          >
            <span>{t('toolbar.actualTime')}</span>
            <span className="group relative inline-block h-2.5 w-5 flex-none rounded-[5px] bg-[var(--dsw-alias-border-l2)] transition-colors duration-[120ms] ease-[var(--ds-ease-in-out)] data-[on=true]:bg-[var(--dsw-alias-state-business-primary)]" data-on={actualTime || undefined} aria-hidden="true">
              <span className="absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-card transition-transform duration-[120ms] ease-[var(--ds-ease-in-out)] group-data-[on=true]:translate-x-2.5" />
            </span>
          </button>
          <button
            type="button"
            className="inline-flex h-5 flex-none items-center gap-1 rounded-[3px] border-0 bg-transparent px-[5px] text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xxs-12)] cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-foreground focus-visible:[outline:1px_solid_var(--dsw-alias-state-business-primary)] focus-visible:[outline-offset:1px]"
            aria-label={allTurnsCollapsed ? t('toolbar.expandTurns') : t('toolbar.collapseTurns')}
            aria-pressed={allTurnsCollapsed}
            title={allTurnsCollapsed ? t('toolbar.expandTurns') : t('toolbar.collapseTurns')}
            onClick={onToggleAllTurns}
          >
            <span className="text-[var(--dsw-alias-label-tertiary)] [font:14px/14px_var(--ds-font-family-code)]" aria-hidden="true">
              {allTurnsCollapsed ? '⊞' : '⊟'}
            </span>
            {t('toolbar.turns')}
          </button>
          <button
            type="button"
            className="inline-flex h-5 flex-none items-center gap-1 rounded-[3px] border-0 bg-transparent px-[5px] text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xxs-12)] cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-foreground focus-visible:[outline:1px_solid_var(--dsw-alias-state-business-primary)] focus-visible:[outline-offset:1px]"
            aria-label={allAssistantsCollapsed ? t('toolbar.expandCalls') : t('toolbar.collapseCalls')}
            aria-pressed={allAssistantsCollapsed}
            title={allAssistantsCollapsed ? t('toolbar.expandCalls') : t('toolbar.collapseCalls')}
            onClick={onToggleAllAssistants}
          >
            <span className="text-[var(--dsw-alias-label-tertiary)] [font:14px/14px_var(--ds-font-family-code)]" aria-hidden="true">
              {allAssistantsCollapsed ? '⊞' : '⊟'}
            </span>
            {t('toolbar.calls')}
          </button>
        </div>
        <div className="ml-auto flex h-[22px] min-w-[84px] flex-[0_1_164px] items-center gap-1 rounded border border-border bg-[var(--dsw-alias-bg-layer-2)] px-1.5 text-[var(--dsw-alias-label-caption)] hover:border-[var(--dsw-alias-label-caption)] focus-within:border-[var(--dsw-alias-state-business-primary)] focus-within:bg-card">
          <IconSearchOutline16 size={11} className="flex-none" />
          <input
            type="search"
            className="ttb-search-input min-w-0 w-full border-0 bg-transparent p-0 text-foreground outline-none [font:var(--dsw-font-xxs-12)] placeholder:text-[var(--dsw-alias-label-caption)]"
            aria-label={t('toolbar.search')}
            placeholder={t('toolbar.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => { onSearchQueryChange(event.currentTarget.value) }}
          />
        </div>
      </div>
    </div>
  )
}
