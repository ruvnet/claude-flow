# ruflo-swarm

Agent teams, swarm coordination, Monitor streams, and worktree isolation.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-swarm@ruflo
```

## What's Included

- **Agent Teams**: TeamCreate, SendMessage, and Task tool integration for multi-agent coordination
- **Topologies**: hierarchical, mesh, hierarchical-mesh, ring, star, adaptive
- **Monitor Streams**: Real-time swarm status changes via `Monitor` on `node "${CLAUDE_PLUGIN_ROOT}/scripts/swarm-watch.mjs"` (polls `swarm status`; the CLI has no `swarm watch`)
- **Worktree Isolation**: Each agent works in its own git worktree to avoid conflicts
- **Hive-Mind Consensus**: Byzantine, Raft, Gossip, CRDT, and Quorum strategies
- **Anti-Drift**: hierarchical topology with specialized strategy for tight coordination

## Requires

- `ruflo-core` plugin (provides MCP server)

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-swarm/scripts/smoke.sh` is the contract.

## MCP surface (12 tools)

| Family | Count | Tools |
|--------|------:|-------|
| `swarm_*` | 4 | `swarm_init`, `swarm_status`, `swarm_shutdown`, `swarm_health` |
| `agent_*` | 8 | `agent_spawn`, `agent_execute`, `agent_terminate`, `agent_status`, `agent_list`, `agent_pool`, `agent_health`, `agent_update` |

Sources: `v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts:71, 145, 208, 270` and `agent-tools.ts:182, 287, 319, 356, 395, 451, 573, 651`.

## Built-in Claude Code coordination tools

This plugin pairs with Claude Code's native multi-agent tools (no MCP needed):

| Tool | Purpose |
|------|---------|
| `Task` | Spawn a sub-agent (use `name:` for addressability + `run_in_background: true` for parallel execution) |
| `SendMessage` | Inter-agent comms (named agents only) |
| `TaskCreate / TaskList / TaskGet / TaskUpdate / TaskOutput / TaskStop` | Shared task tracker for swarm pipelines |
| `Monitor` | Live-stream events from a long-running process (`persistent: true`) — primary wake signal for /loop |
| `EnterWorktree / ExitWorktree` | Git worktree isolation per agent |

## Anti-drift defaults (per CLAUDE.md)

For coding swarms, the canonical defaults that prevent agent drift:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `topology` | `hierarchical` | Coordinator catches divergence |
| `maxAgents` | 6–8 | Smaller team = less drift |
| `strategy` | `specialized` | Clear roles, no overlap |
| `consensus` | `raft` | Leader maintains authoritative state |
| `memory` | `hybrid` | SQLite + AgentDB for both fast + durable |

For 10+ agent teams, use `hierarchical-mesh` (queen + peer communication).

## Namespace coordination

This plugin owns the `swarm-state` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`swarm-state` indexes active swarms, agent assignments, and topology snapshots. Accessed via `memory_*` (namespace-routed).

## Live swarm pane (Claude Code mod, early access)

