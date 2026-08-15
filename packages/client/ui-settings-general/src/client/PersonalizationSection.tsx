/** The Personalization section: one column rendering feature-owned item contributions. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Full component props: section owner share plus item render share. */
export type PersonalizationSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.personalization.item'>

/**
 * Render the Personalization section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function PersonalizationSection({ renderSlot }: PersonalizationSectionComponentProps) {
  return (
    <div className="flex w-full flex-col dsh-settings-section">
      {renderSlot('settings.personalization.item', {})}
    </div>
  )
}
