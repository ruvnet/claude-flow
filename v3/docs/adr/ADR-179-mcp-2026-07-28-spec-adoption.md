# ADR-179: MCP 2026-07-28 Specification Adoption and SDK v2 Migration Strategy

**Status**: Proposed
**Date**: 2026-07-12
**References**: [MCP SDK beta announcement (2026-07-28 spec)](https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/), ADR-012 (MCP Security Features), ADR-166 (MCP Bridge RCE Remediation)

---

## Context

The Model Context Protocol project has published beta SDK releases targeting the **2026-07-28 specification revision**, which becomes final on July 28, 2026. Betas exist for all four Tier 1 SDKs: Python (`mcp` v2.0.0b1), TypeScript (v2, split packages such as `@modelcontextprotocol/server@beta`), Go (v1.7.0-pre.1), and C# (v2.0.0-preview.1).

The spec revision is not incremental — it changes the protocol's architectural core:

1. **Stateless protocol**: the `initialize` handshake and session management are removed. Servers become round-robin load-balanceable with no sticky sessions.
2. **Multi Round-Trip Requests (MRTR)**: tools can return `InputRequiredResult` to request user input mid-execution, replacing long-lived streams for elicitation.
3. **Transport headers**: every request carries `Mcp-Method` (plus `Mcp-Name` on tool/resource/prompt requests) so gateways can route without parsing JSON-RPC bodies.
4. **Authorization hardening**: RFC 9207 `iss` validation, `application_type` in Dynamic Client Registration, credentials bound to their issuing server.
5. **Standard error codes**: missing resources return JSON-RPC `-32602` instead of the MCP-specific `-32002`.
6. **Deprecations**: roots, sampling, and logging capabilities are deprecated (still functional).

### Why this hits ruflo harder than most projects

Ruflo has **two independent MCP surfaces**, and neither is insulated by an SDK upgrade path:

**Surface 1 — hand-rolled server (`v3/@claude-flow/mcp`)**. Our 314-tool MCP server does not depend on `@modelcontextprotocol/sdk`; it implements JSON-RPC, stdio/HTTP/WebSocket transports, connection pooling, and the tool registry directly. Every spec-affected area is load-bearing code we own:

| Spec change | Affected module | Current state |
|---|---|---|
| Stateless protocol | `session-manager.ts`, `server.ts` | Protocol pinned to `2025-11-25` (`server.ts:92`); full initialize/session lifecycle |
| MRTR | `tool-registry.ts`, `task-manager.ts` | No mid-execution input mechanism |
| Transport headers | `transport/` | Headers not emitted or routed on |
| Error codes | `types.ts:638` (`ErrorCodes`) | `SERVER_NOT_INITIALIZED` and `AUTHORIZATION_FAILED` both mapped to `-32002` |
| Auth hardening | `oauth.ts` | No RFC 9207 `iss` validation, no `application_type` in DCR |
| Deprecations | `sampling.ts` (`sampling/createMessage`, `server.ts:546`), logging | Sampling is an active feature with provider registration |

There is no codemod for us — the TypeScript `v1-to-v2` codemod targets SDK consumers, not independent implementations.

**Surface 2 — SDK client (`ruflo/src/ruvocal`)**. The ruvocal app depends on `@modelcontextprotocol/sdk@^1.26.0` (client pool, HTTP client, tool invocation). TypeScript SDK v2 splits the monolith into focused packages, goes ESM-only, requires Node.js 20+, and adopts Standard Schema for tool validation. The current `^1.26.0` caret range is safe (v2 ships as new package names / a new major), but the migration itself is a real work item.

**What protects us**: the announcement commits to interop — "old servers and new clients keep interoperating" — and TypeScript v1.x receives bug fixes for at least six months post-v2. Current stable versions remain recommended for production. So there is no forcing function before the spec finalizes, but the stateless model and error-code change will eventually be what new clients and gateways expect.

---

## Decision

Adopt the 2026-07-28 specification **incrementally and dual-version**, keeping `2025-11-25` support intact until the ecosystem moves. No beta SDKs in production.

### 1. Hold the line now (pre-finalization, before 2026-07-28)

