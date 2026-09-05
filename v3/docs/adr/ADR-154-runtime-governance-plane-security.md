# ADR-154 — Runtime Governance Plane for Production Agent Execution

**Status**: Proposed  
**Date**: 2026-06-11  
**Authors**: claude (dream-cycle agent, 2026-06-11)  
**Related**: ADR-144 (Agent Authorization Propagation — complementary; ADR-144 is static, ADR-154 is dynamic runtime), ADR-146 (Tool Output Guardrail — covers output; ADR-154 covers capability grant at spawn), ADR-013 (Core Security Module), ADR-012 (MCP Security Features)

## Context

### Evidence

Two independent 2026 sources establish that production AI agent deployments require a runtime governance plane that Ruflo does not currently have:

1. **arXiv:2606.12320** (Tallam, June 10, 2026, Grade B — arXiv, reference implementation provided): proposes a five-plane runtime governance architecture for production AI agents. The five planes are: *identity* (who is the agent), *policy* (what is it permitted to do), *capability* (attenuated subset of tools/namespaces granted), *endpoint* (network/API surface), and *data* (information-flow controls). The policy engine adjudicates in single-digit microseconds and verifiably forecloses seven production agent threat classes in the reference implementation. Core insight: traditional security focuses on data boundaries; agentic systems require *action* boundaries enforced at runtime, not at design time.

2. **Microsoft Agent Governance Toolkit** (MIT-licensed, released April 2, 2026, Grade B — vendor announcement): open-source runtime governance toolkit shipping exactly this architecture — a stateless policy engine (YAML/OPA/Cedar rules), cryptographic agent identity via the Inter-Agent Trust Protocol, dynamic execution rings, and circuit breakers. Measured at <0.1ms p99 policy enforcement overhead. Framework-agnostic: provides native integrations for LangGraph, AutoGen, and CrewAI. This is the first production-grade open-source implementation of the runtime governance pattern.

