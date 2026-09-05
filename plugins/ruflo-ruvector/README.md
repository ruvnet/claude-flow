# ruflo-ruvector

Self-learning vector database powered by [`ruvector@0.2.25`](https://www.npmjs.com/package/ruvector) — HNSW, Adaptive LoRA embeddings, hooks-based intelligence, SONA self-optimizing patterns, brain (collective knowledge), and 91 MCP tools (verified via `ruvector mcp tools`).

> **Pinned version:** this plugin targets `ruvector@0.2.25`. Earlier 0.1.x versions are missing several commands (`brain`, `route`, `sona`); some legacy docs referenced 2.x features that do not exist on npm. Always invoke with the pin.

## Overview

Wraps the `ruvector` npm package as a Ruflo plugin, providing vector embedding, semantic search, code-graph clustering, hyperbolic projection, self-learning hooks, and SONA / Brain diagnostics. ruvector's Rust backend delivers sub-millisecond queries and 52,000+ inserts/sec.

## Prerequisites

```bash
# Required
npm install ruvector@0.2.25

# Optional add-ons (install as needed)
npm install ruvector-onnx-embeddings-wasm   # required for `embed text` to work
npm install @ruvector/pi-brain              # required for `brain` subcommands
npm install @ruvector/ruvllm                # required for `sona` subcommands (JS fallback)
```

Run a health check:
```bash
npx -y ruvector@0.2.25 doctor
```

## Installation

```bash
claude --plugin-dir plugins/ruflo-ruvector
```

## MCP Integration (91 Tools)

Register with the pinned version:
```bash
claude mcp add ruvector -- npx -y ruvector@0.2.25 mcp start
```

Key tool categories: hooks routing, AST analysis, diff classification, coverage routing, graph clustering, security scanning, RAG context, brain knowledge, SONA learning.

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `vector-engineer` | sonnet | Embedding, HNSW indexing, code-graph clustering, hyperbolic projection, hooks routing, brain/SONA |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `vector-setup` | `/vector-setup [--full]` | First-run installer: pins `ruvector@0.2.25`, adds ONNX/Brain/SONA/router add-ons, registers MCP, runs `doctor` |
| `vector-embed` | `/vector-embed <text>` | ONNX embeddings (384-dim) via `embed text` |
| `vector-cluster` | `/vector-cluster <files...>` | Spectral/Louvain code-graph clustering via `hooks graph-cluster` |
| `vector-hyperbolic` | `/vector-hyperbolic <text>` | Standard ONNX embed + Poincare projection in user code |

## Commands (`/vector` slash command)

The full surface is documented in `commands/vector.md` (80+ subcommands). Quick reference:

```bash
# Embedding
/vector embed <text>                 # ruvector embed text "<text>"
/vector embed-adaptive <text>        # ruvector embed text "<text>" --adaptive --domain code
/vector embed-file <path>            # read file, pass content as text
/vector embed-benchmark              # ruvector embed benchmark

# Database lifecycle
/vector db create <path>             # ruvector create <path> -d 384 -m cosine
/vector db stats <path>              # ruvector stats <path>
/vector insert <db> <json>           # ruvector insert <db> <json>
/vector search <db> <vector-json>    # ruvector search <db> -v <json> -k N
/vector export <db>                  # ruvector export <db> -o backup.json
/vector import <file>                # ruvector import <file> -d <database>

# RVF cognitive containers (45 example stores)
/vector rvf create|ingest|query|status|segments|derive|compact|export|examples|download

# GNN + attention (real native bindings)
/vector gnn info|layer|search|compress
/vector attention list|compute|benchmark|hyperbolic|info

# Code intelligence (hooks)
/vector ast <file>                   # ruvector hooks ast-analyze <file>
/vector hooks ast-complexity <files...>
/vector hooks coverage-route <file> | coverage-suggest <files...>
/vector hooks rag-context <query>
/vector hooks route|route-enhanced|suggest-context
/vector cluster <files...>           # ruvector hooks graph-cluster <files>
/vector hooks security-scan <files...>
/vector hooks diff-analyze|diff-classify|diff-similar [commit]
/vector hooks remember|recall <query>
/vector hooks coedit-record|coedit-suggest|error-record|error-suggest
/vector hooks trajectory-begin|trajectory-step|trajectory-end

# Native + workers
/vector native list|run <type>|benchmark|compare
/vector workers triggers|presets|phases|dispatch|status|...

# Collective intelligence
/vector brain status|search|share|list|drift|partition|transfer|sync|page  (needs @ruvector/pi-brain)
/vector sona status|info|stats|patterns|train|export                       (needs @ruvector/ruvllm)
/vector llm models|embed|benchmark|info                                    (needs @ruvector/ruvllm)

# Identity + edge compute (pi network)
/vector identity generate|show|export|import
/vector edge status|balance|tasks|join|dashboard

# Server / decompile / demo / system
/vector server [-p 8080] [-g 50051]
/vector decompile <npm-pkg-or-file-or-url>
/vector demo --basic | --gnn | --graph
/vector doctor | info | benchmark | install | setup
```

## End-to-End Example: store + search project files

```bash
# 0. One-time setup
/vector-setup

# 1. Create a database
npx -y ruvector@0.2.25 create project.db -d 384 -m cosine

# 2. Embed every TypeScript source file (loop — no built-in --batch)
mkdir -p .vec
for f in $(find src -name '*.ts'); do
  npx -y ruvector@0.2.25 embed text "$(cat "$f")" -o ".vec/${f//\//_}.json"
done

# 3. Insert all embeddings (assumes a JSON array of {id, vector, metadata})
jq -s '[.[] | {id: input_filename, vector: .vector}]' .vec/*.json > corpus.json
npx -y ruvector@0.2.25 insert project.db corpus.json

# 4. Search by query embedding
QV=$(npx -y ruvector@0.2.25 embed text "JWT refresh-token rotation" --output -)
npx -y ruvector@0.2.25 search project.db -v "$QV" -k 5

# 5. Inspect index health
npx -y ruvector@0.2.25 stats project.db
```

For an alternative store format with lineage tracking, replace steps 1–3 with:
```bash
npx -y ruvector@0.2.25 rvf create project.rvf
npx -y ruvector@0.2.25 rvf ingest project.rvf < corpus.json
npx -y ruvector@0.2.25 rvf query project.rvf
```

## Capabilities (ruvector@0.2.25, verified)

| Feature | CLI | Notes |
|---------|-----|-------|
| HNSW search | `search <db> -v ... -k N` | ~0.045ms latency |
| Adaptive LoRA embeddings | `embed text "..." --adaptive --domain code` | LoRA-tuned |
| Distance metrics | `create <path> -m cosine\|euclidean\|dot` | set at create time |
| RVF cognitive containers | `rvf create|ingest|query|derive|compact` | 45 example stores via `rvf examples` |
| Attention mechanisms | `attention list` | DotProduct, MultiHead, Flash, Hyperbolic, Linear, MoE, GraphRoPe, EdgeFeatured, DualSpace, LocalGlobal |
| GNN ops | `gnn layer|search|compress` | multi-head attention layers, differentiable search, tensor compression |
| Code-graph clustering | `hooks graph-cluster <files>` | spectral / Louvain |
| Diff embeddings | `hooks diff-analyze|diff-classify|diff-similar` | git-aware |
| Coverage-aware routing | `hooks coverage-route|coverage-suggest` | test-gap-aware |
| RAG context | `hooks rag-context "query"` | works in CLI and MCP |
| AST analysis | `hooks ast-analyze|ast-complexity` | symbols, complexity, parse time |
| Self-learning loop | `hooks remember|recall|coedit-*|error-*|trajectory-*` | persistent intelligence |
| Native workers | `native list|run <security|analysis|learning>` | no external deps |
| Background workers | `workers dispatch|status|presets|phases` | first run installs `agentic-flow` |
| Decompile npm/JS | `decompile <target>` | inspect upstream packages |
| Server | `server -p 8080` | HTTP/gRPC mode |
| Demo | `demo --basic|--gnn|--graph` | interactive tutorial |
| Identity (pi key) | `identity generate|show|export|import` | for brain + edge |
| Edge compute | `edge status|balance|tasks|join` | distributed, rUv currency |

### Known limitations / bugs in 0.2.25

| Issue | Detail | Workaround |
|-------|--------|-----------|
| ONNX runtime missing | `embed text` → `ONNX WASM files not bundled` | `npm i ruvector-onnx-embeddings-wasm` (see `/vector-setup`) |
| `optimize` | Self-reports "not yet shipped in this release" | none — track upstream issue 401 |
| `hooks force-learn` | TypeError `intel.tick is not a function` | run a real trajectory via `trajectory-begin/step/end` |
| `hooks graph-mincut` | `Cannot read properties of undefined (reading 'length')` | use `hooks graph-cluster` |
| `hooks git-churn` | Fails outside a git repo | run from inside the repo |
| `benchmark` | Some installs fail with `Missing field 'dimensions'` | use `attention benchmark` or `gnn search` benchmarking |
| `cluster` (top-level) | `Status: Coming Soon` | use `hooks graph-cluster` |
| `compare`, top-level `index`, `midstream`, `embed --file/--batch/--glob/--model poincare` | Don't exist | see `commands/vector.md` for replacements |

## Self-Learning Hooks

```bash
# Full pretrain pipeline + agent generation
npx -y ruvector@0.2.25 hooks init --pretrain --build-agents quality

# Smart agent routing (positional task!)
npx -y ruvector@0.2.25 hooks route "implement OAuth flow"
npx -y ruvector@0.2.25 hooks route-enhanced "fix CVE-2025-1234"

# Code analysis (positional file!)
npx -y ruvector@0.2.25 hooks ast-analyze src/module.ts
npx -y ruvector@0.2.25 hooks diff-analyze HEAD
npx -y ruvector@0.2.25 hooks coverage-route src/module.ts
npx -y ruvector@0.2.25 hooks security-scan src/
```

## Brain (Collective Knowledge)

```bash
npm install @ruvector/pi-brain   # required dependency

npx -y ruvector@0.2.25 brain status
npx -y ruvector@0.2.25 brain search "authentication patterns"
npx -y ruvector@0.2.25 brain list
npx -y ruvector@0.2.25 brain drift code   # knowledge drift for a domain
```

## SONA (Self-Optimizing Neural Architecture)

```bash
npx -y ruvector@0.2.25 sona status
npx -y ruvector@0.2.25 sona patterns "auth refactor"
npx -y ruvector@0.2.25 sona stats
```

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| HNSW search | ~0.045ms | 8,800x vs ONNX inference |
| Memory cache | ~0.01ms | 40,000x vs ONNX inference |
| Insert | 52,000+/sec | Rust backend (`@ruvector/core`) |
| Memory per vector | ~50 bytes | Efficient storage |

## Known Caveats

- **ONNX runtime not bundled by default** — `embed text` will report `ONNX WASM files not bundled` until you install `ruvector-onnx-embeddings-wasm`.
- **No `--file`, `--batch`, `--glob`, `--namespace`, `--k`, `--task`, `--model poincare` flags** — these were in older docs but never shipped in 0.2.25. See `agents/vector-engineer.md` for the replacement table.
- **`brain` requires `@ruvector/pi-brain`** — install separately.
- **`sona` requires `@ruvector/ruvllm`** — install separately (the native binding is not always present in the npm tarball).
- **Top-level `cluster` is "Coming Soon"** — for actual clustering use `hooks graph-cluster <files>`.
- **`compare`, `midstream`, top-level `index` subcommands do not exist.**

## Architecture Decisions

- [`ADR-0001` — Pin ruflo-ruvector to ruvector@0.2.25 with optional add-ons](./docs/adrs/0001-pin-ruvector-0.2.25.md)

## Smoke test

```bash
bash plugins/ruflo-ruvector/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
```

## Related Plugins

- `ruflo-agentdb` — HNSW storage backend in AgentDB
- `ruflo-intelligence` — SONA pattern learning integration
- `ruflo-knowledge-graph` — Graph RAG for multi-hop retrieval
- `ruflo-rag-memory` — Simple semantic search via ruvector

## License

MIT
