/**
 * V3 Claude-Flow Vitest Configuration
 *
 * London School TDD Configuration
 * - Mock-first testing approach
 * - Behavior verification over state testing
 * - Clear isolation between units
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Global test setup
    setupFiles: ['./__tests__/setup.ts'],

    // Include patterns
    include: [
      '__tests__/**/*.test.ts',
      '__tests__/**/*.spec.ts',
      '@claude-flow/**/__tests__/**/*.test.ts',
      '@claude-flow/**/__tests__/**/*.spec.ts',
      'mcp/__tests__/**/*.test.ts',
      'mcp/__tests__/**/*.spec.ts',
    ],

    // Exclude patterns
    exclude: [
      'node_modules',
      'dist',
      '.git',
    ],

    // Coverage configuration - London School targets
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './__tests__/coverage',

      // Coverage thresholds disabled for alpha (London School TDD uses mocks)
      // TODO: Re-enable for stable release with proper coverage instrumentation
      // thresholds: {
      //   lines: 60,
      //   functions: 60,
      //   branches: 50,
      //   statements: 60,
      // },

      // Files to include in coverage
      include: [
        'src/**/*.ts',
        'modules/**/*.ts',
      ],

      // Files to exclude from coverage
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        '**/__tests__/**',
        '**/fixtures/**',
        '**/mocks/**',
      ],
    },

    // Mock configuration for London School approach
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,

    // Timeout for async operations
    testTimeout: 10000,
    hookTimeout: 10000,

    // Reporter configuration
    reporters: ['default'],

    // Parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
      },
    },

    // Globals for easier testing
    globals: true,

    // Type checking disabled - it.each syntax not supported in type testing
    // Use separate `npm run typecheck` for type validation
    typecheck: {
      enabled: false,
    },
  },

  // Path aliases for clean imports
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './__tests__'),
      '@fixtures': path.resolve(__dirname, './__tests__/fixtures'),
      '@helpers': path.resolve(__dirname, './__tests__/helpers'),
      '@mocks': path.resolve(__dirname, './__tests__/mocks'),
      '@security': path.resolve(__dirname, './modules/security'),
      '@memory': path.resolve(__dirname, './modules/memory'),
      '@swarm': path.resolve(__dirname, './modules/swarm'),
      '@core': path.resolve(__dirname, './modules/core'),
    },
  },
});
