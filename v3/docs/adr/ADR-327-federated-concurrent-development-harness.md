# ADR-327: Federated Concurrent Development Harness

**Status**: Proposed — generator guidance and in-memory conformance references implemented; distributed enforcement pending  
**Date**: 2026-07-28  
**Decision owners**: Ruflo Codex, claims, policy, and developer-experience maintainers  
**Related**: ADR-320, ADR-324, ADR-325, ADR-326

## Executive decision

Ruflo will support repository-local development harnesses as adapters into its
policy-governed concurrent workflow.

The useful primitives observed in the cognitum.one website harness are adopted:

- explicit sessions;
- path and named-resource leases;
- lease heartbeats;
- agent-to-agent handoff messages;
- isolated development ports;
- test and release receipts; and
- dry-run deployment with release gates.

Those primitives are coordination evidence, not authorization. They supplement
but never replace Ruflo's stronger invariant that every writing agent uses a
distinct Git worktree.

Ruflo will define one versioned harness contract with:

- canonical repository and source-state identity;
- linearizable leases with monotonically increasing fencing tokens;
- separate authorization capabilities;
- durable, acknowledged messages;
- immutable test and release receipts; and
- compatibility adapters for existing local harnesses.

Generator and AGENTS guidance will teach Codex to discover and join a tracked
repository harness without weakening the worktree or policy rules. Distributed
lease enforcement remains proposed until the acceptance tests pass.

### Implemented reference scope

The Codex package now includes source/build evidence capture plus
`InMemoryFencedLeaseReference`, `InMemoryInboxReference`, and
`InMemoryRunReceiptReference`. These are deliberately unsigned, non-persistent,
single-process conformance/debug references:

- their descriptors are statically restricted to `observe` and `advisory`;
- legacy normalization cannot upgrade them to enforce or release authority;
- canonical uint64 parsing, length-framed inbox identity, portable
  case-collision refusal, version checks, replay convergence, and contention
  semantics are tested;
- Git-visible source state and separately declared unsigned build inputs can
  be captured and recomputed.

They do not implement a CP lease service, durable inbox/outbox, signed
hash-chained ledger, restart recovery, or release-decision composer. An
external-authority adapter satisfying the normative sections below remains
required for enforcement and release.

## Current-state audit

The cognitum.one website harness currently provides a practical, file-backed
coordination layer:

- a mutex plus atomic rename protects local JSON lease updates;
- path claims reject option-like scope values and overlapping ancestors or
  descendants;
- named resource claims cover deployment and shared services;
- heartbeats, not PIDs, represent lease liveness;
- sessions carry inbox messages and development ports;
- test receipts bind a command, scope, result, and Git SHA;
- deployment is dry-run by default and checks release receipts.

This is useful local coordination, but the live audit found:

- multiple writing agents share one dirty website worktree;
- a receipt that records only `HEAD` cannot identify which dirty source state
  was tested;
- ignored JSON sessions, leases, messages, and receipts are mutable and
  unsigned;
- any local process can impersonate a session or alter coordination state;
- leases have no fencing token, so an expired writer cannot be rejected by a
  protected side effect;
- liveness is not bound to repository, worktree, branch, host, or workload
  identity;
- the inbox keeps a bounded tail rather than a durable acknowledged stream;
- an eight-hour TTL can retain stale ownership for a long period; and
- the local mutex cannot coordinate multiple hosts.

The harness correctly treats a missing PID as insufficient proof of death.
Lease expiry and heartbeat are the right liveness abstraction, but production
concurrency requires fencing and exact source-state receipts.

## Security and correctness invariants

1. Every writing agent has a distinct Git worktree.
2. A path lease prevents overlapping intent; it does not make shared dirty
   state safe.
3. A repository lease coordinates ownership; it does not grant authorization.
4. A session identity is not a workload identity or product capability.
5. Every successful lease acquisition returns a monotonically increasing
   fencing token.
6. Protected writes reject a stale fencing token after expiry, release, steal,
   or reacquisition.
7. `HEAD` alone is not an exact source-state identity when a worktree is dirty.
8. Test, release, and deployment receipts bind the exact source state.
9. Message delivery is durable and idempotent; reading a bounded tail is not
   acknowledgement.
10. Harness unavailability may stop protected mutation but never silently
    expand authority.

## Decision

### 1. Define a repository harness adapter

Ruflo discovers a harness only through tracked repository configuration:

