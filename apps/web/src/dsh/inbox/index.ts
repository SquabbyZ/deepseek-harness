// In-box browser-safe plugins: every @deepseek-ai/dsh-* package the
// migration audit (task 2.6.1) tagged as browser-safe AND shaped as a
// Cordis plugin body (named `apply` export, or default-exported Service
// class). Utility packages that the audit lists but that only re-export
// types/components stay out of `inboxPlugins`; they remain importable
// through vite's workspace alias map for transitive consumers.

// Dual-half packages import from `/client` (the host entry is Node-only);
// pure packages import from the bare name. Explicit imports — Vite glob
// imports are fragile across workspace packages with custom `exports`.

import * as dsh_agent_default_model from '@deepseek-ai/dsh-agent-default-model'
// TODO(phase3): re-enable when ported to browser-safe
// dsh-agent-spine-demo transitively pulls in dsh-skill-filesystem (chokidar) +
// dsh-subprocess-local (node:child_process) + dsh-fs-local (node:fs).
// import * as dsh_agent_spine_demo from '@deepseek-ai/dsh-agent-spine-demo'
import * as dsh_agent_tool_presentation from '@deepseek-ai/dsh-agent-tool-presentation'
import * as dsh_api_gateway from '@deepseek-ai/dsh-api-gateway/client'
import * as dsh_api_remotes from '@deepseek-ai/dsh-api-remotes'
import * as dsh_attachment from '@deepseek-ai/dsh-attachment'
// TODO(phase3): re-enable when ported to browser-safe
// dsh-bash-local depends on dsh-subprocess-local (node:child_process).
// import * as dsh_bash_local from '@deepseek-ai/dsh-bash-local'
import * as dsh_client_locale from '@deepseek-ai/dsh-client-locale/client'
import * as dsh_client_runtime from '@deepseek-ai/dsh-client-runtime/client'
import * as dsh_client_connection from '@deepseek-ai/dsh-client-connection/client'
import * as dsh_client_ui_account from '@deepseek-ai/dsh-client-ui-account/client'
import * as dsh_client_ui_agent_preset from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import * as dsh_client_ui_commands from '@deepseek-ai/dsh-client-ui-commands/client'
import * as dsh_client_ui_conversation from '@deepseek-ai/dsh-client-ui-conversation'
import * as dsh_client_ui_cordis from '@deepseek-ai/dsh-client-ui-cordis/client'
import * as dsh_client_ui_deliverables from '@deepseek-ai/dsh-client-ui-deliverables/client'
import * as dsh_client_ui_directory_picker_browse from '@deepseek-ai/dsh-client-ui-directory-picker-browse/client'
import * as dsh_client_ui_directory_picker_native from '@deepseek-ai/dsh-client-ui-directory-picker-native/client'
import * as dsh_client_ui_goal from '@deepseek-ai/dsh-client-ui-goal/client'
import * as dsh_client_ui_input_trigger from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import * as dsh_client_ui_jobs from '@deepseek-ai/dsh-client-ui-jobs/client'
import * as dsh_client_ui_layout from '@deepseek-ai/dsh-client-ui-layout/client'
import * as dsh_client_ui_message_feedback from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import * as dsh_client_ui_model_selection from '@deepseek-ai/dsh-client-ui-model-selection/client'
import * as dsh_client_ui_permission_presets from '@deepseek-ai/dsh-client-ui-permission-presets/client'
import * as dsh_client_ui_plan from '@deepseek-ai/dsh-client-ui-plan/client'
import * as dsh_client_ui_settings from '@deepseek-ai/dsh-client-ui-settings/client'
import * as dsh_client_ui_settings_agent from '@deepseek-ai/dsh-client-ui-settings-agent/client'
import * as dsh_client_ui_settings_general from '@deepseek-ai/dsh-client-ui-settings-general/client'
import * as dsh_client_ui_settings_mcp from '@deepseek-ai/dsh-client-ui-settings-mcp/client'
import * as dsh_client_ui_settings_models from '@deepseek-ai/dsh-client-ui-settings-models/client'
import * as dsh_client_ui_settings_plugin_inventory from '@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client'
import * as dsh_client_ui_settings_plugins from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import * as dsh_client_ui_settings_proxy from '@deepseek-ai/dsh-client-ui-settings-proxy/client'
import * as dsh_client_ui_settings_skill from '@deepseek-ai/dsh-client-ui-settings-skill/client'
import * as dsh_client_ui_settings_usage from '@deepseek-ai/dsh-client-ui-settings-usage/client'
import * as dsh_client_ui_sidebar from '@deepseek-ai/dsh-client-ui-sidebar/client'
import * as dsh_client_ui_skill from '@deepseek-ai/dsh-client-ui-skill/client'
import * as dsh_client_ui_subagent from '@deepseek-ai/dsh-client-ui-subagent/client'
import * as dsh_client_ui_theme from '@deepseek-ai/dsh-client-ui-theme/client'
import * as dsh_client_ui_tool from '@deepseek-ai/dsh-client-ui-tool'
import * as dsh_client_ui_trajectory from '@deepseek-ai/dsh-client-ui-trajectory/client'
import * as dsh_client_ui_user_questions from '@deepseek-ai/dsh-client-ui-user-questions/client'
import * as dsh_client_ui_workflow_run from '@deepseek-ai/dsh-client-ui-workflow-run/client'
import * as dsh_client_ui_workspace from '@deepseek-ai/dsh-client-ui-workspace/client'
import * as dsh_command_compact from '@deepseek-ai/dsh-command-compact'
import * as dsh_command_feedback from '@deepseek-ai/dsh-command-feedback'
import * as dsh_command_goal from '@deepseek-ai/dsh-command-goal'
import * as dsh_commands from '@deepseek-ai/dsh-commands'
import * as dsh_compaction from '@deepseek-ai/dsh-compaction'
import * as dsh_compaction_headroom from '@deepseek-ai/dsh-compaction-headroom'
import * as dsh_compaction_tool_result_pruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import * as dsh_cordis_client_runner from '@deepseek-ai/dsh-cordis-client-runner/client'
import * as dsh_credentials from '@deepseek-ai/dsh-credentials'
import * as dsh_fs from '@deepseek-ai/dsh-fs'
import * as dsh_fs_observation_policy from '@deepseek-ai/dsh-fs-observation-policy'
import * as dsh_host_directory_picker from '@deepseek-ai/dsh-host-directory-picker'
import * as dsh_invariants from '@deepseek-ai/dsh-invariants'
// dsh_jobs: abstract JobRegistry seam; dsh_jobs_local extends it with the local implementation
import * as dsh_jobs_local from '@deepseek-ai/dsh-jobs-local'
import * as dsh_llm from '@deepseek-ai/dsh-llm'
import * as dsh_llm_deepseek from '@deepseek-ai/dsh-llm-deepseek'
// TODO(phase3): re-enable when pi-ai provider is gated behind a feature flag that
// requires a polyfilled browser fetch. `@earendil-works/pi-ai` keeps a
// `NODE_FS_SPECIFIER = "node:fs"` style env-probe string at module scope and
// `await import(NODE_FS_SPECIFIER)` at runtime, which is not statically
// analyzable and therefore not rewritable by `nodeShimPlugin` — both
// pre-bundled and raw-source paths end up at CORS-failing browser requests
// for `node:fs` / `node:os` / `node:path`. The provider stays available in
// Node / Tauri via the apiproxy; the browser inbox only mounts browser-safe
// LLM providers.
// import * as dsh_llm_pi_ai from '@deepseek-ai/dsh-llm-pi-ai'
import * as dsh_lsp from '@deepseek-ai/dsh-lsp'
// TODO(phase3): re-enable when proxy migrate lands (Tauri invoke → Rust reqwest per spec 6.4)
// dsh-network depends on undici (Node-only HTTP dispatcher) — esbuild's cjs-to-esm pass
// inlines `import('node:fs')`/`util.debuglog` from undici before nodeShimPlugin can rewrite
// them, so the dev console surfaces CORS for node:fs + TypeError util.debuglog. Production
// build is unaffected (Rollup externalizes node:*) but the browser bundle has no use for it:
// client-first routes proxy through `httpApi.setProxy` → Rust reqwest, not undici. Re-enable
// only if we re-introduce a Node-side undici path.
// import * as dsh_network from '@deepseek-ai/dsh-network'
import * as dsh_permission_presets from '@deepseek-ai/dsh-permission-presets'
import * as dsh_persona from '@deepseek-ai/dsh-persona'
import * as dsh_plan_mode from '@deepseek-ai/dsh-plan-mode'
import * as dsh_repeat_tool_reminder from '@deepseek-ai/dsh-repeat-tool-reminder'
import * as dsh_schedule from '@deepseek-ai/dsh-schedule'
import * as dsh_session_checkpoint_policy from '@deepseek-ai/dsh-session-checkpoint-policy'
import * as dsh_session_log_export from '@deepseek-ai/dsh-session-log-export/client'
import * as dsh_session_persistence from '@deepseek-ai/dsh-session-persistence'
import * as dsh_session_projection from '@deepseek-ai/dsh-session-projection'
import * as dsh_session_projection_cache from '@deepseek-ai/dsh-session-projection-cache'
import * as dsh_session_query from '@deepseek-ai/dsh-session-query'
import * as dsh_session_reference from '@deepseek-ai/dsh-session-reference'
import * as dsh_session_stats from '@deepseek-ai/dsh-session-stats'
import * as dsh_session_title from '@deepseek-ai/dsh-session-title'
import * as dsh_session_title_all_prompts_llm from '@deepseek-ai/dsh-session-title-all-prompts-llm'
import * as dsh_session_title_first_prompt_llm from '@deepseek-ai/dsh-session-title-first-prompt-llm'
import * as dsh_shell from '@deepseek-ai/dsh-shell'
import * as dsh_shell_env from '@deepseek-ai/dsh-shell-env'
import * as dsh_skill from '@deepseek-ai/dsh-skill'
import * as dsh_spill from '@deepseek-ai/dsh-spill'
import * as dsh_spill_policy from '@deepseek-ai/dsh-spill-policy'
// dsh_storage / dsh_storage_domain: see registration comment below; needs Tauri commands + Config injection
// import * as dsh_storage from '@deepseek-ai/dsh-storage'
// import * as dsh_storage_domain from '@deepseek-ai/dsh-storage-domain'
import * as dsh_system_prompt from '@deepseek-ai/dsh-system-prompt'
import * as dsh_terminal from '@deepseek-ai/dsh-terminal'
import * as dsh_time_context from '@deepseek-ai/dsh-time-context'
import * as dsh_tmux_context from '@deepseek-ai/dsh-tmux-context'
import * as dsh_token_meter from '@deepseek-ai/dsh-token-meter'
import * as dsh_tool_ask_user from '@deepseek-ai/dsh-tool-ask-user'
import * as dsh_tool_call_timeout_policy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import * as dsh_tool_goal from '@deepseek-ai/dsh-tool-goal'
import * as dsh_tool_jobs from '@deepseek-ai/dsh-tool-jobs'
// TODO(phase3): re-enable when ported to browser-safe
// dsh-tool-lsp depends on dsh-subprocess-local (node:child_process) +
// dsh-fs-local (node:fs), and its render.ts imports node:path/node:url directly.
// import * as dsh_tool_lsp from '@deepseek-ai/dsh-tool-lsp'
import * as dsh_tool_ralph from '@deepseek-ai/dsh-tool-ralph'
import * as dsh_tool_session_query from '@deepseek-ai/dsh-tool-session-query'
import * as dsh_tool_subagent from '@deepseek-ai/dsh-tool-subagent'
import * as dsh_tool_subagent_control from '@deepseek-ai/dsh-tool-subagent-control'
import * as dsh_tool_subagent_report from '@deepseek-ai/dsh-tool-subagent-report'
// TODO(phase3): re-enable when ported to browser-safe
// dsh-tool-terminal depends on dsh-subprocess-local (node:child_process).
// import * as dsh_tool_terminal from '@deepseek-ai/dsh-tool-terminal'
import * as dsh_tool_todo from '@deepseek-ai/dsh-tool-todo'
import * as dsh_tool_web from '@deepseek-ai/dsh-tool-web'
import * as dsh_tool_workflow from '@deepseek-ai/dsh-tool-workflow'
import * as dsh_tools from '@deepseek-ai/dsh-tools'
import * as dsh_typert_registry from '@deepseek-ai/dsh-typert-registry/client'
import * as dsh_usage_stats from '@deepseek-ai/dsh-usage-stats'
import * as dsh_user_questions from '@deepseek-ai/dsh-user-questions'
import * as dsh_web from '@deepseek-ai/dsh-web'
import * as dsh_web_fetch_http from '@deepseek-ai/dsh-web-fetch-http'
// TODO(phase3): re-enable when ported to browser-safe
// dsh-web-search-deepseek depends on dsh-credentials-local (chokidar).
// import * as dsh_web_search_deepseek from '@deepseek-ai/dsh-web-search-deepseek'
import * as dsh_web_search_exa from '@deepseek-ai/dsh-web-search-exa'
import * as dsh_web_search_perplexity from '@deepseek-ai/dsh-web-search-perplexity'
import * as dsh_workflow from '@deepseek-ai/dsh-workflow'

