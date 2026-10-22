# Changelog: ruflo-rure

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets. Built from git history; see `git log -- plugins/ruflo-rure` for the full record.

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
