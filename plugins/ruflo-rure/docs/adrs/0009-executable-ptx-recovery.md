# ADR-0009: Executable PTX recovery and evidence for a scoped comparison

Status: Proposed. Supersedes no existing validation or release gate.

Date: 2026-10-23 (America/Toronto)

## Context

ADR-0007 produces annotated pseudocode. ADR-0008 validated a small integer
instruction roundtrip by emitting PTX again. Neither result establishes that
RuRE recovers executable CUDA C++, lifts SASS, or exceeds another decompiler.
The next useful capability is an actual executable backend with conservative
admission and independent numerical evaluation.

The public baseline inventory has also changed the comparison. CuLifter's
September 2026 paper and public source are relevant to executable binary
lifting. Its reported valid-IR coverage must not be compared with RuRE's test
case counts, and its CPU execution results must not be described as GPU proof.
See the [dated baseline inventory](../benchmarks/cuda-recovery-baselines.md).

## Decision

Add a pure `recoverPtx(text)` backend beside the structural parser. Its result
has a source digest, `language: "cuda-cpp"`, `status: "emitted"`,
`"unsupported"` or `"invalid"`, diagnostics, parameter metadata and
`proofStatus: "not-proven"`. Only an admitted complete module returns code.
The backend emits ordinary CUDA C++ operations and control flow. It must not
embed the original PTX, emit inline PTX assembly or invoke the original binary
as its implementation. The MCP path remains read-only: returning generated
code does not compile, execute, save or deploy it.

The initial semantic scope is scalar integer PTX with explicit widths,
parameters, global loads/stores, supported index registers, comparisons,
predication, direct branches and bounded-parser control-flow graphs. Width
changes, multiplication and signed comparison require explicit semantics.
Integer wraparound must not become signed C++ overflow. Register declarations,
uses, joins and predicated old values require validation. A plausible default
value for an uninitialized register is not recovery.

Float rounding, shared memory, warp operations, atomics, synchronization,
device calls and unknown opcode/modifier combinations remain unsupported until
implemented and independently evaluated. They cannot be accepted by deleting
an instruction or silently substituting a no-op. Bound register expansion,
generated source size and analysis work in addition to the existing input
limits. Use generated identifiers so PTX names cannot inject source code.

`emitted` means only that the conservative emitter produced CUDA C++ within
its declared scope. It does not imply the program is safe to execute, free of
data races, equivalent for all inputs, original-source recovery, or approved
for production. Memory validity and aliasing assumptions remain explicit.
The experimental executor accepts only source-known synthetic or licensed
public fixtures selected independently; analysis of an untrusted file never
grants execution authority.

## Independent validation

Freeze fixtures, reference functions, edge cases and rejection cases before
candidate results. Count distinct source programs separately from input sizes,
seeds, compiler variants, launches and scalar comparisons. CPU stub execution
of emitted code is useful for integer semantics but cannot validate SIMT,
barriers, GPU address-space behavior or hardware scheduling.

For admitted GPU cases compile the actual returned CUDA C++, then compare it
with original PTX/binary execution and an independent reference. Bind all
three artifact digests and the evaluator. Include deliberate arithmetic
mutations, output guards, signed boundaries, wrapping arithmetic, branch joins
and loop boundaries. The candidate must not provide the reference evaluator.
Retain failed cases and classify unsupported behavior separately from wrong
accepted behavior. Inspect clean-installed package behavior through the real
MCP registration and policy path.

## Frozen comparison gate

The [versioned protocol](../benchmarks/cuda-recovery-gate.json) requires at
least 100 distinct kernels, at least 70 development and 30 untouched
confirmation kernels, project **and** family separation, two compiler
versions and two GPU architectures. A corpus manifest, input artifacts,
candidate, evaluator and costs must be frozen before confirmation. The policy
exists now; the broad corpus and comparison do not.

Run separate PTX-to-CUDA and SASS-to-executable-IR tracks. Extra PTX metadata
is an information advantage, so do not score the current PTX emitter as a
SASS lifter or compare mismatched inputs. Select the strongest reproducible
baseline for each claim before viewing confirmation results. Unavailable
weights, missing license evidence or a failed environment are unknown
baseline results, never zero recovery. Original PTX passthrough is a useful
correctness reference but is ineligible as recovered C++.

Recovery superiority requires at least **10 percentage points** more correct
executable coverage, no observed incorrect acceptance, equal or lower fully
accounted cost per validated kernel and independent reproduction. This exact
threshold remains unchanged if the baseline exceeds 90%; in that case a
10-point gain may be impossible on that cohort. Report that constraint rather
than converting it after observing results into a different metric.

Optimization is a separate claim. It requires at least **1.10x** geometric
mean complete-invocation speedup and no admitted workload more than **2%**
slower, versus the original binary, current compiler and strongest applicable
library. Include search, failed attempts, compilation, setup, inference,
validation and review costs. Unknown billing stays unknown.

The local gate checks evidence completeness and derives counts from individual
records. Its best result is `READY_FOR_INDEPENDENT_REVIEW`. It never declares
`sotaProven`, authenticates executor metadata or authorizes promotion. A
candidate-provided `pass`, `ACCEPT`, signature-shaped string or digest cannot
replace independent review of actual executions and source provenance.
Every workload binds nonempty input, generated and compiled artifacts, a
frozen test manifest and one shared original/reference output. Missing
baseline attempts remain unknown. Receipt JSON is checked for its actual
digest bindings and executed case list, while authentication remains an
external evaluator responsibility. The local audit never upgrades its own
synthetic schema fixtures into CUDA measurements.

## Alternatives

1. Continue structural pseudocode only: useful inspection, but no executable
   recovery claim.
2. Serialize original PTX: a strong identity reference, but does not answer the
   new source-recovery question.
3. Generate unrestricted CUDA using a model: broad potential coverage, but
   unsupported outputs require independent validation and inference costs.
4. Start with SASS lifting: valuable and harder because register typing,
   ABI, control flow and synchronization information have been erased. It
   remains a separate implementation and benchmark track.

## Rollback and consequences

Disable executable recovery and retain original artifacts and static
inspection if a frozen invariant fails. Preserve negative evidence. Do not
automatically merge, publish a package, deploy, change credentials or expand
GPU spending. Reviewable code and useful synthetic correctness gains are
valid outcomes even while the broad superiority verdict remains INCONCLUSIVE.

## References

1. [PTX ISA](https://docs.nvidia.com/cuda/parallel-thread-execution/)
2. [CuLifter v2, 2026-09-04](https://arxiv.org/html/2604.27486v2)
3. [CuLifter source at bc5a9f0](https://github.com/gthparch/CuLifter/tree/bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b)
4. [ADR-0007](0007-phase6-ptx-decompilation.md)
5. [ADR-0008](0008-cuda-semantic-validation.md)
