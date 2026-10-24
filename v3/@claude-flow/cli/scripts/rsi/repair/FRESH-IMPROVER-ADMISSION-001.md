# FRESH-IMPROVER-ADMISSION-001: task-binding gate

Status: retained useful negative; candidate execution disabled.  
Source commit: `46c331367dd19f713f392e4b086f99fc540345b5`  
Source tree: `9b9e770ee0e173197cf90157882e5c3d2bfad584`  
Date: 2026-09-14 UTC

## Execution blocker resolved

The frozen fresh task was ready for a future child, but it had not been proved
that the existing inherited improver could produce any proposal for it. Running a
five-arm comparison without that check could silently turn p-limit-specific
training templates into placeholder candidates for another repository.

The executable admission check binds three already reviewed artifacts:

- fresh freeze `1ed08cdbc62d67392529b6bc8d02ae3e3a8f5f07e1432ca842382c36167830e3`;
- inherited plan `d9ff24763a9398763e79bde5741b8e5ec092b5da642f28c827bdd78008b002a0`;
- control materializer `a7a8df26ef90d815824234e064ea611fc926502f0eb904af81aade258df9287e`.

The materializer is exactly bound to `sindresorhus/p-limit` at
`df476048d023ff868cd45b35ee47f5fb0ca2b25a`, path `index.js`, and is explicitly
`TRAINING_ONLY_CALIBRATION` with the published fix and upstream tests known. The
fresh task is `conorbronsdon/avoid-ai-writing` issue 291 at
`fabd62d9c8785dd0edda35201359bcc635b7d3de`, cluster
`js-regex-line-boundary`. These bindings do not match.

## Measured result

`inherited`, `frozen`, `static`, `shuffled`, and `previous` each admitted zero
proposal families with blocker
`TRAINING_ONLY_MATERIALIZER_TASK_BINDING_MISMATCH`. No descriptor or patch bytes
were produced. No fresh outcome was read and no empirical hypothesis was admitted.

Local validation ran 37 test cases in two `node --test` commands. Four test-file
workers and three bounded CLI helper processes were started. Reported test-suite
duration summed to 333.310896 ms. One additional read-only inspection command
emitted the retained result. Repair accounting stayed at zero candidate
evaluations, proposer/evaluator starts, isolated process starts, repair process
wall milliseconds, new native calls, model calls, epochs, provider spend and pi
requests. Outer Codex/GitHub acquisition and engineering dollar costs are unknown,
which blocks confirmation.

This is a structural negative, not a candidate outcome or evidence of improvement
capacity. The mission ledger remains at 209784 native calls, seven epochs and head
`5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e`.

## Guidance change

Prior guidance allowed the inherited/control materializer to be prepared before a
fresh comparison but did not require executable task-binding admission. Proposed
guidance requires every arm to pass this exact gate before descriptor generation;
placeholder candidates and relabeled training templates are prohibited. Expected
benefit is unmeasured: it should prevent meaningless equal-cost trials and direct
the next increment toward a task-general proposer. Cost scope is one bounded,
read-only preflight per frozen task. Roll back the implementation only if an
independent review finds the exact binding test unsound; retain this negative and
replace the gate with a stricter source-bound check.

The next executable acceptance condition is a reviewed task-general proposer, or
an independently frozen compatible training lineage, for which all five arms pass
this gate without accessing evaluator identities or fresh outcomes. That does not
authorize the unapproved repair envelope or establish RSI.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/fresh-improver-admission.test.mjs
```

Expected: nine passes, zero admitted proposal families for the current fresh task,
zero candidate bytes, and execution/RSI gates closed.

GitHub Actions run 34801502726 passed 301 focused research-loop tests plus 18
experiment/proof tests (319 total). It replayed all seven epochs from their
original source identities, retained 209784 lifetime native calls, and reported
`boundedRsiEvidenceAccepted: false`.
