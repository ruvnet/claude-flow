# ADR-074: OpenClaw Pattern Adoption with RVM/RVF Execution Substrate

**Status**: Proposed
**Date**: 2026-04-06
**Author**: RuvNet
**PR**: #1542
**Related**: ADR-059 (rvagent-wasm), ADR-070 (rvagent completion), ADR-026 (model routing), ADR-058 (ruflo.rvf appliance)

## Context

[OpenClaw](https://github.com/openclaw/openclaw) (350K stars, MIT, TypeScript) is a personal AI assistant platform with a Gateway architecture, 20+ messaging channel adapters, session-based agent coordination, and a skills marketplace. While OpenClaw solves a different problem (personal assistant via messaging) than Ruflo (multi-agent developer orchestration), several architectural patterns are worth adopting.

[RVM](https://github.com/ruvnet/rvm) (RuVix Virtual Machine) is a coherence-native microhypervisor written in Rust (`no_std`, 14 crates, 945 tests) designed specifically for AI agent workloads. It provides coherence domains, capability-based isolation, a WASM agent runtime, GPU compute, and witness-chain audit logging — all at bare-metal performance (<6ns partition switch, ~331ns mincut for 16 nodes).

**RVF** (RuVix Format) is the binary container format for packaging multi-agent state, already referenced in ADR-058 (ruflo.rvf appliance) and supported by `WasmRvfBuilder` in `@ruvector/rvagent-wasm`.

This ADR combines OpenClaw's orchestration patterns with RVM/RVF as the execution substrate, creating a 3-layer architecture:

```
┌─────────────────────────────────────────────────┐
│  Layer 3: Orchestration (Ruflo)                 │
│  MCP tools, swarm topology, routing, learning   │
│  314 tools · 60+ agents · AgentDB · SONA/MoE   │
├─────────────────────────────────────────────────┤
│  Layer 2: Coordination (OpenClaw patterns)      │
│  Gateway, sessions, channels, skills marketplace│
│  session_send · session_yield · session_spawn   │
├─────────────────────────────────────────────────┤
│  Layer 1: Execution (RVM + RVF)                 │
│  Coherence domains, capabilities, WASM agents   │
│  witness chain · GPU compute · partition split  │
└─────────────────────────────────────────────────┘
```

### Platform Comparison

| | OpenClaw | Ruflo | RVM |
|---|---------|-------|-----|
| **Purpose** | Personal AI assistant | Multi-agent orchestration | Agent execution substrate |
| **Language** | TypeScript | TypeScript | Rust (`no_std`) |
| **Interface** | 20+ messaging channels | CLI, MCP, IDE | Kernel API (partitions, capabilities) |
| **Agent model** | Single + subagents | 60+ specialized types | Coherence domains with WASM runtime |
| **Memory** | Session history (flat) | AgentDB + HNSW (150x-12,500x) | 4-tier (Hot/Warm/Dormant/Cold) with reconstruction |
| **Isolation** | Process-level | WASM sandbox (rvagent-wasm) | Capability-gated partitions (<6ns switch) |
| **Audit** | None | AgentDB persistence | Witness chain (SHA-256, HMAC, 64-byte records) |
| **GPU** | None | None | 6 backends (CUDA, WebGPU, Metal, OpenCL, Vulkan, WASM SIMD) |

## Decision

Adopt 8 OpenClaw patterns across 4 phases. Use **RVM coherence domains** as the execution substrate and **RVF containers** as the agent packaging format, replacing the previous rvagent-wasm-only approach with a full RVM stack.

## Architecture

### Execution Runtime Tiers

The unified `session_spawn` primitive selects from 5 runtime tiers:

| Tier | Runtime | Backend | Spawn | Isolation | Use Case |
|------|---------|---------|-------|-----------|----------|
| 0 | `rvm` | RVM coherence domain | <6ns | Capability-gated partition | Production agent workloads on Cognitum hardware |
| 1 | `wasm` | `@ruvector/rvagent-wasm` | <1ms | WASM sandbox (VFS only) | Sandboxed analysis, no OS access |
| 2 | `native` | Claude Code Task tool | ~2s | Process-level | Full capabilities, file system, all tools |
| 3 | `headless` | `claude -p` | ~3s | Process-level | Background headless work, budget-capped |
| 4 | `acp` | External harness | varies | External process | Codex, Gemini CLI (future) |

### RVM Integration Points

```
Ruflo Gateway (MCP WebSocket)
       │
       ├── session_spawn(runtime: 'rvm', ...)
       │        │
       │        ▼
       │   RVM Kernel
       │   ├── Partition (coherence domain)
       │   │   ├── WasmAgent (7-state lifecycle)
       │   │   ├── Capabilities (READ/WRITE/EXECUTE/PROVE)
       │   │   ├── CommEdge (IPC → coherence graph)
       │   │   └── MemoryRegion (Hot → Warm → Dormant → Cold)
       │   ├── Coherence Engine
       │   │   ├── Stoer-Wagner MinCut (~331ns/16 nodes)
       │   │   ├── Cut Pressure → scheduler priority
       │   │   └── Split/Merge decisions
       │   ├── Witness Chain
       │   │   ├── SHA-256 hash-chained records
       │   │   └── → AgentDB bridge (audit persistence)
       │   └── GPU Compute (optional)
       │       └── CUDA/WebGPU/Metal for embeddings, HNSW, neural
       │
       ├── session_spawn(runtime: 'wasm', ...)
       │        └── @ruvector/rvagent-wasm (existing)
       │
       └── session_spawn(runtime: 'native', ...)
                └── Claude Code Task tool (existing)
```

### RVF Container Format

RVF (RuVix Format) serves as the portable agent packaging format across all tiers:

| Operation | Description |
|-----------|-------------|
| **Package** | Bundle agent code + state + VFS + capabilities into `.rvf` container |
| **Deploy** | Load `.rvf` into any runtime tier (RVM partition, WASM sandbox, or native) |
| **Checkpoint** | Snapshot running agent state to `.rvf` for migration or recovery |
| **Migrate** | Move agent between tiers: WASM → RVM, RVM → RVM (cross-node), RVM → native |
| **Reconstruct** | Rebuild agent state from witness chain + compressed dormant memory |

```typescript
// Package an agent as RVF
session_export({ sessionId: 'agent-123', format: 'rvf' })
// → { rvfPath: '/data/agents/agent-123.rvf', size: 42000, checksum: 'sha256:...' }

// Deploy RVF to RVM coherence domain
session_spawn({
  runtime: 'rvm',
  rvf: '/data/agents/agent-123.rvf',
  partition: { capabilities: ['READ', 'WRITE', 'EXECUTE'] },
})

// Migrate running agent from WASM to RVM
session_migrate({ sessionId: 'agent-123', from: 'wasm', to: 'rvm' })
```

### Witness Chain → AgentDB Bridge

RVM's witness system (64-byte hash-chained records for every privileged action) bridges to ruflo's AgentDB for persistent audit:

| RVM Event | Witness Record | AgentDB Entry |
|-----------|---------------|---------------|
| Agent spawn | `{ type: 'spawn', partition_id, capabilities, hash }` | `agentdb.store({ namespace: 'audit', key: hash })` |
| IPC message | `{ type: 'comm', from, to, weight, hash }` | Feeds coherence graph in AgentDB |
| Tool execution | `{ type: 'tool', tool_name, agent_id, hash }` | `agentdb.store({ namespace: 'tool-log' })` |
| Partition split | `{ type: 'split', parent, children[], cut_score }` | Topology change event |
| State checkpoint | `{ type: 'checkpoint', rvf_hash, regions[] }` | Recovery point in AgentDB |

### Coherence Engine → Swarm Topology

RVM's coherence engine replaces static topology selection with dynamic, communication-driven optimization:

| Current Ruflo | With RVM Coherence |
|--------------|-------------------|
| Static topology: `hierarchical`, `mesh`, `ring`, `star` | Dynamic: coherence engine observes IPC and auto-optimizes |
| Manual `--topology` flag | Auto-split when cut_pressure > threshold |
| No runtime rebalancing | Continuous mincut-driven partition migration |
| Memory-polling coordination | CommEdge IPC with coherence graph weighting |

The coherence engine's `CoherenceDecision` maps to ruflo swarm operations:

| RVM Decision | Ruflo Action |
|-------------|-------------|
| `NoAction` | Continue current topology |
| `SplitRecommended(partition, cut)` | Split swarm at cut boundary, spawn new coordinator |
| `MergeRecommended(p1, p2)` | Merge underutilized agents into one partition |

## Patterns

### Phase 1 — Quick Wins (S, 1-2 weeks)

#### Pattern 2: Prompt Cache Stability

**Problem**: Ruflo registers 314 MCP tools from 29 files. Import order determines registration order. If order drifts, Claude API prompt cache prefixes break.

**Solution**: Sort tool definitions lexicographically by `name` before registration. Add snapshot test.

**Scope**: S. **Files**: `v3/@claude-flow/cli/src/mcp-tools/index.ts`

#### Pattern 8: Strict Config Validation

**Problem**: MCP server silently falls back to defaults on invalid config.

**Solution**: Zod schema validation at startup. Refuse to start on invalid config with `doctor --fix` suggestion.

**Scope**: S. **Files**: `v3/@claude-flow/cli/src/config-adapter.ts`, `v3/@claude-flow/cli/src/mcp-server.ts`

---

### Phase 2 — Core Coordination with RVM (M-L, 3-6 weeks)

#### Pattern 1: Session Coordination Primitives

**Problem**: Inter-agent coordination requires polling AgentDB. No direct message-passing.

**Solution**: 3 new MCP tools:
- `session_send` — fire-and-forget or wait-for-reply message to a session
- `session_yield` — block current session, wait for reply
- `session_history` — read message log for any session

When running on RVM, these map directly to `CommEdge` IPC channels with coherence graph weighting. On non-RVM runtimes, backed by in-memory EventEmitter queues.

**Scope**: M. **Files**: `v3/@claude-flow/cli/src/mcp-tools/session-tools.ts`

#### Pattern 6: Unified Subagent Spawning (RVM + rvagent-wasm + native)

**Problem**: Agent spawning is fragmented across 3 mechanisms with no unified primitive.

**Solution**: `session_spawn` MCP tool with 5-tier runtime selection (see table above).

**RVM-specific capabilities**:
- Coherence domain creation with capability tokens (READ/WRITE/EXECUTE/PROVE)
- Witness-logged agent lifecycle (every spawn/terminate/migrate emits audit record)
- Automatic coherence-driven scheduling (cut_pressure → scheduler priority)
- Live partition split/merge driven by communication patterns
- GPU compute access (capability-gated, IOMMU-isolated)

**RVF-specific capabilities**:
- Agent state packaging to `.rvf` container
- Cross-tier migration (WASM → RVM, RVM → native)
- Checkpoint/restore for fault tolerance
- Deterministic state reconstruction from witness chain

```typescript
// Spawn agent in RVM coherence domain with GPU access
session_spawn({
  runtime: 'rvm',
  template: 'coder',
  instructions: 'Implement auth module',
  capabilities: ['READ', 'WRITE', 'EXECUTE'],
  gpu: { backend: 'metal', budget: { compute_ms: 1000 } },
  witness: true,  // emit audit records to AgentDB
})

// Spawn sandboxed WASM agent (no RVM required)
session_spawn({
  runtime: 'wasm',
  template: 'reviewer',
  workspace: { 'auth.ts': sourceCode },
})

// Migrate from WASM to RVM when workload increases
session_migrate({ sessionId: 'agent-123', to: 'rvm' })

// Export agent state as RVF for portability
session_export({ sessionId: 'agent-123', format: 'rvf' })
```

**Scope**: L. **Depends on**: Pattern 1 (session primitives).

**Files**: `v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`, `v3/@claude-flow/cli/src/ruvector/agent-wasm.ts`, new `v3/@claude-flow/cli/src/rvm/bridge.ts`

#### New Pattern: RVM Coherence Bridge

**Problem**: Ruflo's swarm topologies are static (`--topology hierarchical`). No runtime optimization based on actual agent communication patterns.

**Solution**: Bridge RVM's coherence engine to ruflo's swarm coordinator:

1. Compile `rvm-coherence` crate to WASM (supports `alloc` feature)
2. Run mincut analysis on agent communication graph each epoch
3. Surface `CoherenceDecision` as MCP tool: `coherence_analyze`
4. Auto-trigger swarm topology changes based on cut pressure

New MCP tools:
- `coherence_analyze` — run mincut on current agent communication graph
- `coherence_score` — get per-agent coherence scores
- `coherence_suggest` — get split/merge recommendations

**Scope**: M. **Files**: new `v3/@claude-flow/cli/src/rvm/coherence-bridge.ts`

---

### Phase 3 — Plugin Infrastructure (M, 2-3 weeks)

#### Pattern 3: Plugin Boundary Enforcement

**Problem**: Plugins can import any internal module. No SDK boundary.

**Solution**: Create `@claude-flow/plugin-sdk` with narrow public API. Add ESLint rule + invariant test.

**Scope**: M. **Files**: new `v3/@claude-flow/plugin-sdk/`

#### Pattern 9: Skills Marketplace

**Problem**: 90+ skills are local SKILL.md files only. No remote sharing.

**Solution**: Extend IPFS plugin registry to index skills. Add `skills search/publish/install` CLI commands.

**Scope**: M. **Depends on**: Pattern 3.

---

### Phase 4 — Gateway Architecture (L, 4-8 weeks)

#### Pattern 4: Gateway Control Plane

**Problem**: MCP server is single-client.

**Solution**: Evolve MCP server into a Gateway accepting multiple concurrent connections. Feature-flagged behind `--gateway` mode.

**RVM integration**: Gateway dispatches agent workloads to RVM coherence domains. RVM partitions connect back to Gateway for MCP tool access. Witness records flow through Gateway to AgentDB.

**Scope**: L. **Depends on**: Pattern 3.

#### Pattern 5: Channel Adapters

**Problem**: Agents only reachable via CLI/MCP.

**Solution**: Channel adapter abstraction for Slack/Discord/Telegram. Each adapter is a plugin.

**Scope**: L. **Depends on**: Pattern 4.

---

### Deferred

#### Pattern 7: ACP (Agent Client Protocol)

**Why defer**: Protocol still emerging. Current dual-mode works. Revisit when ACP stabilizes. RVM's `HostContext` trait may serve as the low-level equivalent.

### Not Adopting

#### Pattern 10: Companion Apps

**Why not**: Gateway enables community-built clients. RVM's Cognitum Seed hardware targets cover the edge case.

## RVM Integration Roadmap

### Short Term (Phase 2)

Compile select RVM crates to WASM for in-process use within ruflo's Node.js runtime:

| Crate | WASM Target | Purpose |
|-------|-------------|---------|
| `rvm-coherence` | `wasm32-unknown-unknown` | MinCut analysis for swarm topology optimization |
| `rvm-witness` | `wasm32-unknown-unknown` | Hash-chained audit records → AgentDB bridge |
| `rvm-cap` | `wasm32-unknown-unknown` | Capability tokens for agent authorization |

### Medium Term (Phase 4)

RVM runs as a sidecar process. Ruflo Gateway dispatches to RVM via IPC:

```
Ruflo Gateway (Node.js) ←── IPC/Unix Socket ──→ RVM Kernel (Rust binary)
     │                                                │
     ├── MCP tools                                    ├── Coherence domains
     ├── AgentDB                                      ├── WASM agents
     ├── Neural learning                              ├── GPU compute
     └── Swarm coordination                           └── Witness chain
```

### Long Term

RVM is the native execution substrate on Cognitum hardware (Seed/Appliance). Ruflo provides cloud-side orchestration. Agents packaged as `.rvf` containers deploy seamlessly across cloud (ruflo) and edge (RVM).

## RVF Container Role

| Layer | Without RVF | With RVF |
|-------|-------------|----------|
| **Packaging** | Ad-hoc JSON state export | Standardized binary container with checksum |
| **Migration** | Manual recreate agent | Load `.rvf` on any tier (WASM/RVM/native) |
| **Checkpointing** | AgentDB snapshot | Deterministic state + witness chain |
| **Distribution** | npm packages only | IPFS-distributed `.rvf` bundles |
| **Recovery** | Restart from scratch | Reconstruct from witness + compressed memory |

## Implementation Priority

```
Phase 1 ──── [S] Config Validation ──────── standalone
             [S] Cache Stability ─────────── standalone

Phase 2 ──── [M] Session Primitives ─────── standalone
             [M] Coherence Bridge (WASM) ── rvm-coherence crate
             [L] Subagent Spawn + RVM ────── depends on Phase 2.1 + rvm-wasm + rvf
             [M] Witness → AgentDB ────────── rvm-witness crate

Phase 3 ──── [M] Plugin SDK ──────────────── standalone
             [M] Skills Marketplace ────────  benefits from Phase 3.1

Phase 4 ──── [L] Gateway + RVM sidecar ──── benefits from Phase 3.1
             [L] Channel Adapters ──────────  depends on Phase 4.1
```

## Consequences

### Positive
- RVM provides hardware-level agent isolation with <6ns partition switching
- Coherence engine replaces static topology with communication-driven optimization
- Witness chain gives cryptographic audit trail bridged to AgentDB
- RVF enables portable agent packaging across cloud (ruflo) and edge (RVM/Cognitum)
- Session primitives replace memory-polling with direct message-passing
- GPU compute (6 backends) unlocked for embeddings, HNSW, neural training
- Plugin SDK boundary protects internals from plugin coupling

### Negative
- RVM is new (2026-04-04) — needs maturity validation
- WASM compilation of Rust crates adds build complexity
- RVM sidecar introduces IPC overhead vs. in-process execution
- Two runtimes (Node.js + Rust) increases operational complexity

### Neutral
- ACP deferred — RVM's `HostContext` may serve as low-level equivalent
- Companion apps rejected — Gateway + Cognitum Seed covers the edge case
- Existing rvagent-wasm (Tier 1) continues to work without RVM for lightweight tasks

## References

- [OpenClaw](https://github.com/openclaw/openclaw) — 350K stars, MIT, TypeScript
- [RVM](https://github.com/ruvnet/rvm) — Coherence-native microhypervisor, Rust
- [ADR-058](./ADR-058-rvf-appliance.md) — ruflo.rvf self-contained appliance
- [ADR-059](./ADR-059-rvagent-wasm-integration.md) — rvagent-wasm integration
- [ADR-070](./ADR-070-rvagent-wasm-completion.md) — rvagent-wasm completion
- [ADR-026](./ADR-026-three-tier-model-routing.md) — 3-tier model routing
- [AgentSkills spec](https://agentskills.io) — SKILL.md format
- [RVM ADR-140](https://github.com/ruvnet/rvm/blob/main/docs/adr/ADR-140-agent-runtime-adapter.md) — Agent runtime adapter
- [RVM ADR-141](https://github.com/ruvnet/rvm/blob/main/docs/adr/ADR-141-coherence-engine-integration.md) — Coherence engine
