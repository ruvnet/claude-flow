# ADR-369: Information-Bottleneck Vector-Quantized Inter-Agent Messaging

**Status:** Proposed
**Date:** 2026-07-19
**Authors:** claude (dream-cycle agent, 2026-07-19)
**Dream Cycle:** Slot 4 — swarm deep dive
**Source:** arXiv:2602.02035 (ICRA 2026), arXiv:2606.07557 (SPIN, 2026)

---

## Context

Ruflo's current swarm messaging layer transmits uncompressed text/JSON payloads between agents via `SendMessage`. At 8 agents (anti-drift default), this is tolerable. At 16–64 agents (the target range for tensor-train topology per SPIN, arXiv:2606.07557), uncompressed inter-agent communication becomes the primary bandwidth and latency bottleneck.

ICRA 2026 (arXiv:2602.02035) reports the first method to simultaneously improve task performance (+181.8%) and reduce inter-agent bandwidth (−41.4%) using information-bottleneck (IB) theory combined with vector quantization (VQ) on the inter-agent message channel. This breaks the historical performance-bandwidth tradeoff in multi-agent coordination.

No existing ADR (ADR-001 through ADR-319) covers inter-agent message compression. This is an architectural decision because it changes the serialization contract between all agents at the SendMessage boundary.

---

## Decision

Adopt IB+VQ compression as an optional (opt-in, then default) encoding layer for inter-agent messages in the ruflo swarm layer:

1. **Phase 1 (opt-in):** Add `--compress ib-vq` flag to `swarm init` and `SendMessage`. Messages are encoded via a learned codebook (VQ codebook size 256–1024). Codebook is shared at swarm init time and cached per session.
2. **Phase 2 (default on):** Enable IB+VQ by default for swarms with `maxAgents >= 8`. Maintain JSON fallback for single-agent sessions and `--no-compress` escape hatch.
3. **Benchmark gate:** Publish `swarm-messaging-bench` results before enabling Phase 2 default. Require ≥50% task improvement and ≥20% bandwidth reduction vs uncompressed baseline at 8 agents.

---

## Consequences

### Positive
- Breaks performance-bandwidth tradeoff (Grade A evidence, ICRA 2026)
- Unblocks scaling to 16–64 agents with SPIN tensor-train topology (ADR-322, TBD)
- Reduces egress cost for cloud-deployed swarms at scale
- Provides a differentiated capability vs LangGraph, AutoGen, CrewAI (none implement inter-agent message compression)

### Negative
- Codebook must be trained or shipped pre-trained (startup overhead)
- Adds encoding/decoding latency per message (must benchmark to confirm net positive)
- Breaking change for any external tooling that inspects raw SendMessage payloads
- Requires versioned message envelope to carry codec identifier

### Neutral
- JSON fallback preserves backward compatibility for `maxAgents < 8` sessions
- No change to the public SendMessage API surface — codec is transparent to callers

---

## Alternatives Considered

1. **Gzip compression only:** Reduces bandwidth but does not improve task performance (no information-bottleneck regularization). Rejected — misses the core gain.
2. **Protocol Buffers:** Structured encoding reduces size but still no IB regularization. May be combined with VQ in Phase 2 as the wire format.
3. **Do nothing:** Acceptable at 8 agents. Rejected for ≥16 agent targets — O(n^m) uncompressed messaging is untenable.

---

## References

- arXiv:2602.02035 — Bandwidth-Efficient Multi-Agent Communication via Information Bottleneck with Vector Quantization (ICRA 2026). Grade A.
- arXiv:2606.07557 — SPIN: Tensorized Policy Coordination for Decentralized Swarms. Grade A.
- arXiv:2606.19632 — Formal Verification of Learned Multi-Agent Communication Policies. Grade A. (Provides the formal-property verification framework to validate the codebook post-training.)
- Issue: to be filed as [Dream Cycle 2026-07-19]
