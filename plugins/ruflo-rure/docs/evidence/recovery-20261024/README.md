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

**Promotion: INCONCLUSIVE.** CPU compilation and exact numerical results pass
the bounded synthetic tests, but the frozen feature acceptance also requires
actual GPU execution of original PTX and recovered CUDA. That gate did not run.
The broader comparison requires a representative matched benchmark and has
not been satisfied. This is a tested draft implementation, not a merged,
released, deployed or proven superior decompiler.

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
| Original PTX versus recovered CUDA on GPU | Not run: pinned image did not load before the readiness deadline | [GPU attempt](gpu-attempt.json) |

These are 24 small synthetic integer programs, not 24 real applications or a
100-kernel public benchmark. CPU per-thread stubs do not validate SIMT,
concurrent memory, GPU ABI, floating-point behavior or device performance.
CuLifter consumes SASS and ELF metadata while RuRE currently consumes PTX;
their successful results on different inputs are not a matched comparison.
The three baseline fixtures were replayed successfully by the integration
reviewer; repeated runs do not increase distinct kernel coverage.

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
| GPU driver | `9736c2f988c69e5a3a25f6851bb4b6503b0b8c7fb56eafc875e02edc0838b8a3` |
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
this patch. No CI baseline or accepted-findings policy was changed.

## Cost, cleanup and next trigger

One RTX 3060 rental spent 188.300 seconds loading the pinned CUDA image. No
kernel, timing sample, sanitizer case or SASS export ran. Compute/storage
quote estimate was $0.00563738; actual billing and network cost are unknown.
The task-owned rental was destroyed and a fresh authenticated API read found
zero instances. A fresh query found the previously verified cached offer
unavailable, so no second rental was allocated. Total CPU, review and assistant
cost are unknown. No paid inference was invoked for this implementation.

Next action: run the unchanged source-bound bundle on an eligible isolated
CUDA host under the existing cost limits, then collect the required device
correctness, mutation, sanitizer and timing evidence. The expected correctness
count is 24 programs, 168 cases and 9,360 comparisons across original and
recovered execution. This would close only the GPU milestone; a matched-level,
project/family-disjoint 100-kernel comparison on two compiler versions and two
GPU architectures remains necessary for the separate superiority claim.

Rollback is to retain default pseudocode, revert the recovery commits on the
draft branch and preserve all negative receipts. Nothing was merged, deployed,
published as a package or left running on rented hardware.

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

`manifest.json` binds the retained receipt files. Hashes establish integrity
relative to these bytes, not executor authentication or promotion authority.
