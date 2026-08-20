# DSH Phase 2 (Ecosystem) — Subagent Progress Ledger

Branch: feature/phase2 (from master bfd6393)
Plan: docs/superpowers/plans/2026-08-19-dsh-client-architecture-refactor.md
Spec: docs/superpowers/specs/2026-08-19-dsh-client-architecture-refactor-design.md

| Task | Subject | Status | Commits | Review |
|---|---|---|---|---|
| 2.5.1 | Inventory audit | DONE | 61ea957 | Approved |
| 2.5.2 | Delete host-side plugin-inventory | DONE | 2762ed5 | Pending |
| 2.5.2 | Delete plugin-inventory | DONE | 796ebc5 | Approved |
| 2.5.3 | Delete skill-inventory | DONE | 587acf4 | Approved |
| 2.5.4 | Delete mcp-inventory | DONE | 48a3850 | Approved |
| 2.5.5 | Delete agent-inventory | DONE | 91b08d5 | Approved |
| 2.5.6 | Inventory plugin hook | DONE | 7ec2905 | Approved |
| 2.5.7 | Inventory skill/mcp/agent hooks | DONE | e4bad64 (3 commits) | Approved |
| 2.5.8 | Inventory UI route + AppToggleGroup | DONE | 9f5e2ea | Approved |

**S5 COMPLETE (8/8 tasks).** All 4 host-side inventory packages deleted; client-side hooks + UI tab wired.
| 2.6.1 | In-box plugin audit | DONE | a7a7f4d | Approved |
| 2.6.2 | Wire in-box plugins (118 cordis) | DONE | bedff0b | Approved |
| 2.6.3 | UI nav routes (Chat/Settings/About) | DONE | 6e99d19 | Approved |
| 2.6.4 | Settings panel + theme | DONE | (this commit) | Pending |
| 2.6.4 | Settings + theme | DONE | a8efadb | Approved |
| 2.6.5 | Delete dead code | DONE | 9272ee7 + ebe435b (fix) | Approved |
| 2.6.6 | Playwright smoke (catches SyntaxError follow-up) | DONE | 6a0d88d | Approved |
| 2.6.7 | CI Phase 2 gate | DONE | b12f8d0 | Approved |

**S6 COMPLETE (7/7 tasks).** All in-box plugins loaded into WebView2; dead code removed; Playwright smoke in CI.
| 2.7.1 | subagent-spawn-in-process → Tauri shell | DONE | 4b2491b | Pending |

**S7 in progress (1/6 tasks).** First subagent backend rewired through Tauri's `shell_spawn` (Phase 1 Task 1.7) via a new `SubagentSpawnInProcess` service + bridge module.
| 2.7.1 | subagent-spawn → Tauri shell | DONE | 38c61e7 | Approved |
| 2.7.2 | subagent-acp → Tauri cwd bridge | DONE | ef5e943 | Pending |

**S7 in progress (2/6 tasks).** `subagent-acp` removed its `node:fs`/`node:path` cwd validation and now routes through a new `bridge.cwdApi.resolve` → Tauri `cwd_resolve` command. The host owns the filesystem; the renderer only does sync string-shape checks.
| 2.7.2 | subagent-acp → Tauri shell | DONE | b662fc7 | Approved |
| 2.7.3 | subagent-codex → Tauri shell | DONE | (this commit) | Pending |

**S7 in progress (3/6 tasks).** `subagent-codex` removed its `node:crypto.randomUUID` / `process.platform` / `node:stream` (type) imports. Platform detection moved to a new `bridge.ts` module that reads `navigator.userAgent` (WebView2-safe); `codexAppServerArgv` and `CodexRunSpec` now take the host platform as an explicit input. Subprocess pipe communication with the `codex app-server` child still flows through the shared `@deepseek-ai/dsh-subprocess` seam — `shell_spawn` (Phase 1 Task 1.7) is not extended in this slice (see Concerns).
| 2.7.3 | subagent-codex → Tauri shell | DONE | 7a8fa8a | Approved |
| 2.7.4 | subagent-claude-code → Tauri shell | DONE | 42f9aa8 | Pending |

**S7 in progress (4/6 tasks).** `subagent-claude-code` removed its `node:crypto.randomUUID` / `node:events.EventEmitter` / `node:path.extname` / `process.platform` imports. Platform detection moved to a new `bridge.ts` module that reads `navigator.userAgent` (WebView2-safe); `claudeSpawnSpec` and `ClaudeCodeRunSpec` now take the host platform as an explicit input. `ManagedClaudeCodeProcess` now uses a small in-file `LifecycleEmitter` instead of `node:events`. The package still talks to the real Claude Code CLI through the shared `@deepseek-ai/dsh-subprocess` seam — `shell_spawn` (Phase 1 Task 1.7) is not extended in this slice (see Concerns).
| 2.7.4 | subagent-claude-code → Tauri shell | DONE | bb020ad | Approved |
| 2.7.5 | Subagent integration tests | DONE | 4aa945c | Approved |
| 2.7.6 | Subagent UI panel | DONE | d55e943 | Approved |

**S7 COMPLETE (6/6 tasks).** All subagent drivers browser-safe via Tauri shell.

## PHASE 2 COMPLETE — 21/21 tasks ✅
