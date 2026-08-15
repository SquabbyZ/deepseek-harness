// Hero chrome for the blank-draft phase of ConversationRoot: fish headline,
// glow backdrop, and the workspace row. Pure presentation — the resident
// composer is NOT rendered here (it keeps its own stable tree position in
// ConversationRoot so the textarea survives the hero → composer flip); CSS
// positions it over this shell's glow area during the hero phase.

import { useId } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  FishLogo, IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16, ShadcnButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSlotProps } from '../contract/slots.ts'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <ShadcnButton
      ref={buttonRef}
      variant="ghost"
      className="inline-flex h-auto min-h-7 max-w-[min(100%,360px)] items-center gap-1 rounded-2xl bg-transparent px-2 py-0 text-[13px] leading-5 font-medium text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)] aria-expanded:bg-[var(--dsw-alias-interactive-bg-hover)] disabled:cursor-default"
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderClose16 className="flex-none text-foreground" size={16} />
        : <IconFolderOpen16 className="flex-none text-foreground" size={16} />}
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className="flex-none text-[var(--dsw-alias-label-caption)]" size={12} />
    </ShadcnButton>
  )
}

/**
 * The soft blue backdrop ellipse (figma 313:14109). Rendered by the hero
 * owner (ConversationRoot), not HeroShell, so it can center on the input
 * card; the owner's className supplies all positioning.
 * @param props.className - positioning class from the owner.
 * @returns the blurred-ellipse svg element.
 */
export function HeroGlow({ className }: { className?: string | undefined }) {
  // Stable filter id so multiple hero mounts do not collide in the DOM.
  const glowFilterId = `empty-glow-${useId().replace(/:/g, '')}`
  return (
    <svg className={className} viewBox="0 0 1051 468" fill="none" aria-hidden="true">
      <defs>
        <filter
          id={glowFilterId}
          x="0"
          y="0"
          width="1051"
          height="468"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur" />
        </filter>
      </defs>
      <g filter={`url(#${glowFilterId})`}>
        <ellipse cx="525.5" cy="234" rx="425.5" ry="134" fill="#6187D8" fillOpacity="0.08" />
      </g>
    </svg>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Render the hero chrome (headline only; no glow, no composer, no workspace
 * row — the glow is the owner's {@link HeroGlow}).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, children }: HeroShellProps) {
  return (
    <div className="flex h-full min-w-0 items-center justify-center px-6">
      <div className="flex w-full max-w-[var(--dsh-composer-card-max-width)] flex-col items-stretch gap-3 overflow-visible">
        <div className="grid grid-cols-[34px_auto_auto] items-center justify-center gap-x-2.5 text-[26px] leading-8 font-medium text-foreground">
          {/* figma 34:10412: fish 34×25 leading the headline, gap 10. */}
          <span className="row-start-1 col-start-1 inline-flex items-center justify-center dsh-hero-fish-hitbox">
            <FishLogo size={34} className="text-foreground [transform-origin:50%_60%] dsh-hero-fish" />
          </span>
          <span className="row-start-1 col-start-2">{t('hero.headline')}</span>
          <span className="row-start-1 col-start-3 self-start mt-0.5 -ml-[3px] rounded-3xl border border-[var(--dsw-alias-interactive-bg-hover)] bg-[var(--dsw-alias-state-business-tertiary)] px-[7px] pt-px text-xs leading-[18px] font-medium whitespace-nowrap text-[var(--dsw-alias-label-primary-bluish)] [font-family:var(--ds-font-family-code)]">{t('hero.preview')}</span>
        </div>
        <div className="relative flex min-w-0 flex-col gap-3 overflow-visible">
          {/* The resident composer (ConversationRoot's root-owned scrollport;
              the workspace row rides the stack above the card) is CSS-centered
              in that scroll body during hero — see
              ConversationRoot [data-phase='hero']. */}
        </div>
      </div>
      {children}
    </div>
  )
}
