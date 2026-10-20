---
id: ADR-0001
title: Pin ruflo-ruvector plugin to ruvector@0.3.3 with optional add-on packages
status: Accepted
date: 2026-05-04
authors:
  - reviewer (Claude Code)
tags: [plugin, ruvector, versioning, mcp, dependencies]
---

## Context

The `ruflo-ruvector` plugin wraps the `ruvector` npm package as a Claude Code plugin. The plugin's documentation (README, agent file, skills, command spec) drifted from the actual CLI surface in two ways:

1. **Aspirational features.** Older docs referenced `FlashAttention-3`, `Graph RAG`, `Hybrid Search`, `DiskANN`, `ColBERT`, `Matryoshka`, `MLA`, `TurboQuant`, `Brain AGI`, and `Midstream` as if they were invokable CLI subcommands. The native Rust bindings expose primitives for most of these, but **no CLI subcommand wires them up** — only `attention list` enumerates the mechanisms.
2. **Unspecified version.** The plugin invoked `npx ruvector ...` without a version pin, so a user with `ruvector@0.1.x` resolved would silently get a different surface (no `brain`, no `route`, no `sona`) than a user on `ruvector@0.2.x`.

Concretely, this caused:

- `npx ruvector embed "TEXT"` → `unknown command 'TEXT'` (real form is `embed text "TEXT"`)
- `npx ruvector compare A B` → command does not exist
- `npx ruvector cluster --namespace ... --k N` → `cluster` is for distributed cluster ops, not k-means
- `npx ruvector hooks route --task X` → unknown option `--task` (positional)
- `npx ruvector brain agi status` → no `agi` subgroup
- `npx ruvector midstream status` → command does not exist
- `npx ruvector index create N` → command does not exist (use `create <path>`)

A live audit against `ruvector@0.3.3` confirmed which subcommands work, which require optional add-on packages, and which are upstream bugs.

## Decision

The plugin pins to `ruvector@0.3.3` and documents the optional add-on packages required for full functionality.

### 1. Pin every CLI invocation

All `npx` calls in the plugin (README, agent, skills, commands, scripts) MUST be of the form:

```bash
npx -y ruvector@0.3.3 <subcommand> [args]
```

Rationale: the `-y` flag suppresses the npm interactive prompt; the version pin prevents a future ruvector release from breaking the plugin's contract without our knowledge.

### 2. Treat add-ons as opt-in extensions, not required deps

| Package | Enables | Plugin subcommands gated on it |
|---------|---------|------------------------------|
| `ruvector-onnx-embeddings-wasm` | ONNX runtime | `embed text`, `embed adaptive`, `llm embed` |
| `@ruvector/pi-brain` | Collective brain | `brain *` |
| `@ruvector/ruvllm` | RuvLLM + SONA JS fallback | `sona *`, `llm *` |
| `@ruvector/graph-node` | Graph database (Cypher) | `graph -q ...` |
| `@ruvector/router` | Semantic router | `router --route ...` |

Rationale: these are heavy dependencies (ONNX runtime alone is large). Forcing them at install time penalizes users who only want hooks routing or RVF storage. Instead we provide a `vector-setup` skill and document the precise error message → install command mapping.

### 3. Register MCP server with the same pin

```bash
claude mcp add ruvector -- npx -y ruvector@0.3.3 mcp start
```

Rationale: the MCP transport layer changes between minor versions of ruvector. Pinning the MCP command keeps the 103 exposed tools stable for downstream agents.

### 4. Removed surface stays removed

The plugin MUST NOT reintroduce the following invocations even if upstream re-adds equivalents under different names without prior coordination:

- `compare`, `midstream`, top-level `index` (replaced by `create <path>` / `stats <path>`)
- `embed --file`, `embed --batch --glob`, `embed --model poincare` (no equivalent flags exist)
- `cluster --namespace --k` (replaced by `hooks graph-cluster <files>`)
- `hooks route --task`, `hooks ast-analyze --file` (use positional arguments)
- `brain agi *` (replaced by `brain status`, `brain search`, etc.)

A future ADR may relax this if upstream introduces a stable equivalent and we update the smoke test accordingly.

### 5. Smoke test as the contract

`scripts/smoke.sh` verifies the contracted surface against any installed `ruvector@0.3.3`. It must remain green on every plugin change. Tests cover:

- Version pin (`--version` returns `0.3.3`)
- Top-level subcommand visibility (`hooks`, `embed`, `rvf`, `attention`, `gnn`, `brain`, `sona`, `create`, `stats`, `search`, `insert`)
- `hooks route` accepts a positional task argument
- `hooks ast-analyze` accepts a positional file argument
- `hooks ast-complexity`, `attention list`, `rvf examples`, `gnn info`, `info`, `doctor` work
- Removed surface (`compare`, `midstream`, `index`) returns `unknown command`

### 6. Plugin version policy

The plugin's own `version` field in `.claude-plugin/plugin.json` is bumped (patch) on every change to the CLI contract — regardless of whether the change is additive (new subcommand exposed) or a fix. This makes plugin version differences observable to downstream consumers.

## Consequences

**Positive:**

- Every documented invocation in the plugin matches a real CLI surface that is verified by a smoke test.
- New users hit a deterministic `vector-setup` flow instead of cryptic ONNX/Brain/SONA errors.
- Future ruvector releases can be evaluated by running the smoke test against the new version before bumping the pin.
- The "Capabilities" table in README is now a contract, not a wishlist.

**Negative:**

- Bumping the pin requires a deliberate test pass. New ruvector features land in the plugin only after a manual review.
- Add-on packages (`ruvector-onnx-embeddings-wasm`, `@ruvector/pi-brain`, `@ruvector/ruvllm`) must be installed manually or via `/vector-setup`. Users who skip this and try `embed text` will hit the documented error.

**Neutral:**

- The plugin's "Search Capabilities" feature table now reflects the actual CLI surface. FlashAttention-3 et al. are listed under `attention list` rather than as standalone search modes.

## Verification

```bash
# Plugin contract check
bash plugins/ruflo-ruvector/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
```

## Related

- `commands/vector.md` — full subcommand mapping
- `skills/vector-setup/SKILL.md` — first-run installer
- `agents/vector-engineer.md` — agent contract with replacement table
- Upstream issue 401 (`optimize` not yet shipped)

## Addendum (2026-10-14) — pin moved to ruvector 0.3.3 (#4158)

The 0.2.25 pin shipped without `dist/core/onnx/pkg`, so `embed text` failed
with `ONNX WASM files not bundled` and the documented remedy
(`ruvector-onnx-embeddings-wasm`) did not fix it. 0.3.3 bundles the wasm; in a
throwaway prefix `embed text` returned a 384-dim vector with no add-on. The pin
is now `ruvector@0.3.3` and the ONNX add-on is no longer installed or
documented. Also re-verified on 0.3.3: `optimize` and `hooks force-learn` run,
`midstream` exists, `embed text` takes `--stdin`/`--input-file`, `hooks
graph-mincut` still fails, `compare` still does not exist, `mcp tools` lists 97.
`@ruvector/pi-brain` is still needed for `brain`; `sona` falls back to JS. The
filename keeps the original number so links stay valid.
