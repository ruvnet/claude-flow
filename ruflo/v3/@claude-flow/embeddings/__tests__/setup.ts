/**
 * @claude-flow/embeddings Test Setup
 * Local test configuration for Vitest
 */

import { beforeAll, afterAll, vi } from 'vitest';

// Mock console.warn for cleaner test output
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});
