# ADR-326: Cognitum Product-Plane Claim Federation Profile

**Status**: Proposed — cross-repository implementation and migration required  
**Date**: 2026-07-28  
**Decision owners**: Ruflo, Cognitum control-plane, Meta-LLM, Comms, and RuView maintainers  
**Related**: ADR-098, ADR-099, ADR-100, ADR-115 through ADR-119,
ADR-324, ADR-325, ADR-327

## Executive decision

Cognitum will integrate Ruflo claim federation as a shared, zero-trust
authorization and evidence profile across:

- the cognitum.one customer dashboard;
- Meta-LLM inference, routing, budgets, and collaboration gateways;
- Comms and AgentBBS;
- Cog Studio proposals, approvals, releases, and runtime operations; and
- RuView edge spaces and privacy-preserving sensing.

The profile does not create a new global database or a second product
authority. Each product retains a single authoritative domain:

| Domain | Authoritative owner |
|---|---|
| Human identity and tenant membership | Firebase identity plus Cognitum tenant membership |
| Cog proposals, operations, releases, and observed runtime state | Cognitum Cog control plane |
| Inference routing, spend, usage, and completion delivery | Meta-LLM |
| Collaboration content and decisions | AgentBBS |
| Comms tenant lifecycle, membership, and billing | Comms |
| Raw sensing, local models, and device actuation | RuView edge authority |
| Cross-domain policy decisions and delegated grants | Ruflo ADR-324/325 policy plane |

Dashboards, notifications, Comms cards, and other views are reference
projections. They MUST NOT manufacture, copy, or reinterpret authoritative
outcomes.

The current product integration is useful but not yet optimal. Firebase and API
key authentication work within their local domains, but there is no production
Ruflo federation verifier in the Cognitum control plane. Several cross-service
mutation paths also lack atomic idempotency, durable delivery, request-bound
capabilities, or exact release provenance.

## Why a separate profile is required

ADR-325 defines the generic trust, identity, grant, ownership, and receipt
model. It intentionally does not decide how Cognitum product identities map,
which service owns each outcome, or what data may cross a product boundary.

Those choices are security decisions:

- a Firebase UID, Meta-LLM account, AgentBBS public key, and workload identity
  are different principals even if their display strings match;
- a dashboard session is not an inference, deployment, moderation, or device
  command capability;
- a Cog proposal is desired state, not observed runtime truth;
- an AgentBBS decision is not a Cognitum release approval;
- a RuView semantic observation is not permission to expose raw sensing data or
  actuate a device.

This profile makes those boundaries normative and defines a compatible
migration from current installations.

## Current-state audit

The July 2026 cross-repository audit found the following.

### Existing strengths

- Cognitum Functions verify Firebase identity and derive tenant membership
  server-side instead of accepting tenant ownership from request bodies.
- Cog Studio persists a proposal, immutable revision, transition, and
  reference-only action event transactionally.
- Cog production approval checks tenant, proposal revision, policy version,
  quorum, and expiry separately from execution.
- Runtime action events accept only observations marked authoritative and do
  not infer success from desired state.
- Comms projections reference authoritative operation, proposal, and release
  records instead of duplicating their outcomes.
- Meta-LLM derives its account from a verified API key or OAuth token and
  constrains delegated sub-tenants to an explicit privileged scope.
- RuView keeps raw CSI, pose, vital, and sensor frames at the edge and exposes
  privacy-minimized semantic state to the dashboard.
- AgentBBS uses browser-held Ed25519 identities for collaboration participants.

The current RuView/Seed website feature is a downstream catalogue and read
model, not a deployed edge-federation path. The reviewed HomeCore federation
endpoint is a `503` stub, its documentation describes demo mocks, and no
Cognitum Spaces uplink was found in the reviewed RuView source.

### Material gaps

