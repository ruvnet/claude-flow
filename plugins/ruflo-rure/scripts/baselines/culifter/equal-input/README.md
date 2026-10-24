# Equal-input CuLifter scalar CPU evaluation

This independent adapter evaluates six frozen synthetic integer kernels using
the same SASS and ELF metadata bytes supplied to the candidate. CuLifter source
stays external at `bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b`; no upstream
implementation is distributed here. The upstream license remains unresolved.
The existing bundle's Python/llvmlite dependencies and LLVM-version caveats apply.

The evaluator plan is bound to SHA-256
`2274fd56eb38d830c195e4be9d454731c1be2527c04d2d67d56bd377140fb1f3`.
The native input manifest and oracle digests must be approved independently
before execution. Creating a hash does not provide evaluation or promotion
authority.

## Scope and inputs

Each oracle uses the independently frozen data-only schema
`{id,inputBits,outputBits,cases:[{count,scalar,input,aux,expected,sentinel}]}`.
Integer arrays/scalars use unsigned decimal strings carrying 32/64-bit patterns.
Six cases have counts `0,1,3,17,32,67`. Input/aux arrays have `2*n+8`
elements; output has `n+8` elements, including eight sentinels. Launch geometry
is eight threads per block and `ceil(n/8)+1` blocks. There are 36 cases and
1,008 potential output comparisons across the six programs.

The five-argument ABI is three 64-bit pointers, uint32 count and uint64 scalar.
Offsets come from the actual ELF metadata. The adapter executes independent
threads sequentially on x86 and excludes stack, shared memory and device-global
allocations. This is CPU semantic evidence, not GPU execution or performance
evidence. Unsupported scope, failed stages and unavailable execution remain
explicit outcomes with unknown semantic accuracy, never fabricated zero scores.

The `manifest.json` contains `architecture` and exactly six `artifacts`, each
with `id`, `symbol`, `sassSha256`, `elfSha256`, and optional `sassFile`/`elfFile`
(defaulting to `<id>.sass` and `<id>.elf`). The oracle directory contains
`<id>.oracle.json` for every approved program.

A separately reviewed policy has this shape:

```json
{
  "schemaVersion": 1,
  "independentPlanSha256": "2274fd56eb38d830c195e4be9d454731c1be2527c04d2d67d56bd377140fb1f3",
  "inputManifestSha256": "<approved manifest SHA-256>",
  "evaluatorHashes": {
    "run-equal-input.py": "<frozen SHA-256>",
    "generate-driver.py": "<frozen SHA-256>",
    "inspect-abi.py": "<frozen SHA-256>",
    "../emit-object.py": "<frozen SHA-256>"
  },
  "kernels": [
    {"id": "<id>", "symbol": "<symbol>", "oracleSha256": "<approved oracle SHA-256>"}
  ]
}
```

The policy's `kernels` list must contain exactly six records. The externally
supplied policy digest is required; input, oracle, evaluator and upstream
source digests are verified before staging or subprocess execution. Exact
admitted bytes are copied into the isolated output directory.

## Commands

Run synthetic control tests first, using the bundle's pinned Python environment:

```sh
python test-adapter.py --source /path/to/pinned-culifter -v
```

These controls include independently authored native stubs, not the hidden
benchmark kernels. They do not increase the benchmark sample count.

After independent artifact approval, run the frozen baseline once:

```sh
python run-equal-input.py \
  --source /path/to/pinned-culifter \
  --inputs /path/to/approved-sass-elf \
  --oracles /path/to/independent-oracles \
  --policy /path/to/reviewed-policy.json \
  --policy-sha256 <independently-approved-policy-sha256> \
  --output /path/to/new-output-directory
```

The output receipt retains exact inputs, evaluator/source bindings, actual
compiler output, per-stage exit codes/timings and artifact hashes. All six
programs must pass for exit zero; failures preserve the receipt and exit
nonzero. No GPU rental, network call or model request is performed. Monetary
cost remains unknown. A successful narrow comparison does not establish broad
SOTA, production suitability or a performance improvement.

## Observed frozen result

The first approved run passed **6/6 kernels, 36 cases and 1,008 exact output
comparisons** on the native SM89/CUDA 13.0 exports. All 37 recorded subprocesses
exited zero and their stderr streams were empty. Independent review checked
every input/oracle binding and replayed the six unchanged binaries successfully;
that replay is not another independent holdout.

The upstream source pin is unchanged. Actual execution used Python 3.12.14,
llvmlite's LLVM 22.1.0 and g++ 13.3.0. LLVM differs from upstream's conda
20.1.8 environment. This is a narrow CPU baseline, not a GPU performance result.
The sum of recorded preparation/execution stage durations was 2.632 seconds;
it is not a comparative throughput benchmark. Actual monetary cost is unknown.

The exact evaluator was frozen before native/oracle exposure in `freeze.json`.
The approved native metadata format required a metadata-only projection:
`project-inputs.py` preserves all twelve SASS/ELF files byte-for-byte and maps
the native `kernels` manifest into the already-frozen runner's `artifacts`
schema. The independent evaluator approved this mapping before execution.

* Original input manifest: `d832f654f51d6155bda360bf947a0d88392166f52c83b48244b511439775bd98`
* Projected manifest: `b1128c44620b2559a824dcf812533b65fc40d49847e5c5d688843c081f41a4b9`
* Evaluation policy: `983e072b8edb98f4b19dd8d7a35c1ab75dd9649adc3d3ccd7ea9c2a1cb708195`
* Original raw receipt: `cc7c76976d22f7eb51a62763cdc7cf984449f9e4afeaa542b73ffacc58740949`

`observed/equal-input-result.public.json` preserves the measurements and raw
artifact hashes, replacing workspace/interpreter paths with documented
placeholders. `observed/process-logs.json` retains each stdout/stderr string and
its original/public hashes. `observed/commands.json` preserves all stage argv
with the same path substitutions. The explicit publication manifest binds
these files, the independently authored drivers, ABI metadata, approved input
bytes, policy and independent audit. Upstream source, derived LLVM, object files
and native executables are excluded.

With the repository's unchanged frozen oracle fixtures, replay from this directory:

```sh
python run-equal-input.py \
  --source /path/to/pinned-culifter \
  --inputs observed/inputs \
  --oracles ../../../fixtures/sass-recovery \
  --policy observed/policy.json \
  --policy-sha256 983e072b8edb98f4b19dd8d7a35c1ab75dd9649adc3d3ccd7ea9c2a1cb708195 \
  --output /path/to/new-output-directory
```

No baseline repair or workload retuning followed the result. This establishes
a strong external baseline on the six-fixture set; it does not establish a
RuRE recovery-coverage advantage or a broad SOTA result.
