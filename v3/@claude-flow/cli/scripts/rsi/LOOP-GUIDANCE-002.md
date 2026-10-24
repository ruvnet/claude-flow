# Fail-closed focused-test registration

LOOP-GUIDANCE-002 converts a retained procedural failure into an executable loop
guard. EXECUTOR-011's first complete-checkout workflow was green but its explicit
command list omitted the newly added bounded-file suite. Manual log inspection
caught the gap; this audit makes the same omission block CI automatically.

The audit enumerates every regular repair/*.test.mjs file and parses only direct
executable node --test workflow lines. Every repository test must appear exactly
once. Missing and duplicate references fail closed. Comments, descriptions and
other non-executable YAML text do not count. One command may explicitly name
multiple tests. The audit itself is registered before the remaining repair tests.

Red/green validation first retained an authoring syntax failure. Corrected source
then failed 4/5 because ci-coverage.test.mjs was absent from the workflow. After
registration it passed 5/5, including synthetic missing, duplicate and commented
reference cases. Raw outcomes and costs are preserved in
evidence/loop-development/repair-ci-coverage.json and its raw companion.

This improves validation integrity only. It does not make the repair agent more
productive, validate OS isolation, authorize candidate trials or support an RSI
claim. Complete-checkout focused CI and the seven original-source historical
replays remain required.

Acceptance:

    node --test v3/@claude-flow/cli/scripts/rsi/repair/ci-coverage.test.mjs

Expected five passes. The hourly cadence remains because useful bounded work is
available. Roll back if the audit cannot deterministically map real repair tests
to executable workflow references; never bypass it merely to obtain green CI.

