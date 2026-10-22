# AgentDB HNSW adapter verification

Date: 2026-10-20. Scope: issue [#4249](https://github.com/ruvnet/ruflo/issues/4249).
Baseline: `19fb5c6e7cbf0ce37c0269ca2c2fca3dda760851`.
Rebased onto `ab40a99f3a0ff03442759fe082037d6a7630ad53` before publication;
its intervening changes were confined to swarm, not memory or its lockfile.
The existing cleanup-only draft [#4250](https://github.com/ruvnet/ruflo/pull/4250)
was inspected at `88b90fdfd6ad66c266777503fb7c957028829c87` and left unchanged.

## What is implemented

- Replace the three unsupported `getController('hnsw')` calls with the actual
  separately exported `agentdb.HNSWIndex`.
- Build a fresh index from copied, normalized in-memory vector snapshots.
  The snapshot adapter permits only one fixed, read-only query. No user SQL,
  arbitrary filter keys, controller storage, or persistence sidecars are used.
- Lazily rebuild after store/update/replacement/delete. Reuse an unchanged
  index, reject stale asynchronous builds/searches by revision, serialize
  per-query `ef` changes, and use collision-free snapshot IDs.
- Check native tuning before uint32 coercion. Normalize with JS double
  precision before native float32 cosine normalization to handle extreme
  finite values. Clamp native `k` to indexed count.
- Preserve exact cosine fallback for optional dependency/export/addon absence,
  unsupported configuration, dimensions, filtered searches and native errors.
  Do not report HNSW stats/health unless the current index really is built.
- Detach entry/vector inputs and outputs and snapshot query vectors before any
  await, preventing caller mutations from bypassing index invalidation. Keep
  TTL-bearing semantic queries exact so expiry eligibility cannot diverge.
- Remove unsupported performance claims from this backend's integration guide.

The use of fresh snapshots is deliberate. In alpha.20, construction/initialize
alone does not build an empty index, `addVector` is not an upsert, and
`removeVector` removes mappings without deleting the native point. Rebuilding
avoids duplicate labels and tombstone underfill. It is a read-heavy optimization,
not an optimized incremental-write implementation.

## Environment and actual dependency

- Linux x64; AMD EPYC 9V74; Node `v24.19.0`.
- `pnpm@8.15.0`, checked-in lockfile; Vitest `4.1.8`; TypeScript from lockfile.
- Real `agentdb@3.0.0-alpha.20`, `hnswlib-node@3.0.0`, and
  `better-sqlite3@12.9.0`. Native addon compiled with `node-gyp@12.2.0`.
- AgentDB tarball SHA512:
  `ixjySLNWFDe3G6EiM1+0xKvVB9nWgeSMM7+hkgnQ4C5+trWfukDRYj3G/yU3l4xc/9vpAkLFQS389glsGbH0BQ==`
- `AGENTDB_DISABLE_TRANSFORMERS=1`: precomputed vectors, no model download or
  paid embedding service. An initial run without this flag timed out in the
  existing 10-second initialization hook; deterministic reruns below passed.

The native suite spies on the real class to assert `HNSWIndex.search()` actually
executes. It does not replace the implementation on happy paths. Fault tests
inject build/search errors; optional-capability tests explicitly simulate
missing exports/addons/package. `forceWasm` fallback uses a real AgentDB
instance. `RUFLO_REQUIRE_NATIVE_HNSW=1` makes native absence fail, not skip.

## Results

| Check | Baseline | Candidate |
| --- | ---: | ---: |
| Existing full memory suite | 626/626 pass | 626/626 pass |
| New targeted regressions | 4 pass, 15 fail | 19/19 pass |
| Candidate full memory suite | n/a | 645/645 pass, 37 files |
| Focused backend + new native/optional + hybrid + provider | n/a | 81/81 pass |
| TypeScript `tsc --noEmit` | not separately run | pass |
| TypeScript package build | pass | pass |
| `git diff --check` | n/a | pass |

A full-suite run during final review had one unrelated existing timing guard
miss: `AgentMemoryScope: resolve 10k paths` took 200.63 ms against a 200 ms
ceiling. No test or threshold was changed; the unchanged full rerun passed
645/645. This transient result is disclosed rather than omitted.

Coverage includes actual nearest-neighbor IDs/scores, repeated reads, appends,
replacement, regenerated-embedding updates, deletion, namespace clearing, empty
indexes, same-instance shutdown/reinitialize, exact filtered top-k, zero
thresholds/vectors, oversized `k`, dimension mismatch, extreme finite vectors,
unsafe native configuration, concurrent `ef`, mutation during asynchronous
build, expiry parity, mutable input/result/query vectors, and degraded stats/health on missing or failed native capability.

## Bounded benchmark

Identical `benchmarks/agentdb-hnsw.mjs` run in baseline and candidate checkouts
against built package code. Seed 4249; 1,024 vectors × 64 dimensions; 100 queries;
`k=10`; 10 warmups. Query vectors differ from corpus vectors. Recall is compared
with a separately computed exact cosine top-10 for every query.

| Measurement | Baseline dead-controller + exact fallback | Candidate real native HNSW |
| --- | ---: | ---: |
| Native index built | no | yes |
| First search, including index build | 3.671 ms | 97.916 ms |
| Warm search p50 | 0.433 ms | 0.104 ms |
| Warm search p95 | 0.722 ms | 0.267 ms |
| Recall@10 | 1.000 | 1.000 |

This is one bounded run, not a production or universal speedup claim.
The baseline's existing false-error logging remains enabled. No performance
threshold is asserted in tests. Cold searches and searches after mutations
pay full rebuild cost; ties/ANN ordering need not match exact search.
Native allocation size is not exposed, so `hnswStats.memoryUsage` is unknown
(represented as zero by the existing stats interface), not a measured zero.

Source/build SHA256 for the reported candidate:

- `src/agentdb-backend.ts`:
  `c64ac41f2a2e5fcc7a3c62206c52a9692f5a067a132a6d923ac565276c187100`
- `src/agentdb-hnsw-adapter.ts`:
  `f41524d5c4b63c0c9023faae4f5feb0e5692117b6e8a1aaebe48dd97f62e1670`
- `benchmarks/agentdb-hnsw.mjs`:
  `011d43ac9492c36e53c7379a36afda6f6f4f67426166c06778d33aa7736177d8`
- `dist/agentdb-backend.js`:
  `6b4889f95ade01a6de29bb91d2c0b71448dcf15b55cb97ca952c2ac57882f60d`
- `dist/agentdb-hnsw-adapter.js`:
  `8233518c024999675a8651fe393e09a5323cc749fad8233cebd37308a00d7122`

The benchmark prints these hashes, environment, parameters and metrics itself.

## Reproduction

From `v3`, install the checked-in lockfile with pnpm 8:

```sh
npx --yes pnpm@8.15.0 --filter @claude-flow/memory... install --frozen-lockfile --ignore-scripts
```

Build optional `hnswlib-node` and `better-sqlite3` before requiring native tests.
In this environment hnswlib was built from its installed package directory with
the npm-distributed `node-gyp@12.2.0` and writable `--devdir`; better-sqlite3 was
rebuilt with `npm rebuild --prefix .` in its installed package directory.
Do not treat a skipped native suite as verification of the native path.
Build `@claude-flow/security` first for its workspace declarations.

From `v3/@claude-flow/memory`:

```sh
RUFLO_REQUIRE_NATIVE_HNSW=1 AGENTDB_DISABLE_TRANSFORMERS=1 ../../node_modules/.bin/vitest run
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc
AGENTDB_DISABLE_TRANSFORMERS=1 node benchmarks/agentdb-hnsw.mjs
```

For red/green comparison, copy only the two new test files into an isolated
baseline checkout and run them against unchanged baseline source. Run the
existing baseline suite excluding those two files. For benchmark comparison,
copy the same benchmark script into baseline, build, then run it there.

## Explicit unresolved boundary

This change does **not** fix the separate pre-existing AgentDBBackend persistence
contract. The real dependency exposes `database.prepare(...).run/get/all`, while
the old storage paths require `database.run/get`; initialization also does not
hydrate entries. A real disk-backed probe returned:

| Probe | Baseline | Candidate |
| --- | ---: | ---: |
| In-memory count before shutdown | 1 | 1 |
| Count after new instance opens the same database path | 0 | 0 |

The same-instance lifecycle test is not a persisted-restart test. This PR does
not claim process-restart durability, ship an npm package, update CLI pins,
merge the cleanup PR, or cover the unrelated capability-signing scan in #4249.
Whole-repository CI is separate from the package verification above.
