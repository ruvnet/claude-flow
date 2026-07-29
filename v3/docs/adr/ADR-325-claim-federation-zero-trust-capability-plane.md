# ADR-325: Claim Federation as a Zero-Trust Capability and Work-Ownership Plane

**Status**: Proposed — security-critical integration work required before production federation  
**Date**: 2026-07-28  
**Decision owners**: Ruflo security, claims, federation, and policy maintainers  
**Supersedes**: ADR-101's production-readiness conclusion, but not its component design  
**Related**: ADR-086, ADR-101, ADR-109, ADR-144, ADR-320, ADR-324,
ADR-326, ADR-327

## Executive decision

Ruflo's claim federation is **not optimally integrated today**.

The repository contains useful federation components: work-claim domain models,
hybrid logical clocks, vector clocks, signed federation envelopes, discovery,
PII controls, A2A card support, and the ADR-324 policy engine. These pieces do
not yet form one authenticated, authorized, replay-resistant, durable, and
partition-safe production path.

This ADR adopts a single zero-trust capability plane with four distinct
responsibilities:

1. **Work ownership** records who owns a unit of work.
2. **Workload identity** establishes which human, agent, process, and trust
   domain is acting.
3. **Authorization grants** constrain what that actor may do, to which
   resource, for whom, and for how long.
4. **Policy enforcement** evaluates every ingress, egress, delegation, and
   ownership transition and writes a verifiable decision receipt.

The implementation will preserve local, single-node behavior. Federated
ownership-changing operations will remain disabled until the critical
correctness gates in this ADR pass.

The design uses existing standards at interoperability boundaries:

- SPIFFE-compatible workload identities and rotating trust-domain bundles;
- OAuth 2.0 Token Exchange for explicit subject/actor delegation;
- audience-restricted, sender-constrained grants using DPoP or mTLS;
- OpenID Federation for optional multilateral trust-chain discovery;
- Shared Signals/CAEP for continuous revocation and risk events;
- MCP protected-resource metadata and A2A security declarations.

Ruflo does **not** require SPIRE, OAuth, or an external identity provider for
local use. Provider interfaces retain the current local Ed25519 identity as the
default compatibility profile.

Two companion profiles make this umbrella decision implementable without
turning it into one unbounded programme:

- ADR-326 defines the Cognitum dashboard, Meta-LLM, Comms, Cog Studio, and
  RuView authority, identity, event, privacy, and migration contract.
- ADR-327 defines repository harness, worktree, lease, fencing, message, and
  exact-source receipt semantics for concurrent Codex and Claude development.

Neither companion changes this ADR's trust model. Product actions and
development leases are both evaluated by ADR-324 policy, but they remain
different resource and capability domains.

## Why this ADR exists

ADR-101 correctly identified the components needed to move work claims across
nodes. It then described those components as implemented. A production-path
audit in July 2026 found that component presence and end-to-end enforcement had
been conflated.

The term `claim` also names three different concepts in the current system:

| Current surface | Meaning | Current persistence/enforcement |
|---|---|---|
| `@claude-flow/claims` | Exclusive work ownership, handoff, and stealing | Domain package with local in-memory adapters and optional federation wrappers |
| `ruflo claims` | Local capability-like grants | `.claude-flow/claims.json` |
| Federation `PolicyEngine` claims | Message-type authorization requirements | Independent enum; production dependency currently returns `true` |

A fourth, more complete authorization system now exists in
`@claude-flow/security`: the ADR-324 `AgenticPolicyEngine`. Maintaining four
partially overlapping authorities makes fail-open behavior and confused-deputy
errors likely.

This ADR uses the following normative vocabulary:

- **Work claim**: ownership of an issue, task, shard, or other work resource.
- **Authorization grant**: permission to perform actions on resources.
- **Identity assertion**: evidence identifying a subject or actor.
- **Decision receipt**: tamper-evident evidence of a policy decision.

Legacy command and API names remain as compatibility aliases, but new code MUST
use these terms.

## Pre-remediation current-state audit

The findings below describe the baseline that motivated this ADR. They are
retained for traceability; the implementation-progress section immediately
after the table records the opt-in remediations now present on this branch.

### What is already strong

