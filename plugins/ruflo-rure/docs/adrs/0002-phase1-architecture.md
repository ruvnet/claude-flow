# ADR-0002: Phase 1 technical architecture (JS/Electron static analysis)

Status: Proposed

## Context

ADR-0001 scopes Phase 1 to JavaScript/Electron static analysis with a parse-only security boundary. This ADR fixes the concrete implementation choices so Phase 1 ships without adding avoidable dependency or security surface.

## Decision

**Parsing: the TypeScript compiler API, not a new parser dependency.** `typescript` is already a workspace-wide dependency across this monorepo (root, `@claude-flow/cli`, `v3`). `ts.createSourceFile` parses JavaScript, JSX, TypeScript, and TSX with one well-maintained, already-present library, instead of adding `@babel/parser` or `acorn` as a new first-party dependency. This keeps ruRE's own supply-chain surface smaller than REA's.

**Unpacking: `@electron/asar` (MIT, Electron-official, actively maintained, verified on the npm registry at the time of writing).** Used only to unpack `.asar` archives to a scratch directory; ruRE never re-packs. Unpacking is capped: a configured maximum total unpacked size and maximum per-file size, enforced by checking archive-reported sizes before writing and aborting over the cap, as a decompression-bomb guard. Output path is always a ruRE-owned temp directory under the plugin's scratch root — never a path derived from archive entry names — closing the zip-slip class of bug at the design level, not just by trusting the library.

**Phase 1 MCP tool surface (three tools, matching REA's own granularity):**

1. `rure_extract_asar(path: string) -> { unpackedPath, fileCount, totalBytes, truncated }` — unpacks an `.asar` file to a scratch directory under the resource caps above. `truncated: true` if the cap was hit; the tool never partially trusts a truncated extraction as complete.
2. `rure_analyze_js_app(path: string) -> { modules, imports, exports, electronBoundaries, evidence }` — walks a directory (or the output of tool 1) of `.js`/`.mjs`/`.cjs`/`.ts`/`.tsx` files, parses each with `ts.createSourceFile`, and reports: module list, import/export graph, and Electron process-boundary detection (presence of `require('electron')`, `ipcMain`/`ipcRenderer`/`contextBridge` usage, main-vs-renderer heuristics). Every claim in the output carries `evidence`: the exact file path and 1-indexed line range it was derived from — never an unsourced assertion, matching REA's own evidence-first design.
3. `rure_find_feature(path: string, query: string) -> { matches: [{ file, lineRange, snippet, score }], evidence }` — a bounded text/identifier search over the already-analyzed module graph (not a second full parse pass) to locate where a described feature likely lives. This is deliberately a search over structural + lexical signals, not semantic/LLM-based matching, so Phase 1 stays deterministic and auditable.

**Mandatory security gate before any output reaches model synthesis.** Every string literal, comment, and identifier ruRE extracts is untrusted content from an analyzed target the user may not control. Before `rure_analyze_js_app` or `rure_find_feature` return their `snippet`/evidence text, that text is routed through the same `aidefence_scan` gate `ruflo-browser:browser-extract` already uses. A flagged snippet is replaced with a redaction marker plus the flag reason in the tool output — it is never silently dropped (the caller needs to know analysis was redacted) and never passed through unredacted.

**No execution, anywhere.** Nothing in Phase 1 calls `eval`, `vm`, `child_process`, or dynamically `require()`s analyzed code. The only operations performed on target files are: read, parse-to-AST, inspect-AST. This is the literal enforcement of ADR-0001's "parses, never executes" rule, not just a description of intent — it is a thing `scripts/smoke.mjs` can grep for and assert, the same way `plugins/ruflo-ai-team/scripts/smoke.mjs` greps its own hooks for forbidden `child_process`/`fetch` calls.

**File layout:**

```
plugins/ruflo-rure/
├── .claude-plugin/plugin.json
├── src/
│   ├── extract-asar.ts
│   ├── analyze-js-app.ts
│   ├── find-feature.ts
│   ├── ts-walk.ts            # shared TS-compiler-API AST walking helpers
│   └── aidefence-gate.ts     # wraps aidefence_scan for all extracted text
├── skills/analyze-app/SKILL.md
├── commands/rure-analyze.md
├── agents/reverse-engineer.md
├── docs/adrs/0001-*.md, 0002-*.md
├── scripts/smoke.mjs
├── tests/
└── directory/                # built only once Phase 1 is ready for marketplace submission (ADR-0001)
```

## Consequences

Phase 1 adds exactly two new runtime dependencies beyond what the monorepo already carries (`@electron/asar` for unpacking; `typescript`'s compiler API is already present). The evidence-first, redact-don't-drop, parse-never-execute design makes the security properties this ADR claims independently checkable by `scripts/smoke.mjs` rather than only documented. Later phases (native binary, .NET, EVM, Frida) each need their own ADR before touching this surface, per ADR-0001.
