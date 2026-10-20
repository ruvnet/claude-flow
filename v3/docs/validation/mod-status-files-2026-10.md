# Who writes and reads the mod status files, and `swarm-activity.json` (2026-10-05)

Resolves item 15 of `mod-capability-review-2026-10.md`. Investigation only: no code or plugin changed.
Every claim is tagged **verified** (a command I ran in this worktree, at `origin/main` 6c7b6e889) or **inferred**.

## Summary

- **The 40 per-plugin `status.json` files are not unread.** The review's "38 files that nothing reads" is wrong: the console scans `.claude-flow` for every `*-mod` folder and reads each `status.json`, so each file has a reader (**verified**, below). What is true is that the reader keeps only 7 fields, so most per-plugin counters are written and never shown.
- **`swarm-activity.json` has many writers and readers, but its consumers that reach a person are weak.** The CLI reads back what the CLI wrote (agent count). The statusline Claude Code actually runs does not read it. The console parses it and nothing uses the result.
- Count: 40 files = the 39 ADR-446 mods + `agentdb-mod` (ADR-445). `ruflo-console`, `ruflo-core`, `ruflo-cost-tracker`, `ruflo-mods`, `ruflo-ruos`, `ruflo-swarm` have no `status.ts` and write none (**verified**: `for d in plugins/*/hooks; do [ -f $d/status.ts ] || echo $d; done`; the `grep` for `mod/status.json` also found no writer in those six).

## 1. The reader (all 40 files)

`plugins/ruflo-console/hooks/data/mods.ts:77-99` `readMods`: lists `.claude-flow` (`:79`), keeps folders matching `/^[a-z0-9][a-z0-9-]{0,40}-mod$/` (`:11`, `:83`), reads `<dir>/status.json` (`:85`, max 8192 bytes, max 60 folders), and keeps a file only if `version === 1` (`:54`). It is wired in `data/snapshot.ts:137` and rendered by `views/mods.ts:36-69` (the Mods section). **verified**: `cat -n plugins/ruflo-console/hooks/data/mods.ts`; `grep -n mods plugins/ruflo-console/hooks/data/snapshot.ts`.

Fields the console keeps (`mods.ts:56-67`): `guard`, `calls`, `blocked`, `updatedMs`, `startedMs`, `modVersion`, `summary`, `lastDenied`. Everything else a mod writes (`seen`, `checked`, `lastReason`, `lastBlocked`, `recent`, `total`, per-plugin counters) is ignored (`mods.ts:18` says so). **verified**.

Other readers of these files: `agentdb-mod/status.json` is also read by its own parser (`data/files.ts:39`, `data/agentdb-mod.ts`, `snapshot.ts:136`, `views/agentdb-mod.ts:14`) and by `scripts/live-agentdb-recall.sh:166`; `scripts/mod-capability-matrix.mjs:25-26` reads the *source text* for `STATUS_PATH`, not the files. No reader in `v3/` (**verified**: `grep -rIn "mod/status\|STATUS_PATH" v3 scripts .claude/helpers --include=*.ts --include=*.mjs --include=*.js --include=*.cjs --include=*.sh -l` returned only those two scripts).

## 2. Per-mod table

Writer = where `STATUS_PATH` is defined, then the `$.fs.write` call in the plugin's `register.ts`. Reader = `plugins/ruflo-console/hooks/data/mods.ts` line. Verdict **live** = a writer runs when the mod is loaded and `$.session.root()` resolves, and a reader exists. "calls" = the file carries a numeric `calls` the console can show; otherwise the Mods row shows "calls not reported" (`views/mods.ts:21`, `:56`).

