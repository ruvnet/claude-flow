# ADR-0008: CUDA reconstruction validation on an isolated GPU

Status: Proposed; GPU experiment results require a separate execution receipt

## Context

ADR-0007 returns a structural PTX reconstruction. Matching golden text or
counting supported opcodes cannot establish that a reconstructed program
computes the same answer. The request to implement and evaluate the capability
includes ruOS and an existing Vast.ai credential. Infrastructure availability,
spending authorization, and successful execution must each be verified.

The existing `fixtures/cuda/k.cu` is an inventory fixture: its `main` allocates
buffers and launches kernels without initialized inputs or output assertions.
It cannot serve as a numerical-equivalence oracle.

## Decision

Keep GPU validation in an explicit experiment outside the read-only MCP tool.
Execute only source-known deterministic programs created for this evaluation.
Never automatically execute a user-supplied binary, extracted PTX, or generated
pseudocode as a consequence of an analysis request.

### Host, credential, and budget boundary

Resolve the live ruOS executor identity and ownership before execution. Use the
existing protected Vast.ai credential on its owning host; the credential value
does not enter prompts, command arguments, logs, git, or validation artifacts.
Pass only the required credential to the API child process. Do not move it to
another desktop or include it in a GPU workload.

Inspect existing GPU resources and current task ownership before choosing a
target. Any new rental must fit a verified existing authorization, a known
price, a fixed duration and spend cap, and a cleanup plan. Unknown remaining
budget or price stays unknown and blocks new paid work; it does not block
offline parser, compiler, or fixture checks. Do not modify another workload's
instance, credentials, scheduling, or network access.

### Frozen evaluation

Before execution record:

- Exact baseline and candidate commits, input/source hashes, generated artifact
  hashes, evaluator revision, and the commands that bind them.
- GPU model and architecture, driver, CUDA toolkit, compiler flags, runtime,
  sample sizes, warmup, repetition counts, timeout, and memory caps.
- Development cases and untouched confirmation cases, with numerical tolerance
  fixed for each operation family before observing results.
- Owner, isolated resource, lease/claim where required, deadline, cost ceiling,
  and rollback or instance-cleanup owner.

Use deterministic initialized inputs and compare three paths when executable
reconstruction exists: a simple independent CPU reference, the original
source-known CUDA kernel, and the reconstructed candidate. Include zero and
one length, sizes not divisible by the launch block, negative values, multiple
seeds, and relevant boundary values. Check output length, all expected writes,
guard regions, and numerical values. Account explicitly for floating-point
rounding and fused operations.

The decompiler currently emits annotated pseudocode. If no reviewed executable
backend exists, report GPU validation as an infrastructure/source-fixture check
only. Compiling or running the original CUDA fixture does **not** validate the
pseudocode. An independently written candidate may test an interpretation,
but is not evidence that the decompiler emitted executable code.

A test-only emitter may serialize the returned instruction IR back to PTX for
the fixed public confirmation kernels. Comparing that artifact against the
original PTX and an independent CPU oracle validates the tested instruction-IR
roundtrip. It does not validate executable C++ generation, high-level source
recovery, or arbitrary input kernels. Bind both PTX hashes and the emitter
revision in the receipt; do not reuse the original source text as the candidate.

### Performance and refinement

Report correctness separately from speed. Measure unprofiled execution with
matched inputs and launch configuration, and distinguish kernel time from
compilation, transfers, setup, and end-to-end time. Record sample count and
p50/p95 only where measured. Profiling or replay overhead is not normal serving
latency. Actual monetary cost remains unknown unless a billing source exposes
it; an estimate is labelled as an estimate.

Optimize one observed bottleneck at a time. Preserve the initial baseline and
untouched confirmation workload. A suggested default performance gate is at
least 10% improvement in the frozen primary metric with no correctness,
diagnostic-coverage, or resource-limit regression; it applies only after the
exact metric and workload are frozen. A null or negative outcome is valid.

## Evidence and acceptance

The receipt records exact artifact revisions and hashes, commands, complete
sanitized results, failures, measured deltas, cost or unknowns, and independent
review. Verify executor-owned completion metadata, not successful-looking
stdout. Missing hardware, authorization, budget, executable reconstruction, or
confirmation evidence yields **INCONCLUSIVE** for that part of the experiment.

Keep the following claims distinct:

| Claim | Required evidence |
| --- | --- |
| PTX structural reconstruction | Parser/CFG/coverage tests, malformed-input tests, built-tool invocation |
| GPU environment works | Authenticated completion of a source-known GPU probe |
| Reconstructed execution agrees | Independent reference and original/candidate comparison on frozen inputs |
| Performance improved | Matched measurements with full setup and transfer accounting |
| Public package delivered | Registry integrity and clean installed behavior |

This ADR does not assert any of these results and does not authorize a release
or deployment. Store the actual execution receipt with the reviewed change.

## Rollback

Retain the baseline artifact and disable the experimental reconstruction path
if any frozen assertion fails. Remove only this task's temporary resources and
terminate only this task's rentals through the recorded cleanup procedure.
Keep the static CUDA inventory and PTX inspection paths available.
