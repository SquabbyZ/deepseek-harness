/** Platform-neutral assembly of generated Host Remote contributions. */

import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import commandsRemote from '@deepseek-ai/dsh-commands/remote'
import goalsRemote from '@deepseek-ai/dsh-goal/remote'
import messageFeedbackRemote from '@deepseek-ai/dsh-message-feedback/remote'
import type {
  InvocationDescriptor, TypertClientRemote, TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

export type { TypertClientRemote as ClientRemote } from '@deepseek-ai/dsh-typert-protocol'
export type {} from '@deepseek-ai/dsh-commands/remote'
export type {} from '@deepseek-ai/dsh-goal/remote'
export type {} from '@deepseek-ai/dsh-message-feedback/remote'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
export type {} from '@deepseek-ai/dsh-commands/types'
export type {} from '@deepseek-ai/dsh-credentials/types'
export type {} from '@deepseek-ai/dsh-llm/types'
export type {} from '@deepseek-ai/dsh-agent-presets/types'
export type {} from '@deepseek-ai/dsh-settings/types'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type {
  ClientResponse, ConfigurableProviderView, ConnectionHandle, ConnectionSinks, ContentBlock,
  CredentialView, DirectoryListing, DiscoveredModelView, HistoryEntry, HostFrame, IApiClient,
  MessageId, ModelCatalogFailure, ModelProviderGroup, ModelReasoningEffort, ModelSelection,
  MuxFrame, PromptContentPart, QuestionResponsePayload, QueueAction, RpcError, RpcId, RpcReceipt,
  RpcRequest, RpcResponse, RpcResult, SessionId, SessionModels, SessionSearchItem,
  SessionSummary, SettingsNamespaceView, SettingsPathOpView, SkillEntry, StreamChunk,
  SubagentAddress, SubagentCatalog, JobView, ToolCallView, ToolEventView, ToolResultView,
  WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-connection/client'
export type {} from '@deepseek-ai/dsh-api-gateway/client'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
// The JSON vocabulary those payloads are built from, re-exported for the same
// reason: a Client contribution names what it sends without importing a Host
// package, and this assembly is where both planes legitimately meet.
export type { JsonValue } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: TypertClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * The plugin-inventory Remote. The Host api-proxy would generate this from the
 * inventory service; the fixture client assembly declares it so the
 * ui-settings-plugin-inventory tab activates. Codecs are strict zod schemas
 * (the gateway rejects any non-strict codec).
 */
const pluginEntrySchema = z.object({
  entryId: z.string(),
  moduleName: z.string(),
  enabled: z.boolean(),
  disabledReason: z.union([z.literal('user'), z.literal('cordis'), z.null()]),
  fiberPhase: z.string(),
  // The inventory panel groups entries by deployment origin; carry it through.
  scope: z.union([z.literal('builtin'), z.literal('external')]).optional(),
})
const listResultSchema = z.object({ entries: z.array(pluginEntrySchema) })
const listDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-plugin-inventory#pluginInventory/list',
  service: 'pluginInventory',
  namespace: 'pluginInventory',
  method: 'list',
  invocation: { kind: 'direct' },
  parameters: [],
  result: {
    mode: 'strict',
    typeSymbol: '@deepseek-ai/dsh-plugin-inventory#pluginInventory/list:result',
    schema: listResultSchema,
  },
}
// The ui-settings-plugin-inventory calls setEnabled({ entryId, enabled }, signal)
// — ONE payload object — so the descriptor declares a single `entry` parameter.
const setEnabledDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-plugin-inventory#pluginInventory/setEnabled',
  service: 'pluginInventory',
  namespace: 'pluginInventory',
  method: 'setEnabled',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'entry',
      wire: 'entry',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-plugin-inventory#entry',
        schema: z.object({ entryId: z.string(), enabled: z.boolean() }),
      },
    },
  ],
  // The consumer passes ({ entryId, enabled }, signal) — the trailing signal is
  // the transport cancellation argument.
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-plugin-inventory#pluginInventory/setEnabled:result', schema: z.object({}) },
}
// External plugins can be uninstalled from the 插件管理 panel. One payload
// object ({ entryId }); the fixture resolves the loader entry by module name.
const uninstallDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-plugin-inventory#pluginInventory/uninstall',
  service: 'pluginInventory',
  namespace: 'pluginInventory',
  method: 'uninstall',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'entry',
      wire: 'entry',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-plugin-inventory#entry-id',
        schema: z.object({ entryId: z.string() }),
      },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-plugin-inventory#pluginInventory/uninstall:result', schema: z.object({}) },
}
const pluginInventoryRemote: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-plugin-inventory',
  descriptors: [listDescriptor, setEnabledDescriptor, uninstallDescriptor],
}

