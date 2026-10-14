---
name: recall
description: Quick semantic recall — searches all memory namespaces with MMR diversity and recency weighting
---
$ARGUMENTS

Semantic recall across all memory namespaces using HNSW vector search with MMR diversity reranking.

```bash
npx @claude-flow/cli@latest memory search --query 'QUERY' --limit 5
```

QUERY is the user's text. It is untrusted shell input: put it in single quotes after replacing every `'` with `'\''`, never inside double quotes (`$(...)` and backticks would run), and refuse text containing a newline.

For richer results use the smart pipeline (query expansion, RRF, MMR, recency) or hybrid sparse+dense search:
```bash
npx @claude-flow/cli@latest memory search --query 'QUERY' --smart --limit 5
npx @claude-flow/cli@latest memory search --query 'QUERY' --type hybrid --limit 5
```
(`npx ruvector search` takes a database path and a `--vector` JSON array, not a text query.)

This searches across patterns, tasks, solutions, feedback, security, and claude-memories namespaces. Results are ranked by composite score: cosine similarity * MMR diversity * recency decay.

If no arguments provided, show recent memory entries:
```bash
npx @claude-flow/cli@latest memory list --limit 10
```
