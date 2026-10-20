# Changelog: ruflo-core

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.2.11 — 2026-10-14
- perf: the MCP launcher runs the resolved local CLI inside its own process instead of spawning a second node (one process, about half the memory, a faster first answer: measured here with a stub CLI as 2 processes to 1, 89 MB to 46 MB, 30 ms to 19 ms spawn-to-initialize); `RUFLO_MCP_SPAWN=1` restores the child process, and the npx fallback still spawns (#3989, thanks @socrates6969). The real-CLI startup numbers in the PR (149 MB to 81 MB, 1.3 s to 0.7 s) were not re-measured.

## 0.2.10 — 2026-10-14
- fix: the MCP launcher starts the server in the session project (`CLAUDE_PROJECT_DIR`, then `CLAUDE_FLOW_CWD`, then its own working directory; a drive root, the home folder or a missing folder is not a project) and looks for the local CLI from there, so on Windows the CLI and the MCP server keep one `.claude-flow` state, not two (#3987, thanks @socrates6969). It warns on stderr when there is no project. Tested with Windows-style environments only; no Windows machine was available.

## 0.2.9 — 2026-10-14
- fix: failed Bash commands and failed edits are recorded as failures: PostToolUseFailure is registered and forwarded to post-command / post-edit with `-s false` and the real exit code, so the learning layer no longer sees a 100% success rate (#4127, thanks @rudycelekli for #4170)
- fix: the hook shim starts the CLI from CLAUDE_PROJECT_DIR, so a session that `cd`ed into a subdirectory no longer gets .claude-flow/ and proven-config files written there (#4176)
- perf: telemetry hooks no longer block the tool: the CLI is started detached and the shim returns in about 25 ms instead of 0.2 to 4 s per call; at most 4 run at once per project (RUFLO_HOOK_MAX_PARALLEL), Stop is never dropped, RUFLO_HOOK_SYNC=1 restores the synchronous path (#4128)

## 0.2.8 — 2026-10-11
- fix: the PostToolUse Bash shim stands down when command recording is switched off (`CLAUDE_FLOW_HOOKS_RECORD_COMMANDS=0` or `CLAUDE_FLOW_HOOKS_ENABLED=false`), so no CLI process is started per Bash call (#4056)

## 0.2.7 — 2026-10-11
- fix: researcher agent calls agentdb_semantic-route, pattern-search, context-synthesize, hierarchical-store/recall and causal-edge with their real parameter names (input, topK, maxEntries, key/value/tier, sourceId/targetId/relation); it now follows edges with agentdb_graph-query and agentdb_graph-pathfinder (causal-edge only records)
- fix: drop the invalid `--train-neural` flag from `hooks post-task` in the coder and researcher agents
- fix: README no longer states stale tool and command counts; smoke expectation corrected to 11

## 0.2.6 — 2026-07-29
- feat: hand route/post-edit to the ruflo mod via RUFLO_MODS_OWNS (ADR-404)
- fix: repair CI regressions surfaced by the integrated community fixes
- fix: resolve installed CLI before npx fallback
- fix: fail marker-preserving hash drift in strict mode
- fix: quote-aware split for RUFLO_HOOK_CLI_OVERRIDE
- fix: apply the Windows argv fix from #3322 to the other three shim copies
- fix: make WITNESS_ED25519_ROOT actually resolve @noble/ed25519 (#3200)
- fix: verified event identity must win over publisher-controlled content
- chore: and 2 more changes (git log -- plugins/ruflo-core)

## 0.2.5 — 2026-07-29
- fix: resolve current runtime and verification defects for v3.32.36
- fix: make ruflo-core/ruflo-cost-tracker hooks Windows-native
- chore: bump to 3.32.27
- chore: align namespace and stable hook shims

## 0.2.4 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration

## 0.2.3 — 2026-07-16
- feat: rename ruflo-wasm → ruflo-agent + Claude Managed Agents (cloud) runtime — ADR-115 (proposed→accepted, implemented)
- feat: ADR-095 G2 — pluggable ConsensusTransport + Ed25519 message signing (step 1)
- fix: ship stable Windows-safe Ruflo integration
- fix: unblock ADR-104 and witness source checks
- fix: unblock main — TS shim types + dispatcher import + witness re-sign
- fix: commit .mcp.json + exempt plugin-shipped templates from gitignore
- fix: unblock CI build, witness verify, and trajectory smoke (#2311 #2274 #2312 #2275)
- fix: reconcile stale smoke contract assertions across 23 plugins
- chore: and 11 more changes (git log -- plugins/ruflo-core)

## 0.2.2 — 2026-05-11
- feat: ADR-112 — 285/285 tool descriptions have 'Use when …' guidance + CI guard + #1892 statusline
- feat: performance verification + capability historical reference
- feat: per-OS verification cognitive containers + tutorial README
- feat: ADR-103 witness temporal history + plugin-distributed toolkit
- fix: ruflo-core hooks call `npx ruflo@alpha` not `npx claude-flow@alpha`
- fix: #1883 + #1884 — WSL path resolution + import-key sanitization + CI guard
- fix: bin/cli.js MCP-stdio auto-detect overrode explicit -t http
- fix: fix #1874 + add MCP protocol-compliance smoke layer
- chore: and 2 more changes (git log -- plugins/ruflo-core)

## 0.2.1 — 2026-05-08
- fix: #1859 #1862 ruflo-core hooks + CLI flag priority
- fix: hooks per-plugin layout — ruflo-core install now loads hooks (#1748 Issue 1)
- fix: coder agents now read docs/adr/*.md alongside docs/SPEC.md (#1749)
- chore: 0.2.0 → 0.2.1 (publish #1859 #1862 fix)

## 0.2.0 — 2026-05-04
- feat: v0.2.0 — adopt foundation plugin contract (ADR-0001, MCP server contract, sibling ADR cross-references)
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
- fix: rename plugin commands to avoid built-in conflicts; bump default Opus to 4.7

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
