/**
 * Vitest benchmark configuration (ADR-320 P9 / Task #9).
 *
 * The main `vitest.config.ts` only includes test files; this config exists so
 * `vitest bench --config vitest.bench.config.ts` discovers and runs the
 * `benchmarks/**\/*.bench.ts` suites (e.g. the publish-scan duration baseline).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmarks/**/*.bench.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globals: false,
    typecheck: { enabled: false },
    benchmark: {
      include: ['benchmarks/**/*.bench.ts'],
      exclude: ['node_modules', 'dist'],
    },
  },
});
