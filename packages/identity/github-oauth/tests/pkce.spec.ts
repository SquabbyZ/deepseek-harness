import { describe, expect, it } from 'vitest'
import { computeS256Challenge, generateCodeVerifier } from '../src/pkce.ts'

describe('pkce', () => {
  it('generates a url-safe verifier of at least 43 chars', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('matches the RFC 7636 S256 test vector', () => {
    expect(computeS256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})
