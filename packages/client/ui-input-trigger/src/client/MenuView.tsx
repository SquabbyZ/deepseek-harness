/**
 * Trigger candidate menu: renders the InputTriggerService menu store into the
 * conversation.input.overlay anchor. Closed state renders null (the overlay
 * slot stays mounted); groups render in roster order under localized title
 * rows, pending groups as a loading row; pointer picks route back through
 * the service (combobox pattern — focus never leaves the textarea, so rows
 * are mousedown-handled and the highlight is exposed via
 * aria-activedescendant on the listbox).
 */
import { Fragment, useEffect, useRef, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { ShadcnButton, useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MenuViewInjected } from './slots.ts'
import type { MenuKey } from './locales.ts'

/** Full menu props: injected face + the locale seat. */
export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'>

/** Design cap on the list height (figma SLASH 39:26572 MenuDropdown). */
const MAX_HEIGHT = 320

/** MenuDropdown surface: bottom-anchored card above the composer. */
const MENU = 'absolute bottom-[calc(100%_+_4px)] left-0 z-[100] flex min-w-[min(260px,100%)] max-w-[min(537px,100%)] max-h-[320px] flex-col overflow-hidden rounded-[12px] border border-[var(--dsw-alias-border-inverted)] bg-[var(--dsw-specific-menu)] p-1 shadow-[var(--dsw-shadow-lv3)] [--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)]'
/** Candidate row (figma .Menu_cell): 40px min, r10, primary 14/22 label. */
const ITEM = 'flex w-full min-h-[40px] cursor-pointer items-center gap-2 rounded-[10px] border-none bg-transparent px-2.5 py-2 text-left text-sm font-normal leading-[22px] text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-foreground'
const ITEM_ACTIVE = 'bg-[var(--dsw-alias-interactive-bg-hover)]'

/** DOM id of one option row (the aria-activedescendant target). */
function optionId(source: string, index: number): string {
  return `dsh-slash-option-${source}-${index}`
}

/**
 * Render the candidate menu overlay entry.
 * @param props - injected face (the menu store and the pick route); `t` rides the standard locale seat.
 * @returns the dropdown while open; null while closed.
 */
export function MenuView({ menu, onPick, onDismiss, t }: MenuViewProps) {
  const state = useSyncExternalStore(
    fn => menu.subscribe(fn),
    () => menu.getSnapshot(),
  )
  const listRef = useRef<HTMLDivElement>(null)
  // The list is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update (the anchor moves
  // when the composer grows).
  const maxHeight = useAnchoredMaxHeight(listRef, MAX_HEIGHT, state)
  const highlight = state.open ? state.highlight : null
  // Focus stays in the textarea (combobox pattern), so the browser never
  // scrolls the active option into view on keyboard moves — do it here.
  useEffect(() => {
    if (highlight === null) return
    document.getElementById(optionId(highlight.source, highlight.index))
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  // Dismiss on pointer outside the menu AND outside the composer card
  // (clicking the textarea or bottom bar must not close the menu).
  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (ev: PointerEvent): void => {
      if (!(ev.target instanceof Node)) return
      if (listRef.current?.contains(ev.target)) return
      const composerCard = listRef.current?.closest('[data-composer-card]')
      if (composerCard?.contains(ev.target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, onDismiss])
  if (!state.open) return null
  return (
    <div
      ref={listRef}
      className={MENU}
      style={{ maxHeight }}
      role="listbox"
      aria-label={t('suggestions.aria')}
      aria-activedescendant={highlight !== null ? optionId(highlight.source, highlight.index) : undefined}
    >
      <div className="flex min-h-0 flex-col overflow-y-auto">
        {state.groups.map(group => (group.status === 'ready' && group.items.length === 0)
          ? null
          : (
            <Fragment key={group.source}>
              {/* Source names key the dictionary open-endedly: the lookup chain
                  returns an unknown key verbatim, so an unregistered source
                  shows its raw name — hence the cast past the typed key union. */}
              <div className="px-2.5 py-2 text-xs leading-4 text-[var(--dsw-alias-label-tertiary)]" role="presentation" data-source={group.source}>{t(group.source as MenuKey)}</div>
              {group.status === 'pending'
                ? <div className="flex min-h-[40px] items-center px-2.5 py-2 text-sm leading-[22px] text-[var(--dsw-alias-label-dimmed)]" data-source={group.source}>{t('loading')}</div>
                : group.items.map((item, index) => {
                  const active = highlight !== null && highlight.source === group.source && highlight.index === index
                  return (
                    <ShadcnButton
                      key={`${group.source}:${item.name}`}
                      id={optionId(group.source, index)}
                      variant="ghost"
                      role="option"
                      aria-selected={active}
                      className={clsx(ITEM, active && ITEM_ACTIVE)}
                      // mousedown, not click: the textarea keeps focus (combobox
                      // pattern) — preventing default stops the focus steal, and the
                      // pick runs before any blur-driven teardown.
                      onMouseDown={(ev) => {
                        ev.preventDefault()
                        onPick(group.source, index)
                      }}
                    >
                      {item.icon !== undefined && <span className="inline-flex size-4 flex-none items-center justify-center text-[var(--dsw-alias-label-tertiary)]" aria-hidden>{item.icon}</span>}
                      <span className="flex-none max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                      {item.description !== undefined && <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--dsw-alias-label-tertiary)]">{item.description}</span>}
                    </ShadcnButton>
                  )
                })}
            </Fragment>
          ))}
      </div>
    </div>
  )
}
