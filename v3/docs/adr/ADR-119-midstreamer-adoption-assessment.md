# ADR-119 — `midstreamer` npm package: adoption assessment for ruflo & federation

**Status**: Accepted (2026-05-14) — **Decision: Wait. Partial adoption gated on specific upstream work.**
**Date**: 2026-05-14
**Authors**: claude (via `ruflo-goals:deep-researcher` investigation, drafted with rUv)
**Related**: ADR-097 (federation budget breaker) · ADR-104 (federation transport — WebSocket today + clean QUIC upgrade path) · ADR-108 (`agentic-flow` native QUIC binding plan) · ADR-111 (federation WireGuard mesh) · ADR-118 (`aidefence@2.3.0` — sibling package in `ruvnet/midstream`) · upstream [`ruvnet/midstream`](https://github.com/ruvnet/midstream) · npm [`midstreamer@0.2.5`](https://www.npmjs.com/package/midstreamer)
**Supersedes**: nothing
**Investigation:** deep-researcher session `a70c6ee07aeab17bf` (88k tokens, 34 tool uses, ~4 min)

## Context

`midstreamer` is an npm package from `ruvnet` (same author as ruflo and the AIMDS / `aidefence` line covered in ADR-118). The package name suggests it could provide pieces of two stated federation problems — **QUIC networking** (ADR-108) and **Tailscale-style mesh** (ADR-111) — plus a third theme the project keeps returning to: **in-flight agentics** (agent traffic flowing through inline gates). This ADR records what `midstreamer` actually provides, what it does not, and where (if anywhere) ruflo should pick it up.

The investigation was carried out by the `ruflo-goals:deep-researcher` agent. Evidence is graded inline: claims tied to file inspection, tarball contents, or `npm view` output are verified; anything else is marked inferred.

## What `midstreamer` actually provides

**Verified from**: `npm view midstreamer@0.2.5 --json`, `npm pack midstreamer && tar tzf`, the published `pkg-node/midstream_wasm.d.ts`, the upstream `npm-wasm/src/lib.rs`.

`midstreamer@0.2.5` is a **64 KB WASM blob** with three build targets (web / bundler / nodejs) — all containing the same binary. Single runtime dep: `@peculiar/webcrypto`. Four classes in the public API:

| Class | What it does | Network? |
|-------|--------------|----------|
| `TemporalCompare` | DTW, LCS, Levenshtein edit-distance on `Float64Array` / `Int32Array`. Windowed DTW. O(n×m). | No — pure in-process math |
| `NanoScheduler` | Task scheduler using `performance.now()`. Requires browser `window`; not usable from Node. | No |
| `StrangeLoop` | Confidence-weighted meta-learning over pattern IDs + float scores. `best_pattern()` / `reflect()`. | No — in-process only, no persistence layer |
| `QuicMultistream` | **Stub.** `open_stream()` writes a HashMap entry, `send()` increments a byte counter, `receive()` returns `vec![0u8; size]`. Marked "simulated" / "WebTransport-compatible" in the README. | **No real UDP, no TLS, no protocol.** |

The package's name (`midstreamer`), its README's name (`@midstream/wasm`), and its inner `pkg-node/package.json` (`midstream-wasm`, version `1.0.0`) are three different identifiers for the same code — a publish-pipeline desync that integrators have to be aware of.

The **upstream `ruvnet/midstream` repo** is a Rust workspace with six crates (`midstreamer-temporal-compare`, `midstreamer-scheduler`, `midstreamer-attractor`, `midstreamer-neural-solver`, `midstreamer-strange-loop`, `midstreamer-quic`) plus the AIMDS subdirectory. The native `midstreamer-quic` crate does use `quinn` (the canonical Rust QUIC impl) and would provide real QUIC — but **it is not part of the npm package** and would require an N-API binding that doesn't exist yet.

## Per-question findings

### QUIC networking for federation

**`midstreamer` provides no real QUIC. It does not replace or complement ADR-108.**

The `QuicMultistream` class is a counter-tracking stub identical in nature to the stub `agentic-flow/transport/quic` build that ADR-104 already documented. ADR-108 already specifies the loader pattern (`AGENTIC_FLOW_QUIC_NATIVE=1`, same `AgentTransport` interface) that lets ruflo swap to a real QUIC implementation when one exists in `agentic-flow`. If the real `midstreamer-quic` Rust crate were instead exposed via N-API, ADR-108's plan would still apply — the decision architecture is transport-agnostic. **There is no adoption value here until someone builds the N-API wrapper, which is upstream work in either repo.**

### Tailscale-style mesh networking

**`midstreamer` has no mesh networking layer. ADR-111 is unaffected.**

ADR-111 chose an in-tree WireGuard control plane (Phases 1-3 already implemented). `midstreamer` is a pure math/scheduling WASM library: no peer discovery, no key exchange, no relay, no NAT traversal, no MagicDNS, no Tailscale/headscale client. WireGuard operates at the OS network layer; `midstreamer` cannot reach that layer from WASM regardless of intent. The two stacks are non-overlapping.

### In-flight agentics

**`midstreamer` does not provide an inline middleware/routing layer.** No HTTP server, no MCP tool surface, no middleware chain, no hook interface. The four exported classes must be explicitly instantiated by calling code; they do not self-insert into any request path.

The **AIMDS sibling component** (same upstream repo, exposed via the `aidefence` npm package) **is** the inline threat-detection surface. ruflo already adopted it via ADR-118 today. The 3-gate pattern (`aidefence_is_safe` → `aidefence_scan` → `aidefence_has_pii`) is the canonical in-flight agentic gate in ruflo. `midstreamer` and `aidefence` are sibling packages from the same repo with non-overlapping purposes; adopting `aidefence` does not imply adopting `midstreamer`.

`StrangeLoop` could theoretically be used as a meta-learning layer inside a custom gate, but the meta-learning gap in `aimds-response` was just fixed in `aidefence@2.3.0` (ADR-118). A second meta-learning system would overlap with no reconciliation protocol.

### Concrete integration points

| midstreamer feature | Plausible ruflo use | File(s) that would change | Already done? |
|---|---|---|---|
| `TemporalCompare` (DTW/LCS) | Trajectory similarity in `ruflo-agentdb` / ReasoningBank — compare agent execution sequences for drift detection or past-run matching | `plugins/ruflo-agentdb/` adapters, `v3/@claude-flow/memory/` | Not done; no current equivalent for sequence-level trajectory comparison |
| `StrangeLoop` | Online policy adjustment in `ruflo-intelligence` — replace/augment the static pattern-weight update in `hooks_intelligence_learn` | `plugins/ruflo-intelligence/` or `v3/@claude-flow/hooks/` | Partially redundant with `aimds-response@0.1.1` meta-learning + `ReasoningBank` distillation |
| `QuicMultistream` | Nothing — it is a stub | — | — |
| `NanoScheduler` | Nothing in Node.js server contexts — requires browser `window` | — | — |

A naming coincidence: `ruvector@0.2.25` once mentioned a removed `midstream` subcommand. That is unrelated to `ruvnet/midstream` — different project, same word.

### Risks and gaps

- **Nothing in ruflo currently depends on `midstreamer`.** Adopting adds a 64 KB WASM init cost (~50-100 ms cold start per package docs).
- **Real QUIC is missing.** The one thing the name implies requires an N-API binding that doesn't exist in the npm package.
- **`StrangeLoop` has no persistence.** Integrating properly means serializing state to AgentDB between process restarts — non-trivial.
- **Release discipline is immature.** 14 versions in ~6 months, 8 of them in a single day; no changelog in the tarball; the documented homepage (`https://midstream.dev/docs`) didn't return content at research time (inferred from link, not fetched). The inner `pkg-node` version (`1.0.0`) is out of sync with the outer published version (`0.2.5`).
- **Identifier ambiguity.** `midstreamer` (install name) vs `@midstream/wasm` (README) vs `midstream-wasm` (inner package.json) all point at the same code. Documentation-side hazard for downstream adopters.

## Decision

**Wait. Partial adoption is gated on specific upstream work or specific ruflo requirements.**

Per-feature guidance:

| Feature | Decision | Rationale |
|---------|----------|-----------|
| `QuicMultistream` | **Don't adopt** | Stub. The federation transport problem is solved by ADR-104's WebSocket fallback with the ADR-108 upgrade path. Revisit only if `midstreamer-quic` (the native Rust crate, not the WASM stub) gets an N-API binding. |
| `NanoScheduler` | **Don't adopt** | Browser-only. Not usable in ruflo's Node.js plugin processes. |
| `TemporalCompare` (DTW/LCS) | **Wait** | Genuine use case (trajectory drift detection, ReasoningBank similarity), but no current plugin has it as a stated gap. Adopt when a concrete trajectory-comparison need surfaces in `ruflo-agentdb` or `ruflo-intelligence` and the WASM init cost is acceptable in that plugin's latency budget. |
| `StrangeLoop` | **Don't adopt now** | The meta-learning gap in `aimds-response` was just fixed in `aidefence@2.3.0` (ADR-118). Adding a second meta-learning system without a concrete problem statement creates two overlapping policy-adjustment mechanisms with no reconciliation protocol. |
| **AIMDS** (sibling component, not `midstreamer`) | **Already adopted** | Via `aidefence@2.3.0` and ADR-118. No further action needed. |

## Consequences

### Positive

- **Clear scope boundary.** This ADR draws a line between `midstreamer` (math/scheduling WASM) and `aidefence` (safety gates) — sibling packages from the same author that are commonly confused.
- **ADR-108 / ADR-111 stand.** Federation transport (WebSocket → native QUIC via `agentic-flow`) and mesh (in-tree WireGuard) decisions remain in force. No re-litigation needed.
- **Concrete trigger for future revisit.** If `ruflo-agentdb` or `ruflo-intelligence` surfaces a trajectory-comparison requirement, the `TemporalCompare` adoption path is mapped out and bounded.

### Negative

- **No new capability shipped.** The user-facing question "could `midstreamer` give us QUIC / Tailscale / inflight agentics?" gets answered "no, no, partially-via-`aidefence`-which-we-already-took." That's a genuine "nothing to do" outcome — important to record so it doesn't get re-asked in three months.

### Neutral

- **Re-eval triggers** explicitly named below — this is not a permanent "no", it's a "no for these reasons, here's what would change the answer."

## When to revisit

Reopen this decision if **any** of these become true:

1. `midstreamer-quic` (the native Rust crate with `quinn`) gets an N-API binding published on npm.
2. A ruflo plugin (likely `ruflo-agentdb` or `ruflo-intelligence`) lands a stated requirement for sequence-level trajectory comparison (DTW / LCS / edit distance).
3. The upstream `ruvnet/midstream` repo publishes a Node-compatible scheduler (replacing `NanoScheduler`'s `window`-only design) that fits ruflo's hook scheduling model.
4. The `aimds-response@0.1.1` meta-learning layer proves insufficient in practice and a second meta-learning system is needed — at which point `StrangeLoop` is a plausible candidate, but the reconciliation protocol has to be designed first.

## Links

- npm: [`midstreamer@0.2.5`](https://www.npmjs.com/package/midstreamer)
- Upstream: [`ruvnet/midstream`](https://github.com/ruvnet/midstream) (Rust workspace + npm-wasm/ + AIMDS/)
- Sibling package adopted via ADR-118: [`aidefence@2.3.0`](https://www.npmjs.com/package/aidefence) — wider injection detection + accurate audit counters
- ADRs: [ADR-097](./ADR-097-federation-budget-breaker.md) · [ADR-104](./ADR-104-federation-transport.md) · [ADR-108](./ADR-108-native-quic-binding.md) · [ADR-111](./ADR-111-federation-wg-mesh.md) · [ADR-118](./ADR-118-aidefence-2.3.0-upgrade.md)
- Investigation transcript: deep-researcher agent `a70c6ee07aeab17bf`
