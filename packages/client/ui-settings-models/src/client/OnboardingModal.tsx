/** Shared modal chrome for every step registered by this onboarding plugin. */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

const ignoreImplicitDismiss = (): void => {}

/**
 * Render a blocking onboarding dialog and keep the application root inert.
 * @param props.title - accessible and visible dialog title.
 * @param props.focusTitle - focus the title when the step has no form control.
 * @param props.children - step-owned body and actions.
 * @returns the body-portaled modal.
 */
export function OnboardingModal({
  title, focusTitle = false, children,
}: {
  title: string
  focusTitle?: boolean
  children: ReactNode
}): ReactNode {
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus()
  }, [focusTitle])

  return (
    <Modal
      open
      title={title}
      onClose={ignoreImplicitDismiss}
      headless
      className="w-[min(600px,100%)] p-0"
    >
      <div className="flex max-h-[calc(100vh_-_48px)] flex-col overflow-y-auto p-7 max-[560px]:p-6">
        <h2 ref={titleRef} className="m-0 text-xl leading-7 font-medium text-foreground outline-none" tabIndex={focusTitle ? -1 : undefined}>{title}</h2>
        <div className="mt-5">{children}</div>
      </div>
    </Modal>
  )
}