| Severity | Finding | Effect |
|---|---|---|
| Critical | Cognitum Functions have no production Ruflo grant verifier or federation PEP | A federated claim cannot safely authorize a product action |
| Critical | Current release evidence may be rebound to a mutable blueprint and uses shallow nested canonicalization | A nominally signed release is not eligible to authorize deployment |
| High | A test-only, one-use deployment capability has no production execution consumer | Capability issuance is not an enforcement boundary |
| High | Website structured-output requests are not consistently forwarded or cache-separated by Meta-LLM's OpenRouter path | Cog Builder output format can degrade or reuse incompatible cached output |
| High | Meta-LLM completion idempotency is lookup-then-store rather than an atomic reservation | Concurrent retries can execute and bill more than once |
| High | Meta-LLM collaboration mutations lack idempotency and its event stream lacks a durable resume cursor | Retries can duplicate actions and reconnects can miss events |
| High | Comms lifecycle and membership writes lack an operation journal, transactional dedupe, and complete CAS semantics | Concurrent mutations or crashes can lose or ambiguously apply state |
| Medium | The dashboard still uses recoverable `cog_` credentials for Meta-LLM | A browser credential has broader lifetime and reuse than an audience-bound grant |
| Medium | AgentBBS moderator claims bind role, tenant, and expiry but not every method, path, body digest, action, and nonce | A valid proxy claim has avoidable replay surface |
| Medium | Advertised webhook behavior is not equivalent across every website adapter | UI expectations can exceed the provider's delivery contract |
| High | RuView development events can use a deterministic signer and carry an unregistered self-supplied public key | Integrity can be mistaken for trusted tenant/device provenance |
| High | RuView and HomeCore use optional or ambient process-wide bearer authentication on local surfaces | Local credentials do not identify a scoped federated actor |
| High | The current Spaces response is asserted from network JSON without a fail-closed privacy/provenance validator | Malformed or cross-tenant state can reach the read model |
| Medium | The website edge catalogue is manually pinned and includes a tokenless WebSocket example for a route that may require a bearer | Generated instructions can drift from the real edge contract |

No current production deployment may be described as claim-federated until the
relevant acceptance gates in this ADR and ADR-325 pass.

## Decision

### 1. Preserve authority and use reference projections

Every mutable fact has one authoritative record. Cross-product events contain
references and digests, not a copied human-readable outcome:

```ts
interface AuthoritativeReference {
  authority: string;
  tenantRef: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  sourceDigest: `sha256:${string}`;
}
```

A projection may add display metadata, unread state, or a local delivery
timestamp. It may not change the source status, policy result, observed state,
release digest, or decision.

Cog desired state never becomes observed runtime truth through federation.
Only an authoritative reconciler observation can produce a running, halted,
failed, deployed, or rolled-back outcome.

### 2. Keep identity domains explicit

The principal link record is an audited mapping, not string equality:

```ts
interface PrincipalLink {
  linkId: string;
  cognitumPrincipal: string;
  firebaseSubject?: string;
  metaLlmAccount?: string;
  agentBbsPublicKey?: string;
  workloadId?: string;
  tenantRefs: string[];
  verifiedAt: string;
  verificationMethod: string;
  status: 'active' | 'suspended' | 'revoked';
}
```

At each request, the receiver verifies the incoming identity and re-resolves
tenant membership and permissions from its own authoritative store. A grant
may request a tenant; it cannot assign tenant ownership or local permissions.

Account, tenant, and sub-tenant identifiers are namespace-qualified. The same
text in two namespaces never implies the same identity.

### 3. Exchange browser identity for audience-bound grants

The dashboard remains a policy enforcement point and read model, not an
authority. A verified Firebase/Cognitum session exchanges identity for a
short-lived, sender-constrained grant targeted to one product resource:

```text
dashboard session
  -> Cognitum token exchange
  -> Meta-LLM inference grant
  -> Cog proposal grant
  -> Comms posting grant
  -> RuView semantic-read grant
```

The dashboard MUST NOT forward one broad token across those services. Each
grant binds:

- issuer, subject, actor, and audience;
- local tenant/account request;
- exact actions and resource selectors;
- request or policy digest where the action is consequential;
- budget, rate, concurrency, and delegation ceilings;
- proof-of-possession key;
- issue, expiry, policy version, grant ID, and parent grant hash.

Existing `cog_` API keys remain supported during migration. They are mapped to
a compatibility principal and exchanged server-side where possible. New
privileged actions fail closed if only a legacy browser key is present.

### 4. Adopt a common product action vocabulary

Initial actions are:

| Product | Actions |
|---|---|
| Dashboard | `dashboard.read`, `dashboard.status.read` |
| Meta-LLM | `inference.invoke`, `inference.stream`, `usage.read`, `pod.spawn`, `benchmark.run`, `evolution.propose`, `evolution.promote` |
| Comms | `comms.thread.read`, `comms.thread.post`, `comms.projection.read`, `comms.board.admin` |
| Cog Studio | `cog.proposal.create`, `cog.proposal.review`, `cog.proposal.approve`, `cog.instance.acquire`, `cog.instance.operate`, `cog.deploy`, `cog.rollback` |
| RuView | `ruview.space.read`, `ruview.semantic.publish`, `ruview.automation.propose`, `ruview.automation.approve`, `ruview.device.command` |
| Agent cognition | `cognition.route`, `cognition.critique` |
| Validated learning | `memory.recall`, `memory.propose`, `evidence.read`, `memory.commit-validated` |

