# ruflo-agent

Agent runtimes for ruflo — one mental model, two backends (a third planned):

| Runtime | Tools | Runs on | Trust | Best for |
|---|---|---|---|---|
| **WASM** (`rvagent`) | `wasm_agent_*` / `wasm_gallery_*` | local WASM sandbox | sandboxed — no host fs/net | untrusted code; portable/replayable RVF containers; fast, free, offline |
| **Managed** (Anthropic cloud) | `managed_agent_*` | Anthropic-managed container | cloud-isolated | long-running/async tasks; real container with packages + network; persistent filesystem + transcript across turns; no local setup |
| **SDK** (planned — ADR-116) | `sdk_agent_*` | your process / your filesystem | full host trust | a real Claude agent loop (hooks, subagents, MCP, sessions, skills) on the local repo — the in-process version of `claude -p`; the killer combo is `mcpServers: { ruflo: { command: "npx", args: ["ruflo","mcp","start"] } }` (a local stdio MCP server → the agent gets ruflo's 314 tools, zero deployment) |

`wasm_agent_*` is the **safe default** (sandboxed). `managed_agent_*` needs `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) + Claude Managed Agents beta access — every `managed_agent_*` tool degrades gracefully with a structured "use `wasm_agent_create` for a local no-key runtime" error when the key is absent.

Design: [ADR-115](../../v3/docs/adr/ADR-115-managed-agents-rvagent-backend.md) (the cloud runtime + the planned SDK runtime); [ADR-070](../../v3/implementation/adrs/ADR-070-rvagent-wasm-completion.md) (the WASM runtime); plugin contract [`docs/adrs/0001-wasm-contract.md`](./docs/adrs/0001-wasm-contract.md).

> Renamed from `ruflo-wasm` (it only covered the local WASM runtime). The `wasm_agent_*` / `wasm_gallery_*` tool *names* are unchanged.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-agent@ruflo
```

## Commands

- `/wasm` — list running WASM agents and browse the gallery (local runtime)
- `/managed-agent` — list Managed Agent cloud sessions, check status, fetch a transcript, clean up (cloud runtime)

## Skills

- `wasm-agent` — create and manage sandboxed WASM agents (local)
- `wasm-gallery` — browse and publish agents in the community gallery
- `managed-agent` — run an Anthropic Claude Managed Agent (cloud) — create / prompt / status / events / list / terminate
- `nested-subagents` — spawn nested sub-agent trees (depth ≤ 5) via Claude Code's native `Task` tool for context-managed deep delegation

## MCP surface (16 tools)

### WASM runtime — `v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` (10)

| Tool | Purpose |
|------|---------|
| `wasm_agent_create` | Spin up a sandboxed WASM agent |
| `wasm_agent_prompt` | Send a prompt to the agent |
| `wasm_agent_tool` | Invoke a tool inside the sandbox |
| `wasm_agent_list` | List active WASM agents |
| `wasm_agent_terminate` | Stop a WASM agent |
| `wasm_agent_files` | Read/write files in the sandbox |
| `wasm_agent_export` | Export agent state (RVF container) |
| `wasm_gallery_list` | Browse community-published WASM agents |
| `wasm_gallery_search` | Search the gallery |
| `wasm_gallery_create` | Publish a WASM agent to the gallery |

### Managed (cloud) runtime — `v3/@claude-flow/cli/src/mcp-tools/managed-agent-tools.ts` (6, ADR-115)

| Tool | Purpose | WASM counterpart |
|------|---------|------------------|
| `managed_agent_create` | Provision Agent + Environment + Session (`POST /v1/agents`, `/v1/environments`, `/v1/sessions`). Accepts `model` / `system` / `name` / `networking` / `packages` / `initScript` / `mcpServers` / `skills`. | `wasm_agent_create` |
| `managed_agent_prompt` | Send a user turn (`POST /v1/sessions/{id}/events`), poll until the session goes idle (default 180 s, cap 600 s) → `{finished, status, stopReason, assistantText, toolUses[], eventCount}` | `wasm_agent_prompt` |
| `managed_agent_status` | Session lifecycle state (idle/running/error, title, last error) | — |
| `managed_agent_events` | Full server-persisted event log + a summary (the transcript/artifact view) | `wasm_agent_files` |
| `managed_agent_list` | List Managed Agent sessions on the org (id, status, title) — see which are still billing | `wasm_agent_list` |
| `managed_agent_terminate` | `DELETE /v1/sessions/{id}` (± the environment) — **always call when done**; a cloud session bills container time + tokens until deleted | `wasm_agent_terminate` |

> Beta API (`anthropic-beta: managed-agents-2026-04-01`); `multiagent` / `define-outcomes` on the agent config are research preview. `mcpServers` for a cloud agent must point at a **publicly reachable** URL — a local `ruflo mcp start` is not reachable from Anthropic's cloud (deploy/tunnel an HTTP ruflo MCP server first). Managed sessions cost LM tokens + container time and are rate-limited per org.

## Compatibility & degradation

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **WASM runtime:** built on `@ruvector/rvagent-wasm` + `@ruvector/ruvllm-wasm` (declared in `@claude-flow/cli`'s `optionalDependencies` per [ADR-070](../../v3/implementation/adrs/ADR-070-rvagent-wasm-completion.md)). Without those packages, the `wasm_agent_*` tools fall through to graceful-degradation no-ops.
- **Managed runtime:** plain `fetch` against the Managed Agents REST API — no extra SDK dependency. Without `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`, every `managed_agent_*` tool returns a structured error pointing at the `wasm_agent_*` fallback (the CLI/MCP server stays up).
- **Verification:** `bash plugins/ruflo-agent/scripts/smoke.sh` is the contract (12 structural checks). CI: `.github/workflows/ruflo-agent-smoke.yml`. Behavioral guard for the cloud tools: `v3/@claude-flow/cli/__tests__/managed-agent-tools.test.ts` (no-network).

## Sandbox / trust

WASM agents run with **no host filesystem access** by default; `wasm_agent_files` exposes a sandboxed virtual filesystem only. Managed agents run in Anthropic's cloud container (isolated from your machine). The planned SDK runtime would run in *your* process with full host trust — which is why `wasm_agent_*` stays the default and the SDK runtime, when built, will be opt-in.

For prompt-injection defense on output flowing back to the host LLM, the [ruflo-aidefence 3-gate pattern](../ruflo-aidefence/docs/adrs/0001-aidefence-contract.md) applies.

## Namespace coordination

This plugin owns the `wasm-gallery` AgentDB namespace (kebab-case, per [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed. `wasm-gallery` indexes published WASM agents (manifest, version, signature, download count); accessed via `memory_*` (namespace-routed).

## Verification

```bash
bash plugins/ruflo-agent/scripts/smoke.sh
# Expected: "12 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-agent plugin contract](./docs/adrs/0001-wasm-contract.md) (WASM runtime: 10-tool MCP surface, ADR-070 integration, sandbox isolation, smoke as contract)
- [`ADR-115`](../../v3/docs/adr/ADR-115-managed-agents-rvagent-backend.md) — Claude Managed Agents as the cloud runtime (+ the planned SDK runtime, ADR-116)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner
- `ruflo-aidefence` — 3-gate pattern applies to agent output flowing back to the host LLM
- `ruflo-ruvector` — the ruvector substrate that ships `@ruvector/rvagent-wasm`
- `ruflo-cost-tracker` — record completed Managed Agent sessions (LM tokens + container time)