- `@claude-flow/claims` has a clean domain/application/infrastructure split.
- `FederationBridge`, `FederatedClaimEventStore`, HLC, and vector-clock
  components provide a useful protocol substrate.
- Production plugin construction supplies an Ed25519 verifier to the inbound
  dispatcher.
- Peer discovery can suspend or evict a peer, and accepted/rejected deliveries
  are audited.
- The federation message model includes `claim-event` and `agent-handoff`, and
  maps them to capability requirements.
- ADR-324 supplies versioned rules, approvals, budgets, tamper-evident
  receipts, atomic local policy-state mutation, and compatibility modes.

### Integration gaps

| Severity | Finding | Repository evidence | Consequence |
|---|---|---|---|
| Critical | Nested message values are not reliably covered by the outer signature | `canonicalizeEnvelopeForVerify()` uses a `JSON.stringify` property allowlist derived only from top-level keys | A nested payload mutation can canonicalize to the same signed bytes |
| Critical | Federation authorization is stubbed | Plugin constructs `PolicyEngine({ checkClaim: () => true })` | Required claims do not restrict production sends |
| High | Inbound policy enforcement is absent | `dispatchInbound()` verifies peer state and the outer signature, then emits an event | No ingress authorization, PII/AI scan, rate limit, audience, tenant, expiry, or replay decision |
| High | Claim federation is not composed at runtime | Federation plugin has no dependency on `@claude-flow/claims`; no production construction of `FederatedClaimRepository`, `FederatedClaimEventStore`, or `FederationBridge` was found | Implemented components are not an operational feature |
| High | No inbound claim/handoff handler is registered | No production listener for `federation:inbound:claim-event` or `federation:inbound:agent-handoff` was found | Remote work events are delivered to no domain transaction |
| High | Exclusive ownership is eventually replicated without a fencing authority | Concurrent vector-clock writes are rejected locally, but no lease, quorum, or authoritative epoch exists | A partition can produce two actors that each believe they own the same work |
| High | Storage is neither durable nor atomic | Federated store wraps `InMemoryClaimEventStore`; publish failure reaches into a private event array to roll back | Crash boundaries can leave contradictory local and remote histories |
| Medium | Federated query is a placeholder | `includeRemote` is documented as a no-op | Callers may overestimate federation-wide visibility |
| Medium | The default message allowlist excludes claim messages | `DEFAULT_SECURITY_POLICY.allowedMessageTypes` omits `claim-event` and `agent-handoff` | Properly authorized sends are rejected unless policy is overridden |
| Medium | Replay fields are not enforced | Envelope metadata carries time/session data, but ingress has no nonce cache or freshness/audience check | A valid old ownership message can be replayed |
| Medium | A2A discovery is descriptive rather than trusted | Cards expose optional security fields, but local conversion does not populate them by default | A peer's advertised capability is not an authorization grant |
| Medium | Legacy local capability loading can fail open | A malformed/missing local claims file defaults non-admin checks to permissive behavior | Corruption can expand effective privilege |

### Implementation progress after the audit

The federation plugin now provides these opt-in foundations:

- recursively canonical JCS/Ed25519 envelope signing under negotiated
  `jcs-v1`, advertised by default by upgraded peers and trusted only from a
  signature-verified peer manifest, while retaining byte-for-byte
  `legacy-v1` verification;
- explicit `legacy`, `observe`, and `enforce` authorization modes backed by a
  concrete claim checker instead of an anonymous always-true callback;
- an inbound evaluator that runs after signature verification and before
  replay marking, acceptance audit, or event emission;
- fail-closed enforcement for denial, missing evaluators, evaluator errors, or
  malformed decisions;
- a legacy allowlist limited to `heartbeat` and `status-broadcast`.

Consequential and unknown legacy message types—including work claims,
handoffs, task assignments, context/memory transfer, trust, topology, and spawn
operations—are rejected before authorization or emission and cannot be sent
from an upgraded peer to an endpoint-only or legacy-only peer. Endpoint-only
joins remain untrusted and negotiate no optional protocol; providing the
peer's signed manifest enables JCS without treating the current process as the
remote handshake responder. This preserves low-risk health/status
interoperability with previous installations without silently downgrading
consequential traffic. Nested JCS tampering and
verify-before-authorize-before-emit ordering are covered by tests.

