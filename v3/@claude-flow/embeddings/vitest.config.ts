/**
 * @claude-flow/embeddings Vitest Configuration
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10000,
    // Vitest 4 removed `poolOptions`; `singleFork` maps to `maxWorkers: 1`.
    // The old Node heap-limit execArgv was already ignored on Vitest 4
    // and only masked the chunkByCharacter infinite loop (fixed in src).
    pool: 'forks',
    maxWorkers: 1,
  },
});
