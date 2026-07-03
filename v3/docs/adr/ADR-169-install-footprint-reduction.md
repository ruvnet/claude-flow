# ADR-169 — Install-Footprint Reduction: Slim-by-Default, Duplicate-Tree Elimination, and the OTel Fan

**Status**: Proposed (2026-07-02)
**Date**: 2026-07-02
**Authors**: claude (drafted with rUv)
**Parent**: ADR-167 (ruflo npm deep review)
**Related**: ADR-124 (agentic-flow/xenova optional), ADR-150 (metaharness optional constraint — the pattern this ADR generalizes)

## Context

Measured 2026-07-02 (linux x64, node 22, npm 10):

| Scenario | node_modules | Packages | Install time |
|---|---|---|---|
| `npm install ruflo` | 865 MB – 1.4 GB | 640–835 | ~3 min |
| `npx -y ruflo@3.16.3` | 858 MB | 474 | — |
| `npm install ruflo --omit=optional` | **108 MB** | **154** | **~10 s** |

The variance in the full install is itself a defect: which optionals succeed differs
run-to-run (one fresh install hit an npm ENOTEMPTY race whose retry pruned 118 packages of
the agentic-flow subtree). **~92% of the default footprint is optional-dependency fan-out
that the common path never loads** — verified on the 108 MB tree: `--version`, `--help`,
`swarm status`, and `mcp start` (JSON-RPC `initialize`) all pass, and the CLI's heavy-dep
call sites are already dynamic imports with `.catch(() => null)` degradation.

Where the weight actually is:

1. **@opentelemetry/* ≈ 270 MB** (77 packages hoisted + nested copies). Root cause:
   `agentdb` declares `@opentelemetry/auto-instrumentations-node`, `sdk-node`, and OTLP
   exporters as **hard** dependencies, dragging the full instrumentation matrix (including
   `@opentelemetry/resource-detector-gcp` → `gcp-metadata` → …) into every install.
2. **Duplicate trees ≈ 250 MB**: `@claude-flow/memory` is 117 MB of which 114 MB is its
   *nested* node_modules. Version skew — not npm hoisting — is the cause:
   - `agentdb` ×4: hoisted **2.0.0-alpha.3.7** (62 MB, via `@claude-flow/aidefence`) +
     three nested 3.0.0-alpha.17 (under cli, memory, neural);
   - `ruvector` ×4: hoisted 0.2.33 (CLI's `^0.2.27`) + three 0.1.100 (agentdb's `^0.1.30`),
     each with its own 8 MB ONNX-embeddings WASM blob;
   - `better-sqlite3` ×3 (11.10.0 ×2, 12.11.1), **each compiled from source via node-gyp**
     on node 22 — the dominant install-time cost, three full SQLite C builds.
3. **Extraneous 2023-era ONNX ≈ 160 MB when present**: `onnxruntime-node@1.14.0` (93 MB)
   and `onnxruntime-web@1.14` (68 MB) arrive via `@xenova/transformers@2` pinned inside the
   agentic-flow optional chain, and the node one is left *extraneous* in the tree. The
   lighter `ruvector-onnx-embeddings-wasm` (8 MB) path already exists.
4. `hnswlib-node` (agentdb optional) is the only other source-compiler and ships **no
   prebuilds**, failing silently without a toolchain — while ruvector's per-platform NAPI
   packages (`ruvector-core-linux-x64-gnu` et al.) demonstrate the correct pattern.

## Decision

### Phase 1 — Make slim the documented default profile

1. Document `npm install ruflo --omit=optional` (108 MB, 10 s) as the supported slim
   profile in the README, and add a CI job that installs with `--omit=optional` and runs
   the smoke set (`--version`, `--help`, `swarm status`, `mcp start` initialize) so the
   slim path can never regress. This generalizes the ADR-150 "removable" constraint from
   metaharness to the entire heavy stack.
2. Add a first-run notice: when a heavy feature is requested and its module is absent
   (`MODULE_NOT_FOUND` fallback already fires), print the exact install command
   (e.g. `npm install -g agentdb ruvector` or `ruflo setup --full`) instead of a silent
   degradation.
3. Evaluate (spike, not committed here) a `ruflo setup` command that installs the heavy
   stack on demand into a user-level prefix, making `npx ruflo` itself slim.

### Phase 2 — Eliminate the duplicate trees (~250 MB)

1. Align `agentdb` to one 3.x range across `@claude-flow/{cli,memory,neural}` and fix
   `@claude-flow/aidefence` off `agentdb@2.x` (it currently imports a whole second major).
2. Align `ruvector` so agentdb accepts `^0.2.x` (or CLI and agentdb meet on one minor);
   one copy means one 8 MB WASM blob instead of four.
3. Align `better-sqlite3` on a single major with prebuilds for supported ABIs — one
   compile (or zero, given the sql.js fallback) instead of three.
4. Add a CI dedup gate: `npm ls agentdb ruvector better-sqlite3` in a fresh install must
   each resolve to exactly one version.

### Phase 3 — Cut the OTel hard-dep fan (~270 MB; upstream to agentdb)

File/land an agentdb change making `@opentelemetry/sdk-node`, exporters, and
`auto-instrumentations-node` peer/optional + lazily imported, initialized only when
tracing is configured. Until it lands, pin agentdb in @claude-flow packages to the
slimmest working release and exclude `auto-instrumentations-node` where npm permits.

### Phase 4 — Retire the 2023 ONNX chain

Upgrade the agentic-flow chain off `@xenova/transformers@2` (ADR-094 already moved the
in-repo code to `@huggingface/transformers`) or route embeddings through the existing
`ruvector-onnx-embeddings-wasm` backend; either removes the extraneous
`onnxruntime-node@1.14.0`. Drop or prebuild `hnswlib-node` (ruvector NAPI already covers
HNSW).

## Consequences

- **Positive**: default install target ≤ 150 MB (from 865 MB–1.4 GB), install time
  seconds instead of minutes, no source compiles on the common path, deterministic trees
  (the ENOTEMPTY-variance class disappears with the optional surface), lower disk cost per
  npx cache entry.
- **Negative / risks**: Phases 2–3 require coordinated publishes of memory/neural/aidefence
  and an upstream agentdb change — sequencing risk if partially applied (mitigated by the
  CI dedup gate failing loudly). Users relying on implicit availability of embeddings/HNSW
  in a slim install see an explicit install prompt instead (Phase 1.2).
- **Verification**: fresh-install size and `npm ls` single-version checks in CI; smoke set
  green on the slim profile; re-measure against the ADR-167 baseline table after each phase.
