# ADR 497: ruRE in the console reads CUDA code

Status: Accepted (built and tested against the real CLI and real nvcc output; ships in ruflo-console 0.47.0; needs a ruflo CLI that has `rure_analyze_cuda`, which is in `main` after 3.60.1)

Date: 2026-10-23

Builds on: ADR-494 (the ruRE page), ADR-495 (the sample link check), ADR-496 (DETECT, long lists and Claude's view). The tool itself is ruflo-rure ADR-0006.

## 1. Context

`rure_analyze_cuda` reads the GPU code in a CUDA program: the fatbin entries (PTX or cubin, target architecture, compression), each kernel with its register count, code size and constant, shared and local memory, and the PTX version, target and kernel names. A person using the console could not reach it: the ruRE page lists the six earlier readers, and DETECT sent a `.cubin`, a `.fatbin` or a `.ptx` to the native binary reader, which named the format and nothing else. A CUDA host binary read by that reader showed `.nv_fatbin` among its sections with no hint that anything lay inside.

## 2. Decision

- **A CUDA row** (`dt-re-cuda`) in the native section of the ruRE page, built like its neighbours: one `ruflo mcp exec -t rure_analyze_cuda -p {path}` call with fixed argv, a read that runs at once, the same `sample` field rule, the same link check (ADR-495), the same confirm gate and palette id (`/ruflo run dt-re-cuda <path>`), so Claude reaches it through `console_run` and sees the result in `console_state`'s `rure` block (ADR-496) with no new code.
- **A reader** (`cudaLines` in `data/rure.ts`): a header line (source, the cubin architectures, the PTX architectures, kernel and device-function counts), the fatbin location and each entry (`#2 ptx sm_80 · zstd · 1464 B`, or `unread:` with the reason), one line per kernel (`saxpy · sm_80 · 10 reg · 384 B code (~24 instr) · const 376 B`, with shared memory when there is some, `[device fn]` for a function that is not launchable), the PTX modules, and the host signals. At most 30 entries and 60 kernels are shown with a count of the rest, inside the panel's 120-line cap. Every value goes through `plain()` and every number through `measureOf`: a count that is not a measurement reads `n/a`, never a plausible clamp (#3822). The tool's own warnings and what AIDefence held back come first, as for every ruRE reader.
- **DETECT routes** `.cubin`, `.fatbin` and `.ptx` (any case) to the CUDA row. A folder is still read as JavaScript source and an extensionless file as a native binary, as ADR-496 says.
- **A hint from the native row.** When the native reader's sections include `.nv_fatbin`, `.nv_fatb` or `__nv_fatbin`, it adds one line: it holds CUDA code, run CUDA. DETECT cannot see sections, so this is how a CUDA host binary, which it must read as a native binary, leads to the CUDA reader.
- **No new trust.** The path rule, the link check, the read-only class, the escape stripping and the untrusted-text marker for Claude are the ones the other rows have. Nothing is run, written or loaded.

## 3. Limits, stated plainly

- **An older CLI has no such tool.** The row then prints the existing "update ruflo" line (`NO_TOOLS`). Releasing the console before the CLI is harmless and not useful until the CLI follows.
- **The reader shows what the tool returns**: no SASS, no `.nv.info` attributes beyond the register count, no full C++ demangling (ruflo-rure ADR-0006 section "Out of scope"). Instruction counts are an estimate from code size, and the row says `~`.
- **A kernel in an architecture the tool could not read** (a payload it could not decompress) is not listed; its entry line says `unread:` and why.
- **DETECT's CUDA routes are by extension.** A CUDA binary with another extension is read as a native binary, and the hint line then points at the CUDA row.

## 4. Verification

- `tests/rure-cuda-page.spec.ts` (12): the row's call and class; the reader against four real captured CLI answers (a CUDA 13 host binary with zstd PTX, a two-architecture binary, a CUDA 12.8 binary with LZ4 PTX, a standalone cubin); an unread entry and a not-CUDA answer; the hint on a real CUDA host binary's native reading and its absence on an ordinary ELF; a hostile answer (escapes in every string field, 1e300 in every number, 5000 kernels cut to the panel); DETECT's three routes and its two unchanged ones.
- `tests/rure-cuda-e2e.spec.ts` (10): the real built CLI on the committed nvcc binaries (the CLI's own fixtures, with `cuobjdump` output recorded beside them). Every kernel's registers and constant bank in the console's lines equal `cuobjdump -res-usage`; LZ4 and zstd PTX are both read; the native row's hint appears; DETECT routes a real `.cubin`, `.fatbin` and `.ptx`. It skips, saying so, when the CLI is built without the tool. Line checks look for a line anywhere, not at index 0: without AIDefence (as in CI) a "not screened" caveat comes first.
- `tests/rure-page.spec.ts` and `tests/devtools.spec.ts` gained the row and the tool's input schema, so the catalog invariants (a `mcp exec` call names a real tool and only declared parameters; a read runs at once) cover it.

## 5. Not decided here

The folder allowlist outside the project and the ruflo-mods mod that offers to analyze new binaries remain as in ADR-496. A per-kernel drill-down (the PTX of one kernel on the page) would be a change to what the page shows, and needs the tool's `includePtx` output to be shown as text the person can read: its own decision.
