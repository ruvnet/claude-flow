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
    // Use forks with execArgv to pass memory to child process
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ['--max-old-space-size=8192'],
      },
    },
  },
});
