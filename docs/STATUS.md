# Ruflo — Overview · Usage · Status

> The complementary doc to [`USERGUIDE.md`](USERGUIDE.md) (deep reference) and [`/verification.md`](../verification.md) (cryptographic witness). This doc tells you **what Ruflo is**, **how to use it day-to-day**, and **what currently works** — without the encyclopedic reference depth.

---

## Overview

Ruflo is a multi-agent AI orchestration layer for Claude Code. It turns Claude Code from a single-context coding assistant into a coordinated swarm of agents that share memory, learn from outcomes, talk across machines, and remain auditable.

The runtime is the `ruflo` npm package. End-user surface is:

- **MCP server** — exposes 323 tools to Claude Code (memory, agents, swarm coordination, hooks, GitHub integration, browser automation, etc.).
- **CLI** — 45 top-level commands (`ruflo agent`, `ruflo swarm`, `ruflo memory`, `ruflo hooks`, `ruflo verify`, …) for terminal/script use.
- **Claude Code plugins** — 32 installable plugins (`ruflo-core`, `ruflo-federation`, `ruflo-cost-tracker`, …) that bundle agent + skill + slash-command definitions.
- **WASM kernels** — Rust-compiled WASM for the policy engine, embeddings, and proof system; plugged into the same MCP/CLI surface.

For the "why" — coordinated swarms, self-learning memory, federated comms, enterprise security — see [`README.md`](../README.md).

## Usage at a glance

The intended day-to-day flow:

1. **Install once**:
   ```bash
   npx ruflo init --wizard
   ```
   This writes a `CLAUDE.md` with hooks and routing rules, registers the MCP server with Claude Code, and seeds `.claude-flow/` with config + memory.

2. **Just use Claude Code normally**. Hooks automatically route tasks, retrieve relevant memory patterns, and coordinate background agents. You don't have to learn the 323 MCP tools — the routing layer does.

3. **Run the CLI for orchestration tasks** that don't fit naturally into Claude Code:
   - `ruflo agent spawn -t coder --name api-worker` — long-running agent
   - `ruflo swarm init --topology hierarchical --max-agents 8` — coordinated team
   - `ruflo memory search --query "auth patterns"` — semantic search across stored knowledge
   - `ruflo doctor --fix` — diagnose & repair install
   - `ruflo verify` — confirm your installed bytes match the signed witness

4. **Install plugins as you need them**:
   ```bash
   /plugin marketplace add ruvnet/ruflo
   /plugin install ruflo-federation@ruflo
   ```

Full command reference: [`USERGUIDE.md`](USERGUIDE.md).

## Status — what currently works

**Snapshot at `ruflo@3.10.2` / `@claude-flow/cli@3.10.1`**, branch `main` @ commit `cdd5308d8`. Capability counts updated 2026-05-25 via quality-sweep audit (see `docs/QUALITY-SWEEP.md`).

### Test baseline

| Suite | Count | Status |
|---|---|---|
| `@claude-flow/cli` vitest | 1999 / 1999 | green, 0 failures, 46 intentionally skipped |
| `@claude-flow/plugin-agent-federation` vitest | 366 / 366 | green |
| **Combined audit-fix surface** | all encryption + federation + graph tests | green |

### Capability inventory (auto-generated via [`scripts/inventory-capabilities.mjs`](../scripts/inventory-capabilities.mjs))

