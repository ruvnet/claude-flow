// Test configuration and environment setup

export function setupTestEnv() {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

export async function cleanupTestEnv() {
  // Clean up test environment
  delete process.env.LOG_LEVEL;
}

export const TEST_CONFIG = {
  timeout: 10000,
  maxRetries: 3,
};