```ts
interface RepositoryHarnessAdapter {
  describe(): Promise<HarnessDescriptor>;
  start(request: StartSessionRequest): Promise<HarnessSession>;
  acquire(request: LeaseRequest): Promise<FencedLease>;
  renew(lease: FencedLease): Promise<FencedLease>;
  release(lease: FencedLease): Promise<void>;
  send(message: HarnessMessage): Promise<MessageReceipt>;
  receive(cursor?: string): AsyncIterable<HarnessMessage>;
  acknowledge(messageId: string): Promise<void>;
  recordRun(run: RunEvidence): Promise<RunReceipt>;
  authorizeRelease(request: ReleaseRequest): Promise<ReleaseDecision>;
  end(sessionId: string): Promise<void>;
}
```

Repository scripts remain the preferred local user interface. Ruflo does not
replace a project's custom harness or invent commands. The adapter reads its
declared capabilities and invokes only supported operations.

If no tracked harness exists, Ruflo uses its local claims and policy providers.
If an explicitly selected harness is unavailable, protected operations fail
closed.

### 2. Retain one worktree per writer

The parent agent creates or assigns a distinct worktree before a writing worker
acquires paths. A lease then provides fine-grained ownership inside that
worktree and across agents:

```text
isolated worktree
  + non-overlapping path/resource lease
  + narrow authorization capability
  + current fencing token
  = eligible protected write
```

Read-only agents may share a checkout if they acquire no writing lease. One
designated integration agent owns shared manifests and lockfiles.

Legacy shared-worktree harnesses remain observable in compatibility mode, but
Ruflo does not describe them as isolated or receipt-complete. Their dirty
source state cannot authorize release.

### 3. Canonically identify repository and source state

A repository identity binds at least:

```ts
interface RepositoryIdentity {
  repositoryId: string;
  canonicalRemote?: string;
  gitCommonDirId: string;
  rootTreeId: string;
}
```

Paths are repository-relative, Unicode-normalized, separator-normalized, free
of `.` and `..`, checked after symlink resolution, and compared with the
platform's case behavior. Option-like values are rejected.

The preferred source state is a clean, committed worktree:

```text
SourceStateID = sha256(repositoryId || commit || tree)
```

When a local test intentionally covers uncommitted work, the receipt also
binds:

- the base commit;
- the binary-safe tracked patch digest;
- an untracked file manifest with mode, length, and content digest;
- submodule and large-file pointer state;
- generator inputs and relevant lockfile digests.

Such a local receipt may support debugging. A release receipt still requires a
clean committed state unless a project policy explicitly defines an equally
strong immutable snapshot mechanism.

### 4. Use CP leases and fencing tokens

The lease authority performs compare-and-swap transactions:

```ts
interface FencedLease {
  leaseId: string;
  repositoryId: string;
  sessionId: string;
  ownerWorkloadId: string;
  worktreeId: string;
  kind: 'path' | 'resource';
  scopes: string[];
  epoch: bigint;
  version: bigint;
  issuedAt: string;
  expiresAt: string;
}
```

Acquire, renew, release, and steal validate the expected version and current
owner. Every successful new ownership period increments `epoch`, including
reacquisition by the same session.

Filesystem adapters provide single-host compatibility. Distributed workflows
use a linearizable authority. Protected integrations, deployment drivers, and
shared generators compare the presented epoch with the authority before a side
effect. An old holder cannot continue merely because it still has local files.

Heartbeat proves current lease intent; PID is diagnostic only. A long-running
operation uses bounded renewable leases and cannot declare a mutex stale solely
because a fixed wall-clock duration elapsed.

### 5. Keep leases and authorization separate

A lease answers, "which worker currently owns this coordination scope?" A
grant answers, "may this identity perform this action?"

The ADR-324/325 decision request includes both:

```text
subject and workload identity
repository and source state
action and exact resource
lease ID, scope, epoch, and expiry
authorization grant
budget/concurrency/delegation envelope
policy version
```

No lease, session, message, test result, or agent role can synthesize a
deployment, network, spend, secret, administrative, or product capability.

### 6. Make messages durable

Harness messages use stable IDs, issuer and audience, correlation and causation
IDs, sequence, expiry, content digest, and acknowledgement state.

Delivery is at least once. The receiver deduplicates by issuer, message ID, and
content digest. A repeated ID with different content is quarantined. A bounded
UI view may show the most recent messages, but durable storage retains
unacknowledged handoffs and supports cursor resume.

Messages communicate observations, requests, conflicts, and handoffs. They do
not transfer path ownership or authority unless the corresponding lease or
grant transaction separately succeeds.

### 7. Bind run, release, and deployment receipts

A run receipt includes:

```ts
interface HarnessRunReceipt {
  receiptId: string;
  repositoryId: string;
  sourceStateId: string;
  sessionId: string;
  workloadId: string;
  commandDigest: string;
  scope: string;
  profile: 'focused' | 'integration' | 'release';
  startedAt: string;
  completedAt: string;
  exitCode: number;
  evidenceDigest: string;
  policyReceiptId: string;
  leaseEpochs: Record<string, string>;
}
```

