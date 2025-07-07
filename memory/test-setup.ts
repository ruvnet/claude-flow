/**
 * Test setup for SPARC Memory Bank
 */

import { beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';

// Global test setup
beforeAll(async () => {
  // Ensure test directories exist
  await fs.mkdir('/tmp', { recursive: true }).catch(() => {});
});

// Global test cleanup
afterAll(async () => {
  // Clean up any remaining test files
  const testDirs = [
    '/tmp/memory-test',
    '/tmp/backend-test-sqlite',
    '/tmp/backend-test-markdown',
    '/tmp/indexer-test',
    '/tmp/namespace-test',
    '/tmp/replication-test'
  ];

  // Process directories sequentially to avoid parallel filesystem operations
  for (const dir of testDirs) {
    // eslint-disable-next-line no-await-in-loop
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// Mock timers configuration
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.setInterval = setInterval;
global.clearInterval = clearInterval;