// OnboardingSurface: the full-viewport first-run takeover an onboarding step
// wraps its visible content in. The overlay portals to this document's body
// (the Modal precedent: ancestor stacking contexts cannot leave sticky page
// controls above the mask), and the surface holds `#root` inert for exactly
// its own lifetime — a step that renders null paints nothing and blocks
// nothing, so "should onboarding show right now" stays a plain render
// decision inside the step component.

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Render the onboarding takeover chrome (mask + opaque stage) around one
 * step's content and keep the application root inert while mounted.
 * @param props.children - the step's page content, centered on the stage.
 * @returns the body-portaled overlay tree.
 */
export function OnboardingSurface({ children }: { children: ReactNode }) {
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    appRoot.inert = true
    return () => { appRoot.inert = false }
  }, [])

  return createPortal((
    <div className={OVERLAY} role="presentation" data-onboarding-overlay="">
      <div className={MASK} aria-hidden="true" data-onboarding-mask="" />
      <div className={STAGE} data-onboarding-stage="">{children}</div>
    </div>
  ), document.body)
}

const OVERLAY = 'fixed inset-0 z-[1100]'

const MASK = 'absolute left-0 right-0 top-20 bottom-0 bg-[rgba(0,0,0,0.24)] backdrop-blur-[2px]'

const STAGE = 'absolute z-[1] inset-0 flex justify-center overflow-hidden bg-[var(--dsw-alias-bg-layer-1)]'
