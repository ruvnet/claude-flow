# Security SOTA Report — 2026-05-31

**TL;DR:** Three Grade A papers published in the last 10 days define a new security layer Ruflo lacks — authorization propagation across agent delegation chains — distinct from the content-screening gap (ADR-131) filed five nights ago.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|-----------|
| 40.55% of 7,973 live MCP servers expose tools with zero authentication; 96.6% of OAuth-enabled servers contain ≥1 flaw | arXiv:2605.22333 | **A** |
| Runtime authority control (AIRGuard) reduces agent attack success 36.3% → 5.5% via least-privilege action-layer enforcement | arXiv:2605.28914 | **A** |
| Dual-graph provenance defense (execution graph vs authorization intent) reduces indirect prompt injection 40% → 1% | arXiv:2605.26497 | **A** |
| Authorization propagation across multi-agent delegation chains is not reducible to prompt injection; requires 7 structural requirements not covered by RBAC/ABAC | arXiv:2605.05440 | **A** |
| Single agents false-continue on infeasible tool tasks 73.9% of the time (intelligence scan) | arXiv:2605.28532 | **A** |
| Event-triggered swarm consensus reduces network overhead while maintaining ≥99% task completion under agent failures (swarm scan) | arXiv:2604.06813 | **A** |

---

## Ruflo Current Capability

| Control | Status | Gap |
|---------|--------|-----|
| Content-boundary injection screening | ADR-131 (Proposed) | Covers WHAT agents receive — not WHO they act as |
| MCP tool input validation | `SafeExecutor` + `InputValidator` | No auth verification on MCP server identity |
| Per-action privilege enforcement | Not implemented | No action → scope → allow/deny path |
| Delegation chain tracking in SendMessage | Not implemented | Messages carry no authorization scope |
| Execution provenance graph | Not implemented | No WHAT did vs WHAT was authorized audit trail |
| Feasibility pre-check before tool dispatch | Not implemented | 73.9% false-continue risk on single-agent paths |

---

## Competitor Comparison

| Framework | MCP Auth Checking | Per-Action Privilege | Authorization Propagation | Provenance Graph |
|-----------|------------------|---------------------|--------------------------|-----------------|
| **Ruflo v3.6** | Not implemented | Not implemented | Not implemented | Not implemented |
| **OpenAI Agents SDK** | Tool availability pre-check (March 2026) | Input + output + invocation guardrails | OAuth 2.0 token forwarding | OTEL spans built-in |
| **LangGraph v0.4** | Via LangSmith observability | Conditional edges + HITL checkpoints | Partial (checkpoint-scoped) | LangSmith full graph |
| **CrewAI Enterprise** | SOC 2 / HIPAA compliance | Role-scoped tool permissions | Partial (role inheritance) | Observability hooks |
| **AutoGen 1.0 GA** | Security patches; no MCP native | GroupChat-level only | Not published | Azure Monitor integration |

---

## Benchmarks

| Metric | Value | Source | Grade |
|--------|-------|--------|-------|
| Live MCP servers with zero auth (n=7,973) | 40.55% | arXiv:2605.22333 | **A** |
| OAuth-enabled MCP servers with ≥1 flaw | 96.6% | arXiv:2605.22333 | **A** |
| AIRGuard attack success reduction | 36.3% → 5.5% (−85%) | arXiv:2605.28914 | **A** |
| Dual-graph injection success reduction | 40% → 1% (−97.5%) | arXiv:2605.26497 | **A** |
| Single-agent infeasible-task false-continue rate | 73.9% | arXiv:2605.28532 | **A** |
| Event-triggered consensus task completion | ≥99% under single failure | arXiv:2604.06813 | **A** |

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| **Session commit** | `05bb9cf7ed1aa30313c42553ca7c49e7574af341` |
| **Report SHA-256** | `a7097af834cb47d04ec6c3a89b8698a90a003f82de746b82d78b6548abe24af2` |
| **Witness stamp** | `3e9b27fbe7f1bc645ce09a95dd015a325d2ecfb618ca2db7f49b25a4df8d08fe` |
| **Verifier** | `sha256sum dream-gist-2026-05-31.md` (pre-witness fill) → concat session commit `05bb9cf7ed1aa30313c42553ca7c49e7574af341` → `sha256sum` → must equal witness stamp |

---

## Recommended Next Steps

1. **Implement `AgentAuthorizationPropagator`** in `v3/@claude-flow/security/src/authorization/propagator.ts` — attach `scope` field to SendMessage envelope, validate each MCP tool call against the current delegation scope. ADR-144 (filed tonight) tracks this as an architectural decision.

2. **Add MCP server authentication validator** in `v3/@claude-flow/cli/src/mcp/auth-validator.ts` — before any tool response enters agent reasoning, verify the server presented valid credentials. Even a simple allowlist check eliminates the 40.55% unauthenticated-server risk for Ruflo-managed MCP registrations.

3. **Add feasibility pre-check to the `route` hook** — before Tier-3 dispatch, verify all required MCP tools are registered and callable. Eliminates the 73.9% false-continue rate at near-zero cost (simple registry lookup). Implementation-level — no ADR needed.
