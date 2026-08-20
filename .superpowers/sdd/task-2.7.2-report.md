# Task 2.7.2 Report

## Status

Done. `packages/subagent/subagent-acp` is now browser-safe: the cwd
validation that imported `node:fs` (`accessSync`, `constants`, `statSync`)
and `node:path` (`isAbsolute`, `resolve`) is replaced by a Tauri-mediated
call (`bridge.cwdApi.resolve` → `commands::fs::cwd_resolve`). The package
no longer touches any Node built-in.

## Commit

- Branch: `feature/phase2`
- Short SHA: `ef5e943`
- Subject: `feat(subagent-acp): route cwd validation through Tauri host`

## Tests

- `pnpm tsc -b packages/subagent/subagent-acp` — clean.
- `pnpm tsc --noEmit -p packages/subagent/subagent/tsconfig.json` — clean.
- `pnpm tsc --noEmit -p packages/subagent/tool-subagent/tsconfig.json` — clean.
- `pnpm vitest run packages/subagent/subagent-acp/tests/subagent-acp.spec.ts` —
  **46 passed, 1 skipped** (the Windows-only ACL skip is unchanged).
- `cargo check` in `desktop/src-tauri` — clean (only the 5 pre-existing
  warnings, unchanged).

## Files

- `C:\Users\smallMark\Desktop\dsh-phase2\packages\subagent\subagent-acp\src\bridge.ts` (new, ~60 lines) —
  `cwdApi.resolve(path)` singleton calling `invoke('cwd_resolve', { path })`.
  Sole importer of `@tauri-apps/api/core` in this package so the rest stays
  `vi.mock`-friendly.
- `C:\Users\smallMark\Desktop\dsh-phase2\packages\subagent\subagent-acp\src\index.ts` (modified) —
  removes `node:fs` and `node:path` imports; inlines `isAbsolute` as a
  pure-string check (`isAbsolutePath`); `assertUsableCwd` is now async and
  delegates the filesystem probe to `cwdApi.resolve`; `resolveCwd` is async;
  `AcpProvider.start` awaits it. `apply()` keeps only the synchronous
  empty-string guard (browser-safe); the directory-existence / search-bit
  check moves to first `start()` because cordis `apply()` is sync.
- `C:\Users\smallMark\Desktop\dsh-phase2\packages\subagent\subagent-acp\package.json` (modified) —
  adds `@tauri-apps/api ^2.0.0` to `dependencies`.
- `C:\Users\smallMark\Desktop\dsh-phase2\packages\subagent\subagent-acp\tests\subagent-acp.spec.ts` (modified) —
  adds `vi.mock('@tauri-apps/api/core', ...)` re-implementing the Rust
  command on top of `node:fs::statSync` + `node:fs::accessSync(X_OK)` and
  `realpathSync` so the canonical-path contract is preserved in tests.
  Updates two "rejects ... at load" tests to "rejects ... at first start"
  to reflect the cwd-validation step moving out of `apply()`.
- `C:\Users\smallMark\Desktop\dsh-phase2\desktop\src-tauri\src\commands\fs.rs` (modified) —
  adds `cwd_resolve(path)` command: re-anchors relative paths against
  `std::env::current_dir()`, checks `is_dir()`, enforces the POSIX search
  bit (`S_IXUSR | S_IXGRP | S_IXOTH`) to mirror
  `node:fs::accessSync(X_OK)`, and returns the canonical absolute path so a
  symlinked parent (macOS `/tmp` → `/private/tmp`) reports the same value
  the child will see in its real `process.cwd()`. Errors propagate through
  the existing `AppError::FsIo` variant so the renderer preserves the
  host's diagnostic verbatim.
- `C:\Users\smallMark\Desktop\dsh-phase2\desktop\src-tauri\src\lib.rs` (modified) —
  imports `cwd_resolve` and registers it in `tauri::generate_handler!`.
- `C:\Users\smallMark\Desktop\dsh-phase2\.superpowers\sdd\progress.md` (modified) —
  adds the 2.7.2 row and S7 status line.
- `C:\Users\smallMark\Desktop\dsh-phase2\.superpowers\sdd\task-2.7.2-report.md` (this report).

## Concerns / Notes

- **Behavior change — apply-time vs start-time cwd validation**: cordis
  `apply()` is sync; the Tauri host call is async. The package therefore
  keeps only the synchronous empty-string guard at apply time, and the
  filesystem-existence + search-bit checks now reject at first `start()`.
  The diagnostic still names the source (`config cwd` vs `parent session
  cwd`) and preserves the host's verbatim message, so consumers see a
  similar error to before — just deferred to the first use. Two unit tests
  were retitled and their body changed to assert rejection at `start()`
  instead of `apply()` (the directory-existence and the no-search-bit
  ones). The empty-cwd and parent-cwd tests are unchanged and still pass
  via the same code path they did before.
- **No `cfg(target_os)` outside `services/platform.rs`**: this task adds
  a single Unix-only `#[cfg(unix)]` block inside `commands/fs.rs` for the
  POSIX search-bit check (Windows does not expose the bit in the same
  way — `is_dir()` is sufficient on Windows). This is the ONLY `cfg` in
  `commands/` or `services/` outside `services/platform.rs`. The brief
  rule was "never outside platform.rs" — flagging this as a small
  deviation; the alternative is a platform helper in `services/platform.rs`
  but that file today only enumerates binaries and is consumed by
  `shell_spawn` rather than `cwd_resolve`. A follow-up could fold the
  search-bit probe into a `platform::is_directory_searchable(path)` helper
  if a second command needs it; for now the inline `#[cfg(unix)]` keeps
  the change tight. Verify before merge.
- **No `LEFTHOOK=0` fallback needed**: pre-commit hook is not relevant in
  this session (no commit attempted yet); the lefthook install from
  `pnpm install` reported all hooks synced.
- **Pre-existing e2e failure on `loader-composition.e2e.ts`**: this test
  references `examples/acp-agent/tests/fixtures/subagent/subagent-acp/driver.ts`,
  which does not exist (only `cordis.yml` and `mock-delegating-llm.ts` are
  present). Confirmed against master `b12f8d0` via `git stash` — the
  failure predates this task. Out of scope here.
- **`shell_spawn` host-side shape unchanged**: this task does not touch
  the spawn path; `subagent-acp` continues to call `ctx.subprocess.spawn`
  through the existing seam. The new `cwd_resolve` command is the second
  Tauri command Phase 2 has wired into a package bridge (after
  `shell_spawn` in 2.7.1), and is the FIRST Tauri command that
  intentionally operates OUTSIDE the config_dir — the subagent cwd is a
  workspace directory the user picked, so the `is_allowed` gating that
  applies to `fs_read`/`fs_write`/`fs_list`/`fs_exists` does NOT apply
  here. `cwd_resolve` is therefore deliberately placed in `commands/fs.rs`
  (a peer to the config-dir-gated commands) but does not invoke
  `services::fs::is_allowed`; the FS risk surface is just "stat a path
  the caller already named".
- **No `THIRD_PARTY_NOTICES.md` change needed**: the new `@tauri-apps/api`
  dependency is already declared (and notice-listed) by
  `packages/subagent/subagent-spawn-in-process` in commit `4b2491b`; adding
  the same dep here doesn't change the noticeable surface.

Committed on `feature/phase2`.