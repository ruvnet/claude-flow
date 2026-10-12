# October 12 issue fixes and verification

Worktree: `<repo>`
Branch: `fix/oct12-verified-issues`
Final base: `3209ba266750908ea88fb0bc69672e106478bbef` (parent fast-forwarded main during review). This section describes the state when the repair was first validated, before it was committed. No merge, publication, credential changes, or Anthropic execution was performed by this worker.

## Issue mapping

| Issue | Change | Verification |
|---|---|---|
| #4082 | Extracted the CLI disk reader into `coverage-reader.ts`; corrected summary percentage precedence and explicit empty-file coverage. Valid supplied percentages, including zero, are preserved. Istanbul `Unknown` becomes 100 only with explicit valid empty counts. Missing, partial, or invalid counts remain conservative 0 when no authoritative aggregate is available. | Disk-reader cases plus actual coverage hook actions. |
| #4083 | LCOV aggregates original hit/found counts for lines, branches, and functions; statement coverage retains its existing line proxy. Includes final records without a terminator. | Unequal-size files produce 11/101 coverage, not the old 55% average. |
| #4084 | Added Istanbul `coverage-final.json` discovery at coverage/root locations and raw NYC counter parsing. Lines combine statement hits by start line; branch arms and functions use their own counters. Preserved legacy NYC summaries and existing summary/LCOV precedence. Empty reports do not hide usable fallback data. | Disk fixtures and all three coverage hooks; no MCP fallback on valid disk data. |
| #4085 | Fixed `plugins/ruflo-testgen/skills/tdd-workflow/SKILL.md`, replacing unconditional success with observed final target and regression outcomes. Records commands, exit codes, failing test names, and interruption/abandonment reasons. | Executed the documented outcome example against seven cases. MCP `testgen-tools.ts` is unchanged. |
| #4086 | SPARC status uses paginated `memory_list`, exact `memory_retrieve`, and current-state keys; distinguishes gate history from current state and reports incomplete reads. Active status excludes explicit complete records and sorts newest state updatedAt with listing metadata updatedAt/storedAt fallback; legacy phase 5 alone remains active. Initialization sets active status and ISO timestamps; phase/gate state writes refresh updatedAt. Advance refuses completed records. After final gate success, advance and refine preserve state at the exact current-phase key, retain phase 5, and set complete/completedAt/updatedAt; failure never completes. Repeated completed refinement does not rewrite timestamps. | Seven prompt-contract checks pass, including four new lifecycle regressions (3 passed / 4 failed before the lifecycle fix). Checks cover listing, pagination, exact keys, absence of semantic state search, lifecycle timestamps, active ordering/filtering, final-gate completion and failure guards. These are instruction checks, not a live model/MCP session. |
| #4087 | Qualified phase agents, including exactly `ruflo-goals:goal-planner` and `ruflo-swarm:architect`; added missing-plugin preflight without silent substitutions or expanded permissions. | Checks assert the exact six phase-agent references and resolve each shipped agent file/frontmatter. |
| #4088 | Qualified SPARC command and skill invocations throughout command text, skill instructions, README, and examples, including init's specification suggestion. | Recursive command/skill Markdown scan rejects unqualified aliases and resolves qualified references to shipped files. The separately registered `/sparc-mod` stays unchanged. |

Both plugin smoke scripts now run their prompt regression contracts. No dependency, lockfile, SONA, mission, or MCP testgen runtime changes were in the first validated state; the review addendum below adds plugin version bumps.

## Reproduction and results

Receipts are in [oct12-receipts](oct12-receipts/).

