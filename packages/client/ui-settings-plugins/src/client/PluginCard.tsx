/**
 * One plugin's card: a header naming the plugin and what its settings govern,
 * disclosing that plugin's controls in place, with the save that writes them.
 *
 * The header is its own button rather than a shared disclosure row because a
 * card stacks its name over its description, while that row lays the two side
 * by side — the layout, not the behavior, is what differs. Disclosure is
 * card-local state: which card a user has open is a reading gesture, not
 * something the Host or the section has any stake in. Staged edits outlive
 * collapsing, so the header marks a card holding unsaved edits.
 *
 * A card renders nothing while its namespace is unavailable: a deployment that
 * does not compose the owning plugin should show no trace of it, rather than a
 * disabled card the user cannot act on.
 */

import { useState, type ReactNode } from 'react'
import { IconChevronDownOutline14, ShadcnButton, cn } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CardShell } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'

const CARD = 'list-none rounded-xl border border-border bg-popover transition-colors hover:border-[var(--dsw-alias-label-dimmed)]'
const CARD_OPEN = 'border-[var(--dsw-alias-label-dimmed)] bg-[var(--dsw-alias-bg-layer-2)]'
const HEADER = 'h-auto w-full items-center justify-start gap-3 rounded-xl border-0 bg-transparent px-4 py-[14px] text-left text-inherit focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-brand-primary)] focus-visible:-outline-offset-2 focus-visible:ring-0'
const HEAD_TEXT = 'flex min-w-0 flex-1 flex-col gap-1'
const NAME = 'text-[15px] font-semibold leading-[1.4] text-foreground'
const DESCRIPTION = 'text-[13px] leading-[1.5] text-[var(--dsw-alias-label-tertiary)]'
const PENDING = 'flex-none rounded-full px-2 py-px text-[11px] leading-[17px] font-medium whitespace-nowrap bg-[var(--dsw-alias-bg-module-platform)] text-[var(--dsw-alias-label-secondary)]'
const BODY = 'mx-4 border-t border-border pb-2'
const READ_ONLY = 'm-0 mt-3 text-xs leading-[1.5] text-[var(--dsw-alias-label-tertiary)]'
const FOOTER = 'flex items-center justify-end gap-2 border-t border-border px-0 pt-3 pb-1'
const FAILED = 'm-0 min-w-0 flex-1 text-xs leading-[1.5] text-[var(--dsw-alias-label-error)]'
const DISCARD = 'rounded-lg border border-border bg-transparent px-[14px] py-[5px] text-[13px] leading-[1.5] font-normal text-[var(--dsw-alias-label-secondary)] hover:enabled:border-[var(--dsw-alias-label-dimmed)] hover:enabled:text-foreground disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-brand-primary)] focus-visible:outline-offset-1 focus-visible:ring-0'
const SAVE = 'rounded-lg border border-transparent bg-[var(--dsw-alias-label-primary)] px-[14px] py-[5px] text-[13px] leading-[1.5] font-normal text-[var(--dsw-alias-bg-layer-3)] hover:bg-[var(--dsw-alias-label-primary)] hover:text-[var(--dsw-alias-bg-layer-3)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-brand-primary)] focus-visible:outline-offset-1 focus-visible:ring-0'

/** Card chrome shared by every plugin section. */
export interface PluginCardProps {
  /** Locale reader for this section's copy. */
  t: (key: PluginsSettingsLocaleKey) => string
  /** Locale key of the plugin's name. */
  titleKey: PluginsSettingsLocaleKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: PluginsSettingsLocaleKey
  /** The card's form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/**
 * Render one plugin card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function PluginCard(props: PluginCardProps) {
  const [open, setOpen] = useState(false)
  const { state } = props
  if (!state.available) {
    // Diagnostic: surface the namespace scope status so a blank 插件设置 is
    // traceable to loading/unavailable/error instead of vanishing silently.
    console.warn(`[plugins-card] ${props.titleKey} unavailable (scope=${state.status ?? '?'})`)
    return <li data-card-unavailable={state.status ?? '?'} />
  }
  const title = props.t(props.titleKey)
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={cn(CARD, open && CARD_OPEN)}>
      <ShadcnButton
        variant="ghost"
        className={HEADER}
        aria-expanded={open}
        aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={HEAD_TEXT}>
          <span className={NAME}>{title}</span>
          <span className={DESCRIPTION}>{props.t(props.descriptionKey)}</span>
        </span>
        {state.dirty ? <span className={PENDING}>{props.t('unsaved')}</span> : null}
        <IconChevronDownOutline14 className={cn('flex-none text-[var(--dsw-alias-label-tertiary)] transition-transform duration-[160ms]', open && 'rotate-180')} />
      </ShadcnButton>
      {open
        ? (
          <div className={BODY}>
            {!state.writable ? <p className={READ_ONLY} role="status">{props.t('readOnly')}</p> : null}
            {props.children}
            <div className={FOOTER}>
              {state.failed ? <p className={FAILED} role="status">{props.t('saveFailed')}</p> : null}
              <ShadcnButton
                variant="ghost"
                className={DISCARD}
                disabled={!state.dirty || state.saving}
                onClick={props.onDiscard}
              >
                {props.t('discard')}
              </ShadcnButton>
              <ShadcnButton
                variant="ghost"
                className={SAVE}
                disabled={blocked}
                onClick={props.onSave}
              >
                {props.t(state.saving ? 'saving' : 'save')}
              </ShadcnButton>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
