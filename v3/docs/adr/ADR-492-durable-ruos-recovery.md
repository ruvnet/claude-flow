# ADR-492: Durable ruOS attachment and console reconciliation

Status: Proposed in implementation PR
Date: 2026-10-17

## Problem and existing boundaries

Orca's remote session model separates client connectivity from agent lifetime. Reviewing that concept against Ruflo found concrete recovery gaps in the existing ruOS adapter: server job IDs were held in memory, attachment reused the client ID, output replay started at zero, transport errors finalized jobs as failed, and attachment timeout could cancel work.

Ruflo already has mission records, worktree/session views, an attention queue and a detached ruOS runner. This change extends those boundaries. It does not create a second mission scheduler or enable ADR-406 M2 admission without policy and budget authority. No Orca code or dependency is included. Concept source: https://www.onorca.dev/docs/ssh and https://github.com/stablyai/orca.

## Contract and invariants

1. Persist a run intent before launch. Reserve a run ID once. An ambiguous launch is held for reconciliation, never automatically repeated.
2. Persist the resolved desktop, transport kind and actual server job ID before polling. Attachment pins all three and never invokes launch or cancel.
3. Commit output and its cursor under a run lock. Replayed attachment cannot duplicate local bytes. Recover an interrupted log write to its committed boundary.
4. Keep lifecycle state distinct from connectivity. A transport failure retains the claim and agent placement because remote work may continue.
5. A stop decision names the persisted revision and binding digest. Recheck atomically before cancellation. Unacknowledged cancellation remains unresolved.
6. Console observations never grant authority. Mission cancel uses the observed revision and must receive authoritative acceptance before cancelling tasks. A changed plan invalidates dispatch approval, including changes while awaiting task update.

The run binding can associate a mission, source worktree, commit and source digest. It is provenance supplied by the caller, not an attestation of remote execution or a credential boundary. Executing on another host still requires its authenticated adapter.

## Storage and UI

Records live beside existing plugin output in `.claude-flow/ruos/runs/<id>.json`. A versioned, bounded `.claude-flow/ruos/observation.json` exposes identity, revision, state, connection, times, binding and byte cursor. No prompt, output text or token enters the observation. Local records remain under the OS user's trust boundary; this is not a tenant authorization service.

The console adds Remote runs to Missions and the Room. Existing Needs you ordering includes reconciliation. Future, unknown or stale timestamps do not become fresh when redrawn. An attach action prepares a visible draft with the observed identity; the standalone TUI remains read only. The existing mod attention mirror carries the reconciliation count without issuing network requests.

## Failure paths and migration

Unknown launch receipts, unavailable hosts, stale approvals and backend mismatches fail closed. Old manual session runs without records require manual reconciliation; no identity is inferred from a run directory or PID. Downgrading while jobs are active forfeits the new attachment safety contract, so finish or reconcile first and preserve the state directory. No package or plugin version bump is needed for PR validation; release remains a separate decision.

## Acceptance trace

| Requirement | Executable evidence |
| --- | --- |
| Durable server ID, cursor and process reuse | `node plugins/ruflo-ruos/scripts/e2e-recovery.mjs --disconnect-seconds 60` |
| Persistence, corruption, concurrency and failure paths | `node --test plugins/ruflo-ruos/tests/*.test.mjs` |
| Console parsing, freshness, attention and prepared attach | `vitest run plugins/ruflo-console/tests/remote-runs.spec.ts` |
| Revision and plan bound control | `vitest run plugins/ruflo-console/tests/mission-cancel-revision.spec.ts` |
| Existing console and mod behavior | Focused regression suites plus native plugin validation where supported |

The E2E uses real detached deterministic processes in two actual Git worktrees with a local transport fixture. It tests lifecycle behavior, not model quality, hosted API availability or a physical phone. No claimed latency or task accuracy gain is inferred from contract tests. The added storage cost is one bounded metadata checkpoint per poll; retain durable writes before optimizing throughput.
