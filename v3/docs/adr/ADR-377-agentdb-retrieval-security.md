# ADR-377: AgentDB Retrieval Security Layer

**ID**: ADR-377  
**Status**: Proposed  
**Date**: 2026-07-01  
**Authors**: claude (dream-cycle agent, 2026-07-01)  
**Branch**: dream/2026-07-01-security  
**Related ADRs**:
- ADR-006 (Unified Memory Service)
- ADR-131 (ToolOutputGuardrail — ASI01 content-boundary screening)
- ADR-144 (AgentAuthorizationPropagator — per-action scope checks)
- ADR-145 (PluginIntegrityVerifier — Ed25519 plugin signing)
- ADR-165 (Security CVE Posture Review)

---

## Context

Six 2026 Grade A arXiv papers establish that AgentDB's read and write paths are high-confidence attack surfaces with no certified defenses:

- **SMSR** (arXiv:2606.12703, Jun 2026): First certified defense for multi-session RAG agents; without it, poisoning ASR is 93–100% across all unsigned memory variants. SMSR reduces to 0%.
- **Forensic Trajectory Signatures** (arXiv:2606.30566, Jun 2026): Behavioral forensics on agent write sequences achieves AUC=0.9904 overall and AUC=1.000 on 6/9 cross-model hold-out splits, generalizing across frontier models without retraining.
- **Indirect Prompt Injection in the Wild** (arXiv:2601.07072, Jan 2026): Attacker-controlled content decomposes into retrieval-guaranteed fragments; near-100% retrieval success across 11 benchmarks — meaning any poisoned AgentDB entry has near-certain retrieval into context.
- **Capability Gates Are Not Authorization** (arXiv:2606.28679, Jun 2026): All three major frameworks (LangChain, LlamaIndex, Stripe Agent Toolkit) conflate tool exposure with authorization; no fail-closed per-call gate exists. Ruflo's `SafeExecutor` has the same structural gap.
- **MCP Caller Identity Confusion** (arXiv:2603.07473, Mar 2026): MCP servers carry no caller authentication; authorization state persists across callers without re-verification.
- **HCP MCP Runtime** (arXiv:2606.29073, Jun 2026): A Hardened Capability Protocol (HCP) blocks all 10/10 tested attack cases; naive baseline fails all 10/10.

**OWASP LLM Top 10 (2025)** added two directly relevant categories:
- **LLM07**: System Prompt Leakage — no guardrail in Ruflo on prompt exfiltration via tool outputs
- **LLM08**: Vector and Embedding Weaknesses — no retrieval-layer injection filter in AgentDB

ADR-165 (June 2026) closed CVE-1–5 at the input validation and plugin signing layers. It does not address the retrieval path, the write-path authenticity problem, or MCP caller identity.

All four major competitors (LangGraph, AutoGen, CrewAI, OpenAI Swarm) share these gaps as of July 2026. Ruflo is uniquely positioned to lead with an extensible `post-retrieve`/`pre-context-inject` hook pair — but these hooks do not yet exist.

---

## Decision

Implement the **AgentDB Retrieval Security Layer** across three phases:

### Phase 1 — `AgentDbRetrievalGuard` (retrieval path, 2 sprint estimate)

Add a guard at the HNSW top-K retrieval boundary before chunks are injected into agent context:

```typescript
// v3/@claude-flow/memory/src/agentdb/retrieval-guard.ts
export interface RetrievalGuardConfig {
  maxPayloadBytes: number;       // default: 8192 — hard cap per chunk
  injectionPatterns: RegExp[];   // compiled from OWASP LLM01 pattern set
  semanticBoundaryCheck: boolean; // default: true — checks for instruction override tokens
  blockOnSuspicion: boolean;     // default: true in prod, false in test
}

export class AgentDbRetrievalGuard {
  async filter(chunks: MemoryChunk[]): Promise<FilteredChunks> {
    // 1. Size gate — reject oversized chunks (injection padding mitigation)
    // 2. Pattern scan — OWASP LLM01/LLM08 pattern set
    // 3. Semantic boundary check — detect role/instruction override patterns
    // 4. Log all rejections to audit trail
  }
}
```

Insert between `HnswIndex.query()` and context assembly in `AgentDbClient.retrieve()`. Expose via:
```bash
CLAUDE_FLOW_RETRIEVAL_GUARD=true   # default: false (off until benchmarked)
CLAUDE_FLOW_RETRIEVAL_GUARD_STRICT=false  # set true for prod deployments
```