**OWASP mapping:** OWASP Agentic Top 10 2026 (ASI01–ASI10, Grade A, 100+ contributors) identifies ASI03 (Agent Identity & Privilege Abuse) as a distinct risk class from ASI06 (Memory & Context Poisoning, addressed in dream #2303 / ADR-147) and ASI08 (Cascading Agent Failures). ASI03 is unaddressed in Ruflo.

### Current Ruflo State

Ruflo v3.6.10 ships:
- `@claude-flow/security`: `InputValidator` (Zod), `PathValidator`, `SafeExecutor`, `PasswordHasher`, `TokenGenerator` — boundary validation and static authorization
- `@claude-flow/guidance`: governance control plane package — scope and implementation are not specified in the codebase documentation reviewed
- ADR-144: agent authorization propagation at spawn time (static `AuthScope`)
- ADR-146: tool output guardrail (output-side; not spawn-side)

None of these components implement:
- A stateful runtime policy engine that evaluates agent actions *as they occur*
- Capability attenuation: restricting which tools/namespaces a spawned agent may invoke based on its declared role
- Composite principal evaluation: treating (agent identity + role + swarm context + delegation chain) as a first-class security principal
- Delegation scope binding: pinning the capability set at spawn time so it cannot drift during execution

This means a `researcher` agent spawned in a swarm has the same tool access as a `security-auditor` agent by default — there is no enforcement of the role's declared capability boundary.

## Decision

Add a `RuntimeGovernancePlane` to `@claude-flow/guidance` implementing:

### 1. `CompositeAgentPrincipal` (identity layer)

A typed record combining `{ agentId, swarmId, roleType, delegationDepth, parentAgentId, spawnTimestamp }`. This extends ADR-144's `AuthScope.delegationDepth` with full principal identity. Stored in AgentDB at spawn under `governance:principals:<agentId>`.

### 2. `AttenuatedCapabilitySet` (capability layer)

A per-role declaration of permitted tool names and memory namespaces. Defined in role configuration (extends existing agent YAML frontmatter `tools:` field). At spawn, the swarm coordinator intersects the agent's declared tools with the parent's capability set — a child can only receive a strict subset of the parent's capabilities (monotone attenuation).

Default attenuation map (additive to existing behavior — nothing removed unless explicitly declared):

| Role | Permitted tools (additions to base Read/Grep/Glob) | Memory namespaces |
|------|--------------------------------------------------|------------------|
| orchestrator | Task, Bash, Write, Edit | all |
| coder | Bash, Write, Edit, MultiEdit | collaboration, patterns |
| tester | Bash, Write | collaboration |
| reviewer | (read-only) | collaboration, patterns |
| security-auditor | Bash, Grep | security, collaboration |
| researcher | WebFetch, WebSearch | research, collaboration |

### 3. `PolicyEngine` (policy layer)

A stateful evaluator called at two points:
- **At spawn:** validates that requested agent type + capability set is authorized by the parent principal's `AttenuatedCapabilitySet`. Returns `PolicyDecision { allow: boolean; reason: string; attestation: string }`.
- **Per tool call (optional, gated by `CLAUDE_FLOW_RUNTIME_POLICY=strict`):** checks tool name against agent's `AttenuatedCapabilitySet` before execution. Default mode: log-only (non-blocking). Strict mode: block + return `CAPABILITY_VIOLATION` error.

Target latency: <0.1ms p99 for spawn-time check (matching Microsoft AGT); <10µs for per-call check (matching arXiv:2606.12320 reference).

### 4. Integration points

- `swarm_init` MCP tool: initializes `RuntimeGovernancePlane` for the swarm session, registers the lead agent as the root principal
- `Task` tool pre-execution hook (`pre-task`): validates spawn request through `PolicyEngine`
- `SendMessage` dispatch: optionally verifies sender's principal before forwarding (ASI03 guard, ~40 LOC)

### Evaluate Microsoft AGT adoption

Before implementing from scratch, evaluate whether `@agent-os/policy-engine` from Microsoft AGT can serve as the `PolicyEngine` backend. AGT is MIT-licensed, framework-agnostic, and measured at <0.1ms p99. If the API surface is compatible with Ruflo's `@claude-flow/guidance` interface, adoption saves ~100 LOC and provides a tested production implementation.

## Alternatives Considered

**Extend ADR-144 (static authorization) with dynamic checks.** ADR-144 propagates `AuthScope` at spawn but does not evaluate actions at runtime. The propagation model is correct; adding runtime evaluation requires the `PolicyEngine` concept. These are complementary, not alternatives.

**Use ADR-146's tool output guardrail for capability enforcement.** ADR-146 validates tool *outputs* for goal hijacking. Capability attenuation restricts tool *invocation*. Different control points; both are needed.

**Sandbox isolation (gVisor/Docker) per agent.** Process-level sandboxing is complementary but heavier. The `AttenuatedCapabilitySet` operates at the application layer; sandboxing operates at the OS layer. Not exclusive; start with application-layer attenuation given the <0.1ms target.

**Adopt Microsoft AGT as the entire governance implementation.** Possible, but introduces a new external dependency. Preferred path: extract the `PolicyEngine` interface from Ruflo's `@claude-flow/guidance` and inject AGT's implementation as an optional backend, keeping the interface owned by Ruflo.

## Consequences

**Positive:**
- Directly addresses OWASP ASI03 (Agent Identity & Privilege Abuse) — the only ASI Top 10 entry not yet covered by a Ruflo ADR
- Monotone capability attenuation prevents privilege escalation via spawning — a spawned child can never exceed its parent's capability set
- Optional <10µs per-call enforcement creates the foundation for a behavioral audit trail
- Positions Ruflo alongside Microsoft AGT as a framework with production runtime governance — currently neither LangGraph, AutoGen, nor CrewAI implement this

**Negative:**
- Spawn-time `PolicyEngine` check adds ~0.1ms to agent spawn latency (acceptable; spawn is infrequent relative to task execution)
- Requires updating agent YAML frontmatter for all role types to declare `AttenuatedCapabilitySet` — one-time migration, tooling can auto-generate defaults from existing `tools:` fields
- If strict per-call mode is enabled, any role misconfiguration blocks legitimate tool use — requires a validation pass before enabling strict mode in production

**Implementation estimate:** ~150 LOC in `v3/@claude-flow/guidance/src/` (principal, capability, policy-engine interfaces + default attenuation map) + ~40 LOC in coordinator integration (swarm_init + pre-task hook) = ~190 LOC total. No new external dependencies if building in-house; one dependency (`@agent-os/policy-engine`) if adopting AGT backend.

## Validation

- Unit: `PolicyEngine.evaluate(principal, toolName)` — allow/deny per attenuation map; verify monotone attenuation (child subset of parent)
- Integration: spawn a `coder` agent from an orchestrator; assert `coder` cannot invoke `Task`; assert `orchestrator` can
- Benchmark: spawn-time check P99 ≤ 0.1ms; per-call check P99 ≤ 10µs (measured via `scripts/benchmark-intelligence.mjs` governance suite)
- ASI03 smoke: attempt to impersonate a `security-auditor` principal from a `tester` context; expect `PolicyDecision { allow: false }`
