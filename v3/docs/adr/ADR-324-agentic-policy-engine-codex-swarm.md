# ADR-324: Agentic Policy Engine and Policy-Governed Codex Swarms

**Status:** Accepted
**Date:** 2026-07-28
**Implementation:** Complete on `feat/adr-324-agentic-policy-engine`
**Related:** ADR-053 (AgentDB), ADR-101 (federated claims), ADR-131 (tool-output guardrail), ADR-144 (authorization propagation), ADR-145 (memory governance), ADR-176 (self-benchmarking loop), ADR-322/A/B/C (MetaHarness proposer, promotion transaction, receipts)

## Context

Ruflo already contains useful but disconnected controls:

- AgentDB memory, owner/access metadata, typed provenance, HNSW/RaBitQ and legacy SQL.js paths.
- `AgentAuthorizationPropagator`, whose monotonic `AuthScope` was not wired into production dispatch.
- Federation message policy, guidance authority levels, launch budgets, plugin integrity, and tool-output guardrails.
- ADR-322's signed evaluation receipts and compare-and-swap promotion transaction.
- A Codex adapter that registers Ruflo MCP and generates `AGENTS.md`, but whose concurrent workers could share one checkout and whose generated defaults did not define a single authorization authority.

No component answered the general question:

> May this identity perform this action on this resource, with this evidence,
> authority, cost, concurrency, and delegation chain, right now?

The missing authority also made concurrency unsafe. A coordinator could record work, but it could not prevent child agents or MetaHarness proposers from widening tools, network access, namespaces, spend, or promotion rights.

## Decision

Ruflo adopts `@claude-flow/security`'s `AgenticPolicyEngine` as the local authorization authority.

```text
identity + action + resource + evidence + capability envelope
                  + approval + budget + policy version
                               |
              allow | deny | require_approval
                               |
              hash-chained decision receipt
```

The engine is deterministic and side-effect free except for its state transaction. Adapters translate existing subsystem concepts into this request model. Existing specialized controls remain responsible for their domain mechanics; they no longer act as independent authorization authorities.

### Modes and backwards compatibility

| Mode | Logical decision | Runtime behavior |
|---|---|---|
| `legacy` | Existing behavior/default allow | allow and issue receipt |
| `observe` | Evaluate default-deny policy | allow, record would-deny |
| `enforce` | Evaluate default-deny policy | enforce allow/deny/approval |

Existing installations are auto-migrated to a versioned policy state in `legacy` mode. Migration is additive and detects legacy AgentDB/RVF locations and strict-mode flags without rewriting memory rows, indexes, receipts, namespaces, controller state, ReasoningBank, SkillLibrary, or HNSW data.

New policy fields default to absent/`unknown`. ANN index refreshes must never replace authoritative AgentDB rows. CLI/MCP command names and existing namespaces remain valid.

No automatic update may:

- upgrade across a major version;
- replace user `AGENTS.md` text or unknown TOML keys;
- delete or recreate a memory database;
- rewrite v1 Flywheel receipts or ledger entries;
- enable unattended fanout or enforcement without an explicit policy transition.

Generated configuration may raise a persisted mode (`legacy` → `observe` →
`enforce`) but cannot lower it. A downgrade is an explicit, interactive local
administrator action.

### Rule evaluation

Rules match action/resource patterns, principals, identity types, roles, environments, provenance, and hard constraints. Evaluation order is:

1. Validate the request.
2. Enforce the capability envelope.
3. Apply matching rules in deterministic priority/id order.
4. Deny overrides approval and allow.
5. Approval overrides allow until a valid scoped approval is consumed.
6. Apply budget ceilings.
7. Apply mode (`legacy`, `observe`, `enforce`).
8. Persist the decision receipt before returning authority.

Unmatched actions allow only in `legacy`; `observe` records default-deny but does not block; `enforce` blocks.

### Capability envelopes and delegation