This closes the first three baseline findings for the implemented plugin path,
but it does not make the overall federation production-ready. Runtime
composition with the claims repository, durable ingress/outbox storage,
federated fencing authority, grant exchange, identity federation, revocation,
and the production Cognitum enforcement points remain pending.

The concurrent Cognitum audit also found that its current website harness has
valuable path/resource leases, heartbeats, messages, ports, and run receipts,
but several writers share one dirty worktree and receipts bind only `HEAD`.
That coordination state cannot prove the exact source snapshot or fence a stale
writer. ADR-327 adopts the useful harness contract while retaining one
worktree per writer and adding source-state identity and fencing epochs.

The product audit found no production Ruflo verifier in Cognitum Functions.
Firebase tenancy, Meta-LLM account identity, AgentBBS identity, and RuView edge
authority must therefore remain separate until ADR-326's verified principal
links, audience-bound grants, and local enforcement points are implemented.

ADR-101 remains useful as a component-level design record. Its assertion that
federated claims are production-wired is superseded by this audit until the
acceptance tests below pass.

## Security invariant

For every federated action:

```text
authenticated workload
  + trusted federation relationship
  + valid, narrower delegated grant
  + current policy authorization
  + valid work-ownership transition
  + durable receipt
  = eligible execution
```

No one term can substitute for another:

- a signed envelope proves control of a key, not permission;
- an Agent Card advertises a capability, not authority;
- a work claim records ownership, not unrestricted tool access;
- an authorization grant allows an action, not a conflicting ownership state;
- a consensus result does not excuse a failed local safety policy.

## Decision

### 1. Unify policy authority without unifying domain objects

ADR-324 `AgenticPolicyEngine` becomes the sole policy decision point for Ruflo
federation. The federation plugin becomes a policy enforcement point at both
ingress and egress.

Work claims remain in `@claude-flow/claims`; they are not converted into
authorization tokens. Instead, work-ownership facts become one input to policy:

```text
subject: user:alice
actor: spiffe://team-a.example/agent/coder-7
action: work.handoff
resource: ruflo://repo/acme/api/issues/136
workOwner: agent:planner-2
tenant: acme
environment: production
```

The engine returns `allow`, `deny`, or `require_approval` and a signed decision
receipt. Federation code MUST NOT contain an independent `checkClaim: () =>
true` authorization path.

### 2. Introduce explicit identity and trust providers

The capability plane defines these provider interfaces:

```ts
interface WorkloadIdentityProvider {
  currentIdentity(): Promise<WorkloadIdentity>;
  verify(assertion: IdentityAssertion): Promise<VerifiedIdentity>;
}

interface TrustBundleProvider {
  resolve(trustDomain: string): Promise<VersionedTrustBundle>;
  watch(onChange: (bundle: VersionedTrustBundle) => void): () => void;
}

interface AuthorizationGrantProvider {
  exchange(request: DelegationRequest): Promise<AuthorizationGrant>;
  verify(grant: AuthorizationGrant, proof: SenderProof): Promise<VerifiedGrant>;
  revoke(grantId: string, reason: string): Promise<void>;
}
```

The default `LocalKeyIdentityProvider` wraps Ruflo's existing Ed25519 node
keypair. An optional `SpiffeIdentityProvider` obtains X.509-SVID or JWT-SVID
material through the SPIFFE Workload API.

Federation relationships are one-way records binding:

```text
trustDomain
bundleEndpoint
endpointProfile
acceptedAlgorithms
policyProfile
maximumDelegationDepth
statusFeed
```

This follows SPIFFE Federation's central rule: the configured trust-domain name
must remain bound to the correct rotating bundle. Mutual trust requires two
explicit relationships.

For small deployments, relationships remain directly configured and pinned.
OpenID Federation is an optional resolver for larger, multilateral
federations. A resolved trust chain MUST be rooted in a locally configured
anchor, MUST apply metadata policy monotonically, and MUST fail closed on a
conflict.

### 3. Use narrow, sender-constrained delegation

Cross-agent delegation uses an RFC 8693-compatible subject/actor model. A
delegated grant MUST include:

```text
issuer
subject
actor (and bounded actor chain)
audience/resource
tenant
actions
resource selectors
not-before and expiry
grant ID
parent grant hash
delegation depth
proof-of-possession key thumbprint
policy version
```

