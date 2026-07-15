# ADR-321 — HMAC-Sealed Collaboration Memory Namespace

**Status**: Proposed
**Date**: 2026-07-15
**Issue**: [ruvnet/ruflo#2630](https://github.com/ruvnet/ruflo/issues/2630)
**Related**: ADR-145 (Plugin Supply-Chain Integrity and Memory Namespace Governance — write ACLs), ADR-178 (Verifiable Memory Governance — provenance/version/write-hash fields), ADR-320 (Plugin Publish Scanner and Runtime Manifest Enforcement)

## Context

ADR-145 Part B added **write authorization** to AgentDB namespaces: an agent needs an explicit `writeNamespaces` grant before it can write to a namespace at all. ADR-178 separately proposed **Verifiable Memory Governance (VMG)** metadata — `provenance`, `version`, `policy_tag`, `write_hash`, `parent_hash` — attached to every AgentDB write. Both are necessary but neither is sufficient against the specific attack the 2026 dream-cycle research run (issue #2630) surfaces:

**ClawWorm** (arXiv:2603.15727, Grade A): a supply-chain-compromised skill self-propagates by writing crafted content into shared agent-memory channels that *other* agents subsequently read and act on, causing them to propagate the same payload further. Measured **64.5% aggregate attack success rate across 40,000+ instances**. The mechanism ClawWorm exploits is specifically that a write, once authorized (ADR-145 Part B) and recorded (ADR-178's `write_hash`), is still **trusted at read time by every other agent sharing the namespace** with no cheap way to verify in-band that the content read back is exactly what a legitimately-authorized agent wrote and that it has not been altered or spoofed between write and read.

`write_hash` (ADR-178) is a content hash, not a cryptographic seal: it detects accidental corruption but does not prove *who* produced the content, because computing a SHA-256 of content requires no secret — any process with write access (including a compromised plugin that passed ADR-145's authorization check) can compute a valid-looking hash over attacker-controlled content. ADR-145 Part B's ACL proves the writer *was allowed to write*, not that the write's *content* is what the ACL-holder actually intended, and it does nothing for a compromised-but-authorized agent (exactly ClawWorm's threat model — the propagating agent is a legitimately loaded skill, not an unauthorized intruder).

### Why this is a distinct architectural layer from ADR-145 Part B and ADR-178

| Layer | ADR | Question it answers |
|---|---|---|
| Write authorization | ADR-145 Part B | "Is this agent allowed to write to this namespace at all?" |
| Content provenance metadata | ADR-178 | "What is the audit trail and rollback history for this write?" |
| Tamper-evident sealing (this ADR) | **ADR-321** | "Can any reader cryptographically verify, without re-deriving trust from the writer's own claims, that this content has not been altered or spoofed since a specific authorized agent sealed it — and detect propagation chains that reuse or replay a prior seal?" |

ADR-145 Part B and ADR-178 are both necessary preconditions for this ADR (a seal is only meaningful if the sealing key is only available to an authorized, provenance-tracked writer) but neither closes the gap: authorization and hashing are checked at write time; ClawWorm's propagation is a *read-time* trust failure across agents that never re-verify what they're consuming.

## Decision

Add HMAC-based tamper-evident sealing to every write into the shared `collaboration` namespace (and any other namespace marked `sealed: true` in its ADR-145 Part B grant), enforced in the `post-edit` hook path where cross-agent memory writes are already intercepted.

### `SealedMemoryWriter`

**File**: `v3/@claude-flow/memory/src/namespaces/sealed-writer.ts` (new)

```typescript
interface SealedEnvelope {
  content: unknown;
  seal: string;            // HMAC-SHA256 over (content + writerId + namespace + writeHash from ADR-178)
  writerId: string;         // matches the ADR-145 Part B authorized writer
  sealedAt: number;         // unix ms
  keyEpoch: number;         // which namespace signing key produced this seal
}

class SealedMemoryWriter {
  // Called from the post-edit hook before a write reaches AgentDB.
  // Requires the caller to already hold an ADR-145 Part B write grant for `namespace`.
  seal(content: unknown, writerId: string, namespace: string): SealedEnvelope;

  // Called on every read from a sealed namespace, before content enters agent reasoning.
  // Returns the content only if the seal verifies; otherwise raises TamperDetected
  // and the read is surfaced as rejected (never silently dropped — same rule as
  // ADR-131's guardrail and ADR-144's UNAUTHENTICATED_MCP_SERVER handling).
  verify(envelope: SealedEnvelope, namespace: string): { valid: boolean; content?: unknown };
}
```

**Key management**: each namespace marked `sealed: true` gets a dedicated HMAC key, generated at namespace-creation time and rotated on a `keyEpoch` counter (not per-write — per-write rotation would defeat verification of historical entries). Keys are held server-side by the AgentDB process itself, never distributed to individual agents; agents call `seal()`/`verify()` through the memory service, they do not hold the key material. This is the load-bearing property against ClawWorm: a compromised *plugin* (which ADR-320 Part B may still let load, since static/behavioral scanning has a false-negative rate) cannot forge a valid seal even though it holds a legitimate ADR-145 Part B write grant, because the grant authorizes *calling* `seal()`, not *computing* one independently.

**Propagation-chain detection**: `verify()` additionally checks whether the same `content` hash (from ADR-178's `write_hash`) has been re-sealed under a *different* `writerId` within a configurable time window (`CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS`, default 5 minutes). A hit indicates exactly the ClawWorm propagation shape — content copied from one agent's write into another agent's write, which is how a worm hops namespaces or re-enters the same namespace after a partial cleanup — and is flagged for the same human-in-the-loop / block routing ADR-178's RepE hook already uses (`CLAUDE_FLOW_IPI_MODE`), reusing that control point rather than introducing a fourth escalation path.

### Integration with `post-edit` hook

**File**: `v3/@claude-flow/hooks/src/hooks/post-edit.ts` (existing — extend)

The `post-edit` hook already intercepts writes to shared namespaces (this is where ADR-145 Part B's ACL check runs). Add the seal step immediately after the ACL check passes and immediately before the ADR-178 VMG metadata is attached, so the seal covers the final write-hash:

```
write request → ADR-145 Part B ACL check → ADR-178 VMG metadata attach → ADR-321 seal() → AgentDB.store()
read request  → AgentDB.retrieve() → ADR-321 verify() → [reject on TamperDetected] → ADR-131 content guardrail → agent context
```

Sealing runs only for namespaces flagged `sealed: true`; unsealed namespaces are unaffected, keeping this additive to ADR-145/178 rather than a breaking change to the memory API.

**Implementation targets**:
- `v3/@claude-flow/memory/src/namespaces/sealed-writer.ts` (new)
- `v3/@claude-flow/memory/src/namespaces/authorization.ts` (ADR-145 Part B) — add `sealed: boolean` to the namespace grant shape
- `v3/@claude-flow/hooks/src/hooks/post-edit.ts` — wire `seal()`/`verify()` into the existing write/read interception points
- `v3/@claude-flow/memory/src/agent-db.ts` — key storage/rotation for sealed namespaces

### Integration plan (phased — P1 is the first PR)

| Phase | Scope | Where |
|---|---|---|
| **P1** | `SealedMemoryWriter` skeleton, key generation/storage for the `collaboration` namespace only, `seal()`/`verify()` wired into `post-edit` in warn-only mode | `@claude-flow/memory/src/namespaces/`, `@claude-flow/hooks/src/hooks/post-edit.ts` |
| P2 | Replay/propagation-chain detection (`CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS`) | same files |
| P3 | Extend `sealed: true` opt-in to any namespace via ADR-145 Part B's grant shape | `@claude-flow/memory/src/namespaces/authorization.ts` |
| P4 | Key rotation policy + `keyEpoch` bump tooling | `@claude-flow/memory/src/agent-db.ts` |
| P5 | `CLAUDE_FLOW_STRICT_SEALING=true` (reject unsealed writes to sealed namespaces) becomes default in v4.0 | release docs + breaking-change ADR |

### Backwards compatibility

- Sealing is opt-in per namespace (`sealed: true` on the ADR-145 Part B grant); only `collaboration` is sealed in P1. All other namespaces are unaffected.
- `CLAUDE_FLOW_STRICT_SEALING` defaults to `false`: `TamperDetected` reads are logged and surfaced with a warning but not blocked, until the flag is set — the same warn-then-block rollout shape as ADR-145 and ADR-144.
- The env var is a documented escape hatch, registered in `audit-env-var-precedence.mjs` with rationale, per the standing requirement from ADR-144/145.
- Both strict modes (this ADR's and ADR-145/144's) become default together in v4.0.0.

## Alternatives considered

**Rely on ADR-178's `write_hash`/`parent_hash` chain alone.** Rejected: a content hash proves integrity against accidental corruption but requires no secret to compute, so it cannot distinguish a legitimate writer's content from attacker-controlled content produced by a compromised-but-authorized agent — exactly ClawWorm's threat model.

**Per-agent signing keys instead of per-namespace HMAC.** Considered: asymmetric per-agent signatures would let a verifier attribute a seal to a specific agent identity rather than just "some holder of a namespace grant." Deferred to a future ADR because it requires a key-distribution and revocation infrastructure (one keypair per agent instance, not per namespace) that doesn't yet exist in Ruflo; per-namespace HMAC is the minimum viable primitive that still defeats ClawWorm's core mechanism (a compromised plugin cannot forge seals even with a write grant) and can be upgraded to per-agent signing later without changing the `SealedEnvelope` shape (the `writerId` field is already there for this purpose).

**Extend ADR-145 Part B's ACL enforcement to also check content signatures.** Rejected as a location: ADR-145 Part B's authorization check answers "is this write allowed," a yes/no gate independent of content. Folding cryptographic sealing into the same module conflates authorization policy with content integrity mechanism — this ADR keeps them as separate, composable stages in the same pipeline (see integration diagram above), matching the layered-ADR pattern already established by ADR-131/144/145/178.

## Consequences

**Positive**:
- Directly mitigates ClawWorm's measured **64.5% aggregate ASR** (arXiv:2603.15727) by making a forged or replayed write cryptographically detectable at read time, independent of whether the writer held a legitimate ADR-145 Part B grant.
- Composes cleanly with the existing three-ADR memory-governance stack (ADR-131 content guardrail, ADR-145 write ACL, ADR-178 VMG metadata) without modifying any of their APIs — purely additive.
- Propagation-chain detection (P2) gives the first concrete signal for "this content is spreading across writers," which none of ADR-131/145/178 individually detect (they each look at one write or one read in isolation).

**Negative / trade-offs**:
- HMAC seal/verify adds a cryptographic operation to every sealed-namespace write and read; expected to be sub-millisecond (HMAC-SHA256 is cheap) but must be benchmarked against the `<100ms` MCP response target in `v3/CLAUDE.md` before P1 ships.
- Centralizing HMAC keys in the AgentDB process makes that process a higher-value target; key compromise there defeats sealing for every namespace it protects — this is an accepted trade-off for P1 (per-namespace blast radius) versus the alternative of no verifiable sealing at all.
- Replay-window detection (P2) is a heuristic, not a proof: a sufficiently patient attacker operating outside `CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS` is not caught by this mechanism alone; it is a detection improvement, not a complete propagation-proof guarantee.

**Deferred**:
- Per-agent asymmetric signing (see Alternatives) — future ADR once agent-identity key distribution exists.
- Cross-instance / federated sealing for multi-host Ruflo deployments — out of scope until federation (`federation_bbs_*` tooling) has its own trust model ADR.

## Validation

P1 lands with:
- Unit tests: round-trip `seal()` → `verify()` succeeds; any single-byte mutation of sealed content fails verification; a seal computed under one `keyEpoch` fails verification after rotation to the next.
- Integration test: a write that passes ADR-145 Part B's ACL check but is sealed under a *different* namespace's key fails `verify()` — proves sealing is namespace-scoped, not just grant-scoped.
- Propagation test (P2 scope, written against a fixture in P1): the same content hash sealed under two different `writerId`s within the replay window is flagged; outside the window it is not (documents the heuristic's boundary explicitly rather than leaving it implicit).
- Benchmark: seal + verify overhead per operation, reported against the existing memory-write benchmark baseline referenced in `v3/CLAUDE.md`.

## References

- arXiv:2603.15727 — *ClawWorm: Supply-Chain-Compromised Skills and Self-Propagation via Shared Agent Memory* (64.5% aggregate ASR, 40,000+ instances)
- arXiv:2604.16548 — *A Survey on the Security of Long-Term Memory in LLM Agents: Toward Mnemonic Sovereignty* (governance primitives this ADR extends, shared reference with ADR-145 and ADR-178)
- ADR-145 — Plugin Supply-Chain Integrity and Memory Namespace Governance (write ACL precondition)
- ADR-178 — Verifiable Memory Governance and RepE-Based IPI Detection (VMG metadata precondition; `CLAUDE_FLOW_IPI_MODE` escalation path reused for propagation flags)
- OWASP GenAI Security Project, 2025 Top 10 for LLM Applications — Supply Chain (LLM03)