An envelope may constrain actions, resources, tools, MCP servers, read/write namespaces, environments, network/destructive access, cost, tokens, concurrency, expiry, and delegation depth.

Every child envelope must be a monotonic reduction. A child cannot:

- add a pattern not granted by its parent;
- raise any numeric ceiling;
- extend expiry or depth;
- enable network/destructive access disabled by its parent.

Envelope violations are always enforced, including in `legacy` and `observe`;
those modes apply to policy-rule rollout, not delegated authority boundaries.

Agents and optimizers cannot approve themselves. Approvals are scoped, expiring, revocable, and limited-use.
Approval creation requires a deployment-supplied authenticated issuer
verifier. An arbitrary `issuedBy` string, environment allowlist, or local TTY
is not an authority credential. The default local CLI therefore cannot issue
approvals. The unregistered administrative MCP adapter derives the issuer from
authenticated user context and cannot accept a caller-supplied issuer.

### Budgets

Budgets match principal, action, and resource and limit USD/tokens per fixed window. Authorization and usage update occur under one cross-process policy-state lock. A denied action does not consume budget. Domain-specific budget providers may reserve additional resources but cannot weaken this ceiling.

Cost, token, and concurrency fields are declared reservations supplied by a
trusted adapter, not measurements from a provider invoice. A rule or budget
that constrains one of these dimensions fails closed when its value is absent.
Adapters must reserve before execution and reconcile separately; provider-side
hard caps remain the final ceiling against a compromised or under-reporting
adapter.

### Receipts and ledger

Every decision binds:

- canonical request and evidence;
- logical and enforced outcomes;
- matched rules and obligations;
- approval id, if consumed;
- policy bundle hash;
- previous receipt hash, sequence, and timestamp.

Canonical JSON sorts object keys and rejects non-finite numbers. SHA-256 content identifiers and a hash chain make alteration evident. A configured local key adds an HMAC authentication tag. Cross-install/federated policy bundles continue to require their existing Ed25519 trust model; a local HMAC is not represented as third-party attestation.

When a signing key is configured, unsigned receipts are invalid. Conversely, a
signed ledger cannot be declared valid without the matching verification key.
Signed policy evidence uses a trusted key selected by `keyId` from
`CLAUDE_FLOW_POLICY_EVIDENCE_KEYS`; its HMAC binds id, provenance, attestor,
observation time, content hash, and key id. The legacy caller-authored
`signed: true` field is retained for transport compatibility but confers no
authority.

### Enforcement surfaces

The first authoritative surface is the CLI MCP dispatcher: policy evaluates before tool handlers can produce side effects. The standalone MCP registry exposes the same middleware contract and can require an authorizer at construction; required mode cannot later remove its authorizer. Deployments must opt into that required mode. This ADR does not claim that every independently embedded MCP server or native Codex/Claude action is automatically wired.

Learning, metrics, and pattern storage remain fail-open. Policy enforcement is synchronous and authoritative:

- a first-run installation with no trust anchor may enter compatibility mode;
- once enforcement creates a trust anchor, missing, modified, or unauthenticated
  state fails closed and cannot silently return to legacy;
- host or user-account compromise remains outside this local trust boundary.

### AgentDB compatibility

ADR-323 provenance values are valid evidence types:

`user_claim`, `agent_output`, `system_observation`, `tool_result`, `unknown`.

Policy adapters preserve all previous AgentDB capabilities and add namespace decisions without changing retrieval algorithms. `tool_result` and `system_observation` may be required for factual or production actions. A user claim is not silently upgraded into an observation.

## Codex and Ruflo workflow

Ruflo is the ledger/coordinator/policy decision point. Codex workers execute.

1. Search AgentDB patterns.
2. Initialize one bounded hierarchical swarm.
3. Split only independent work.
4. Assign one git worktree and declared reduced envelope to each writer.
5. Run workers under hard concurrency/output/time budgets.
6. Consume committed handoffs in dependency order.
7. Run scoped tests, full tests, security guards, and MetaHarness.
8. Store the validated pattern and retain decision/evaluation receipts.