| Check | Before | Final candidate |
|---|---|---|
| Original coverage regressions | 0 passed / 5 failed (`coverage-before.txt`) | Expanded public disk-reader suite: 12 passed / 0 failed (`coverage-after.txt`) |
| Coverage CLI integration plus existing router suite | 39 passed / 3 failed (`coverage-integration-baseline.txt`) | 42 passed / 0 failed (`coverage-integration.txt`) |
| TDD skill outcomes | 1 passed / 6 failed (`tdd-workflow-before.txt`) | 7 passed / 0 failed (`tdd-workflow-after.txt`) |
| Original SPARC contracts | 0 passed / 3 failed (`sparc-before.txt`) | Strengthened contracts: 3 passed / 0 failed (`sparc-after.txt`) |
| Final review: unknown coverage counts | 9 passed / 3 failed (`coverage-review-before.txt`) | 12 passed / 0 failed |
| Final review: skill alias in examples | 2 passed / 1 failed (`sparc-review-before.txt`) | 3 passed / 0 failed |
| Final review: SPARC lifecycle | 3 passed / 4 failed (`sparc-lifecycle-before.txt`) | 7 passed / 0 failed (`sparc-lifecycle-after.txt`) |
| SPARC smoke | — | 15 passed / 0 failed |
| Testgen smoke | — | 14 passed / 0 failed |
| Coverage reader strict type-check | — | Exit 0, no diagnostics |
| Witness marker smoke | 18 present, 0 drift, 99 missing/skipped | Same: exit 0; not a full signed-artifact verification |
| `git diff --check` | — | Exit 0 |

Initial reproductions ran on `aac16fbdb3af21c0ddb989aaff4513a9ec1aaca5`. The coverage integration baseline temporarily loaded `git show HEAD:v3/@claude-flow/cli/src/commands/hooks.ts`, then restored candidate bytes in a `finally` block. The original hooks blob is identical on old and final base: `b3ec30cd1049cec5ce7ed25ab6b5b4ee88e7de0a`. Initial parser tests used esbuild to load the original private reader; final tests import the actual extracted TypeScript module and exercise it through filesystem inputs. Initial prompt tests lived under `tests/regression`; final plugin-local paths below are also used by smoke scripts. Counts from different suite revisions are not represented as identical test sets.

Validation commands (all run from the worktree root; each candidate run exited 0). Coverage, TDD, type-check and witness results below predate the final SPARC-only lifecycle edit; they were not rerun because those files did not change:

```bash
node --import <validation-tools>/node_modules/tsx/dist/loader.mjs tests/regression/oct12-coverage.test.cjs
node plugins/ruflo-sparc/tests/contracts.regression.cjs
node plugins/ruflo-testgen/tests/tdd-workflow.regression.cjs
node <validation-tools>/node_modules/vitest/vitest.mjs run --config tests/regression/oct12.vitest.config.mjs
bash plugins/ruflo-sparc/scripts/smoke.sh
bash plugins/ruflo-testgen/scripts/smoke.sh
node scripts/smoke-witness-marker-drift.mjs
node <validation-tools>/node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --typeRoots /usr/lib/node_modules/@claude-flow/cli/node_modules/@types v3/@claude-flow/cli/src/commands/coverage-reader.ts
git diff --check
```

Final #4086 lifecycle follow-up reran only the SPARC tests, plus whitespace validation. Exact commands and receipts:

```bash
node plugins/ruflo-sparc/tests/contracts.regression.cjs > docs/validation/oct12-receipts/sparc-lifecycle-before.txt 2>&1
# Before implementation: exit 1, 3 passed / 4 failed.
node plugins/ruflo-sparc/tests/contracts.regression.cjs > docs/validation/oct12-receipts/sparc-lifecycle-after.txt 2>&1
# After implementation: exit 0, 7 passed / 0 failed.
bash plugins/ruflo-sparc/scripts/smoke.sh > docs/validation/oct12-receipts/sparc-smoke.txt 2>&1
# Exit 0, 15 passed / 0 failed (includes the seven contract tests).
git diff --check
```

The lifecycle changes are prompt contracts, not executable transactional storage. Refine checks existing completion before writing and gates success on evidence; no distributed exactly-once or atomic read/write guarantee is claimed. Explicit phase re-entry reopens the workflow and clears stale completedAt. Reports can still include completed workflows.

Initial red commands, captured before implementing each corresponding fix:

```bash
ESBUILD_MODULE=<path-to-esbuild> node tests/regression/oct12-coverage.test.cjs
node tests/regression/oct12-sparc.test.cjs
node tests/regression/oct12-tdd-workflow.test.cjs
```

These historical paths/harness versions explain the paths in the before receipts; use the final commands for current validation. The final review red checks used the same coverage import command and plugin-local SPARC command shown above. `coverage-compat-before.txt` records the intermediate empty-total sentinel and legacy NYC failures. `sparc-intended-agents-before.txt` records rejection of the earlier substitute agent mapping.

## Separately assessed upstream work

