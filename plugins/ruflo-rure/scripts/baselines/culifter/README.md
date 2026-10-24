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

## Pending cross-input-level probe

`generate-crosspath.mjs` prepares independent drivers for four development
programs in RuRE's separately frozen synthetic corpus. It requires actual
CuLifter ELF parameter offsets and the exact corpus module; it has only been
syntax checked. The GPU worker's bounded instance failed to become ready
before its deadline and was destroyed, so no corresponding SASS/ELF artifacts
were produced and this comparison was **not run**. Do not score it as zero
coverage. This generator does not fetch source or start hardware.
