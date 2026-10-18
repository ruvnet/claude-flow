# Correctness, retained consumer and native dependency validation

Observed October 18, 2026 UTC. Ruflo baseline is
`da709de5bd1b88c15399128d16fd004c1b7fc046`, draft [PR 4264](https://github.com/ruvnet/ruflo/pull/4264).
The earlier hosted ecosystem workflow 39114168929 completed successfully. New
source changes remain reviewable; local evidence does not imply hosted CI or release acceptance.

## New retained candidates

- **Memory correctness:** sparse direct JavaScript arrays could skip finite-value
  validation and persist an invalid embedding. Snapshot every array slot before
  validation. The identical three write/update/retrieve regressions fail against
  baseline and pass against candidate. Rejection occurs before snapshot opening;
  authoritative bytes and subsequent restart retrieval remain unchanged. JSON CLI
  input was already rejected. No installed package source or public dependency changes.
- **Candidate execution correctness:** forward exactly `RUFLO_REQUIRE_HARNESS`
  and `RUFLO_HARNESS_RESOLVE_FROM` into paired evaluations. The new test fails on
  baseline, passes on candidate and proves adjacent credential-like variables are
  not forwarded. Worktrees and environment filtering still are not a hostile-code sandbox.
- **Native dependency remediation:** [RuVector PR 1230](https://github.com/ruvnet/RuVector/pull/1230)
  changes only Cargo-resolved rustls 0.23.45 to 0.23.46. Actual native audit drops
  13 to 9 vulnerability instances; four public Rustls advisories disappear. Both
  audit exits remain 1 because nine ZIP instances remain. Baseline/candidate each
  pass 297 scoped tests with the same three existing live-API ignores; candidate
  core build passes. [Native raw evidence and executable verifier](evidence/native-rustls-2026-10-18/README.md).

These are scoped correctness/security candidates, not additional download savings,
model-quality gains or proof of seven-day compounding.

## Revalidation

Linux x64, Node 24.19.0, npm 11.9.0. Use the exact pinned tooling fixture and required
environment variables documented in [capability-web.md](capability-web.md).

- The exact 16-file Node contract command in `.github/workflows/ecosystem-contracts.yml`:
  **92 passed, zero failures/skips**, 10,391.176044 ms.
- `python3 scripts/tests/runtime-relationships.test.py`: **15 passed**.
- Required installed suites: `weight-eft-installed`, `ecosystem-analysis-installed`,
  `ecosystem-memory-installed`, `ecosystem-memory-atomic-installed`,
  `ecosystem-memory-lifecycle-installed`, `ecosystem-agent-memory.installed`,
  `ecosystem-heldout-evaluation.installed`, and `ecosystem-loop-installed`, all
  under `scripts/tests/` with `.test.mjs` suffix: **40 passed, zero failures/skips**,
  97,169.195539 ms. Exact command and raw output are in the receipt/evidence.
- Fresh measured baseline and candidate consumers each passed the lifecycle and
  held-out suites: **19 tests each, zero failures/skips**. This exercises separate
  process write/restart/retrieval, update/delete, sparse-input rejection and six
  actual task processes across three fixed held-out cases.
- Two explicit loop iterations passed all ten checks in 79,644.574796 ms, with
  one new source identity and the unchanged repeat deduplicated. Exit 2 correctly
  retains 390 uncovered packages. `node scripts/build-ecosystem-web.mjs` reports
  ten passed capabilities. Lockstep and dependency-overlap audits pass unchanged.

One earlier installed attempt was rejected because bound evaluator source changed
while the loop ran. Its 36/37 result is retained as excluded moving-source evidence;
the later frozen-source 40/40 result is the acceptance run. No source-stability
guard or timeout was loosened to obtain a pass.

## Fresh transfer measurement: retained, not a new gain

```sh
python3 scripts/benchmarks/npm-slim-opt-in.py --archive <claude-flow-3.57.0.tgz> --baseline-manifest <fixed-baseline-package.json> --output <new-empty-directory>
```

| Variant | Unique cached registry tarball bytes | Tarballs | Install seconds |
| --- | ---: | ---: | ---: |
| Fixed baseline | 522,159,201 | 548 | 65.412 |
| Retained candidate | 412,781,888 | 538 | 91.845 |
| Difference | −109,377,313 (20.947%) | −10 | **+26.433 (slower)** |

Separate empty caches and identical disabled-lifecycle-script policy were used.
All 548/538 tarball URL, integrity and byte records exactly match the fixed prior
measurement. All 1,941 nonmanifest umbrella files remain identical. These counts
exclude metadata/protocol overhead, retransmissions and local fixture bytes.
One sequential timing observation per side, shared compute and uncontrolled CDN
metadata do not support a latency claim. The original fixed reference and last
accepted receipts are unchanged.

The fresh consumers supply memory 3.0.5, sql.js 1.15.0, RuVector 0.2.41,
native core 0.1.33 and Weight EFT 0.1.2. The qualified harness 0.2.0 fixture is
resolved separately; the umbrella's harness 0.1.0 is not silently upgraded or
included in a misleading aggregate byte claim. Packs are unsigned local fixtures,
not final signed releases. Semantic embedding quality remains unmeasured.

## Guidance and remaining work

[MetaHarness PR 416](https://github.com/ruvnet/metaharness/pull/416) adds router
guidance and pack inclusion only. Source/registry router 0.4.0 is verified, distinct
from the existing Ruflo consumer's 0.3.2. Build/lint and 34 source tests pass per
variant; one unit case returns early with the native peer installed, so fresh
peer-absent consumers separately cover it. Real native train/exit/load/route and
JavaScript restart pass. Pack size is 21,362 to 22,643 bytes (+1,281), with all 18
existing nonmanifest files unchanged. [Portable reproduction and raw evidence](proposals/router-guidance-validation.md).

Local guidance stays **54 package roots / 40 inventory names**. Ecosystem source
guidance becomes **44/401**, including open draft branches, with **357 pending**.
This is not merged or released coverage. Registered runtime coverage stays ten
checks over 11 packages; seven inventory packages have an integration check and
390 remain uncovered. Source-evidenced runtime links stay 42 and isolates 95.

Next: remediate the remaining native ZIP paths with real resolver/build evidence,
validate independent hosted CI, and continue the exact-source guidance queue.
No merge, npm publication, advisory suppression or release authority was added.
Source rollback does not undo database writes and would reintroduce the fixed
memory defect; native rollback reintroduces the four known advisories.

The [source-bound receipt](../../data/ecosystem-correctness-native.validation.json)
records fixed references, source identities, exact commands, excluded failures,
retained measurements and reverse-patch rollback evidence.
