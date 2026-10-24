# Independent synthetic recovery corpus

This dataset was frozen before the evaluator read or executed the recovery
backend. Local evaluation commit `462a332` records the original corpus and
oracle manifest; their full content digests are in the persisted receipts.
The implementation worker received the API and operation scope, but not the
eight confirmation programs. This is context separation, not access-controlled
secret storage or an external laboratory.

The corpus contains 24 small hand-authored integer programs: 16 development
programs and eight confirmation compositions. Seven launch sizes per program
exercise zero size, warp boundaries, multiple blocks, and untouched output
sentinels. Input arrays include signed extrema, zero, all bits set, multiplication
overflow, and values larger than JavaScript's exact Number range. The reference
uses independent BigInt arithmetic. Twelve separate inputs must fail closed.

The manifest freezes each PTX input and every expected input/output vector.
Changing source, reference results, or split membership makes the evaluator
reject the dataset. Acceptance requires all selected programs to emit CUDA C++,
compile with C++17 and UBSan, and match every reference element. Rejected inputs
must return an unsupported/invalid result with no executable code. A deliberately
changed arithmetic instruction must compile and fail the numerical oracle.
Missing compilers and execution timeouts are failures, never skipped successes.

```sh
node plugins/ruflo-rure/scripts/ptx-recovery-e2e.mjs \
  --module v3/@claude-flow/cli/src/rure/ptx-recover.ts \
  --split development --output /tmp/rure-recovery-new-run
```

Run confirmation once after freezing the candidate revision and recording
development results. A failure followed by a fix can be a useful regression, but
the same data is no longer untouched confirmation. `--split all` is the ordinary
regression command after that first reveal.

`--gpu-bundle /tmp/new-gpu-bundle` exports original PTX, emitted CUDA C++, and
little-endian reference vectors. The GPU operator compiles each `recovered.cu`
with nvcc into `recovered.ptx`; the independent `ptx-recovery-gpu.cu` Driver API
harness loads original and recovered modules and compares both with the frozen
oracle. Record compiler flags, GPU, driver, source and artifact hashes, process
completion, and a deliberate arithmetic mutation. Never substitute original
PTX for compilation of the recovered source.

This corpus does not establish SOTA, project-disjoint generalization, original
source recovery, useful readability, SASS lifting, floating-point fidelity,
concurrent memory correctness, or kernel performance. Its kernels are small
synthetic programs, not 24 distinct real-world applications. CPU CUDA builtins
stubs verify only the admitted sequential per-thread integer semantics. GPU
validation remains a separate measured result.
