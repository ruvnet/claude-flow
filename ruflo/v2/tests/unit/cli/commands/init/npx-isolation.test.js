/**
 * Jest-compatible tests for NPX isolation in init command
 */

import { describe, it, expect, jest } from '@jest/globals';

describe('Init Command NPX Isolation', () => {
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('import validation', () => {
    it('should successfully import getIsolatedNpxEnv utility', async () => {
      const { getIsolatedNpxEnv } = await import('../../../../../src/utils/npx-isolated-cache.js');
      
      expect(getIsolatedNpxEnv).toBeDefined();
      expect(typeof getIsolatedNpxEnv).toBe('function');
    });

    it('should successfully import init command with npx isolation', async () => {
      // This test verifies that our changes to the init command don't break imports
      const initModule = await import('../../../../../src/cli/simple-commands/init/index.js');
      
      expect(initModule).toBeDefined();
      // The initCommand function should still be exportable
      expect(initModule.initCommand).toBeDefined();
    });

    it('should successfully import batch-init with npx isolation', async () => {
      // This test verifies that our changes to batch-init don't break imports
      const batchInitModule = await import('../../../../../src/cli/simple-commands/init/batch-init.js');
      
      expect(batchInitModule).toBeDefined();
      // Key exports should still be available
      expect(batchInitModule.batchInitCommand).toBeDefined();
      expect(batchInitModule.validateBatchOptions).toBeDefined();
    });
  });

  describe('integration with existing code', () => {
    it('should not conflict with existing environment handling', () => {
      // Mock Deno.env if it doesn't exist (we're in Node.js)
      const mockDeno = {
        env: {
          toObject: () => ({ ...process.env })
        }
      };

      // This would be used in the actual init command
      const env = mockDeno.env.toObject();
      
      expect(env).toBeDefined();
      expect(typeof env).toBe('object');
    });
  });
});

describe('NPX Cache Isolation Integration', () => {
  it('should provide isolated environment without affecting global state', async () => {
    const { getIsolatedNpxEnv } = await import('../../../../../src/utils/npx-isolated-cache.js');
    
    const originalCache = process.env.NPM_CONFIG_CACHE;
    
    // Get isolated environment
    const isolatedEnv = getIsolatedNpxEnv();
    
    // Should have isolated cache
    expect(isolatedEnv.NPM_CONFIG_CACHE).toBeDefined();
    expect(isolatedEnv.NPM_CONFIG_CACHE).not.toBe(originalCache);
    
    // Should not affect global process.env
    expect(process.env.NPM_CONFIG_CACHE).toBe(originalCache);
  });

  it('should work with Deno.Command-style environment passing', async () => {
    const { getIsolatedNpxEnv } = await import('../../../../../src/utils/npx-isolated-cache.js');
    
    // Simulate how the init command would use this
    const baseEnv = {
      PWD: '/some/working/dir',
      CUSTOM_VAR: 'test-value'
    };
    
    const isolatedEnv = getIsolatedNpxEnv(baseEnv);
    
    expect(isolatedEnv.PWD).toBe('/some/working/dir');
    expect(isolatedEnv.CUSTOM_VAR).toBe('test-value');
    expect(isolatedEnv.NPM_CONFIG_CACHE).toBeDefined();
    expect(isolatedEnv.NPM_CONFIG_CACHE).toContain('claude-flow-');
  });
});