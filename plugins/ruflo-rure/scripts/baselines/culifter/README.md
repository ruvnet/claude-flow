# CuLifter CPU reproduction

These independently authored drivers reproduce three small public CuLifter
fixtures through SASS, LLVM and native x86 execution. They are a capability
check, not a SOTA comparison or proof of GPU semantic equivalence.

The upstream source is **not included**. Its repository metadata had no license
and no root LICENSE at the inspected revision. Resolve reuse and distribution
rights before incorporating upstream implementation code into another product.

## Pinned input and result

* Upstream: <https://github.com/gthparch/CuLifter>
* Commit: `bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b`
* Tree: `0f0964a41c17f0c532e53c19a7e54584875a00c6`
* Programs: integer copy, finite FP32 sum, unsigned integer division/shift.
* Result: 3 kernels, 27 cases, 5,769 exact comparisons passed. Each case also
  checks 32 output guard elements. An added-one LLVM mutation is rejected with
  exit 1 at `n=1,index=0,expected=0,actual=1`.

The float inputs are exactly representable finite dyadic values. No NaN,
subnormal, memory ordering, shared memory, barrier or warp behavior is covered.
The drivers execute thread-independent kernels sequentially. The published
paper's entire corpus and its performance claims were not reproduced.

## Reproduce

Use Python 3.12 on Linux x86_64 with g++ 13.3 (observed environment) or record
the actual versions used. Downloading upstream source is separate from running
this test. The runner copies only 98 files listed in `upstream-files.json` after
checking their exact SHA-256; additional checkout files cannot shadow Python
imports. It does not download, rent hardware or contact a model service.

```sh
git clone https://github.com/gthparch/CuLifter.git /tmp/culifter-source
git -C /tmp/culifter-source checkout --detach bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b
python3 -m venv /tmp/culifter-venv
/tmp/culifter-venv/bin/python -m pip install --only-binary=:all: \
  llvmlite==0.48.0 pyelftools==0.31 pyyaml==6.0.3 libcst==1.8.5 pytest==8.4.1
/tmp/culifter-venv/bin/python run-baseline.py \
  --source /tmp/culifter-source --output /tmp/culifter-result
```

Run from this directory. The output directory must be new. Expected summary:
`status:pass`, 3 kernels, 27 cases, 5,769 comparisons and
`negativeControlRejected:true`. `result.json`, command timings, every process
exit status, stdout/stderr, intermediate LLVM and objects remain in that local
output directory. Each subprocess has a 60-second ceiling. The runner never
inherits token or credential environment variables.

`llvmlite==0.48.0` was pinned as upstream requests, but its PyPI wheel embeds
LLVM 22.1.0. Upstream also pins conda clang/llvmdev 20.1.8. This reproduction
uses llvmlite's native object emitter and g++ 13.3 instead of that unavailable
clang 20.1.8 path, and records the deviation. It is not a byte-for-byte
reproduction of the published environment.

`culifter-reproduction.json` records the original observation and original
artifact hashes; paths there refer to the evaluation workspace. The retained
raw result JSON and `upstream-files.json` are independently checkable here.
Repeated execution does not create new distinct kernels or independent trials.
Monetary evaluation cost is unknown. No GPU was rented for this probe.

## Interpretation

The result establishes a working external executable baseline; missing model
weights in other projects must not be scored as zero recovery. RuRE currently
accepts PTX while this baseline accepts SASS plus ELF metadata. Even matched
source programs have different information inputs, so this probe cannot
establish recovery coverage superiority. A project-disjoint matched-level
benchmark and the frozen SOTA gate remain necessary.

## Executed cross-input-level probe

The four designated development programs `copy32`, `add7_wrap32`,
`multiply_low64` and `wide_signed` from RuRE's frozen synthetic corpus were
compiled for SM86 with CUDA 12.8.93. Their `cuobjdump` 12.8.90 SASS and ELF
metadata text is retained in `crosspath-inputs/`. These are outputs from our
own synthetic programs, not CuLifter implementation files. The `.elf` files
are text dumps, not ELF binaries. The input manifest binds original PTX,
cubin, SASS and ELF hashes.

CuLifter then independently lifted those SASS/ELF inputs to LLVM and native
x86. All four programs passed: **28 cases and 780 exact comparisons**,
including output sentinels. Their original PTX hashes match the frozen
independent oracle corpus. These are development programs, not untouched
confirmation cases. Replays do not increase the distinct program count.

```sh
/tmp/culifter-venv/bin/python run-crosspath.py \
  --source /tmp/culifter-source --inputs crosspath-inputs \
  --corpus ../../fixtures/ptx-recovery/corpus.mjs \
  --output /tmp/culifter-crosspath-result
```

Run from this directory. The runner binds the source manifest and oracle
digests, verifies all eight SASS/ELF input hashes before lifting, and derives
the five-parameter ABI from the actual ELF metadata. It rejects shared or
stack allocations outside this scalar driver's scope. A changed SASS file
was rejected before source staging or execution. Exact evaluator hashes,
source/input bindings, native results and stage timings are retained in
`crosspath-result.json` and the local result directory. The dependency and
LLVM-version caveats above apply unchanged.

**No superiority was demonstrated.** The external baseline and RuRE both
passed this small shared program subset, while their input information differs
(SASS plus ELF versus PTX). This is a capability comparison, not the frozen
SOTA benchmark. No GPU is required to replay the retained baseline inputs.

## Runner hardening and control regressions

The current `run-crosspath.py` writes its receipt and exits nonzero unless all
four programs pass. It records the actual `/usr/bin/g++ --version` output,
compiler path and output digest. The four-program input manifest is pinned
before source staging or execution, so changing both SASS and its declared
hash cannot substitute a different input silently.

Run the portable control tests using the same Python environment as the replay:

```sh
/tmp/culifter-venv/bin/python test-crosspath-runner.py \
  --source /tmp/culifter-source \
  --corpus ../../fixtures/ptx-recovery/corpus.mjs -v
```

`--source` is required; `--corpus` defaults to the repository fixture path.
These five tests inject stage failures, timeout and a false compiler-version
fixture, check actual compiler provenance, and reject joint SASS/manifest
substitution before execution. Synthetic stage results test runner controls;
they are not additional kernel correctness measurements.

`crosspath-result.json` preserves the original historical run.
`crosspath-hardened-result.json` records the subsequent replay with the fixed
runner: the same four programs, 28 cases and 780 comparisons passed. It does
not increase the distinct program count or change the INCONCLUSIVE promotion
verdict. The actual replay command remains the one in the preceding section;
use a new output directory for every run.
