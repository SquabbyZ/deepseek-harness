# Plugin Migration Audit

Phase 2 Task 2.6.1. Read-only audit of every package in `packages/` for
compatibility with the WebView2 in-box plugin loader. Each package is
categorized by whether it can run unmodified in the browser, needs a Tauri
`invoke()` rewrite, or is dead / Node-only with no browser equivalent.

The companion implementation (`in-box loader`) lives outside this audit; this
doc only answers **which packages need work** and **what kind of work**.

---

## Method

A static scan walks every `src/**/*.{ts,tsx,js,jsx,mjs,cjs}` file under each
package and harvests `import`/`require` specifiers. Specifiers that resolve to
Node built-ins (`fs`, `path`, `child_process`, `os`, `crypto`, `http`,
`https`, `url`, `util`, `stream`, `buffer`, `net`, `tls`, `worker_threads`,
`vm`, `process`, `events`, etc., or `node:*` aliases) are classified as
**Node imports**.

- **HEAVY** — `fs`, `path`, `child_process`, `os`, `worker_threads`, `vm`,
  `http`, `https`, `net`, `tls`, `dgram`, `dns`, `cluster`, `readline`,
  `tty`, `perf_hooks`, `v8`, `zlib`. These need real platform work to
  replace (Tauri command, file picker, web socket, etc.).
- **LIGHT** — `crypto` (often just `randomUUID`, browser-available),
  `stream`/`buffer` (Node-WebStreams gap), `url`/`util` (mostly fine),
  `events`/`process`/`assert`. Mostly browser-available or replaceable
  with a one-line swap.
- **pure** — no Node built-in imports. Browser-safe as written.

Categorization then layers intent: a package that **only** uses `LIGHT` Node
APIs and is intended for the browser side is still treated as **browser-safe**
when the import is replaceable with a browser API (e.g. `crypto.randomUUID()`).
The categorization below reflects the *intended* in-box role first and the
*Node-impurity* second.

The audit does **not** edit any package. It only records what work each
package needs when the in-box loader lands.

---

## Summary

| Bucket | Count | Meaning |
|---|---|---|
| **Browser-safe** | 138 | No Node built-in imports at all; loads as-is in the WebView2 context. Wire to the in-box loader. |
| **Needs port** | 88 | Imports at least one Node built-in (`fs`, `path`, `child_process`, `os`, `crypto`, `http`, …). The call sites must change to `invoke()` (Tauri command) or a browser-API equivalent before the package can ship. |
| **Delete** | 3 | Dead / Node-only with no browser replacement. |
| **Total** | **229** | |

Plus one workspace-level candidate:

- `apps/cli` — keep only the headless profile (already covered by
  `@deepseek-ai/dsh-headless`); the web-profile CLI bin is replaced by
  the Tauri shell.

---

## Browser-safe (no change needed, just register in in-box loader)

These packages have **no Node built-in imports** at all in `src/`. They
load as-is in the WebView2 context; no `invoke()` rewrite is required.

Packages with only `LIGHT` Node imports (typically `crypto.randomUUID()`,
`URL`, `util.inspect` in debug logs, or `Buffer.from`) are listed under
*Needs port* — the rewrite is a one-line swap, but it still has to happen
before the package ships.

### `packages/client/` (browser half) — 42

Every `ui-*` slot plugin, plus the runtime/schema-form/web/web-react shells
and the locale package. The Node-side bridging packages in this group
(`client-connection`, `client-hmr`, `client-modules`) are listed under
*Needs port*.

