# FRESH-PROMPT-001 — immutable public task input

## Decision

Accept a bounded proposer-visible task-input capsule for the first frozen fresh
development task. The prior source-only stage could construct a clean workspace,
but a child still lacked a mechanically supplied task statement and would have
needed researcher follow-up. This increment supplies the exact public issue title
and body without exposing the parent evaluator. It does not start a proposer,
generate or execute a repair candidate, establish OS isolation, or provide
bounded-RSI evidence.

Reviewed implementation source is
`61054ce3457ef07a0c0fc6b16c53387a36944658`, tree
`84c0b7cc8c5efc5b8f50bc360e80daeebdd1d0d7`. GitHub readback matched the prompt
validator and task-freeze blobs. At 2026-09-14T01:46Z public issue 291 remained
open with zero comments. No later fix, patch, solution, candidate output or task
outcome was acquired.

## Measured boundary

The exact 2448 public issue bytes are frozen at SHA-256
`91495813669034503c7db9bf723b0b7c2ef30b8561e5f3880f4560609d0ee7dc`.
The validator binds the task and repository identities, issue URL and number,
title/body bounds, state, zero-comment observation, ordered timestamps, source
base revision and pre-proposal provenance. Unknown fields, changed bytes, closed
or commented observations, fix/outcome claims and attempts to enable execution
or RSI fail closed.

The source-only stage validates this capsule in the parent and copies only its
public title, body, URL, schema and digest into the proposer receipt. The capsule
file itself is not added to the read-only source workspace. Evaluator and test-
plan identities remain absent from the proposer receipt and workspace. The public
issue contains a reproduction and suggested scope, so this remains development
input and cannot be represented as sealed, unseen or independent evidence.

## Accounting and retained limits

Two local test commands ran 60 cases through seven test-file workers; all passed,
with 325.497920 ms summed reported Node duration. Fourteen completed stage-test
setups wrote 4,155,368 temporary source bytes; prompt validation itself wrote no
task data. The focused combined boundary run passed 44/44 and the executable
acceptance run passed 16/16.

There were zero repair candidates, proposer/evaluator starts, isolated namespace
starts, repair process milliseconds, native/model calls, epochs or π requests.
External provider spend is $0. CI processes, outer Codex acquisition/model use
and total acquisition/evaluation/engineering dollars remain unknown. Mission
ancestry, 209784 reserved native calls and seven epochs are unchanged. The repair
resource proposal remains unapproved.

## Loop self-edit

Prior guidance constructed a source-only proposer surface but did not require the
task statement to be frozen, bounded and delivered without researcher follow-up.
The new guidance requires an exact public task-input capsule selected before any
proposal, validated by the parent and copied into the proposer receipt while the
evaluator stays parent-only. Expected child autonomy and contamination reduction
remain unmeasured for descendant productivity.

Roll back the task if the prompt bytes or public issue identity drift, the task
exposes a solution before proposal, parent-only data enters the proposer surface,
or compatible sandbox separation cannot be enforced. Cadence remains hourly
because further bounded launch integration is ready and no writer contention was
observed. No schedule, permission, budget, trust, alpha or proof gate changed.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/fresh-task-prompt.test.mjs v3/@claude-flow/cli/scripts/rsi/repair/fresh-task-stage.test.mjs
```

Expected: sixteen passes; the exact public task is in the proposer receipt,
evaluator identities remain absent, and candidate execution and RSI acceptance
remain false. The largest uncertainty is whether inherited training-only failure
analysis improves descendant successor productivity on genuinely fresh tasks at
equal total cost.
