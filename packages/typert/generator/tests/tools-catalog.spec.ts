import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { WorkspaceAnalyzer } from '../src/analyzer.ts'
import { FaceModelEmitter } from '../src/emitter.ts'

const workspaceRoot = resolve(import.meta.dirname, '../../../..')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('model-driven dsh-tools generation', () => {
  it('round-trips the complete service and event structure through the runtime registry', { timeout: 30_000 }, async () => {
    const workspace = new WorkspaceAnalyzer({
      root: workspaceRoot,
      faces: ['host'],
      packages: ['@deepseek-ai/dsh-tools'],
    }).analyze()
    const host = workspace.faces.find(candidate => candidate.face === 'host')
    if (host === undefined) throw new Error('dsh-tools has no analyzed host face')
    const artifact = new FaceModelEmitter(host).emit('@deepseek-ai/dsh-tools')

    const root = mkdtempSync(join(import.meta.dirname, '.generated-tools-'))
    temporaryRoots.push(root)
    const modulePath = join(root, 'host.mjs')
    writeFileSync(modulePath, artifact.js)
    const generated = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
      TYPERT: TypertContribution
    }

    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const dispose = ctx.typert.register(generated.TYPERT)
    const record = ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')
    const service = record?.model.services.find(candidate => candidate.key === 'tools')
    expect(service).toBeDefined()

    await dispose()
    expect(ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')).toBeUndefined()
  })
})