Token exchange MUST only produce a grant whose actions, resources, audience,
expiry, budget, and delegation depth are equal to or narrower than its inputs.
The subject and actor remain separately attributable.

Bearer-only grants are prohibited for federated ownership mutations.
Deployments use one of:

- mTLS/certificate-bound access tokens where the transport exposes a workload
  certificate; or
- DPoP proofs where application-layer key binding is required.

Every resource server validates the intended audience. Ruflo never passes the
incoming token through to a downstream MCP server or agent; it exchanges it
for a narrower, audience-specific grant.

### 4. Define one canonical signed envelope

Federation v2 envelopes use:

```text
canonical form: RFC 8785 JSON Canonicalization Scheme (JCS)
payload subset: I-JSON
signature: Ed25519
content ID: sha256:<lowercase hex>
timestamp: RFC 3339 UTC
```

The protected signed object includes the protocol name, version, message type,
message ID, source identity, target identity/audience, tenant, session ID,
issued-at, expiry, nonce, content type, complete nested payload, authorization
grant hash, and policy profile.

Signing and verification MUST use the same recursive canonicalizer. Duplicate
keys, non-finite numbers, negative zero, values outside the I-JSON safe
interoperability range, unknown critical headers, and unsupported versions are
rejected before policy evaluation.

Legacy v1 envelopes may be read only in `legacy` or `observe` mode between
explicitly pinned peers. They MUST NOT authorize work acquisition, release,
steal, handoff, promotion, tool execution, or administrative changes.

### 5. Enforce a single symmetric message pipeline

Inbound processing order is normative:

```text
wire size and framing
  -> strict schema/version/I-JSON validation
  -> JCS content ID and Ed25519 verification
  -> target, audience, tenant, time, session, and nonce/replay checks
  -> peer identity and trust-bundle validation
  -> key/revocation/status validation
  -> PII, prompt-injection, and content policy
  -> ADR-324 authorization decision
  -> idempotent domain transaction
  -> decision + domain receipt append
  -> typed event after commit
```

Egress performs the corresponding checks before transmission, including PII
scanning, authorization, audience-specific token exchange, and an outbox
transaction. A message is never considered delivered merely because a local
event was appended.

The dispatcher has no unsigned production mode. Legacy tests can inject a
verifier only through an explicitly named test adapter.

### 6. Split ownership consistency by operation

Vector clocks and HLCs remain useful for causal replication, diagnostics,
progress updates, notes, and other mergeable observations. They are
insufficient to guarantee exclusive ownership during a network partition.

Ownership-changing transitions use a CP authority:

```ts
interface WorkOwnershipRecord {
  claimId: string;
  authorityDomain: string;
  owner: string | null;
  epoch: bigint;          // monotonic fencing token
  leaseExpiresAt: string;
  version: bigint;
  lastReceiptId: string;
}
```

Each work resource has one configured authority domain. `acquire`, `steal`,
`handoff`, `release`, and lease renewal are compare-and-swap transactions at
that authority:

```text
commit only when:
  authority == configuredAuthority
  current.version == request.expectedVersion
  current.epoch == request.expectedEpoch
  grant permits the exact transition
  idempotencyKey has not committed a different request
```

A successful ownership transition increments the fencing epoch. Every worker
must present that epoch to protected side effects; a resource adapter rejects
stale epochs. A lease expiry permits reassignment but never makes an old epoch
valid again.

The first implementation may use an existing linearizable store with
transaction, lease, and revision support. A pluggable `OwnershipAuthority`
keeps local single-node CAS as the default and permits an etcd/consensus-backed
provider for multi-node deployments.

During loss of quorum, ownership mutations fail closed. Progress telemetry and
other AP-safe data may continue to replicate.

### 7. Make event delivery durable and idempotent

Federated work events use a transactional outbox and durable inbox:

- the ownership/domain mutation, decision receipt, and outbox append commit
  atomically;
- delivery is at least once;
- the inbox deduplicates by message ID plus content ID;
- applying the same message twice returns the original receipt;
- a message ID paired with a different content ID is a security incident;
- the receiver acknowledges only after its domain transaction commits;
- retries use bounded exponential backoff and a dead-letter state;
- startup rebuilds HLC/vector state from durable history.

