# Persistent memory lifecycle starter v2

Write a record, retrieve it after process exit, revise its content and vector, retrieve the revision after restart, delete it, and verify absence in another process. This uses real `@claude-flow/memory@3.0.5`, `sql.js@1.15.0`, `ruvector@0.2.41` and native `@ruvector/core@0.1.33`. SQLite is authoritative; each retrieval rebuilds a scoped native vector projection. No package dependency edge is invented.

## Reproduce

From a checkout, use Node 22 or 24 on Linux x64:

```bash
consumer=$(mktemp -d)
npm install --prefix "$consumer" --ignore-scripts --no-audit --no-fund --save-exact \
  @claude-flow/memory@3.0.5 ruvector@0.2.41 @ruvector/core@0.1.33 sql.js@1.15.0
export RUFLO_MEMORY_RESOLVE_FROM="$consumer/package.json"
export RUFLO_MEMORY_REQUIRED=1
node scripts/examples/persistent-memory-lifecycle-v2.mjs
node --test scripts/tests/ecosystem-memory-lifecycle-installed.test.mjs \
  scripts/tests/ecosystem-memory-atomic-installed.test.mjs \
  scripts/tests/ecosystem-memory-installed.test.mjs \
  scripts/tests/ecosystem-memory-snapshot.test.mjs
```

The example performs six operations in six separate processes, checks the results, prints package versions and observed operation times, then removes only its own disposable database directory. Required native packages must load; unavailable implementations fail, not skip. Fixture vectors exercise storage/ranking, not generated natural-language embeddings. Save the consumer lock when measuring reproducibility; exact direct versions do not freeze all transitive resolution.

## Mutation contract

The CLI accepts `write`, `retrieve`, `update` and `delete`, followed by a database path and explicit namespace; input is JSON on stdin.

| Operation | Input | Contract |
| --- | --- | --- |
| write | `records: [{key, content, vector}]` | Insert only; existing keys fail, including expired rows |
| retrieve | `vector`, optional `k` | Returns saved ID, key, content, namespace, version and score |
| update | `records: [{key, content, vector, expectedId, expectedVersion}]` | Full content/vector replacement; keeps ID/key/namespace, increments version |
| delete | `records: [{key, expectedId, expectedVersion}]` | Removes exactly the scoped, observed record |

Use the ID and version returned by the latest retrieval. Both are required: version alone cannot distinguish a deleted-and-recreated key. A conflict requires reading current state and deciding again, not blind retries. Unknown keys, wrong namespaces, invalid versions, duplicate batch keys or inconsistent dimensions reject the whole batch without changing authoritative database bytes. Update/delete never create a missing database. Caller-supplied ID, namespace or version override fields are not forwarded to the backend.

Within a namespace, all retained embeddings must have one dimension. The 1,000-record bound includes previous writes and expired rows. Delete records explicitly to free capacity; delete all records before intentionally changing the namespace's dimensions. Existing stores above the bound or with malformed embeddings need a separately reviewed migration, not silent truncation.

Normal retrieval hides expired imported rows, so it cannot provide their mutation tokens. Recovering or removing those rows requires a separately reviewed operator migration; this starter does not bypass that visibility rule.

The previous `write` implementation could silently replace an existing namespace/key with a new ID, or accept a different dimension in a later batch and break retrieval. Those requests now fail. If you relied on implicit replacement, migrate to explicit `update` with retrieved ID/version. Published package APIs are unchanged; this tightening applies to the repository consumer starter.

## Safety and evidence

The [v1 snapshot protocol](persistent-memory-v1.md#atomic-snapshot-safety-revision) still applies: trusted private local POSIX directory, cooperating writers, exclusive lease, private staging, complete backend shutdown, file sync, ownership check, atomic replacement and parent-directory sync. Pre-existing readers retain their snapshot. SIGKILL tests cover write, update and delete on both sides of replacement. These are process-interruption checks, not physical power-loss or network-filesystem guarantees.

Deletion is logical, **not secure erasure**. Old reader snapshots, interrupted staging files or backups may retain content. Namespace selection is not authentication or tenant authorization. No Windows support, encryption or revocation of already-open reader snapshots is claimed. Retain the existing explicit recovery rules; never steal stale locks or guess orphan-stage ownership.

Independent inspection found the pinned backend's `get(missingId)` can return a truthy empty record after deletion. This wrapper verifies deletion with a scoped query instead; it does not claim that the published backend defect is fixed. Backend source and dependency declarations remain unchanged.

[Lifecycle evidence](../../data/ecosystem-memory-lifecycle.validation.json) records exact reproducer commands, source hashes, fixed and last accepted baselines, retained tests and rollback. Coverage stays eight registered checks over ten of 401 packages; extending this workflow is not universal interoperability or an adoption measurement.

Rollback restores the prior consumer/registry/CI source with writers stopped and preserves SQLite data. It removes update/delete support and reintroduces the two documented write defects. Source rollback does not restore deleted or revised records; preserve an operator-managed backup before applying these operations to important data. No npm publication, merge or signing authority is added.
