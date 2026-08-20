/**
 * HTTP route contract moved here from `@deepseek-ai/dsh-host-webserver` after
 * the webserver package was deleted in task 2.6.5. The shape is unchanged so
 * consumer code keeps compiling; transport-agnostic carriers (apiproxy, the
 * client-connection shim, the frontend-static port-targets) wrap these types.
 * @module @deepseek-ai/dsh-host-apiproxy/web-types
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One upgrade route registration (WebSocket or any HTTP-upgrade protocol). */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
}