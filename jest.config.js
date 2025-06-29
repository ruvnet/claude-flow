// Shared module name mapper for consistent resolution across all projects
const sharedModuleNameMapper = {
  '^(\\.{1,2}/.*)\\.js$': '$1',
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@test/(.*)$': '<rootDir>/tests/$1',
  '^@fixtures/(.*)$': '<rootDir>/tests/fixtures/$1',
  '^@mocks/(.*)$': '<rootDir>/tests/mocks/$1',
};

export default {
  // TypeScript preset for ESM modules
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  
  // Test environments
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      preset: 'ts-jest/presets/default-esm',
      extensionsToTreatAsEsm: ['.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true }]
      },
      moduleNameMapper: sharedModuleNameMapper,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      preset: 'ts-jest/presets/default-esm',
      extensionsToTreatAsEsm: ['.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true }]
      },
      moduleNameMapper: sharedModuleNameMapper,
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      preset: 'ts-jest/presets/default-esm',
      extensionsToTreatAsEsm: ['.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true }]
      },
      moduleNameMapper: sharedModuleNameMapper,
    },
    {
      displayName: 'validation',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/validation/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      preset: 'ts-jest/presets/default-esm',
      extensionsToTreatAsEsm: ['.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true }]
      },
      moduleNameMapper: sharedModuleNameMapper,
    },
  ],
  
  // Global configuration
  
  // Module resolution
  moduleNameMapper: sharedModuleNameMapper,
  
  // Transform configuration (applied globally for fallback)
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'es2022',
        target: 'es2022',
        moduleResolution: 'node',
        allowJs: true,
        esModuleInterop: true,
      }
    }]
  },
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
    '!src/cli/index.ts',
    '!src/cli/main.ts',
    '!src/cli/simple-cli.ts',
  ],
  
  // Coverage thresholds - targeting >80%
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Critical modules require higher coverage
    './src/persistence/sqlite/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/swarm/**/*.ts': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  
  // Performance and optimization
  maxWorkers: process.env.CI === 'true' ? '50%' : 2,
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  
  // Faster test execution
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
  
  // Disable source maps in tests for better performance
  globals: {
    'ts-jest': {
      isolatedModules: true,
      tsconfig: {
        sourceMap: false,
        inlineSourceMap: false,
      }
    }
  },
  
  // Test isolation
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  resetModules: false, // Only reset when needed for specific tests
  
  // Watch mode settings
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/bin/',
    '/coverage/',
    '/.jest-cache/',
    '/test-results/',
    '/examples/',  // Ignore examples to avoid Haste collisions
  ],
  
  // Haste module configuration to prevent collisions
  haste: {
    forceNodeFilesystemAPI: true,
    retainAllFiles: false,
    enableSymlinks: false,
    throwOnModuleCollision: false
  },
  
  modulePathIgnorePatterns: [
    '<rootDir>/examples/',
    '<rootDir>/dist/',
    '<rootDir>/build/',
    '<rootDir>/.jest-cache/',
    'package\\.json$'  // Ignore package.json files in module resolution
  ],
  
  // Additional exclusions for examples
  watchPathIgnorePatterns: [
    '<rootDir>/examples/'
  ],
  
  // Additional settings
  verbose: process.env.CI === 'true',
  bail: process.env.CI === 'true' ? 1 : 0,
  errorOnDeprecated: true,
  
  // Set default test timeouts - lower for faster feedback
  testTimeout: process.env.CI === 'true' ? 30000 : 10000,
  
  // Detect slow tests
  slowTestThreshold: 5,
};