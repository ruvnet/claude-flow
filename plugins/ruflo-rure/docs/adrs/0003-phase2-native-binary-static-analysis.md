# ADR-0003: ruRE Phase 2 — native binary static analysis

Status: Proposed

## Context

ADR-0001 deferred native-binary analysis because REA drives commercial tools (Hopper/IDA/Ghidra) that ruRE cannot bundle or license. Phase 1 shipped JS/Electron analysis. Many real targets (Electron apps' native modules, CLI tools, plugins) ship native binaries, and the first questions asked of them need no disassembler: what format, what architecture, what sections, which libraries and symbols does it import and export, what strings does it carry.

## Decision

Phase 2 adds **container-level static inspection of ELF, PE and Mach-O files**, implemented as an original pure-TypeScript parser reading bytes from a `Buffer`. No disassembler, no decompiler, no external engine and no new dependency.

- **Parses, never executes.** Nothing from the target is loaded, mapped, run or passed to a shell. The parser only reads integers and C-strings at offsets it bounds-checks.
- **Hostile input by default.** Malformed or adversarial headers are normal input: every offset read is bounds-checked, every table walk has a hard element cap, and a parse failure in one structure is recorded as a warning while other structures still parse.
- **Resource caps.** Files over 128 MiB are refused before reading. At most 4096 sections, 2000 imports, 2000 exports and 200 strings are returned; `truncated` reports when a cap fired.
- **AIDefence gate.** Extracted strings, symbol names and library names are untrusted text and pass through the existing gate before returning; flagged values are redacted and counted, never silently dropped.
- **One new tool:** `rure_analyze_binary` (read-only). Same dual-use policy as ADR-0001: it describes structure to help a user understand software they are authorized to study. It does not strip, patch, or modify anything.
- **Out of scope for this phase:** instruction decoding, control-flow recovery, decompilation, Mach-O imported-symbol tables (libraries only), and any dynamic analysis.

## Consequences

Users get format, architecture, section layout, linked libraries and import/export surface with zero licensing dependencies and a small attack surface. Disassembly-grade analysis remains a later phase with its own ADR; this phase deliberately produces the structured inventory such a phase would need as input.