| File | Writer (path:line) | Reader | Verdict | numeric `calls` |
|---|---|---|---|---|
| `.claude-flow/adr-mod/status.json` | `plugins/ruflo-adr/hooks/status.ts:6` → `plugins/ruflo-adr/hooks/register.ts:17` | mods.ts:85 | live | yes |
| `.claude-flow/agent-mod/status.json` | `plugins/ruflo-agent/hooks/status.ts:6` → `plugins/ruflo-agent/hooks/register.ts:17` | mods.ts:85 | live | yes |
| `.claude-flow/agentdb-mod/status.json` | `plugins/ruflo-agentdb/hooks/status.ts:23` → `plugins/ruflo-agentdb/hooks/register.ts:39` | mods.ts:85 + data/agentdb-mod.ts (own parser, snapshot.ts:136) | live | no |
| `.claude-flow/agntcy-mod/status.json` | `plugins/ruflo-agntcy/hooks/status.ts:6` → `plugins/ruflo-agntcy/hooks/register.ts:16` | mods.ts:85 | live | yes |
| `.claude-flow/aidefence-mod/status.json` | `plugins/ruflo-aidefence/hooks/status.ts:6` → `plugins/ruflo-aidefence/hooks/register.ts:17` | mods.ts:85 | live | yes |
| `.claude-flow/ai-team-mod/status.json` | `plugins/ruflo-ai-team/hooks/status.ts:6` → `plugins/ruflo-ai-team/hooks/register.ts:17` | mods.ts:85 | live | yes |
| `.claude-flow/arena-mod/status.json` | `plugins/ruflo-arena/hooks/status.ts:6` → `plugins/ruflo-arena/hooks/register.ts:16` | mods.ts:85 | live | yes |
| `.claude-flow/autopilot-mod/status.json` | `plugins/ruflo-autopilot/hooks/status.ts:6` → `plugins/ruflo-autopilot/hooks/register.ts:17` | mods.ts:85 | live | yes |
| `.claude-flow/bbs-mod/status.json` | `plugins/ruflo-bbs-federation/hooks/status.ts:14` → `plugins/ruflo-bbs-federation/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/browser-mod/status.json` | `plugins/ruflo-browser/hooks/status.ts:14` → `plugins/ruflo-browser/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/pods-mod/status.json` | `plugins/ruflo-business-pods/hooks/status.ts:14` → `plugins/ruflo-business-pods/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/chatgpt-mod/status.json` | `plugins/ruflo-chatgpt-federation/hooks/status.ts:14` → `plugins/ruflo-chatgpt-federation/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/daa-mod/status.json` | `plugins/ruflo-daa/hooks/status.ts:6` → `plugins/ruflo-daa/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/ddd-mod/status.json` | `plugins/ruflo-ddd/hooks/status.ts:6` → `plugins/ruflo-ddd/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/deepseek-mod/status.json` | `plugins/ruflo-deepseek-harness/hooks/status.ts:6` → `plugins/ruflo-deepseek-harness/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/docs-mod/status.json` | `plugins/ruflo-docs/hooks/status.ts:6` → `plugins/ruflo-docs/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/federation-mod/status.json` | `plugins/ruflo-federation/hooks/status.ts:6` → `plugins/ruflo-federation/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/goals-mod/status.json` | `plugins/ruflo-goals/hooks/status.ts:11` → `plugins/ruflo-goals/hooks/register.ts:19` | mods.ts:85 | live | no |
| `.claude-flow/graph-mod/status.json` | `plugins/ruflo-graph-intelligence/hooks/status.ts:11` → `plugins/ruflo-graph-intelligence/hooks/register.ts:19` | mods.ts:85 | live | no |
| `.claude-flow/intelligence-mod/status.json` | `plugins/ruflo-intelligence/hooks/status.ts:11` → `plugins/ruflo-intelligence/hooks/register.ts:19` | mods.ts:85 | live | no |
| `.claude-flow/iot-mod/status.json` | `plugins/ruflo-iot-cognitum/hooks/status.ts:11` → `plugins/ruflo-iot-cognitum/hooks/register.ts:19` | mods.ts:85 | live | no |
| `.claude-flow/jujutsu-mod/status.json` | `plugins/ruflo-jujutsu/hooks/register.ts:8` → `plugins/ruflo-jujutsu/hooks/register.ts:34` | mods.ts:85 | live | no |
| `.claude-flow/kg-mod/status.json` | `plugins/ruflo-knowledge-graph/hooks/register.ts:8` → `plugins/ruflo-knowledge-graph/hooks/register.ts:34` | mods.ts:85 | live | no |
| `.claude-flow/loop-mod/status.json` | `plugins/ruflo-loop-workers/hooks/register.ts:8` → `plugins/ruflo-loop-workers/hooks/register.ts:34` | mods.ts:85 | live | no |
| `.claude-flow/market-mod/status.json` | `plugins/ruflo-market-data/hooks/register.ts:8` → `plugins/ruflo-market-data/hooks/register.ts:34` | mods.ts:85 | live | no |
| `.claude-flow/metaharness-mod/status.json` | `plugins/ruflo-metaharness/hooks/register.ts:8` → `plugins/ruflo-metaharness/hooks/register.ts:34` | mods.ts:85 | live | no |
| `.claude-flow/migrations-mod/status.json` | `plugins/ruflo-migrations/hooks/status.ts:11` → `plugins/ruflo-migrations/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/music-mod/status.json` | `plugins/ruflo-music/hooks/status.ts:13` → `plugins/ruflo-music/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/trader-mod/status.json` | `plugins/ruflo-neural-trader/hooks/status.ts:13` → `plugins/ruflo-neural-trader/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/observe-mod/status.json` | `plugins/ruflo-observability/hooks/status.ts:11` → `plugins/ruflo-observability/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/creator-mod/status.json` | `plugins/ruflo-plugin-creator/hooks/status.ts:6` → `plugins/ruflo-plugin-creator/hooks/register.ts:14` | mods.ts:85 | live | no |
| `.claude-flow/rag-mod/status.json` | `plugins/ruflo-rag-memory/hooks/status.ts:8` → `plugins/ruflo-rag-memory/hooks/register.ts:21` | mods.ts:85 | live | no |
| `.claude-flow/ruvector-mod/status.json` | `plugins/ruflo-ruvector/hooks/status.ts:8` → `plugins/ruflo-ruvector/hooks/register.ts:21` | mods.ts:85 | live | no |
| `.claude-flow/ruvllm-mod/status.json` | `plugins/ruflo-ruvllm/hooks/status.ts:8` → `plugins/ruflo-ruvllm/hooks/register.ts:21` | mods.ts:85 | live | no |
| `.claude-flow/rvf-mod/status.json` | `plugins/ruflo-rvf/hooks/status.ts:8` → `plugins/ruflo-rvf/hooks/register.ts:21` | mods.ts:85 | live | no |
| `.claude-flow/secaudit-mod/status.json` | `plugins/ruflo-security-audit/hooks/status.ts:6` → `plugins/ruflo-security-audit/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/sparc-mod/status.json` | `plugins/ruflo-sparc/hooks/status.ts:6` → `plugins/ruflo-sparc/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/testgen-mod/status.json` | `plugins/ruflo-testgen/hooks/status.ts:6` → `plugins/ruflo-testgen/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/wf-mod/status.json` | `plugins/ruflo-workflows/hooks/status.ts:6` → `plugins/ruflo-workflows/hooks/register.ts:16` | mods.ts:85 | live | no |
| `.claude-flow/xgw-mod/status.json` | `plugins/ruflo-x-gateway/hooks/status.ts:6` → `plugins/ruflo-x-gateway/hooks/register.ts:16` | mods.ts:85 | live | no |

