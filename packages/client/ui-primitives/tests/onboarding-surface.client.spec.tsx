// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'

let appRoot: HTMLDivElement

beforeEach(() => {
  appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
})

afterEach(() => {
  cleanup()
  appRoot.remove()
})

describe('OnboardingSurface', () => {
  it('portals the overlay chrome to document.body around its content', () => {
    const view = render(<OnboardingSurface><p>step content</p></OnboardingSurface>)
    // Portaled: the overlay is a body child, not inside the render container.
    expect(view.container.querySelector('[data-onboarding-overlay]')).toBeNull()
    const overlay = document.body.querySelector('[data-onboarding-overlay]')
    expect(overlay).not.toBeNull()
    // The onboarding e2e pins the mask by class substring; the stage carries
    // the content.
    expect(overlay!.querySelector('[data-onboarding-mask]')).not.toBeNull()
    const stage = overlay!.querySelector('[data-onboarding-stage]')
    expect(stage).not.toBeNull()
    expect(stage!.textContent).toBe('step content')
  })

  it('holds #root inert for exactly its own lifetime', () => {
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    expect(appRoot.inert).toBe(true)
    view.unmount()
    expect(appRoot.inert).toBe(false)
  })

  it('renders without an #root element (compositions that mount elsewhere)', () => {
    appRoot.remove()
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    expect(document.body.querySelector('[data-onboarding-stage]')!.textContent).toBe('x')
    view.unmount()
  })
})