Actions are not interchangeable. In particular:

- `cog.proposal.create` never implies `cog.deploy`;
- `benchmark.run` never implies `evolution.promote`;
- `ruview.space.read` never implies raw sensor access or device command;
- `comms.thread.post` never implies board administration;
- a work lease never implies any product action.
- `memory.propose` never implies `memory.commit-validated`;
- `memory.commit-validated` never implies policy or model promotion.

Receivers intersect grant actions with their local permissions and policy.

Agent cognition is a capability plane, not a new authority plane. Cognitum and
Meta-LLM may route or critique a development trajectory and may return bounded
evidence. Ruflo remains authoritative for its validated memory and policy
state. A memory commit binds the exact proposed content digest, evidence
digest, validator version, policy receipt, tenant, namespace, and one-use
capability. The commit cannot update an active policy, promote a MetaHarness
candidate, deploy, change IAM, or spend outside its separate envelope.

### 5. Bind inference semantics to policy, cache, and receipts

Meta-LLM requests that affect observable behavior MUST bind the following into
provider translation, idempotency identity, exact-cache identity, and the
decision receipt:

- model and provider route;
- structured response format and schema;
- reasoning controls;
- safety and fallback policy;
- cache mode;
- tenant and authorized sub-tenant;
- input or redacted-input digest;
- token, USD, latency, and concurrency limits;
- webhook delivery contract.

A request for structured JSON cannot share a cache entry with an otherwise
identical unstructured request. A provider adapter either forwards a supported
semantic, performs a declared compatible translation, or returns an explicit
degraded/refused result. It never silently drops a policy-relevant field.

All mutating or billable calls reserve idempotency atomically:

```text
key = issuer + tenant + principal + action + idempotencyKey
value = canonicalRequestDigest + pending/completed/failed result
```

The same key and digest waits for or replays the original result. The same key
with a different digest returns conflict. One hundred concurrent calls produce
one provider side effect and one billable usage record.

### 6. Keep AgentBBS authoritative for collaboration

Meta-LLM `/v1/collab/*` remains a gateway; Comms remains the commercial tenant
and membership wrapper; AgentBBS remains authoritative for collaboration
content and decisions.

Federated Comms delivery uses:

- atomic mutation idempotency;
- a transactional outbox at the authority;
- receiver inbox dedupe by issuer, event ID, and content digest;
- stable sequence or cursor within the authoritative aggregate;
- SSE `id` plus `Last-Event-ID`, or an equivalent durable cursor;
- reference-only Cognitum action-event projections.

AgentBBS participant keys are linked identities, not Cognitum permission
sources. Moderator and sysop compatibility claims are narrowed to tenant,
method, path, action, body digest, one-use nonce, and expiry when the protocol
supports it. Existing role claims stay readable while new privileged proxy
operations require the narrower profile.

### 7. Make Cog Studio a proposal-to-capability pipeline

Cog Studio follows this sequence:

```text
immutable proposal revision
  -> policy evaluation
  -> approvals/quorum
  -> request-bound, one-use capability
  -> local control-plane transaction
  -> authoritative runtime observation
  -> action event and receipt
```

The execution capability binds the tenant, proposal and revision, policy
version, approval reference, exact command or operation, release and blueprint
digests, idempotency key, executor audience, expiry, and maximum use count.

Issuance is not execution. Production remains disabled until the local
control-plane consumer validates and consumes the capability transactionally.

Release provenance MUST be produced from a pinned source state using recursive
canonicalization. A generator may verify evidence; it may not retroactively
inject the current blueprint head into old evidence. A missing binding fails
closed.

### 8. Preserve RuView edge sovereignty

Raw CSI, pose, vital, image, audio, and sensor frames remain at the RuView edge
unless an independently approved export policy explicitly allows otherwise.
The default product-plane event contains privacy-minimized P2/P3 semantic
state:

```ts
interface RuViewSemanticObservation {
  spaceRef: string;
  observationType: string;
  value: unknown;
  confidence: number;
  uncertainty?: number;
  abstained: boolean;
  modelDigest: string;
  calibrationDigest?: string;
  hardwareRef?: string;
  privacyClass: 'P2' | 'P3';
  observedAt: string;
  expiresAt: string;
  sequence: bigint;
}
```

