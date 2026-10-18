# From a proposal to reviewable candidate work

The proposal queue can now hand one finding to an explicit executor in a detached worktree. The tool does not generate code, install packages, create a PR, push, merge or publish. It records a candidate patch and evidence for a human or separately authorized executor to put into a reviewable PR.

## Prepare

Start from a clean checkout of the intended baseline. Inspect repository instructions and the current proposal rather than treating its text as a command. Use an existing destination directory outside the baseline repository and Git metadata.

```bash
node scripts/ecosystem-candidate.mjs list --repo /path/to/clean-baseline
node scripts/ecosystem-candidate.mjs prepare \
  --repo /path/to/clean-baseline \
  --expected-head EXACT_BASE_COMMIT \
  --proposal PROPOSAL_SHA256 \
  --allow docs/ecosystem/slim-opt-in-validation.md \
  --destination-root /path/to/candidate-work
```

The result identifies the bundle, detached worktree and lease expiry. Only the assigned executor edits the allowed files. The maximum is 20 exact paths and 1 MiB of changed regular-file content; no globs. Scripts, CI, AGENTS.md, Git control files and evaluator inputs are protected. A candidate needing changes to these controls requires a separately reviewed tooling PR, not a weakened candidate allowlist. Submodules are unsupported.

## Evaluate and hand off

Use the pinned installed packages from the [capability setup](capability-web.md). Required integration flags prevent missing dependencies from becoming skipped successes.

```bash
RUFLO_MEMORY_REQUIRED=1 \
RUFLO_MEMORY_RESOLVE_FROM=/tmp/ruflo-memory-proof/package.json \
RUFLO_RUVECTOR_REQUIRED=1 \
RUFLO_RUVECTOR_RESOLVE_FROM=/tmp/ruflo-ruvector-proof/package.json \
node scripts/ecosystem-candidate.mjs evaluate \
  --repo /path/to/clean-baseline \
  --bundle /path/to/candidate-work/ecosystem-candidate-IDENTIFIER \
  --max-duration-ms 180000
```

Evaluation freezes the actual file contents into an exact Git tree, executes baseline and candidate checks, checks source identity again, and proves the reverse patch reconstructs the baseline tree in a separate index. It writes `candidate.patch`, `review.json` and `PR.md` exclusively. The candidate worktree and baseline index are not rewritten. A completed bundle has one evaluation receipt; prepare a new attempt instead of overwriting evidence.

`checks-passed-review-required` does not establish an improvement: unchanged passes are not gains, and incomplete package coverage remains visible. Correctness work needs a reproducer; optimization needs at least 10 percent measured improvement and zero applicable regressions. Independent review and existing promotion/signing gates still apply. Manually publish only after checking the expected remote SHA and scope. Preserve both fixed and last accepted baselines. Rollback here covers source, not runtime state or external effects.

## Ownership, budgets and recovery

The base/proposal lease is created atomically and expires after 45 minutes. A lifecycle guard serializes prepare/evaluate/release, and the evaluator marks active execution. Expired leases are not stolen automatically. Check execution has a 100–300,000 ms budget; filesystem hashing, planning and Git operations add overhead (each Git command has a 20 second timeout). The outer executor must enforce its own total run budget.

```bash
node scripts/ecosystem-candidate.mjs release \
  --repo /path/to/clean-baseline \
  --bundle /path/to/candidate-work/ecosystem-candidate-IDENTIFIER
```

Release validates ownership and inactivity even if source moved or evaluation failed. It preserves the worktree and bundle. After a process crash, inspect the lease's owner, expiry, bundle and actual execution liveness before manually removing only that stale `.guard` or `.evaluating` marker. Never recursively clear the lease directory or remove another live owner's record. Resume with a new bounded attempt after inspecting unknown effects.

This is a trusted local execution boundary, not hostile-code isolation. Tests retain OS filesystem and network permissions. Only PATH, platform/temp/locale settings and explicit Ruflo integration resolution flags are forwarded; this does not prevent filesystem access to credentials. Use a separately isolated credential-free executor for untrusted code.

## Regression evidence

Run `node --test scripts/tests/ecosystem-candidate.test.mjs`. The 17 tests include a real failing baseline and passing candidate, exact rollback, live/expired/replaced leases, stale and forged state, source movement, forbidden paths, symlinks, ignored inputs, skipped/failed/timed-out tests, unrelated environment exclusion, hidden index flags, executable modes, staged additions and exclusive artifact creation. Independent review supplied executable reproductions for the hidden-index and staged-addition failures; both are now rejected.

[Real proposal evidence](../../data/ecosystem-candidate.validation.json) records a documentation correction against `00400e5667576ded953a1fba742c43e5aee82aac`: all eight baseline and candidate checks passed and rollback reconstructed tree `f31dcbfd93cb55d6487d0f599841686428cfc8f9`. This exercises handoff, not a second payload optimization. The fixed download benchmark and last accepted memory/payload result remain unchanged.