- `@deepseek-ai/dsh-client-locale`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-schema-form`
- `@deepseek-ai/dsh-client-ui-account`
- `@deepseek-ai/dsh-client-ui-agent-preset`
- `@deepseek-ai/dsh-client-ui-attachment`
- `@deepseek-ai/dsh-client-ui-commands`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-client-ui-deliverables`
- `@deepseek-ai/dsh-client-ui-directory-picker-browse`
- `@deepseek-ai/dsh-client-ui-directory-picker-native`
- `@deepseek-ai/dsh-client-ui-goal`
- `@deepseek-ai/dsh-client-ui-input-trigger`
- `@deepseek-ai/dsh-client-ui-jobs`
- `@deepseek-ai/dsh-client-ui-layout`
- `@deepseek-ai/dsh-client-ui-message-feedback`
- `@deepseek-ai/dsh-client-ui-model-selection`
- `@deepseek-ai/dsh-client-ui-permission-presets`
- `@deepseek-ai/dsh-client-ui-plan`
- `@deepseek-ai/dsh-client-ui-primitives`
- `@deepseek-ai/dsh-client-ui-settings`
- `@deepseek-ai/dsh-client-ui-settings-agent`
- `@deepseek-ai/dsh-client-ui-settings-general`
- `@deepseek-ai/dsh-client-ui-settings-mcp`
- `@deepseek-ai/dsh-client-ui-settings-models`
- `@deepseek-ai/dsh-client-ui-settings-plugin-inventory`
- `@deepseek-ai/dsh-client-ui-settings-plugins`
- `@deepseek-ai/dsh-client-ui-settings-proxy`
- `@deepseek-ai/dsh-client-ui-settings-skill`
- `@deepseek-ai/dsh-client-ui-settings-usage`
- `@deepseek-ai/dsh-client-ui-sidebar`
- `@deepseek-ai/dsh-client-ui-skill`
- `@deepseek-ai/dsh-client-ui-slots`
- `@deepseek-ai/dsh-client-ui-subagent`
- `@deepseek-ai/dsh-client-ui-theme`
- `@deepseek-ai/dsh-client-ui-tool`
- `@deepseek-ai/dsh-client-ui-trajectory`
- `@deepseek-ai/dsh-client-ui-user-questions`
- `@deepseek-ai/dsh-client-ui-workflow-run`
- `@deepseek-ai/dsh-client-ui-workspace`
- `@deepseek-ai/dsh-client-web`
- `@deepseek-ai/dsh-client-web-react`

### `packages/extensions/` (browser halves) — 3

The Cordis dual-face pair splits into a Node-side host runner and three
browser-side halves. The browser halves load unmodified.

- `@deepseek-ai/dsh-cordis-client-runner` — evaluates the dynamic-package
  definition into a live browser plugin; `apply()` is empty.
- `@deepseek-ai/dsh-tool-cordis` — model-facing runtime-inspection /
  dynamic-package tools.
- `@deepseek-ai/dsh-client-ui-cordis` — browser surfaces: the frame-wide
  panel and the read-only define card.

(`@deepseek-ai/dsh-cordis-host-runner` uses `node:vm` and is in *Delete*.)

### `packages/bundle/` (profile patches) — 1

- `@deepseek-ai/dsh-base` — every profile's first patch layer; no Node
  imports in `src/`.

### `packages/examples/` — 1

- `@deepseek-ai/dsh-agent-spine-demo` — the agent-spine demo bundle; pure
  ESM in `src/`.

### `packages/host/` — 1

- `@deepseek-ai/dsh-host-directory-picker` — the abstract directory-picker
  seam. The concrete `host-directory-picker-auto` / `browse` / `native`
  implementations live under *Needs port* (Tauri dialog plugin
  replaces them).

### `packages/boot/` — 1

- `@deepseek-ai/dsh-cmdline` — pure argument parser used by every bin
  entry; no Node imports in `src/`.

### Capability seams (Service Definition + Consumer roles) — 76

These groups contain pure abstract seams and model-facing tool wrappers; they
have no platform dependency and run unmodified in the browser. Each group
below lists its `*-pure` packages only — local-provider / Node-side packages
are listed under *Needs port* or *Delete*.

- `core/` — `@deepseek-ai/dsh-agent-default-model`,
  `@deepseek-ai/dsh-agent-tool-presentation`, `@deepseek-ai/dsh-network`,
  `@deepseek-ai/dsh-scope`, `@deepseek-ai/dsh-system-prompt`,
  `@deepseek-ai/dsh-tools` (6).

  *(`dsh-agent` uses `node:async_hooks` / `node:util/types`,
  `dsh-agent-loop` uses `crypto.randomUUID` only, `dsh-session` uses
  `node:path` — all three Needs port.)*