- **Do not** adopt any beta SDK in a published package. If a spike needs one, pin the exact beta version in a branch, never in `main`.
- Add an explicit upper bound to ruvocal: `"@modelcontextprotocol/sdk": "^1.26.0 <2"` (defensive; v2 restructuring makes accidental major-bumps via transitive tooling a real risk — see the #2112 overrides lesson).
- Land the **zero-risk forward-compatible changes** in `@claude-flow/mcp` immediately, since they are valid under both spec revisions:
  - Split `ErrorCodes`: `AUTHORIZATION_FAILED` moves off `-32002` (it never should have shared a code with `SERVER_NOT_INITIALIZED`); resource-not-found paths return `-32602` with a descriptive message.
  - Emit `Mcp-Method` / `Mcp-Name` headers on outbound HTTP requests and tolerate them inbound. Headers are additive and ignored by old peers.

### 2. Dual protocol-version support in `@claude-flow/mcp` (at finalization)

- Introduce `MCPProtocolVersion = '2025-11-25' | '2026-07-28'` negotiation. When a client connects statelessly (no `initialize`), serve the new revision; when it sends `initialize`, run the existing session lifecycle unchanged.
- Make **stateless mode opt-in per transport** (`StreamableHTTPOptions`-style flag, mirroring the Go SDK's `Stateless = true` approach), defaulting to stateful until our own consumers (Claude Code, the MCP bridge, metaharness `mcp-scan`) are verified against it.
- `session-manager.ts` becomes a compatibility layer, not a required path. Session-scoped state that tools rely on (memory namespaces, rate-limiter buckets keyed by session) must be re-keyed to connection/auth identity so stateless requests still resolve them.

### 3. MRTR support in the tool registry

- Add `InputRequiredResult` as a first-class tool return type in `tool-registry.ts` / `task-manager.ts`. This directly benefits swarm tools that currently fake elicitation via long-polling or memory handshakes.
- Gate behind the negotiated protocol version; on `2025-11-25` connections, an `InputRequiredResult` is downgraded to a terminal error instructing the client to re-invoke with the needed input.

### 4. Authorization hardening (`oauth.ts`)

- Implement RFC 9207 `iss` validation and `application_type` in DCR regardless of protocol version — this is pure security posture and aligns with ADR-166's remediation direction. Track under `@claude-flow/security` review.

### 5. Deprecated capabilities: keep, isolate, don't grow

- `sampling/createMessage`, roots, and logging stay functional (deprecated ≠ removed), but are frozen: no new features, and `sampling.ts` gets a deprecation note pointing at the agent-native alternative (Task-tool agents / `metallm_delegate`).

### 6. ruvocal SDK v2 migration (post-stable, not before)

- Migrate only after TypeScript v2 is stable, using the official codemod (`npx @modelcontextprotocol/codemod v1-to-v2 .`) as the starting point. ruvocal is already ESM and Node 20+, so the split-package + Standard Schema changes are the bulk of the work.
- The v1.x six-month bug-fix window is the deadline anchor: complete migration within that window.

---

## Consequences

**Positive**
- Stateless mode removes the sticky-session constraint on the HTTP transport — the connection-pool and any future multi-instance deployment get horizontal scaling for free.
- MRTR gives swarm tools a spec-blessed elicitation mechanism, replacing ad-hoc memory-handshake patterns.
- Error-code and header changes shipped early mean gateways and new clients work against us on day one of finalization.
- Owning the server implementation means no forced SDK-major migration for Surface 1 — we adopt at our own pace.

**Negative / trade-offs**
- Owning the implementation also means we pay full engineering cost for every spec change; the dual-version negotiation layer is complexity the SDK crowd gets for free.
- Re-keying session-scoped state (rate limiting, memory namespaces) to auth identity is the riskiest single piece — done wrong it either breaks tool state or opens a cross-tenant leak. It needs its own security review before stateless mode defaults on.
- Two protocol versions live in the codebase for at least one release cycle; test matrix doubles for the MCP package.

**Explicitly rejected alternatives**
- *Replace `@claude-flow/mcp` with the official SDK*: rejected — the package exists precisely because we need connection pooling, a 314-tool registry, rate limiting, and three transports under one roof; v2's split packages still wouldn't cover that, and a rewrite has higher regression risk than tracking the spec.
- *Adopt betas now*: rejected — public APIs may change before stable, and the announcement itself recommends stable versions for production.
- *Ignore until clients break*: rejected — the `-32002` error-code mismatch and missing transport headers would silently degrade behavior behind gateways well before hard failures appear.

---

## Implementation Notes

- Phase 1 (now): error-code split + header emission in `@claude-flow/mcp`; ruvocal upper-bound pin. PATCH release.
- Phase 2 (spec finalization): version negotiation + opt-in stateless transport + MRTR. MINOR release (backward-compatible addition).
- Phase 3 (TS SDK v2 stable): ruvocal migration; flip stateless default only after Claude Code and metaharness `mcp-scan` verify against it. Flipping the default is a MAJOR-worthy behavior change per the versioning policy.
- CI: add a protocol-conformance smoke that runs the same tool-call suite over both negotiated versions.