Code must not mutate a private in-memory event array to simulate rollback.

### 8. Add continuous revocation

Short-lived grants are the baseline. The trust plane also consumes signed
status events for:

- grant revocation;
- workload suspension or eviction;
- trust-bundle/key rotation;
- policy-profile change;
- tenant membership removal;
- detected credential compromise.

The transport uses a Shared Signals/CAEP-compatible adapter where an enterprise
issuer supports it. Local and bilateral deployments use the same internal
event model without requiring an external provider.

High-risk actions re-check current status online. Lower-risk actions may use a
bounded cache. Revocation delay is visible in decision receipts.

### 9. Interoperate with MCP and A2A without weakening policy

For HTTP MCP:

- expose OAuth Protected Resource Metadata;
- discover the authorization server through the protected-resource contract;
- request audience-specific resource indicators;
- validate that the presented grant was issued for this MCP resource;
- exchange rather than forward an inbound token to downstream services.

For A2A:

- publish `securitySchemes` and `securityRequirements` in Agent Cards;
- authenticate every request;
- authorize every operation, skill, resource, and tenant boundary;
- keep credentials out of Agent Card payloads;
- bind chained-task credentials to the originating agent;
- protect Agent Card fetching against SSRF, redirects to private networks,
  excessive response size, and DNS rebinding.

A2A and MCP are protocol adapters into the same identity, grant, and
ADR-324 decision model. Neither protocol becomes an alternate authority.

## Reference architecture

```text
                 Trust configuration / rotating bundles
           +-----------------------------------------------+
           | SPIFFE provider | Local key provider | OIDF   |
           +-------------------------+---------------------+
                                     |
                                     v
+----------+   signed v2 envelope   +----------------------+
| Ruflo A  | ---------------------> | Federation ingress   |
| egress   |                        | PEP                  |
+----+-----+                        +----------+-----------+
     |                                         |
     | narrow grant                            v
     |                               +---------------------+
     +------------------------------>| ADR-324 policy PDP  |
                                     +----------+----------+
                                                |
                                     allow + receipt
                                                |
                     +--------------------------+----------+
                     |                                     |
                     v                                     v
          +----------------------+              +---------------------+
          | Ownership authority  |              | AP event replica    |
          | CAS + lease + epoch   |              | HLC + vector clock  |
          +----------+-----------+              +---------------------+
                     |
                     v
          Durable inbox/outbox + receipt ledger
```

## Threat model

The design explicitly covers:

1. a malicious candidate agent with valid federation membership;
2. a compromised peer process or signing key;
3. stolen or replayed authorization grants;
4. nested-payload or metadata tampering;
5. a confused deputy forwarding broad credentials;
6. a malicious or compromised identity issuer;
7. stale or substituted trust bundles;
8. replay of an old accepted handoff;
9. concurrent promoters or ownership claimants;
10. network partitions and delayed messages;
11. compromised policy or status attestors;
12. PII and prompt injection in work metadata;
13. SSRF through A2A or federation metadata discovery;
14. resource exhaustion through signature, policy, or fan-out work.

Compromise of both an actor and its protected proof-of-possession key remains
out of scope for cryptographic replay prevention; blast radius is bounded by
short lifetimes, narrow audiences, budgets, policy, and revocation.

## Alternatives considered

### Keep ADR-101 unchanged

Rejected. Component tests do not establish runtime composition, authorization,
durability, or exclusive ownership under partition.

### Treat signed work claims as capabilities

Rejected. Ownership and authorization have different lifecycle, delegation,
revocation, and consistency rules. Conflating them makes a work assignment an
ambient privilege escalation.

### Make all claim data strongly consistent

Rejected. Notes, progress, and observations benefit from availability and can
merge causally. Only exclusive ownership transitions and their security
receipts require the CP path.

### Make all claim data eventually consistent

Rejected. Exclusive ownership cannot be guaranteed during a partition without
an authority, lease, quorum, or fencing mechanism.

### Require SPIRE and OAuth for every installation

Rejected. It would break offline and single-developer workflows. Standards are
implemented behind provider interfaces; the local profile remains first-class.

### Adopt a new capability-token format as the internal source of truth