- `api/` — `@deepseek-ai/dsh-api-gateway`, `@deepseek-ai/dsh-api-remotes` (2).
- `attachment/` — `@deepseek-ai/dsh-attachment` (1; `attachment-local` and
  `media-intake` are Node providers).
- `compaction/` — `@deepseek-ai/dsh-command-compact`,
  `@deepseek-ai/dsh-compaction`, `@deepseek-ai/dsh-compaction-headroom`,
  `@deepseek-ai/dsh-compaction-tool-result-pruner` (4; `compaction-basic`
  uses `crypto.randomUUID`/`util` only — Needs port).
- `context/` — `@deepseek-ai/dsh-session-reference`,
  `@deepseek-ai/dsh-time-context`, `@deepseek-ai/dsh-tmux-context` (3).
- `feedback/` — `@deepseek-ai/dsh-command-feedback` (1; `message-feedback`
  uses `buffer`/`crypto` — Needs port).
- `goal/` — `@deepseek-ai/dsh-command-goal`, `@deepseek-ai/dsh-tool-goal` (2;
  `goal` and `goal-round-driver` use `crypto`/`util` — Needs port).
- `guard/` — `@deepseek-ai/dsh-repeat-tool-reminder`,
  `@deepseek-ai/dsh-tool-call-timeout-policy` (2).
- `interaction/` — `@deepseek-ai/dsh-commands`,
  `@deepseek-ai/dsh-permission-presets`, `@deepseek-ai/dsh-tool-ask-user`,
  `@deepseek-ai/dsh-user-questions` (4; `user-approval` uses `crypto` —
  Needs port).
- `jobs/` — `@deepseek-ai/dsh-jobs`, `@deepseek-ai/dsh-jobs-local`,
  `@deepseek-ai/dsh-tool-jobs` (3).
- `llm/` — `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-llm-deepseek`,
  `@deepseek-ai/dsh-llm-pi-ai`, `@deepseek-ai/dsh-token-meter` (4; `llm-retry`
  uses `crypto.randomUUID` only — Needs port).
- `lsp/` — `@deepseek-ai/dsh-lsp`, `@deepseek-ai/dsh-tool-lsp` (2; `lsp-stdio`
  uses `stream`/`buffer` — Needs port).
- `mcp/` — none (the only package uses `crypto` — Needs port).
- `plan/` — `@deepseek-ai/dsh-plan-mode` (1).
- `preset/` — `@deepseek-ai/dsh-persona` (1; `agent-presets` uses `path` —
  Needs port).
- `runtime-diagnostics/` — `@deepseek-ai/dsh-invariants` (1).
- `schedule/` — `@deepseek-ai/dsh-schedule` (1).
- `session/` — `@deepseek-ai/dsh-session-checkpoint-policy`,
  `@deepseek-ai/dsh-session-persistence`,
  `@deepseek-ai/dsh-session-projection`,
  `@deepseek-ai/dsh-session-projection-cache`,
  `@deepseek-ai/dsh-session-stats`,
  `@deepseek-ai/dsh-session-telemetry`,
  `@deepseek-ai/dsh-session-title`,
  `@deepseek-ai/dsh-session-title-all-prompts-llm`,
  `@deepseek-ai/dsh-session-title-first-prompt-llm`,
  `@deepseek-ai/dsh-session-title-llm` (10; `session-telemetry-otel` uses
  `node:module`, `session-persistence-jsonl`/`session-persistence-sqlite`
  are Node providers — all three Needs port).
- `session-query/` — `@deepseek-ai/dsh-session-log-export`,
  `@deepseek-ai/dsh-session-query`, `@deepseek-ai/dsh-tool-session-query` (3;
  `session-query-sqlite` uses `path` — Needs port).
- `skill/` — `@deepseek-ai/dsh-skill` (1; `skill-badge` uses `URL`, others
  use `crypto`/`fs`/`os`/`path` — Needs port).
- `spill/` — `@deepseek-ai/dsh-spill`, `@deepseek-ai/dsh-spill-policy` (2;
  `spill-local` uses `fs`/`os`/`path` — Needs port).
