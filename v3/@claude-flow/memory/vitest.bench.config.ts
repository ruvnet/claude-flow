/**
 * Vitest benchmark configuration (ADR-125 Phase 6).
 *
 * The main `vitest.config.ts` only includes `src/**\/*.test.ts`, which means
 * `npm run bench` previously matched nothing. This config exists so
 * `vitest bench --config vitest.bench.config.ts` discovers and runs the
 * `benchmarks/**\/*.bench.ts` suites that ship with the package.
 *
 * @see {@link ../docs/adr/ADR-125-memory-consolidation.md} Phase 6.
 */
import { defineConfig } from 'vitest/config';

// Excluded — these legacy bench files use a custom `BenchmarkRunner` framework
// rather than vitest `bench()` blocks. They are still runnable via `tsx` but
// don't fit vitest's discovery model. They are kept on-disk as reference and
// will be ported in a follow-up alongside ADR-125 Phase 3 (persistent HNSW).
const LEGACY_BENCHES = [
  'benchmarks/cache-hit-rate.bench.ts',
  'benchmarks/hnsw-indexing.bench.ts',
  'benchmarks/memory-write.bench.ts',
  'benchmarks/vector-search.bench.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmarks/**/*.bench.ts'],
    exclude: ['node_modules', 'dist', 'benchmarks/longmemeval/**', ...LEGACY_BENCHES],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globals: false,
    typecheck: { enabled: false },
    benchmark: {
      include: ['benchmarks/**/*.bench.ts'],
      exclude: ['node_modules', 'dist', 'benchmarks/longmemeval/**', ...LEGACY_BENCHES],
    },
  },
});