An observation is evidence, not an automation grant. Device commands and
automations require a separate, narrow capability, current edge policy,
idempotency, anti-replay state, and an authoritative device receipt. Offline
edge policy may be stricter than cloud policy but never broader.

The cloud path is:

```text
RuView/Seed local sensing
  -> privacy-minimizing edge adapter
  -> ADR-325 v2 signed envelope
  -> cloud federation ingress PEP
  -> ADR-324 decision and receipt
  -> tenant/site monotonic projection
  -> GET /v1/spaces
  -> dashboard read model
```

The website is never a federation peer, edge credential holder, signature
authority, or MQTT client. Local RuView REST and WebSocket surfaces remain
operational and diagnostic APIs; their bearer token or event public key is not
federation evidence.

Production edge federation fails startup when it detects a development signer,
optional or disabled authentication, a missing durable nonce store, an
unregistered workload, or an incomplete tenant/site binding. An embedded event
public key proves only internal consistency until a trust record binds it to
the workload, tenant, site, algorithm, key status, and validity period.

The ingress export ceiling is stricter than local visibility. The default
Cognitum profile rejects P0/P1 raw data and P4/P5 sensitive or prohibited
payloads and accepts only explicitly approved P2/P3 semantic projections.
Replay or simulated input must say it is synthetic. Model, calibration,
hardware, and firmware provenance are independently described; a model ID hash
cannot be relabeled as firmware attestation.

`GET /v1/spaces` derives tenant from the verified grant, requires
`ruview.space.read` (with an explicit time-bounded `devices:manage`
compatibility rule if needed), returns `Cache-Control: no-store`, and never
accepts a caller-selected tenant. The server validates privacy class,
provenance, freshness, expiry, and a monotonic site sequence before projection.
The website validates the response again and rejects raw fields, invalid
privacy, malformed provenance, impossible time ordering, or a tenant mismatch.

Edge API catalogues are generated from a pinned machine-readable RuView/Seed
contract and fail CI on route, transport, authentication, scope, or risk drift.
WebSocket examples distinguish header-capable clients, ticket/subprotocol
exchange, and intentionally unauthenticated local sockets.

### 9. Standardize product events and receipts

The interoperable event envelope extends ADR-325 with:

```ts
interface CognitumActionEnvelopeV1 {
  schemaVersion: 'cognitum.action.v1';
  eventId: string;
  issuer: string;
  audience: string;
  subject: string;
  actor?: string;
  tenantRef: string;
  action: string;
  resourceRefs: string[];
  requestDigest?: string;
  idempotencyKey?: string;
  correlationId: string;
  causationId?: string;
  authoritativeSource: AuthoritativeReference;
  sequence?: string;
  policyReceiptId: string;
  capabilityId?: string;
  occurredAt: string;
  expiresAt?: string;
  privacyClass: 'P0' | 'P1' | 'P2' | 'P3';
}
```

The envelope is recursively canonicalized and signed as specified by ADR-325.
An authoritative mutation and its outbox entry commit atomically. A receiver
deduplicates before creating a projection and acknowledges only after commit.

Free-form prompts, secrets, credentials, raw sensor data, and copied outcome
text are excluded. Redacted evidence is addressed by digest and protected URI.

### 10. Surface honest integration health

Every dashboard and agent-development integration reports identity,
configuration, reachability, health, and authorization independently:

```ts
interface ProductCapabilityHealth {
  identity: 'verified' | 'unverified' | 'unknown';
  configured: 'yes' | 'no' | 'unknown';
  reachable: 'yes' | 'no' | 'unknown';
  healthy: 'yes' | 'no' | 'unknown';
  authorized: 'yes' | 'no' | 'unknown';
  status: 'available' | 'degraded' | 'blocked' | 'unavailable';
}
```

The aggregate reports one of:

- `available`: required identity, policy, authority, and data path are healthy;
- `degraded`: a declared compatibility path is active;
- `blocked`: policy or evidence intentionally forbids the action;
- `unavailable`: the authority cannot be reached or verified.

These dimensions are not collapsed into one badge. A valid grant can coexist
with an unreachable service; a healthy service can coexist with a denied
action; configured credentials can coexist with an unverified identity.

The UI must not convert an unavailable RuView API, malformed Meta-LLM
structured output, unverified release, expired approval, or missing production
capability consumer into apparent success.

## Compatibility and rollout

### Phase 0 — Evidence and contract repairs

- Repair recursive release and blueprint canonicalization.
- Republish or create a detached signed binding for exact source, release, and
  blueprint digests.
- Forward `response_format` and include all policy-relevant inference fields in
  cache and idempotency identity.
