# ADR-170 — CLI Cold-Start Optimization: Lazy Tool Registry, Entrypoint Split, and Startup Hazard Fixes

**Status**: Proposed (2026-07-02)
**Date**: 2026-07-02
**Authors**: claude (drafted with rUv)
**Parent**: ADR-167 (ruflo npm deep review)
**Related**: issues #1552, #1641, #1653, #2253, #2256; ADR-095 (G7 exports patch — found dead, wired here)

## Context

Measured 2026-07-02 on a fresh full install: `ruflo --version` 40–97 ms (the #2256 fast
path works), but `ruflo --help` takes **1.5–3.7 s** and `ruflo status` ~1.4 s — the
documented `<500 ms` startup target is missed 3–7× by every real invocation.

Where the time goes (all paths relative to `v3/@claude-flow/cli`):

1. **Eager parse of ~45k LOC on every invocation.** `src/index.ts:22` statically imports
   `commands/index.js`, which — despite the PERF-03 lazy-loading infrastructure —
   synchronously imports 10 command modules (~15k LOC; `commands/hooks.ts` alone is
   5,361). Nine of the ten import `mcp-client.ts`, which statically imports **~40 MCP tool
   modules (~27.4k LOC)** (`src/mcp-client.ts:14-68`). `index.ts` additionally re-exports
   `memory/*`, `mcp-server.js`, and `production/*` for programmatic consumers, binding the
   bin path to the library surface.
2. **`--help` is near-worst-case**: `showHelp()` → `getCommandsByCategory()`
   (`src/commands/index.ts:238-256`) `Promise.all`-loads 26 *additional* lazy command
   modules just to print names and descriptions. The comment at `bin/cli.js:113-117`
   claiming a fast help path is wrong — none exists. MCP stdio mode skips the CLI but
   still parses all 40 tool modules via `mcp-client`.
3. **Wrapper fast-path coverage** (`ruflo/bin/ruflo.js:16-27`): only exact
   `--version`/`-V` as the sole argument. `--help`, `-h`, and `--version` combined with
   any other flag pay the full graph.
4. **Startup auto-update can synchronously run `npm install`.**
   `checkForUpdatesOnStartup` (`src/index.ts:483-509`) runs on every command inside an
   *unawaited* promise; with `DEFAULT_CONFIG.autoUpdate.patch = true`
   (`update/checker.ts:36`) it auto-applies patch updates via **`execFileSync('npm',
   ['install', ...])`** (`update/executor.ts:131-133`) — a blocking global install racing
   the `process.exit(0)` teardown. Outcomes are nondeterministic: usually killed mid-fetch,
   occasionally a random command stalls for the length of an npm install.
5. **`process.exit(0)` as teardown** (`ruflo/bin/ruflo.js:66-72`, `bin/cli.js:303-309`):
   papers over live handles (HNSW VectorDb singleton, sql.js WASM, ONNX worker pool have
   no `dispose()`), and is what makes hazard (4) a mid-flight kill instead of a wait.
6. **Duplicated MCP plumbing**: `bin/mcp-server.js` re-implements cli.js's JSON-RPC
   framing (~200 lines) with a *weaker* console filter — missing the stdout→stderr
   redirect of ONNX loader progress lines, i.e. the exact #2253 stdout-corruption bug the
   cli.js filter fixed.
7. **Dead postinstall code**: `scripts/postinstall.cjs` defines `augmentExports()`
   (`:95-135`, the ADR-095 G7 agentdb exports patch) but `main()` never calls it —
   consumers importing `agentdb/controllers/AttestationLog` hit Node's strict-exports
   block despite the file existing.

## Decision

### Phase 1 — Hazard fixes (small diffs, ship first)

1. **Auto-update**: never auto-install from the startup path — notify only. If
   auto-install is kept at all, gate it behind an explicit env opt-in, use async
   `execFile`, and hold process exit until the promise settles or a 2 s timeout.
2. **Wire `augmentExports`** into postinstall `main()` (one line, try/catch-wrapped).
3. **Widen the wrapper fast paths**: serve `--help`/`-h`-only invocations from a static
   help text, and relax the version guard to "argv contains `--version`/`-V` and no
   command word".
4. **MCP autodetect**: emit a one-line stderr notice when non-TTY-stdin autodetection
   selects MCP mode (`ruflo/bin/ruflo.js:53-58`), so piped invocations aren't silently
   absorbed into a stdio server.

### Phase 2 — Entrypoint split and lazy tool registry (the structural win)

1. Split `src/index.ts` into a minimal CLI-runtime entry (what the bins and
   `ruflo/bin/ruflo.js` import — the `CLI` class and arg parsing only) and a `lib` entry
   carrying the programmatic re-exports (`memory/*`, `mcp-server`, `production/*`).
   Update the `exports` map; keep the old specifiers as deep-import aliases for one minor.
2. Replace mcp-client's 40 static tool imports with the loader-map pattern already used
   for commands, keyed by tool-name prefix (`memory_*` → memory-tools, …). Emit a
   **build-time manifest** of `{name, description, inputSchema}` so `tools/list` never
   loads a handler module.
3. Convert the 10 synchronous command imports to the existing lazy mechanism
   (`registerLazyCommandName`); `hooks.ts` alone removes a third of the eager command
   weight.
4. Generate the top-level help table at build time (static JSON of name + description per
   command); `--help` renders from the manifest, loading a command module only for
   `<command> --help`.

### Phase 3 — Exit hygiene instead of `process.exit(0)`

Introduce `dispose()` registries for the HNSW VectorDb singleton and the ONNX embedder
worker pool (sql.js already closes per-call), call `worker.unref()` on embedder threads at
creation, and demote `process.exit` to a `setTimeout(2000).unref()` watchdog fallback.

### Phase 4 — Deduplicate MCP plumbing

Extract the JSON-RPC framing loop + console filter list into one shared module imported by
both `bin/cli.js` and `bin/mcp-server.js`, eliminating the filter drift that re-opens
#2253 on the mcp-server path.

## Consequences

- **Positive**: `--help` and command dispatch drop the ~45k-LOC parse to a few thousand;
  the `<500 ms` target becomes reachable on warm disk; MCP `tools/list` responds from a
  manifest without evaluating handlers; the surprise-`npm install` and truncated-output
  classes of bug disappear; agentdb deep imports work as ADR-095 intended.
- **Negative / risks**: the entrypoint split is a breaking change for programmatic
  importers of `@claude-flow/cli` root exports — mitigated by the aliased transition
  minor; build-time manifests add a codegen step that can drift if not regenerated in CI
  (add a check that regenerating produces no diff).
- **Verification**: startup benchmarks (`--version`, `--help`, `status`, MCP `initialize`
  round-trip) recorded in CI against the ADR-167 baseline; a regression gate at 500 ms for
  `--help` on the reference runner; runtime-security and smoke suites stay green.
