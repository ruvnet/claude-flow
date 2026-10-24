# PTX reconstruction confirmation

Run from the repository root with Node 24 (native TypeScript stripping):

```sh
node plugins/ruflo-rure/scripts/ptx-e2e.mjs
```

The runner accepts an optional built JavaScript or source TypeScript module path,
then an optional new output filename for the reconstructed confirmation PTX:

```sh
node plugins/ruflo-rure/scripts/ptx-e2e.mjs \
  v3/@claude-flow/cli/src/rure/ptx-decompile.ts \
  /tmp/rure-confirmation-roundtrip.ptx
```

The output filename must not exist. Generated JavaScript and target binaries are
never evaluated. The dependency-free evaluator also runs from Vitest through
`v3/@claude-flow/cli/__tests__/rure-ptx-e2e.test.ts`.

Exercise the actual built MCP server, including its registry, authorization path,
file boundary, screening, and nested JSON-RPC response:

```sh
# After installing the repository's development dependencies, stage its reviewed
# runtime bundles before compiling CLI. Registry-only security bootstraps may
# lack newer policy APIs; do not bypass policy to make a test pass.
node scripts/stage-internal-runtime-bundles.mjs --target v3/@claude-flow/cli
(cd v3/@claude-flow/swarm && npm run build)
(cd v3/@claude-flow/cli && npm run build)
node plugins/ruflo-rure/scripts/ptx-mcp-e2e.mjs v3/@claude-flow/cli
```

The argument may instead point to a cleanly installed/extracted CLI package
directory. This spawns its `bin/mcp-server.js` with an isolated temporary working
directory and minimal environment, sends sequential `initialize`, `tools/list`,
and `tools/call` requests, checks the frozen fixture digest and both functions,
then terminates the child and removes temporary state. Each request has a
15-second timeout. Dependency or policy failures fail this test; no registry
mocks or authorization bypasses are used. The result reports whether optional
screening actually ran.

## Frozen evidence

The oracle and integer fixture were specified independently of the decompiler
implementation. Acceptance is all of the following, without tolerance changes:

- Preserve the 32 ordered instructions, predicated guards, float bit-pattern,
  and expected CFG block boundaries of existing `k80.ptx` (nvcc 13.0.88 output
  from source-known `k.cu`; provenance is in the fixture directory's README).
- Preserve the branch/loop edges of `ptx-decompile-confirmation.ptx`, a new
  handwritten PTX 7.8 / `sm_75` fixture with affine and sum kernels.
- Independently interpret the returned integer IR against host arithmetic for
  two kernels and nine sizes: 0, 1, 31, 32, 33, 127, 129, 257, and 1025. Padded
  launches exercise guards; 17 sentinel output elements must stay unchanged.
  All 18 cases and 3,576 element comparisons must pass.
- Reconstruct PTX from returned declarations, labels, and instruction IR only;
  reparse and require identical IR and CFG (excluding source line numbers).
- Mark unsupported barriers incomplete, reject missing branch destinations,
  and produce identical results across repeated parses.

Fixture SHA-256:

| Fixture | SHA-256 |
| --- | --- |
| `k80.ptx` | `f6235f78b392f6ca6f6d80112c2963568f260fe7ef2e25a277f63fadbb0935af` |
| `ptx-decompile-confirmation.ptx` | `db69341fc0312e810e25b7c8ed97ca3112e4b2d057b13aaf2d7ade71201ed420` |

## Optional real GPU confirmation

On an independently authorized isolated CUDA host, copy only the public fixture,
the reconstructed PTX, and `ptx-gpu-validate.cu`. The test neither rents hardware
nor reads credentials. With a CUDA 12.8 toolkit and a compatible driver:

```sh
nvcc -std=c++17 plugins/ruflo-rure/scripts/ptx-gpu-validate.cu \
  -lcuda -o /tmp/ptx-gpu-validate
/tmp/ptx-gpu-validate \
  v3/@claude-flow/cli/__tests__/fixtures/cuda/ptx-decompile-confirmation.ptx \
  /tmp/rure-confirmation-roundtrip.ptx
```

The driver JIT executes both original and reconstructed kernels and compares each
to the CPU reference, including untouched tails. Success requires exit code 0,
`status: pass`, 18 paired cases and 7,152 element comparisons. Record GPU, driver,
toolkit, input/harness/output digests, and actual command output externally.
As a negative control, change only the reconstructed affine instruction's final
immediate from 7 to 8. The same command must fail on the size-1 affine case
(expected 13, actual 14) with exit code 1.

## Limits

These checks validate structural reconstruction and this bounded integer IR
roundtrip. They do not establish executable CUDA C++ source recovery, general PTX
semantic equivalence, floating-point equivalence, SASS decompilation, concurrency
or barrier behavior, or recovery of programmer intent. The interpreter refuses
unimplemented opcodes and uses small exact values; it is not a general PTX VM.
The 100-sample warm parser timings and process peak RSS reported by the runner
are descriptive measurements, not acceleration or GPU performance claims.
The GPU test is optional evidence; CPU success does not imply a GPU run occurred.
