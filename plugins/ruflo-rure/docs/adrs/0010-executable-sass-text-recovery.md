# ADR-0010: Executable recovery from SASS and ELF text

Status: Proposed. Existing release and comparison gates remain unchanged.

Date: 2026-10-24 UTC

## Context

PTX recovery has additional type and parameter information that SASS lifting
does not receive. CuLifter already executes all four shared development
programs from SASS and ELF dumps. A useful next milestone gives RuRE the same
inputs and measures correctness against that baseline, without supplying
original PTX, source, or reference outputs to the translator.

## Decision

Add a pure `recoverSass(sassText, elfText)` module and the read-only MCP tool
`rure_recover_sass`, taking absolute `sassPath` and `elfPath` paths. Inputs are
bounded UTF-8 outputs of NVIDIA `cuobjdump -sass` and `cuobjdump -elf` for one
kernel. The tool does not invoke NVIDIA tools, compile, execute, or save code.
It returns ordinary CUDA C++, parameter ABI metadata, source digests,
diagnostics, explicit assumptions and `proofStatus: "not-proven"`.

The initial scope is a conservative scalar integer subset for SM86 and SM89.
Registers are 32-bit bit patterns; wide operations use explicit register
pairs. Parameter sizes, ordinals and offsets come from validated ELF metadata.
They are not inferred from a known fixture name. Unsupported instructions,
modifiers, malformed metadata, undefined registers and unsupported control
flow return no executable code. Resource bounds apply to instructions,
registers, parameters and emitted output as well as input bytes.

Stack setup may be omitted only after proving the value unused, including
implicit register-pair uses. Canonical uniform descriptor setup requires an
explicit reviewed assumption about the CUDA flat global memory environment.
It is not a general proof that descriptor state has no effects. Global loads
and stores preserve admitted bit widths and require valid aligned addresses.
Synchronization, atomics, shared memory, floating point and unknown system
state remain outside this implementation's scope.
The initial admission accepts the implicit descriptor spelling present in the
retained development exports and refuses explicit `desc[...]` memory forms.
Supporting a new descriptor form requires its own reviewed semantics.

## Text trust boundary

This module lifts disassembler text. It does not decode raw SASS bytes or
authenticate that a supplied mnemonic matches the encoding printed beside it.
Matching hashes or matching hexadecimal comments between two untrusted text
files cannot establish that relationship. Arbitrary submitted dumps therefore
require authentic matching disassembler output as an explicit precondition.
`emitted` means source was produced under the declared assumptions; it does
not establish binary equivalence, safety to execute or original source recovery.

For a measured binary-derived recovery claim, the independent evaluator must
run the pinned NVIDIA disassembler on the exact original cubin, retain the
exports, bind their digests to the frozen candidate, compile its returned CUDA
and execute the actual original and recovered cubin bytes. A separately
compiled auxiliary cubin does not identify code executed through PTX Driver
JIT. Earlier PTX receipts retain their original and narrower provenance.

Every returned string and object key passes through the existing presentation
screening path. If screening changes any recovery content, withhold code and
the emitted status. Digests bind original input bytes. Missing screening is
reported honestly and does not become an execution authorization.

## Frozen validation

The [task plan](../evidence/sass-recovery-plan-20261024.json) precedes candidate
results. Four existing development inputs must compile and execute exactly,
with CuLifter's four successes retained as the strong simple comparison.
Independent confirmation specifications and oracles are frozen before
candidate outputs; resulting native artifacts are frozen before evaluating
the fixed candidate. Unsupported cases remain visible. Repeated confirmation
after any repair is regression evidence, not a new untouched workload.

Include altered arithmetic, malformed input, unsupported modifiers, ABI
inconsistency, register-pair aliasing, unsafe identifiers, byte limits and
presentation modification. Validate the built package and real MCP transport.
CPU arithmetic checks cannot establish GPU descriptor behavior or SIMT
correctness. GPU testing requires separate existing authorization, reviewed
bounded execution, retained artifacts and verified rental cleanup.

No performance advantage or SOTA result follows from this milestone. The
100-kernel, project and family separation, matched baseline, full compiler and
architecture matrix, cost and independent review requirements in ADR-0009
remain unchanged. Known passing cases must not be selected as confirmation.

## Alternatives and rollback

Retaining PTX-only recovery is useful but cannot answer an equal-input SASS
comparison. Raw SASS decoding could strengthen the text trust boundary but is
a separate implementation. Unrestricted generated CUDA would increase the
validation burden without providing a correctness guarantee.

Revert the SASS module, MCP registration and related documentation if its
frozen invariant fails. Preserve historical PTX functionality, failed evidence
and the original binaries. Keep all changes on the existing draft PR. No
automatic merge, release, deployment, credential migration or budget increase.

## Primary references

- [NVIDIA CUDA 12.8 Binary Utilities](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-binary-utilities/index.html)
- [NVIDIA CUDA 13.0 Binary Utilities](https://docs.nvidia.com/cuda/archive/13.0.0/cuda-binary-utilities/index.html)
- [CuLifter pinned source](https://github.com/gthparch/CuLifter/tree/bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b)
- [ADR-0009](0009-executable-ptx-recovery.md)
