---
name: vector-embed
description: Generate embeddings via npx ruvector@0.3.3 embed text (ONNX all-MiniLM-L6-v2, 384-dim), normalize, and store in HNSW index
argument-hint: "<text-or-file>"
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search
---

# Vector Embed

Generate and store vector embeddings using the `ruvector` npm package.

## When to use

Use this skill to embed text, code, or documents into 384-dimensional vectors for semantic search, similarity comparison, or clustering. ruvector uses ONNX all-MiniLM-L6-v2 with HNSW indexing (52,000+ inserts/sec, ~0.045ms search).

## Steps

1. **Ensure ruvector@0.3.3 is available**:
   ```bash
   npm ls ruvector 2>/dev/null | grep '0.3.3' || npm install ruvector@0.3.3
   ```
   ruvector 0.3.3 bundles the ONNX runtime; no add-on is needed. If `embed text` reports `ONNX WASM files not bundled`, an older ruvector (0.2.x) is being resolved — rerun with the pinned `npx -y ruvector@0.3.3`.
2. **Embed the input** (use the `text` subcommand, with text as a positional arg):
   - Single string: `npx -y ruvector@0.3.3 embed text "your text here"`
   - With output file: `npx -y ruvector@0.3.3 embed text "your text here" -o vec.json`
   - For a file: read its content via the Read tool, then pass it as the positional argument.
   - For batch: loop over files in shell — ruvector@0.3.3 has no built-in `--batch`/`--glob` flags.
3. **Adaptive (LoRA) variant**: `npx -y ruvector@0.3.3 embed text "..." --adaptive --domain code`
4. **Confirm** — report vector dimension (384), norm, and any output path written.
5. **Store metadata** in AgentDB if needed:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "embed-SOURCE", value: "VECTOR_METADATA", namespace: "vector-patterns" })`

## MCP alternative

Register the MCP server once with the pinned version:
```bash
claude mcp add ruvector -- npx -y ruvector@0.3.3 mcp start
```
Then call MCP tools directly: `hooks_rag_context` (semantic context), `brain_search` (collective brain), `hooks_ast_analyze`, `hooks_route`.

## Caveats

- The `embed --batch --glob` flags do **not** exist in ruvector@0.3.3. `embed text` accepts one text, `--stdin`, or `--input-file <path>` (keeps sensitive text off argv); call it per file.
- If embedding fails, run `npx -y ruvector@0.3.3 doctor` to diagnose.
