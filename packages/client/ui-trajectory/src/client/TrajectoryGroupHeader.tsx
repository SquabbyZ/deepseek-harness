// TrajectoryGroupHeader: "Message" or "Step N" row with optional description.

export interface TrajectoryGroupHeaderProps {
  /** Group title (`Message`, `Step 1`, …). */
  title: string
  /** Secondary summary (`49 s`, `2.2 s skill`, …). */
  description?: string
}

/**
 * Render a Message/Step group header inside a turn body.
 * @param props - title and optional description.
 * @returns the group header element.
 */
export function TrajectoryGroupHeader({ title, description }: TrajectoryGroupHeaderProps) {
  return (
    <div className="flex h-9 min-w-0 items-center gap-6 box-border px-5">
      <span className="flex-none text-foreground [font:var(--dsw-font-xs-13)]">{title}</span>
      {description !== undefined && description !== ''
        ? <span className="min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap text-[var(--dsw-alias-label-tertiary)] [font:var(--dsw-font-xs-13)]">{description}</span>
        : null}
    </div>
  )
}
