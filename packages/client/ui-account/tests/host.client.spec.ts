/** Host loader entry: the browser half owns all UI, so the node half is a no-op. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-account host', () => {
  it('applies cleanly with nothing registered host-side', () => {
    expect(() => apply(new Context())).not.toThrow()
  })
})
