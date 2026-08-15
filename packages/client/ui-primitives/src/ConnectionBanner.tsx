// ConnectionBanner: top strip surfacing connection loss. The atom is pure:
// the owner subscribes to connection state and passes `reconnecting` down.
// A null/connecting state upstream should stay quiet too — only an actual
// outage (reconnect backoff in progress) shows the strip.

/**
 * Render the reconnecting banner.
 * @param props.reconnecting - true while the connection is in backoff/retry.
 * @param props.label - banner text; the owner passes localized copy (this
 * package is cordis-free, so copy arrives via props).
 * @returns the banner, or null when connected.
 */
export function ConnectionBanner({ reconnecting, label = '连接已断开，正在重连…' }: {
  reconnecting: boolean
  label?: string | undefined
}) {
  if (!reconnecting) return null
  return <div className={BANNER}>{label}</div>
}

const BANNER =
  'fixed top-0 left-0 right-0 z-[100] py-1 px-3 text-center text-xs leading-[18px] bg-[var(--dsw-alias-state-error-primary)] text-[var(--dsw-alias-label-primary-foreground)]'