With Claude Code function hooks on (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, or the engine's own rollout), the plugin's
hooks module (`hooks/register.ts`) draws a pane beside the transcript. Without function hooks nothing loads, and the
commands, skills and agents above behave as they always have.

- **Tiles**: one per agent: ruflo's agents from `.claude-flow/agents/store.json`, the hive queen, Claude Code's own
  subagents and teammates (from `agent.spawn` and `$.agent.list()`), and the main loop. The colour shows the state
  (idle, working, blocked, done, failed) and a word is always drawn beside it. A tile turns blue while its loop reads
  files and yellow while it writes. The leader is starred.
- **Topology** (hierarchical, mesh, ring, star) as ruflo wrote it, plus **tasks** with their claims, **hive-mind
  proposals** and their votes, **cost and context** from `$.session.usage()`, and the **router's last pick** seen this
  session, with its score. A pick under `routeThreshold` is shown as below threshold. A figure that is not on disk, or
  that the engine did not give, is shown as `n/a` or listed under "not on disk", never as zero.
- **Buttons** act through the ruflo CLI with fixed argv and ids checked against ruflo's own format: logs or activity,
  claim, steal, hand off, pause or resume a claim, stop, offer for stealing, re-route, vote, and put the next command in
  the prompt (a person still presses Enter). Stop, steal and hand off ask for a second press. After each action the
  pane re-reads the disk and says whether the change shows there. A CLI that exits 0 while nothing changes on disk is
  reported as unverified.
- **Commands**: `/ruflo swarm pane|status [json]|topology|claims|consensus`, through ruflo-console's `/ruflo`. The old
  `/ruflo-swarm-pane`, `/ruflo-swarm-status`, `/ruflo-swarm-topology`, `/ruflo-swarm-claims` and
  `/ruflo-swarm-consensus` stay registered as aliases (ADR-406: no command is removed or renamed). `/ruflo-swarm:watch` also opens the pane.
- **Options** (`/config`): `panel` (command, the default since ruflo-console's cockpit is the pane that opens by
  itself | auto | off: `/ruflo swarm pane` refuses and `/ruflo-swarm:watch` does not open it), `cli` (`npx-offline`, the default, never touches the
  network), `routeThreshold`, `injectAdrs` (on by default: with ADRs attached to the active ruflo-console mission, appends their accepted decisions, masked and capped, to spawned subagents' prompts and names them on the member row; nothing is added without an attached ADR), `injectSpawnContext` (off by default: appends a one-line swarm note to spawned subagents'
  prompts) and `audit` (off by default: event names, tool names and agent ids into ruflo memory, never content).
- The mod does not register `prompt.submit` or `tool.check` hooks, and its `tool.call` hook only observes.
- **With the ruflo-mods trust gate:** if you set `modTrust: refuse-risky`, the gate refuses this mod. The mod hooks
  `tool.call` and, with `audit` on, `*`, and it calls `process.run`. To keep it, add its provenance to `modTrustAllow`:
  `ruflo-swarm@ruflo`. The gate matches name@marketplace, not the plugin name. Under the default `modTrust: observe`
  the mod loads unchanged.

Tests run on the engine's own kit: `claude plugin test plugins/ruflo-swarm` (run `scripts/fetch-mod-types.sh` once
first if you want `tsc -p plugins/ruflo-swarm` to typecheck). The pure readers also run under vitest:
`npx vitest run --root plugins/ruflo-swarm tests/parse.spec.ts`.

## Toasts (ADR-477)

ruflo-swarm draws its toasts through the shared toast policy (one copy of `hooks/toast-policy.ts`, kept identical across the ruflo mods by `scripts/sync-toast-policy.mjs`): a level prefix (`›` info, `✓` ok, `⚠` warn, `✗` error), one clean line of at most 120 characters with secrets masked, an identical toast not repeated for a minute, and at most four a minute per source (errors are held and counted, never dropped). `Next: …` (when the prompt box cannot be filled) is `info`; a subagent whose turn ends in anything but an answer or an abort is an `error`; a loop that fails the same call three times running is a `warn` ("keeps failing …").

The person's choice is the console's **Settings → Interface and updates → Toasts**: `all`, `important` (warnings and errors) or `off`, and a mute chip per source. Every toast, drawn or not, is kept as a digest the console shows on its Events page, flagged with what became of it; without the console nothing is written and the defaults apply.

## Verification

```bash
bash plugins/ruflo-swarm/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/ruflo-swarm
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate --strict plugins/ruflo-swarm
```

## Architecture Decisions

- [`ADR-0001` — ruflo-swarm plugin contract (12-tool MCP surface, anti-drift defaults, Monitor streaming, smoke as contract)](./docs/adrs/0001-swarm-contract.md)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner
- `ruflo-autopilot` — owns the 270s cache-aware /loop heartbeat for long-running swarms
- `ruflo-intelligence` — `hooks_route` powers swarm agent recommendation per task
