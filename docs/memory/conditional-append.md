Updated: 2026-10-05 EDT | Version 0.1.1
Created: 2026-10-05 EDT

# Native conditional append for structured continuity records

This source candidate adds explicit controls to `memory store`. Existing calls retain their
embedding, upsert and backend fallback behavior. It is not an installed or published capability.

- `--no-embedding` avoids embedding structured records.
- `--require-native` requires a native disk handle for the exact canonical file, refusing
  in-memory, wrong-file, WASM and whole-image sql.js fallback record writes.
- `--append-only` requires native storage and never replaces active records or resurrects
  tombstones. Its logical-slot check and insert share an immediate transaction, including on
  legacy tables without a UNIQUE constraint.
- `--append-conditions '<JSON array>'` requires both native and append-only controls. One to eight
  predicates run inside the same native immediate transaction as the record insertion.

A record predicate `{namespace, key, sha256}` checks the exact UTF-8 stored content digest and active
status. Optional `latestPrefix` requires that key to be the latest slot with the literal prefix.
The latest lookup includes tombstones so deleting an authority epoch cannot rewind authority.
`{namespace, absent:true, latestPrefix}` requires no slot with that prefix, including tombstones.
`{namespace, count, keysSha256}` checks complete active key membership; the digest covers
`JSON.stringify(sortedKeys)`. It reads keys only, never historical content.

An append-only publication should use one project-wide next-sequence key and predicates binding the
exact immutable candidate, current parent publication, current authority epoch and retained legacy
membership. Parent existence alone does not establish tip authority: use `latestPrefix`. Genesis
uses the absent-prefix predicate. Authority withdrawal must first commit a newer epoch through the
canonical provider. A former writer then fails its publication transaction even when its earlier
work was still in flight. A failed contender remains pending and must rebase; this primitive never
acknowledges or silently merges competing candidates.

No second store or writer is introduced. `memory store` remains the public entry point and writes
its explicit canonical `--path`. Immutable inserts without embeddings leave namespace vector totals
unchanged, so this path avoids a lifetime namespace vector recount.

Validation: focused native/CLI tests, full referenced TypeScript workspace build, and the built
local standard CLI against a disposable canonical memory.db. The CLI rejected a stale epoch with
exit 1 and no publication row; current-epoch publication returned exit 0 with exact independent
SQLite readback and NULL embedding. This does not prove installation, upstream publication or
production continuity cutover.
