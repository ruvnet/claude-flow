# Fresh development task admission boundary

Implementation parent: `af6996302c414529f88d9dbfaae0a4d66479df7b`.

## Decision

Accept a fail-closed, metadata-only partition validator as engineering progress.
Do not admit an empirical hypothesis or any real fresh task yet. Candidate
execution, repair resources, confirmation and bounded-RSI acceptance remain
disabled.

The previous admission path represented only exposed public one-commit fixes.
It could not represent a future fresh development sample without relying on
convention to exclude known fixes, outcomes and training traces. The new
`repair/fresh-task-admission.mjs` establishes a distinct schema and binds the
complete current exclusion set from `repair/corpus.json` and
`repair/public-workloads.json` by their Git blob identities.

## Enforced boundary

- All six existing exposed/calibration task IDs and eleven distinct base/fix
  revisions are mandatory exclusions.
- Exact task schemas have no fix, diff, patch, outcome, score or failure-trace
  fields. Unknown fields reject rather than being ignored.
- A source is only metadata-admissible when its archive and base commit/tree are
  content addressed and do not match an excluded revision.
- Evaluator capsules must be hashed, authored before proposal and marked
  `PARENT_ONLY_UNREAD_BY_PROPOSER`.
- Provenance must bind a public pre-outcome selection query and state that no fix
  data or outcome was acquired.
- The original ledger anchor, head, 209784 native calls and seven epochs cannot
  reset. Trial resources remain zero and unknown dollar totals remain null.
- `executeFreshTask()` always rejects. A metadata freeze is not a runnable task,
  isolation receipt, resource approval or evaluator authorization.

The checked freeze contains zero real tasks. One synthetic task appears only in
unit tests to exercise the future happy path. No fresh-task repository, issue,
solution, fix or outcome was selected or read in this increment. This avoids
contaminating a future comparison merely to populate a manifest.

## Self-improvement assessment

Prior guidance required samples to be frozen before comparison but had no
executable separation between exposed and fresh task records. Proposed guidance
requires this validator before any task can be labelled fresh. The expected
benefit is reduced contamination and relabelling risk; that benefit remains
unmeasured until a real pre-outcome sample is independently reviewed. Roll back
the admission of any task—not the retained negative evidence—if its source,
selection query, evaluator boundary or lack of fix/outcome exposure cannot be
verified without inspecting solution bytes.

Hourly cadence remains appropriate because bounded local work remains available
and no writer contention was observed. Optional pi retrieval remains
`BLOCKED_AUTH` and was skipped. This procedural change does not expand authority.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/fresh-task-admission.test.mjs
```

Expected: fourteen passes, zero admitted real tasks, partition enforcement true,
and candidate/RSI gates false.
