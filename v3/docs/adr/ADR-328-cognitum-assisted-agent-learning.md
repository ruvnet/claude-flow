# ADR-328: Cognitum-Assisted Agent Learning Capability Plane

**Status**: Proposed — structural policy primitives implemented; service adapters pending  
**Date**: 2026-07-28  
**Decision owners**: Ruflo memory, policy, MetaHarness, Meta-LLM, and Cognitum maintainers  
**Related**: ADR-176, ADR-322, ADR-323, ADR-324, ADR-325, ADR-326,
ADR-327

## Executive decision

Ruflo may use Cognitum and Meta-LLM services to improve agent development
through routing, critique, evidence retrieval, and validated memory proposals.
Those integrations form a **capability plane**, not an authority plane.

The closed initial action vocabulary is:

```text
cognition.route
cognition.critique
memory.recall
memory.propose
evidence.read
memory.commit-validated
```

No action in this profile authorizes policy promotion, MetaHarness promotion,
deployment, release, IAM, billing, secret access, or an ownership transition.
Those actions continue through their separate ADR-324/325 envelopes.

A Cognitum service can propose learning evidence. It cannot write Ruflo memory
directly. A validated memory commit requires a content-bound, one-use
capability and an ADR-324 decision receipt. Committing memory never
automatically changes active policy or promotes a model/candidate.

## Why this ADR is separate

ADR-326 defines cross-product authority and envelope semantics. Assisted agent
learning has a different lifecycle and failure mode:

- model output is evidence with `agent_output` provenance, not truth;
- recalled memory can be stale, poisoned, cross-tenant, or irrelevant;
- critique may improve a trajectory without being safe to execute;
- a useful pattern may be safe for memory but unsafe for active policy;
- service health and authorization change independently.

Treating cognition as ambient authority would let a model route expand its own
tools, persist its own conclusions, or promote its own policy. This ADR forbids
that loop.

## Decision

### 1. Keep each action narrow

| Action | Purpose | Explicitly does not allow |
|---|---|---|
| `cognition.route` | Recommend a model, provider, skill, or workflow route | Execute the route, add tools, increase budget |
| `cognition.critique` | Evaluate a plan, patch, test result, or trajectory | Modify code, approve a release, declare truth |
| `memory.recall` | Retrieve tenant- and namespace-bounded memory | Write, delete, promote, or broaden retrieval |
| `memory.propose` | Submit content for validation | Commit memory or alter policy |
| `evidence.read` | Resolve approved evidence by digest/reference | Read secrets or unredacted private data |
| `memory.commit-validated` | Commit exactly validated content | Modify active policy, route, model, or deployment |

Delegation may reduce these actions, resources, budgets, expiry, and
concurrency. It cannot add another action.

### 2. Bind cognition requests and results

A cognition request binds:

- issuer, subject, actor, audience, tenant, and namespace;
- exact action and resource;
- input or privacy-preserving input digest;
- model/provider eligibility and SafetyEnvelope;
- token, USD, latency, network, and concurrency ceilings;
- idempotency key, issued-at, expiry, and proof key;
- policy version and decision receipt.

A response binds the request digest, route/model actually used, output digest,
usage, latency, provider status, evidence references, and refusal/degraded
state.

Model prose is never interpreted as a capability. Structured output is
validated against the action schema and is still untrusted evidence.

### 3. Separate availability dimensions

Every service probe records:

```ts
interface CognitionServiceHealth {
  identity: 'verified' | 'unverified' | 'unknown';
  configured: 'yes' | 'no' | 'unknown';
  reachable: 'yes' | 'no' | 'unknown';
  healthy: 'yes' | 'no' | 'unknown';
  authorized: 'yes' | 'no' | 'unknown';
  status: 'available' | 'degraded' | 'blocked' | 'unavailable';
  checkedAt: string;
}
```

A valid grant does not imply reachability or health. A successful health probe
does not imply authorization. Missing configuration is distinct from network
failure. Product and CLI surfaces preserve these states rather than showing one
generic success/failure badge.

When cognition is unavailable, Ruflo may use its explicit local route if the
task and policy allow it. The fallback is recorded. A degraded cognition run
cannot promote MetaHarness state.

### 4. Treat recall as evidence

Recall returns typed ADR-323 memory records with provenance, tenant, namespace,
source digest, creation/observation time, expiry, confidence, and revocation
state. Retrieval policy filters before content reaches the agent.

The agent and validator distinguish:

- `system_observation`;
- `tool_result`;
- `user_claim`;
- `agent_output`; and
- `unknown`.

Similarity is not authority. A high vector score cannot satisfy signed
evidence, current observation, tenant, or policy requirements.

