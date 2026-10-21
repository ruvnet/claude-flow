# ADR-402: Host-Agnostic Agent Teams (Grok-first, Claude-portable)

**Status:** Proposed  
**Date:** 2026-07-20  
**Deciders:** Ruflo maintainers  
**Related:** ADR-018 (Claude Code integration), teammate-plugin, swarm-comms mailbox, RuvNet Brain grounding, `init --codex` pattern

---

## Context

Ruflo’s multi-agent “Agent Teams” UX on Claude Code depends on host features:

- Named agents + proprietary **`SendMessage`** mailbox
- Claude `Task` tool / TeammateTool (`@claude-flow/teammate-plugin`, `~/.claude/teams/`)
- Optional `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`

Grok Build already provides strong primitives that Claude Agent Teams lack or only partially have:

| Capability | Grok | Claude Agent Teams |
|------------|------|--------------------|
| Parallel children | `spawn_subagent` + background | Task / teammates |
| Isolation | **`isolation: worktree`** | Shared tree (race-prone) |
| Least privilege | `capability_mode` | Soft / prompt-level |
| Stage continuity | `resume_from` | Message-only handoff |
| Hooks | Claude-compat + SubagentStop | TeammateIdle / TaskCompleted |
| Skills | `.agents` + `.claude` discovery | Claude skills |

Today’s **teammate-plugin is Claude-bound** (peerDep on Claude Code, spawn returns `AgentInput` for Claude Task). A Grok-only prompt convention is not enough: teams, skills, and learning are product-critical and must work **better than Claude Code**.

Existing seed in-tree: `.claude/helpers/swarm-comms.sh` already implements a **filesystem mailbox** under `.claude-flow/swarm/mailbox/`.

## Decision

1. **Put the Agent Teams bus in Ruflo, not in the host.**  
   Comms are MCP + on-disk/AgentDB state. Hosts only execute spawns and run hooks.

2. **Ship `team_*` MCP tools** (host-agnostic contract):

   | Tool | Purpose |
   |------|---------|
   | `team_create` | Create team + topology + max members |
   | `team_spawn` | Register teammate; return **spawn plan** for the host |
   | `team_send` | Enqueue message to named agent (or `*`) |
   | `team_inbox` | Drain / peek mailbox for agent |
   | `team_broadcast` | Fan-out |
   | `team_plan` | Steps + dependencies (pipeline) |
   | `team_status` | Members, queues, plan progress |
   | `team_on_stop` | Idle-assign / train (hook entry) |
   | `team_shutdown` | Graceful teardown |

3. **Spawn plan contract** (host adapter):

```json
{
  "teamId": "team_…",
  "name": "architect",
  "role": "architect",
  "prompt": "…comms protocol embedded…",
  "host": {
    "grok": {
      "subagent_type": "general-purpose",
      "capability_mode": "read-only",
      "isolation": "none",
      "background": true
    },
    "claude": {
      "taskType": "system-architect",
      "note": "optional back-compat path"
    }
  },
  "next": ["developer"]
}
```

Grok lead calls `spawn_subagent` with the plan; it does **not** need `SendMessage`.

4. **Storage**

   - Team state: project-local `.claude-flow/teams/{teamId}/` (not `~/.claude/teams/`)
   - Mailbox: per team, `.claude-flow/teams/{teamId}/mailbox/{agent}/` (+ optional AgentDB namespace `team:{id}`). Not the shared `.claude-flow/swarm/mailbox/`: an agent name is only unique within its team.
   - Learning: existing `post-task` / memory_store patterns

5. **Grok defaults that beat Claude**

   - Write agents: `isolation: worktree`
   - Research/review: `read-only` / explore
   - Pipeline: short cycles + `team_on_stop` idle assign
   - Optional `resume_from` for stage continuity when mailbox payload is large

6. **Grounding (RuvNet Brain)** is in scope for the same host effort:  
   `search_ruvnet` (or forge-mcp) + intent/action policy so the model does not drift to training-prior infra.

7. **Product entry:** `npx ruflo init --grok` (later) mirrors `init --codex` — writes `.grok/config.toml`, rules, agents, MCP registration.

## Consequences

### Positive

- Same team semantics on Grok, Codex, Claude (Claude becomes one adapter).
- Worktree isolation reduces multi-agent file conflicts vs Claude shared-tree teams.
- Federation can later ride the same bus.
- Upstreamable: host-agnostic core can be proposed back to ruvnet/ruflo.

### Negative / costs

- Must implement and maintain `team_*` tools and adapters.
- Grok may not inject `UserPromptSubmit` stdout the way Claude injects `additionalContext` — route/brain hooks need file or MCP fallbacks.
- Skill/tool surface must be curated to avoid context drowning (300+ MCP tools + 100+ skills).

