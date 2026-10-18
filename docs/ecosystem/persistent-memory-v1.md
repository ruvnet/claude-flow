# Persistent memory and vector retrieval starter v1

This repository-owned consumer composes `@claude-flow/memory@3.0.5`, `sql.js@1.15.0`, `ruvector@0.2.41` and native `@ruvector/core@0.1.33`. It saves content and supplied vectors in SQLite, exits, then loads those saved entries in a new process. RuVector builds a fresh namespace-scoped index and returns IDs that are resolved back to saved memory.

SQLite is the source of truth; the vector index is a disposable projection. No artificial dependency edge is added to the published packages. This is an application-composed workflow, not a claim that the memory package automatically uses RuVector or AgentDB. The actual `agentdb` runtime is not exercised by this example.

## Reproduce from a checkout

Use Node 22 or 24 on Linux x64 with the native binding available. CI is configured for both versions; the recorded local proof uses Node 24.19.0. Lifecycle scripts are disabled. The WASM file is resolved locally, not downloaded from a CDN during the workflow.

```bash
proof_dir=$(mktemp -d)
npm install --prefix "$proof_dir" --ignore-scripts --no-audit --no-fund --save-exact \
  @claude-flow/memory@3.0.5 ruvector@0.2.41 @ruvector/core@0.1.33 sql.js@1.15.0
export RUFLO_MEMORY_RESOLVE_FROM="$proof_dir/package.json"
export RUFLO_MEMORY_REQUIRED=1
node --test scripts/tests/ecosystem-memory-installed.test.mjs

printf '%s' '{"records":[{"key":"release-check","content":"Keep signed release gates enabled","vector":[1,0,0]}]}' |
  node scripts/ecosystem-memory.mjs write "$proof_dir/memory.sqlite" demo
# A separate process, with no original content passed to it:
printf '%s' '{"vector":[1,0,0],"k":1}' |
  node scripts/ecosystem-memory.mjs retrieve "$proof_dir/memory.sqlite" demo
```

For the complete umbrella consumer, point `RUFLO_MEMORY_RESOLVE_FROM` at its package.json instead. No extra runtime dependency is added by this source change. Exact direct versions are asserted; transitive resolution may change, so retain the consumer lock and tarball integrity receipt for each measurement.

## Acceptance and boundaries

The integration test creates unpredictable content in the parent, passes it only to the writer, waits for successful exit, then starts readers without that content or its ID. It verifies persisted content and IDs, vector ranking against a distractor, exclusion of a closer vector in another namespace, repeated restart, an empty namespace, corrupt/missing state, invalid vector dimensions, missing resolution and rejection of nonnative fallback. A missing required dependency fails instead of becoming a passing skip.

This is a trusted-local, single-writer starter, not an arbitrary-file service or multi-tenant authorization boundary. Keep the database directory private. Writes append records; use unique keys. Limits are 1 MiB CLI input, 1,000 records per batch/scoped index, 4,096 dimensions and 64 MiB database on retrieval. No crash-atomic persistence, concurrent writer safety, encryption, deletion workflow, native-index persistence or cross-platform cleanup guarantee is established. Supplied three-dimensional fixture vectors test plumbing and ranking, not natural-language embedding quality. Native cleanup is locally verified only on Linux.

## Retention and rollback

The fixed payload reference remains `data/npm-download-benchmark.latest.json`; the last accepted local candidate receipt remains `data/npm-slim-opt-in.latest.json`. Fresh paired revalidation is recorded separately, not substituted for either baseline. These unsigned dependency fixtures are not final release validation.

### October 18, 2026 revalidation

| Measure | Baseline fixture | Candidate fixture |
| --- | ---: | ---: |
| Fresh-cache registry tarball payload | 522,159,201 bytes | 412,781,888 bytes |
| Observed installation time | 50.225 seconds | 47.178 seconds |
| Restart/retrieval task | Pass | Pass |
| Observed restart/retrieval time | 94.077 ms | 110.968 ms |

The earlier 109,377,313-byte saving (20.947%) is retained, not counted as a second gain. All 538 retained tarballs and retained package versions/integrities match; none was added. Install time differs by -3.047 seconds and the single retrieval observation by +16.891 ms; neither establishes a latency improvement or regression. Caches were fresh with lifecycle scripts disabled, but CDN state and concurrent validation load were not controlled.

67 Node contracts, 15 Python collector tests and five installed integration tests passed with no skips. Two source-bound loop cycles each passed all eight registered checks. [Source hashes, versions, measurements and limitations](../../data/ecosystem-memory-restart.validation.json) preserve the evidence. Hosted Node 22/24 CI and signed final release validation remain pending.

The new capability is `persistent-memory-retrieval`. All three inventory packages were already covered by contracts: total package coverage remains 10/401, while integration-covered packages increase from 3 to 5 and registered checks from 7 to 8. `sql.js` is outside the captured ecosystem inventory; its real use is recorded without changing that inventory.

Rollback removes this starter, its registry entry and the CI memory step; preserve consumer SQLite files. Package dependency declarations and release authority are unchanged. Next: crash-safe persistence, update/delete consistency and actual agent execution against retrieved memory, each with independent acceptance evidence.