Read-only workers may share a checkout. Writers may not. A designated integration agent owns shared manifests and lockfiles. Dependency cycles, missing dependencies, shared writer paths, non-zero worker exits, and dependency failures are errors rather than implicit success.

`[swarm.automation]` defaults:

```toml
enabled = false
max_concurrent = 4
max_writers = 2
worktree_isolation = true
dependency_failure = "cancel"
agent_timeout_seconds = 1800
max_output_bytes = 1048576
```

Worktree cleanup removes only registry-owned, clean worktrees. Dirty worktrees remain for recovery. No force removal or broad path deletion is permitted.

The worker preflight, sanitized environment, declared envelope, and Codex
sandbox are workflow controls, not an operating-system security boundary. A
locally compromised child process can invoke tools outside Ruflo unless the
host also applies container/VM, filesystem, network, and provider controls.
For Ruflo MCP calls made from a linked worktree, the authoritative policy root
is derived from Git's canonical common directory, so the worker cannot
accidentally initialize an independent legacy policy state.

## Concurrent MetaHarness development

MetaHarness/Darwin proposes; Ruflo policy and ADR-322 dispose.

- Candidate/task evaluation uses a bounded worker pool.
- Result aggregation is deterministic in input/candidate-id order, independent of completion order.
- Timeout cancellation covers queued and cooperative running work.
- The run receives a local concurrency ceiling and evaluation wall-time budget.
- Proposers and evaluators receive no `promote` or `materialize` capability.
- `metaharness.flywheel.run` and `metaharness.candidate.promote` are distinct policy actions.
- Promotion still requires ADR-322A confirmation, trusted signature, fresh baseline, fresh ledger head, and atomic compare-and-swap.
- A policy denial happens before proposer, search, filesystem, or promotion side effects.

Legacy v1 Flywheel receipts remain verifiable byte-for-byte. ADR-324 receipts are additional authorization evidence; they do not rewrite the Flywheel ledger.

## Security model

The design addresses:

1. malicious candidate policy;
2. compromised child/proposer process;
3. stale or replayed approval;
4. concurrent budget/promotion races;
5. tampered decision ledger;
6. namespace poisoning;
7. resource-exhaustion through fanout;
8. accidental destructive upgrades of prior AgentDB installations.

It does not claim that a local HMAC protects against compromise of the host or signing key. Remote trust requires the established Ed25519 attestation paths.

## Consequences

Positive:

- One auditable authorization result across CLI, MCP, Codex, AgentDB evidence, and MetaHarness.
- Existing installations continue to work and can rehearse policy in observation mode.
- Concurrent development has executable worktree and resource boundaries.
- Optimizers can improve policy/configuration without becoming promotion authorities.

Costs:

- Every consequential action adds a small locked state transaction.
- Administrators must define rules before enabling enforcement.
- Legacy permissive behavior remains until a deliberate mode transition.

## Implementation

The normative implementation is split across existing package boundaries:

| Concern | Implementation |
|---|---|
| Rules, envelopes, approvals, budgets, canonical receipts | `@claude-flow/security/src/policy` |
| Cross-process transaction, migration, CLI/MCP adapter | `@claude-flow/cli/src/services/policy-runtime.ts` |
| Administrator CLI | `ruflo policy status/init/evaluate/rule/budget/revoke/audit/verify`; approval issuance requires an authenticated adapter |
| Policy MCP tools | Remote default: `policy_evaluate`, `policy_status`; administrative handlers exist for authenticated deployments but are not registered by default |
| CLI MCP enforcement | `@claude-flow/cli/src/mcp-client.ts` |
| Standalone MCP enforcement contract | `ToolRegistry.setAuthorizer` / `MCPServer.setToolAuthorizer` |
| Bounded MetaHarness evaluation | `bounded-worker-pool.ts`, `harness-flywheel.ts`, `harness-flywheel-runtime.ts` |
| Codex automation | bounded dual-mode orchestrator plus the worktree coordinator |
| Upgrade behavior | additive Codex settings migration and CLI policy-state auto-migration |

