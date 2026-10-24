# FRESH-STAGE-001 — source-only proposer staging

## Decision

Accept a source-only staging boundary for the first frozen fresh development
task. The earlier freeze declared a parent-only evaluator; this increment
constructs and tests the distinct proposer surface. It does not start a proposer,
execute a candidate, establish OS isolation or provide bounded-RSI evidence.

Reviewed implementation source is
`8ca25fa38999556f698d75bedd7409a403fb39d2`, tree
`f0177145c30355f9d7527bee8172c7edbf546440`. GitHub readback matched the
new stage, capsule verifier and workflow blobs. At 2026-09-13T23:52Z the public
task remained open with zero comments; no fix, patch, solution or outcome was
acquired.

## Measured boundary

The parent first validates the immutable manifest, source archive, evaluator and
test plan. It then creates a new destination and extracts only four source files
with fixed read-only modes. Tar header checksums, the PAX commit identity, bounded
sizes, entry types, unique paths and path ancestry are checked. Archive-supplied
permissions are ignored. Existing destinations fail before mutation.

The returned proposer receipt binds the task, source commit/tree, freeze,
archive and each staged file's raw SHA-256, byte count and path. It contains no
evaluator or test-plan paths or hashes. A separate parent object binds those
identities and explicitly denies proposer access. Tests inspect both the receipt
and workspace inventory.

This is a language-level construction boundary, not an adversarial runtime
boundary. A child given other host filesystem access could still seek the public
evaluator. The proposer object must be the only task object passed to a future
child, the source tree must be mounted read-only, and the parent-only artifacts
must be absent from its sandbox mounts. Those properties still require the
compatible exclusive-UID isolation host.

## Accounting and retained negatives

Five local test commands ran 90 cases through eleven test-file workers: 83 passed
and seven failed across retained red/green runs, with 730.291654 ms summed
reported Node duration. The first staging run was 2/8 because test cleanup could
not remove intentionally read-only directories; the corrected cleanup made the
same suite 8/8. The CI coverage audit failed 4/5 before registration and the
combined final run passed 36/36. Twenty-four completed test stages each wrote
296812 source bytes (7123488 temporary bytes total); no evaluator bytes were
staged.

There were zero repair candidates, proposer/evaluator starts, isolated namespace
starts, repair process milliseconds, native/model calls, epochs or π requests.
External provider spend is $0. CI processes, outer Codex acquisition/model use
and total acquisition/evaluation/engineering dollars remain unknown. Mission
ancestry, 209784 reserved native calls and seven epochs are unchanged. The repair
resource proposal remains unapproved.

## Loop self-edit

Prior guidance said to withhold the evaluator from proposer input and mounts but
did not define a constructed child surface. The new guidance requires parent
validation followed by a new source-only workspace and a separately serializable
proposer receipt; evaluator identities stay in a distinct parent binding.
Expected contamination reduction remains unmeasured for descendant productivity.
Roll back the staged task if parent-only bytes or identities enter its proposer
receipt/workspace, if content validation fails, if the public task exposes a
solution before proposal, or if child/mount separation cannot be enforced.

Cadence remains hourly because useful bounded integration work is ready and this
increment observed no writer contention. No schedule, permission, budget, trust,
alpha or proof gate changed.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/fresh-task-stage.test.mjs
```

Expected: eight passes; exactly four staged source files; evaluator identities
absent from proposer receipt/workspace; candidate execution and RSI acceptance
false. The largest uncertainty remains whether inherited training-only failure
analysis improves descendant successor productivity on genuinely fresh tasks at
equal total cost.
