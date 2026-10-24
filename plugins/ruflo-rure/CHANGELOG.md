# Changelog: ruflo-rure

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets. Built from git history; see `git log -- plugins/ruflo-rure` for the full record.

## 0.6.0 — 2026-10-24

- feat: `rure_cuda_launch_plan` (ruflo ADR-501, ruflo CLI 3.62.0): the step from "what the CUDA program contains" to "what is worth measuring". For each kernel of each architecture it works out theoretical occupancy at a set of block sizes, which resource limits it, the best block sizes and a few flags, and with `includeHarness` returns the text of a CUDA driver-API program the person can build to check the numbers on their own GPU (and, with arguments they supply, to time launches). The occupancy model reproduces NVIDIA's `cuda_occupancy.h` on every combination checked for sm_70, 75, 80, 86, 87, 89, 90 and 120, and equals the CUDA driver on real devices (see the ADR for which). Read-only: nothing is compiled, loaded or run by ruRE, and nothing from the analyzed file reaches the harness text.
- docs: the skill gains the launch-plan step and states the limits (occupancy bounds performance and does not predict it; an architecture without a table gets no figure; building the harness is the person's step). Its console step now lists the CUDA row and the outside-folder option, which it had not caught up with.

## 0.5.0 — 2026-10-23

- feat: Phase 5 per ADR-0006 — `rure_analyze_cuda` inventories the GPU code in a CUDA program from a host ELF/PE with a `.nv_fatbin` section, or a standalone fatbin, cubin or PTX file: the fatbin containers and entries (kind, target `sm_NN`, compression), PTX version/target/kernel names, and per kernel its mangled name, code size, register count, constant/shared/local memory and an instruction estimate. zstd (CUDA 13) and LZ4 (CUDA 12) compressed entries are read under size caps; a Node without zstd reports those entries as unread. Original pure-TypeScript reader: no toolkit, no SASS decoding, nothing run. Checked against real `nvcc` 12.8 and 13.0 output (sm_75, sm_80, sm_90) and `cuobjdump`: kernel names, register counts, constant and shared memory all equal. A new MCP tool, so it ships in the next minor release of `@claude-flow/cli`; the ruflo console's ruRE page does not list it yet.
- chore: the layout is what was read from real files, not NVIDIA's specification (which is not published). A first draft read register counts from the code section's `sh_info`, which is right on sm_75/80 and zero on sm_90; testing on a multi-architecture binary caught it, and it now reads `EIATTR_REGCOUNT` from `.nv.info`.

## 0.4.2 — 2026-10-23

- docs: the six tools now have a page in the ruflo console (TOOLS → ruRE, ruflo-console 0.45.0, ruflo ADR-494), so a person can run them without asking Claude. The console accepts only project-relative paths and shows the file's own text cleaned of terminal escapes. No tool, schema or behavior changed.

## 0.4.1 — 2026-10-22

Fixes from an independent security review of 0.1.0-0.4.0. Each finding was reproduced against the real source before fixing, and each fix has a test that fails without it.

- fix: AIDefence gate bypass. `rure_analyze_js_app` computed screened snippet text but returned the raw `imports[].source`, `exports[].name`, boundary `detail` and file paths, so a flagged string reached the output with only a counter incremented. Every attacker-derived string (JS specifiers, names, file paths, ELF section names, .NET runtime version) is now screened, and strings are clipped to 2048 chars before scanning or returning.
- fix: the gate no longer reports a scanner that throws as clean. Tool results now carry `screened: boolean`; `false` means the scanner was unavailable or failed and the strings are unscreened (still clipped).
- fix: directory walk followed symlinks (loops and fan-out: a 2-byte file reached 20000 times). It now uses `lstat`, skips symlinks, and enforces a 128 MiB total-byte budget.
- fix: quadratic regex when sniffing EVM files (a long whitespace run stalled the event loop for seconds). Sniffing is now linear.
- fix: CPU amplification in ELF dynamic/dynsym and PE import walks (several seconds for a few MB of crafted input). Table walks now share an iteration budget, `entsize` is no longer trusted below the real struct size, and PE section count is capped at the format limit of 96.
- fix: a garbage ELF `e_entry` demoted the whole file to `unknown`; it is now a warning only. ELF files without section headers now warn that libraries and symbols are unavailable instead of silently returning none.
- fix: files the JS parser cannot handle (for example pathological nesting) were silently skipped; results now include `skippedFiles`.
- fix: file reads open once and check size on the same descriptor (no stat-then-read race). `includeStrings` no longer returns strings from files that are not a recognized binary format.
- chore: not changed. The `.asar` scratch directory is still not deleted after extraction. `validatePath` accepts any absolute path, so a caller can point the tools at any readable file; output is screened and clipped, but this is a read primitive by design.

## 0.4.0 — 2026-10-22

- feat: Phase 4 per ADR-0005 — `rure_analyze_evm` takes inline hex or a file of hex/raw bytecode and returns an aligned-disassembly inventory: dispatcher function selectors (names only for a small well-known table), hazardous-opcode counts and offsets (`SELFDESTRUCT`, `DELEGATECALL`, `CALLCODE`, `CREATE`/`CREATE2`, `ORIGIN`, `CALL`, `STATICCALL`), embedded `PUSH20` addresses, event topics before `LOG1`-`LOG4`, EIP-1167 minimal-proxy detection, solc/IPFS metadata trailer, and embedded strings such as revert reasons (AIDefence-screened).
- feat: no EVM interpreter, no RPC, no network. `PUSH` immediates are skipped as data, so operand bytes that look like opcodes are never counted.
- feat: input hardening — 256 KiB cap, strict hex validation, exactly one source per call, truncated trailing `PUSH` clamped.
- chore: measured on random bytes: 0.59 ms for a 24 KiB (EIP-170-size) input, 5.4 ms for the 256 KiB cap.
- chore: validated on hand-assembled bytecode only. No real compiler output was available to test against, so dispatcher and metadata handling on production contracts is unverified; optimized or hand-written dispatchers may be missed.

## 0.3.0 — 2026-10-22

- feat: Phase 3 per ADR-0004 — `rure_analyze_dotnet` reads a managed assembly's ECMA-335 metadata: runtime version, assembly identity and references, type names, method count, P/Invoke imports (native module + function), `#US` string literals and entry-point token. Original pure-TypeScript reader, no dependency, no IL decoding, never loads or runs the assembly.
- feat: row layouts for all 45 metadata tables are encoded so the reader can locate the tables it needs; table extents are validated against the `#~` stream size before any row is read, and lists and strings are capped.
- chore: validated against three genuine Microsoft-built assemblies (PSReadLine Pager and Polyfiller DLLs): names, versions, references and string literals matched. None of them use P/Invoke, so that path is covered by a hand-built fixture only.
- chore: not covered — IL disassembly, decompilation, signature-blob decoding, resources, obfuscated metadata.

## 0.2.0 — 2026-10-22

- feat: Phase 2 per ADR-0003 — `rure_analyze_binary` inspects ELF, PE and Mach-O containers (format, architecture, entry point, sections, linked libraries, imported/exported symbols, optional strings) with an original pure-TypeScript parser. No disassembler, no new dependency, never loads or executes the target.
- feat: hostile-input handling — every read is bounds-checked, tables are capped (4096 sections, 2000 symbols, 200 strings), files over 128 MiB are refused, and a failure in one structure is a warning while the rest still parses.
- feat: library, symbol and string text passes through the AIDefence gate; flagged values are redacted and counted.
- chore: measured on a 64 MiB synthetic image (`scripts/benchmark.ts`): header parse 0.3 ms (it reads headers, not the whole file); worst-case full string scan 118 ms (~540 MiB/s).
- chore: Mach-O reports linked libraries but not imported symbols; fat binaries report all architectures with details from the first slice only.

## 0.1.0 — 2026-10-22

- feat: Phase 1 ships — JS/Electron static analysis only, per ADR-0001/ADR-0002. Three MCP tools: `rure_extract_asar`, `rure_analyze_js_app`, `rure_find_feature`.
- feat: resource-capped `.asar` extraction via `@electron/asar`, pre-checking the archive header's declared size/file count before writing anything (decompression-bomb guard), never writing into a path derived from archive entry names.
- feat: AST-based module analysis via the TypeScript compiler API (already a workspace dependency, no new parser added) — import/export graph, Electron process-boundary detection (`ipcMain`/`ipcRenderer`/`contextBridge`, `require("electron")`, `nodeIntegration` flags), every finding evidence-sourced to a file + line range.
- feat: deterministic lexical/structural feature search (`rure_find_feature`), explicitly not semantic/LLM-based matching, so Phase 1 results stay explainable.
- feat: every extracted string routed through the AIDefence content gate before returning to the caller; a flagged snippet is redacted, never silently dropped.
- chore: `scripts/smoke.mjs` independently verifies the "parses, never executes" claim (greps the real source for `eval`/`vm`/`child_process`/dynamic `require`, comments stripped first so the doc comment describing the property can't trip its own check) and that the AIDefence gate and resource caps are actually wired into the tool handlers, not just declared.
- chore: measured parse throughput on a synthetic Electron-shaped bundle (`scripts/benchmark.ts`): ~3.6k files/s cold, ~18k files/s warm, on a 500-module synthetic app. First real measurement — not a marketing number, matches this repo's convention of reporting only numbers actually reproduced in-tree.
- chore: trust tier is experimental, not core. Marketplace/directory submission is a separate, explicit decision — not part of this release.

Explicitly out of scope for 0.1.0, each deferred to its own future ADR per ADR-0001: native binary disassembly, .NET decompilation, dynamic/live website analysis, Frida dynamic instrumentation, EVM bytecode analysis.