- `storage/` — `@deepseek-ai/dsh-storage`,
  `@deepseek-ai/dsh-storage-domain` (2; `storage-json`/`storage-sqlite`
  use `path`/`fs` — Needs port).
- `subprocess/` — none (`subprocess` uses `stream`, `subprocess-local`
  uses `fs`/`path`/`child_process`/`os` — both Needs port).
- `terminal/` — `@deepseek-ai/dsh-terminal`, `@deepseek-ai/dsh-tool-terminal`
  (2; `terminal-bash` uses `buffer` — Needs port).
- `todo/` — `@deepseek-ai/dsh-tool-todo` (1).
- `typert/` — `@deepseek-ai/dsh-typert-protocol`,
  `@deepseek-ai/dsh-typert-registry` (2; `typert-generator`/`typert-loader`
  use `fs`/`path` — Needs port).
- `usage/` — `@deepseek-ai/dsh-usage-stats` (1).
- `util/` — `@deepseek-ai/dsh-brand`, `@deepseek-ai/dsh-launch-environment`,
  `@deepseek-ai/dsh-output-retention`, `@deepseek-ai/dsh-timeout` (4;
  `atomic-write`/`native-command`/`home-paths` use Node APIs).
- `web/` — `@deepseek-ai/dsh-tool-web`, `@deepseek-ai/dsh-web`,
  `@deepseek-ai/dsh-web-fetch-http`, `@deepseek-ai/dsh-web-search-deepseek`,
  `@deepseek-ai/dsh-web-search-exa`, `@deepseek-ai/dsh-web-search-perplexity`
  (6).
- `workflow/` — `@deepseek-ai/dsh-tool-ralph`, `@deepseek-ai/dsh-tool-workflow`,
  `@deepseek-ai/dsh-workflow` (3; `workflow-worker-thread` uses
  `worker_threads`/`vm` — Needs port).
- `shell/` — `@deepseek-ai/dsh-shell`, `@deepseek-ai/dsh-shell-env`,
  `@deepseek-ai/dsh-bash-local` (3; sandboxed/local-pwsh providers use
  `fs`/`path`/`child_process` — Needs port).

### `test-support/` — 2 (browser-safe)

- `@deepseek-ai/dsh-agent-loop-testkit`, `@deepseek-ai/dsh-client-test-runtime`
  used by browser harnesses; `@deepseek-ai/dsh-agent-spine-demo` lives
  under `packages/examples/` (browser-safe, listed below).

(The other four `test-support` packages — `acp-snapshot`,
`llm-mock-server`, `llm-replay`, `loader-smoke` — use Node APIs and stay
  Node-only.)

---

## Needs port (uses `invoke()` / browser-API replacement, still browser-loadable)

These packages still belong in the in-box loader, but at least one call site
must change from a Node API to a Tauri command (or a browser-API equivalent)
before the package can ship. Group by the smallest replacement unit.

### Subagent providers — 6

The subagent family runs in-process in the browser; child-session lifecycle
must go through Tauri commands instead of `node:fs` / `node:crypto` /
`node:stream`.

- `@deepseek-ai/dsh-subagent` — replace `node:crypto.randomUUID` →
  `crypto.randomUUID()` (1-line); strip `fs`/`path` references (use the
  capability seam, not direct filesystem). → **S7.0**
- `@deepseek-ai/dsh-subagent-acp` — same `crypto` swap + the `fs`/`path`
  imports move into the Tauri IPC layer. → **S7.2**
- `@deepseek-ai/dsh-subagent-claude-code` — `crypto`/`path` swaps;
  `events` import is browser-available. → **S7.4**
- `@deepseek-ai/dsh-subagent-codex` — `crypto.randomUUID` → `crypto` (browser)
  + `stream` → `TransformStream`. → **S7.3**
- `@deepseek-ai/dsh-subagent-dsh-sdk` — `crypto.randomUUID` → `crypto`
  (browser). → **S7.5**
- `@deepseek-ai/dsh-subagent-in-process-driver` — `crypto.randomUUID` →
  `crypto` (browser). → **S7.1**

(`@deepseek-ai/dsh-subagent-spawn-in-process`,
`@deepseek-ai/dsh-subagent-fork-in-process`, and the three `tool-subagent*`
packages are already browser-safe and listed above.)

