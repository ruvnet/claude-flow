# FRESH-FREEZE-002 — first source-bound fresh development task

## Decision

Accept one development task into the frozen fresh partition. This removes the
zero-task blocker but is not a repair result, improving descendant, independent
evaluation or bounded-RSI evidence. Candidate execution remains disabled.

## Pre-outcome selection and source

At 2026-09-13T21:25:30Z the fixed query
`is:issue is:open label:bug comments:0 created:>=2026-09-10 language:JavaScript`
selected [avoid-ai-writing issue 291](https://github.com/conorbronsdon/avoid-ai-writing/issues/291).
Readback showed the issue open with zero comments and identified the unchanged
base commit `fabd62d9c8785dd0edda35201359bcc635b7d3de`, committed at
2026-09-13T18:46:59Z. No fix commit, pull request, patch, candidate result or
solution bytes were sought or acquired. The public issue statement itself is
task input and already describes the failing behavior and suggested scope.

The MIT-licensed, dependency-free repository was fetched at that exact commit.
Its Git tree is `6381e6efd018f6994fa35d6a28d8664f48a0db4b`. A deterministic
`git archive`/gzip capsule contains the complete four-file runnable task-source
closure (five tar entries including `detector/`): 88498 bytes, SHA-256
`8695115e601005956e6442a58161724b2be6e5d169dbd2c108e64c41d4ba63d3`.
This source is a public development task, not sealed confirmation data.

## Parent-only evaluator

Before any proposal, the parent authored four issue-derived checks: three
must-not-fire LF/CRLF cross-line cases and one same-line positive control. The
1575-byte evaluator SHA-256 is
`3ae79a9217ece75129679e6de77df525fa2797b695d874daa960a5cc9769c19f`;
the 734-byte plan SHA-256 is
`4bed59910a502f036f67ccd68809c6107875f25de741fabb441c0a7be62a2a71`.
It is reviewer-visible but must not be provided to or mounted for the proposer;
only the parent evaluation phase may use it. Network remains unavailable to the
eventual proposer.

The base reproduces the issue: 1/4 checks pass and all three cross-line cases
fail. This is baseline task calibration, not a candidate evaluation. No patch was
generated, selected or executed. The admission and capsule verifier keep repair,
isolation and RSI gates false.

## Accounting and proof boundary

The runnable source archive plus evaluator and plan total 90807 preserved
bytes. One source clone/fetch and one baseline evaluator subprocess completed;
network transfer bytes, GitHub/API time, CI processes, outer Codex model cost,
and total acquisition/evaluation/engineering dollars are unknown. External
provider spend initiated by the mission is $0. There were zero repair candidate
evaluations, isolated namespace starts, native field calls, model calls or new
epochs. Mission ancestry, 209784 reserved native calls and seven epochs remain
unchanged. The separate repair envelope is still unapproved.

## Loop self-edit

Prior guidance required a reviewed source archive and parent-only evaluator but
did not require validation of their actual bytes. Proposed guidance requires the
capsule verifier to hash the source, evaluator and plan, inspect bounded safe tar
paths, require the complete minimal source set, and keep evaluator/proposer
separation explicit. The expected benefit—preventing metadata-only or substituted
fresh-task freezes—is measured only for tamper rejection, not descendant
productivity. Roll back the task to zero admitted entries if the issue closes,
a solution is exposed before proposal, any capsule binding fails, or runtime
separation cannot be enforced. Hourly cadence remains appropriate while bounded
local work is ready.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/fresh-task-admission.test.mjs v3/@claude-flow/cli/scripts/rsi/repair/fresh-task-capsule.test.mjs
```

Expected: twenty passes, one admitted task, five archive entries, four evaluator
cases, and candidate/RSI gates false. The largest uncertainty remains whether
inherited training-only failure analysis improves descendant successor
productivity on genuinely fresh tasks at equal total cost.
