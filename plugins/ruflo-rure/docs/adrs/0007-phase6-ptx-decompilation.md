# ADR-0007: ruRE Phase 6 — bounded PTX decompilation

Status: Proposed

## Context

ADR-0006 inventories CUDA containers, kernels, and resources. Its PTX reader
identifies declarations but does not explain instructions or control flow. A
person inspecting an authorized CUDA artifact needs to see how a kernel indexes
threads, reads parameters and memory, computes values, and branches.

The original CUDA source cannot generally be recovered from optimized PTX.
Names, types, source structure, and compiler transformations may be ambiguous.
The useful first step is an evidence-preserving structural decompilation whose
coverage and limitations are machine-readable.

## Decision

Add the read-only MCP tool `rure_decompile_ptx`, taking `{ "path": string }` for
an absolute path to a standalone PTX file. It reads at most **256 KiB** and
returns structured instructions, basic blocks and their control-flow edges,
and annotated C-like pseudocode. The handler does not compile or execute the
input, load a CUDA driver, call a shell, or write a reconstructed program.
The initial grammar accepts printable ASCII PTX plus tabs and line endings.
Additional limits are 64 functions, 4,096 instructions and labels per module,
2,048 blocks per module, 100,000 tokens, and 512 characters per token.

The implementation has three stages:

1. Parse bounded PTX text while retaining instruction positions, predicates,
   opcodes, operands, and function boundaries.
2. Form basic blocks and explicit branch/fallthrough edges. Preserve predicates
   and labels instead of guessing a structured loop or discarding a branch.
3. Render the supported instruction subset as C-like pseudocode, with explicit
   markers for instructions whose semantics are not reconstructed.

Register names and byte-address arithmetic remain visible. Semantics-bearing
modifiers such as integer widening, floating-point rounding, and address spaces
must not disappear during presentation. Fused multiply-add cannot silently
become separate multiplication and addition. Unsupported operations are
reported rather than translated into plausible but invented behavior.

### Result meaning

The result binds the input with a source digest and identifies the PTX module,
functions, parsed instructions, control-flow blocks, pseudocode, unsupported
operations, warnings, and truncation. Reconstruction status distinguishes
complete supported syntax, partial coverage, and invalid input.

The version-1 core result includes `sourceSha256`, `language: "ptx"`,
`ptxVersion`, `target`, `addressSize`, `status`, `truncated`, `functions`,
`warnings`, `totalInstructionCount`, and `supportedInstructionCount`.
Instructions retain a function-local index, source line, exact opcode, raw
operand strings, optional predicate, and supported flag. Blocks refer to
instruction intervals `[start, end)` and explicit successor block IDs.
Parameters and registers remain textual declarations; inferred CUDA types are
not presented as recovered facts.

| Status | Meaning |
| --- | --- |
| `complete` | The accepted structural grammar was parsed and every instruction matched the explicit supported subset. |
| `partial` | Parsed input contains instructions or declarations outside the supported lifting subset. |
| `invalid` | Input cannot be reconstructed within the grammar or resource limits; inspect warnings and `truncated`. |

`invalid` is a result of this bounded parser, not a claim that NVIDIA's full
PTX grammar rejects the input. Resource limits set `truncated: true`; previously
completed functions may remain in an invalid result as partial evidence.

**`complete` describes syntactic coverage of the supported subset. It is not a
claim of semantic equivalence, recovered original CUDA source, or compilable
CUDA C++.** A successful MCP call can return a partial or invalid reconstruction;
callers must inspect the analysis status and diagnostics. Unknown operations,
unresolved control flow, and resource limits must remain visible.
Partial results warn that CFG edges model supported control instructions only;
unsupported instructions may change control flow beyond those edges.

The core parser operates on original bounded input bytes. It must not consume
the `includePtx` string returned by `rure_analyze_cuda`: that display path has its
own text and screening limits and may have already shortened the program.
Input-derived text in the MCP result uses the existing AIDefence screening
boundary. `screened` and redaction counts describe that screening; neither is
an execution-safety or semantic-equivalence certificate. The MCP envelope also
reports `presentationModified` if screening changes the displayed result; its
source digest continues to identify the original input, not the rendered text.

### Scope and compatibility

The initial target is scalar PTX suitable for understanding elementwise kernels:
parameter loads, thread indices, integer and floating arithmetic, comparisons,
predication, direct branches, memory operations, and returns where supported by
the parser. The implementation's explicit opcode/modifier handling is the
coverage authority. A valid PTX instruction outside it remains unsupported.

Existing CUDA inventory outputs and tools retain their contracts. This is a
new MCP capability and follows the repository's minor-release policy. Merely
adding the tool does not establish public package or console availability.

The first version does not implement SASS decoding, whole-program host/device
reconstruction, full C++ demangling, a CUDA interpreter, automatic execution of
pseudocode, or general CUDA-to-HIP translation. Reductions involving barriers,
warp operations, atomics, or advanced tensor instructions require tested
semantics before their reconstruction can be described as complete.

## Validation and refinement

Freeze source-known fixtures and acceptance before optimization. Reuse the
committed CUDA 13 `k80.ptx` as an input-format fixture, and add independent
synthetic cases for branches, predicate negation, register reuse, and loops.
Assertions cover instruction counts and locations, CFG edges, preserved
modifiers, explicit unsupported operations, and deterministic output.

Failure cases include comment text containing fake declarations or labels,
duplicate and missing branch targets, malformed or truncated bodies, multiple
instructions on a line, oversized input, excessive declarations/instructions,
and pathological whitespace. Resource-limit failures must not yield a complete
result. Parser tests alone do not establish GPU equivalence; ADR-0008 specifies
that separate experiment and its evidence requirements.

Measure parser latency and output size on the same fixtures before and after
any optimization. Preserve the baseline, exact source/build revision, commands,
raw results, and independent review. Retain a refinement only after correctness
and diagnostics remain unchanged on the frozen confirmation cases.

The initial dense-label aggregation refinement has a bounded, synthetic
[measurement receipt](../evidence/ptx-alias-benchmark-20261024.json).
Run `node plugins/ruflo-rure/scripts/ptx-alias-benchmark.mjs` from the repository
root with Node 24. The script pins the candidate source and workload, derives
an explicit array-copy ablation by changing only two aggregation loops, and
requires exact output equality before timing. This comparison is not a prior
release benchmark or a claim about GPU throughput or ordinary kernel latency.

## SASS roadmap

A later adapter can consume output from a pinned NVIDIA `nvdisasm` installed on
an authorized host. It needs a separate schema for architecture-specific
instructions, its own tool-availability and subprocess boundary, and fixture
comparison against NVIDIA's output. Initial coverage should target one tested
architecture. SASS-to-pseudocode reconstruction and executable equivalence
remain separate acceptance claims; this PR does not implement that adapter.

## Rollback

Remove the new tool registration and decompiler files while retaining the
unchanged CUDA inventory reader. No package publication, deployment, or GPU
execution follows automatically from this ADR.

## References

- [PTX ISA](https://docs.nvidia.com/cuda/parallel-thread-execution/)
- [CUDA Binary Utilities](https://docs.nvidia.com/cuda/cuda-binary-utilities/)
- [ADR-0006](0006-phase5-cuda-fatbin-static-analysis.md)
- [ADR-0008](0008-cuda-semantic-validation.md)
