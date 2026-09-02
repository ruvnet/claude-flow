/**
 * Permission Manager Tests
 *
 * Comprehensive test suite for 4-level hierarchical permission system
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import {
  PermissionManager,
  createPermissionManager,
  permissionManager,
} from '../permissions/permission-manager.js';
import type {
  PermissionLevel,
  PermissionQuery,
  PermissionConfig,
} from '../permissions/permission-manager.js';

// ===== Test Helpers =====

async function createTestDirectory(): Promise<string> {
  const testDir = join(tmpdir(), `perm-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  await mkdir(join(testDir, '.claude-flow'), { recursive: true });
  return testDir;
}

async function cleanupTestDirectory(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

function createMockQuery(overrides?: Partial<PermissionQuery>): PermissionQuery {
  return {
    toolName: 'test-tool',
    toolInput: {},
    context: {
      sessionId: 'test-session',
      workingDir: '/test',
    },
    ...overrides,
  };
}

// ===== Tests =====

describe('PermissionManager', () => {
  let manager: PermissionManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDirectory();

    manager = new PermissionManager({
      cacheEnabled: true,
      cacheTTL: 60000,
      userConfigPath: join(testDir, 'user.json'),
      projectConfigPath: join(testDir, '.claude-flow', 'permissions.json'),
      localConfigPath: join(testDir, '.permissions.json'),
    });

    await manager.initialize();
  });

  afterEach(async () => {
    manager.clearCache();
    await cleanupTestDirectory(testDir);
  });

  describe('Initialization', () => {
    it('should initialize with default configs', async () => {
      const userConfig = manager.getConfig('user');
      const projectConfig = manager.getConfig('project');
      const localConfig = manager.getConfig('local');
      const sessionConfig = manager.getConfig('session');

      expect(userConfig).toBeDefined();
      expect(projectConfig).toBeDefined();
      expect(localConfig).toBeDefined();
      expect(sessionConfig).toBeDefined();
    });

    it('should create default configs when files do not exist', async () => {
      const config = manager.getConfig('user');

      expect(config?.mode).toBe('default');
      expect(config?.rules).toEqual([]);
      expect(config?.allowedDirectories).toEqual([]);
    });
  });

  describe('Permission Resolution', () => {
    it('should resolve permission from session level', async () => {
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [{ toolName: 'test-tool' }],
        behavior: 'allow',
        destination: 'session',
      });

      const query = createMockQuery({ toolName: 'test-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('allow');
      expect(resolution.level).toBe('session');
    });

    it('should fallback to project level', async () => {
      await manager.updatePermissions('project', {
        type: 'addRules',
        rules: [{ toolName: 'test-tool' }],
        behavior: 'allow',
        destination: 'projectSettings',
      });

      const query = createMockQuery({ toolName: 'test-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('allow');
      expect(resolution.level).toBe('project');
    });

    it('should fallback through entire chain', async () => {
      await manager.updatePermissions('user', {
        type: 'addRules',
        rules: [{ toolName: 'test-tool' }],
        behavior: 'deny',
        destination: 'userSettings',
      });

      const query = createMockQuery({ toolName: 'test-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('deny');
      expect(resolution.level).toBe('user');
      expect(resolution.fallbackChain).toContain('user');
    });

    it('should return ask when no rule found', async () => {
      const query = createMockQuery({ toolName: 'unknown-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('ask');
    });

    it('should respect priority within same level', async () => {
      const sessionConfig = manager.getConfig('session');
      if (sessionConfig) {
        sessionConfig.rules.push(
          {
            toolName: 'test-tool',
            behavior: 'deny',
            scope: 'session',
            priority: 50,
            timestamp: Date.now(),
          },
          {
            toolName: 'test-tool',
            behavior: 'allow',
            scope: 'session',
            priority: 100,
            timestamp: Date.now(),
          }
        );
      }

      const query = createMockQuery({ toolName: 'test-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('allow'); // Higher priority wins
    });
  });

  describe('Permission Updates', () => {
    it('should add rules', async () => {
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [
          { toolName: 'tool-1' },
          { toolName: 'tool-2' },
        ],
        behavior: 'allow',
        destination: 'session',
      });

      const config = manager.getConfig('session');
      expect(config?.rules).toHaveLength(2);
    });

    it('should replace rules', async () => {
      // Add initial rules
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [
          { toolName: 'tool-1' },
          { toolName: 'tool-2' },
        ],
        behavior: 'allow',
        destination: 'session',
      });

      // Replace with new rules
      await manager.updatePermissions('session', {
        type: 'replaceRules',
        rules: [{ toolName: 'tool-3' }],
        behavior: 'deny',
        destination: 'session',
      });

      const config = manager.getConfig('session');
      expect(config?.rules).toHaveLength(1);
      expect(config?.rules[0].toolName).toBe('tool-3');
    });

    it('should remove rules', async () => {
      // Add rules
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [
          { toolName: 'tool-1' },
          { toolName: 'tool-2' },
        ],
        behavior: 'allow',
        destination: 'session',
      });

      // Remove one rule
      await manager.updatePermissions('session', {
        type: 'removeRules',
        rules: [{ toolName: 'tool-1' }],
        behavior: 'allow',
        destination: 'session',
      });

      const config = manager.getConfig('session');
      expect(config?.rules).toHaveLength(1);
      expect(config?.rules[0].toolName).toBe('tool-2');
    });

    it('should set mode', async () => {
      await manager.updatePermissions('session', {
        type: 'setMode',
        mode: 'bypassPermissions',
        destination: 'session',
      });

      const config = manager.getConfig('session');
      expect(config?.mode).toBe('bypassPermissions');
    });

    it('should add directories', async () => {
      await manager.updatePermissions('session', {
        type: 'addDirectories',
        directories: ['/test/dir1', '/test/dir2'],
        destination: 'session',
      });

      const config = manager.getConfig('session');
      expect(config?.allowedDirectories).toContain('/test/dir1');
      expect(config?.allowedDirectories).toContain('/test/dir2');
    });

    it('should remove directories', async () => {
      // Add directories
      await manager.updatePermissions('session', {
        type: 'addDirectories',
        directories: ['/test/dir1', '/test/dir2'],
        destination: 'session',
      });

      // Remove one
      await manager.updatePermissions('session', {
        type: 'removeDirectories',
        directories: ['/test/dir1'],
        destination: 'session',
      });

      const config = manager.getConfig('session');
      expect(config?.allowedDirectories).not.toContain('/test/dir1');
      expect(config?.allowedDirectories).toContain('/test/dir2');
    });

    it('should clear cache on updates', async () => {
      const query = createMockQuery({ toolName: 'test-tool' });

      // Create cached entry
      await manager.resolvePermission(query);
      expect(manager.getCacheStats().size).toBeGreaterThan(0);

      // Update should clear cache
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [{ toolName: 'test-tool' }],
        behavior: 'allow',
        destination: 'session',
      });

      expect(manager.getCacheStats().size).toBe(0);
    });
  });

  describe('Caching', () => {
    it('should cache permission resolutions', async () => {
      const query = createMockQuery({ toolName: 'test-tool' });

      // First resolution
      const resolution1 = await manager.resolvePermission(query);
      expect(resolution1.cached).toBe(false);

      // Second resolution should be cached
      const resolution2 = await manager.resolvePermission(query);
      expect(resolution2.cached).toBe(true);
      expect(resolution2.behavior).toBe(resolution1.behavior);
    });

    it('should provide cache statistics', async () => {
      const query1 = createMockQuery({ toolName: 'tool-1' });
      const query2 = createMockQuery({ toolName: 'tool-2' });

      await manager.resolvePermission(query1);
      await manager.resolvePermission(query2);

      const stats = manager.getCacheStats();
      expect(stats.size).toBe(2);
    });

    it('should prune expired entries', async () => {
      const shortTTLManager = new PermissionManager({
        cacheEnabled: true,
        cacheTTL: 100, // 100ms
        userConfigPath: join(testDir, 'user2.json'),
      });

      await shortTTLManager.initialize();

      const query = createMockQuery({ toolName: 'test-tool' });
      await shortTTLManager.resolvePermission(query);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      const pruned = shortTTLManager.pruneCache();
      expect(pruned).toBeGreaterThan(0);
    });
  });

  describe('Rule Matching', () => {
    it('should match exact tool names', async () => {
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [{ toolName: 'exact-match' }],
        behavior: 'allow',
        destination: 'session',
      });

      const query = createMockQuery({ toolName: 'exact-match' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('allow');
    });

    it('should match wildcard rules', async () => {
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [{ toolName: '*' }],
        behavior: 'allow',
        destination: 'session',
      });

      const query = createMockQuery({ toolName: 'any-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('allow');
    });

    it('should match pattern-based rules', async () => {
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [{ toolName: 'test-*' }],
        behavior: 'allow',
        destination: 'session',
      });

      const query = createMockQuery({ toolName: 'test-something' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('allow');
    });
  });

  describe('Bypass Mode', () => {
    it('should bypass all rules when mode is bypassPermissions', async () => {
      await manager.updatePermissions('session', {
        type: 'setMode',
        mode: 'bypassPermissions',
        destination: 'session',
      });

      const query = createMockQuery({ toolName: 'any-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.behavior).toBe('allow');
    });
  });

  describe('Performance', () => {
    it('should resolve permissions quickly', async () => {
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [{ toolName: 'test-tool' }],
        behavior: 'allow',
        destination: 'session',
      });

      const query = createMockQuery({ toolName: 'test-tool' });
      const resolution = await manager.resolvePermission(query);

      expect(resolution.resolutionTime).toBeLessThan(10); // Less than 10ms
    });

    it('should be faster with cache', async () => {
      await manager.updatePermissions('session', {
        type: 'addRules',
        rules: [{ toolName: 'test-tool' }],
        behavior: 'allow',
        destination: 'session',
      });

      const query = createMockQuery({ toolName: 'test-tool' });

      // First resolution (no cache)
      const resolution1 = await manager.resolvePermission(query);
      const time1 = resolution1.resolutionTime;

      // Second resolution (cached)
      const resolution2 = await manager.resolvePermission(query);
      const time2 = resolution2.resolutionTime;

      expect(time2).toBeLessThanOrEqual(time1);
      expect(resolution2.cached).toBe(true);
    });
  });
});

describe('Factory Function', () => {
  it('should create permission manager with defaults', () => {
    const manager = createPermissionManager();

    expect(manager).toBeInstanceOf(PermissionManager);
  });

  it('should create permission manager with custom options', () => {
    const manager = createPermissionManager({
      workingDir: '/test/dir',
      cacheEnabled: false,
      cacheTTL: 10000,
    });

    expect(manager).toBeInstanceOf(PermissionManager);
  });
});

describe('Singleton Instance', () => {
  it('should export singleton instance', () => {
    expect(permissionManager).toBeInstanceOf(PermissionManager);
  });

  it('should maintain state across calls', async () => {
    await permissionManager.updatePermissions('session', {
      type: 'addRules',
      rules: [{ toolName: 'singleton-test' }],
      behavior: 'allow',
      destination: 'session',
    });

    const config = permissionManager.getConfig('session');
    expect(config?.rules.some(r => r.toolName === 'singleton-test')).toBe(true);
  });
});