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
| 2.7.2 | subagent-acp → Tauri cwd bridge | DONE | (this commit) | Pending |

**S7 in progress (2/6 tasks).** `subagent-acp` removed its `node:fs`/`node:path` cwd validation and now routes through a new `bridge.cwdApi.resolve` → Tauri `cwd_resolve` command. The host owns the filesystem; the renderer only does sync string-shape checks.
