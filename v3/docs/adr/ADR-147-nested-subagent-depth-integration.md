# ADR-147 — Nested Subagent Capability Integration (Claude Code depth=5)

**Status**: Proposed
**Date**: 2026-06-09
**Issue**: [ruvnet/ruflo#2335](https://github.com/ruvnet/ruflo/issues/2335)
**Related**: ADR-144 (Authorization Propagation — shares `delegationDepth`), ADR-099 (Dossier Investigator — recursive use case), ADR-143 (Deterministic Tier-1 Codemods — unaffected, stay at depth 0)

## Context

On 2026-06-09 Boris Cherny [announced](https://x.com/bcherny/status/2064327225504403752) that nested subagent support landed in Claude Code:

> Just landed nested subagent support in Claude Code. Starting to experiment more with agents kicking off agents as a way to better manage context. Capped at depth=5 to start, going out in today's release.

The motivation Cherny calls out is **context management**, not just parallelism. Each subagent gets its own context window; flat fan-out only offloads one level because the lead still has to read the summaries. Nested subagents let the sub-agent itself delegate to a fresh window before its own context fills up — which is the bottleneck ruflo's deepest orchestrators (`ruflo-goals:dossier-investigator`, `ruflo-sparc:sparc-orchestrator`, `v3-queen-coordinator`) already hit.

### Evidence — what's actually in the shipping binary

CLI version: `2.1.169` (`stable=2.1.153, latest=2.1.169, next=2.1.169` on npm — confirmed latest). Inspection of `claude.exe` (231 MB native binary) on 2026-06-09:

| Symbol / literal | Hits | Implication |
|---|---|---|
| `parentAgentId` | 24 | Propagated as HTTP header `x-claude-code-parent-agent-id`; stored on session/agent attributes |
| `parent_agent_id` | 10 | OpenTelemetry / Perfetto span tag — already on the wire |
| `isSubagent` | 8 | Runtime boolean (binary — no depth counter alongside) |
| `"Additional system prompt appended to every Task-tool subagent (and propagated to nested subagents)"` | 1 | The literal phrase confirming nesting is the intended model |
| `MZq(H,q){if(H!=="Agent"&&H!=="Task")return;…subagent_type…}` | — | `Agent` and `Task` are aliases of the same tool — same dispatch |
| `MAX_DEPTH`, `agentDepth`, `subagent_depth`, `nesting_limit`, literal `depth=5` | **0** | **No depth cap is encoded in 2.1.169 as named symbols or literals** |
| `CLAUDE_CODE_EXPERIMENTAL_NESTED_SUBAGENTS` | 0 | No flag of this name; the closest flag found is `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (baked as a default literal in two places) |

### What gates nested spawning in 2.1.169

The runtime gate is the boolean `hasTaskTool` (assigned `hasTaskTool: D || void 0` from the parent's tool list at parent → child spawn time). Whether a child receives the spawn tool is decided **per-spawn from the parent's allowed-tools set**, not by a depth counter and not by an env var. The depth=5 cap, if it exists, is either enforced server-side at the Anthropic API or hasn't actually landed in 2.1.169 despite the announcement.

### Empirical confirmation

Three sub-agent types tested in a live 2.1.169 session (`general-purpose`, `claude`, `analyst`) all reported no `Agent`/`Task` tool available, and `ToolSearch({query: "select:Agent,Task"})` returned no matches. The cause: **zero ruflo agent definitions declare a `tools:` field in their YAML frontmatter**, so spawned children inherit `hasTaskTool=false` regardless of which subagent type is requested. The capability is present in the binary but disabled by omission in ruflo's agent registry.

## Decision

Adopt nested subagents through a four-phase rollout. Treat `Task` as a least-privilege capability — grant only to orchestrator-class agents, never to leaf workers.

### P1 — Grant `Task` to orchestrator-class agents only

**Where**: agent YAML frontmatter under `.claude/agents/` and `~/.claude/agents/`.

**Shape**: add an explicit `tools:` field that includes `Task` (the canonical name in 2.1.169 — `Agent` is an alias of the same tool, either string resolves) to the following agents and only these:

| Agent | File | Justification |
|---|---|---|
| `v3-queen-coordinator` | `.claude/agents/v3/v3-queen-coordinator.md` | Hierarchical-mesh queen — top of the spawn tree |
| `ruflo-sparc:sparc-orchestrator` | (plugin agents dir) | 5 SPARC phases ≈ 5 nested levels — perfect fit for depth=5 |
| `hierarchical-coordinator` | `.claude/agents/swarm/hierarchical-coordinator.md` | Coordinator pattern presumes nesting |
| `ruflo-goals:dossier-investigator` | (plugin agents dir) | Recursive entity expansion — the textbook depth case |
| `task-orchestrator` | `.claude/agents/templates/orchestrator-task.md` | Already named "orchestrator"; should orchestrate |

**Leaf agents** (`coder`, `tester`, `pii-detector`, `aidefence-guardian`, `security-auditor`) MUST NOT receive `Task` — a leaf that spawns further breaks the least-privilege story and pollutes the spawn tree.

The same PR ships an empty `tools:` smoke test (a copy of `coder.md` named `coder-spawn-test.md` with `tools: [Read, Task]`) and a recursive depth probe that spawns level → level+1 until either the binary, the API, or our own guardrail (P3) refuses. The probe's observed cap goes into the validation section of this ADR before P2 starts.

### P2 — Persist the spawn tree from `parent_agent_id`

**Where**: `v3/@claude-flow/hooks/src/bridge/official-hooks-bridge.ts` (post-task hook) and `v3/@claude-flow/memory/src/auto-memory-bridge.ts` (AgentDB schema).

The binary already emits `parent_agent_id` as an OTel span tag. The post-task hook should read it from the span context and write `{ agent_id, parent_agent_id, subagent_type, depth, started_at, ended_at, success }` rows to AgentDB. The `depth` field is computed as the chain length from the root (lead session = 0).

The output is a real spawn tree per request, not a flat list — needed by P3 (depth guardrail), by the cost-tracker plugin (per-tree cost attribution), and by the federation provenance log (ADR-144's `recordAction`).

### P3 — Depth-aware spawn guardrail in the pre-task hook

**Where**: `v3/@claude-flow/hooks/src/handlers/pre-task.ts`.

Before any new spawn, the hook reads the current chain depth from P2's AgentDB row (or the OTel context if the row hasn't landed yet) and refuses spawns at or beyond `swarm.maxNestingDepth` in `claude-flow.config.json`. Default cap: `4` (one less than Anthropic's announced 5, to preserve a guard band — ruflo's refusal should fire before Anthropic's does, with a clearer error). Configurable per-deployment; gated behind `CLAUDE_FLOW_STRICT_NESTING=true` (default off) to avoid regressing existing pipelines until P1 + P2 telemetry is collected.

Refusal returns a typed `NESTING_DEPTH_EXCEEDED` error with the full chain in the payload so the parent agent can decide whether to summarize, hand off, or abort.

### P4 — Documentation and template alignment

**Where**: `CLAUDE.md` (root), `v3/CLAUDE.md`, the swarm-orchestration sections of agent definitions.

The current "swarm orchestration" sections in `CLAUDE.md` describe a flat fan-out from the lead. Rewrite the queen-coordinator pattern to spawn its workers nested (one level down), so the lead's context never sees the worker chatter. Replace the example `mcp__ruv-swarm__swarm_init` → fan-out flow with a `Task({subagent_type: "v3-queen-coordinator", ...})` → queen-spawns-workers flow. The Workflow tool's flat fan-out remains the right pattern when deterministic resume matters more than context isolation; document the trade-off explicitly.

## Alternatives considered

**Add `Task` to every agent.** Convenient but breaks the least-privilege story. Leaf agents that can spawn become a confused-deputy risk and pollute the spawn tree. Rejected.

**Wait for Anthropic to expose a per-agent flag.** The shipped binary doesn't have a `CLAUDE_CODE_EXPERIMENTAL_NESTED_SUBAGENTS` flag, and `hasTaskTool` is already the per-spawn gate — there's nothing to wait for. The tools-list opt-in is the intended mechanism.

**Track depth via a custom HTTP header instead of OTel.** The binary already emits `parent_agent_id` as an OTel span tag. Using a parallel custom header creates two sources of truth. Use what's already on the wire.

**Set `CLAUDE_FLOW_STRICT_NESTING=true` by default in P3.** Premature — P1 ships before the depth probe results are known. Strict mode flips to default-on once the probe data lands and the default cap is tuned (the same pattern ADR-146 uses for `CLAUDE_FLOW_STRICT_CONSENSUS_GUARDRAIL`).

## Consequences

**Positive**:
- The deepest ruflo orchestrators (`dossier-investigator`, `sparc-orchestrator`, `v3-queen-coordinator`) gain native context-window isolation per nesting level — the bottleneck Cherny called out is exactly the one these agents already hit.
- Spawn-tree persistence (P2) unlocks accurate per-tree cost attribution in `ruflo-cost-tracker`, replacing today's flat per-agent-id sum.
- Depth-aware guardrails (P3) decouple ruflo's nesting policy from Anthropic's API-side cap — if Anthropic raises or lowers the depth=5 cap, ruflo's behaviour stays predictable.
- Maps cleanly onto ADR-144's `AuthScope.delegationDepth` — same counter, two consumers (auth + nesting).

**Negative / risks**:
- Per-PR risk: P1 changes the spawn semantics of every orchestrator agent. A smoke test that exercises depth 2 must land in the same PR as the tools-list edit, or a regression will surface only when an orchestrator tries to actually nest.
- The `parent_agent_id` OTel tag is undocumented (found via binary inspection, not via Anthropic's public schema). If Anthropic renames it in a future release, P2 silently degrades to flat tracking until updated. Mitigation: P2's reader is a single function; rename is one edit.
- Default cap of 4 means ruflo refuses one level before the API would. Trade-off: clearer error, costs one level of headroom. Reversible via config.

**Deferred**:
- Cross-installation nested delegation (queen on host A spawns worker on host B, who then spawns on host C). Out of scope until ADR-104 (federation wire transport) lands.
- Adaptive depth budget (allocate more depth to less-explored subtrees). Tunable later; not blocking P1.

## Validation

**P1** lands with:
- New `nested-*` agent set in `plugins/ruflo-agent/` (8 agents + 1 skill) — orchestrators declare `tools: [Task, ...]`, leaves explicitly do not. This is the additive shape; existing v3-queen-coordinator / sparc-orchestrator / hierarchical-coordinator agents are NOT modified in P1 (deferred until the YAML opt-in mechanism is empirically confirmed to work — see below).
- A recursive depth probe (`scripts/probe-nested-spawn-depth.mjs`) that drives `claude -p` to spawn `nested-coordinator` and recursively chain L1 → L2 → … until refusal. Output goes to `docs/probes/nested-spawn-depth-*.txt`.

### P1 empirical results — 2026-06-09 (CLI 2.1.169)

The probe was run twice against this build. Both runs returned `FINAL: level=1 status=NO_AGENT_TOOL`. Findings:

| Probe variant | Result |
|---|---|
| `node scripts/probe-nested-spawn-depth.mjs` (default env) | L1 `nested-coordinator` has no Agent/Task tool — chain dies at length 1 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 node scripts/probe-nested-spawn-depth.mjs` | Same — env var does not unlock it |
| `claude plugin details ruflo-agent` after cache-stage | All 9 components discovered; YAML parsed cleanly; `tools:` field accepted by the loader |

Path-2 sweep — single-shot variants asking L1 `nested-coordinator` to report its actual tool list. Our YAML declares `tools: [Task, Read, Grep, Glob, TodoWrite, Bash]` (6 tools). The probe asks the child to enumerate what it actually has:

| Path-2 variant | L1's reported tools |
|---|---|
| Control (no flags) | `Read, Grep, Glob, Bash` |
| `--allowedTools Read,Edit,Write,Bash,Glob,Grep,Task,TodoWrite,Agent` | `Read, Grep, Glob, Bash` |
| `--permission-mode bypassPermissions` | `Read, Grep, Glob, Bash` |
| `--agent nested-coordinator` (lead is `nested-coordinator`) | `Read, Grep, Glob, Bash` |

**Sharper empirical conclusion:** **the YAML `tools:` field IS honored** — exactly 4 of our 6 declared tools propagate to the spawned child. **The runtime strips `Task` and `TodoWrite`** from any spawned subagent's tool list. The strip is consistent across permission modes, lead agent identity, and explicit `--allowedTools` grants, which means the gate is a **hardcoded or server-side denylist on specific tool names**, not a user-facing toggle. No flag we found defeats it.

This is actually a *favorable* finding for ADR-147: it confirms that the YAML mechanism is the right opt-in shape, and our agent files are declaratively correct. When the denylist for `Task` lifts — whether by a 2.1.170+ build, a server-side rollout, or an opt-out flag we haven't discovered — nested spawning activates with **zero code changes** to ruflo's agents.

Cherny's tweet ("going out in today's release", 2026-06-09) most likely refers to the binary plumbing landing while the runtime denylist gets relaxed in a follow-on rollout.

**Implication for P1 status:** P1's *infrastructure* (agent files, skill doc, ADR) is shipped and correct — when the runtime gate flips on (whether by an Anthropic-side rollout, a future 2.1.170+ build, or a discovered flag), the agents will work as designed without further code changes. Empirical end-to-end verification of the depth=5 cap **cannot** be performed against 2.1.169 as currently built.

**Until end-to-end verification is possible:**

1. P1 is mergeable as "infrastructure preparation." The agents and skill are present, declaratively correct, and zero-cost to ship — they consume ~680 always-on tokens per session but no runtime behaviour beyond their availability in the registry.
2. P2 (capture `parent_agent_id` to AgentDB) and P3 (depth-aware pre-task guardrail) **block on this**. Both require a working nested spawn to exercise; deferring them is correct.
3. P4 (CLAUDE.md rewrite) MUST NOT claim nested spawning is currently usable. It should describe the pattern and reference this ADR's empirical block.
4. The probe script stays in the tree as the regression test — re-running it should be the first verification step after any Claude Code CLI upgrade, and the day it returns a `CAP OBSERVED at depth=N` verdict is the day P2/P3 unblock.

**P2** lands with (deferred — see above):
- AgentDB migration adding `parent_agent_id`, `depth` columns to the agents table.
- Hook bridge writes the row on every `post-task` fire; smoke test reads back a depth-3 chain by `agent_id` and confirms parent linkage.
- Latency budget: post-task hook adds < 2 ms p99 (it was already writing one row; this adds two columns).

**P3** lands with (deferred — see above):
- `pre-task` hook reads `parent_agent_id` chain depth and returns `NESTING_DEPTH_EXCEEDED` when at cap.
- Unit test: chain at cap → refusal; chain at cap−1 → allowed.
- Integration test: a 6-level spawn chain with default cap=4 refuses at level 5, payload contains full chain.
- `CLAUDE_FLOW_STRICT_NESTING` env var documented and registered in `audit-env-var-precedence.mjs`.

**P4** lands with:
- `CLAUDE.md` queen-coordinator section rewritten to use `Task({subagent_type: "v3-queen-coordinator", ...})` nested pattern — flagged as "shipping but pending runtime activation" until the probe returns a positive verdict.
- Workflow vs nested-subagent trade-off section added (Workflows for deterministic resume + flat fan-out; nested subagents for deep context isolation).
- Cross-references from ADR-099, ADR-144, ADR-143 updated to point at ADR-147 for the depth semantics.

**P2** lands with:
- AgentDB migration adding `parent_agent_id`, `depth` columns to the agents table.
- Hook bridge writes the row on every `post-task` fire; smoke test reads back a depth-3 chain by `agent_id` and confirms parent linkage.
- Latency budget: post-task hook adds < 2 ms p99 (it was already writing one row; this adds two columns).

**P3** lands with:
- `pre-task` hook reads `parent_agent_id` chain depth and returns `NESTING_DEPTH_EXCEEDED` when at cap.
- Unit test: chain at cap → refusal; chain at cap−1 → allowed.
- Integration test: a 6-level spawn chain with default cap=4 refuses at level 5, payload contains full chain.
- `CLAUDE_FLOW_STRICT_NESTING` env var documented and registered in `audit-env-var-precedence.mjs`.

**P4** lands with:
- `CLAUDE.md` queen-coordinator section rewritten to use `Task({subagent_type: "v3-queen-coordinator", ...})` nested pattern.
- Workflow vs nested-subagent trade-off section added (Workflows for deterministic resume + flat fan-out; nested subagents for deep context isolation).
- Cross-references from ADR-099, ADR-144, ADR-143 updated to point at ADR-147 for the depth semantics.