Not selected for the first implementation. Macaroon-, Biscuit-, or
UCAN-inspired attenuation can be evaluated behind `AuthorizationGrantProvider`,
but OAuth token exchange and sender-constrained tokens provide stronger
interoperability with MCP, A2A, and enterprise identity infrastructure. The
ADR-324 policy state and receipts remain authoritative.

## Backward compatibility

1. Existing local `ClaimService` APIs and local repositories retain behavior.
2. Federation is opt-in and disabled on upgrade unless previously configured.
3. Existing installations start in `legacy`; `observe` evaluates the new
   pipeline without authorizing remote mutation; `enforce` requires migration
   checks and explicit administrator activation.
4. `ruflo claims` remains an alias while new `ruflo authz` commands are added.
   The alias emits a deprecation notice but preserves output schemas for one
   major release.
5. Existing work-claim wire messages remain readable for diagnostics and
   non-mutating telemetry between pinned peers. They cannot change ownership.
6. The migration converts local capability files into versioned ADR-324 rules.
   Parse or integrity failure is fail closed and provides a repair command.
7. Removing optional federation/identity providers leaves the local claims and
   policy systems operational.

## Implementation plan

### Phase 0 — Critical correctness gate

- Replace ad hoc canonicalization with an audited RFC 8785 implementation.
- Add nested mutation, duplicate-key, numeric edge, and cross-runtime vectors.
- Require verifier injection in every non-test dispatcher.
- Enforce nonce, freshness, expiry, target, audience, tenant, and session.
- Put `claim-event` and `agent-handoff` behind an explicit disabled-by-default
  policy profile rather than an accidental allowlist omission.
- Remove permissive local capability-file fallback.

No federated ownership mutation may ship before Phase 0 passes.

### Phase 1 — Runtime composition and durable delivery

- Add explicit package/plugin composition for claims, security, and federation.
- Construct the bridge, durable event store, repository, inbound handlers, and
  ADR-324 PEP in one composition root.
- Implement transactional outbox/inbox storage and crash recovery.
- Replace `checkClaim: () => true` with typed ADR-324 requests.
- Expose integration health that reports each required handler/provider.

### Phase 2 — Ownership authority

- Add `OwnershipAuthority` with local CAS and a linearizable distributed
  provider.
- Add lease renewal and monotonic fencing epochs.
- Split AP-safe events from ownership mutations.
- Make every protected work side effect validate the current epoch.

### Phase 3 — Identity, delegation, and revocation

- Introduce local and SPIFFE identity/trust-bundle providers.
- Add subject/actor token exchange and narrower-grant validation.
- Add mTLS or DPoP proof verification.
- Add status-event ingestion, key rotation, grant revocation, and cache policy.

### Phase 4 — MCP, A2A, and multilateral federation

- Publish MCP protected-resource metadata and audience-scoped challenges.
- Populate and enforce A2A Agent Card security requirements.
- Harden all metadata fetchers against SSRF and redirect abuse.
- Add optional OpenID Federation trust-chain resolution.
- Run cross-implementation conformance suites.

### Phase 5 — Convergence and removal

- Migrate legacy local authorization claims to ADR-324 policy objects.
- Remove the independent federation claim checker.
- Remove legacy mutating envelopes after one major release.
- Update ADR-101 status after production acceptance evidence is recorded.

## Normative acceptance tests

The feature is production-ready only when all of these pass:

1. Changing one byte in any nested payload or protected metadata field fails
   signature verification.
2. RFC 8785 official vectors produce identical bytes across supported runtimes.
3. Duplicate keys, non-finite values, negative zero, and unsupported critical
   fields fail closed.
4. Reusing a valid message nonce is rejected, including after process restart.
5. Wrong audience, target, tenant, session, time window, or trust domain is
   rejected.
6. A suspended peer, revoked grant, or removed signing key is rejected within
   the configured status objective.
7. A delegated grant can never expand action, resource, audience, expiry,
   budget, or delegation depth.
8. A stolen grant without its DPoP/mTLS key cannot authorize an action.
9. Every A2A and MCP operation reaches the same ADR-324 policy decision point.
10. One hundred concurrent acquisitions of an unowned work claim produce
    exactly one owner and one current fencing epoch.