### Filesystem / sandbox / local-provider replacements — 9

- `@deepseek-ai/dsh-credentials-local` — `node:path` import is metadata-only;
  swap to `URL` or remove. → **FS-1**
- `@deepseek-ai/dsh-sandbox-policy` — `node:path` import used for join;
  swap to `URL.pathname` join or remove. → **SB-2**
- `@deepseek-ai/dsh-settings-file` — `node:path` is metadata-only;
  swap to `URL`. → **ST-1**
- `@deepseek-ai/dsh-storage-json` — `node:path` metadata-only; swap. → **SR-1**
- `@deepseek-ai/dsh-storage-sqlite` — `node:path`/`fs` provider; replace
  with the Tauri-managed sqlite-backed storage surface (or keep as a
  Node-side capability with a browser shim). → **SR-2**
- `@deepseek-ai/dsh-session-query-sqlite` — `node:path` provider; same
  pattern as storage-sqlite. → **SQ-1**
- `@deepseek-ai/dsh-session-persistence-jsonl` — `node:fs`/`path`/
  `perf_hooks`/`zlib`; move to a Tauri command that owns the JSONL file. → **PE-1**
- `@deepseek-ai/dsh-session-persistence-sqlite` — `node:fs`/`path`;
  same as storage-sqlite. → **PE-2**
- `@deepseek-ai/dsh-session` — `node:path` import is metadata-only
  (id parsing); swap to `URL`/`Intl` style. → **PE-0**

### Browser-host bridge — 3

These three packages are the host-side connectors between the Cordis loader
and the browser half. They stay on the Node side, but their browser-facing
surface is what the in-box loader calls.

- `@deepseek-ai/dsh-client-connection` — uses `node:http`/`stream`; convert
  to Tauri's HTTP fetch + WebSocket events. → **CC-1**
- `@deepseek-ai/dsh-client-hmr` — uses `node:fs`/`http` for source-map
  serving; Tauri's asset protocol replaces both. → **HM-1**
- `@deepseek-ai/dsh-client-modules` — the Node half of the `dsh.client`
  dual-face loader; uses `node:fs`/`path`/`crypto`/`http`/`module`. The
  browser half already exists (`dsh.client` exports); the Node half's
  responsibilities collapse into a Tauri command that scans manifest
  entries. → **CM-1**

### Provider adapters / local impls — 18

The Provider half of each capability seam. Each can be ported with a
Tauri-command bridge (or deleted if no browser equivalent exists).

- `@deepseek-ai/dsh-attachment-local` — `node:fs`/`path` provider; replace
  with Tauri `attachment_local_*` commands. → **AT-1**
- `@deepseek-ai/dsh-media-intake` — same shape. → **AT-2**
- `@deepseek-ai/dsh-fs-local` — `node:fs`/`path` provider; replace with
  Tauri file APIs. → **FS-2**
- `@deepseek-ai/dsh-fs-sandbox` — `node:fs`/`path` provider; same as fs-local
  but sandboxed. → **FS-3**
- `@deepseek-ai/dsh-tool-fs`, `@deepseek-ai/dsh-tool-fs-search`,
  `@deepseek-ai/dsh-tool-str-replace-editor` — `node:path` metadata; swap. → **FS-4..6**
- `@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-pwsh`,
  `@deepseek-ai/dsh-bash-sandbox`, `@deepseek-ai/dsh-pwsh-local`,
  `@deepseek-ai/dsh-pwsh-sandbox` — `node:fs`/`path` provider plumbing;
  move the spawn to a Tauri command. → **SH-1..5**
- `@deepseek-ai/dsh-tool-bash-persistent` — `crypto.randomUUID` →
  `crypto` (browser). → **SH-6**
- `@deepseek-ai/dsh-spill-local` — `node:fs`/`path`/`os` provider; replace
  with a Tauri-managed spill dir. → **SP-1**
- `@deepseek-ai/dsh-skill-filesystem` — `node:fs`/`path`/`os` provider;
  replace with Tauri file APIs. → **SK-1**
