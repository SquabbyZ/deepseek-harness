/**
 * Test doubles for the SkillInventoryGateway suite: an in-memory
 * {@link SkillProvider} that the real `@deepseek-ai/dsh-skill` registry
 * drives through the same code path production providers hit.
 *
 * Why not stub the registry directly: the gateway's contract is "wrap
 * `ctx.skills.snapshot/list/get`" — that wrap is only meaningful against a
 * real registry whose internal cache, layered providers, and scope-key
 * resolution all run. Using a real registry with a fake provider exercises
 * the wrap against the same code path the prompt sees in production.
 */

import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'

export type SkillEntrySeed = {
  readonly name: string
  readonly description: string
  readonly invocation: SkillInvocationPolicy
  readonly content?: string
}

/**
 * In-memory provider: list returns the seed candidates in a stable order,
 * get() returns the body so the registry can satisfy `ctx.skills.get(name)`.
 *
 * The registry caches by `(cwd, scopes, revision)`, so every test must run
 * against a fresh context to avoid stale-snapshot leaks between cases.
 */
export class MemorySkillsProvider implements SkillProvider {
  readonly name = 'memory'

  constructor(private readonly candidates: readonly SkillCandidate[]) {}

  async list(): Promise<SkillCandidate[]> {
    return [...this.candidates]
  }

  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    return {
      ...candidate,
      content: (candidate.locator as { content?: string }).content ?? `${candidate.name} body.`,
    }
  }
}

/** Build one in-memory provider seeded from a flat list of (name, description, invocation). */
export function memoryProvider(seeds: readonly SkillEntrySeed[]): MemorySkillsProvider {
  const candidates: SkillCandidate[] = seeds.map((seed, index) => ({
    name: seed.name,
    description: seed.description,
    invocation: seed.invocation,
    provider: 'memory',
    source: 'memory',
    rank: 100 + index,
    locator: { content: seed.content ?? `${seed.name} body.` },
  }))
  return new MemorySkillsProvider(candidates)
}
