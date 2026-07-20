# ruflo-core

Foundation plugin. Registers the `ruflo` MCP server (314 tools), provides three generalist agents (`coder`, `researcher`, `reviewer`), three first-run helpers (`init-project`, `ruflo-doctor`, `discover-plugins`), and a curated catalog covering all 32 sibling plugins.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-core@ruflo
```

## What's Included

- **MCP Server**: 314 tools via `@claude-flow/cli` (memory, agentdb, embeddings, hooks, neural, autopilot, browser, aidefence, agent, swarm, system, terminal, github, daa, coordination, performance, workflow, …)
- **CLI Commands**: 26 commands with 140+ subcommands for agent orchestration
- **3-Tier Model Routing**: Agent Booster (WASM), Haiku, Sonnet/Opus with automatic cost optimization
- **Session Management**: Persistent sessions with cross-conversation learning
- **Hooks**: PreToolUse / PostToolUse / PreCompact / Stop wired to claude-flow's auto-routing + learning loop. Defined at `plugins/ruflo-core/hooks/hooks.json` so the per-plugin loader picks them up on `/plugin install ruflo-core@ruflo` (per-plugin layout — fixes #1748 Issue 1; the marketplace-root copy at `.claude-plugin/hooks/hooks.json` is preserved for `claude --plugin-dir <repo-root>` users).

## Configuration

The MCP server starts automatically when this plugin is active. Override environment variables in `.mcp.json` as needed.

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor. The `.mcp.json` invocation runs `scripts/mcp-start.cjs`, which resolves a pinned local build if one is configured (see below) and otherwise falls back to `npx @claude-flow/cli@latest` for dynamic resolution; the smoke contract verifies the resolved CLI matches the v3.6 line.
- **Verification:** `bash plugins/ruflo-core/scripts/smoke.sh` is the contract.

## Pinning the CLI build


The MCP server is a long-lived writer against the shared `.swarm/memory.db`.
By default `.mcp.json` starts the **registry** build (`npx @claude-flow/cli@latest`).
On a host running a locally patched CLI, that registry build becomes a *second,
unmanaged writer* against the same DB — the whole-image rename-over it performs
can corrupt it. To keep the daemon on your intended build, `.mcp.json` launches
the server through `scripts/mcp-start.cjs`, invoked via the same cross-platform
`node -e` + `CLAUDE_PLUGIN_ROOT` bootstrap this plugin's `hooks.json` uses (#2721
— no shell, no `${VAR}`-in-JSON, works unchanged on Windows/macOS/Linux). The
wrapper resolves the CLI in this order (matching `ruflo-cost-tracker/scripts/_npx.mjs`):

1. **`RUFLO_CLI_BIN`** — absolute path to a `cli.js` (run via `node`) or an
   executable (run directly). Used if the path exists.
2. **`$PWD/.claude-flow/cli-pin.json`** — parsed with `JSON.parse` (no `jq`
   dependency). Shape:
   ```json
   { "bin": "/abs/path/to/@claude-flow/cli/bin/cli.js", "reason": "why", "pinnedAt": "2026-07-18T00:00:00Z" }
   ```
   Used if it parses and `bin` exists; a malformed pin file is ignored (the
   server still starts).
3. **Registry fallback** — `npx -y @claude-flow/cli@latest`, with a one-line
   stderr `[ruflo] MCP server using unpinned registry CLI …` notice.

The wrapper writes **nothing** to stdout (the JSON-RPC channel) and spawns the
resolved CLI with `stdio: 'inherit'`, so the CLI owns fds 0/1/2 directly with no
interposition on the protocol stream. The bare CLI invocation and the
`CLAUDE_FLOW_MCP_TRANSPORT=stdio` env are preserved exactly (no subcommand is
injected).


The pin file also accepts an optional `"expiresWhenRegistryHas": "<semver>"`
floor: once the registry's `@claude-flow/cli` version reaches it, the pin
self-expires and resolution returns to the registry automatically. The
decision uses a locally cached registry version (`.claude-flow/registry-version.json`)
refreshed in the background — never a network call on the hook's hot path.

## MCP server contract

The registered `ruflo` MCP server exposes 314 tools across these families. Runtime truth is `mcp tool call mcp_status`:

| Family | Notable tools | Plugin documenting it |
|--------|---------------|-----------------------|
| `memory_*` | `memory_store`, `_search`, `_search_unified`, `_import_claude`, `_bridge_status` | `ruflo-rag-memory` |
| `agentdb_*` | 15 tools for hierarchical / pattern / causal storage | `ruflo-agentdb` |
| `embeddings_*` | 10 tools incl. RaBitQ 32× quantization | `ruflo-agentdb`, `ruflo-ruvector` |
| `hooks_*` (incl. `hooks_intelligence_*`) | 19+ tools — routing, learning, transfer, metrics, explain | `ruflo-intelligence`, `ruflo-autopilot` |
| `aidefence_*` | 6 tools — PII / prompt-injection / sanitization | `ruflo-aidefence` |
| `neural_*` | 6 tools — train, predict, patterns, compress | `ruflo-intelligence` |
| `autopilot_*` | 10 tools — autonomous loops + learning | `ruflo-autopilot` |
| `browser_*` (+ new `browser_session_*`) | 23 + 5 = 28 tools — Playwright + RVF lifecycle | `ruflo-browser` |
| `ruvllm_sona_*` / `ruvllm_microlora_*` | 4 tools — adaptive learning | `ruflo-intelligence`, `ruflo-ruvllm` |
| `agent_*`, `swarm_*` | spawn, list, status, orchestrate | `ruflo-swarm` |
| `system_*`, `terminal_*` | system + terminal session ops | this plugin |

For every other plugin's tool surface, see its `docs/adrs/0001-*.md`.

## Sibling contracts

This foundation plugin defers to seven sibling ADRs that own specific cross-cutting contracts. New plugins (and consumers of `ruflo-core`) should reference these instead of re-deriving:

| Contract | Owner |
|----------|-------|
| **Pinning + smoke as contract** (general pattern) | [ruflo-ruvector ADR-0001](../ruflo-ruvector/docs/adrs/0001-pin-ruvector-0.2.25.md) |
| **Namespace convention** (`<plugin-stem>-<intent>`, reserved namespaces) | [ruflo-agentdb ADR-0001](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md) |
| **Session-as-skill architecture** (RVF + trajectory + 3 AIDefence gates) | [ruflo-browser ADR-0001](../ruflo-browser/docs/adrs/0001-browser-skills-architecture.md) |
| **4-step intelligence pipeline** (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE) | [ruflo-intelligence ADR-0001](../ruflo-intelligence/docs/adrs/0001-intelligence-surface-completeness.md) |
| **3-gate AIDefence pattern** (PII pre-storage, sanitization, prompt-injection) | [ruflo-aidefence ADR-0001](../ruflo-aidefence/docs/adrs/0001-aidefence-contract.md) |
| **270s cache-aware /loop heartbeat** | [ruflo-autopilot ADR-0001](../ruflo-autopilot/docs/adrs/0001-autopilot-contract.md) |
| **ADR plugin contract** (token-optimization via REFERENCE.md) | [ruflo-adr ADR-0001](../ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md) |

## Verification

```bash
bash plugins/ruflo-core/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-core plugin contract (foundation, MCP server, plugin catalog, smoke as contract)](./docs/adrs/0001-core-contract.md)
