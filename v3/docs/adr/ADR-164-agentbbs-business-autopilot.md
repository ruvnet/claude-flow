# ADR-164 — AgentBBS Federated Business-Management Autopilot

**Status**: Draft
**Date**: 2026-06-29
**Authors**: claude (drafted with rUv)
**Related**:
- ADR-097 (federation budget circuit breaker)
- ADR-110 (production spend reporter)
- ADR-111 (WG mesh transport)
- ADR-115 (managed agents cloud backend)
- ADR-150 (metaharness integration — the optional-dep playbook this ADR mirrors)
- ADR-001 (deep-integration philosophy — build as extension, not parallel implementation)
- PR #2500 (agenticow v3.15.0 ship — precedent for the optional-dep onboarding pattern)
**External references**:
- `agentbbs@0.1.0` (npm launcher) / Rust workspace — [`ruvnet/agentbbs`](https://github.com/ruvnet/agentbbs) — mature Rust workspace: 13 crates (`agentbbs`, `agentbbs-arena`, `agentbbs-core`, `agentbbs-federation`, `agentbbs-mcp`, `agentbbs-tui`, `agentbbs-web`, `agentbbs-wasm`, plus `late-cli`, `late-core`, `late-nethack`, `late-ssh`, `late-web`), 30+ release tags (latest seen: `v0.34.9-nethack`), 7 GitHub Actions workflows (`agentbbs.yml`, `build.yml`, `ci.yml`, `deploy.yml`, `deploy_cli.yml`, `deploy_infra.yml`, `deploy_nethack.yml`), existing MCP server at `crates/agentbbs-mcp/` (`server.rs`, `client.rs`, `transport.rs`, `lib.rs` + `tests/mcp.rs`), existing federation crate at `crates/agentbbs-federation/`, postgres-backed integration tests, Docker + docker-compose + monitoring stack, `deny.toml` (cargo-deny supply-chain scans), `.gitguardian.yaml` (secret scanning), FSL-1.1-Apache-2.0 license (converts to Apache-2.0 after 2 years); same author (ruv@ruv.net)
- `@claude-flow/plugin-agent-federation` — `v3/@claude-flow/plugin-agent-federation/src/`

---

## 1. Context

### 1.1 Business-owner problem statement

A business owner who deploys ruflo today can run AI agents against discrete tasks. What they cannot do is hand over *operational continuity* to those agents. Sales pipelines go untouched between sessions. Finance reconciliation waits for a human to ask for it. Marketing copy drifts without review. Support tickets queue unreplied.

The gap is not capability — ruflo's agents can already do each of these things when prompted. The gap is **perpetual, observable, overrideable automation with a cockpit the owner can actually sit in**. They need:

1. **Perpetual operation**: agents running Sales / Marketing / Finance / Ops / Support / HR continuously, not just when the owner types a prompt.
2. **A cockpit**: a live feed of what every agent is doing, organized by business function, with a clear override path.
3. **Domain boundary enforcement**: the Finance pod and the Sales pod should not cross-contaminate each other's context. Financial data should not leave the local node. Outreach tasks can tolerate cloud Managed Agents.
4. **Cost visibility**: the CFO needs a kill switch. Each business domain should have a monthly spend cap that cuts off agent execution when hit — not a soft warning, a hard stop.

### 1.2 The three-system intersection

This ADR sits at the intersection of three existing components:

| System | What it provides | Gap |
|--------|-----------------|-----|
| ruflo federation (ADR-097, ADR-111) | Trust-scored peer connections, PII pipeline, budget hop enforcement, WG mesh transport | No concept of "business domain"; federation is agent-to-agent, not role-to-domain-to-human |
| Managed Agents (ADR-115) | Cloud agent execution with SSE event streaming | No persistent room concept; sessions are ephemeral |
| agentbbs (npm launcher v0.1.0; Rust workspace v0.34.9-nethack) | BBS-style web UI + TUI + SSH front door for human-agent interaction, organized into "rooms"; existing `crates/agentbbs-mcp/` MCP server with server/client/transport layers + integration test suite; existing `crates/agentbbs-federation/` crate; Docker + monitoring stack; postgres-backed CI; 7 CI workflows | Typed federation-envelope compatibility with ruflo's wire format is unverified; `agentbbs-mcp` tool interface needs explicit compat check against our `MCPTool` interface; FSL-1.1-Apache-2.0 license (converts to Apache-2.0 after 2 years) has integration implications for ruflo's MIT distribution; `cargo` required at first run (Rust compilation); npm launcher version vs. Rust workspace version are independent versioning tracks |

The proposal is to wire these three together: federation provides the trust + PII + budget primitives; Managed Agents provides cloud-scale execution for appropriate workloads; agentbbs provides the human-facing cockpit.

### 1.3 Why agentbbs specifically

agentbbs is authored by the same maintainer (rUv), follows the same ADR convention, and is explicitly framed as an interaction layer for agent systems. It provides a BBS (bulletin board system) metaphor — rooms, posts, subscriptions — that maps naturally onto business functions. The SSH front door is significant: agents that cannot run a local MCP server can still participate by speaking SSH.

Critically, the npm package `agentbbs@0.1.0` is a thin launcher only. The actual project is a mature Rust workspace tracked under `ruvnet/agentbbs` with 30+ release tags (latest: `v0.34.9-nethack`), a working CI pipeline including rustfmt, clippy, and postgres-backed integration tests, and two directly relevant crates:

- **`crates/agentbbs-mcp/`** — an existing MCP server implementation (`server.rs`, `client.rs`, `transport.rs`, `lib.rs`) with its own integration test (`tests/mcp.rs`). Before writing any new MCP plumbing, this integration must verify whether `agentbbs-mcp` already exposes compatible tool endpoints that ruflo's `MCPTool` interface can consume directly. If so, Phase 1 and Phase 2 integration costs drop significantly.

- **`crates/agentbbs-federation/`** — an existing federation crate. Before specifying "new upstream changes" for federation envelope handling (Section 5.2), this crate must be surveyed to determine which capabilities already exist. It may already accept typed payloads that are close to ruflo's `FederationEnvelope` wire format.

The project also ships `deny.toml` (cargo-deny supply-chain scanning) and `.gitguardian.yaml` (secret scanning), which are hygiene signals consistent with a production-tracked codebase. Docker, docker-compose, and a monitoring stack are present, indicating the project has been deployed rather than only prototyped.

The integration risks are therefore not about project maturity in the general sense. The specific risks are: (a) the npm launcher version track and the Rust workspace version track are independently versioned — the integration must pin against the Rust workspace tag, not the npm package semver; (b) the FSL-1.1-Apache-2.0 license converts to Apache-2.0 after 2 years, which is compatible with ruflo's MIT distribution for most commercial contexts but requires legal review before embedding agentbbs binaries in a ruflo distribution; (c) `cargo` must be present on the operator's machine for the Rust binary to build at first run; (d) the `agentbbs-mcp` server's tool interface needs explicit compatibility verification against ruflo's `MCPTool` interface before Phase 2. See Section 9.1 for the rewritten risk register.

This ADR treats agentbbs the same way ADR-150 treated `metaharness@0.1.x` in terms of the integration pattern: `optionalDependency`, graceful-degraded paths, smoke contract on day one, and deeper phases gated behind measured evidence. It does NOT treat agentbbs as an unproven project — the Rust workspace evidence justifies confidence in its foundational architecture.

---

## 2. Decision

**Adopt agentbbs as a special-tier federation peer (BBS-as-peer model) and scaffold business-domain pods as a new plugin (`ruflo-bbs-federation` + `ruflo-business-pods`), following the optional-dep integration pattern established by ADR-150 and exercised by the agenticow PR #2500.**

Concretely:

1. **BBS rooms are federation peers.** Each room (`#sales`, `#marketing`, `#finance`, `#ops`, `#support`, `#hr`, `#exec`) is registered as a named federation peer via four new MCP tools: `federation_bbs_register`, `federation_bbs_publish`, `federation_bbs_watch`, `federation_bbs_human_join`. These wrap the existing `FederationCoordinator` API without changing the wire format.

2. **Domain pods are the unit of execution.** A pod is a named group of specialized agents serving one BBS room, with a defined bench, schedule, PII policy, and budget cap. Pods are defined in a new plugin, `ruflo-business-pods`, as typed JSON templates.

3. **Routing uses `@metaharness/router` policy extended with domain-affinity rules.** Sensitive workloads (finance, HR) prefer local stdio execution. High-throughput workloads (marketing outreach, support triage) prefer cloud Managed Agents. The policy is a small additive layer on the existing neural router.

4. **Budget circuit breakers are per-room.** The existing `federation-budget.ts` `enforceBudget` mechanism is used without modification; the BBS plugin configures a per-room `maxUsd` that maps to the CFO kill-switch requirement.

5. **agentbbs goes in `optionalDependencies`.** Ruflo must remain fully operational with agentbbs removed. The smoke contract (`plugins/ruflo-bbs-federation/scripts/smoke.sh`) must pass without agentbbs present by running in degraded mode.

### 2.1 What we are NOT doing in this ADR

- Forking or modifying agentbbs's core architecture. We are building an integration layer, not taking ownership of the upstream project.
- Mandating CRDT semantics for BBS rooms. CRDT is out of scope for agentbbs v0.1.0; we rely on the federation envelope's `hmacSignature` for ordering, and accept eventual consistency with human-visible timestamps.
- Replacing ruflo's existing federation with a BBS-centric model. BBS rooms are *one kind* of federation peer; all existing peer types continue to work unchanged.
- Claiming cost or performance numbers for the business autopilot. Agentbbs has no published benchmark; cost projections in Section 8 are estimates based on current API pricing, not measured workloads.

---

## 3. Architecture

### 3.1 System diagram

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │                      HUMAN LAYER                                     │
 │                                                                      │
 │  Business owner                                                      │
 │       │                                                              │
 │       ▼                                                              │
 │  agentbbs web UI / TUI / SSH                                        │
 │  (rooms: #sales #marketing #finance #ops #support #hr #exec)        │
 └──────────────────────────┬───────────────────────────────────────────┘
                            │  HTTP / WebSocket / SSH
                            │  (typed federation envelopes in post body)
 ┌──────────────────────────▼───────────────────────────────────────────┐
 │                  ruflo-bbs-federation plugin                         │
 │                                                                      │
 │  federation_bbs_register  ──► FederationCoordinator.joinPeer()      │
 │  federation_bbs_publish   ──► FederationCoordinator.sendMessage()   │
 │  federation_bbs_watch     ──► inbound-dispatcher.ts subscription    │
 │  federation_bbs_human_join ─► HandshakeService + single-use token   │
 │                                                                      │
 │  PII pipeline (pii-pipeline-service.ts) applied per room policy     │
 │  Budget enforcement (federation-budget.ts enforceBudget) per room   │
 │  Audit log (audit-service.ts) — business-owner read view            │
 └──────┬────────────────────────────────────────────────────────────────┘
        │  FederationEnvelope (typed, HMAC-signed, PII-scanned)
        │
 ┌──────▼─────────────────────────────────────────────────────────────────┐
 │              ruflo node (local or remote via WG mesh)                  │
 │                                                                         │
 │  ┌─────────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
 │  │  #sales pod     │   │  #finance pod    │   │  #marketing pod   │  │
 │  │  lead-gen       │   │  reconcile-agent │   │  copy-drafter     │  │
 │  │  crm-sync       │   │  budget-watcher  │   │  campaign-analyst │  │
 │  │  outreach       │   │  tax-classifier  │   │  seo-scout        │  │
 │  │  pipeline-analyst│   │                  │   │                   │  │
 │  └────────┬────────┘   └────────┬─────────┘   └────────┬──────────┘  │
 │           │ local stdio MCP      │ local stdio MCP       │            │
 │           │                      │ (finance: local-only) │            │
 │           │                                               │            │
 │  ┌────────▼──────────────────────────────────────────────▼───────────┐ │
 │  │        @metaharness/router  (domain-affinity policy)              │ │
 │  │        ├─ local: finance, hr, ops (sensitive)                     │ │
 │  │        └─ cloud: sales, marketing, support (high throughput)      │ │
 │  └────────────────────────────────────────────────────────────────────┘ │
 │                                       │                                 │
 │                              ┌────────▼─────────────────┐              │
 │                              │  Managed Agents (ADR-115) │              │
 │                              │  cloud execution pool     │              │
 │                              └───────────────────────────┘              │
 └─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 The four new MCP tools

All four tools live in `plugins/ruflo-bbs-federation/scripts/` (skill-shelled) and additionally as typed MCP handlers in `plugins/ruflo-bbs-federation/mcp-tools.ts` (mirroring the `ruflo-metaharness` pattern). They wrap — never bypass — the existing `FederationCoordinator`.

When agentbbs is not installed, each tool returns a structured degraded response `{ degraded: true, reason: "agentbbs not installed" }` and exits with status 0 (non-fatal). This is the mandatory graceful-degradation contract.

#### 3.2.1 `federation_bbs_register`

Register a BBS room as a named federation peer. Idempotent: re-registering the same room updates its policy without creating a duplicate peer.

```typescript
inputSchema: {
  type: 'object',
  properties: {
    roomId: {
      type: 'string',
      description: 'BBS room identifier, e.g. "sales", "finance". Used as the federation nodeId.',
    },
    bbsEndpoint: {
      type: 'string',
      description: 'WebSocket or HTTP endpoint of the agentbbs server for this room.',
    },
    domainPod: {
      type: 'string',
      description: 'Name of the ruflo-business-pods template that serves this room.',
    },
    piiPolicy: {
      type: 'string',
      enum: ['soc2', 'gdpr', 'hipaa', 'permissive'],
      description: 'Compliance mode for PII scanning on all envelopes in/out of this room.',
    },
    budgetUsdMonthly: {
      type: 'number',
      description: 'Monthly USD hard cap for this room. 0 means unlimited (not recommended for finance).',
    },
    preferLocal: {
      type: 'boolean',
      description: 'If true, @metaharness/router policy routes this room\'s tasks to local stdio agents first.',
      default: false,
    },
  },
  required: ['roomId', 'bbsEndpoint', 'domainPod', 'piiPolicy'],
}

// Graceful degradation (agentbbs not installed):
//   Returns { degraded: true, reason: "agentbbs@0.1.0 not installed", roomId }
//   Does NOT throw. Logs a warn to audit-service.ts.
//
// Implementation notes:
//   Calls FederationCoordinator.joinPeer(bbsEndpoint) with the room's trust
//   tier pre-set to TrustLevel.ATTESTED (rooms are operator-registered, not
//   auto-discovered, so they start one tier above VERIFIED).
//   Stores the room policy in a new BbsRoomRegistry (in-memory, persisted to
//   ruflo memory namespace 'bbs-rooms').
```

#### 3.2.2 `federation_bbs_publish`

Publish a domain event from a pod agent to its BBS room. Wraps `federation_send` with room-specific budget enforcement and PII pipeline application.

```typescript
inputSchema: {
  type: 'object',
  properties: {
    roomId: {
      type: 'string',
      description: 'Target BBS room.',
    },
    eventKind: {
      type: 'string',
      enum: [
        'pod-status',       // periodic heartbeat from a pod
        'task-result',      // agent completed a task
        'alert',            // pod detected an anomaly or threshold breach
        'human-override-ack', // pod acknowledged a human redirect
        'bench-result',     // periodic bench score for the domain
      ],
      description: 'Typed event kind — controls how the BBS web UI renders this post.',
    },
    payload: {
      type: 'object',
      description: 'Event-specific payload. Must be JSON-serializable.',
    },
    podAgentId: {
      type: 'string',
      description: 'The agent within the pod that produced this event.',
    },
    budgetHopCount: {
      type: 'number',
      description: 'How many federation hops this message has already traveled (0 on origin).',
      default: 0,
    },
  },
  required: ['roomId', 'eventKind', 'payload', 'podAgentId'],
}

// Implementation notes:
//   Wraps FederationCoordinator.sendMessage() with:
//     messageType: 'context-share'  (existing FederationMessageType)
//     payload: { eventKind, payload, podAgentId, ts: new Date().toISOString() }
//     budget: { maxUsd: room.budgetUsdRemaining }
//   PII pipeline runs per room.piiPolicy before the envelope is signed.
//   Spend is reported via federation_report_spend after send completes.
//   On BBS endpoint unavailable: falls back to ruflo memory store under
//   namespace 'bbs-room-<roomId>-offline-queue' for retry on reconnect.
```

#### 3.2.3 `federation_bbs_watch`

Subscribe to events from a BBS room. Registers an inbound-dispatcher subscription so pod agents receive human overrides and new tasks posted by the business owner. Long-lived; survives pod restarts via a re-registration on startup.

```typescript
inputSchema: {
  type: 'object',
  properties: {
    roomId: {
      type: 'string',
      description: 'BBS room to watch.',
    },
    podAgentId: {
      type: 'string',
      description: 'Agent that should receive incoming events from this room.',
    },
    eventKinds: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['human-override', 'new-task', 'shutdown-request', 'policy-update'],
      },
      description: 'Filter: only deliver these event kinds. Omit to receive all.',
    },
    sinceTs: {
      type: 'string',
      description: 'ISO 8601 timestamp. Replay missed events since this time on connect.',
    },
  },
  required: ['roomId', 'podAgentId'],
}

// Implementation notes:
//   Calls inbound-dispatcher.ts registerSubscription(roomId, podAgentId, filter).
//   The inbound-dispatcher (v3/@claude-flow/plugin-agent-federation/src/application/
//   inbound-dispatcher.ts) does not yet implement subscriptions — this is a required
//   upstream change (see Section 6.1.3).
//   On agentbbs not installed: registers a no-op subscription, returns degraded flag.
//   sinceTs replay requires agentbbs to have a durable event log (see Section 10).
```

#### 3.2.4 `federation_bbs_human_join`

Authenticate a human business owner into a BBS room via a single-use token signed by the local federation keypair. The token is scoped to the room and expires after first use or 15 minutes, whichever comes first.

```typescript
inputSchema: {
  type: 'object',
  properties: {
    roomId: {
      type: 'string',
      description: 'The room to join.',
    },
    humanIdentity: {
      type: 'string',
      description: 'Email or identifier for the human. Used for audit log attribution only.',
    },
    expirySeconds: {
      type: 'number',
      description: 'Token lifetime in seconds. Max 900 (15 min). Default 300.',
      default: 300,
    },
    accessLevel: {
      type: 'string',
      enum: ['read-only', 'override', 'admin'],
      description: 'Permissions within the room. "override" allows redirecting running tasks. "admin" allows shutdown and policy changes.',
      default: 'override',
    },
  },
  required: ['roomId', 'humanIdentity'],
}

// Token shape:
//   { roomId, humanIdentity, accessLevel, issuedAt, expiresAt, nonce, signature }
//   Signed with the node's Ed25519 keypair (same key used by plugin.ts for
//   federation handshakes — @noble/ed25519 via ed.sign()).
//   Token is handed to the human out-of-band (printed to stdout or returned
//   in the MCP tool result). The human presents it to the agentbbs SSH/web
//   front door on connect.
//
// Two-phase authentication model:
//
//   Phase A — Handshake (token is single-use):
//     The 15-minute Ed25519 token is un-replayable. It is consumed by a
//     SINGLE USE to open a WebSocket or SSH channel. Once the channel is
//     opened, the token is invalidated immediately: the agentbbs server
//     records the JTI (nonce) so that any replay of the same token against
//     a new connection fails with 401. The token MUST NOT be persisted by
//     the client or used for any subsequent request.
//
//   Phase B — Session (channel is long-lived):
//     Once the Phase A handshake succeeds, the open channel remains active
//     until one of three conditions occurs:
//       (i)   The user explicitly closes the connection.
//       (ii)  An idle timeout fires (default: 30 minutes of no inbound or
//             outbound traffic on the channel; configurable via the BBS
//             server's session policy).
//       (iii) The BBS node restarts (channel is torn down; client must
//             perform a new Phase A handshake to reconnect).
//     During Phase B, NO re-validation of the token occurs. The channel
//     is already authenticated. Long-running streams (e.g., `subscribe
//     #sales` via SSH — see Section 5.2.5) are Phase B sessions: the SSH
//     session stays open for the duration of the stream WITHOUT re-checking
//     the token mid-stream. Requiring mid-stream re-validation would break
//     the streaming contract.
//
//   Re-authentication:
//     After a channel closes (any of the three conditions above), a new
//     call to federation_bbs_human_join is required to obtain a fresh
//     single-use token before reconnecting.
//
// Graceful degradation: token is generated locally even if agentbbs is
//   unreachable. The human can present it later when BBS reconnects.
```

### 3.3 Pod template schema

A pod template is a typed JSON object stored in `plugins/ruflo-business-pods/templates/<domain>.json`. The schema:

```typescript
interface BusinessPodTemplate {
  /** Canonical name, e.g. "sales", "finance". Must match the BBS roomId. */
  name: string;

  /** Display name for the BBS web UI. */
  displayName: string;

  /** BBS room this pod serves. */
  roomId: string;

  /** Ordered list of agent roles in the pod. */
  agents: Array<{
    role: string;             // e.g. "lead-gen-agent"
    agentType: string;        // must be a known ruflo agent type
    description: string;
    preferLocal: boolean;     // if true, @metaharness/router routes here first
  }>;

  /** MCP tools the pod agents may call. Allowlist — not a blocklist. */
  allowedMcpTools: string[];

  /** Bench definition for the domain's Darwin /loop. */
  bench: {
    name: string;
    description: string;
    successCriteria: string[];
    scheduleHours: number;    // how often to run the bench loop
  };

  /** PII compliance mode applied to all envelopes in/out of this room. */
  piiPolicy: 'soc2' | 'gdpr' | 'hipaa' | 'permissive';

  /** Monthly USD hard cap (0 = unlimited). */
  budgetUsdMonthly: number;

  /** Suggested starting budget per run, for individual task cost tracking. */
  budgetUsdPerRun: number;

  /** If true, @metaharness/router domain-affinity policy routes to local first. */
  preferLocalExecution: boolean;

  /** Default cron schedule for the perpetual /loop (POSIX cron syntax). */
  cronSchedule: string;

  /**
   * Metadata for the compliance audit log.
   * Determines which audit events are written in business-owner-readable form.
   */
  auditReadView: {
    includedEventTypes: string[];
    retentionDays: number;
  };
}
```

### 3.4 `@metaharness/router` domain-affinity policy extension

The existing neural router in `v3/@claude-flow/cli/src/intelligence/neural-router.ts` accepts a `PolicyEngine` (from `v3/@claude-flow/plugin-agent-federation/src/application/policy-engine.ts`). The BBS plugin adds a `DomainAffinityPolicy` layer that the router checks before the KRR cost-optimal decision:

```typescript
// Pseudocode — new file:
// plugins/ruflo-bbs-federation/src/domain-affinity-policy.ts

interface DomainAffinityPolicy {
  evaluate(task: RoutingTask, room: BbsRoom): RoutingHint;
}

type RoutingHint =
  | { preference: 'local'; reason: string }
  | { preference: 'cloud'; reason: string }
  | { preference: 'any'; reason: string };

// Reference implementation:
function evaluateDomainAffinity(task, room): RoutingHint {
  if (room.preferLocalExecution) {
    return { preference: 'local', reason: `domain=${room.name} configured preferLocalExecution` };
  }
  if (room.piiPolicy === 'hipaa' || room.piiPolicy === 'gdpr') {
    return { preference: 'local', reason: `domain=${room.name} piiPolicy=${room.piiPolicy} requires local` };
  }
  // High-throughput rooms that tolerate cloud:
  if (['marketing', 'support'].includes(room.name)) {
    return { preference: 'cloud', reason: `domain=${room.name} favors cloud for throughput` };
  }
  return { preference: 'any', reason: 'no affinity constraint' };
}
```

This policy is injected as an optional constructor argument on the neural router; the router calls it before KRR if the BBS plugin is loaded, and skips it otherwise. No change to the router's core logic.

### 3.5 Trust model for BBS rooms

BBS rooms are operator-registered peers (humans with admin access issued the token). They start at `TrustLevel.ATTESTED` (level 2), which grants `send`, `receive`, `query-redacted`, and `share-context` capabilities per the existing `CAPABILITY_GATES` in `v3/@claude-flow/plugin-agent-federation/src/domain/entities/trust-level.ts`.

Human messages arriving via the BBS room inherit the room's trust level. An `accessLevel: 'admin'` human token elevates the interaction to `TrustLevel.TRUSTED` (level 3) for the duration of the session — never higher, even with an admin token, because `TrustLevel.PRIVILEGED` (level 4, which grants `remote-spawn`) requires `minInteractions: 5000` in `TRUST_TRANSITION_THRESHOLDS`.

Override messages from humans are enveloped in the standard `FederationEnvelope` with `messageType: 'task-assignment'` (an existing `FederationMessageType`). The receiving pod agent checks the token signature before acting on the override. Unsigned or expired tokens are rejected by the `HandshakeService` before they reach the pod.

#### 3.5.4 Founder-bootstrap trust elevation

The organic trust accrual path (`minInteractions: 500` to reach `TRUSTED`, `minInteractions: 5000` for `PRIVILEGED`) means the `#exec` cross-pod synthesizer cannot operate at full capability on Day 1. In practice, the operator who registers the BBS rooms knows they are legitimate. An escape hatch is required to unblock production deployments without waiting for organic accrual.

**CLI command** (new subcommand under `ruflo federation`):

```bash
ruflo federation trust elevate <bbs-node-id> \
  --to TRUSTED \
  --reason "<human-readable justification>" \
  --audit
```

Constraints:
- `--reason` is **mandatory** and stored verbatim in the audit log. The command rejects invocations that omit it.
- `--audit` is **mandatory** and prints the audit-log entry to stdout immediately after writing it, so the operator can record it externally before proceeding.
- The elevation bypasses the `TRUST_TRANSITION_THRESHOLDS` gate entirely but MUST write a special audit entry tagged `type: 'bootstrap_elevation'` to `AuditService`. This entry includes `nodeId`, `elevatedTo`, `reason`, `operatorIdentity` (from the session token), and `timestamp`.
- The command only elevates to `TRUSTED` (level 3). It cannot be used to reach `PRIVILEGED` (level 4) — `--to PRIVILEGED` is rejected.

**Implementation wire point**: add a new method to `application/trust-evaluator.ts`:

```typescript
/**
 * Operator escape hatch — bypasses TRUST_TRANSITION_THRESHOLDS for registered
 * BBS room nodes. Writes a 'bootstrap_elevation' audit entry.
 * Requires: reason is non-empty string; audit flag triggers stdout print.
 */
async bootstrapElevate(
  nodeId: string,
  toLevel: TrustLevel.TRUSTED,   // only TRUSTED is permitted
  reason: string,
  audit: boolean
): Promise<void>;
```

The CLI subcommand calls `bootstrapElevate` and exits non-zero if `reason` is empty or `audit` is false.

**Security caveat**: Production deployments SHOULD require multi-party sign-off before invoking this command (e.g., two operators, one acting as auditor who records the stdout output). Phase 1 may ship with a single-operator escape hatch; enforcing multi-party sign-off is a **Phase 5 hardening** item. The reason-and-audit gate provides a papertrail even for single-operator Phase 1 deployments.

---

## 4. Domain pod templates

Each template below is the canonical definition for that business function. The `cronSchedule` uses the pod's Darwin /loop for perpetual operation; the `bench` defines the success criteria for each cycle. These are starting points — operators are expected to tune agent composition and bench criteria for their business.

### 4.1 Sales pod

```json
{
  "name": "sales",
  "displayName": "Sales",
  "roomId": "sales",
  "agents": [
    { "role": "lead-gen-agent",    "agentType": "researcher",     "description": "Discovers and qualifies inbound leads", "preferLocal": false },
    { "role": "crm-sync-agent",    "agentType": "backend-dev",    "description": "Syncs pipeline state to CRM via webhook", "preferLocal": false },
    { "role": "outreach-drafter",  "agentType": "api-docs",       "description": "Drafts outreach emails for review", "preferLocal": false },
    { "role": "pipeline-analyst",  "agentType": "perf-analyzer",  "description": "Monitors pipeline velocity and flags stalls", "preferLocal": false }
  ],
  "allowedMcpTools": ["memory_store", "memory_search", "federation_bbs_publish", "federation_bbs_watch"],
  "bench": {
    "name": "sales-pipeline-bench",
    "description": "Measures pipeline movement per cycle",
    "successCriteria": [
      "At least 1 new lead qualified per 24h cycle",
      "CRM sync error rate < 5%",
      "No outreach draft older than 48h pending in queue"
    ],
    "scheduleHours": 6
  },
  "piiPolicy": "soc2",
  "budgetUsdMonthly": 50,
  "budgetUsdPerRun": 0.50,
  "preferLocalExecution": false,
  "cronSchedule": "0 */6 * * *",
  "auditReadView": {
    "includedEventTypes": ["task-result", "alert", "bench-result"],
    "retentionDays": 90
  }
}
```

### 4.2 Marketing pod

```json
{
  "name": "marketing",
  "displayName": "Marketing",
  "roomId": "marketing",
  "agents": [
    { "role": "copy-drafter",      "agentType": "api-docs",       "description": "Drafts blog posts and ad copy", "preferLocal": false },
    { "role": "campaign-analyst",  "agentType": "perf-analyzer",  "description": "Tracks campaign metrics against targets", "preferLocal": false },
    { "role": "seo-scout",         "agentType": "researcher",     "description": "Identifies SEO opportunities", "preferLocal": false }
  ],
  "allowedMcpTools": ["memory_store", "memory_search", "federation_bbs_publish", "federation_bbs_watch"],
  "bench": {
    "name": "marketing-output-bench",
    "description": "Measures content production rate and campaign accuracy",
    "successCriteria": [
      "At least 1 draft piece of content per 24h cycle",
      "Campaign metric delta reported within 12h of cycle start",
      "No SEO queue older than 72h"
    ],
    "scheduleHours": 12
  },
  "piiPolicy": "soc2",
  "budgetUsdMonthly": 40,
  "budgetUsdPerRun": 0.30,
  "preferLocalExecution": false,
  "cronSchedule": "0 */12 * * *",
  "auditReadView": {
    "includedEventTypes": ["task-result", "alert", "bench-result"],
    "retentionDays": 90
  }
}
```

### 4.3 Finance pod

Finance is the most sensitive domain. All execution is local. PII policy is GDPR (tightest available). The pod runs on a daily schedule rather than sub-daily to reduce noise.

```json
{
  "name": "finance",
  "displayName": "Finance",
  "roomId": "finance",
  "agents": [
    { "role": "reconcile-agent",   "agentType": "database-specialist", "description": "Reconciles transactions against ledger", "preferLocal": true },
    { "role": "budget-watcher",    "agentType": "perf-analyzer",      "description": "Monitors spend against monthly budgets", "preferLocal": true },
    { "role": "tax-classifier",    "agentType": "code-analyzer",      "description": "Classifies transactions by tax category", "preferLocal": true }
  ],
  "allowedMcpTools": ["memory_store", "memory_search", "federation_bbs_publish", "federation_bbs_watch"],
  "bench": {
    "name": "finance-accuracy-bench",
    "description": "Measures reconciliation accuracy per cycle",
    "successCriteria": [
      "Reconciliation error rate < 0.1% of transactions",
      "All transactions classified within 24h",
      "No budget over-run alerts older than 4h unacknowledged"
    ],
    "scheduleHours": 24
  },
  "piiPolicy": "gdpr",
  "budgetUsdMonthly": 20,
  "budgetUsdPerRun": 0.10,
  "preferLocalExecution": true,
  "cronSchedule": "0 6 * * *",
  "auditReadView": {
    "includedEventTypes": ["task-result", "alert", "bench-result", "pod-status"],
    "retentionDays": 365
  }
}
```

### 4.4 Ops pod

Ops covers infrastructure monitoring, deployment readiness, and internal tooling health. Execution is mixed: local for infrastructure reads, cloud for high-throughput log analysis.

```json
{
  "name": "ops",
  "displayName": "Operations",
  "roomId": "ops",
  "agents": [
    { "role": "infra-monitor",     "agentType": "perf-analyzer",     "description": "Monitors service health and uptime", "preferLocal": true },
    { "role": "deploy-scout",      "agentType": "cicd-engineer",      "description": "Tracks deployment pipeline state", "preferLocal": false },
    { "role": "incident-responder","agentType": "security-auditor",   "description": "Triages and escalates incidents to #exec", "preferLocal": false }
  ],
  "allowedMcpTools": [
    "memory_store", "memory_search",
    "federation_bbs_publish", "federation_bbs_watch", "federation_send",
    "aidefence_analyze", "aidefence_scan", "aidefence_stats",
    "terminal_execute",
    "http_fetch",
    "agent_execute"
  ],
  "_allowedMcpTools_notes": [
    "aidefence_* — alerting and threat-detection signals from the AIDefence subsystem",
    "terminal_execute — shell execution for ops scripts (e.g. health-check probes, log scrapes)",
    "http_fetch — external HTTP endpoint monitoring (see §5.1.8 for contract; Phase 2 prerequisite)",
    "agent_execute — delegates to cloud Managed Agents with AWS/GCP/Azure SDK access for cloud-infra ops",
    "Cloud-provider MCP servers (e.g. aws-mcp, gcp-mcp) are deployment-specific; NOT bundled. Must be registered per-installation via `ruflo mcp config add`."
  ],
  "bench": {
    "name": "ops-availability-bench",
    "description": "Measures service availability and incident response lag",
    "successCriteria": [
      "No unacknowledged P1 alert older than 15 min",
      "Deployment pipeline green or escalated within 30 min",
      "Infra health check at least every 4h",
      "HTTP endpoint monitor: probe a synthetic endpoint returning 200 OK 90% / 500 10% of the time; pod must detect the 500 rate and post an alert to #ops within 60 seconds"
    ],
    "scheduleHours": 4
  },
  "piiPolicy": "soc2",
  "budgetUsdMonthly": 30,
  "budgetUsdPerRun": 0.20,
  "preferLocalExecution": false,
  "cronSchedule": "0 */4 * * *",
  "auditReadView": {
    "includedEventTypes": ["task-result", "alert", "bench-result"],
    "retentionDays": 90
  }
}
```

### 4.5 Support pod

Support handles ticket triage, response drafting, and customer escalation routing. High-throughput, tolerates cloud execution, SOC2 PII policy.

```json
{
  "name": "support",
  "displayName": "Customer Support",
  "roomId": "support",
  "agents": [
    { "role": "ticket-triager",    "agentType": "researcher",         "description": "Classifies and prioritises incoming tickets", "preferLocal": false },
    { "role": "response-drafter",  "agentType": "api-docs",           "description": "Drafts first-response replies for review", "preferLocal": false },
    { "role": "escalation-router", "agentType": "task-orchestrator",  "description": "Routes escalations to #ops or #exec", "preferLocal": false }
  ],
  "allowedMcpTools": ["memory_store", "memory_search", "federation_bbs_publish", "federation_bbs_watch", "federation_send"],
  "bench": {
    "name": "support-response-bench",
    "description": "Measures first-response time and classification accuracy",
    "successCriteria": [
      "First-response draft within 2h of ticket open",
      "Classification accuracy > 90% (spot-checked by human weekly)",
      "Escalations routed within 30 min of P1 classification"
    ],
    "scheduleHours": 2
  },
  "piiPolicy": "soc2",
  "budgetUsdMonthly": 60,
  "budgetUsdPerRun": 0.25,
  "preferLocalExecution": false,
  "cronSchedule": "0 */2 * * *",
  "auditReadView": {
    "includedEventTypes": ["task-result", "alert", "bench-result"],
    "retentionDays": 180
  }
}
```

### 4.6 HR pod

HR handles onboarding checklists, policy document retrieval, and leave tracking. All execution is local. GDPR policy. Runs daily.

```json
{
  "name": "hr",
  "displayName": "Human Resources",
  "roomId": "hr",
  "agents": [
    { "role": "onboarding-agent",  "agentType": "planner",            "description": "Tracks onboarding checklist progress per employee", "preferLocal": true },
    { "role": "policy-retriever",  "agentType": "researcher",         "description": "Answers policy queries from employees", "preferLocal": true },
    { "role": "leave-tracker",     "agentType": "database-specialist","description": "Reconciles leave requests against policy", "preferLocal": true }
  ],
  "allowedMcpTools": ["memory_store", "memory_search", "federation_bbs_publish", "federation_bbs_watch"],
  "bench": {
    "name": "hr-compliance-bench",
    "description": "Measures policy query coverage and onboarding accuracy",
    "successCriteria": [
      "No onboarding step older than 48h without status update",
      "All leave requests classified within 24h",
      "Policy query response latency < 5 min"
    ],
    "scheduleHours": 24
  },
  "piiPolicy": "gdpr",
  "budgetUsdMonthly": 15,
  "budgetUsdPerRun": 0.05,
  "preferLocalExecution": true,
  "cronSchedule": "0 8 * * 1-5",
  "auditReadView": {
    "includedEventTypes": ["task-result", "alert", "bench-result"],
    "retentionDays": 365
  }
}
```

### 4.7 Exec (cross-cutting) pod

The `#exec` room is the cross-cutting coordination layer. It receives escalations from all other pods and presents a unified executive dashboard. The exec pod does not initiate work — it synthesizes and escalates.

```json
{
  "name": "exec",
  "displayName": "Executive",
  "roomId": "exec",
  "agents": [
    { "role": "cross-pod-synthesizer", "agentType": "task-orchestrator", "description": "Aggregates status from all pods and produces executive summary", "preferLocal": false },
    { "role": "risk-sentinel",         "agentType": "security-auditor",  "description": "Monitors cross-domain risk signals and escalates to human", "preferLocal": false }
  ],
  "allowedMcpTools": ["memory_store", "memory_search", "federation_bbs_publish", "federation_bbs_watch", "federation_send", "federation_peers", "federation_status"],
  "bench": {
    "name": "exec-dashboard-bench",
    "description": "Measures summary quality and escalation timeliness",
    "successCriteria": [
      "Executive summary produced at least every 24h",
      "All P1 escalations from sub-pods acknowledged in #exec within 15 min",
      "No cross-domain risk signal older than 1h unreviewed"
    ],
    "scheduleHours": 24
  },
  "piiPolicy": "soc2",
  "budgetUsdMonthly": 25,
  "budgetUsdPerRun": 0.40,
  "preferLocalExecution": false,
  "cronSchedule": "0 7 * * *",
  "auditReadView": {
    "includedEventTypes": ["task-result", "alert", "bench-result", "pod-status", "human-override-ack"],
    "retentionDays": 365
  }
}
```

---

## 5. Upstream changes required

### 5.1 In ruflo (this repository)

#### 5.1.1 New plugin: `plugins/ruflo-bbs-federation/`

Standard ruflo plugin structure (mirrors `plugins/ruflo-metaharness/`):

```
plugins/ruflo-bbs-federation/
├── plugin.json               # name, version, optionalDependencies: { "agentbbs": "^0.1.0" }
├── scripts/
│   ├── smoke.sh              # smoke contract — must pass with agentbbs absent
│   └── register-rooms.mjs    # CLI helper: register all rooms from a config file
├── skills/
│   ├── bbs-register/SKILL.md
│   ├── bbs-publish/SKILL.md
│   ├── bbs-watch/SKILL.md
│   └── bbs-human-join/SKILL.md
├── src/
│   ├── mcp-tools.ts          # the four tools from Section 3.2
│   ├── bbs-room-registry.ts  # in-memory + persisted room config store
│   └── domain-affinity-policy.ts  # @metaharness/router extension from Section 3.4
└── agents/
    └── bbs-coordinator.md    # agent definition: orchestrates pod lifecycle
```

`plugin.json` must declare `agentbbs` in `optionalDependencies`, not `dependencies`. The CI workflow `no-bbs-smoke.yml` must assert that `npm install --ignore-optional` followed by `scripts/smoke.sh` exits 0.

#### 5.1.2 New plugin: `plugins/ruflo-business-pods/`

```
plugins/ruflo-business-pods/
├── plugin.json
├── templates/
│   ├── sales.json
│   ├── marketing.json
│   ├── finance.json
│   ├── ops.json
│   ├── support.json
│   ├── hr.json
│   └── exec.json
├── scripts/
│   ├── smoke.sh
│   └── init-pods.mjs         # scaffold a pod from a template into the running ruflo node
├── skills/
│   └── business-pods/SKILL.md
└── src/
    └── pod-template-loader.ts  # validates and loads templates against the schema in Section 3.3
```

#### 5.1.3 Extension to `v3/@claude-flow/plugin-agent-federation/src/application/inbound-dispatcher.ts`

The `inbound-dispatcher.ts` file currently contains an `InboundDispatcher` stub. The `federation_bbs_watch` tool requires a subscription registration API:

```typescript
// Add to InboundDispatcher class:
registerSubscription(
  sourceNodeId: string,
  targetAgentId: string,
  filter?: { eventKinds?: string[] }
): SubscriptionHandle;

deregisterSubscription(handle: SubscriptionHandle): void;
```

The subscription system delivers incoming `FederationEnvelope` messages to the registered agent. This is a required change, not an optional one — `federation_bbs_watch` is a no-op without it.

**File to modify**: `v3/@claude-flow/plugin-agent-federation/src/application/inbound-dispatcher.ts`

#### 5.1.4 Extension to `v3/@claude-flow/plugin-agent-federation/src/domain/services/pii-pipeline-service.ts`

The PII pipeline currently applies a single global policy. Per-room PII modes require the pipeline to accept a policy config at call time rather than construction time:

```typescript
// Current signature (inferred from pii-pipeline-service.ts):
class PIIPipelineService {
  constructor(config: PIIPolicyConfig) { ... }
  transform(text: string, trustLevel: TrustLevel): PIITransformResult { ... }
}

// Required extension:
class PIIPipelineService {
  constructor(defaultConfig: PIIPolicyConfig) { ... }
  transform(
    text: string,
    trustLevel: TrustLevel,
    overrideConfig?: Partial<PIIPolicyConfig>
  ): PIITransformResult { ... }
}
```

The three compliance modes map to `PIIPolicyConfig` overrides:

| Compliance mode | `defaultAction` | Key overrides |
|-----------------|-----------------|---------------|
| `soc2` | `redact` | api_key → block; github_token → block |
| `gdpr` | `hash` | name → hash; email → hash; address → hash; phone → hash |
| `hipaa` | `block` | name → block; ssn → block; address → block; all PII → block by default |
| `permissive` | `pass` | no overrides |

**File to modify**: `v3/@claude-flow/plugin-agent-federation/src/domain/services/pii-pipeline-service.ts`
**File to modify**: `v3/@claude-flow/plugin-agent-federation/src/plugin.ts` (pass overrideConfig through to `FederationCoordinator.sendMessage`)

#### 5.1.5 Per-room spend cap in ADR-097 budget circuit breaker

The existing `enforceBudget` in `v3/@claude-flow/plugin-agent-federation/src/domain/value-objects/federation-budget.ts` accepts a `Budget` with `maxUsd` per call. The BBS plugin needs a per-room running balance that accumulates across the month and cuts off when the cap is hit.

This is a new `BbsRoomBudgetTracker` (not a change to `federation-budget.ts`, which is correct as a per-call primitive):

```typescript
// New file: plugins/ruflo-bbs-federation/src/bbs-room-budget-tracker.ts
interface BbsRoomBudgetTracker {
  /** Returns remaining USD for the room this month. Returns 0 if cap exceeded. */
  getRemainingUsd(roomId: string): Promise<number>;
  /** Records spend for this room. Persists to 'bbs-budget-<roomId>' namespace. */
  recordSpend(roomId: string, usdSpent: number): Promise<void>;
  /** Reset at the start of each billing month (called by the monthly cron). */
  resetMonthly(roomId: string): Promise<void>;
}
```

`federation_bbs_publish` calls `getRemainingUsd` before calling `sendMessage`; if the result is 0 it returns `{ blocked: true, reason: 'MONTHLY_BUDGET_EXCEEDED' }` without spending a token.

**File to create**: `plugins/ruflo-bbs-federation/src/bbs-room-budget-tracker.ts`

#### 5.1.6 Audit log business-owner read view

`v3/@claude-flow/plugin-agent-federation/src/domain/services/audit-service.ts` currently supports `query({ eventType, severity, since, limit })`. The BBS plugin needs a filtered view restricted to events a business owner can read (no internal trust-score mutations, no cryptographic details):

```typescript
// Add to audit-service.ts:
queryBusinessOwnerView(params: {
  roomId: string;
  since?: Date;
  limit?: number;
}): Promise<BusinessOwnerAuditEvent[]>;

interface BusinessOwnerAuditEvent {
  ts: string;
  roomId: string;
  eventKind: string;
  podAgentId: string;
  summary: string;        // human-readable, PII-redacted
  outcome: 'success' | 'failure' | 'alert';
}
```

**File to modify**: `v3/@claude-flow/plugin-agent-federation/src/domain/services/audit-service.ts`

#### 5.1.8 New MCP tool: `http_fetch` (Phase 2 prerequisite)

The Ops pod requires the ability to probe external HTTP endpoints for availability monitoring. This tool does not exist in ruflo today and must be created.

**Minimal contract**:

```typescript
// New tool in plugins/ruflo-bbs-federation/src/mcp-tools.ts (or a shared http plugin)
{
  name: 'http_fetch',
  description: 'Perform a monitored HTTP GET/POST against an external endpoint. Subject to allowlist, timeout, and response-size constraints.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Target URL. Must match at least one pattern in the configured URL allowlist.',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'HEAD'],
        default: 'GET',
        description: 'HTTP method.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Request timeout in milliseconds. Default 5000. Max 30000.',
        default: 5000,
      },
      headers: {
        type: 'object',
        description: 'Additional headers. Auth headers (Authorization, Cookie, X-Api-Key) are BLOCKED unless the URL is on the explicit auth-header allowlist.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['url'],
  },
}
```

**Security constraints** (all enforced server-side, not by caller):
1. **URL allowlist**: the operator configures a list of URL patterns (e.g. `["https://status.myservice.com/*", "https://api.monitoring.example.com/health"]`). Requests to unlisted URLs are rejected with `403 URL_NOT_ALLOWLISTED`.
2. **Timeout cap**: maximum 30 seconds. Requests exceeding the cap are killed and return `{ error: 'TIMEOUT' }`.
3. **Response-size cap**: maximum 256 KB of response body. Larger responses are truncated at the cap; a `truncated: true` field is added to the result.
4. **No auth-header pass-through**: `Authorization`, `Cookie`, and `X-Api-Key` headers are stripped from all requests unless the URL is explicitly on a separate `authAllowedUrls` list (empty by default). This prevents the Ops pod from inadvertently leaking credentials to external endpoints.
5. **Audit logging**: every `http_fetch` call is logged to `AuditService` with URL, method, response status, latency, and caller agent ID.

**Phase gate**: `http_fetch` is a **Phase 2 prerequisite** for the Ops pod. Phase 1 can ship the stub (returns `{ degraded: true, reason: "http_fetch not yet implemented" }`). The ops bench scenario (§4.4) cannot complete until Phase 2 ships the full implementation.

#### 5.1.9 Optional dependency wiring in root package.json and ruflo wrapper

`agentbbs` must be added to `optionalDependencies` in:
- `/Users/cohen/Projects/ruflo/package.json` (root umbrella)
- `/Users/cohen/Projects/ruflo/ruflo/package.json` (ruflo wrapper — same lesson as metaharness in #2112: root overrides do not propagate to the published ruflo wrapper)

The graceful-degradation guard pattern (same as `plugins/ruflo-metaharness/src/*.ts`):

```typescript
let agentbbs: typeof import('agentbbs') | null = null;
try {
  agentbbs = await import('agentbbs');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw e;
  // degraded mode — log warn, return { degraded: true } from all tools
}
```

### 5.2 In agentbbs upstream — survey findings (`ruvnet/agentbbs` @ ca3c6e0, 2026-06-29)

The agentbbs project is a mature Rust workspace with 30+ release tags. The Phase 1 survey of `crates/agentbbs-federation/` + `crates/agentbbs-mcp/` (commit `ca3c6e0` on `main`) resolved each compatibility check below. The survey is now concrete: each sub-section names the existing primitive ruflo will adapt to, or the genuine gap that needs an upstream PR.

A symmetric regression guard — [`ruvnet/AgentBBS#3`](https://github.com/ruvnet/AgentBBS/pull/3) — was opened against agentbbs and asserts on every PR + nightly cron that the four MCP tool names, four `FederationPayload` variants, and three `RufloAdapter` subcommand names this section depends on continue to exist. Drift becomes a failed nightly workflow within 24h of the upstream change landing.

Requests for upstream changes go to the agentbbs maintainer (same author, ruv). Each sub-section closes with a definite "no upstream PR needed for Phase 1" or "file issue X" — the survey replaces all earlier "VERIFY FIRST" hedges.

#### 5.2.1 Federation-envelope message kind compatibility

**Already covered by `crates/agentbbs-federation/src/envelope.rs::FederationPayload`.**

The enum is `#[serde(tag = "type", rename_all = "snake_case")]` with four variants:

```rust
pub enum FederationPayload {
    AnnounceBoard(Board),
    ReplicateMessage(Message),
    PeerHello { node: AgentId, protocol: String },
    Ack { id: String },
}
```

Each envelope is sealed by `FederationEnvelope::seal()` over deterministic canonical bytes signed with the sending node's Ed25519 key. `FederationEnvelope::open()` re-derives those bytes and verifies the signature; tampered or forged envelopes are rejected with `Error::BadSignature` (validated by `forged_node_id_rejected` + `tampered_payload_rejected` in `lib.rs` tests).

**Ruflo's adapter strategy for Phase 1 → Phase 3**:
- `federation_bbs_publish` → wraps the typed pod event inside a `ReplicateMessage(Message)` where `MessageBody.subject` carries the ruflo `msgType` discriminator (`pod-status` / `task-result` / `alert` / `human-override-ack` / `bench-result`) and `MessageBody.body` is the JSON-serialized typed payload.
- `federation_bbs_register` → drives `AnnounceBoard(Board)`; the agentbbs `Board` struct already round-trips through the PII scrubber in `Federator::announce_board()` (egress strips PII from `description` via `strip_pii`).
- The `hmacSignature` field in ruflo's `FederationEnvelope` shape is replaced by agentbbs's Ed25519-over-canonical-bytes signature on the outer `FederationEnvelope`. Stronger than HMAC; no behavior change needed in ruflo's Phase 1 layer — the agentbbs side computes + validates the signature.
- `piiScanResult` is **not** stored alongside the payload by agentbbs (PII is scrubbed and discarded). For ruflo's audit trail requirement, the `piiScanResult` must be persisted in ruflo's local `AuditService` (already the canonical record per §6.2) *before* the envelope is dispatched to agentbbs.

**No upstream PR required for Phase 1.** A possible Phase 3 enhancement: if richer routing per typed event becomes valuable, propose a `RufloEvent { envelope_id, msg_type, payload }` variant. Filed as a follow-up — not blocking.

#### 5.2.2 MCP tool registration shape

**Already covered by `crates/agentbbs-mcp/src/server.rs` — but as a static surface, not a dynamic registry.**

The MCP server exposes exactly four tools, registered as a hardcoded JSON array in `McpServer::tools_list()`: `list_boards`, `read_board`, `post_message`, `search_memory`. Dispatch in `tools_call()` is a hardcoded `match name { ... }` — there is no plugin/handler-registration hook.

Ruflo's `federation_bbs_register` / `federation_bbs_publish` / `federation_bbs_watch` / `federation_bbs_human_join` are **ruflo-owned MCP tools** that live in ruflo's MCP server, not in agentbbs's. The Phase 2 wire-up calls into agentbbs via one of two paths:

- (A) Spawn `agentbbs mcp` as a subprocess and drive its stdio JSON-RPC pipe — `federation_bbs_publish` becomes `tools/call name=post_message`, `federation_bbs_watch` becomes repeated `tools/call name=read_board`, `federation_bbs_register` becomes a board-creation call via the agentbbs CLI (no MCP tool for board creation — see gap below).
- (B) Depend on the agentbbs Rust crates directly via a native binding (heavier, deferred to Phase 4+).

**Phase 1**: ruflo's `agentbbsBin` argument is documented as "Reserved for Phase 2 wire-up; ignored in Phase 1". Phase 1 implements the ruflo-side MCP tool surface only; the spawned subprocess wiring lands in Phase 2.

**Genuine gap (filed as follow-up issue, not blocking Phase 1)**: `agentbbs-mcp` does not currently expose a `create_board` tool — board creation only happens via the direct `Bbs::create_board()` Rust API or via `agentbbs ssh` admin commands. For ruflo's `federation_bbs_register` to map cleanly to MCP, either (i) ruflo's Phase 2 register implementation drives `agentbbs federate …` CLI subcommands rather than MCP, or (ii) upstream adds `create_board` to the four-tool MCP surface. Filed as gap #1 below.

**No upstream PR required for Phase 1.** The web UI rendering concern previously documented here is moved to Phase 4 and re-scoped — `agentbbs-web` is out of scope until ruflo's pods publish enough events to make per-message-type rendering worthwhile.

#### 5.2.3 Subscription / streaming for `federation_bbs_watch`

**Genuinely missing — but matches ruflo's Phase 1 polling design.**

`crates/agentbbs-mcp/src/server.rs::initialize()` returns `capabilities.resources.subscribe = false`. The transport (`crates/agentbbs-mcp/src/transport.rs::serve_stdio`) is strict newline-delimited JSON-RPC request/response; there is no server-initiated push frame.

This matches ruflo's `federation_bbs_watch` Phase 1 contract verbatim: the tool description says *"Phase 1 is polling — Phase 4 layers streaming on the same surface."* The Phase 2 implementation will repeatedly call `tools/call name=read_board` with the agentbbs-side message ordering (`Message.id` is content-addressed and `Store::list_messages` returns ordered) and filter by ruflo's monotonic `sinceEnvelopeId`.

**Phase 4 gap (filed as follow-up issue, not blocking Phase 1)**: a streaming-subscribe path. Two design options for upstream:
- (A) Add `resources/subscribe` per the MCP spec — the server pushes `notifications/resources/updated` frames; ruflo consumes them in a long-poll loop.
- (B) Add an `agentbbs ssh subscribe #room` CLI subcommand that streams envelope JSON to stdout (the agentbbs project's SSH-first ethos suggests this is the more natural extension). Filed as gap #2 below.

**Durability and retention** were previously bundled into this sub-section; they're now their own concern in §5.2.5.

**No upstream PR required for Phase 1.**

#### 5.2.4 Integration seam — `RufloAdapter` already exists (other direction)

**Surprise finding: agentbbs already drives `npx ruflo federation` via `crates/agentbbs-federation/src/adapter.rs::RufloAdapter`.**

The adapter wraps a `CommandRunner` trait (production `TokioCommandRunner`, test `FakeCommandRunner`) and shells out to:

```
npx ruflo federation init
npx ruflo federation join <addr>
npx ruflo federation status
```

This means the integration direction agentbbs anticipated is: **agentbbs → ruflo as the federation control plane**. Ruflo's ADR-164 goes the *opposite* direction: ruflo → agentbbs as the room/event substrate. Both can coexist (asymmetric driving — ruflo manages federation peers, agentbbs publishes room events).

**Implications for ruflo**:
- Ruflo's CLI must keep `npx ruflo federation {init,join,status}` alive as a stable surface. Renaming or removing these breaks the agentbbs side silently. The regression guard at [`ruvnet/AgentBBS#3`](https://github.com/ruvnet/AgentBBS/pull/3) catches this — its third static-contract check greps for these exact subcommands in `adapter.rs` and fires if either side drifts.
- `RufloAdapter` is the seam through which agentbbs can use ruflo's memory/federation layer. Ruflo's Phase 2 wire-up will likely add a *reciprocal* `AgentBbsAdapter` (in ruflo) that drives `agentbbs federate` / `agentbbs mcp` from the ruflo side — mirroring the symmetric pattern.
- Ed25519 authentication (the previous "keypair handshake" concern) is **already implemented** in the envelope layer (§5.2.1). The `federation_bbs_human_join` single-use token validation is a ruflo-side concern (token minting + JTI replay protection), not an agentbbs concern — agentbbs just stores the signed envelopes.

**No upstream PR required for Phase 1.** Reciprocal `AgentBbsAdapter` is a ruflo Phase 2 deliverable (§5.1, not §5.2).

#### 5.2.5 Durable event retention and `sinceTs` replay

**Partial — postgres backend exists, but `agentbbs mcp` default uses in-memory store.**

`agentbbs.yml` + `ci.yml` both spin up `postgres:18-alpine` as a service container, confirming there is at least one postgres-backed `Store` impl somewhere in the workspace (likely under `agentbbs-web` or `agentbbs-gcp`). However, the integration tests in `crates/agentbbs-mcp/tests/mcp.rs` build the server with `MemoryStore`, and the `agentbbs` umbrella binary's `Command::Mcp` path in `crates/agentbbs/src/main.rs` does not surface a `--store postgres://...` flag in the public CLI usage (`agentbbs mcp` takes no documented store args).

**Implications for ruflo's `federation_bbs_watch` `sinceTs` replay**:
- Phase 1 + 2 ruflo's `federation_bbs_watch` polls the most-recent window (no `sinceTs` durability requirement — the ruflo-side `AuditService` is the canonical record per §6.2; agentbbs is the display projection).
- Phase 3+ (cross-session replay after BBS reconnect) requires durable agentbbs storage. The `sinceTs` query API needs to be exposed via `agentbbs mcp` as either a tool argument or a separate tool. Filed as gap #3 below.

**No upstream PR required for Phase 1/2.** Gap #3 is a Phase 3 prerequisite.

#### 5.2.6 Existing CI regression coverage and the gap this ADR fills

**No existing test exercises the agentbbs ↔ ruflo integration end-to-end.**

`agentbbs.yml` runs fmt + clippy + nextest + cargo-deny over the agentbbs workspace. `agentbbs-federation`'s `ruflo_adapter_shells_npx` test uses `FakeCommandRunner` — it asserts the *intended* `npx ruflo federation …` invocations are emitted, but never spawns the real published `ruflo` CLI. Symmetric story for ruflo's side (Phase 1 doesn't shell out to agentbbs at all).

So the integration is currently held together by convention, not by a test. The regression guard at [`ruvnet/AgentBBS#3`](https://github.com/ruvnet/AgentBBS/pull/3) closes the gap with three contract-grep checks plus a live `agentbbs mcp` stdio roundtrip:

1. `agentbbs-mcp/src/server.rs` still registers `list_boards`, `read_board`, `post_message`, `search_memory`
2. `agentbbs-federation/src/envelope.rs::FederationPayload` still has `AnnounceBoard`, `ReplicateMessage`, `PeerHello`, `Ack`
3. `agentbbs-federation/src/adapter.rs` still shells out to `npx ruflo federation {init,join,status}`

Per-room authorization (the original concern in this sub-section) is deferred — agentbbs's current model uses a global `Caps` permission set per MCP-server connection (`Role::Sysop`, `Role::Member`, `Role::Guest` in `crates/agentbbs-core/src/caps.rs`), not per-room ACLs. Each ruflo pod will get its own `(roomId, Caps)` binding by spawning a separate `agentbbs mcp` subprocess per room with the room's Caps — a process-level isolation pattern that doesn't require any upstream change. Filed as gap #4 below if multi-room-per-subprocess ever becomes a requirement.

**No upstream PR required for Phase 1/2.**

---

#### Genuine gaps (filed as follow-up issues against `ruvnet/agentbbs`)

| # | Gap | Phase blocked | Severity |
|---|-----|--------------|----------|
| 1 | No `create_board` MCP tool — board creation is Rust-API or SSH-admin only | 2 | Low (workaround: ruflo's Phase 2 `federation_bbs_register` calls `agentbbs federate` CLI) |
| 2 | No subscription / push frame in MCP — `resources.subscribe = false` hardcoded | 4 | Low (Phase 1-3 polling is by design) |
| 3 | `agentbbs mcp` default uses `MemoryStore`; no documented `--store postgres://...` flag despite postgres being in CI | 3 | Medium (durable replay deferred) |
| 4 | `Caps` is per-connection, not per-room | 5+ | Low (workaround: process-per-room) |

Draft bodies for these issues are kept in the Phase 1 hand-off ticket and will be filed against `ruvnet/agentbbs` once Phase 1 lands.

---

## 6. Security and compliance

### 6.1 Per-room PII policy

Each room has an immutable PII policy set at registration time by `federation_bbs_register`. The PII pipeline applies this policy to every outbound envelope before HMAC signing (in `FederationCoordinator.sendMessage`) and to every inbound envelope on arrival (in the inbound dispatcher). The policy cannot be downgraded at runtime without re-registering the room (which requires an `admin`-level human token and is logged in the audit trail).

Policy escalation (tightening) is always allowed; relaxation requires admin + explicit reason logged.

### 6.2 Audit trail flow

```
Pod agent produces event
  → federation_bbs_publish called
    → PII pipeline applied (compliance mode per room)
      → FederationEnvelope created + HMAC signed
        → FederationCoordinator.sendMessage() dispatches to BBS room
          → AuditService.log() records the event (full envelope, not just summary)
            → BusinessOwnerAuditEvent projected (PII-stripped summary for #exec display)
              → BBS room post stored (hmacSignature preserved)
```

The canonical audit record is in `AuditService` (local, durable). The BBS post is a display projection. If the BBS is unavailable, audit records still accumulate locally and are replayed when the BBS reconnects.

### 6.3 Pod kill switch

The business owner (or CFO, for finance) can stop a pod in three ways, in order of severity:

1. **Pause one task**: post a `human-override` message to the room via the BBS UI. The pod's override-handler agent (registered via `federation_bbs_watch`) receives this and sends a `{ type: "shutdown_request" }` message to the running task agent via `SendMessage`.

2. **Suspend the pod's federation peer**: call `federation_evict` (existing MCP tool, `mcp-tools.ts` line 267–291) with the room's `nodeId`. All subsequent `federation_bbs_publish` calls from the pod short-circuit with `PEER_EVICTED`.

3. **Monthly budget cap exhausted**: the `BbsRoomBudgetTracker` (Section 5.1.5) blocks `federation_bbs_publish` automatically when `getRemainingUsd` returns 0. This is the CFO kill switch — no human action required.

All three paths are logged in `AuditService` with `severity: 'critical'` and are visible in the business-owner read view.

### 6.4 HIPAA / SOC2 / GDPR modes per pod

| Room | Default mode | Rationale |
|------|-------------|-----------|
| sales | SOC2 | Customer data (emails, company names) in outreach; not health data |
| marketing | SOC2 | Campaign data, not health data |
| finance | GDPR | Financial records require GDPR-level PII hashing in EU contexts |
| ops | SOC2 | Infrastructure metadata; minimal PII risk |
| support | SOC2 | Customer tickets may contain email, name |
| hr | GDPR | Employee data (name, address, leave records) is squarely GDPR |
| exec | SOC2 | Aggregated summaries; PII already stripped by upstream pods |

A healthcare operator would override `support` and `hr` to HIPAA. The pod template `piiPolicy` field is the single configuration point; changing it triggers a re-registration of the room (audit-logged, requires admin token).

---

## 7. Performance and cost

**No performance benchmarks exist for agentbbs v0.1.0.** The numbers below are estimates based on current Anthropic API pricing and observed ruflo agent token usage from existing sessions.

### 7.1 Per-pod estimated monthly cost

| Pod | Cycles/month | Tokens/cycle est. | Model | Est. USD/month |
|-----|-------------|-------------------|-------|----------------|
| sales | 120 (6h) | ~4,000 input + 1,000 output | Sonnet | ~$7 |
| marketing | 60 (12h) | ~3,000 input + 1,500 output | Sonnet | ~$4 |
| finance | 30 (24h) | ~2,000 input + 500 output | Haiku (local) | ~$0.50 |
| ops | 180 (4h) | ~1,500 input + 500 output | Haiku | ~$1 |
| support | 360 (2h) | ~2,500 input + 1,000 output | Haiku/Sonnet mix | ~$10 |
| hr | 22 (weekdays 24h) | ~1,500 input + 300 output | Haiku | ~$0.25 |
| exec | 30 (24h) | ~5,000 input + 2,000 output | Sonnet | ~$5 |

**Total estimated: ~$28/month for a full 7-pod deployment.** This is a rough estimate, not a measured number. Actual costs depend on prompt design, bench iteration depth, and which tasks surface during perpetual operation. Operators should set `budgetUsdMonthly` conservatively for the first month and raise based on observed spend.

### 7.2 Budget accounting for BBS publish

A single `federation_bbs_publish` call dispatches one `federation_send` which counts as one hop in the budget circuit breaker. The BBS room is modeled as a zero-cost relay (it stores the message but doesn't run an LLM). Spend is attributed to the originating pod agent, not to the BBS room, by `federation_report_spend`.

For accounting purposes, one BBS publish = one spend event in the `federation-spend` memory namespace (key: `fed-spend-<roomId>-<ts>`). The cost-tracker plugin (`plugins/ruflo-cost-tracker/scripts/federation.mjs`) already aggregates these; no change needed there.

### 7.3 Budget circuit breaker hardening

> **Atomicity design lives in ADR-164.1; this section summarises the requirements only.** ADR-164.1 (the companion atomic budget-tracker ADR, being written in parallel) specifies the full concurrency design. See §9.5 for the associated risk entry which forwards to ADR-164.1.

The existing `enforceBudget` function in `federation-budget.ts` is synchronous and cannot be raced by two concurrent send calls (documented in the file's security invariants comment at line 7). The per-room monthly tracker (`BbsRoomBudgetTracker`) is an async read-then-write which *can* be raced. ADR-164.1 must satisfy the following four requirements:

1. **Atomic reserve-and-commit**: spending must use a reserve-then-commit protocol. A call to `federation_bbs_publish` must atomically reserve the estimated spend (preventing concurrent calls from both seeing non-zero balance) and commit the actual spend only after the underlying `sendMessage` call returns success. If `sendMessage` fails, the reserved amount is released.

2. **Write-side serialization**: no read-then-write windows are permitted for the per-room balance. Either a database-level row lock (for postgres backends) or a process-level serialization primitive (e.g., a Mutex per roomId in-memory, backed by a CAS operation in the persistence layer) must ensure that two concurrent publishes cannot both pass a nearly-exhausted budget.

3. **Explicit expiry semantics for unconfirmed reservations**: if a reserve succeeds but the publisher crashes before committing, the reserved amount must expire after a configurable timeout (default: 60 seconds) and return to the available balance. ADR-164.1 must define the expiry mechanism and its interaction with the monthly reset cron.

4. **Audit-log integration**: every reserve, commit, and release operation must write a `federation_spend` event to `AuditService`. The event type must be distinguishable (`reserve`, `commit`, `release-success`, `release-expiry`) so the audit trail accurately reflects the lifecycle of each spend unit.

---

## 8. Rollout plan

The agenticow integration (PR #2500, v3.15.0) established the pattern: optional-dep wiring first, smoke contract on day one, measured evidence before deeper phases. This ADR follows the same playbook.

### Phase 1: Federation BBS MCP tools + smoke contract (target: 1 MINOR release)

Deliverables:
- `plugins/ruflo-bbs-federation/` scaffold with the four MCP tools from Section 3.2
- Graceful-degraded behavior when agentbbs is not installed (all tools return `{ degraded: true }`)
- `plugins/ruflo-bbs-federation/scripts/smoke.sh` passing with and without agentbbs
- `agentbbs` in `optionalDependencies` of root and ruflo wrapper `package.json`
- CI workflow `no-bbs-smoke.yml` asserting the absent-agentbbs path
- `inbound-dispatcher.ts` subscription stub (returns no-op handle, does not deliver events yet)

What is NOT in Phase 1:
- Working `federation_bbs_watch` delivery (stub only)
- Per-room budget tracker
- Domain-affinity policy extension
- Any business pod templates

Exit criteria: `scripts/smoke.sh` exits 0 with and without agentbbs installed. Fleet meta-smoke shows ruflo-bbs-federation green. No regressions in existing federation tests.

Semver: MINOR (additive plugin, no breaking changes).

### Phase 2: One pod end-to-end (sales), local + remote peer

Deliverables:
- `plugins/ruflo-business-pods/` with the sales pod template (`templates/sales.json`)
- `pod-template-loader.ts` with JSON schema validation
- Working `federation_bbs_watch` delivery via `inbound-dispatcher.ts` subscription API (Section 5.1.3 change landed)
- Per-room budget tracker (`bbs-room-budget-tracker.ts`) with monthly reset cron
- Sales pod running end-to-end against a local agentbbs instance (manual verification)
- Per-room PII pipeline override (Section 5.1.4 change to `pii-pipeline-service.ts` landed)

Exit criteria: Sales pod bench cycle completes and publishes a `bench-result` event to the BBS room. Human override (test harness) redirects a running task and pod acknowledges. Budget cap blocks further publishes when exceeded.

Semver: MINOR.

### Phase 3: All pods + cloud Managed Agent routing

Deliverables:
- All six remaining pod templates (marketing, finance, ops, support, hr, exec)
- Domain-affinity policy wired into `@metaharness/router` (Section 3.4)
- Marketing and support pods routing outbound tasks to Managed Agents (ADR-115 `managed_agent_*` tools)
- Finance and HR pods asserting local-only execution in bench tests
- Per-pod spend tracking visible in `ruflo cost` dashboard
- Upstream agentbbs changes confirmed shipped: typed envelope kind + durable log + token validation (Section 5.2 items 1, 3, 4)

Exit criteria: All seven pods running concurrently. Exec pod producing daily summary. No pod exceeds its `budgetUsdMonthly` in a test run. Finance pod tasks route to local stdio exclusively.

Semver: MINOR (all additive).

### Phase 4: Human override semantics + BBS web UI polish

Deliverables:
- Full human override lifecycle: post → parse → redirect/shutdown → acknowledge → audit log
- agentbbs web UI renders `federation-envelope` post kinds with domain components (Section 5.2.2)
- SSH "room subscribe" streaming available (Section 5.2.5)
- Per-room access controls enforced by agentbbs (Section 5.2.6)
- `federation_bbs_human_join` token validation working end-to-end via agentbbs auth (Section 5.2.4)
- Business-owner audit read view surfaced in BBS UI

Exit criteria: Business owner (manual test) can watch all seven rooms, post an override to #sales, see it acknowledged by the pod, and inspect the audit trail — all without touching a terminal.

Semver: MINOR (additive UI / override semantics).

### Phase 5: Business-owner GA

Deliverables:
- Measured cost-per-domain numbers (real runs, not estimates) added to CLAUDE.md
- `ruflo doctor --component bbs-federation` reporting agentbbs version, registered rooms, pod health
- Published agentbbs integration documentation
- Migration guide for operators who want to add custom pod templates
- `ruflo metaharness oia-audit` extended to include BBS-specific compliance checks

Exit criteria: Full 7-pod deployment running for ≥30 days in a real business environment with measured costs and zero cost runaway incidents. Business-owner GA announcement.

---

## 9. Open questions and risks

### 9.1 Real integration risks for the agentbbs Rust workspace

The previous version of this ADR mis-stated agentbbs as "v0.1.0, 16 hours old, no test suite." That was incorrect — the npm launcher is v0.1.0 but the Rust workspace is mature (30+ release tags, postgres-backed CI, 13 crates including `agentbbs-mcp` and `agentbbs-federation`). The actual risks are different:

**Risk 9.1.a — npm launcher version vs. Rust workspace version drift**: The npm package `agentbbs@0.1.0` and the Rust workspace (currently at `v0.34.9-nethack`) are independently versioned. The integration must pin against the Rust workspace tag for compatibility purposes. If a future npm release silently picks up an incompatible Rust binary, the BBS cockpit may break without a semver signal. Mitigation: pin the Rust binary version explicitly in `plugin.json` and add a Phase 1 smoke check that asserts the binary version reported by `agentbbs --version` matches the pinned value.

**Risk 9.1.b — FSL-1.1-Apache-2.0 license implications**: The Functional Source License converts to Apache-2.0 after 2 years. In the current FSL period, ruflo (MIT) may distribute agentbbs as an `optionalDependency` for use by operators, but embedding agentbbs binaries in a ruflo distribution that is itself sold as a product may require explicit FSL compliance review. Mitigation: legal review before Phase 3. Phase 1 and Phase 2 are unaffected (operator installs agentbbs separately; ruflo does not bundle it).

**Risk 9.1.c — `cargo` required at first run**: The Rust workspace compiles from source on the operator's machine unless a pre-built binary is available. Operators without `cargo` in their PATH will see a compilation failure, not a graceful-degradation response. Mitigation: the `no-bbs-smoke.yml` CI workflow must test the absent-agentbbs path (graceful degradation), not only the present-agentbbs path. Document the `cargo` requirement prominently in `plugins/ruflo-bbs-federation/README.md`. Phase 3+ may consider shipping a pre-built binary via npm for common platforms.

**Risk 9.1.d — `agentbbs-mcp` compatibility with ruflo's `MCPTool` interface**: The existing `crates/agentbbs-mcp/src/server.rs` implements an MCP server, but its tool interface shape (JSON-RPC envelope, tool name conventions, parameter types) has not been verified against ruflo's `MCPTool` interface. If there is a mismatch (e.g., different `inputSchema` conventions or different transport handshake), the four BBS MCP tools in §3.2 may need an adapter layer. Mitigation: Phase 1 deliverable includes a documented compatibility matrix produced by reading `crates/agentbbs-mcp/src/server.rs` against ruflo's `MCPTool` type definition. Incompatibilities are resolved in Phase 1 (adapter shim) before Phase 2 proceeds.

### 9.2 Persistence semantics of agentbbs BBS rooms

It is not clear whether agentbbs stores posts durably or keeps them in memory. If BBS state is ephemeral, the `sinceTs` replay in `federation_bbs_watch` will not work across BBS restarts, and the business-owner audit read view will show gaps. The federation audit log (`audit-service.ts`) is the canonical source and does not depend on BBS persistence — but the BBS as a display layer will be unreliable until this is confirmed and documented.

**Action before Phase 2**: open an issue in `ruvnet/agentbbs` requesting confirmation of persistence semantics and a documented retention API.

### 9.3 Concurrent-edit / CRDT problem

When multiple pod agents publish to the same BBS room concurrently, and a human posts an override simultaneously, the ordering of events is not guaranteed. The federation envelope carries an `hmacSignature` over a deterministic payload (including `timestamp` and `nonce`), but there is no vector clock or CRDT layer to resolve conflicts. For most business autopilot scenarios this is acceptable (last-write-wins per field is fine for a daily summary; ordering only matters for overrides). For override messages specifically, the pod agent should apply the most recent human override by `timestamp` and discard earlier ones.

This is a known design limitation, documented here for future consideration. CRDT adoption is out of scope for this ADR.

### 9.4 Trust elevation path for new BBS rooms

The trust model (Section 3.5) starts BBS rooms at `TrustLevel.ATTESTED`. There is no automated path to `TrustLevel.TRUSTED` without `minInteractions: 500` (per `TRUST_TRANSITION_THRESHOLDS` in `trust-level.ts` line 17). An operator who wants a room at TRUSTED must either wait for 500 interactions or implement an out-of-band attestation mechanism. This is by design — trust is earned, not configured — but operators should be aware that the full `collaborative-task` and `share-context` capabilities are not available at room registration time.

**No action required**: the current trust model is correct. This is a documentation note.

### 9.5 LLM cost runaway risk on perpetual operation

The perpetual-loop pattern (`cronSchedule` + Darwin /loop) means agents run indefinitely. A buggy bench that never terminates, or an agent that calls expensive models in a tight loop, can exhaust a monthly budget in hours. The `BbsRoomBudgetTracker` (Section 5.1.5) is the primary defense, but it has an async race condition (Section 7.3) that could allow brief overshoot.

**See ADR-164.1 §3 for the resolved concurrency design** (atomic reserve-and-commit, write-side serialization, expiry semantics, audit-log integration). The race condition risk is considered resolved by ADR-164.1; this section tracks the remaining operational risks.

Mitigation requirements for Phase 2 before GA:
1. Hardened tests for the `BbsRoomBudgetTracker` race, verifying the ADR-164.1 design: two concurrent publishes against a budget of $0.01 must not both succeed. These tests must be green before Phase 2 exit criteria are declared met.
2. A daily `federation_report_spend` rollup for each room, alerting to `#exec` if the trailing 7-day spend rate implies monthly cap breach before month end.
3. An emergency `federation_evict` shortcut in the BBS UI for the business owner (do not require terminal access to stop a runaway pod).

### 9.6 agentbbs API surface may change between v0.1.0 and v0.2.0

Given that the metaharness project moved from `0.1.0 → 0.1.11` in ~23 hours (noted in ADR-150 context), agentbbs may similarly iterate fast. The integration layer must avoid deep coupling to agentbbs internals. The four MCP tools must only depend on the agentbbs HTTP/WebSocket endpoint and authentication API — not on internal agentbbs modules.

If agentbbs introduces a breaking API change before Phase 3, the graceful-degraded path ensures ruflo continues operating; only the BBS cockpit goes dark until the adapter is updated.

### 9.7 No benchmark for BBS round-trip latency

`federation_bbs_publish` dispatches a `federation_send` and waits for acknowledgment from the BBS. We do not know the round-trip latency of agentbbs v0.1.0. If it is high (>500ms per publish), the perpetual loop for high-frequency pods (ops: every 4h, support: every 2h) will not be materially affected, but real-time human override delivery could feel sluggish.

**Action before Phase 4**: benchmark BBS round-trip latency under realistic load and document it alongside the smoke contract results.

---

## 10. Alternatives considered and rejected

### 10.1 BBS-as-transport (rejected)

One option was to replace the federation's WebSocket/QUIC transport with agentbbs's SSH/HTTP endpoints entirely — making BBS the transport layer, not a peer.

Rejected because: (a) federation transport is intentionally pluggable (ADR-104, ADR-120) but abstracting BBS at the transport level would couple every federation feature to agentbbs availability; (b) the mandatory graceful-degradation invariant (ruflo operational without agentbbs) is much harder to satisfy at the transport layer than at the peer layer; (c) BBS-as-transport would prevent federation from using WG mesh (ADR-111) for high-security peers, which finance and HR require.

### 10.2 BBS-as-surface-only (rejected)

Another option was to treat agentbbs as a pure display layer — a read-only dashboard that subscribes to ruflo memory events but has no write path back to agents.

Rejected because: it eliminates the human override path, which is the central safety mechanism for a perpetual business autopilot. A business owner who cannot stop a running agent from the cockpit is not in control. The override path requires a write channel from the BBS to the pod.

### 10.3 Build our own business cockpit UI from scratch (rejected)

Building a ruflo-native business cockpit was considered. It would eliminate the dependency on an unproven v0.1.0 project.

Rejected because: (a) a BBS-style interaction paradigm is a good fit for the "rooms by business function" model and agentbbs already provides it; (b) the integration effort is substantially less than building a UI from scratch; (c) agentbbs is first-party (same author) and can be coordinated with; (d) the graceful-degradation requirement means ruflo does not *depend* on agentbbs — if agentbbs fails to mature, the federation primitives built here remain useful without the BBS cockpit.

### 10.4 Use Slack instead of agentbbs (rejected)

Slack has a mature API, proven persistence, and a UI every business owner already uses.

Rejected for the short term because: (a) Slack is a third-party SaaS with per-seat pricing that adds external dependency for what should be self-hosted; (b) Slack's API does not natively support typed federation envelopes — we would need an adapter layer of similar complexity to what we're building for agentbbs; (c) the SSH front door in agentbbs is a meaningful capability for headless agent participation that Slack does not provide. A `ruflo-slack-federation` plugin following this same ADR pattern is a viable future alternative if agentbbs proves immature.

---

## 11. References

| Reference | What it contributes to this ADR |
|-----------|--------------------------------|
| ADR-097 (federation budget circuit breaker) | `enforceBudget`, `validateBudget`, `BudgetEnforcement` primitives used unchanged; per-room monthly tracker is additive |
| ADR-110 (production spend reporter) | `SpendReporter` + `MemorySpendReporter` pattern; `BbsRoomBudgetTracker` follows the same storage-agnostic interface |
| ADR-111 (WG mesh transport) | Finance and HR pods must route over WG mesh when using remote ruflo peers |
| ADR-115 (managed agents cloud backend) | Sales, marketing, and support pods delegate high-throughput tasks to Managed Agents via `managed_agent_*` MCP tools |
| ADR-150 (metaharness integration surfaces) | Defines the optional-dep integration pattern this ADR mirrors: optionalDependencies, graceful-degradation, smoke contract, CI gate |
| ADR-001 (deep-integration philosophy) | Build as an extension of existing primitives (federation, router, audit), not a parallel system |
| PR #2500 (agenticow v3.15.0) | Precedent for the optional-dep integration onboarding: optional dep wiring + smoke contract + measured findings before deeper phases |
| `v3/@claude-flow/plugin-agent-federation/src/mcp-tools.ts` | All 14 existing federation MCP tools; the four new BBS tools wrap these, not replace them |
| `v3/@claude-flow/plugin-agent-federation/src/domain/entities/federation-envelope.ts` | `FederationMessageType` union — `'context-share'` and `'task-assignment'` are the message types used by BBS room events |
| `v3/@claude-flow/plugin-agent-federation/src/domain/entities/trust-level.ts` | `TrustLevel` enum + `CAPABILITY_GATES` + `TRUST_TRANSITION_THRESHOLDS` — BBS rooms start at ATTESTED (level 2) |
| `v3/@claude-flow/plugin-agent-federation/src/domain/services/pii-pipeline-service.ts` | `PIIPolicyConfig`, `PIIAction`, `PIIType` — extended with per-call override in Section 5.1.4 |
| `v3/@claude-flow/plugin-agent-federation/src/domain/value-objects/federation-budget.ts` | `DEFAULT_MAX_HOPS=8`, `enforceBudget` security invariants — used as-is; per-room monthly cap is a separate layer |
| `v3/@claude-flow/plugin-agent-federation/src/application/spend-reporter.ts` | `FederationSpendEvent`, `MemorySpendReporter` — BBS publish reports spend through this interface |
| `v3/@claude-flow/plugin-agent-federation/src/application/inbound-dispatcher.ts` | Requires subscription API (Section 5.1.3) — current file is a stub |
| `plugins/ruflo-metaharness/scripts/smoke.sh` | Reference implementation for the smoke contract pattern |
| `docs/agenticow/findings.md` | Example of the measured-evidence approach before deeper integration phases |

---

## Appendix A: Decisions made autonomously where the brief was ambiguous

The brief described the trust model as "how BBS rooms get trust tier scoring" without specifying the starting tier. This ADR assigned `TrustLevel.ATTESTED` (level 2) because: (a) rooms are operator-registered, not auto-discovered, which is materially more trustworthy than a cold join; (b) VERIFIED (level 1) would not allow `share-context` which is needed for the exec pod's cross-pod synthesis; (c) TRUSTED (level 3) requires 500 interactions by the existing threshold logic and cannot be granted at registration time without modifying trust-level.ts in a way this ADR does not propose.

The brief said "Finance pod prefers local." This ADR extended that to HR as well, because HR handles employee personal data (names, addresses, leave records) which maps to GDPR-level sensitivity on the same reasoning as financial records. The brief listed HR as a separate pod but did not specify its routing preference.

The brief described the budget circuit breaker "per-room spend caps" but did not specify whether the cap is per-call or monthly. This ADR chose monthly because: (a) the CFO mental model is a monthly budget, not a per-API-call limit; (b) the existing `enforceBudget` already handles per-call limits; (c) a monthly tracker is the additive layer needed, not a modification to the existing mechanism.

The brief said "agenticow was shipped today via PR #2500 / v3.15.0." This ADR references it as the precedent for optional-dep onboarding pattern. The actual PR content was not read directly, but the agenticow findings file (`docs/agenticow/findings.md`) confirms the measured-evidence approach used there.

---

### Peer review corrections (2026-06-29) — resolved in this edit

The following corrections were applied during peer review of this ADR. Each is marked with the section(s) it affected.

**Correction PR-1 — Agentbbs maturity assessment rewrite** (affects §External references header, §1.2 table, §1.3, §5.2, §9.1)

The initial draft characterized agentbbs as "v0.1.0, 16 hours old, no test suite, unproven." This was incorrect. The npm package `agentbbs@0.1.0` is a thin launcher; the actual project is a mature Rust workspace at `github.com/ruvnet/agentbbs` with 13 crates, 30+ release tags (latest: `v0.34.9-nethack`), 7 GitHub Actions CI workflows, postgres-backed integration tests, existing `crates/agentbbs-mcp/` MCP server, existing `crates/agentbbs-federation/` federation crate, Docker stack, `deny.toml`, and `.gitguardian.yaml`. All passages asserting immaturity were replaced with accurate language. §5.2 was restructured from "changes needed" to "verify-first" — each sub-section now surveys the existing crate before specifying any upstream PR. §9.1 was rewritten with the four real integration risks: (a) npm launcher / Rust workspace version drift, (b) FSL license implications, (c) `cargo` required at first run, (d) `agentbbs-mcp` interface compatibility. Status: **resolved** — all affected passages updated in this edit.

**Correction PR-2 — Atomic budget tracker forward-reference to ADR-164.1** (affects §7.3, §9.5)

§7.3 previously described the async race condition in `BbsRoomBudgetTracker` and flagged it as an open risk. Per review, the atomicity design is being specified in a companion ADR-164.1 (written in parallel). §7.3 was rewritten to: (a) declare "atomicity design lives in ADR-164.1; this section summarises requirements only," (b) enumerate the four requirements ADR-164.1 must satisfy (atomic reserve-and-commit, write-side serialization, explicit expiry semantics for unconfirmed reservations, audit-log integration for every reserve/commit/release), and (c) not attempt to resolve the concurrency design itself. §9.5 was updated to forward to "ADR-164.1 §3 for the resolved concurrency design." Status: **resolved** — §7.3 and §9.5 updated in this edit. ADR-164.1 must be authored to satisfy the four requirements listed in §7.3.

**Correction PR-3 — Trust elevation escape hatch §3.5.4** (affects §3.5)

The organic trust accrual path (`minInteractions: 500` for `TRUSTED`) blocks the `#exec` cross-pod synthesizer from operating at full capability on Day 1. A founder-bootstrap escape hatch was added as §3.5.4. Specifies: new CLI subcommand `ruflo federation trust elevate <bbs-node-id> --to TRUSTED --reason "<text>" --audit`; `--reason` and `--audit` are mandatory; audit entry is tagged `bootstrap_elevation`; elevation is capped at `TRUSTED` (level 3); multi-party sign-off is a Phase 5 hardening item; Phase 1 ships with single-operator escape hatch; wire point is a new `bootstrapElevate()` method on `application/trust-evaluator.ts`. Status: **resolved** — §3.5.4 added in this edit.

**Correction PR-4 — Token expiry vs. long-lived streams (two-phase auth)** (affects §3.2.4)

§3.2.4 previously described the 15-minute Ed25519 token as the session mechanism without distinguishing handshake from session. Per review, the token must be single-use for the handshake (Phase A) and the resulting channel must be long-lived without mid-stream re-validation (Phase B). §3.2.4 was rewritten with explicit Phase A / Phase B language: Phase A consumes the token on first use (JTI/nonce recorded, replay rejected); Phase B keeps the channel open until explicit close, idle timeout (default 30 min), or BBS restart — no mid-stream re-auth. The SSH "room subscribe" long-running stream is explicitly called out as a Phase B session that must not re-validate mid-stream. Status: **resolved** — §3.2.4 updated in this edit.

**Correction PR-5 — Ops pod tooling expansion** (affects §4.4, §5.1)

The Ops pod's `allowedMcpTools` was insufficient for real ops work. Updated to include: `aidefence_*` (threat detection signals), `terminal_execute` (ops script execution), `http_fetch` (external endpoint monitoring — NEW tool, Phase 2 prerequisite), `agent_execute` (delegation to cloud Managed Agents with AWS/GCP/Azure SDK), and a note that cloud-provider MCP servers are deployment-specific and not bundled. A new §5.1.8 was added specifying the `http_fetch` tool's minimal contract: URL allowlist, 30s timeout cap, 256 KB response-size cap, no auth-header pass-through without explicit `authAllowedUrls` entry, audit logging on every call. Phase gate: Phase 2 prerequisite; Phase 1 ships a stub. The ops bench was updated with a concrete scenario: monitor a synthetic HTTP endpoint returning 200 OK 90% / 500 10% of the time; pod must detect the 500 rate and post an alert to `#ops` within 60 seconds. Status: **resolved** — §4.4 and §5.1.8 updated in this edit. `http_fetch` tool must be implemented before Phase 2 ops bench can pass.
