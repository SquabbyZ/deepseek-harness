import { createHash, randomBytes } from 'node:crypto'

/** RFC 7636 §4.1: a high-entropy URL-safe code verifier (43–128 chars). */
export function generateCodeVerifier(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

/** RFC 7636 §4.2: the S256 code challenge derived from a verifier. */
export function computeS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