Receipts are recursively canonicalized, content-addressed, signed, and
append-only. Retrying a command creates another execution ID; it does not
rewrite history.

A release decision requires:

- an allowed policy decision;
- a clean exact source state matching the candidate release;
- all project-required run profiles passing for that same state;
- valid leases and current fencing epochs for integration and release scopes;
- artifact and provenance digests;
- an authorized release capability; and
- no unresolved higher-priority refusal or stale dependency.

Deploy remains dry-run unless the user and policy authorize execution. A
passing run receipt is evidence, not deployment authority.

### 8. Federate across repositories through handoffs

Cross-repository work uses explicit producer and receiver ownership:

```text
producer commit and evidence
  -> signed handoff referencing exact source state
  -> receiver acknowledges
  -> receiver acquires its own local paths and capability
  -> receiver implements and verifies its side
```

One agent does not write into another dirty repository merely because both
participate in the same swarm. Contract changes identify the receiving owner,
compatibility window, and validation evidence.

This is especially important for Cognitum website to Meta-LLM structured
output, Cog release provenance, Comms event delivery, and RuView edge contracts.

## Codex workflow integration

Generated AGENTS guidance follows ADR-329's complete implementation loop:
recall, inspect, route, plan, execute, test, validate, benchmark, optimize,
receipt, handoff, and independently authorized publish. Harness-specific
actions occur inside that loop:

1. assign one worktree to each writer during routing;
2. start the tracked harness, inspect claims, and acquire exact scopes during
   planning;
3. renew leases and check acknowledged inbox messages during execution;
4. bind focused/integration results to exact source/build inputs during
   validation and receipt;
5. release claims and reconcile handoffs before the integration owner evaluates
   an external-authority release decision.

Ruflo coordinates this flow. Codex still performs the implementation and
verification work.

## Compatibility and migration

1. Existing repository harness commands and JSON schemas remain unchanged.
2. Ruflo first uses an `observe` adapter that imports session, lease, message,
   port, and run evidence without authorizing privileged actions.
3. Existing path leases map to epoch `0` and are advisory. They cannot
   authorize release.
4. New adapters dual-write durable lease and receipt records while projects
   retain their local UI.
5. Projects move to `enforce` only after writers use isolated worktrees,
   protected resources validate fencing tokens, and exact-source receipts pass.
6. Older Ruflo installations ignore the new optional adapter and retain local
   behavior.
7. Removing the adapter never grants broader access; protected federated
   operations become unavailable.

## Normative acceptance tests

1. One hundred concurrent acquisitions of the same scope produce one owner and
   one current epoch.
2. A stale writer is rejected after lease expiry and reacquisition.
3. Renew and release with an old version or epoch are rejected.
4. Ancestor, descendant, symlink, case, separator, Unicode, traversal, and
   option-like path collisions are detected.
5. The same relative path in two different repositories does not collide.
6. Two writing agents are refused when configured to use one worktree.
7. A clean commit and a dirty worktree at the same `HEAD` produce different
   source-state identities.
8. A one-byte tracked or untracked change invalidates the run receipt.
9. A message reconnect resumes without loss; replay produces no duplicate
   side effect.
10. A message ID paired with different content is quarantined.
11. A lease holder without an action grant cannot deploy, spend, access a
    secret, or mutate an external product.
12. A grant holder without the current lease epoch cannot mutate a protected
    coordination scope.
13. Fault injection at every lease, receipt, inbox, and outbox boundary
    recovers to one valid state.
14. A release attempt using passing tests from a different source state is
    rejected.
15. A passing test receipt without release authority remains dry-run.
16. A cross-repository handoff cannot modify the receiver until its local owner
    acknowledges and acquires the target scope.
17. Local single-agent workflows behave as before when no harness adapter is
    configured.

## Consequences

### Positive

- Ruflo can cooperate with existing repository harnesses instead of replacing
  them.
- Worktree isolation and fine-grained leases cover different failure modes.
- Fencing prevents stale workers from affecting protected resources.
- Test and release evidence becomes attributable to exact source.
- Cross-repository work has an explicit receiving owner.

### Negative

- Protected local writes need an enforcement hook to validate fencing tokens.
- Exact dirty-state hashing is more expensive than recording `HEAD`.
- Multi-host coordination requires a linearizable service.
- Legacy shared-worktree sessions remain advisory until migrated.

## Review trigger

Review this ADR when Git changes its worktree identity model, a repository
harness adds distributed leases, Ruflo supports a new source-control system, or
production evidence demonstrates a different lease or receipt requirement.
