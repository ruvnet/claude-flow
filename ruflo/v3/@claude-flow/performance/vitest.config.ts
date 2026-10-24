import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/attention-integration.ts',
        'src/attention-benchmarks.ts',
        'src/framework/benchmark.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/types.ts',
        'src/index.ts',
        'src/examples/**',
      ],
      // Lower thresholds for now as we're testing the performance module itself
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
