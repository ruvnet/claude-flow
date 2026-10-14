---
name: ruflo-memory
description: Memory CRUD — store, semantic/keyword search, retrieve, list, consolidate
---
$ARGUMENTS

Memory operations with HNSW-indexed vector search (measured ~1.9x at N=20k, ~3.2x–4.7x at N=5k vs brute force; ANN wins above the crossover).

Parse $ARGUMENTS to determine the operation:

**store** `--key KEY --value VALUE [--namespace NS]`:
`npx @claude-flow/cli@latest memory store --key "KEY" --value "VALUE" --namespace NAMESPACE`

**search** `--query QUERY [--namespace NS] [--limit N] [--hybrid] [--smart]`:
- Default (semantic): `npx @claude-flow/cli@latest memory search --query 'QUERY' --limit 5`
- Hybrid (keyword + semantic union): `npx @claude-flow/cli@latest memory search --query 'QUERY' --type hybrid --limit 5`
- SmartRetrieval (when available): `npx @claude-flow/cli@latest memory search --query 'QUERY' --smart --limit 5`

If asked for `--graph-rag`, explain that this plugin has no supported text-query Graph RAG command; offer SmartRetrieval without claiming graph hops. Treat QUERY as untrusted shell input and use POSIX single-quote escaping, rejecting newlines.

**retrieve** `--key KEY [--namespace NS]`:
`npx @claude-flow/cli@latest memory retrieve --key "KEY" --namespace NAMESPACE`

**list** `[--namespace NS] [--limit N]`:
`npx @claude-flow/cli@latest memory list --namespace NAMESPACE --limit 10`

**delete** `--key KEY [--namespace NS]`:
`npx @claude-flow/cli@latest memory delete --key "KEY" --namespace NAMESPACE`

**consolidate** `[--namespace NS]`:
Deduplicate entries with cosine > 0.92, prune stale (>30 days untouched, zero retrieval hits), rebuild HNSW index.
`npx @claude-flow/cli@latest hooks worker dispatch --trigger consolidate`

**bridge** `[--all-projects]`:
Import Claude Code auto-memory into AgentDB.
See `/memory-bridge` skill for details.

Writes default to the `default` namespace. Searches without `--namespace` cover available namespaces. Common namespaces: `patterns`, `tasks`, `solutions`, `feedback`, `security`, `claude-memories`.

If no arguments, run `memory list`.