### Neutral

- teammate-plugin remains for native Claude TeammateTool users until migrated to the agnostic bus.
- CLAUDE.md Claude-specific examples stay valid for Claude hosts; Grok overlay (`.grok/rules/ruflo-grok.md`) takes precedence on Grok.

## Implementation plan (summary)

1. Phase 0: project `.grok/config.toml` + rules + MCP smoke — **done**.
2. Phase 1: mailbox-backed `team_create/send/inbox/status` MVP — **done** (CLI + MCP).
3. Phase 2: `team_spawn` spawn plans + Grok agent defs + SubagentStop → `team_on_stop` — **done**.
4. Phase 3: RuvNet Brain MCP + grounding rules — **done** (`KB_DIR` required).
5. Phase 4: `init --grok` — **done**. A host conformance bench is proposed separately.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Prompt-only “pretend SendMessage” | No durable bus, no idle assign, not better than Claude |
| Depend on Grok adding SendMessage | Speculative; bus should not be proprietary |
| Codex-style “single executor + swarm records only” | Fails requirement: agent teams + skills are critical |
| Fork forever without agnostic bus | Blocks upstream and multi-host |

## Amendment (2026-09-27) — Grok Build 1.0.41

Re-checked against `grok 1.0.41` and `~/.grok/docs/user-guide/` on that binary. The spawn example in the Decision section above matches Grok as of 2026-07-20. The live tool no longer matches it.

- `spawn_subagent` accepts `prompt`, `description`, `background`, `isolation`, and optionally `cwd`, `resume_from`, and `model`. It does not accept `subagent_type` or `capability_mode`. An omitted type is `general-purpose`. Capability is a property of the agent definition, which spawn cannot select.
- Nesting depth is 1. Only the lead calls `spawn_subagent`.
- Project `.grok/config.toml` contributes `[mcp_servers]`, `[plugins]`, `[permission]`, and `[mcp].max_output_bytes`. `[subagents]` in that file is ignored.
- `.grok/agents/*.md` are session profiles (`--agent-profile`, `/agents`).
- MCP tools are still reached through `search_tool` / `use_tool` (`ruflo__team_create`). `grok mcp add` still defaults to user scope; `--scope project` / `-s project` writes `./.grok/config.toml`.
- Folder trust (`/hooks-trust`, `grok --trust`) gates project MCP, hooks, skills, and rules together.

`team_spawn` now returns `host.grok.spawn` (the arguments to pass) and `host.grok.advisory` (role constraint, not a spawn argument). The prompt states the read-only or worktree constraint. `isolation: "worktree"` remains the enforced isolation knob. Operator steps and the re-check list live in `v3/@claude-flow/cli/templates/grok/docs/README.md` (copied to `docs/grok/README.md` by `init --grok`).

## Amendment (2026-09-28) — review of #3512

- One implementation: `templates/grok/scripts/grok-team-bus.mjs` is the store. The `team_*` MCP tools import it; `init --grok` copies it into a project as a CLI; the SubagentStop hook imports it. No repo-root copies.
- `team.json` writes take a cross-process lock (`team.lock`, an O_EXCL file with an owner token; a stale lock is broken by rename and token check, never by a blind delete) and go through temp file + rename. Mail is per team (`teams/{id}/mailbox/{agent}/`); a drain claims each file by rename, so concurrent drains are disjoint. Mailbox paths that are symlinks are refused.
- `team_shutdown` closes the team (spawn, send, plan, on-stop refuse); `team_spawn` enforces `maxAgents`; a broadcast with no members is refused; `priority` is an integer 0-999 in a zero-padded filename.
- The spawn description is `<role>:<agent>@<team>`; the SubagentStop hook parses it, and reports on stderr (exit 1) when a team subagent cannot be recorded or the team is ambiguous.
- `init --grok` writes only inside the project unless `--grok-statusline` is passed; then it installs `~/.grok/ruflo/host-statusline.mjs` and merges `[ui.status_line]` into `~/.grok/config.toml` with a TOML parser, or prints the snippet when it cannot merge safely. `--dry-run` lists what would be written. The project MCP entry is pinned to the running Ruflo version (the one that ships `team_*`), not `@latest`.

## References

- [RuvNet Brain](https://isovision.ai/ruvnet-brain/) — grounding at intent + action; `search_ruvnet`
- `v3/plugins/teammate-plugin` — Claude-bound prior art
- `.claude/helpers/swarm-comms.sh` — mailbox seed
- `v3/@claude-flow/cli/templates/grok/rules/ruflo-grok.md` — Grok host doctrine
- Grok user guide: MCP, hooks, subagents, skills, Claude compat
)
