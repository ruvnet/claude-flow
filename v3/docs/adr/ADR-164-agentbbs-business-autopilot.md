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
- `agentbbs@0.1.0` — [`ruvnet/agentbbs`](https://github.com/ruvnet/agentbbs) — v0.1.0, published 2026-06-29, same author (ruv@ruv.net)
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
| agentbbs@0.1.0 | BBS-style web UI + TUI + SSH front door for human-agent interaction, organized into "rooms" | No typed federation envelopes; persistence semantics unknown; v0.1.0, 16 h old as of this writing |

The proposal is to wire these three together: federation provides the trust + PII + budget primitives; Managed Agents provides cloud-scale execution for appropriate workloads; agentbbs provides the human-facing cockpit.

### 1.3 Why agentbbs specifically

agentbbs is authored by the same maintainer (rUv), follows the same ADR convention, and is explicitly framed as an interaction layer for agent systems. It provides a BBS (bulletin board system) metaphor — rooms, posts, subscriptions — that maps naturally onto business functions. The SSH front door is significant: agents that cannot run a local MCP server can still participate by speaking SSH.

The honest risk is that agentbbs is v0.1.0, published 16 h before this ADR was written, with no test suite visible in the public repository and persistence semantics that are unspecified. This ADR treats it the same way ADR-150 treated `metaharness@0.1.x`: adopt as an `optionalDependency`, build graceful-degraded paths everywhere, ship a smoke contract on day one, and gate deeper integration behind measured evidence.

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
  "allowedMcpTools": ["memory_store", "memory_search", "federation_bbs_publish", "federation_bbs_watch", "federation_send"],
  "bench": {
    "name": "ops-availability-bench",
    "description": "Measures service availability and incident response lag",
    "successCriteria": [
      "No unacknowledged P1 alert older than 15 min",
      "Deployment pipeline green or escalated within 30 min",
      "Infra health check at least every 4h"
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

#### 5.1.7 Optional dependency wiring in root package.json and ruflo wrapper

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

### 5.2 In agentbbs upstream (changes needed in `ruvnet/agentbbs`)

These are requests to the agentbbs maintainer (same author, ruv). They are not blockers for Phase 1 but are required before Phase 3.

#### 5.2.1 Typed federation-envelope message kind

agentbbs today (v0.1.0) presumably accepts free-form text posts. It needs to accept a typed federation envelope as a post body with:

```json
{
  "kind": "federation-envelope",
  "envelopeId": "...",
  "sourceNodeId": "...",
  "targetNodeId": "...",
  "messageType": "context-share",
  "payload": { ... },
  "hmacSignature": "...",
  "piiScanResult": { ... }
}
```

The `hmacSignature` must be preserved intact through BBS round-tripping (not stripped by any sanitization layer). The `piiScanResult` must be stored alongside the post so re-ingestion by other agents can verify that PII scanning already ran.

**Upstream file to add**: a typed message schema in agentbbs's post handler.

#### 5.2.2 Web UI domain-aware rendering

The BBS web UI should render `federation-envelope` posts with domain-aware components:
- `pod-status` → status badge + agent health grid
- `task-result` → collapsible result panel
- `alert` → colored alert box with room color coding
- `bench-result` → sparkline chart for the domain bench metric

This is a UI feature request, not a blocking requirement for CLI/TUI/SSH operation.

#### 5.2.3 Durable event log (persistence guarantee)

agentbbs v0.1.0's persistence semantics are unspecified. For the business audit trail to be correct, the BBS must retain events for at least the `retentionDays` specified in each pod's `auditReadView`. The canonical source of truth is the federation audit log (`audit-service.ts`); the BBS is a display layer. However, the `sinceTs` replay in `federation_bbs_watch` requires the BBS to have a durable log it can replay from.

**Upstream requirement**: document and implement event persistence with at least configurable N-day retention.

#### 5.2.4 Federation keypair authentication handshake

When a human connects to the BBS (web or SSH), the BBS must validate the single-use token issued by `federation_bbs_human_join`. The token is Ed25519-signed by the ruflo node's federation keypair. The BBS needs:
- A way to learn the node's public key (via the federation manifest, which is already a published artifact)
- A token validation endpoint that checks: signature, expiry, single-use nonce, room scope

**Upstream requirement**: token validation in agentbbs auth layer.

#### 5.2.5 SSH "room subscribe" command

The SSH front door should support:
```
ssh bbs.local subscribe #sales
```
which streams all events for that room to stdout in the `federation-envelope` JSON format. This allows agents without a local MCP server to participate as consumers via a simple SSH pipe.

#### 5.2.6 Per-room access controls

The BBS must enforce that only authorized identities (humans with valid tokens, and agents registered to a room's pod) can post to or read from a room. The initial model: each room has an allowlist of `(identity, accessLevel)` pairs, managed by the ruflo node via `federation_bbs_register`.

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

The existing `enforceBudget` function in `federation-budget.ts` is synchronous and cannot be raced by two concurrent send calls (documented in the file's security invariants comment at line 7). The per-room monthly tracker (`BbsRoomBudgetTracker`) is an async read-then-write which *can* be raced. The implementation must use optimistic locking or a memory-level compare-and-swap to prevent two concurrent publishes from both passing a nearly-exhausted budget.

This is flagged as an open risk requiring hardened tests before Phase 3 (see Section 10.5).

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

### 9.1 agentbbs is v0.1.0, ~16 hours old at time of writing

This is the most significant risk. The upstream project has no visible test suite, no published API stability guarantee, and persistence semantics that are unspecified. The integration is designed to survive agentbbs being entirely absent (graceful degradation), but Phase 2 and beyond depend on upstream features (typed envelopes, durable log, token validation) that do not yet exist.

Mitigation: treat agentbbs the same as `metaharness@0.1.x` at the time of ADR-150 — adopt cautiously, build the integration layer to be resilient, and gate deeper phases behind upstream evidence. Do not bet Phase 3 on upstream features that are not shipped.

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

Mitigation requirements for Phase 2 before GA:
1. Hardened tests for the `BbsRoomBudgetTracker` race: two concurrent publishes against a budget of $0.01 must not both succeed.
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
