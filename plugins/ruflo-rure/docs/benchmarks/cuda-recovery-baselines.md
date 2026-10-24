# CUDA recovery baselines and reproduction boundaries

Retrieved 2026-10-24 00:33–00:50 UTC (2026-10-23 America/Toronto).
This inventory contains primary-source observations. Paper and vendor numbers
are originating-team reports until a separately recorded reproduction verifies
them. No unavailable baseline is assigned a score of zero.

## Comparison inventory

| System | Immutable source or version | Actual task | Reproduction boundary |
| --- | --- | --- | --- |
| [PtxDec](https://github.com/S4Plus/PtxDec/tree/9c954665178255c3576ba3a33b20ccf498a52765) | `9c954665178255c3576ba3a33b20ccf498a52765` | LLM-assisted PTX to CUDA C | Inference code and sample data are public; the pinned README still describes full weights and data as pending. No root license was found. Do not substitute another model and call it a reproduced PtxDec baseline. |
| [CuLifter](https://github.com/gthparch/CuLifter/tree/bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b) | `bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b`; [paper v2](https://arxiv.org/html/2604.27486v2), 2026-09-04 | SASS plus ELF metadata to typed LLVM IR; CPU and other backends | Public implementation and small checked-in fixtures permit bounded CPU reproduction. Root license and any file named LICENSE/COPYING were absent from the complete fetched tree. Do not vendor source or assume redistribution permission. |
| [NVLift](https://github.com/purseclab/Sass-LLVM-Lifter/tree/99c1782267e520f1145be84264906831c253c2da) | `99c1782267e520f1145be84264906831c253c2da`; [BAR 2026 paper](https://www.ndss-symposium.org/ndss-paper/auto-draft-650/) | SM75 SASS to LLVM IR, optionally RetDec C | Code and saved SASS/LLVM examples are public. The reviewed workflow requires CUDA and LLVM tools. No root LICENSE/COPYING file was found. |
| [JEB Pro](https://www.pnfsoftware.com/jeb/manual/sass/) | Current official manual retrieved on the date above; exact installed version unknown | Commercial SASS disassembly and decompilation | No licensed installation or head-to-head run was established by this inventory. Public feature descriptions are not measured executable recovery coverage. |
| [sass2mlir](https://mbuchel.github.io/projects/sass2mlir/) | Project page updated 2026-10-17; measurement snapshot 2026-10-14 | SASS computation recovery and structural Hopper transformations | Page identifies AGPL-3.0-or-later but says public source and paper links will be added when available. No reproducible source revision was established. |
| [CuAsmRL](https://github.com/hgl71964/cuasmrl/tree/fed7fb14ad51e8398e0edc90270f5207a26671ec) | Reproduce branch `fed7fb14ad51e8398e0edc90270f5207a26671ec`; [CGO 2025 paper](https://arxiv.org/abs/2501.08071v1) | SASS scheduling optimization | Separate performance comparator, not a source-recovery baseline. Archived repository is read-only. Its artifact evaluation requires an A100 and substantial runtime; not executed here. |

## Important correction to the comparison target

CuLifter was absent from the preceding short strategy comparison. Its latest
paper reports valid LLVM output for 11,977 kernels and more than 90% CPU
execution correctness within its testable set. The earlier April v1 used
different function counts and a 73.8% CPU result; do not mix those versions.
Valid IR is not equivalent execution, and CPU testing is not hardware GPU
validation. These results make broad superiority an empirical question,
not a claim supported by RuRE's small integer fixture suite.

The CuLifter checked-in reproduction README counts **650 input units** and
**11,977 emitted LLVM definitions**. A source kernel, a device function, a
library module, a workload size and a launch are different units. Record the
unit and denominator explicitly when comparing tools. Its complete artifact
workflow is separate from a small fixture reproduction.

## Bounded independent CuLifter reproduction

The [recorded CPU reproduction](../evidence/recovery-20261024/culifter-reproduction.json)
executed CuLifter at `bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b`
on three checked-in SASS/ELF kernels: integer copy, finite dyadic float32
addition, and unsigned division/shift. All **27 cases and 5,769 scalar
comparisons** matched independent references, and an injected arithmetic
mutation produced the expected mismatch. These are three originating-team
fixtures, not 27 or 5,769 independently held-out kernels. The raw receipt
SHA-256 is `791c93b3c6a1223e4a9c63554b885b66ebc8bd3ddce405cfbb2a652eefafa72c`.

The environment used Python 3.12.14, llvmlite 0.48.0 with embedded LLVM 22.1.0
and g++ 13.3.0. Upstream's separately pinned Clang/LLVM 20.1.8 was unavailable;
native object emission used llvmlite instead. A separately authored sequential
host runtime tested only thread-independent operations. The
[reproduction bundle](../../scripts/baselines/culifter/) records these
deviations and commands. No CuLifter source was vendored, and its missing
license remains unresolved.

This establishes a narrow executable baseline capability. It does not
reproduce the full paper or establish CuLifter GPU execution.

A subsequent RuRE GPU run compiled the frozen corpus with CUDA 12.8.93 on
SM86 and retained actual SASS and ELF text. CuLifter independently recovered
four designated development programs from those outputs: `copy32`,
`add7_wrap32`, `multiply_low64` and `wide_signed`. All **28 cases and 780 exact
comparisons** passed, including output sentinels. A changed SASS file was
rejected before execution. The integration reviewer replayed these checks.
See the [crosspath receipt](../../scripts/baselines/culifter/crosspath-result.json)
and [runnable instructions](../../scripts/baselines/culifter/README.md).
These are four development programs, not new confirmation cases.

Both implementations pass this small shared program subset. Their inputs
still differ: RuRE reads PTX while CuLifter reads SASS plus ELF metadata.
Consequently this is not an equal-information recovery comparison and gives
no evidence of RuRE quality superiority. Broad coverage, performance,
total-cost superiority and SOTA remain unverified.

## Executable interfaces and prerequisites

CuLifter's [pinned README](https://github.com/gthparch/CuLifter/blob/bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b/README.md)
defines:

```bash
python main.py -i input.sass input.elf -o output --lifter x86
```

The output is `output.ll`. The pinned
[environment](https://github.com/gthparch/CuLifter/blob/bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b/environment.yml)
specifies Python 3.12, LLVM/Clang 20.1.8, llvmlite 0.48.0,
pyelftools 0.31, PyYAML 6.0.3, libcst 1.8.5 and pytest 8.4.1.
The checked-in `test/addrtest/A1_copy_1d_int/` includes SASS and ELF inputs.
LLVM verification, host compilation and actual numerical execution are
separate reproduction steps. The 50 GB full-workflow disk recommendation is
not a requirement to fetch the small fixture; the separate benchmark archive
is about 4.7 GB extracted according to the repository.

PtxDec's [pinned inference script](https://github.com/S4Plus/PtxDec/blob/9c954665178255c3576ba3a33b20ccf498a52765/model_train_infer/infer.py)
requires a local fine-tuned model path and imports ModelScope and vLLM. Its
training, generation and evaluation code does not supply the missing trained
weights. Repository subtrees have their own licenses; those do not establish
a root license for the decompiler. No model download, paid inference or
training run was attempted for this inventory.

NVLift's [launcher](https://github.com/purseclab/Sass-LLVM-Lifter/blob/99c1782267e520f1145be84264906831c253c2da/launch/lifter.sh)
calls `src/cu2sass.py`, `src/main.py`, `opt`, `llc`, then `nvcc` for GPU output.
`launch/config.json` identifies the SASS input and LLVM output. Its pinned
requirements use llvmlite 0.44.0, different from CuLifter; keep environments
isolated. The Docker recipe uses CUDA 12.5 and an LLVM version argument.
The paper reports 11 lifted kernels and five with verified execution. This is
an originating-team result, not a score measured on the RuRE corpus.

## Optimization is a different claim

CuAsmRL's paper reports 9% average and 26% maximum scheduling improvement.
Its [artifact appendix](https://www.cl.cam.ac.uk/~ey204/pubs/2025_CGO.pdf)
identifies A100-80GB-PCIe, about an hour of preparation and about 50 hours of
experiments. The appendix names Apache-2.0 while the pinned root LICENSE is
MIT text inherited from Triton; review component licenses before reuse.

The sass2mlir project reports 1.220x aggregate throughput relative to FA2
across 108 workload cells, but 32 cells regress. The measured scope is two
admitted FP16 programs on H100 NVL. These are complete-invocation comparisons
with stated setup exclusions. They cannot establish 108 independent source
recoveries or an unconditional performance improvement.

## Frozen gate and runnable audit

The [protocol](cuda-recovery-gate.json) records the unchanged proposed
100-kernel, 70/30, two-compiler, two-architecture gate. The broad corpus has not
been frozen, so its dataset/candidate/evaluator bindings remain null.

```bash
node --test plugins/ruflo-rure/scripts/ptx-recovery-gate.test.mjs
node plugins/ruflo-rure/scripts/ptx-recovery-gate.mjs
```

The second command intentionally exits 1 with `INCONCLUSIVE` until a complete
evidence bundle and separately frozen bindings are supplied:

```bash
node plugins/ruflo-rure/scripts/ptx-recovery-gate.mjs \
  --evidence /path/to/evidence/report.json \
  --bindings /path/to/independently-frozen-bindings.json
```

These paths are interface examples, not existing results. The test file
contains synthetic schema fixtures, not benchmark measurements. The auditor
checks artifact hashes, distinct manifest IDs/program hashes, split separation,
matrix completeness, output equality and exact integer coverage/cost gates.
It does not trust a report's `pass`, `ACCEPT` or `sotaProven` field. Its best
result is `READY_FOR_INDEPENDENT_REVIEW`; `sotaProven` remains false and
promotion remains INCONCLUSIVE. Independently authenticated executions,
canonical-kernel identity, provenance, licenses and review remain external
obligations. Performance needs a separate frozen timing evaluator.

The report names source, dataset, baseline, evaluator and independent-review
artifacts as `{ "path": "relative/file", "sha256": "64 lowercase hex digits" }`.
All artifact digests cover raw file bytes. Frozen bindings supply the same
digests independently, plus compiler versions, GPU architectures, baseline
selection and split provenance. `policySha256` covers the UTF-8 result of
`JSON.stringify(JSON.parse(policyFile))`, not the indented policy file bytes.
The test fixture documents the complete current input shape. Its made-up
records must never be submitted as measured evidence.

The dataset also freezes one `workloads` entry per kernel/compiler/GPU row,
binding `inputSha256`, `testManifestSha256`, `referenceOutputSha256` and
`originalArtifactSha256`. An observation must supply nonempty input bytes,
a bound test-manifest JSON file, a shared reference output and the original
program's compiled artifact, actual output and execution receipt. Both tools
must use that exact shared reference, and the original must agree with it.
An empty file is not an executed program or an output. The current comparator
requires exact output bytes; approximate numerical acceptance needs a
separately frozen and independently reviewed comparator.

Test manifests bind the row identity, input and reference digests, the
`exact-output-bytes` comparison, and unique case IDs with validation
categories. Recorded execution JSON must bind the same row, inputs, test
manifest, compiled artifact, output and exact case-ID list. Tool receipts
also bind tool and generated-source digests. They require schema version 1,
a run ID, executor, command, `status: "ok"`, integer `exitCode: 0`,
`completionVersion: 1` and `completionVerified: true`. These fields are
checked for completeness only: a local file does **not** authenticate them.
External executor verification and independent replay remain required.

An `admitted: false` row needs a bound rejection-attempt receipt describing
unsupported input, compile failure or runtime failure. A missing attempt or
an unavailable baseline remains unknown, rather than zero measured coverage.
The mutation control binds an altered compiled artifact and observed output
to a frozen workload. The GPU memory-check receipt binds the candidate and
dataset, checked row count, tool/mode, command, executor and zero observed
errors. A status label alone does not satisfy either requirement.

Reader limits are 32 MiB for the report, 1 MiB for frozen bindings, 64 MiB per
artifact, 256 MiB total artifact bytes read, two million reference attempts
and 100,000 observations. Test/receipt JSON is limited to 1 MiB, each workload
to 10,000 cases and aggregate case processing to one million case references.
Repeated references use the verified byte snapshot.
The evidence directory must be owned by the evaluator and immutable during
the audit. Path and final-component symlink checks are not a sandbox against
an adversary concurrently replacing parent directories. The coverage gate
applies independently to confirmation as well as the complete cohort.

## Next state change

Complete a matched, pinned competitor reproduction and freeze a licensed
project/family-disjoint corpus. Extend RuRE admission from measured failures,
then perform fresh independent confirmation. Preserve the original program
as fallback. Do not lower thresholds, impute missing baselines or advertise
broad SOTA while these prerequisites remain open.
