/** Product-name index bootstrap (`injectProductName`) and its schema default. */

import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_PRODUCT_NAME, injectProductName } from '../src/index.ts'

describe('injectProductName', () => {
  it('injects the product name into the head, before the shell bundle', () => {
    const html = '<head><script src="shell.js"></script></head><body></body>'
    const out = injectProductName(html, 'Acme Harness')
    expect(out).toContain('<script>window.__DSH_PRODUCT_NAME__ = "Acme Harness"</script>')
    expect(out.indexOf('__DSH_PRODUCT_NAME__')).toBeLessThan(out.indexOf('shell.js'))
  })

  it('escapes < so a hostile name cannot break out of the script element', () => {
    const out = injectProductName('<head></head>', '</script><script>alert(1)</script>')
    expect(out).not.toContain('</script><script>')
    expect(out).toContain('\\u003c/script')
  })

  it('prepends the bootstrap when the page has no head', () => {
    expect(injectProductName('<body></body>', 'X')).toBe(
      '<script>window.__DSH_PRODUCT_NAME__ = "X"</script><body></body>',
    )
  })
})

describe('web-app Config', () => {
  it('defaults the product name to the shipped brand when omitted', () => {
    const config = new Config({ printUrl: false, surfaceContext: true, trustedHosts: [] })
    expect(config.productName).toBe(DEFAULT_PRODUCT_NAME)
  })
})