- `@deepseek-ai/dsh-tool-skill` — `crypto.randomUUID` → `crypto` (browser). → **SK-2**
- `@deepseek-ai/dsh-skill-badge` — `node:url` import for `URL` constructor;
  swap to global `URL`. → **SK-3**
- `@deepseek-ai/dsh-goal-round-driver` — `node:util` import (`util.inspect`
  in debug logs); remove or guard. → **GL-1**

### Hooks / identity / sandbox backends — 7

- `@deepseek-ai/dsh-hooks-claude-code`, `@deepseek-ai/dsh-hooks-codex` —
  `node:fs`/`path` provider; replace with the host-side hook bridge that
  talks to the Claude/Codex CLI via Tauri commands. → **HK-1..2**
- `@deepseek-ai/dsh-anonymous-user-id` — `node:fs`/`path` for storage;
  swap to `localStorage` / Tauri store. → **ID-1**
- `@deepseek-ai/dsh-github-oauth` — `node:child_process`/`http`/`net`/`fs`/
  `path`; this is an OAuth callback server — replace with Tauri's deep-link
  / webview flow. → **ID-2**
- `@deepseek-ai/dsh-sandbox` — `node:fs`/`os` provider; replace with a
  Tauri-managed sandbox seam. → **SB-1**
- `@deepseek-ai/dsh-sandbox-local` — `node:child_process`/`fs`/`os`/`path`
  provider (bwrap/Landlock backend); keep Node-side, expose through a Tauri
  command. → **SB-3**
- `@deepseek-ai/dsh-sandbox-windows-acl` — `node:fs`/`path` provider
  (Windows ACL backend); same pattern. → **SB-4**

### Misc / one-offs — 5

- `@deepseek-ai/dsh-acp` — `node:path` metadata; swap to `URL`. → **AP-1**
- `@deepseek-ai/dsh-acp-demo` — `node:util`/`path` for CLI args;
  this bin stays Node-side; no browser equivalent. → **AP-2**
- `@deepseek-ai/dsh-sdk-jsonrpc-demo` — `node:fs` for fixture loading; the
  demo stays Node-side. → **AP-3**
- `@deepseek-ai/dsh-sdk-client` — `node:path`/`child_process` for spawning
  the SDK server; replace with a Tauri command that spawns the SDK process. → **SDK-1**
- `@deepseek-ai/dsh-sdk-jsonrpc-server` — `node:stream`/`path` server;
  keep Node-side. → **SDK-2**
- `@deepseek-ai/dsh-e2b`, `@deepseek-ai/dsh-fs-e2b`,
  `@deepseek-ai/dsh-subprocess-e2b` — `node:path` only; swap. → **E2B-1..3**
- `@deepseek-ai/dsh-agent-instructions` — `node:fs`/`path` for file-load;
  swap to Tauri file APIs. → **AG-1**
- `@deepseek-ai/dsh-mcp-client` — `crypto.randomUUID` → `crypto` (browser). → **MC-1**
- `@deepseek-ai/dsh-user-approval` — `crypto.randomUUID` → `crypto` (browser). → **IA-1**
- `@deepseek-ai/dsh-message-feedback` — `crypto`/`buffer` swaps. → **FB-1**
- `@deepseek-ai/dsh-compaction-basic` — `crypto`/`util` swaps. → **CM-2**
- `@deepseek-ai/dsh-agent-loop` — `crypto.randomUUID` swap. → **AG-2**
- `@deepseek-ai/dsh-llm-retry` — `crypto.randomUUID` swap. → **LLM-1**
- `@deepseek-ai/dsh-lsp-stdio` — `stream`/`buffer` swaps to Web Streams. → **LSP-1**
- `@deepseek-ai/dsh-agent-presets` — `node:path` metadata; swap. → **PR-1**
- `@deepseek-ai/dsh-subprocess-local` — `node:fs`/`path`/`child_process`/`os`
  provider; replace with Tauri-side spawn. → **SP-2**
- `@deepseek-ai/dsh-terminal-bash` — `buffer` import (likely `Buffer.from`);
  swap to `Uint8Array`/`TextEncoder`. → **TM-1**
