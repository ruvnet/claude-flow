# Executable integer PTX recovery: measured progress, SOTA unproven

Recorded 2026-10-24 UTC (2026-10-23 America/Toronto). Task
`rure-executable-recovery-20261024`, existing draft
[PR 4448](https://github.com/ruvnet/ruflo/pull/4448).

## Decision and scope

The previous PR head `4819642e21ba46c29f9f0ec59e6847fc0f19eef4` returned
instruction IR and pseudocode. The candidate adds actual CUDA C++ emission
for a conservative scalar integer PTX subset through `output: "cuda"` on
`rure_decompile_ptx`. Default pseudocode remains unchanged. Unknown semantics,
uninitialized registers and altered executable presentation return no code.
The MCP tool does not compile or execute its input or output.

**Scoped GPU correctness: ACCEPT. Optimization: REJECT. Broad SOTA:
INCONCLUSIVE.** Original PTX and separately compiled recovered CUDA passed
9,360 exact element comparisons on each of RTX 3060 / CUDA 12.8.93 and
RTX 4060 Ti / CUDA 13.0.88. Both runs rejected the deliberate arithmetic
mutation and passed the bounded memcheck subset. Both timing gates failed,
with geometric median speedups below 1x and three programs more than 2%
slower in each environment. These are finite synthetic results, not semantic
proof or complete application performance. The implementation remains a
draft, not merged, released or deployed.

The implementation author did not receive confirmation programs. Their first
independent-context execution was at `2026-10-24T00:45:48.040Z`, after the
candidate was frozen. This is context separation, not secret storage or an
external laboratory. Future runs of these cases are regression tests.

## Measurements

| Evaluation | Observed result | Evidence |
| --- | --- | --- |
| Development, actual generated C++ with UBSan | 16 programs, 112 cases, 3,120 exact comparisons passed | [development.json](development.json) |
| First confirmation, actual generated C++ with UBSan | 8 programs, 56 cases, 1,560 exact comparisons passed | [confirmation.json](confirmation.json), [exposure](confirmation-exposure.json) |
| Refusal and negative control | 12/12 unsupported inputs withheld code; changed arithmetic compiled and failed the oracle | Development and confirmation receipts |
| Independent arithmetic review | 42 generated probes, 9,450 exact CPU comparisons; initialization, bounds and directive checks passed | [independent review](independent-review.md) |
| Clean-installed package | Development 16/16, 3,120 comparisons; actual stdio MCP registration and both output modes passed | [installed development](installed-development.json), [MCP](installed-mcp.json) |
| External CuLifter baseline | 3 shipped kernels, 27 cases, 5,769 comparisons; wrong arithmetic rejected | [receipt](culifter-reproduction.json), [runnable bundle](../../../scripts/baselines/culifter/README.md) |
| Original PTX versus recovered CUDA on SM86 / CUDA 12.8.93 | 24 kernels, 168 cases, 9,360 exact comparisons; arithmetic mutation rejected | [GPU receipt](gpu-attempt2/receipt.json), [raw samples](gpu-attempt2/gpu-raw.json) |
| GPU memcheck | 24 kernels, sizes 0/1/33, 72 cases, 2,784 comparisons, zero reported errors | GPU raw receipt; memcheck only, not racecheck |
| GPU timing | 4,800 samples; 0.99279748449x geometric median speedup; 3 regressions above 2%; REJECT | [independent recalculation](gpu-attempt2/independent-audit-v2.json) |
| Original PTX versus recovered CUDA on SM89 / CUDA 13.0.88 | 24 kernels, 168 cases, 9,360 exact comparisons; mutation rejected; memcheck 72 cases / 2,784 comparisons / zero errors | [receipt](gpu-attempt3/receipt.json), [independent audit](gpu-attempt3/independent-audit.json) |
| SM89 GPU timing | 4,800 samples; 0.993683563x geometric median speedup; 3 regressions above 2%; REJECT | SM89 raw receipt |
| CuLifter on four shared development programs | 28 cases, 780 comparisons passed; altered SASS input rejected before execution | [baseline receipt](../../../scripts/baselines/culifter/crosspath-result.json), [integration replay](culifter-crosspath-integration-replay.json) |

The measured Linux compatibility matrix is partial. Columns identify the
CUDA compilation toolkit; the Driver API reports version 13020 in both runs.
The corresponding driver releases are 595.84 on SM86 and 595.99.02 on SM89. Independent artifact and sample audits passed for both;
these audits are not additional independent GPU executions.

| GPU architecture | CUDA 12.8.93 | CUDA 13.0.88 |
| --- | --- | --- |
| SM86, RTX 3060 | 9,360 comparisons passed | Unmeasured |
| SM89, RTX 4060 Ti | Unmeasured | 9,360 comparisons passed |

These are the same 24 small synthetic integer programs in two environments,
not 48 distinct kernels, 24 real applications or a 100-kernel public benchmark. CPU per-thread stubs do not validate SIMT,
concurrent memory, GPU ABI, floating-point behavior or device performance.
CuLifter consumes SASS and ELF metadata while RuRE currently consumes PTX;
their successful results on different inputs are not a matched comparison.
The three baseline fixtures and four shared development programs were replayed
successfully by the integration reviewer. Both tools passed that small shared
subset. Repeated runs do not increase distinct kernel coverage.

The feature test suite passed 229 tests with 7 existing optional tests skipped;
the CLI build and 76 plugin smoke checks passed. The evidence-auditor suite
passed 33 tests. The auditor returns at most `READY_FOR_INDEPENDENT_REVIEW`,
never authenticates execution and never declares SOTA. See the
[frozen protocol](../../benchmarks/cuda-recovery-gate.json) and
[baseline inventory](../../benchmarks/cuda-recovery-baselines.md).

## Artifact bindings and review

| Artifact | SHA-256 |
| --- | --- |
| Recovery TypeScript | `eb8db24b283ae204b7ae0c5ea0971f2256e5d6169603c85566c9ab13a4485b66` |
| PTX parser TypeScript | `777a0fefb8056e647ea457f13491190f7fd8c03fe2d75cd146a9334eb11f2a30` |
| MCP wrapper TypeScript at installed-package evaluation | `1299b26efb72e54c07fa2dd6d775a614380cd25972bd82d69068a7e8f7876c70` |
| MCP wrapper after description-only CI follow-up | `86553ccbb21780d9767cca9aaaaa53ca1e0056ccf47f710dc5b09c2a4a7a4087` |
| CPU evaluator | `bbe49c3dc001d11caefba935dd27ae49242f02a30cb4d49fa848300d67435f94` |
| GPU driver executed in attempt 2 | `9736c2f988c69e5a3a25f6851bb4b6503b0b8c7fb56eafc875e02edc0838b8a3` |
| GPU driver with reviewed CUDA 13 context adapter | `5db3c5391663b5fae4952a1bd02c63256eb85bc77b22d284fb0dd4a26069b44f` |
| Comparison auditor | `5472322dd99dc7a66a788b8bada30b82ec1eeaea8360b423fac6a56c2706180b` |
| Frozen comparison policy | `244c00b55cbcda23f534e9a5b19fae15bd3417f47d9f5640f0765643dfafce3c` |

Independent adversarial review found and verified the fix for a same-line
debug-directive parsing error in the unmerged candidate. Executable emission
no longer drops the instruction following `.loc`. Review also found evidence
completeness failures in the new auditor; those were repaired and retested.
The [final auditor review](auditor-independent-review.md) and
[raw negative results](auditor-negative-results.jsonl) retain the 22 rejected
evidence mutations and the synthetic complete control. The latter contains no
actual CUDA execution and is not counted as a benchmark result.
Independent integration review also hardened the standalone CuLifter runner.
A failed lift, object build, link, execution or timeout now preserves a receipt
and exits nonzero. The actual compiler version is observed and hashed, and the
exact input manifest is pinned before source staging or native execution.
Five control tests cover these paths and coordinated SASS/manifest
substitution; an independent forged-count probe also fails. The
[hardened integration replay](culifter-crosspath-hardened-integration-replay.json)
passes the same four programs, 28 cases and 780 comparisons. Historical
receipts retain their original evaluator digests. Control fixtures are not
additional kernel measurements.

These reviews cover declared source scopes, not general security certification.

The clean-installed CLI tarball retains version 3.60.1; it was not published.
Its integrity is
`sha512-ZluZo9maMoU+eX6+q+H866V2+p5+CM9ajR1QtMFDTKSAti7EkmQ3Mz9d2MJF0KvRbV04g5AEdwiHjtn/D7ljhA==`.
It contains the compiled recovery backend and declarations. No dependency or
lockfile changes were introduced; all 732 resolved versions matched the prior
clean-install graph. The actual installed runtime audit still reports six high
affected package nodes for one Zod advisory, GHSA-mrhx-c7xc-m3w5. The broader
resolved graph including uninstalled optional dependencies reports 37 affected
nodes (22 moderate, 14 high, 1 critical). These are unresolved release risks.
The previous remote PR head also had a failing repository supply-chain check;
this draft does not waive it or claim fresh-head CI success.

Fresh CI at `03a280ce6803740ffc8337f7ee2260e71375509a` found a missing
usage-guidance phrase in the new MCP description. A description-only follow-up
restored that guidance; the repository discoverability audit now passes all
409 descriptions, and all 11 wrapper tests pass. Independent review confirmed
no schema, handler, backend or parser changes. The CLI was rebuilt and the
real MCP path rechecked. The package integrity above describes the earlier
installed artifact; its executable logic is unchanged, but its description
predates this follow-up. Confirmation was not repeated. The separate
[supply-chain failure](https://github.com/ruvnet/ruflo/actions/runs/40047280439/job/120731795240)
still identifies existing graph-intelligence and browser dependencies outside
this patch. No CI baseline or accepted-findings policy was changed. At the later
`a145b05ccbb0bbe33f7fadcc9540defbcdb37c2c` snapshot, 109 checks comprised
105 successes, two skips, one still running and the same supply-chain failure.
That is a prior-head observation, not a claim that the final updated head is green.

## GPU artifact boundaries

The independently checked [frozen input archive](gpu-frozen-inputs.tar.gz) has
SHA-256 `347d6c2f9ec9716d9a8bec74134b0d96232231a08696eade5818f19cf2bc807f`.
It includes original PTX, actual emitted CUDA, finite reference vectors,
mutation and the original evaluator source. The input and recovery sources
were unchanged from the first CPU confirmation. GPU execution is subsequent
regression evidence, not a fresh untouched confirmation.

The Driver API harness loads original and recovered **PTX**, which the GPU
driver JIT compiles. The separately exported `ptxas` cubin/SASS is an auxiliary
compiler artifact, not a readback of the exact JIT machine code executed.
Retaining that cubin improves reproducibility of the SASS baseline input but
does not establish machine-code identity with the GPU execution.

The [attempt 2 export](gpu-attempt2/baseline-inputs.tar.gz) retains 48 SASS/ELF
text dumps, whose bytes were independently rehashed, and a manifest. Its
SHA-256 is `9bccdd41c91e87c37460a9367dff5a1a2c314e1ea4316327b0250d600570aea4`.
Compiled cubin and recovered PTX bytes were not retained in this attempt;
their hashes remain worker observations. The outer transport archive had a
different hash because it contained these files and receipts; it was not an
alternate baseline artifact.

CUDA 13 changed the Driver API context creation signature. The standalone
harness now uses the matching signature under `CUDA_VERSION >= 13000`, with
the original CUDA 12 path unchanged. This changes setup before execution and
timing, not workload semantics or acceptance thresholds. New executions bind
this external driver separately from the historical source in the input
archive. Independent review approved this source delta for bounded testing.

The [SM89 / CUDA 13 export](gpu-attempt3/baseline-inputs.tar.gz) additionally
retains all 24 `ptxas` cubins, all 24 compiled recovered PTX files and the
mutated PTX. Its SHA-256 is
`62f1acc98b0f0e81c3679f4f719a273cb0307a6027b16a1bbeb7bfdf25e64a48`.
The exact [executed worker](gpu-attempt3/executed-worker.py) and
[pre-execution plan](gpu-attempt3/plan.json) bind the separate CUDA 13 driver
adapter, pinned image and unchanged workload. Recovered PTX bytes are the
actual driver-JIT inputs. The cubins remain separately compiled exports.

## Cost, cleanup and next trigger

The [first attempt](gpu-attempt.json) spent 188.300 seconds loading its pinned
image and executed no kernels. Attempt 2 used the unchanged workload after a
separately recorded infrastructure timeout change. Compilation and validation
took 32.052 seconds, host transfer plus execution took 40.417 seconds, and the
rental lifecycle was 95.250 seconds. These are separate from kernel timings.
The first two rental lifecycles total 283.550 seconds. Their compute/storage
quote estimate is $0.00848899; the cumulative full-duration quote reserve is
$0.11090278. Actual billing, network charges and total research cost remain
unknown. Each rental was destroyed and a fresh authenticated API read found
both its exact ID and unique label absent. No external inference API was called;
assistant and review costs remain unknown.

The timing window includes host launch and synchronization for count 65, with
10 warmups and 100 alternating paired samples per variant. It excludes
allocation, transfers, module loading and compilation. GPU clocks were not
locked. `add7_wrap32` regressed 2.395%, `subtract64` 3.456% and
`unsigned_select64` 2.993%. The unchanged 10% gain and 2% regression thresholds
reject this result. Do not tune the threshold or select a favorable replay.

The subsequent SM89 / CUDA 13 run completed compilation and validation in
18.797 seconds; host transfer plus execution was 24.061 seconds. Its rental
lifecycle was 269.204 seconds including image readiness. Across all three
attempts, rental time totals 552.754 seconds (9.213 minutes), and the
compute/storage quote estimate totals $0.02307087. Actual billing and network
costs remain unknown. All task-owned rentals were destroyed, with fresh exact
ID and unique-label absence verified afterward.

Before the SM89 allocation, independent no-network review caught and fixed
cleanup identity and artifact-ingress limit issues in the temporary host
controller. Synthetic tests covered missing labels, foreign IDs, API outage,
byte-limit overflow, timeout and optimized-Python refusal. Cleanup now checks
both the known ID and nonce label and never deletes a foreign ID. Remote
provider deletion remains best-effort with escalation; it is not a guaranteed
hard time cap under an API outage. These controller checks grant no model or
software promotion authority.

Next action: freeze a binary-only SASS recovery comparison on identical inputs
and fresh project/family-separated programs. The current implementation has
no executable SASS lifter. The separate superiority claim also requires the
100-kernel cohort, full two by two compiler/architecture matrix, full cost
accounting and independent review. The current compatibility and synthetic
correctness results do not satisfy that gate.

Rollback is to retain default pseudocode, revert the recovery commits on the
draft branch and preserve all negative receipts. Nothing was merged, deployed
or published as a package.

## Runnable acceptance checks

From the repository root with Node 24 and g++ available:

```sh
node plugins/ruflo-rure/scripts/ptx-recovery-e2e.mjs --split all
node --test plugins/ruflo-rure/scripts/ptx-recovery-gate.test.mjs
node plugins/ruflo-rure/scripts/smoke.mjs
```

Expected: 24/24 programs and 4,680 CPU comparisons, all 12 refusals and the
arithmetic negative control pass; 33 auditor tests and 76 smoke checks pass.
These commands do not rent hardware or establish GPU/SOTA acceptance. The
[corpus instructions](../../../scripts/fixtures/ptx-recovery/README.md) describe
separate GPU bundle export. Running the comparison auditor without a complete
frozen comparison report must return `INCONCLUSIVE` and exit nonzero.

The retained GPU result can be audited without renting hardware. From the
repository root, use Python 3.12 or later. This reads only the committed public
fixtures and independently recalculates timings and hashes:

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib, subprocess, sys, tarfile, tempfile
root = Path("plugins/ruflo-rure")
evidence = root / "docs/evidence/recovery-20261024"
archive = evidence / "gpu-frozen-inputs.tar.gz"
assert hashlib.sha256(archive.read_bytes()).hexdigest() == "347d6c2f9ec9716d9a8bec74134b0d96232231a08696eade5818f19cf2bc807f"
with tempfile.TemporaryDirectory() as directory:
    with tarfile.open(archive) as packed:
        packed.extractall(directory, filter="data")
    for attempt in (2, 3):
        subprocess.run([sys.executable, str(root / "scripts/ptx-recovery-receipt-audit.py"),
                        str(evidence / f"gpu-attempt{attempt}"), str(Path(directory) / "rure-recovery-gpu-final")], check=True)
PY
```

Expected for each environment: audit pass, 9,360 comparisons, all 504 vector
files verified and performance `REJECT`. The SM89 replay also verifies the
24 compiled recovered PTX inputs, 24 auxiliary cubins and mutated PTX. [Retained-only independent replay](gpu-attempt2/retained-replay.json)
verified this path without the original scratch directories. The auditor is a
post-execution consistency check, not executor authentication, a promotion
authority or another executed GPU trial. Running with `python -O` is rejected.
The [negative replay receipt](receipt-audit-negative-v2.json) records eight
rejections for raw/vector/archive mutations and optimized Python invocations.

`manifest.json` binds the retained receipt files. Hashes establish integrity
relative to these bytes, not executor authentication or promotion authority.
