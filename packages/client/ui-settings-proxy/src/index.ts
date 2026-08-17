/**
 * Outbound-proxy settings section, host loader face. This package owns no host
 * behavior — the `proxy` namespace, the global undici dispatcher, and the
 * connectivity probe all live in `@deepseek-ai/dsh-network` — so the host face
 * is empty; only the browser half (./client) registers the 代理 settings page.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-proxy
 */

export function apply(): void {}