All 40 rows: **verified** by `grep -rhn "STATUS_PATH = " plugins/*/hooks/status.ts plugins/*/hooks/register.ts` (40 lines) and `grep -n "fs.write" plugins/<p>/hooks/register.ts`. That a writer *runs* is **inferred** from the code (it is skipped when `s.root` is undefined, errors are swallowed, and the plugin must be installed with the mods rollout on); I did not start 40 sessions.

### What the files carry versus what the console shows (verified by reading each `status.ts` / `register.ts`)

- **Numeric `calls`**: only 7 (adr, agent, agntcy, aidefence, ai-team, arena, autopilot) = 7 of 40. The other 33 show "calls not reported". Those 33 write `seen`/`checked` (security-audit, sparc, testgen, workflows, x-gateway, rag, ruvector, ruvllm, rvf), `attached/skipped/...` (agentdb), a bare `blocked` (daa, ddd, deepseek, docs, federation), or a `calls` **object** (the five `register.ts`-only mods jujutsu, kg, loop, market, metaharness: `register.ts:32` writes `calls: s.calls` as a Record and `total`; the console's `whole()` (`mods.ts:28`) turns an object into null). So the console cannot show their totals even though the file has them.
- **`guard`**: absent in plugin-creator (`status.ts:9`), so the row shows no guard state.
- **`lastDenied`, `modVersion`, `summary`**: written only by goals, graph-intelligence, intelligence, iot-cognitum (**verified**: `grep -ln "lastDenied" */hooks/status.ts */hooks/register.ts`). The other 36 write at most `lastReason`/`lastBlocked` (some write neither), which the console never reads, so "last refusal" is "class not reported" for them whenever `blocked > 0` (`views/mods.ts:23`).
- **Staleness**: nothing in the repo deletes a status file; the console marks one stale after 6 h (`mods.ts:8`, `:75`). Cleanup writers/removers: **inferred** (no `rm`/`unlink` of `-mod/status.json` found by `grep -rn "unlink\|rm(" plugins/*/hooks/*.ts` filtering for `status`; not exhaustively searched).

## 3. `.claude-flow/metrics/swarm-activity.json`

Shape: `{ timestamp, processes{agentic_flow,mcp_server,estimated_agents}, swarm{active,agent_count,coordination_active}, integration, source }`.

### Writers (verified: `grep -rIn "swarm-activity" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist`)

| Writer | path:line | When | Notes |
|---|---|---|---|
| `agent spawn` / `agent terminate` | `v3/@claude-flow/cli/src/commands/agent.ts:22-44`, called at `:190` and `:464` | each spawn/stop | read-modify-write of `swarm.agent_count`; the only writer that reflects real agents |
| `init` | `v3/@claude-flow/cli/src/init/executor.ts:679`, `:1714` | once, if missing (`:1714` also on `--force`) | zeros: `_initialized: true` |
| metrics-db daemon | `.claude/helpers/metrics-db.mjs:443` (copies: `v3/@claude-flow/cli/.claude/helpers/metrics-db.mjs:443`, `v3/@claude-flow/mcp/.claude/helpers/metrics-db.mjs:441`) | each daemon `sync`/`export` | counts `ps` processes, `source: 'metrics.db'`; overwrites the agent.ts count |
| swarm-monitor.sh | `.claude/helpers/swarm-monitor.sh:88-90` (same file in cli and mcp helpers) | every monitor interval | heredoc rewrite from `ps` counts; **inferred** that it overwrites the whole file (saw the `cat >` opening, not the whole heredoc) |
| Windows monitor | `v3/@claude-flow/cli/src/init/helpers-generator.ts:1277` | every 5 s | writes `agent_count: 0` always |

No plugin writes it: `ruflo-swarm`, `ruflo-console`, and the mods contain no write (**verified**: grep above lists only the console's reader files under `plugins/`).

### Readers

| Reader | path:line | Reaches a person? |
|---|---|---|
| `agent`/`swarm status` | `v3/@claude-flow/cli/src/commands/swarm.ts:135-148` (#2799: reconcile Total when `.swarm/agents` is empty); test `cli/__tests__/hooks-metrics-swarm-backup-2797-2798-2799.test.ts:85`, `swarm-status-progress-3572.test.ts:47` | yes, `swarm status` output |
| `agent.ts` status | `v3/@claude-flow/cli/src/commands/agent.ts:534-541` | **dead branch**: reads `activity.totalAgents` / `activeAgents`; no writer sets those fields (**verified**: `grep -rn "totalAgents" cli/src cli/.claude/helpers | grep -i activity` found only this reader) |
| `StatuslineGenerator` | `v3/@claude-flow/hooks/src/statusline/index.ts:489-499`, exposed by MCP tool `hooks/statusline` (`hooks/src/mcp/index.ts:409-424`) | only through that tool; the statusline Claude Code runs is `.claude/helpers/statusline.cjs` (`.claude/settings.json:269`), which has **no** reference to the file (**verified**: `grep -n "swarm-activity" .claude/helpers/statusline.cjs` empty) |
| `.claude/statusline.sh` | `.claude/statusline.sh:125-135` | not configured in `.claude/settings.json` (**verified**: the setting points at `statusline.cjs`); **inferred** legacy |
| swarm worker | `v3/@claude-flow/hooks/src/workers/index.ts:1135-1145`, registered at `:2061` | result goes to the worker output; **inferred** low visibility |
| daemon-manager.sh status | `.claude/helpers/daemon-manager.sh:196-198` (copies in cli, mcp) | shell status only |
| swarm-monitor.sh show | `.claude/helpers/swarm-monitor.sh:183-185` | shell only |
| console | `plugins/ruflo-console/hooks/data/files.ts:28`, parsed by `facts.ts:235` into `snapshot.activity` (`snapshot.ts:116`) | **no**: nothing reads `snapshot.activity` (**verified**: `grep -rn "activity" plugins/ruflo-console/hooks --include=*.ts` excluding tests, `state.activity`, `activityCount`, `activityPicture` shows no consumer of `agentCount`/`isActive`) |

### Verdict: **live but half-wired** (two writers fight, one useful loop)

1. **Live loop**: `agent spawn/terminate` → `swarm status` (writer `agent.ts:22`, reader `swarm.ts:135`, tested). Keep.
2. **Conflicting writers**: the metrics-db daemon and swarm-monitor overwrite the file with `ps`-estimated counts, so the `agent spawn` count can be replaced by a process-grep estimate (**inferred** from the writers' shapes; I did not run both).
3. **Write-only toward the statusline**: the statusline in use does not read it; the one TS reader is reachable only via an MCP tool.
4. **Read-only in the console**: parsed, never shown.

## 4. Ranked recommendations

| # | Recommendation | Risk | Effort |
|---|---|---|---|
| 1 | **Extend the console reader, not remove writers.** Map `lastReason`/`lastBlocked` to `lastDenied`, `seen`/`checked`/summed `calls` object to `calls` in `parseModStatus` (`mods.ts:51`). Zero change to 40 plugins; the Mods section then shows calls for 40 of 40 instead of 7. | Low: reader is bounded and shape-checked; needs console tests; do not touch plugin hooks | S |
| 2 | **Wire `snapshot.activity` into the Overview/Swarm section** (agent count + age), or delete `parseActivity` and the `activity` file entry. Pick one; today it is dead parse work on every snapshot. | Low (console only) | S |
| 3 | **Give plugin authors one status contract**: `calls: number` + `lastDenied: string` required in the `create-mod` template (`plugins/ruflo-plugin-creator/skills/create-mod`) so new mods stop drifting (33 of 40 already drifted). Add a check in `scripts/mod-capability-matrix.mjs`. | Low | M |
| 4 | **Stop the writer fight on `swarm-activity.json`**: make the metrics-db daemon and swarm-monitor merge (keep `swarm.agent_count` from `agent.ts` when newer) or write a different file. | Medium: helpers are copied into 3 trees and auto-refreshed (`helper-refresh.ts`; CLAUDE.md warns of concurrent-session overwrite); needs a signed-manifest regen | M |
| 5 | **Remove the dead `totalAgents`/`activeAgents` branch** at `agent.ts:534-541`. | Low | XS |
| 6 | **Remove the 40 writers.** Not recommended: the files are the only per-mod telemetry channel (ADR-446) and the reader exists. Removing them deletes the Mods section's data; the fix for "unread fields" is recommendation 1. | High (breaks ADR-446's stated contract, 40 plugin tests, `live-agentdb-recall.sh`) | L |
| 7 | **Leave `swarm-activity.json` writers as is** and document the file as "CLI-internal agent count, not a statusline feed". | None | XS |

Suggested order: 1, 5, 2, then 3. Do 4 only if the statusline is meant to show agent counts.

## What I did not do

- Did not run a live session per mod to confirm each file is actually produced (writer execution is inferred from code). The console's own tests (`plugins/ruflo-console/tests/mods-section.spec.ts`) were not run.
- Did not check the ADR for a deletion rule on stale status files.
- Did not run the metrics-db daemon and `agent spawn` together to observe the overwrite in recommendation 4.