The policy state lives at `.claude-flow/policy/state.json`. Mutations acquire
`.claude-flow/policy/state.lock` using exclusive creation and replace state by
atomic rename. Decision, approval consumption, budget usage, and receipt append
therefore commit as one transaction. A stale lock may be recovered after 30
seconds; lock acquisition otherwise fails after five seconds.

When enforcement is first enabled, an HMAC key and state authentication record
are stored outside the workspace under
`~/.config/ruflo/policy-trust/<project-hash>/`, where the project hash uses
the canonical real path and cannot be redirected by a worker environment
variable. Subsequent state loads authenticate the complete state. On first
enforcement the anchor is written before enforce state, so any crash leaves
either a valid pair or a fail-closed mismatch. A later crash
between state and anchor replacement may fail closed and require administrator
recovery; it cannot produce a silent downgrade.

Generated and migrated Codex configurations install the dedicated
`claude-flow-mcp` binary, preserve unrelated MCP servers, set policy mode to
`legacy`, and leave swarm automation disabled. Windows uses `cmd /c`; POSIX
uses `npx` directly. Existing `AGENTS.md` content is not replaced by runtime
migration.

Policy administration is not exempt from authorization. Bootstrap and recovery
mutations use the interactive local `ruflo policy` command. Remote MCP registers
only evaluation and status by default; administrative handlers require a
deployment-specific authenticated human identity adapter. Approval issuance
also requires the issuer allowlist. A standalone MCP server can set
`requireToolAuthorization = true`, in which case construction fails unless an
authorizer is supplied.

### Validation evidence

Validated on 2026-07-28:

- Security: 22 files, 537 tests.
- Codex generation, migration, dual-mode, and worktrees: 7 files, 211 tests.
- Standalone MCP registry/server: 2 files, 69 tests.
- Policy runtime, concurrent budget accounting, bounded worker pool,
  MetaHarness ADR-322 paths, and ADR-323 compatibility: 5 files, 46 tests.
- TypeScript: security, Codex, MCP, and the changed CLI surface compile cleanly.
- `git diff --check`: clean.

The policy microbenchmark records:

```text
pure evaluation:       1,590,091 decisions/second (0.629 µs/decision)
transaction receipt:      43,251 decisions/second (23.121 µs/decision)
receipt ledger:         valid
```

These figures are local microbenchmarks, not a production latency guarantee.
The receipt number excludes filesystem lock contention and disk latency.

## Acceptance tests

1. Legacy install migration preserves existing memory and defaults to `legacy`.
2. Observe mode records deny while allowing the action.
3. Enforce mode default-denies unmatched actions.
4. Deny overrides allow and approval.
5. A child cannot expand any envelope dimension.
6. Self-approval, expired approval, replay beyond `maxUses`, and revoked approval fail.
7. Concurrent budget decisions cannot overspend a ceiling.
8. Altering one receipt byte breaks ledger verification.
9. Native and fallback AgentDB paths preserve provenance and prior capabilities.
10. CLI and MCP policy decisions occur before side effects.
11. Two concurrent writers cannot share a worktree.
12. Missing dependencies and cycles fail before workers launch.
13. Worker fanout never exceeds configured concurrency and output bounds.
14. Dirty registry-owned worktrees survive cleanup.
15. MetaHarness peak concurrency never exceeds its envelope.
16. Timeout cancels queued MetaHarness work.
17. MetaHarness cannot promote without a separate policy allow/approval and ADR-322A authorization.
18. Removing or lowering generated configuration cannot downgrade an enforced
    policy; removing or modifying anchored state fails closed.
19. A budgeted or constrained request with missing metering is denied.
20. Worker environments strip common secret variables and policy authority
    variables before launch.
