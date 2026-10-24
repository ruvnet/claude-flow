# Executable CUDA recovery from SASS text

Recorded 2026-10-24 UTC. Task `rure-sass-recovery-20261024`, parent
`rure-executable-recovery-20261024` at
`9d8348e953321bf41431d3bf9191d48f49111f60`, existing draft
[PR 4448](https://github.com/ruvnet/ruflo/pull/4448).
The [compact outcome](outcome.json) and [artifact manifest](manifest.json)
record the lineage, scoped decisions, cost unknowns and exact retained files.

## Change and claim boundary

The parent implementation recovered executable CUDA C++ from PTX. This change
adds `recoverSass(sassText, elfText)` and the read-only MCP tool
`rure_recover_sass`. The translator receives bounded disassembler text and ELF
metadata, without original CUDA, PTX or oracle inputs. Supported scalar integer
instructions produce ordinary CUDA C++; unknown semantics return no code.

This is a text lifter, not a raw SASS binary decoder. Authentic matching
disassembler output is a precondition. Hashes do not authenticate instructions
or prove equivalence. Explicit descriptor operands, floating point, shared
memory, atomics, synchronization and calls remain unsupported. The tool never
compiles, executes or writes emitted code. See [ADR-0010](../../adrs/0010-executable-sass-text-recovery.md)
and the unchanged [frozen plan](../sass-recovery-plan-20261024.json).

The implementation remains a draft. No merge, package release, deployment,
general equivalence proof or broad SOTA result is claimed.

**Supported-subset correctness: ACCEPT. Complete confirmation coverage and
superiority over the matched baseline: REJECT. Ten-percent optimization:
REJECT. Broad SOTA remains unproven.** The frozen candidate recovered five of
six fresh synthetic kernels. All five matched the original cubins on the GPU;
the sixth returned no code for unsupported `SHF.L.U32`. CuLifter recovered all
six from the same SASS and ELF bytes. This result argues for expanding reviewed
instruction coverage before attempting a performance or superiority claim.

## Frozen native confirmation and matched baseline

The independent evaluator froze six CUDA sources and BigInt oracles before
candidate results. CUDA 13.0.88 then compiled their original cubins for SM89;
cuobjdump 13.0.85 exported SASS and ELF text. The native manifest was frozen at
2026-10-24 01:50:54 UTC and independently verified before the candidate's first
confirmation invocation at 01:52:03.022 UTC. Translation used the unchanged
standalone module under Node 20.20.2, in a namespace sandbox with no network,
source, oracle or credential mounts. The separate evaluator retained all six
cases in coverage accounting; `partial-incomplete` and
`promotionEligible: false` remain in the raw GPU receipt.

| Measurement | RuRE result | Matched baseline or scope |
| --- | --- | --- |
| Fresh confirmation CPU recovery | 5/6 kernels, 30 executed cases, 840 exact comparisons; one unsupported | CuLifter 6/6, 36 cases, 1,008 comparisons |
| Fresh confirmation, actual original/recovered cubins | Five admitted kernels, 30 cases, 1,680 exact comparisons across both variants | No CuLifter GPU performance comparison was run |
| Development, actual original/recovered cubins | Four kernels, 28 cases, 1,560 comparisons; compiled arithmetic mutation rejected | Exposed regressions, not new confirmation |
| GPU memcheck | Zero reported errors for both executed splits | Memcheck only, not racecheck or a general safety proof |
| Development timing | 1.002030063x geometric mean of per-kernel median speedups; 0 regressions above 2% | Frozen 1.10x gate failed |
| Confirmation timing | 0.987338329x on the five admitted kernels; 0 regressions above 2% | Frozen 1.10x gate failed; excluded kernel remains in coverage denominator |

The GPU was an RTX 4060 Ti, SM89, driver 595.84 (Driver API 13020), using the
pinned CUDA 13 image. Unlike the earlier PTX-JIT milestone, this driver loads
the retained **ELF cubin bytes** for both original and recovered kernels.
Pre/post execution hashes, compiler executables, all vector files, generated
source, original/recovered/mutated cubins and compiled driver bytes are retained
in the [public archive](gpu-attempt4/public-evidence.tar.xz). Its 382 files
include a manifest of the other 381 files. The separate
[development supplement](gpu-attempt4/development-supplement.tar.xz) preserves
the original pre-execution CPU and translation artifacts whose hashes appear
in the GPU bundle; these are original receipts, not replacement reruns.

Raw results: [development GPU](gpu-attempt4/development-gpu.json),
[confirmation GPU](gpu-attempt4/confirmation-gpu.json),
[confirmation CPU](gpu-attempt4/confirmation-cpu.json),
[first translation](gpu-attempt4/confirmation-translation.json), and
[independent native-input approval](native-input-independent-approval.json).
The [independent post-run audit](gpu-attempt4/independent-audit.json) verified
381 main and 28 supplemental files, 174 frozen vector files, all 19 retained
cubins (nine original, nine recovered, one mutant) and 1,800 raw timing samples.
It rederived counts and quantiles without rerunning the GPU or modifying the
candidate. Hash and arithmetic verification is not execution authentication.
Review caught an optional-archive reporting gap in that first checker. Its
actual invocation supplied and verified the archive, so the historical result
remains valid. The current checker requires `--archive`; its
[saved-evidence replay](gpu-attempt4/independent-audit-v2.json) has identical
measured fields and a new auditor source hash. All
[five negative controls](gpu-attempt4/audit-negative-controls-v2.json) refuse
altered receipt, vector, archive, optimized Python and a missing archive.
The [original checker bytes](gpu-attempt4/auditor-original.py) are retained only
to reproduce the historical receipt with its complete arguments. These checks
did not invoke the candidate or GPU again.
The [second independent review](gpu-attempt4/saved-evidence-independent-review.json)
reproduced the corrected audit and all five refusal controls.
The [CuLifter public receipt](../../../scripts/baselines/culifter/equal-input/observed/equal-input-result.public.json),
[independent audit](culifter-independent-audit.json) and
[portable baseline](../../../scripts/baselines/culifter/equal-input/README.md)
retain the identical input mapping and all six outcomes. CuLifter revision
`bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b` was run unchanged using llvmlite
0.48.0 / LLVM 22.1.0; the upstream LLVM 20.1.8 environment was unavailable.
Its 37 recorded preparation/execution stages totaled 2.63218 seconds, excluding
setup, review and tool overhead. That CPU time is not comparable to GPU launch
latency. No upstream implementation or derived LLVM/native baseline binary is
vendored; the missing upstream license remains a reuse constraint.

Each GPU kernel has 10 warmups and 100 alternating paired samples per variant,
for 1,800 measured samples across the nine executed programs. Timing measures
host launch plus synchronization at the frozen final case size. It excludes
allocation, transfer, module loading, compilation, provisioning and evaluation
cost. Clocks were not locked. Raw p50/p95 values and sample arrays are retained;
short synthetic kernels cannot establish application speedup. These inputs are
now exposed regression data. Neither implementation nor thresholds were changed
after confirmation, and repeated review does not enlarge the corpus.

## Cost and cleanup

This attempt used 265.072 seconds of rental time with a quoted compute/storage
estimate of $0.01104467. Across all four CUDA attempts, including the initial
image timeout, totals are 817.826 seconds (13.630 minutes) and $0.03411554 quoted.
Actual billing, network charges and total research/evaluation cost remain
unknown. The exact task-owned instance was destroyed; a separate fresh
authenticated provider read confirmed its ID and unique label absent and zero
remaining instances. The host's executor completion fields are retained as a
separate [sanitized observation projection](gpu-attempt4/executor-completion-projection.json),
not a portable signed attestation. The [lifecycle receipt](gpu-attempt4/receipt.json)
retains frozen image/tool versions, quote estimates and cleanup observations.
All existing cost, one-rental and time caps were preserved.

## Source, package and development validation

| Check | Result | Evidence |
| --- | --- | --- |
| Feature suite | 278 passed, 7 existing optional tests skipped | [raw log](feature-tests.log) |
| Focused MCP/integration suite | 151 passed | [raw log](integration-tests.log) |
| Final independent evaluator controls | 6 passed | [raw log](evaluator-tests.log) |
| Frozen comparison gate controls | 33 passed | [raw log](comparison-gate-tests.log) |
| CLI build | Passed | [raw log](build.log) |
| Final plugin smoke and evaluator replay | 82 checks and 6 evaluator controls passed | [smoke](final-smoke.txt), [evaluator](final-evaluator.txt) |
| Real built and clean-installed stdio MCP | SASS and PTX CUDA output emitted; `proofStatus: not-proven` | [built](mcp-built.json), [installed](mcp-installed.json) |
| Installed package CPU recovery | Four exposed programs, 28 cases, 780 exact comparisons; compiled arithmetic mutation rejected | [receipt](installed-cpu.json) |
| Final portable candidate and evaluator replay | Same four programs, 28 cases, 780 comparisons; all corruption controls and compiled arithmetic mutation rejected | [translation](public-replay-translation.json), [CPU](public-replay-cpu.json) |
| Standalone versus packaged JavaScript | Complete recovery results equal on four development inputs | [receipt](artifact-parity.json) |
| Actual Node 20.20.2 versus Node 24.19.0 | Complete recovery results and code hashes equal on four development inputs | [receipt](node-parity.json) |

Repeated development replays are regressions, not new independent kernels or
untouched confirmation. CPU per-thread stubs and UBSan do not establish GPU
descriptor behavior, SIMT semantics or device performance. Optional AIDefence
was unavailable in the actual MCP smoke, which correctly returned
`screened: false`; no screening success is inferred.

Independent review also found a presentation bug: a scanner could rename a
code or status key while leaving executable output elsewhere in the returned
object. Both SASS and PTX wrappers now discard the entire recovery object if
presentation screening changes it. The frozen semantic backends are unchanged
by this wrapper correction.

The clean-installed tarball remains `@claude-flow/cli@3.60.1`, not a published
version. [Package metadata](package-artifact.json) binds its exact integrity and compiled
backend. A fresh offline installation with scripts and optional dependencies
disabled reported 191 added packages; `npm ci` then replayed its generated
lock. A filesystem check found 195 installed nonoptional, nondevelopment
package entries among 733 dependency entries plus the root lock entry; npm's added count is not the
installed graph size.
Reusing the prior temporary fixture lock first failed peer normalization.
The failed attempt and successful fresh/locked attempts are retained, including
the [temporary lock delta](install-lock-delta.json). Repository dependencies and
lockfiles did not change. Existing Zod/runtime and wider optional dependency
findings remain unresolved; this is not a clean release audit.

## Artifact bindings

| Artifact | SHA-256 |
| --- | --- |
| SASS TypeScript | `99bd0ec252ef57bdd3985212f683c7ba22151ad6961f26a5de1c669c07c7b4b0` |
| Standalone candidate | `d85b93f70711d17c5c44f97a93d4a04ac08549cc253c70c88ab84294757287c3` |
| Packed SASS JavaScript | `be1981275d519361b11b853d539d34eae95c77025945ed0b72477285c69a080a` |
| MCP wrapper | `4b33a84f8fe466998b839debf160f65b01d9018e03d65ee34b0f13f0fafda539` |
| Sealed translator adapter | `a464137ae041c469d8a9292421b3f833d0fbc41fbb731f7503042ae3d594f353` |
| Final CPU evaluator and GPU packager | `2468e244aaed1ed1206f6a42b85f9060a4bcdaad4330a7fcfaf9d09a8c3df94d` |
| Exact-cubin GPU driver | `b192f10ae51c47e338c74531b7238daa801b91aae75c752004b1ee2b0ac2aa05` |
| Native preparer | `502b25818d4d5f079a6fec64a19aea38efee9671758a20d185f49167417c2e23` |
| Frozen six-kernel source/oracle plan | `2274fd56eb38d830c195e4be9d454731c1be2527c04d2d67d56bd377140fb1f3` |

The [standalone candidate](candidate.mjs) was reproduced byte-identically from
the frozen TypeScript with esbuild 0.28.2, using `--platform=node --format=esm
--target=node20` without bundling. Its bytes differ from TypeScript's package
emission; the result parity checks above cover the four measured inputs.
Historical receipts retain their actual evaluator versions rather than being
relabelled as runs of later harness revisions.

The two parity receipts intentionally use different development exports.
`artifact-parity.json` compares the standalone and package modules on the
SM86 crosspath inputs. `node-parity.json` compares Node 20 and Node 24 on the
SM89/CUDA 13 exports retained in the prior
[archive](../recovery-20261024/gpu-attempt3/baseline-inputs.tar.gz).
Their complete result hashes therefore differ because results contain input
digests and architecture metadata; the emitted code hashes agree. The exact
[runtime parity runner](node-parity-runner.mjs) computes SHA-256 of UTF-8
`JSON.stringify(result)` with no projection or newline, and SHA-256 of the
unmodified code string. Its [input manifest](node-parity-input-manifest.json)
and observed [Node 20](node20-raw.json) / [Node 24](node24-raw.json) outputs are
retained. Input filenames are `<id>.sass` and `<id>.elf`; invoke the runner
with the frozen candidate module path and a directory containing those files
and the input manifest as `manifest.json`.

The portable [independent adversarial replay](../../../scripts/baselines/sass-adversarial/README.md)
retains 45 refusal probes, eight architecture exports of four development
programs, and 21,600 CPU comparisons with UBSan. Its dated review separately
binds the controller and evaluator revisions approved for one bounded GPU
run. Review clearance is not an execution result or provider attestation.
The separate [integration review](independent-integration-review.md) checks
the package, MCP wrapper, published development receipts and parity bindings.
Its local integration commit identifies the reviewed workspace snapshot;
file hashes bind that review to the eventual remote PR tree. Its pending GPU
and confirmation statements describe the review's own time boundary.
The package receipt was subsequently renamed from `package.json` to
`package-artifact.json`, with identical bytes, to avoid confusion with an npm
dependency manifest.

## Portable acceptance replay

From this repository root, with Node 20 or later and g++ supporting C++17/UBSan:

```sh
RURE_REPLAY=$(mktemp -d)
node plugins/ruflo-rure/scripts/sass-recovery-e2e.mjs \
  --mode prepare-development --output "$RURE_REPLAY/input"
node plugins/ruflo-rure/scripts/sass-recovery-translate.mjs \
  --module plugins/ruflo-rure/docs/evidence/sass-recovery-20261024/candidate.mjs \
  --module-sha256 d85b93f70711d17c5c44f97a93d4a04ac08549cc253c70c88ab84294757287c3 \
  --input "$RURE_REPLAY/input" \
  --manifest-sha256 bc4ac358842671cc1fff6d8d07a77f8380999abb9ad68670fcc70d642f9ef087 \
  --output "$RURE_REPLAY/translation"
node plugins/ruflo-rure/scripts/sass-recovery-e2e.mjs \
  --mode cpu --split development --inputs "$RURE_REPLAY/input" \
  --translations "$RURE_REPLAY/translation" --output "$RURE_REPLAY/cpu"
node --test plugins/ruflo-rure/scripts/sass-recovery-e2e.test.mjs
```

This replays four public development inputs without a GPU, network, package
installation or original CUDA/PTX inputs to the translator. It compiles and
executes generated local C++ in the caller's environment; it does not provide
the namespace isolation used by the separate governed GPU procedure. See the
[evaluation runbook](../../../scripts/sass-recovery-evaluation.md).

## Rollback and remaining gate

Revert the new SASS implementation and MCP registration on the draft while
preserving PTX recovery and all negative evidence. The broad superiority gate
still requires at least 100 kernels with project/family separation, matched
strongest baselines, the full two-compiler by two-architecture matrix, complete
cost accounting and independent review. Four exposed programs and six small
synthetic confirmation programs cannot satisfy it.
