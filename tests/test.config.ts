/**
 * Test configuration for Claude-Flow
 */

import * as fs from 'fs';
import * as path from 'path';

export const TEST_CONFIG = {
  // Test timeouts
  timeout: {
    unit: 15000,
    integration: 45000,
    e2e: 90000,
    performance: 120000,
  },

  // Test directories
  directories: {
    unit: './tests/unit',
    integration: './tests/integration',
    e2e: './tests/e2e',
    performance: './tests/performance',
    fixtures: './tests/fixtures',
    mocks: './tests/mocks',
    coverage: './test-results/coverage',
    reports: './test-results',
  },

  // Coverage thresholds - targeting >90% coverage
  coverage: {
    branches: 90,
    functions: 95,
    lines: 90,
    statements: 90,
  },

  // Test environment
  env: {
    CLAUDE_FLOW_ENV: 'test',
    CLAUDE_FLOW_LOG_LEVEL: 'silent',
    CLAUDE_FLOW_DATA_DIR: './tests/data',
    CLAUDE_FLOW_CONFIG_FILE: './tests/fixtures/test-config.json',
    CLAUDE_FLOW_DISABLE_METRICS: 'true',
    CLAUDE_FLOW_DISABLE_TELEMETRY: 'true',
  },

  // Performance test settings
  performance: {
    concurrent_tasks: [1, 5, 10, 20, 50],
    memory_limits: [100, 500, 1000], // MB
    timeout_stress_duration: 30000, // 30 seconds
    load_test_requests: 1000,
  },

  // Mock configurations
  mocks: {
    mcp_server_port: 8899,
    terminal_delay: 100, // ms
    memory_flush_delay: 50, // ms
  },

  // Test data configurations
  fixtures: {
    small_memory_entries: 100,
    large_memory_entries: 10000,
    test_files_count: 50,
    large_file_size: 1024 * 1024, // 1MB
  },
};

/**
 * Setup test environment
 */
export function setupTestEnv(): void {
  // Set environment variables
  Object.entries(TEST_CONFIG.env).forEach(([key, value]) => {
    process.env[key] = value;
  });

  // Ensure test directories exist
  ensureTestDirectories();
}

/**
 * Cleanup test environment
 */
export async function cleanupTestEnv(): Promise<void> {
  // Remove test data directory
  const cleanupPaths = [
    TEST_CONFIG.env.CLAUDE_FLOW_DATA_DIR,
    './tests/temp',
    './tests/fixtures/temp',
    './test-results/temp',
  ];

  for (const pathToRemove of cleanupPaths) {
    try {
      fs.rmSync(pathToRemove, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }
}

/**
 * Ensure test directories exist
 */
function ensureTestDirectories(): void {
  const directories = Object.values(TEST_CONFIG.directories);
  directories.forEach(dir => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Directory already exists
    }
  });

  // Create additional test directories
  const additionalDirs = [
    './tests/temp',
    './tests/data',
    './tests/fixtures/temp',
    './test-results/temp',
  ];

  additionalDirs.forEach(dir => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Directory already exists
    }
  });
}

/**
 * Get test timeout for suite type
 */
export function getTestTimeout(suiteType: keyof typeof TEST_CONFIG.timeout): number {
  return TEST_CONFIG.timeout[suiteType];
}

/**
 * Check if test environment is properly configured
 */
export function validateTestEnvironment(): boolean {
  // Check required environment variables
  const requiredEnvVars = Object.keys(TEST_CONFIG.env);
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`Missing test environment variables: ${missingVars.join(', ')}`);
    return false;
  }

  // Check test directories
  const directories = Object.values(TEST_CONFIG.directories);
  for (const dir of directories) {
    try {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) {
        console.error(`Test path is not a directory: ${dir}`);
        return false;
      }
    } catch {
      console.error(`Test directory not accessible: ${dir}`);
      return false;
    }
  }

  return true;
}
