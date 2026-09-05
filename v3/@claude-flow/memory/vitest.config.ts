import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 15000,
    hookTimeout: 10000,
    globals: false,
    typecheck: { enabled: false },
    // ADR-125 Phase 7 — wipe ruvector.db / *.rvf / *.redb stray artifacts
    // before and after each test run so no DB file leaks into git status.
    setupFiles: ['./vitest.setup.ts'],
  },
});
