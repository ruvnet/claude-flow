# ADR-104 — Federation wire transport: plugin-owned WS fallback (QUIC roadmap)

- Status: **Accepted — Implemented (transport selection); pending native QUIC for v2**
- Date: 2026-05-09
- Authors: claude (drafted with rUv)
- Supersedes / extends: [ADR-097 — Federation budget circuit breaker](./ADR-097-federation-budget-circuit-breaker.md)
- Related upstream: [ruvnet/agentic-flow#153](https://github.com/ruvnet/agentic-flow/pull/153), ruvnet/ruflo#2618

## Context

ADR-097 shipped the federation plugin's security/audit/breaker layers (Phases 1, 2.a, 2.b, 3 consumer + upstream, 4 — all Implemented in `@claude-flow/plugin-agent-federation@1.0.0-alpha.8`). The transport layer was deliberately deferred: `routing-service.ts` has no `fetch`/`WebSocket`/`http.request` calls; every `federation_send` runs in-process. The plugin contract treated wire transport as an integrator concern.

For real mac↔ruvultra peering, an integrator (here: ourselves) needs to pick a transport. We surveyed three:

1. **Tailscale TCP (raw `node:net`)** — ~50 LOC, encryption + identity from WireGuard, trivially works between any two tailnet hosts.
2. **agentic-flow QUIC** — `agentic-flow` is already a transitive dep elsewhere in the repo and advertises `./transport/quic` exports (`QuicClient`, `QuicServer`, `QuicConnectionPool`, `QuicTransport`, `QuicHandshakeManager`). Promised 0-RTT, multiplexed streams, TLS 1.3.
3. **Custom QUIC** — `quinn` (Rust) or `@matrixai/quic` (pure JS), wrap with N-API.

## Investigation

Smoke-tested option 2 between mac (darwin/arm64) and ruvultra (linux/x64) over tailscale on 2026-05-09:

```
[client] connect ruvultra:9100... connected in 0ms
[client] stream.send(76B)... sent in 0ms
[server] stats: conns=0/0 streams=0/0 rx=0B
```

`0ms` for a real QUIC handshake is impossible. Server `rx=0B` after a successful `send()` is impossible. Source confirmed: `loadWasmModule()` returns `{}`, `encodeHttp3Request`/`decodeHttp3Response` are placeholders, and `crates/agentic-flow-quic/src/wasm.rs` carries the comment:

> _"This wraps the WASM stub since browsers don't support UDP/QUIC directly. For production QUIC, use native Node.js builds."_

The published QUIC transport is **API-only**. The native build that would unstub it has 7 open Phase-1 issues in [ruvnet/agentic-flow#15-21](https://github.com/ruvnet/agentic-flow/issues?q=is%3Aissue+is%3Aopen+QUIC) and isn't shipped.

## Decision

**Adopt the federation plugin's `loadFederationTransport()` loader with a plugin-owned WebSocket fallback for v1; native QUIC remains the v2 target.**

We:

1. **Backported `loadQuicTransport()` + `WebSocketFallbackTransport` from the OUTER repo's `quic-loader.ts` into the published inner `agentic-flow` package** (PR [ruvnet/agentic-flow#153](https://github.com/ruvnet/agentic-flow/pull/153)). The loader detects native QUIC availability (today: false) and selects WebSocket. Same `AgentTransport` interface for both backends — federation code never branches on transport.
2. **Published `agentic-flow@2.0.12-fix.1` on the `fix` dist-tag** so federation can consume the working transport without waiting for upstream merge. When upstream merges + cuts a release, federation re-points to the official version with no code change.
3. **Federation plugin imports its own loader, `@claude-flow/plugin-agent-federation/dist/transport/midstream-aware-loader.js`**, not `agentic-flow/transport/loader`. Current `agentic-flow` releases do not export `./transport/loader`; external ADR-104 smoke scripts that import that subpath fail with `ERR_PACKAGE_PATH_NOT_EXPORTED` (#2618). The plugin loader still probes `midstreamer` and `agentic-flow` opportunistically, but it owns the baseline WebSocket fallback itself.

## Validated end-to-end (2026-05-09)

mac (darwin/arm64) → ruvultra:9101 (linux/x64) over tailscale, real bytes on the wire:

```
[srv] LISTENING on 0.0.0.0:9101
[srv] caps: {"quicAvailable":false,"webSocketFallbackAvailable":true,"selectedBackend":"websocket"}
[cli] caps: {"quicAvailable":false,"webSocketFallbackAvailable":true,"selectedBackend":"websocket"}
[cli] sending to ruvultra:9101
[cli] sent in 125ms       ← real network I/O
[cli] DONE
```

125ms is the legit tailnet RTT for a fresh WS connect + JSON message, not the prior stub's 0ms.

## Consequences

### Positive

- **Federation v1 ships TODAY.** The breaker, audit, spend reporter, and operator MCP tools (Phases 2.a/2.b/3-up/4) had nowhere to go without a transport. They have one now.
- **Forward-compat to native QUIC is one env var away.** Set `AGENTIC_FLOW_QUIC_NATIVE=1` and the loader picks the native binding when it lands. No federation code changes.
- **Tailscale handles encryption + identity.** WS over tailnet inherits WireGuard's TLS-equivalent protections. We don't need `wss://` certs for the immediate use case.
- **Same `AgentTransport` interface across backends** — integrators write transport-agnostic code.
- **Upstream contribution** — PR #153 fixes a reproducible bug for everyone using `agentic-flow/transport/quic`, not just us.

### Negative / Limits

- **No 0-RTT, no stream multiplexing.** Each peer pair gets one TCP/WS connection. For ≤100 RPS federation traffic this is fine. If we hit head-of-line blocking on a single-stream peer, that's the trigger to push native QUIC.
- **TLS handled by tailnet, not the WS layer.** If we ever federate OUTSIDE tailnet, switch the loader to `wss://` + cert pinning before doing so. Document in the operator runbook.
- **Two npm tags to manage.** `agentic-flow@latest` is still the stub-shipping 2.0.11. We pin `agentic-flow@fix` (2.0.12-fix.1) until upstream merges PR #153 and cuts 2.0.13. After that we pin `^2.0.13` and drop the `fix` tag dependency.

### Neutral

- **Federation transport is now an explicit ADR concern, not just plugin internals.** When we eventually add a third backend (e.g. WebRTC datachannel for browser peers, or HTTP/3 over a public proxy), it goes through this ADR's amendment process.

## Implementation status

| Component | Status | Where |
|---|---|---|
| Upstream fix (loader + WS fallback) | Open PR | [ruvnet/agentic-flow#153](https://github.com/ruvnet/agentic-flow/pull/153) |
| Patched npm release | Published | `agentic-flow@2.0.12-fix.1` (`fix` dist-tag) |
| End-to-end mac↔ruvultra over tailscale | Verified | This ADR's "Validated" section |
| Federation plugin wiring (`loadFederationTransport()` integration) | Implemented | `v3/@claude-flow/plugin-agent-federation/src/transport/midstream-aware-loader.ts` |
| 12h verification routine — transport check | Implemented in repo; external runner must call plugin loader | Check 8 should import `@claude-flow/plugin-agent-federation/dist/transport/midstream-aware-loader.js`, not `agentic-flow/transport/loader` |
| Native QUIC binding (real upgrade path) | Deferred | Tracked upstream at agentic-flow#15-21 |

## Operator-visible signal

When this is wired into the federation plugin, `npx ruflo doctor --component federation` will report:

```
✓ Federation Breaker: ADR-097 breaker loadable
✓ Federation Transport: selectedBackend=websocket (native QUIC unavailable)
```

When the native binding lands and is enabled:

```
✓ Federation Breaker: ADR-097 breaker loadable
✓ Federation Transport: selectedBackend=quic (0-RTT, multiplexed streams)
```

## Decision review trigger

Re-open this ADR when ANY of:
- ruvnet/agentic-flow ships a native QUIC binding (`isQuicAvailable()` returns true)
- Federation traffic exceeds ~100 RPS to a single peer (head-of-line blocking risk on single TCP stream becomes real)
- We need to federate peers OUTSIDE tailnet (TLS pinning + cert lifecycle become first-class concerns)
- A federation peer reports actual measured cost from WS-vs-QUIC switch (i.e. we have data instead of theory)
