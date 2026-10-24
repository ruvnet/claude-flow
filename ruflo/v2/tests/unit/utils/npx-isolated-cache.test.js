/**
 * Jest-compatible tests for NPX isolated cache functionality
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createIsolatedCache, getIsolatedNpxEnv, cleanupAllCaches } from '../../../src/utils/npx-isolated-cache.js';

describe('NPX Isolated Cache', () => {
  beforeEach(() => {
    // Clean up any existing caches before each test
    return cleanupAllCaches();
  });

  afterEach(() => {
    // Clean up caches after each test
    return cleanupAllCaches();
  });

  describe('createIsolatedCache', () => {
    it('should create unique cache directories for each call', () => {
      const env1 = createIsolatedCache();
      const env2 = createIsolatedCache();

      expect(env1.NPM_CONFIG_CACHE).toBeDefined();
      expect(env2.NPM_CONFIG_CACHE).toBeDefined();
      expect(env1.NPM_CONFIG_CACHE).not.toBe(env2.NPM_CONFIG_CACHE);
    });

    it('should include all process environment variables', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test-value';

      const env = createIsolatedCache();

      expect(env.NODE_ENV).toBe('test-value');
      expect(env.NPM_CONFIG_CACHE).toBeDefined();
      expect(env.npm_config_cache).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should create cache directories under temp/.npm-cache', () => {
      const env = createIsolatedCache();
      const cacheDir = env.NPM_CONFIG_CACHE;
      
      expect(cacheDir).toContain(path.join(os.tmpdir(), '.npm-cache'));
      expect(cacheDir).toContain('claude-flow-');
      expect(cacheDir).toContain(process.pid.toString());
    });

    it('should set both NPM_CONFIG_CACHE and npm_config_cache', () => {
      const env = createIsolatedCache();
      
      expect(env.NPM_CONFIG_CACHE).toBeDefined();
      expect(env.npm_config_cache).toBeDefined();
      expect(env.NPM_CONFIG_CACHE).toBe(env.npm_config_cache);
    });
  });

  describe('getIsolatedNpxEnv', () => {
    it('should merge additional environment variables', () => {
      const env = getIsolatedNpxEnv({
        CUSTOM_VAR: 'custom-value',
        NODE_ENV: 'override-value'
      });

      expect(env.CUSTOM_VAR).toBe('custom-value');
      expect(env.NODE_ENV).toBe('override-value');
      expect(env.NPM_CONFIG_CACHE).toBeDefined();
    });

    it('should prioritize additional env vars over defaults', () => {
      const customCacheDir = '/custom/cache/dir';
      const env = getIsolatedNpxEnv({
        NPM_CONFIG_CACHE: customCacheDir
      });

      expect(env.NPM_CONFIG_CACHE).toBe(customCacheDir);
    });
  });

  describe('cache directory structure', () => {
    it('should create unique directory names with pid, timestamp, and random', () => {
      const env1 = createIsolatedCache();
      const env2 = createIsolatedCache();

      const cache1 = path.basename(env1.NPM_CONFIG_CACHE);
      const cache2 = path.basename(env2.NPM_CONFIG_CACHE);

      // Both should start with claude-flow-{pid}
      const pidPrefix = `claude-flow-${process.pid}-`;
      expect(cache1).toMatch(new RegExp(`^${pidPrefix}\\d+-[a-z0-9]+$`));
      expect(cache2).toMatch(new RegExp(`^${pidPrefix}\\d+-[a-z0-9]+$`));
      
      // They should be different
      expect(cache1).not.toBe(cache2);
    });
  });

  describe('cleanup functionality', () => {
    it('should track cache directories for cleanup', async () => {
      const env = createIsolatedCache();
      const cacheDir = env.NPM_CONFIG_CACHE;

      // Cleanup should not throw even if directory doesn't exist
      await expect(cleanupAllCaches()).resolves.not.toThrow();
    });
  });

  describe('environment inheritance', () => {
    it('should inherit PATH and other important environment variables', () => {
      const env = createIsolatedCache();
      
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.HOME || env.USERPROFILE).toBe(process.env.HOME || process.env.USERPROFILE);
    });
  });
});