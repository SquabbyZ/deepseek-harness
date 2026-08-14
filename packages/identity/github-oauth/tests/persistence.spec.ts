import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearIdentity, IDENTITY_FILE, loadIdentity, saveIdentity } from '../src/persistence.ts'

const homes: string[] = []

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-identity-'))
  homes.push(dir)
  return dir
}

afterEach(() => { for (const h of homes) clearIdentity(h) })

describe('identity persistence', () => {
  it('round-trips an identity to .identity.json', () => {
    const home = freshHome()
    const identity = { id: 'github:1', provider: 'github', name: 'Octo' }
    saveIdentity(identity, home)
    expect(JSON.parse(readFileSync(join(home, IDENTITY_FILE), 'utf8'))).toEqual(identity)
    expect(loadIdentity(home)).toEqual(identity)
  })

  it('returns null when nothing is stored', () => {
    expect(loadIdentity(freshHome())).toBeNull()
  })

  it('clearIdentity removes the stored identity', () => {
    const home = freshHome()
    saveIdentity({ id: 'github:1', provider: 'github', name: 'Octo' }, home)
    clearIdentity(home)
    expect(loadIdentity(home)).toBeNull()
  })
})