### 5. Use a proposal and validation pipeline

```text
memory.propose
  -> content and source digests
  -> schema and provenance validation
  -> poisoning/PII/prompt-injection checks
  -> duplication and contradiction checks
  -> policy evaluation
  -> optional human approval
  -> one-use memory.commit-validated capability
  -> atomic memory commit and receipt
```

The proposal includes the target tenant, namespace, memory type, content
digest, evidence digests, validator profile, proposed expiry, and correlation
ID. Validators do not mutate memory.

The commit capability binds:

```text
proposal ID and revision
tenant and namespace
exact content digest
ordered evidence digest set
validator ID and version
policy version and receipt
approval reference when required
idempotency key
expiry and maxUses = 1
```

The memory authority consumes the capability and writes the memory record,
receipt, and outbox event atomically. The same key and request digest replay
the original result; the same key with different content conflicts.

### 6. Keep memory and policy transactions separate

A committed memory can influence a future policy proposal or benchmark. It
cannot:

- update an ADR-324 rule;
- issue an approval;
- expand a CapabilityEnvelope;
- change an active champion;
- promote a Darwin/MetaHarness candidate;
- change a production route;
- authorize a tool or network side effect.

Policy and promotion require independent evaluation and transaction receipts.
The policy request may cite the memory record as evidence, but must recompute or
verify every authorizing term.

### 7. Make learning tenant-safe and revocable

Memory namespaces are tenant-qualified. Cross-tenant learning requires a
separate, explicit, privacy-reviewed aggregate that contains no tenant data and
cannot be reverse-mapped to one tenant.

Revocation or correction creates a new authoritative event. Existing receipts
remain in history but future recalls exclude the revoked record. Dependent
policy proposals and benchmark receipts retain the referenced memory digest so
impact can be traced.

### 8. Preserve local and previous-install behavior

- All Cognitum cognition providers are optional.
- Existing local AgentDB recall and memory APIs remain available.
- New installations start external cognition in `observe`.
- Existing memory writes retain compatibility mode until a namespace opts into
  validated commits.
- Privileged or cross-tenant memory commits fail closed without the new
  capability.
- Removing the provider disables assisted actions but does not corrupt or
  delete local memory.

## Implementation profile

The first Ruflo implementation provides:

- action names and ownership mapping in the ADR-326 product-plane module;
- structural envelope and identity/tenant validation;
- separate product-health dimensions;
- action-specific requirements for digest, idempotency, expiry, policy receipt,
  and capability;
- signed-envelope verifier hooks for local trust, replay, policy, and
  capability authorities.

The following remain service-adapter work:

- Cognitum token exchange;
- Meta-LLM route and critique adapters;
- durable external evidence resolution;
- the AgentDB transactional validated-commit consumer;
- dashboard/CLI health projection; and
- cross-repository conformance tests.

Until those adapters exist, documentation and release notes must describe the
feature as a policy and interoperability foundation, not an active cloud
self-learning loop.

## Normative acceptance tests

1. A route response cannot add an action, tool, provider, budget, network
   access, or delegation depth.
2. A valid claim with an unreachable service reports `unavailable`.
3. A healthy service with a denied action reports `blocked`.
4. A critique is stored as `agent_output`, not `system_observation`.
5. Recall never crosses tenant or namespace without an explicit aggregate
   grant.
6. Revoked or expired memory is absent from new recall results.
7. A model output cannot directly call `memory.commit-validated`.
8. A proposal with changed content after validation is rejected.
9. A capability with a mismatched tenant, namespace, validator version,
   evidence set, policy receipt, or content digest is rejected.
10. One hundred concurrent commits of one proposal produce one memory record
    and one current receipt.
11. Reusing an idempotency key with different content returns conflict.
12. A committed memory does not change active policy or champion state.
13. A policy or promotion proposal citing memory re-evaluates all authorizing
    terms.
14. Provider unavailability preserves the explicit local fallback and records
    degradation.
15. Removing optional Cognitum/Meta-LLM providers leaves local AgentDB
    operational.

## Consequences

### Positive

- Agents gain bounded cloud-assisted routing and critique.
- Useful learning can become durable without allowing a model to persist its
  own unchecked conclusions.
- Service failures remain diagnosable.
- Memory, policy, promotion, deployment, and spend retain separate authority.

### Negative

- Validated commits add latency and storage.
- Evidence and revocation require durable references.
- Operators must configure both product identity and Ruflo policy.

## Review trigger

Review this ADR when an external cognition provider receives write authority,
AgentDB adds a transactional validation API, a memory record becomes an input
to automatic policy or promotion, or the local compatibility path is removed.
