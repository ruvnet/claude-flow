# Migration Guide — `@claude-flow/memory@3.0.0-alpha.18`

This release lands [ADR-125](../../../docs/adr/ADR-125-memory-consolidation.md) PR A — the "deliver ADR-009" bundle. The user-facing API stays backwards-compatible; this guide explains the renames, removals, and the new defaults.

## TL;DR

```diff
- import { UnifiedMemoryService, createHybridService, HnswLite, RvfBackend } from '@claude-flow/memory';
+ import { MemoryService, createHybridService } from '@claude-flow/memory';
```

`UnifiedMemoryService` is **still exported** — it is now an alias of `MemoryService` and will be removed at `3.0.0-rc`. No runtime behavior change.

## What changed

### 1. `MemoryService` is now the canonical entry point (Phase 1)

The class previously known as `UnifiedMemoryService` is now exported under two names:

- `MemoryService` — canonical name, use this in new code.
- `UnifiedMemoryService` — `@deprecated` alias, kept until `3.0.0-rc` so existing imports continue working.

Both names refer to the same constructor:

```ts
import { MemoryService, UnifiedMemoryService } from '@claude-flow/memory';

MemoryService === UnifiedMemoryService;            // true
new MemoryService({}) instanceof UnifiedMemoryService; // true
```

If you keep importing `UnifiedMemoryService`, your code keeps working but will start emitting `@deprecated` JSDoc warnings in IDEs that surface them.

### 2. `HnswLite` and `RvfBackend` are no longer in the public surface (Phase 1)

These were internal building blocks that leaked through `src/index.ts`. They are now reachable through their explicit module paths only:

```ts
// Before (no longer works from the index)
import { HnswLite, RvfBackend } from '@claude-flow/memory';

// After — if you actually need them, import from the explicit submodule
import { HnswLite } from '@claude-flow/memory/hnsw-lite';
import { RvfBackend } from '@claude-flow/memory/rvf-backend';
```

In practice you almost certainly do NOT need them directly:

- `RvfBackend` is selected automatically by `createDatabase({ provider: 'rvf' })` (or the default `'auto'` selection on platforms where RVF is preferred).
- `HnswLite` lives inside `RvfBackend`. The canonical HNSW for the rest of the package is `HNSWIndex` (still exported).

The `prepublishOnly` check now fails the publish if either symbol re-appears on the top-level exports.

### 3. `createHybridService` actually returns a hybrid service (Phase 2)

Before this release, `createHybridService` silently downgraded to AgentDB-only — the code comment admitted as much. It now returns a `MemoryService` whose backend is a real `HybridBackend` (SQLite for structured queries, AgentDB for semantic), via the new `'hybrid'` case in `createDatabase`.

```ts
import { createHybridService } from '@claude-flow/memory';

const memory = await createHybridService('./data/memory.db', embeddingFn);
await memory.initialize();

// Backend is now an actual HybridBackend
(memory as any).backend instanceof HybridBackend; // true
```

If you were relying on the old AgentDB-only behavior, switch to `createPersistentService` or pass a custom backend instead.

### 4. New `createDatabase` providers (Phase 2)

`createDatabase` now dispatches to:

- `'hybrid'` — returns a `HybridBackend` composing SQLite + AgentDB.
- `'agentdb'` — returns an `AgentDBBackend` directly (previously only reachable through `UnifiedMemoryService`).

The existing providers (`'better-sqlite3'`, `'sql.js'`, `'rvf'`, `'json'`, `'auto'`) are unchanged.

### 5. Bench script wiring (Phase 6)

`npm run bench` now uses a dedicated `vitest.bench.config.ts` and discovers `benchmarks/**/*.bench.ts`. The first measured baseline lives in `benchmarks/results/`. The README's perf table now cites real measurements instead of aspirational prose.

### 6. RuVector boundary (Phase 7)

`v3/@claude-flow/memory/ruvector.db` is test pollution, not a runtime artifact. It is now wiped before and after tests by `vitest.setup.ts`, and a `scripts/smoke-memory-no-stray-db.mjs` CI guard fails the build if any `*.db` / `*.redb` / `*.rvf` file appears in `git status` under the package after `npm test` runs.

## What did NOT change

- The `IMemoryBackend` interface and all `MemoryEntry` / `MemoryQuery` / `SearchOptions` types are unchanged.
- The DDD layer (`src/domain`, `src/application`, `src/infrastructure`) is still internal-only — it has never been re-exported, and this release does not change that.
- All existing tests pass unchanged. Net test count goes up; no regressions.

## Upgrading

```diff
- "@claude-flow/memory": "^3.0.0-alpha.17"
+ "@claude-flow/memory": "^3.0.0-alpha.18"
```

For most consumers, no code change is needed. To remove the `@deprecated` warnings, rename `UnifiedMemoryService` → `MemoryService` at your import sites.

## See also

- [ADR-125 — Memory Consolidation](../../../docs/adr/ADR-125-memory-consolidation.md)
- [ADR-009 — Hybrid Memory Backend](../../../docs/adr/ADR-009-hybrid-memory-backend.md)
- [ADR-006 — Unified Memory Service](../../../docs/adr/ADR-006-unified-memory-service.md)
