/**
 * Sidebar shell: column geometry only. Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts and the four upper
 * controls enter the 56px rail from the same horizontal offset (one icon each,
 * same top-down order) on one fade that ends with the slide. The bottom-pinned
 * settings control only fades. The workspace/session browsing region between
 * the New Session button and the foot is the `sidebar.workspaces` registrant's,
 * and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
 * hands them the wide flag (plus an expand request callback for the browser).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useRef, useState } from 'react'
import {
  cn,
  FishLogo,
  IconNewChatOutline16, IconPanelLeftOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  productName,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  // Wide content stays mounted while the collapse animates (fading via
  // dsh-sidebar-fading), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (collapsed utilities) only applies once the fade settles.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Scrollbars in the column follow the pointer (the quiet state rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  return (
    <div
      ref={column}
      className={cn(
        'flex h-full flex-col box-border bg-[var(--dsw-specific-sidebar-fill)] text-sm text-foreground',
        '[--dsh-sidebar-inline-padding:12px]',
        pointerInside
          ? '[--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)] [--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)]'
          : 'quietBars [--dsh-scrollbar-thumb:transparent] [--dsh-scrollbar-thumb-hover:transparent]',
        wide ? 'px-[var(--dsh-sidebar-inline-padding)] py-1.5' : 'px-2.5 pt-[18px] pb-1.5',
        !wide && everWide.current && 'dsh-sidebar-rail-in',
        collapsed && wide && 'dsh-sidebar-fading',
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      <div className={cn(
        'flex shrink-0 items-center gap-2 box-border overflow-hidden',
        wide ? 'h-[60px] justify-end py-2 pl-1 mb-2' : 'h-9 justify-start p-0 mb-3',
      )}>
        {/* Expanded, the wordmark doubles as a New Session shortcut; the
            collapsed rail's logo is the expand toggle below instead. */}
        {wide && (
          <button
            type="button"
            className="dsh-sidebar-wide inline-flex min-w-0 flex-1 items-center overflow-hidden border-0 bg-transparent p-0 text-inherit cursor-pointer"
            aria-label={t('session.new.label')}
            onClick={() => { startSession() }}
          >
            <FishLogo size={24} className="shrink-0" />
            <span className="min-w-0 h-6 leading-6 ml-1.5 text-sm font-medium text-current truncate">{productName}</span>
          </button>
        )}
        {/* Rail resting state is the whale mark; hovering swaps in the panel
            icon (the expand affordance, figma sidebar-hover flow). */}
        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={cn(
              'dsh-sidebar-icon-button inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--dsw-alias-label-secondary)] cursor-pointer hover:bg-[var(--dsw-alias-interactive-bg-hover)]',
              wide ? 'h-7 w-7' : 'h-9 w-9 text-foreground',
              !wide && 'group',
            )}
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            {!wide && <FishLogo className="group-hover:hidden" size={24} />}
            {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
            <IconPanelLeftOutline16 className={cn(!wide && 'hidden group-hover:inline')} size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {/* Expanded, the button carries its own label — tooltip only on the rail. */}
      <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={cn(
            'dsh-sidebar-new-session flex shrink-0 items-center justify-center overflow-hidden cursor-pointer text-sm font-medium leading-[22px] text-foreground',
            wide
              ? 'h-[38px] gap-1.5 px-4 py-2 mx-0.5 mb-2 box-border border border-border rounded-xl bg-[var(--dsw-alias-button-elevated-fill)] hover:bg-[var(--dsw-alias-button-floating-hover)]'
              : 'h-9 w-9 self-start gap-0 p-0 mb-3 border border-transparent bg-transparent hover:bg-[var(--dsw-alias-interactive-bg-hover)]',
          )}
          aria-label={t('session.new.label')}
          onClick={() => { startSession() }}
        >
          <IconNewChatOutline16 size={wide ? 14 : 18} />
          {wide && <span className="dsh-sidebar-wide max-w-[200px] overflow-hidden whitespace-nowrap">{t('session.new')}</span>}
        </button>
      </Tooltip>

      {/* The browsing region fills the column between the controls and the
          foot in both states; its rail icon column rides the same slot. */}
      <div className={cn(
        'dsh-sidebar-region-area flex min-h-0 flex-1 flex-col overflow-hidden',
        wide ? '-ml-1 pl-1 mr-[calc(-1*var(--dsh-sidebar-inline-padding))]' : 'ml-0 mr-0 pl-0',
      )}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      {/* Footer actions stack above Settings in both sidebar widths. */}
      <div className={cn(
        'dsh-sidebar-foot-area flex shrink-0 items-center gap-1',
        wide ? 'flex-row justify-between' : 'flex-col justify-start',
      )}>
        <div className={cn('flex min-w-0 flex-initial', !wide && 'justify-center w-auto')}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
        <div className={cn('shrink-0 min-w-0', !wide && 'flex justify-center w-auto')}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
      </div>
    </div>
  )
}