11. During a partition, no side effect accepts two different owners' epochs.
12. A stale owner is rejected after reassignment even if its original lease
    message is replayed.
13. Fault injection at every outbox, inbox, ownership, and receipt commit
    boundary recovers to one consistent state.
14. Re-delivery is idempotent; message-ID/content-ID mismatch is quarantined.
15. PII and prompt-injection policy runs before a work event reaches the domain
    handler.
16. Explicit federation mode fails closed when policy, identity, revocation, or
    durable storage is unavailable.
17. Local mode remains behaviorally compatible when all optional providers are
    absent.
18. Upgrade, downgrade-within-support, and fresh-install tests preserve
    existing local claims without silently granting new authority.

## Performance and reliability targets

These are acceptance targets, not claims about current performance:

| Metric | Target |
|---|---|
| Warm local envelope verification + replay + policy, 1 KiB payload | p99 <= 2 ms, measured separately from network and domain work |
| Added allocation per verified 1 KiB message | <= 32 KiB |
| Duplicate delivery | No duplicate domain side effect |
| Ownership race | Exactly one winner for 100 concurrent requests |
| Revocation propagation, high-risk profile | p99 <= 5 s |
| Revocation propagation, standard profile | p99 <= 60 s |
| Crash recovery | No acknowledged message or receipt lost |
| Local-mode regression | <= 5% p95 latency and no API/output-schema break |

Benchmarks MUST publish hardware, runtime, key algorithm, payload distribution,
policy size, warm-up, sample count, and confidence interval. Optimization may
not remove a security check; cached results include identity, audience,
resource, action, tenant, policy version, grant ID, proof key, and revocation
epoch in the cache key.

## Operational visibility

`ruflo federation doctor --claims` will report:

- identity provider and current workload ID;
- configured trust domains and bundle age;
- policy mode/version and ingress/egress enforcement state;
- claims bridge and both inbound handlers;
- ownership authority, quorum, and lease health;
- inbox/outbox lag and dead-letter count;
- nonce-store durability;
- revocation stream age;
- A2A/MCP security metadata conformance;
- legacy-envelope traffic preventing enforcement.

The command must never print private keys, bearer grants, DPoP private material,
or unredacted work metadata.

## Consequences

### Positive

- One policy authority governs local, MCP, A2A, and federation actions.
- Workload identity, delegated human authority, and acting agent remain
  attributable.
- Exclusive ownership becomes safe under concurrency and partition.
- Local users retain an offline-compatible path.
- Standards-based adapters reduce bespoke federation protocol surface.
- Decision and ownership receipts support incident review and independent
  verification.

### Negative

- Federated ownership requires a linearizable authority and therefore cannot
  remain available through every partition.
- Durable inbox/outbox, revocation, and trust-bundle operations add complexity.
- Sender-constrained delegation requires key lifecycle and secure storage.
- Multilateral federation increases trust-chain and metadata-policy operating
  burden.

### Neutral

- HLC and vector clocks remain, but their role narrows to causality and AP-safe
  replication.
- Agent Cards continue to advertise capabilities; they simply stop being
  mistaken for authorization.
- ADR-101 is retained as historical context rather than rewritten.

## SOTA references

- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 8693: OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693.html)
- [RFC 9449: OAuth 2.0 Demonstrating Proof of Possession](https://www.rfc-editor.org/rfc/rfc9449.html)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
- [RFC 9728: OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728.html)
- [SPIFFE Federation](https://spiffe.io/docs/latest/spiffe-specs/spiffe_federation/)
- [SPIFFE Workload API](https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/)
- [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html)
- [OpenID Shared Signals Framework, CAEP, and RISC final specifications](https://openid.net/three-shared-signals-final-specifications-approved/)
- [MCP authorization specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [A2A protocol specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
- [A2A agent discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [etcd transactions, leases, and fencing revisions](https://etcd.io/docs/v3.8/learning/why/)

## Review trigger

Review this ADR when any of the following occurs:

- A2A or MCP changes its authorization model;
- OpenID Federation or Shared Signals publishes a new final version;
- SPIFFE changes its stable federation or workload identity contracts;
- Ruflo supports a new distributed ownership authority;
- production evidence demonstrates a different consistency or latency
  requirement;
- any acceptance invariant is weakened for compatibility or performance.