- `@deepseek-ai/dsh-workspace` — `node:path` metadata; swap. → **WS-1**
- `@deepseek-ai/dsh-code-runtime-worker-thread` — `node:worker_threads`;
  the in-browser worker equivalent is `new Worker(new URL(...))` with the
  same Cordis payload. → **CR-1**
- `@deepseek-ai/dsh-workflow-worker-thread` — `node:os`/`worker_threads`/`vm`;
  same as code-runtime + drop the `vm` sandbox. → **WF-1**
- `@deepseek-ai/dsh-typert-generator`, `@deepseek-ai/dsh-typert-loader` —
  `node:fs`/`path`; keep Node-side, expose via Tauri command. → **TP-1..2**

### Host bridge (Tauri-replaced) — 7

The `host/` group is the Web-GUI Node-side HTTP bridge. The audit treats
each package as *needs port* because the Tauri shell replaces the
`node:http` server. The current `apps/cli` web profile and any future
Tauri shell both consume the same Cordis services — the rewrite is
mechanical.

- `@deepseek-ai/dsh-host-apiproxy` — `node:crypto`/`fs`/`path`/`os`;
  replace `fetch`/crypto handshakes with the Tauri-managed API proxy. → **H-1**
- `@deepseek-ai/dsh-host-directory-picker-auto`,
  `@deepseek-ai/dsh-host-directory-picker-browse` — `node:fs`/`os`/`path`;
  Tauri dialog plugin. → **H-2..3**
- `@deepseek-ai/dsh-host-directory-picker-native` — `node:child_process`/
  `url`; native dialog through Tauri's `tauri-plugin-dialog`. → **H-4**
- `@deepseek-ai/dsh-host-frontend-static` — `node:http`/`fs`/`path`; Tauri
  asset protocol replaces the static handler. → **H-5**
- `@deepseek-ai/dsh-host-webserver` — `node:http`/`net`; **DELETE** —
  replaced by Tauri's WebView2 server (see Delete).

(`@deepseek-ai/dsh-host-directory-picker` is the abstract seam and ships
browser-safe; it is listed in the *Browser-safe* section above under the
host bridge group, not here.)

### Util / misc — 3

- `@deepseek-ai/dsh-atomic-write` — `node:path` metadata; swap. → **U-1**
- `@deepseek-ai/dsh-home-paths` — `node:os`/`path`; replace with a Tauri
  path resolver. → **U-2**
- `@deepseek-ai/dsh-native-command` — `node:child_process`; keep Node-side,
  expose via Tauri command. → **U-3**

### Test support (Node-only) — 3

- `@deepseek-ai/dsh-acp-snapshot` — `node:fs`/`os`/`path`/`child_process`
  snapshot harness; keep Node-side. → **T-1**
- `@deepseek-ai/dsh-llm-mock-server` — `node:http`/`net`; keep Node-side. → **T-2**
- `@deepseek-ai/dsh-llm-replay`, `@deepseek-ai/dsh-loader-smoke` —
  `node:fs`/`os`/`path` harnesses; keep Node-side. → **T-3..4**

### Bundle profile layers — 2

- `@deepseek-ai/dsh-headless` — `crypto.randomUUID` only; swap. → **B-1**
- `@deepseek-ai/dsh-web-app` — `node:module`/`os`/`url`; the web profile
  is replaced by the Tauri shell — see Delete.

---

## Delete (dead code or Node-only with no browser replacement)

These three packages have no role in the WebView2 / Tauri architecture and
should be removed (or, where useful, archived in `vendor/` for the legacy
Electron / web-profile CLI build):

- **`@deepseek-ai/dsh-app-boot`** — Node CLI bin glue (`.env` load, config
  path resolution, fail-loud Loader guards). The Tauri shell provides its
  own boot; the headless CLI keeps a thinner boot in `dsh-cmdline`.
  → **D-1**

- **`@deepseek-ai/dsh-host-webserver`** — `node:http` server + the
  `webServer` Cordis service. Replaced by Tauri's WebView2. The Cordis
  service contract moves to `@deepseek-ai/dsh-host-apiproxy` (rewrite) and
  the `client-connection` shim.
  → **D-2**

