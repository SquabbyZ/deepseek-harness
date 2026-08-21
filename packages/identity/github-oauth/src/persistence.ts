import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Identity } from './identity.ts'

/** Filename inside the harness home storing the current identity. */
export const IDENTITY_FILE = '.identity.json'

export function loadIdentity(home: string = resolveDshHome(homedir())): Identity | null {
  try {
    const parsed = JSON.parse(readFileSync(join(home, IDENTITY_FILE), 'utf8')) as Identity
    return typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function saveIdentity(identity: Identity, home: string = resolveDshHome(homedir())): void {
  const file = join(home, IDENTITY_FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(identity, null, 2), 'utf8')
}

export function clearIdentity(home: string = resolveDshHome(homedir())): void {
  rmSync(join(home, IDENTITY_FILE), { force: true })
}
