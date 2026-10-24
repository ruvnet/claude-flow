/**
 * V3 Test Setup
 * Global test configuration for Vitest
 */

import { beforeAll, afterAll, vi } from 'vitest';

// Mock console.warn for cleaner test output
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Increase timeout for integration tests
vi.setConfig({
  testTimeout: 30000,
});
