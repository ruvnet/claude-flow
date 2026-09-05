# ADR-120 — Cross-repo QUIC unification: borrow agentic-flow's bridge for midstream's npm build, then adopt in ruflo with Rust in-flight agentics

**Status**: Proposed (2026-05-14)
**Date**: 2026-05-14
**Authors**: claude (drafted with rUv)
**Related**: [ADR-104](./ADR-104-federation-transport.md) (federation transport, WebSocket today + clean QUIC upgrade path) · [ADR-108](./ADR-108-native-quic-binding.md) (agentic-flow native QUIC binding plan, loader pattern) · [ADR-111](./ADR-111-federation-wg-mesh.md) (WireGuard mesh) · [ADR-118](./ADR-118-aidefence-2.3.0-upgrade.md) (AIMDS sibling adopted) · [ADR-119](./ADR-119-midstreamer-adoption-assessment.md) (midstreamer assessed — decision was *wait*; this ADR is the "what would change the answer" trigger)
**Supersedes**: nothing
**Sources**: [agentic-flow QUIC-STATUS.md (Oct 17, 2025)](https://github.com/ruvnet/agentic-flow/blob/main/docs/features/quic/QUIC-STATUS.md) · [agentic-flow `crates/agentic-flow-quic/`](https://github.com/ruvnet/agentic-flow/tree/main/crates/agentic-flow-quic) · [midstream `crates/quic-multistream/`](https://github.com/ruvnet/midstream/tree/main/crates/quic-multistream)

## Context

Both `ruvnet/agentic-flow` and `ruvnet/midstream` have a QUIC crate. They are not the same crate:

| Concern | `agentic-flow-quic` (v0.1.0) | `midstreamer-quic` (v0.2.1) |
|---------|----------------------------|----------------------------|
| Native Rust | `quinn 0.11` + `tokio 1.40` + `rustls 0.23` + `rcgen 0.13` | `quinn 0.11` + `tokio 1.42` + `rustls-platform-verifier 0.6` + `rcgen 0.12` |
| WASM target | `wasm-bindgen` + `web-sys` (console only) | `wasm-bindgen` + `web-sys` (WebTransport API: `WebTransport`, `WebTransportBidirectionalStream`, `WebTransportDatagramDuplexStream`, …) |
| Production status (per upstream docs) | **100% complete, Oct 17 2025** — UDP sockets, HTTP/3 QPACK, varint, handshake state machine, 0-RTT reconnection (91.2% faster), 53.7% lower latency than HTTP/2, 7931 MB/s throughput | Crate exists with native quinn impl and proptest-based tests; **npm-published WASM (`midstreamer@0.2.5`) is a counter-tracking stub** (per [ADR-119](./ADR-119-midstreamer-adoption-assessment.md)) |
| Bridge to Node | `src/transport/quic.ts` — UDP `dgram` socket ↔ WASM `sendMessage`/`recvMessage` bridge, working | Not published — WASM build is purely WebTransport-targeted (browser) |
| Security posture | TLS via `rustls 0.23` | Adds `rustls-platform-verifier` for OS trust store (ADR-0011 in upstream) — closer to production posture; explicit "never enable in production" flag for self-signed test mode |

So `agentic-flow-quic` has the **integration layer** (UDP socket bridge in TypeScript, handshake state machine, validated 0-RTT reconnection, packet-level WASM bridge); `midstreamer-quic` has the **better Rust crate** (OS-trust-store verifier, proptest coverage, slightly newer toolchain pin). Cross-pollinating these two would produce a single QUIC transport that is both production-grade in Rust and shippable as a working npm package — which is the gap ADR-108 has been waiting on.

ruflo's federation transport (ADR-104) and the native-QUIC upgrade plan (ADR-108) were both architected around a loader pattern (`AGENTIC_FLOW_QUIC_NATIVE=1` + same `AgentTransport` interface) that's intentionally transport-agnostic. The federation WireGuard mesh (ADR-111) operates at the OS network layer below this — orthogonal. The AIMDS / `aidefence` sibling component (ADR-118) provides the in-flight safety gates. **The only remaining gap to fully Rust-native federation + in-flight agentics is: real QUIC reachable from Node with a verified TLS posture.**

This ADR proposes a three-step plan to close it.

## Decision

**Step 1 — Cross-port the agentic-flow QUIC bridge into midstream and republish `midstreamer-quic` with the production WASM build (upstream work in `ruvnet/midstream`).** Step 2 — Update ruflo's ADR-108 loader to detect the new midstream WASM build. Step 3 — Compose `midstreamer-quic` + `aimds-*` into a single ruflo Rust transport that runs the federation hops *and* the in-flight gate in one process.

### Step 1 — Upstream: `midstream` adopts agentic-flow's bridge pattern

The current `midstreamer-quic` Rust crate is the better foundation (newer tokio, OS-trust-store verifier, proptest coverage). What it's missing is the production WASM build + Node bridge that `agentic-flow-quic` already validated end-to-end (per `QUIC-STATUS.md`, October 17, 2025: UDP sockets working, handshake state machine complete, 53.7% latency improvement vs HTTP/2 validated, 0-RTT reconnection at 91.2% improvement validated).

The cross-port is structurally small because the two crates share `quinn 0.11`:

| Bring over from `agentic-flow-quic` | Into `midstreamer-quic` |
|---|---|
| `src/transport/quic.ts` UDP `dgram` ↔ WASM `sendMessage`/`recvMessage` bridge layer (~200 lines) | New `npm-wasm/bridge.ts` (or equivalent in midstream's existing `npm-wasm/` layout) |
| `src/transport/quic-handshake.ts` `QuicHandshakeManager` state machine (Initial → Handshaking → Established → Failed → Closed) | New `npm-wasm/handshake.ts` |
| `quic-loader.ts` lazy-load + path resolution | New `npm-wasm/loader.ts` |
| Performance benchmarks (`tests/quic-performance-benchmarks.js`, the ones that produced the 53.7% / 91.2% numbers) | Add as `crates/quic-multistream/benches/` companion JS suite |

**What midstream keeps:**

- The native Rust crate with `rustls-platform-verifier` (OS trust store) — strictly better security posture than `agentic-flow-quic`'s `rustls` direct.
- The proptest priority-stats coverage (ADR-0038 in upstream).
- The `insecure-dev-only-skip-server-verification` feature flag — explicitly documented "MUST NEVER be enabled in production builds" plus runtime warning.

**What changes in midstream:**

- The `npm-wasm/` build for `midstreamer` (the published npm package) currently exports `QuicMultistream` as a counter-tracking stub. Replace its `open_stream` / `send` / `receive` implementations with the agentic-flow bridge pattern wired to the native crate's compiled wasm32-unknown-unknown target (separate from the browser WebTransport target which stays as-is).
- Bump `midstreamer` (npm) to `0.3.0` to signal the real-QUIC contract; ship the existing `TemporalCompare` / `StrangeLoop` / `NanoScheduler` unchanged.

**Estimated effort:** ~1-2 days of upstream work. The pattern is already proven in `agentic-flow-quic`; midstream just adopts it.

### Step 2 — Ruflo: ADR-108 loader detects the new midstream WASM

[ADR-108](./ADR-108-native-quic-binding.md) already defines the loader pattern. The implementation today is:

```typescript
// pseudocode from ADR-108
if (process.env.AGENTIC_FLOW_QUIC_NATIVE === '1') {
  try {
    const native = await import('agentic-flow/transport/quic');
    if (native.isNative()) return native;
  } catch {}
}
return webSocketFallback();  // ADR-104
```

Extension after Step 1 lands:

```typescript
// new pseudocode
const candidates = [
  ['MIDSTREAMER_QUIC_NATIVE', 'midstreamer'],      // ← new, preferred
  ['AGENTIC_FLOW_QUIC_NATIVE', 'agentic-flow/transport/quic'],
];
for (const [envFlag, modulePath] of candidates) {
  if (process.env[envFlag] !== '1') continue;
  try {
    const mod = await import(modulePath);
    if (mod.isNative?.() ?? mod.QuicMultistream) return mod;
  } catch {}
}
return webSocketFallback();
```

Why prefer midstreamer once available: it ships the same `quinn 0.11` core but with `rustls-platform-verifier` (OS trust store) — a real production posture for federation peers. Plus it's the package ruflo already takes `aidefence` from (ADR-118), so adopting another crate from the same workspace lowers the dependency-coordination surface.

**File that changes in ruflo:** the existing loader in `agentic-flow/src/transport/quic-loader.ts` consumed by `@claude-flow/plugin-agent-federation`. One module, two new lines, one new env flag.

### Step 3 — Rust in-flight agentics: compose `midstreamer-quic` + `aimds-*` in a single peer binary

This is the "Rust-based in-flight agentics" the question is really asking about. Today the ruflo federation peer is a Node.js process: it receives a federation message, passes it through `aidefence_*` MCP tools (the in-flight gate per ADR-118's 3-gate pattern), then dispatches to the local agent. With Step 1 done, we can collapse those layers into a single Rust binary per peer:

```
  Federation peer (single Rust binary)
  ┌────────────────────────────────────────────────┐
  │  midstreamer-quic       ▶  QuicConnection      │
  │  (UDP + TLS + handshake)                       │
  │           │                                    │
  │           ▼                                    │
  │  aimds-detection        ▶  Sanitizer           │
  │  (<10ms, in-process)        PatternMatcher     │
  │                                                │
  │  aimds-analysis         ▶  BehavioralAnalyzer  │
  │  (<100ms, in-process)       PolicyVerifier     │
  │                                                │
  │  aimds-response         ▶  StrategyOptimizer   │
  │  (<50ms, in-process)        AtomicCounters     │
  │           │                                    │
  │           ▼                                    │
  │  Dispatch to local Node MCP server             │
  │  (NDJSON over stdio, like today)               │
  └────────────────────────────────────────────────┘
```

**What this gets you that today doesn't:**

- **One process, not three.** Today: Node bridge → Node MCP tool → Rust crate (via N-API or shell). Tomorrow: one Rust binary that does the QUIC hop + gate + dispatch.
- **Sub-millisecond gate latency.** The `aimds-detection` layer is documented at <10 ms; in-process Rust composition removes the IPC hop. Federation throughput is gated by gate latency under load (ADR-097's budget breaker assumes per-message work is the dominant cost).
- **One trust-store config.** Both `midstreamer-quic` and `aimds-*` are already in the same Cargo workspace upstream — they share `rustls`, the same `validator 0.20` (after ADR-118's bump), the same `unsafe_code = "deny"` workspace lint.
- **Real backpressure.** A Rust binary can apply tokio task-level backpressure between the QUIC receive loop and the AIMDS gates, which the current Node-bridge architecture can only approximate via cooperative `await`.

**File(s) that change in ruflo:**

- New crate at `v3/crates/ruflo-federation-peer/` — depends on `midstreamer-quic` and `aimds-{core,detection,analysis,response}` from the upstream workspace. Exposes one CLI entry point: `ruflo-federation-peer start --listen <addr>`.
- `plugins/ruflo-federation/scripts/` gains an opt-in launcher that prefers the native peer binary when present; falls back to the existing Node implementation.
- ADR-104 / ADR-107 (federation TLS pinning) carry over unchanged — `midstreamer-quic`'s `rustls-platform-verifier` enforces them.

**What stays:**

- ADR-111 (WireGuard mesh) — unchanged. WireGuard runs below; QUIC runs over it. Native peer binary still uses the WireGuard interface; nothing about the mesh control plane shifts.
- ADR-104 WebSocket fallback — unchanged. Native peer is preferred when present; WebSocket bridge stays as the universal fallback.
- The Node MCP server — unchanged. Local agent invocation continues over stdio. Only the peer-to-peer hop becomes native.

## Migration path

1. **Upstream PR to `ruvnet/midstream`** — cross-port the agentic-flow bridge into `npm-wasm/`. Republish `midstreamer@0.3.0`. (External to ruflo; this ADR proposes the design and links to ADR-108 as the consumer.)
2. **Ruflo: loader update** — one-module change in `agentic-flow/src/transport/quic-loader.ts` to detect `midstreamer` first when `MIDSTREAMER_QUIC_NATIVE=1`. Behind the env flag — no behavior change for default callers.
3. **Ruflo: `v3/crates/ruflo-federation-peer/`** — new crate composing `midstreamer-quic` + `aimds-*` + a stdio dispatcher. Ships as an optional native binary; launcher in `plugins/ruflo-federation/scripts/` prefers it.
4. **Smoke parity** — `plugins/ruflo-federation/scripts/smoke.sh` runs against both transports (native peer + WebSocket fallback) and asserts identical 3-gate verdicts on a fixture set.

## Consequences

### Positive

- **Resolves ADR-108.** "Wait for a native QUIC binding" becomes "we ship one." Federation transport finally has the production latency profile (53.7% lower than HTTP/2, 0-RTT reconnection at 91.2% improvement) documented in `agentic-flow-quic`'s QUIC-STATUS but now with the better security posture (OS trust store).
- **Resolves the ADR-119 wait.** ADR-119 closed with "revisit when an N-API binding lands"; Step 1 closes that gap upstream.
- **Halves the federation peer process count.** Today each peer is Node bridge + MCP server; tomorrow the bridge collapses into the native binary.
- **Single dependency on the midstream workspace.** ruflo already takes `aidefence` (ADR-118); adding `midstreamer-quic` lowers coordination cost vs adding it from a different upstream.
- **Verifiable.** Both upstream crates already have benchmark suites (`agentic-flow-quic/benches`, `midstreamer-quic/benches`) and proptest coverage. The 3-gate parity smoke is the existing test.

### Negative

- **Depends on upstream work.** Step 1 is upstream-only (`ruvnet/midstream`). Ruflo can't ship the integration until midstream republishes. We can write the loader (Step 2) and the peer crate (Step 3) behind feature flags so they're ready, but they don't activate until upstream lands.
- **New native dependency surface.** A Rust binary per federation peer is a stricter deployment surface than the existing Node-only path. Consumers running federation in pure-JS environments (some k8s setups) need the WebSocket fallback to stay first-class. ADR-104 already guarantees that, but operators must understand the choice.
- **`midstreamer@0.3.0` is breaking-ish.** The `QuicMultistream` class' actual behavior changes from "counter stub" to "real QUIC." Any caller that depended on the stub semantics (none in ruflo today; verified via `grep`) would break.

### Neutral

- **WireGuard mesh stays.** ADR-111 unchanged; QUIC runs over it. No change to peer key exchange, trust scoring, or breaker integration.
- **3-gate pattern stays.** AIDefence's MCP tool surface (ADR-118) is unchanged — the native peer calls into `aimds-*` directly, but plugins that invoke the MCP tools still get the same answers. The migration is transparent to consumer plugins.

## Open questions

1. **WASI vs wasm32-unknown-unknown for the Node target?** `agentic-flow-quic` uses `wasm32-unknown-unknown` with a TS bridge. WASI would let Rust own the UDP socket directly. Pro: simpler bridge. Con: WASI socket support in Node is still flagged. Recommend wasm32-unknown-unknown + TS bridge for parity with the proven `agentic-flow-quic` pattern.
2. **Should the native peer binary be one Rust binary or one per role (sender/receiver)?** `agentic-flow-quic`'s feature flags (`client` + `server` defaults) already provide the split; single binary with role flag is simpler.
3. **Persistence for `aimds-response` meta-learning state across peer restarts?** The state is in-process today (ADR-118 noted this). Native peer would need an AgentDB write path to persist; separate ADR if/when needed.

## Links

- Source repos: [`ruvnet/agentic-flow`](https://github.com/ruvnet/agentic-flow) · [`ruvnet/midstream`](https://github.com/ruvnet/midstream)
- Upstream crates: [`agentic-flow-quic`](https://github.com/ruvnet/agentic-flow/tree/main/crates/agentic-flow-quic) · [`midstreamer-quic`](https://github.com/ruvnet/midstream/tree/main/crates/quic-multistream)
- QUIC status doc this ADR built on: [`agentic-flow/docs/features/quic/QUIC-STATUS.md`](https://github.com/ruvnet/agentic-flow/blob/main/docs/features/quic/QUIC-STATUS.md) (October 17, 2025 — 100% complete, validated)
- Prior ADRs: [ADR-104](./ADR-104-federation-transport.md) · [ADR-108](./ADR-108-native-quic-binding.md) · [ADR-111](./ADR-111-federation-wg-mesh.md) · [ADR-118](./ADR-118-aidefence-2.3.0-upgrade.md) · [ADR-119](./ADR-119-midstreamer-adoption-assessment.md)
