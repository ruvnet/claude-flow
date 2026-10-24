# Independent CUDA recovery adversarial review

Outcome: one high-severity semantic correctness blocker was independently confirmed and then independently verified fixed. No remaining confirmed blocker in the bounded scope below. This is not a CUDA-device validation, proof of equivalence, complete PTX compiler validation, dependency/security release certification, or SOTA result.

## Scope and method

Read-only review of `ptx-recover.ts`, `ptx-decompile.ts`, and the new `rure_decompile_ptx` MCP `output=cuda` boundary. Attacker controls PTX file contents and MCP arguments. Assets are process availability, faithful recovered instruction semantics, and integrity of code handed to a user for later independent compilation. The module itself does not compile or execute target code. Synthetic host execution was limited to self-authored inputs; generated source was inspected before compilation. No confirmation/holdout corpus was viewed. No repository files were edited, no network scans or GPU work ran, and no external state was written.

## Confirmed blocker and fix

HIGH, fixed: the original structural parser consumed every token on a `.loc` line. With an earlier `mov.u32 %x, 1`, valid `.loc 1 1 0 mov.u32 %x, 2;` silently discarded the second assignment and emitted a store of 1. `.loc 1 1 0 ret;` silently discarded the return and emitted a later store. A same-line atomic instruction also disappeared despite recovery's unsupported-instruction boundary. The original parser SHA-256 was `3a90b5c9886d44d963c1d268bd33154035852f33ab86dfa2242ad00f83d6d413`; recovery was `eb8db24b283ae204b7ae0c5ea0971f2256e5d6169603c85566c9ab13a4485b66`.

NVIDIA PTX source-format semantics say whitespace is interchangeable; `.loc` has explicit operands, so a newline cannot be treated as a semantic instruction boundary. References: https://docs.nvidia.com/cuda/parallel-thread-execution/#source-format and https://docs.nvidia.com/cuda/parallel-thread-execution/#debugging-directives-loc . Retrieved during review on 2026-10-24 UTC.

The revised parser parses `.loc` and `.file` operand grammar, rejects extended unsupported `.loc` attributes, and parses `.target` without consuming the rest of the line. Independent reruns preserved the inline assignment and return, refused the hidden atomic, and rejected fake/missing debug operands. Eight additional independent directive boundary assertions passed, including `.file` followed by an entry on the same line, `.file` followed by unsupported global data, multiline `.loc`, inline module headers, extended attributes, and oversized debug integers.

An initial inspection identified an octal-literal concern in an earlier recovery source, but the author/parent fixed that independently before my executable reproducer ran. My independent tests verified that `010` emits eight, `-010` emits minus eight, address offset `010` emits eight, and malformed `09` is refused. I do not count this as my independently executed pre-fix finding.

## Independent checks

- 25 initialization, malformed-input, identifier, and bound probes. Uninitialized reads (including loops and joins), predicated definitions, invalid predicate width, duplicate declarations, and reachable fallthrough were refused. Register expansion, token, block, instruction, input-byte, and generated-output limits behaved as expected. A 60 KiB nested operand did not crash. Largest measured final probe was approximately 49 ms; this is a local observation, not a worst-case resource proof.
- 42 generated arithmetic/comparison/wide-multiply kernels, 9,450 exact output comparisons against a separately implemented BigInt oracle. Host compilation used g++ with undefined-behavior sanitizer; all comparisons passed. Covers 32/64-bit modular add, subtract, low multiply, low multiply-add; signed/unsigned comparisons; signed/unsigned 32-to-64-bit wide multiply; edge values and deterministic random values. Does not validate CUDA code generation, GPU ABI, SIMT behavior, or NVIDIA runtime compilation.
- Actual MCP wrapper import and execution: default/pseudocode/CUDA modes, invalid mode strings/types/null, invalid UTF-8, >256 KiB input, directory, BOM, and raw-byte source hash checked. Missing optional scanner honestly returned `screened:false`. A long generated function signature caused presentation modification and correctly withheld code (`status:unsupported`, `code:null`). A FIFO with no writer was rejected without blocking (about 0.12 ms in this run).
- Code review found bounded numeric and sanitized emitted identifiers at C++ sinks. Parameter/function/label source names are metadata, not interpolated executable C++ names. Raw input is parsed before display screening; mutated executable output is withheld.

## Exact reviewed source

| Component | SHA-256 |
| --- | --- |
| Recovery | `eb8db24b283ae204b7ae0c5ea0971f2256e5d6169603c85566c9ab13a4485b66` |
| Fixed parser | `777a0fefb8056e647ea457f13491190f7fd8c03fe2d75cd146a9334eb11f2a30` |
| MCP wrapper | `1299b26efb72e54c07fa2dd6d775a614380cd25972bd82d69068a7e8f7876c70` |
| Generated differential host source | `b7e249d2c63cdb7e58f6fb7d3bd88103aef9163a3fcd79dad5a5b1f6fd597197` |
| Repository package-lock.json | `1c4f0b19d741774dae5c9231c38695fa4feefdae4a4ce938be9b8bb26dd8fa21` |

Runtime: Node v24.19.0, tsx 4.23.15, g++ 13.3.0. No dependency advisory feed was consulted; no advisory-data freshness or dependency-clean claim is made. The validated security-skill Ruflo 3.25.6 scanner was not installed/run; this is focused manual and synthetic-input assessment, not a broad scanner result.

## Reproduction

From `/workspace/scratch/16fc07be6201/rure-recovery-adversarial`, scripts import immutable `snapshot` (pre-fix) or `snapshot-fixed` (fixed) source copies.

```bash
node --import /workspace/scratch/16fc07be6201/ruflo-cuda/v3/@claude-flow/cli/node_modules/tsx/dist/loader.mjs directives.ts
node --import /workspace/scratch/16fc07be6201/ruflo-cuda/v3/@claude-flow/cli/node_modules/tsx/dist/loader.mjs directives-fixed.ts
node --import /workspace/scratch/16fc07be6201/ruflo-cuda/v3/@claude-flow/cli/node_modules/tsx/dist/loader.mjs directive-boundaries-fixed.ts
node --import /workspace/scratch/16fc07be6201/ruflo-cuda/v3/@claude-flow/cli/node_modules/tsx/dist/loader.mjs negative-and-bounds-fixed.ts
node --import /workspace/scratch/16fc07be6201/ruflo-cuda/v3/@claude-flow/cli/node_modules/tsx/dist/loader.mjs differential-fixed.ts
g++ -std=c++17 -O0 -fsanitize=undefined -fno-sanitize-recover=all differential.cpp -o differential-host
./differential-host
node --import /workspace/scratch/16fc07be6201/ruflo-cuda/v3/@claude-flow/cli/node_modules/tsx/dist/loader.mjs wrapper.mts
mkfifo fixture.fifo
node --import /workspace/scratch/16fc07be6201/ruflo-cuda/v3/@claude-flow/cli/node_modules/tsx/dist/loader.mjs wrapper-extra.mts
rm fixture.fifo
```

The tsx CLI itself could not open its IPC socket in this environment; using Node's tsx loader avoided that unrelated sandbox limitation without escalation.