| Surface | Count | Verified by |
|---|---|---|
| MCP tools | **323** | `verification/inventory.json` + quality-sweep audit 2026-05-25 |
| CLI commands (top-level) | **45** | quality-sweep audit 2026-05-25 (commands/index.ts) |
| Plugins (`plugins/ruflo-*`) | **33** | quality-sweep audit 2026-05-25 (33 dirs with .claude-plugin/plugin.json) |
| Agent definitions | **45** | quality-sweep audit 2026-05-25 (plugins/*/agents/*.md count) |

### Recently shipped (since `ruflo@3.6.24` published)

**Audit hardening — `audit_1776853149979`**:
- Command injection closed in `github-safe.js`, `statusline.js/cjs` (git calls), `github-tools` MCP (gh pr/issue/run), `update/executor` (npm install).
- Loader-hijack env vars (`LD_PRELOAD`, `NODE_OPTIONS`, `DYLD_*`) denied at the `terminal_create` boundary via `validateEnv()`.
- File mode 0600 enforced on session, terminal, memory stores via `fs-secure.writeFileRestricted`.
- MCP stdin DoS cap (10MB) on `bin/mcp-server.js` + `bin/cli.js` to prevent un-newlined-input OOM.
- Fetch timeouts on `verify` + IPFS HEAD probe.

**Encryption at rest — [ADR-096](../v3/docs/adr/ADR-096-encryption-at-rest.md), all 4 phases shipped**:
- AES-256-GCM vault module with magic-byte format (`RFE1`) for backward-compat migration.
- Opt-in via `CLAUDE_FLOW_ENCRYPT_AT_REST=1`; off-by-default preserves the 1865-test baseline.
- High-tier stores wired: `sessions/`, `terminals/`, `.swarm/memory.db` (sql.js SQLite + ONNX embeddings).
- 76 dedicated tests across vault primitives, integration, tamper detection, migration paths.

**Federation budget circuit breaker — [ADR-097](../v3/docs/adr/ADR-097-federation-budget-circuit-breaker.md), Phase 1 shipped**:
- `federation_send` accepts optional `budget`/`maxHops`/`hopCount`/`spent` metadata.
- Default `maxHops: 8` defangs recursive delegation loops even for callers that don't opt in.
- Constant-string error reasons (`HOP_LIMIT_EXCEEDED`, `BUDGET_EXCEEDED`, `INVALID_BUDGET`) — no oracle leak.
- Closes #1723 (and dup #1724).

### What's next

Tracked in the project task list (see GitHub Project / `TaskList`):

| Track | Status |
|---|---|
| ADR-096 Phase 5 — `ruflo doctor` encryption status | pending |
| ADR-096 Phase 5+ — keychain (`keytar`) + passphrase resolvers | deferred |
| ADR-097 Phase 2 — peer state machine (ACTIVE / SUSPENDED / EVICTED) | deferred |
| ADR-097 Phase 3 — `ruflo-cost-tracker` integration | deferred |
| ADR-097 Phase 4 — `ruflo doctor` peer state + `federation_breaker_status` MCP tool | deferred |
| `verification.md` per-MCP-tool witness signing | pending (task #25) |
| `verification.md` functional smoke tests for `ruflo verify --functional` | pending (task #26) |
| Batch publish `3.6.25` + witness manifest regen | pending |

### Verification

Every fix in `verification.md` is signed with Ed25519 keyed off the git commit. To verify your installed bytes match what was witnessed:

```bash
ruflo verify
```

The command fetches the manifest, recomputes SHA-256 for every cited file, re-derives the public key from the git commit, and verifies the signature. Drift in any fix produces a non-zero exit + a structured error pointing at the regressed file.

Per-capability witness signing for the full 300-tool / 49-command surface is in flight — see tasks #25 / #26.

## Where to go next

| If you want to… | Read this |
|---|---|
| Pitch / why-ruflo | [`README.md`](../README.md) |
| Day-to-day commands + config | This doc, plus [`USERGUIDE.md`](USERGUIDE.md) for depth |
| Architecture decisions | [`v3/docs/adr/`](../v3/docs/adr/) — ADR-093, ADR-095, ADR-096, ADR-097 are the recent ones |
| Cryptographic proof of build correctness | [`verification.md`](../verification.md) + [`ruflo verify`](#verification) |
| Plugin development | [`USERGUIDE.md` → Plugin section](USERGUIDE.md#-ecosystem--integrations) |
| Open issues + roadmap | [GitHub Issues](https://github.com/ruvnet/claude-flow/issues) |