/**
 * Cordis plugin bodies for every browser-safe package. Re-exported so the
 * shell boot can register them without touching each module. Plugins whose
 * default export is a Cordis Service class (e.g. LlmRuntime,
 * AgentDefaultModelConfig) ride the namespace — cordis accepts a plain
 * module as a plugin when its `apply` named export is the body.
 */
export const inboxPlugins = [
  dsh_agent_default_model,
  // dsh_agent_spine_demo: commented — pulls in dsh-skill-filesystem (chokidar) + dsh-subprocess-local
  dsh_agent_tool_presentation,
  dsh_api_gateway,
  dsh_api_remotes,
  dsh_attachment,
  // dsh_bash_local: commented — depends on dsh-subprocess-local (node:child_process)
  // dsh_client_ui_settings: must boot before ui-locale and every other ui-*
  // plugin that reads `ctx.settingsScope.bind(...)` — provides the
  // settings-namespace transport (no Tauri / no fs; the persistence path
  // hooks in once `dsh-storage` lands).
  dsh_client_ui_settings,
  dsh_client_locale,
  dsh_client_connection,
  dsh_client_runtime,
  dsh_client_ui_account,
  dsh_client_ui_agent_preset,
  dsh_client_ui_commands,
  dsh_client_ui_conversation,
  dsh_client_ui_cordis,
  dsh_client_ui_deliverables,
  dsh_client_ui_directory_picker_browse,
  dsh_client_ui_directory_picker_native,
  dsh_client_ui_goal,
  dsh_client_ui_input_trigger,
  dsh_client_ui_jobs,
  dsh_client_ui_layout,
  dsh_client_ui_message_feedback,
  dsh_client_ui_model_selection,
  dsh_client_ui_permission_presets,
  dsh_client_ui_plan,
  dsh_client_ui_settings_agent,
  dsh_client_ui_settings_general,
  dsh_client_ui_settings_mcp,
  dsh_client_ui_settings_models,
  dsh_client_ui_settings_plugin_inventory,
  dsh_client_ui_settings_plugins,
  dsh_client_ui_settings_proxy,
  dsh_client_ui_settings_skill,
  dsh_client_ui_settings_usage,
  dsh_client_ui_sidebar,
  dsh_client_ui_skill,
  dsh_client_ui_subagent,
  dsh_client_ui_theme,
  dsh_client_ui_tool,
  dsh_client_ui_trajectory,
  dsh_client_ui_user_questions,
  dsh_client_ui_workflow_run,
  dsh_client_ui_workspace,
  dsh_command_compact,
  dsh_command_feedback,
  dsh_command_goal,
  dsh_commands,
  dsh_compaction,
  dsh_compaction_headroom,
  dsh_compaction_tool_result_pruner,
  dsh_cordis_client_runner,
  dsh_credentials,
  dsh_fs,
  dsh_fs_observation_policy,
  dsh_host_directory_picker,
  dsh_invariants,
  // dsh_jobs: commented — JobRegistry is the abstract seam; dsh_jobs_local extends it with the local implementation
  dsh_jobs_local,
  dsh_llm,
  dsh_llm_deepseek,
  // dsh_llm_pi_ai: commented — see import block above; pi-ai env-probe strings trip CORS in browser
  // dsh_llm_pi_ai,
  dsh_lsp,
  // dsh_network: commented — depends on undici (Node-only HTTP dispatcher); client-first proxy goes through Rust reqwest (spec 6.4)
  dsh_permission_presets,
  dsh_persona,
  dsh_plan_mode,
  dsh_repeat_tool_reminder,
  dsh_schedule,
  dsh_session_checkpoint_policy,
  dsh_session_log_export,
  dsh_session_persistence,
  dsh_session_projection,
  dsh_session_projection_cache,
  dsh_session_query,
  dsh_session_reference,
  dsh_session_stats,
  dsh_session_title,
  dsh_session_title_all_prompts_llm,
  dsh_session_title_first_prompt_llm,
  dsh_shell,
  dsh_shell_env,
  dsh_skill,
  dsh_spill,
  dsh_spill_policy,
  // dsh_storage: see import block — needs Tauri Config + KV backends (spec §6.4)
  // dsh_storage,
  // dsh_storage_domain: depends on dsh_storage (Config.backend injection)
  // dsh_storage_domain,
  dsh_system_prompt,
  dsh_terminal,
  dsh_time_context,
  dsh_tmux_context,
  dsh_token_meter,
  dsh_tool_ask_user,
  dsh_tool_call_timeout_policy,
  dsh_tool_goal,
  dsh_tool_jobs,
  // dsh_tool_lsp: commented — depends on dsh-subprocess-local + dsh-fs-local + node:path in render.ts
  dsh_tool_ralph,
  dsh_tool_session_query,
  dsh_tool_subagent,
  dsh_tool_subagent_control,
  dsh_tool_subagent_report,
  // dsh_tool_terminal: commented — depends on dsh-subprocess-local
  dsh_tool_todo,
  dsh_tool_web,
  dsh_tool_workflow,
  dsh_tools,
  dsh_typert_registry,
  dsh_usage_stats,
  dsh_user_questions,
  dsh_web,
  dsh_web_fetch_http,
  // dsh_web_search_deepseek: commented — depends on dsh-credentials-local (chokidar)
  dsh_web_search_exa,
  dsh_web_search_perplexity,
  dsh_workflow,
] as const

/** Number of in-box plugins the shell boot wires into the host context. */
export const inboxPluginsCount = 109

export type InboxPlugin = (typeof inboxPlugins)[number]