The parent supplied current issue #4085/#4087 bodies, `pr4081.patch`, and `pr4081-checks.txt` under `<repo>-task/`. Local `gh api repos/ruvnet/ruflo/issues/4082` could not reach GitHub. The authorized ruOS desktop shell read was rejected because approval is required and policy is `never`; it was not retried or escalated. External reads and integration were handled by the parent.

**#4080 / PR4081:** inspected the supplied patch. It restores serialized SONA state when `LearningBridge` loads its neural instance, persists synchronously before cleanup, exposes `NeuralLearningSystem.serialize/deserialize`, and includes persistence/restore/degradation regressions. The current patch pins CLI memory exactly to `3.1.0`, rather than a caret range. Its synchronous best-effort save is not a concurrency/crash-durability guarantee. No part of this patch was duplicated or applied here.

Parent-supplied checks for head `4059c29`: **119 passed, 3 skipped, zero failures**. This is remote CI evidence, not a claim of local SONA execution. It includes [witness marker drift](https://github.com/ruvnet/ruflo/actions/runs/38216907105/job/114703664674), [Test V3 Packages](https://github.com/ruvnet/ruflo/actions/runs/38216907105/job/114703664604), and [Type Check V3](https://github.com/ruvnet/ruflo/actions/runs/38216907105/job/114703664734). PR4081 remains separate/open per parent instructions. Earlier caret-marker and mission SIGKILL failures are not asserted to be current failures; no mission test weakening or speculative runtime changes were made.

**PR4079:** parent reports merged with passing checks and included in the new main. No console changes were made here.

## Limits and handoff

- Focused checks passed; no whole-monorepo build/test or live model-driven SPARC session is claimed. CLI integration mocks presentation/MCP boundaries while executing the real hook actions and disk reader. The existing coverage-router suite also passes.
- Witness smoke skipped 99 absent generated files; it does not establish full artifact integrity.
- The initial out-of-scope testgen runtime experiment and mock tests were removed. Missing-plugin graceful degradation remains its existing deliberate contract. Signal-termination/result parsing observations are deferred for a separately scoped review, not counted as #4085 fixes.
- Required parent/repository/nested instructions were read before edits. Existing coordination was inspected: policy `legacy`, zero rules, valid empty ledger; no tracked collaboration-session adapter was found in `.harness`. A one-agent coordination record was initialized. Memory recall returned `Database not found`; no learning-memory success receipt is claimed. The installed CLI reported daemon auto-start during recall; `ruflo daemon stop` then reported it was not running, and subsequent CLI coordination disabled auto-start. No AI worker or external model execution was requested.
- `source-sha256.txt` binds the final modified source/tests/configuration, including untracked files, to their bytes. Parent inspection and independent rerun are the next integration step. (The hashes describe the first validated state; the review addendum changes some of these files.)

## Review addendum (independent review of PR #4097)

A second reviewer reproduced #4082–#4084 on the published 3.56.7 CLI and on this branch with fixtures built from scratch (an lcov file with a zero-line file, a large and a small file; a vitest-style `coverage-final.json`; a Jest `coverage-summary.json` with `"pct": "Unknown"`). 3.56.7 listed the zero-line file as 0.0% critical and reported 33.0% overall for a 98.0% weighted report, found no data for `coverage-final.json`, and crashed on the Jest summary with `overallBranchCoverage.toFixed is not a function`; this branch fixes all three. Changes made in review:

- `scripts/ci-test-excluded.txt` now lists `tests/regression/oct12-coverage.test.cjs`, which root vitest had picked up and failed the CI test ratchet on (it has its own `node --test` runner, and needs Node 22+ to load a `.ts` file).
- The coverage reader ignores a report larger than 64 MiB or that is not a regular file, and clamps impossible lcov counts (hits above found, negative counts), with two tests in `hooks-coverage-disk.test.ts`.
- `ruflo-sparc` 0.3.5 and `ruflo-testgen` 0.3.3 (plugin changes reach marketplace users only after a version bump), with changelog entries.
- Absolute home paths in these receipts were replaced with placeholders.

Not covered by this PR: the same literal `--success true` post-task pattern appears in about 45 other plugin agents and skills (for example `ruflo-security-audit/skills/security-scan`). SPARC verification covers instruction contracts, not a live model session.
