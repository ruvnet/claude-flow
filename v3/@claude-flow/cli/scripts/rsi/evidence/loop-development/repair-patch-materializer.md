# Exposed-template patch materializer result

Decision: accept the engineering increment only. The inherited child now turns its
top p-limit descriptor into a deterministic, content-addressed in-memory patch and
a parent independently verifies the complete artifact. No repository patch or
repair evaluation ran, so this is not experimental learning or RSI evidence.

Source `7f672c6689f33b9f2cf894fb724c4edb87daf1cd` at tree
`c7fb9fa13e6d42f3f63391933b8b05e6aa24fd84` binds materializer plan
`525b8e6f4818d76c314d68fa7c02a4b7f05c41249c7ed463063063ba19e5ea8b`.
The durable reservation is commit `c46eccd63756df2055c5f72c74e2862027ead77b`
and SHA-256 `0044a495b7d08c2c7c8e3434c289411138c82bbca1e6db711214e5527fd131b4`.

Three registered source-bound runs passed 39/39 tests in 165, 164 and 190 ms,
519 ms summed outer wall time. They used three Node test commands with isolation
disabled, three materializer children and three `mkfifo` setup helpers; computed 96
training-only descriptor scores; and completed 15 deterministic patch artifacts.
They consumed zero repair candidate evaluations, isolated process starts, native
field calls, epochs, model calls or provider spend. Outer Codex model cost and total
acquisition, evaluation and engineering dollar costs remain unknown.

The exact candidate reproduces the exposed upstream fix: Git blob
`b74d48ab0e37788e657e5ad12d90e281ef1f39d1`, SHA-256
`63239cd9ae80b1433e05014fe6ec501475c6fa59fad06418cb5972dbc7cc14e2`.
This is deliberately circular calibration: the researcher-authored grammar is
derived from that published fix and read by the child. The known-fix fixture path is
not provided, but filesystem reads were not syscall-audited. Only the inherited arm
has a patch grammar, so no matched-control or fresh-task comparison is claimed.

Read-only review reproduced a rehashed semantic-tampering vulnerability, excessive
fixture-read wording, a FIFO blocking path, and parent trust in child
self-verification. The corrected implementation binds exact base, task, arm, plans,
descriptor, selected tests, removal and candidate identities; opens bounded inputs
nonblocking; narrows the disclosure; and revalidates the child artifact in the
parent. Final review found no remaining high-severity issue.

The mission ledger remains at head
`5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e`,
209784 reserved native calls and seven epochs. Repair resources remain unapproved.
The next executable comparison still requires patch coverage for all four controls,
frozen fresh development tasks, a compatible isolated runner, and explicit approval
for at most 36 evaluations, 216 isolated starts and 1080000 summed process ms.

## Acceptance

```bash
node --test --test-isolation=none v3/@claude-flow/cli/scripts/rsi/repair/patch-materializer.test.mjs
```

Expected: thirteen passes. Candidate execution, fresh-task evidence, matched-control
coverage, improvement-capacity measurement and RSI acceptance remain false.
