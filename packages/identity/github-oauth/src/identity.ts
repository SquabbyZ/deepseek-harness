import type { Branded } from '@deepseek-ai/dsh-brand'

/** A provider-agnostic authenticated identity id, globally unique via its provider prefix. */
export type IdentityId = Branded<'IdentityId'>

/** Provider-agnostic identity. No provider-specific fields (see the seam contract). */
export interface Identity {
  id: IdentityId
  provider: string
  name: string
  email?: string
  avatar?: string
}