/**
 * Skill / MCP inventory remotes for the top-level 技能管理 / MCP 管理 sections.
 * Both follow the plugin-inventory shape (list + setEnabled, one `entry` object
 * param) so the management panels share the same toggle machinery.
 */
const skillEntrySchema = z.object({
  entryId: z.string(),
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  source: z.string(),
  provider: z.string(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
  enabled: z.boolean(),
})
const skillListDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-skill-inventory#skillInventory/list',
  service: 'skillInventory',
  namespace: 'skillInventory',
  method: 'list',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skillInventory/list:result', schema: z.object({ entries: z.array(skillEntrySchema) }) },
}
const skillSetEnabledDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-skill-inventory#skillInventory/setEnabled',
  service: 'skillInventory',
  namespace: 'skillInventory',
  method: 'setEnabled',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'entry',
      wire: 'entry',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skill-entry', schema: z.object({ entryId: z.string(), enabled: z.boolean() }) },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skillInventory/setEnabled:result', schema: z.object({}) },
}
const skillInventoryRemote: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-skill-inventory',
  descriptors: [skillListDescriptor, skillSetEnabledDescriptor],
}
// skills.sh registry remote (Task 4): search the registry and install a skill
// into ~/.dsh/skills/{name}. The wire namespace is `skillRegistry` so the RPC
// endpoints are `skillRegistry/search` + `skillRegistry/installSkill`.
// NOTE: the method is `installSkill`, NOT `install` — the typert gateway
// reserves `install` on RemoteNamespaceService (its own lifecycle method), so a
// namespace method named `install` throws at mount time.
const skillRegistrySkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  installs: z.number(),
  source: z.string(),
})
const skillSearchDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-skill-inventory#skillRegistry/search',
  service: 'skillRegistry',
  namespace: 'skillRegistry',
  method: 'search',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'query',
      wire: 'query',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skill-search-query', schema: z.string() },
    },
  ],
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skillRegistry/search:result', schema: z.object({ skills: z.array(skillRegistrySkillSchema) }) },
}
const skillInstallDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-skill-inventory#skillRegistry/installSkill',
  service: 'skillRegistry',
  namespace: 'skillRegistry',
  method: 'installSkill',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'target',
      wire: 'target',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-skill-inventory#skill-install-target',
        schema: z.object({ name: z.string(), source: z.string() }),
      },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skillRegistry/installSkill:result', schema: z.object({ ok: z.literal(true) }) },
}
// Uninstall removes a previously installed skill from `~/.dsh/skills/{name}`.
// Symlinked entries from `~/.agents/skills` are NOT uninstalled through this
// path — the UI only enables the button for skills whose `source` is
// `owner/repo`, which the installer stamps on install. Older hand-installed
// skills are also covered once their frontmatter carries a source line.
// Only `name` is required: the directory is derived (`~/.dsh/skills/{name}`).
const skillUninstallDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-skill-inventory#skillRegistry/uninstall',
  service: 'skillRegistry',
  namespace: 'skillRegistry',
  method: 'uninstall',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'target',
      wire: 'target',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-skill-inventory#skill-uninstall-target',
        schema: z.object({ name: z.string() }),
      },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skillRegistry/uninstall:result', schema: z.object({ ok: z.literal(true) }) },
}
// Read the SKILL.md body for a previously installed skill. The UI uses this
// for the details panel — frontmatter is already shown on the row; the body
// holds the actual instructions.
const skillDetailsDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-skill-inventory#skillRegistry/readDetails',
  service: 'skillRegistry',
  namespace: 'skillRegistry',
  method: 'readDetails',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'target',
      wire: 'target',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-skill-inventory#skill-details-target',
        schema: z.object({ name: z.string() }),
      },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-skill-inventory#skillRegistry/readDetails:result', schema: z.object({ body: z.string() }) },
}
const skillRegistryRemote: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-skill-registry',
  descriptors: [skillSearchDescriptor, skillInstallDescriptor, skillUninstallDescriptor, skillDetailsDescriptor],
}
// One persisted McpServerSpec (the `mcp-inventory` namespace value); kept exact
// to the ui-settings-mcp store type so the fixture and the tab agree on shape.
const mcpSpecSchema = z.union([
  z.object({
    transport: z.literal('stdio'),
    serverName: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
    cwd: z.string(),
  }),
  z.object({
    transport: z.literal('streamable-http'),
    serverName: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
])
export const mcpEntrySchema = z.object({
  entryId: z.string(),
  serverName: z.string(),
  transport: z.string(),
  target: z.string(),
  enabled: z.boolean(),
  // The full persisted spec rides each list entry so the probe can run it: the
  // strict codec drops unknown keys, so omitting `spec` here made
  // `probeMcpServer(entry.spec)` throw on undefined in the real app.
  spec: mcpSpecSchema,
})
export const mcpListResultSchema = z.object({ entries: z.array(mcpEntrySchema) })
const mcpListDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/list',
  service: 'mcpInventory',
  namespace: 'mcpInventory',
  method: 'list',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/list:result', schema: mcpListResultSchema },
}
const mcpSetEnabledDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/setEnabled',
  service: 'mcpInventory',
  namespace: 'mcpInventory',
  method: 'setEnabled',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'entry',
      wire: 'entry',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcp-entry', schema: z.object({ entryId: z.string(), enabled: z.boolean() }) },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/setEnabled:result', schema: z.object({}) },
}
const mcpUpsertDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/upsertServer',
  service: 'mcpInventory',
  namespace: 'mcpInventory',
  method: 'upsertServer',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'spec',
      wire: 'spec',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcp-server-spec', schema: mcpSpecSchema },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/upsertServer:result', schema: z.object({}) },
}
const mcpDeleteDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/deleteServer',
  service: 'mcpInventory',
  namespace: 'mcpInventory',
  method: 'deleteServer',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'entry',
      wire: 'entry',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcp-entry-id', schema: z.object({ entryId: z.string() }) },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcpInventory/deleteServer:result', schema: z.object({}) },
}
const mcpInventoryRemote: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-mcp-inventory',
  descriptors: [mcpListDescriptor, mcpSetEnabledDescriptor, mcpUpsertDescriptor, mcpDeleteDescriptor],
}
// Smithery MCP registry remote (Task 5): search the public servers API. The
// wire namespace is `mcpRegistry` (distinct from the persisted `mcpInventory`),
// so the endpoint is `mcpRegistry/search` — mirroring the skillRegistry mount.
// Install is NOT an RPC: the UI converts a server into an McpServerSpec and
// writes it through the existing `mcpInventory/upsertServer` path.
const mcpRegistryServerSchema = z.object({
  qualifiedName: z.string(),
  displayName: z.string(),
  description: z.string(),
  remote: z.boolean(),
  useCount: z.number(),
})
const mcpRegistrySearchDescriptor: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-mcp-inventory#mcpRegistry/search',
  service: 'mcpRegistry',
  namespace: 'mcpRegistry',
  method: 'search',
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'query',
      wire: 'query',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcp-search-query', schema: z.string() },
    },
  ],
  result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-mcp-inventory#mcpRegistry/search:result', schema: z.object({ servers: z.array(mcpRegistryServerSchema) }) },
}
const mcpRegistryRemote: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-mcp-registry',
  descriptors: [mcpRegistrySearchDescriptor],
}

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [
      commandsRemote, goalsRemote,
      messageFeedbackRemote, pluginInventoryRemote, skillInventoryRemote, skillRegistryRemote, mcpInventoryRemote, mcpRegistryRemote,
    ]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
