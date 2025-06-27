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
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
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
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      globals: {
        'ts-jest': {
          testTimeout: 45000
        }
      },
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
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      globals: {
        'ts-jest': {
          testTimeout: 90000
        }
      },
    },
    {
      displayName: 'memory',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/memory/src/tests/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      preset: 'ts-jest/presets/default-esm',
      extensionsToTreatAsEsm: ['.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true }]
      },
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
    },
  ],
  
  // Global configuration
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        module: 'es2022',
        target: 'es2022',
        moduleResolution: 'node',
        allowJs: true,
        esModuleInterop: true,
      }
    }
  },
  
  // Module resolution
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/tests/$1',
    '^@fixtures/(.*)$': '<rootDir>/tests/fixtures/$1',
    '^@mocks/(.*)$': '<rootDir>/tests/mocks/$1',
  },
  
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
  maxWorkers: '50%',
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  
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
  modulePathIgnorePatterns: [
    '<rootDir>/examples/'
  ],
  
  // Additional settings
  verbose: process.env.CI === 'true',
  bail: process.env.CI === 'true' ? 1 : 0,
  errorOnDeprecated: true,
  
  // Set default test timeouts
  testTimeout: 30000,
};