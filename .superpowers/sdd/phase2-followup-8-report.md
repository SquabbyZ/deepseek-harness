# Phase 2 follow-up #8: strip "needs-port" plugins from `apps/web/src/dsh/inbox/index.ts`

## Status

DONE — **no imports needed to be stripped**. The current barrel already
holds only the 116 cordis-shaped browser-safe packages from the audit
(118 − 2 deleted in task 2.6.5 = 116). All 88 "needs-port" packages per
`docs/migrations/plugin-migration-audit.md` are **not present** in the
current barrel. `pnpm vite build` succeeds on the unmodified barrel.

The brief's premise — that the barrel contained 88 needs-port imports —
is incorrect for the current branch state. Phase 2 task 2.6.2 wired the
in-box barrel using the audit's *browser-safe* list (138 packages)
filtered down to *cordis-shaped* ones (118 packages), not the full
229-package audit universe. Task 2.6.5 then removed `dsh-cordis-host-
runner` and `dsh-tool-cordis` (both in the audit's *Delete* bucket),
taking the count from 118 to 116. The 88 *needs-port* packages have
never been in this barrel. The `vite-plugin-node-polyfills` install in
phase2-followup-7 closed the remaining subpath-resolution gaps and
the production build is green.

Branch: `feature/phase2` confirmed before commit.

## Commit

No source commit required — the inbox barrel is unchanged from
commit `9272ee7db4` (task 2.6.5 trash-dead-code). This report is the
only artifact staged in this follow-up.

- Branch: `feature/phase2`
- Commit (this follow-up, report-only): `<populated after commit>`
- Message: `docs(sdd): phase2-followup-8 report — no inbox strip needed`

## Tests

| Step | Command | Result |
|---|---|---|
| `pnpm vite build` | `cd apps/web && pnpm vite build` | **PASS** — built in ~18 s; index chunk `index-DnQ4JmeZ.js` 5,174.38 kB / 1,358.67 kB gzip; vendor chunk 744.87 kB / 180.73 kB gzip; pre-existing chunk-size advisory only, no errors. |
| `pnpm tsc --noEmit` | `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` | **1 expected error** — `TS2878` (project-reference rewrite mismatch) carried over from task 2.6.2 and accepted as the lesser failure mode for the workspace-include tsconfig. |

Build output reproduced identically to the previous follow-up-7
output (same `DnQ4JmeZ` hash), proving the barrel is functionally
equivalent to the state that follow-up-7 verified.

## Files

None modified. This follow-up is verification-only.

- `apps/web/src/dsh/inbox/index.ts` — unchanged from commit
  `9272ee7db4`; 116 explicit imports, all browser-safe per audit;
  `inboxPluginsCount = 116`.
- `docs/migrations/plugin-migration-audit.md` — unchanged; the
  138 / 88 / 3 counts and the per-package categorization still hold.

This report:

- `.superpowers/sdd/phase2-followup-8-report.md` (new file, this
  document).

## What I verified, in order

1. **Branch and barrel state.** `git branch --show-current` →
   `feature/phase2`. `git status --short` shows only the pre-existing
   unrelated `desktop/src-tauri/tauri.conf.json` dirty that every
   follow-up since #7 has reported untouched.

2. **Inbox barrel contents.** Read `apps/web/src/dsh/inbox/index.ts`.
   116 `import * as dsh_X` statements, lines 14–129, each from the
   bare workspace package name (or `/client` for dual-half packages).
   No `from '@deepseek-ai/dsh-X/lib/types/...'` paths (the brief
   referenced that pattern from an older barrel draft; the committed
   barrel uses bare specifiers throughout, per task 2.6.2's
   `workspaceResolver` design).

3. **Audit classification of every barrel import.** Cross-checked
   each of the 116 names against the 138-package browser-safe list
   in `docs/migrations/plugin-migration-audit.md`. All 116 appear
   in that list. None of the 88 *needs-port* packages are in the
   barrel (verified by spot-checking the first ~10 names in the
   audit's "Needs port" section — `dsh-subagent`, `dsh-credentials-
   local`, `dsh-sandbox-policy`, `dsh-storage-json`, `dsh-storage-
   sqlite`, `dsh-session-query-sqlite`, `dsh-session-persistence-
   jsonl`, `dsh-session-persistence-sqlite`, `dsh-session`,
   `dsh-attachment-local`, etc. — none appear in the barrel).

4. **Build green.** `pnpm vite build` succeeds with no errors. The
   `vite-plugin-node-polyfills` + the targeted `node:fs` /
   `node:util/types` externals added in follow-up-7 satisfy every
   transitive Node import the in-box closure pulls in, including the
   `bash-local`, `commands`, `jobs-local`, `timeout-policy` packages
   the brief flagged as "the most likely candidates for Node-only
   top-level imports". Their `@Remote` decorator and `using` block
   are downleveled by the `esbuild.target: 'es2024'` setting in
   `apps/web/vite.config.ts` (added in task 2.6.6 / follow-up-7);
   their `node:fs` / `node:stream` etc. calls are externalized via
   the `external: [/^node:fs(\/.*)?$/, /^node:util\/types$/, …]`
   block so Rollup leaves the literal imports in the bundle and the
   browser fails loud at first invocation (the design choice called
   out in follow-up-7's "Concerns" #2). Build posture: correct.

5. **tsc posture unchanged.** Same `TS2878` (project-reference
   rewrite) the 2.6.2 report documented. No new errors introduced.

## Concerns

1. **The brief's premise about the barrel state was inaccurate.**
   It asserted 88 of the 116 imports are needs-port; in fact zero
   of the 116 are. Anyone reading the brief in isolation would
   conclude the barrel was grossly misconfigured; the git history
   shows the opposite — the barrel has been strictly within the
   audit's *browser-safe* set since 2.6.2, with the only churn
   being two *Delete*-bucket removals in 2.6.5. This follow-up
   exists as a verification gate so future readers can see
   "checked, the barrel is correct as of <date>" rather than
   having to re-do the diff against `bedff0b6c3` themselves.

2. **The "polyfill library's own subpath resolution is broken"
   wording in the brief is also inaccurate for the current
   branch.** Follow-up-7 (commit `d8e8cc5805`) replaced the manual
   shim with `vite-plugin-node-polyfills@0.28.0` and added
   targeted externals + a `util-types-stub.ts` to close the
   `node:util/types` subpath gap. The build was green before
   this follow-up started; it is still green after.

3. **Bundle size still carries the polyfill overhead.** Same
   `+1.1 MB raw / +250 kB gzipped` index-chunk delta from
   follow-up-7. The 116 imports trigger the same transitive
   `node:*` graph as before; nothing changed at the closure
   level. If the team wants to claw those bytes back, the lever
   is splitting `crypto-browserify` / `stream-http` / `url` into
   a manual chunk — out of scope for this follow-up.

4. **The "Wrong branch = BLOCKED" guard was honored.** Branch
   `feature/phase2` was confirmed before any tooling ran and
   again before the commit; no branch switch occurred.

## Branch confirmation

`git branch --show-current` → `feature/phase2` (verified twice
in this session: once before any read, once before the commit).
The 2.6.2 / 2.6.5 / follow-up-7 history all sits on this branch.

## Return (short)

**Status:** Complete — barrel already correct; no imports stripped.
**Commit (7-char):** `<populated after commit>`
**Imports kept vs commented:** 116 / 0 (all 116 already browser-safe
per audit; zero needs-port present to strip).
**Test summary:** `pnpm vite build` PASS (identical to follow-up-7
output, same `DnQ4JmeZ` hash); `tsc --noEmit` 1 expected TS2878.
**Concerns:** (1) brief premise about barrel state was inaccurate;
(2) "polyfill library's own subpath resolution is broken" was
resolved in follow-up-7; (3) polyfill bundle-size delta still
present; (4) branch guard honored.

**Committed on `feature/phase2`.**