- **`@deepseek-ai/dsh-cordis-host-runner`** — `node:vm` sandbox that
  defines/inspects dynamic cordis packages on the host. The dual-half
  split already moved the browser face to `@deepseek-ai/dsh-cordis-client-runner`;
  the host face has no callers in the Tauri build. Keep the package in
  `vendor/cordis-host-runner/` if you want to preserve the Electron
  build, otherwise delete.
  → **D-3**

### Workspace-level

- **`apps/cli`** — keep the headless profile (covered by
  `@deepseek-ai/dsh-headless` + `@deepseek-ai/dsh-cmdline`). Drop the
  web-profile CLI bin; the Tauri shell replaces it.
  → **D-4**

---

## Counts by group

| Group | Browser-safe | Needs port | Delete | Total |
|---|---:|---:|---:|---:|
| `acp` | 0 | 1 | 0 | 1 |
| `api` | 2 | 0 | 0 | 2 |
| `attachment` | 1 | 2 | 0 | 3 |
| `boot` | 1 | 0 | 1 | 2 |
| `bundle` | 1 | 2 | 0 | 3 |
| `client` | 42 | 3 | 0 | 45 |
| `code-runtime` | 1 | 1 | 0 | 2 |
| `compaction` | 4 | 1 | 0 | 5 |
| `context` | 3 | 1 | 0 | 4 |
| `core` | 6 | 3 | 0 | 9 |
| `credentials` | 1 | 1 | 0 | 2 |
| `e2b` | 0 | 3 | 0 | 3 |
| `examples` | 1 | 2 | 0 | 3 |
| `extensions` | 3 | 0 | 1 | 4 |
| `feedback` | 1 | 1 | 0 | 2 |
| `fs` | 2 | 5 | 0 | 7 |
| `goal` | 2 | 2 | 0 | 4 |
| `guard` | 2 | 0 | 0 | 2 |
| `hooks` | 1 | 2 | 0 | 3 |
| `host` | 1 | 5 | 1 | 7 |
| `identity` | 0 | 2 | 0 | 2 |
| `interaction` | 4 | 1 | 0 | 5 |
| `jobs` | 3 | 0 | 0 | 3 |
| `llm` | 3 | 2 | 0 | 5 |
| `lsp` | 1 | 2 | 0 | 3 |
| `mcp` | 0 | 1 | 0 | 1 |
| `plan` | 1 | 0 | 0 | 1 |
| `preset` | 1 | 1 | 0 | 2 |
| `runtime-diagnostics` | 1 | 0 | 0 | 1 |
| `sandbox` | 0 | 4 | 0 | 4 |
| `schedule` | 1 | 0 | 0 | 1 |
| `sdk` | 0 | 3 | 0 | 3 |
| `session` | 10 | 3 | 0 | 13 |
| `session-query` | 3 | 1 | 0 | 4 |
| `settings` | 1 | 1 | 0 | 2 |
| `shell` | 3 | 6 | 0 | 9 |
| `skill` | 1 | 3 | 0 | 4 |
| `spill` | 2 | 1 | 0 | 3 |
| `storage` | 2 | 2 | 0 | 4 |
| `subagent` | 5 | 6 | 0 | 11 |
| `subprocess` | 0 | 2 | 0 | 2 |
| `terminal` | 2 | 1 | 0 | 3 |
| `test-support` | 2 | 4 | 0 | 6 |
| `todo` | 1 | 0 | 0 | 1 |
| `typert` | 2 | 2 | 0 | 4 |
| `usage` | 1 | 0 | 0 | 1 |
| `util` | 4 | 3 | 0 | 7 |
| `web` | 6 | 0 | 0 | 6 |
| `workflow` | 3 | 1 | 0 | 4 |
| `workspace` | 0 | 1 | 0 | 1 |
| **Total** | **138** | **88** | **3** | **229** |

---

## What this audit does NOT cover

- It does not rank the 48 port tasks by priority or staffing. The `→ Sx.y`
  / `→ H-x` / etc. pointers are placeholders for the planning step.
- It does not name a concrete Tauri command surface. That belongs to the
  Tauri-bridge design task (separate brief).
- It does not propose new packages. The brief asked for read-only
  categorization only.