### Phase 2 — `MemoryPoisonForensics` background worker (write path, 3 sprint estimate)

Add a 13th background worker (priority: `critical`, after `audit`) that monitors AgentDB write sequences for anomalous behavioral trajectories:

```typescript
// v3/@claude-flow/hooks/src/workers/memory-poison-forensics.ts
export class MemoryPoisonForensicsWorker implements BackgroundWorker {
  name = 'memory-poison-forensics';
  priority = 'critical';

  async run(context: WorkerContext): Promise<void> {
    // 1. Collect write-sequence features: timing delta, namespace, agent_id, content_hash_delta
    // 2. Compute trust-change score vs rolling 50-write baseline
    // 3. Flag anomalies at 2σ threshold
    // 4. Emit alert to hooks.notify() channel; quarantine flagged writes if STRICT mode
  }
}
```

Target metric: match arXiv:2606.30566 AUC=0.9904 on an internal eval set of 100 synthetic poisoning trajectories before enabling by default.

### Phase 3 — MCP Caller-Identity Binding (tool dispatch, 1 sprint estimate)

Extend `SafeExecutor` with invocation-bound capability tokens following the AIP pattern (arXiv:2603.24775):

```typescript
// v3/@claude-flow/security/src/mcp-caller-identity.ts
export interface InvocationToken {
  callerId: string;          // agent_id of the caller
  toolName: string;          // bound at creation — cannot be reused for different tool
  issuedAt: number;          // Unix ms
  expiresAt: number;         // issuedAt + 30_000 (30s TTL)
  nonce: string;             // crypto.randomBytes(16).toString('hex')
  signature: string;         // Ed25519 signature over {callerId, toolName, issuedAt, nonce}
}
```

`SafeExecutor.execute()` rejects calls missing a valid `InvocationToken`. Default: gated behind `CLAUDE_FLOW_MCP_CALLER_AUTH=false` until key distribution is solved in a follow-on ADR.

---

## Consequences

### Positive
- Reduces retrieval-layer ASR from ~100% (current) toward SMSR's 0% certified bound
- Adds the first behavioral anomaly detector in AgentDB (AUC=0.9904 is the target)
- Closes OWASP LLM07 + LLM08 gaps not addressed by ADR-165
- Positions Ruflo ahead of LangGraph, AutoGen, CrewAI, and OpenAI Swarm on retrieval security

### Negative / Trade-offs
- `AgentDbRetrievalGuard` adds ~2ms latency per retrieval call (estimated; must benchmark)
- `MemoryPoisonForensics` requires the 13th background worker slot (currently 12 workers)
- Phase 3 MCP caller-identity tokens require key distribution infrastructure (see Phase 3 caveat)

### Neutral
- All three phases are gated behind feature flags; default behavior unchanged until benchmarked
- No breaking changes to existing AgentDB API surface

---

## Implementation Plan

| Phase | File(s) | Sprint | Feature Flag |
|-------|---------|--------|--------------|
| 1 | `v3/@claude-flow/memory/src/agentdb/retrieval-guard.ts` | 1–2 | `CLAUDE_FLOW_RETRIEVAL_GUARD` |
| 2 | `v3/@claude-flow/hooks/src/workers/memory-poison-forensics.ts` | 3–5 | `CLAUDE_FLOW_POISON_FORENSICS` |
| 3 | `v3/@claude-flow/security/src/mcp-caller-identity.ts` | 6 | `CLAUDE_FLOW_MCP_CALLER_AUTH` |

Benchmark gate before each phase ships to `main`: reproduce the respective Grade A paper metric on an internal eval set (SMSR 0% ASR, AUC≥0.99, 10/10 blocks).

---

## References

- arXiv:2606.12703 — SMSR: Certified Defense Against Multi-Session RAG Poisoning
- arXiv:2606.30566 — Forensic Trajectory Signatures for Agent Memory Poisoning Detection
- arXiv:2606.26793 — MIRROR: MCTS Red-Teaming for Agentic RAG (ART-SafeBench)
- arXiv:2606.28679 — Capability Gates Are Not Authorization
- arXiv:2606.29073 — Benchmarking Security Invariants in MCP-Style Agent Runtimes
- arXiv:2603.07473 — Caller Identity Confusion in MCP
- arXiv:2601.07072 — Indirect Prompt Injection in the Wild
- arXiv:2603.24775 — AIP: Agent Identity Protocol
- OWASP LLM Top 10 2025 (LLM07, LLM08)
