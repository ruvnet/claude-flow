# ADR-146 — ToolOutputGuardrail Integration Rollout (ADR-131 P2–P5)

**Status**: Proposed
**Date**: 2026-06-02
**Issue**: [ruvnet/ruflo#2149](https://github.com/ruvnet/ruflo/issues/2149) (follow-up — original ADR-131 closed P1 only)
**Related**: ADR-131 (ToolOutputGuardrail — P1 shipped), ADR-144 (Authorization Propagation), ADR-145 (Plugin Supply-Chain Integrity)

## Context

ADR-131 shipped Phase 1 only: the `ToolOutputGuardrail` class is exported from `@claude-flow/security`, has tests and OWASP mapping docs, and is callable. It is not yet wired into a single hot path. The phased plan in ADR-131 §Integration Plan named four more phases (P2–P5) that close the actual ASI01 gap by running the guardrail at every place content crosses the agent boundary. None have shipped.

A status-quo system with the class but no call sites is worse than not having the ADR at all — it implies coverage we don't have. Issue #2149 was filed against the ASI01 gap and was left open because P1 shipped without P2–P5; closing it requires running the guardrail at the four content-entry boundaries it was designed for.

### What still leaks today

| Content path | Bypasses guardrail? | Attack surface |
|---|---|---|
| MCP tool result → agent context | **Yes** — no call site in dispatcher | Any compromised MCP server response (40.55% unauthenticated per ADR-144 evidence) |
| Memory read (`memory_search`, `memory_retrieve`) → agent context | **Yes** — no call site in retrieve path | Memory-poisoning chains (MINJA / Plan Injection per ADR-145 evidence) |
| Raft consensus state-transition payload → swarm | **Yes** — no call site in proposal pipeline | SwarmRaft-class injection (covered as "swarm-layer ASI01" in #2149) |
| Hooks tool output (third-party plugins) | **Yes** — no policy plumbing | Any plugin tool that doesn't run its own screen |

P1's class works in isolation but nothing in the runtime calls it. The shape of the gap is identical whether the attack vector is an indirect-injection paper from January or a brand-new one — boundaries with no screening are boundaries with no defence.

### Why a follow-up ADR (instead of just opening four PRs)

P2–P5 collectively add a new policy layer to four independent hot paths. Each path needs a per-boundary decision on `flag` / `redact` / `reject` defaults, an observability contract for the resulting telemetry, and a backwards-compatibility story (the swarm-layer integration in particular cannot break consensus). Those decisions are architectural enough that they should be recorded once, here, instead of relitigated in each PR review.

This ADR is also the right place to record the design coupling with ADR-144 (provenance log consumes guardrail findings) and ADR-145 (write-ACL denial events feed the same telemetry sink as guardrail rejections), so the three security ADRs read as one coherent picture rather than three disconnected layers.

## Decision

Roll out the four remaining ADR-131 phases as a single coordinated effort, with shared defaults and a shared telemetry sink.

### P2 — MCP tool result boundary

**Where**: `v3/@claude-flow/cli/src/mcp-tools/dispatch.ts` (the single chokepoint every tool result flows through).

**Shape**:
```ts
const { content, result, action } = guardrail.scanAndEnforce(rawToolResult);
if (action === 'reject') return { error: { code: 'GUARDRAIL_REJECT', category: result.category, ... } };
if (action === 'redact') rawToolResult = content;
recordTelemetry({ phase: 'P2-mcp-tool', toolName, action, ...result });
return rawToolResult;
```

**Policy defaults**: `low → allow`, `medium → flag (log only)`, `high → redact`, `critical → reject`. Rejection surfaces to the calling agent as a typed tool error — never silently drops to empty content (this rule was in ADR-131 P1 but is restated here so callers can rely on it).

### P3 — Memory read path

**Where**: `v3/@claude-flow/cli/src/memory/memory-bridge.ts` (every `bridgeRetrieve` / `bridgeSearch` return).

**Shape**: Same `scanAndEnforce` call applied to each result's content field. Per-namespace policy overrides supported via `memory.guardrail.<namespace>.<severity>` in `claude-flow.config.json` (e.g., a sandbox namespace might `allow` content that production would `redact`).

A reject finding here returns the entry with `content: <removed-by-guardrail>` and a structured warning rather than excluding the entry entirely — the caller needs to know the entry exists to track namespace state.

### P4 — Raft consensus payload validator

**Where**: hive-mind proposal pipeline (`v3/@claude-flow/cli/src/hive-mind/*` — exact file pinned during P4 PR).

**Constraint**: Raft must not deadlock on a rejected payload. If a proposal triggers a `reject`, the proposer's commit step substitutes a `proposalRejected` no-op with the same term/index, so the log advances and other nodes don't time out waiting for the original. The original proposal hash is recorded in the rejection telemetry for post-incident analysis.

P4 is the highest-risk phase. It ships behind `CLAUDE_FLOW_STRICT_CONSENSUS_GUARDRAIL=true` (default off) until at least two weeks of P2/P3 production telemetry are available to tune the swarm-layer pattern set.

### P5 — Per-tool policy overrides + structured telemetry

**Where**: `v3/@claude-flow/cli/src/hooks/*` for policy resolution; new `v3/@claude-flow/security/src/telemetry/guardrail-events.ts` for the sink.

Telemetry contract (consumed by ADR-144's provenance log and ADR-145's verification log):

```ts
interface GuardrailEvent {
  phase: 'P2-mcp-tool' | 'P3-memory-read' | 'P4-consensus' | 'P5-hook-policy';
  source: { kind: 'tool' | 'namespace' | 'proposal' | 'plugin'; id: string };
  result: GuardrailResult;          // { severity, category, pattern, ... } — exact shape from ADR-131
  action: 'allow' | 'flag' | 'redact' | 'reject';
  agentId?: string;                 // who was about to consume the content
  scopeId?: string;                 // current AuthScope id from ADR-144
  ts: number;                       // unix ms
}
```

This is the **only** event shape security telemetry will ship in. ADR-144's `recordAction` and ADR-145's `MemoryWriteDenied` reuse it (different `phase` discriminator).

## Alternatives considered

**Open four independent PRs.** This is the do-nothing-architecturally option. It leaves the per-boundary policy defaults and the telemetry shape to be decided in PR review, which historically diverges (different reviewer, different defaults). The four phases must share a single policy contract; an ADR is the cheapest way to enforce that.

**Ship P2 first, defer P3–P5 indefinitely.** P2 alone closes ~60% of the ASI01 attack surface (MCP tool results are the most common content boundary). But MINJA / Plan Injection specifically target the memory read path P2 doesn't cover; partial rollout misadvertises coverage.

**Replace P4 with a separate consensus-layer ADR.** Defensible — the consensus interaction is the highest-complexity phase — but creates a four-ADR situation for what is fundamentally one rollout. The split makes more sense if a P4-specific design problem surfaces during P3 telemetry analysis; the current decision is to keep it under ADR-146 unless that happens.

## Consequences

**Positive**:
- Closes the `#2149` open issue with a concrete rollout plan whose acceptance criteria are testable per-phase.
- Three security ADRs (131 / 144 / 145) finally share one telemetry shape, so the security dashboard can render them as one picture.
- Per-namespace policy overrides (P3 and P5) let security-sensitive deployments tighten without affecting low-risk ones.

**Negative / risks**:
- P4's consensus interaction is intricate; getting the rejected-payload substitution wrong stalls the cluster. Phased rollout with a strict-mode env var (default off) is mandatory.
- Each phase adds latency. ADR-131 P1's class is pattern-based and sub-millisecond; the new call sites should preserve that, but P3's read path executes on every memory hit — needs to be benchmarked at the same time the call is added, not after the fact.
- More events on the security telemetry channel — needs a sampling story for high-volume deployments. Default sampling rate at P5: `flag` 10%, `redact`/`reject` 100%.

**Deferred**:
- Model-based classifier as an out-of-band reviewer (mentioned but deferred in ADR-131) — same deferral here. Pattern-based remains the only thing on the hot path.
- Non-English pattern sets — community contribution pathway; not blocking P2–P5.

## Validation

P2 lands with:
- Smoke test: a known indirect-injection payload returned from a mock MCP server is rejected, the agent sees a typed error, no content reaches reasoning.
- Benchmark: P2's added latency at p99 < 0.5 ms over a 10k-call run.

P3 lands with:
- Smoke test: a poisoned memory entry is `redacted` on read, the caller sees the structured warning, the namespace counter is unaffected.
- Per-namespace override tested with one `allow`-overridden namespace and one default namespace in the same call.

P4 lands with:
- Chaos test: 100 proposals, 10% triggering `reject`. Cluster must reach consensus on all 100 within the same wall-clock budget as a no-reject baseline (proposalRejected no-op substitution working).
- Strict mode initially `false`; flipped to default after two weeks of stable P2/P3 telemetry.

P5 lands with:
- `GuardrailEvent` schema validation tests, plus a `replay` script that consumes telemetry from a captured incident and reconstructs the rejected/redacted state.
- The security dashboard renders all three ADR feeds (131/144/145) from this single sink.

Closing `#2149` happens at the end of P5, not at the end of P2.