- Make advertised webhook behavior explicit per adapter.
- Add production blockers to integration health.

### Phase 1 — Observe

- Add the Cognitum federation verifier beside existing Firebase/API-key
  verification.
- Dual-write signed outbox envelopes and current action events.
- Shadow-evaluate ADR-324 policy without authorizing a new mutation.
- Link principals through verified proof and audit every mapping.

### Phase 2 — Enforce new privileged mutations

- Require audience-bound grants for deployment, rollback, board
  administration, evolution promotion, and RuView device command.
- Add production capability consumers at each local authority.
- Add atomic idempotency and request-digest conflicts.
- Preserve legacy read and low-risk inference paths.

### Phase 3 — Durable interoperability

- Enable transactional inbox/outbox delivery and resumable event cursors.
- Journal Comms provisioning and compensations.
- Bind AgentBBS proxy claims to each request.
- Enforce status and revocation objectives.

### Phase 4 — Retire ambient credentials

- Stop recovering broad `cog_` keys into new dashboard sessions.
- Migrate active clients to token exchange.
- Retain an explicit, observable compatibility mode for supported older
  installations.
- Never reinterpret a legacy tenant or user identifier as a federated one.

## Normative acceptance tests

1. A federated identity cannot assign its own tenant, account, role, or local
   permission.
2. Equal-looking identifiers from two identity namespaces remain distinct
   until a verified link is active.
3. A dashboard token issued for Meta-LLM is rejected by Cog, Comms, and RuView.
4. One hundred concurrent identical billable requests cause one provider call
   and one usage charge.
5. Reusing an idempotency key with a different canonical request returns
   conflict.
6. Structured and unstructured requests cannot share a cache entry, and the
   provider observes the requested supported response format.
7. A collaboration disconnect and resume produces no missing authoritative
   event and no duplicate domain side effect.
8. A Comms lifecycle crash at every persistence boundary recovers to one
   journaled outcome.
9. A proposal grant cannot deploy; only an approved, one-use, exact-operation
   capability can reach the production consumer.
10. A missing or mutable release/blueprint binding is rejected before
    capability issuance.
11. Desired state never produces an observed runtime-success event.
12. A Comms card altered to show a different outcome fails source digest
    verification.
13. Raw RuView sensing does not leave the edge in the default profile.
14. A semantic observation cannot authorize a device command.
15. A revoked grant or principal link is rejected within the ADR-325 status
    objective.
16. Existing installations preserve supported read and low-risk inference
    behavior in declared compatibility mode.
17. Removing Ruflo federation providers leaves local product authorities
    operational but disables new federated privileged actions.
18. Production edge federation refuses a deterministic development signer,
    optional authentication, and an unregistered self-supplied event key.
19. Wrong tenant, site, audience, session, trust domain, expiry, or reused
    nonce is rejected, including replay after restart.
20. P0/P1/P4/P5 data never reaches the cloud Spaces projection.
21. Replay or simulated RuView input cannot claim live provenance, and
    incomplete firmware/model/calibration attestation remains visibly
    incomplete.
22. The website rejects raw sensing fields, invalid privacy, malformed
    provenance, non-monotonic sequences, and tenant mismatch.
23. The edge catalogue fails CI when its pinned machine-readable route,
    transport, authentication, scope, or risk contract drifts.
24. A valid claim never changes an independently unavailable service to
    available.
25. Each service probe preserves identity, configured, reachable, healthy, and
    authorized state independently.
26. `memory.commit-validated` rejects missing or mismatched content/evidence
    digests, validator version, policy receipt, tenant/namespace, and one-use
    capability.
27. A validated memory commit cannot change active policy, promote a
    MetaHarness candidate, deploy, mutate IAM, or authorize billing.

## Consequences

### Positive

- Cognitum products share policy and evidence without collapsing their
  authority boundaries.
- Browser credentials become narrower and less reusable.
- Cog, Comms, Meta-LLM, and RuView outcomes remain independently auditable.
- Cross-service retries become safe under concurrency and crash recovery.
- Existing installations receive an incremental migration path.

### Negative

- Every authority needs inbox/outbox, idempotency, status, and grant-verifier
  infrastructure.
- Identity linking and revocation add operational responsibility.
- Some current integrations remain visibly degraded or blocked until their
  upstream contract is repaired.

## Review trigger

Review this ADR when a product changes its authoritative data owner, a new
identity domain is added, raw RuView data is allowed to leave the edge, a
production Cog executor is introduced, or the compatibility profile is
removed.
