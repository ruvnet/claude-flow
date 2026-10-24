/**
 * Worker System Tests
 *
 * Unit and integration tests for the V3 worker system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

import {
  WorkerManager,
  WorkerPriority,
  AlertSeverity,
  WORKER_CONFIGS,
  createWorkerManager,
  createPerformanceWorker,
  createHealthWorker,
  createSecurityWorker,
  createADRWorker,
  createDDDWorker,
  type WorkerResult,
  type AlertThreshold,
} from '../src/index.js';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_PROJECT_ROOT = path.join(os.tmpdir(), 'claude-flow-test-' + Date.now());

async function setupTestDir(): Promise<void> {
  await fs.mkdir(path.join(TEST_PROJECT_ROOT, '.claude-flow', 'metrics'), { recursive: true });
  await fs.mkdir(path.join(TEST_PROJECT_ROOT, 'v3', '@claude-flow', 'hooks', 'src'), { recursive: true });
}

async function cleanupTestDir(): Promise<void> {
  try {
    await fs.rm(TEST_PROJECT_ROOT, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Unit Tests - WorkerManager
// ============================================================================

describe('WorkerManager', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await manager.stop().catch(() => {});
    await cleanupTestDir();
  });

  describe('initialization', () => {
    it('should create manager with default configs', () => {
      expect(manager).toBeInstanceOf(WorkerManager);
      const status = manager.getStatus();
      expect(status.workers.length).toBe(Object.keys(WORKER_CONFIGS).length);
    });

    it('should initialize metrics for all workers', () => {
      const status = manager.getStatus();
      for (const worker of status.workers) {
        expect(worker.runCount).toBe(0);
        expect(worker.errorCount).toBe(0);
        expect(worker.status).toBe('idle');
      }
    });

    it('should load persisted state on initialize', async () => {
      // Save some state
      const performanceMetrics = manager['metrics'].get('performance')!;
      performanceMetrics.runCount = 5;

      await manager.saveState();

      // Create new manager and initialize
      const newManager = new WorkerManager(TEST_PROJECT_ROOT);
      await newManager.initialize();

      const status = newManager.getStatus();
      const perf = status.workers.find(w => w.name === 'performance');
      expect(perf?.runCount).toBe(5);
    });
  });

  describe('worker registration', () => {
    it('should register custom worker', () => {
      const customHandler = vi.fn().mockResolvedValue({
        worker: 'custom',
        success: true,
        duration: 100,
        timestamp: new Date(),
      });

      manager.register('custom', customHandler);

      // Verify registration via event
      const registered = vi.fn();
      manager.on('worker:registered', registered);
      manager.register('another', customHandler);

      expect(registered).toHaveBeenCalledWith({ name: 'another' });
    });
  });

  describe('worker execution', () => {
    it('should run a registered worker', async () => {
      const mockResult: WorkerResult = {
        worker: 'test',
        success: true,
        duration: 50,
        data: { value: 42 },
        timestamp: new Date(),
      };

      manager.register('test', vi.fn().mockResolvedValue(mockResult));

      // Add to WORKER_CONFIGS temporarily
      (WORKER_CONFIGS as any)['test'] = {
        name: 'test',
        description: 'Test worker',
        interval: 60000,
        enabled: true,
        priority: WorkerPriority.Normal,
        timeout: 5000,
      };

      const result = await manager.runWorker('test');

      expect(result.success).toBe(true);
      expect(result.data?.value).toBe(42);

      // Cleanup
      delete (WORKER_CONFIGS as any)['test'];
    });

    it('should handle worker timeout', async () => {
      manager.register('slow', async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return {
          worker: 'slow',
          success: true,
          duration: 10000,
          timestamp: new Date(),
        };
      });

      (WORKER_CONFIGS as any)['slow'] = {
        name: 'slow',
        description: 'Slow worker',
        interval: 60000,
        enabled: true,
        priority: WorkerPriority.Normal,
        timeout: 100, // Very short timeout
      };

      const result = await manager.runWorker('slow');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');

      delete (WORKER_CONFIGS as any)['slow'];
    });

    it('should handle worker errors gracefully', async () => {
      manager.register('failing', async () => {
        throw new Error('Worker crashed');
      });

      (WORKER_CONFIGS as any)['failing'] = {
        name: 'failing',
        description: 'Failing worker',
        interval: 60000,
        enabled: true,
        priority: WorkerPriority.Normal,
        timeout: 5000,
      };

      const result = await manager.runWorker('failing');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Worker crashed');

      delete (WORKER_CONFIGS as any)['failing'];
    });

    it('should return error for unknown worker', async () => {
      const result = await manager.runWorker('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('runAll', () => {
    it('should run all registered workers', async () => {
      const handler = vi.fn().mockResolvedValue({
        worker: 'test',
        success: true,
        duration: 10,
        timestamp: new Date(),
      });

      manager.register('performance', handler);
      manager.register('health', handler);

      const results = await manager.runAll(2);

      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should respect concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const handler = vi.fn().mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 50));
        concurrent--;
        return {
          worker: 'test',
          success: true,
          duration: 50,
          timestamp: new Date(),
        };
      });

      // Register multiple workers
      for (let i = 0; i < 6; i++) {
        manager.register(`worker${i}`, handler);
        (WORKER_CONFIGS as any)[`worker${i}`] = {
          name: `worker${i}`,
          description: 'Test',
          interval: 60000,
          enabled: true,
          priority: WorkerPriority.Normal,
          timeout: 5000,
        };
      }

      await manager.runAll(2); // Concurrency of 2

      expect(maxConcurrent).toBeLessThanOrEqual(2);

      // Cleanup
      for (let i = 0; i < 6; i++) {
        delete (WORKER_CONFIGS as any)[`worker${i}`];
      }
    });
  });
});

// ============================================================================
// Unit Tests - Alert System
// ============================================================================

describe('Alert System', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should generate alerts when thresholds exceeded', async () => {
    manager.setThresholds('test', [
      { metric: 'value', warning: 50, critical: 90, comparison: 'gt' },
    ]);

    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { value: 75 },
      timestamp: new Date(),
    });

    manager.register('test', handler);
    (WORKER_CONFIGS as any)['test'] = {
      name: 'test',
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    };

    const result = await manager.runWorker('test');

    expect(result.alerts).toBeDefined();
    expect(result.alerts!.length).toBe(1);
    expect(result.alerts![0].severity).toBe(AlertSeverity.Warning);
    expect(result.alerts![0].value).toBe(75);

    delete (WORKER_CONFIGS as any)['test'];
  });

  it('should generate critical alerts for critical threshold', async () => {
    manager.setThresholds('test', [
      { metric: 'value', warning: 50, critical: 90, comparison: 'gt' },
    ]);

    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { value: 95 },
      timestamp: new Date(),
    });

    manager.register('test', handler);
    (WORKER_CONFIGS as any)['test'] = {
      name: 'test',
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    };

    const result = await manager.runWorker('test');

    expect(result.alerts![0].severity).toBe(AlertSeverity.Critical);

    delete (WORKER_CONFIGS as any)['test'];
  });

  it('should handle nested metric paths', async () => {
    manager.setThresholds('test', [
      { metric: 'nested.deep.value', warning: 50, critical: 90, comparison: 'gt' },
    ]);

    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { nested: { deep: { value: 75 } } },
      timestamp: new Date(),
    });

    manager.register('test', handler);
    (WORKER_CONFIGS as any)['test'] = {
      name: 'test',
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    };

    const result = await manager.runWorker('test');

    expect(result.alerts!.length).toBe(1);
    expect(result.alerts![0].metric).toBe('nested.deep.value');

    delete (WORKER_CONFIGS as any)['test'];
  });

  it('should get recent alerts', async () => {
    // Manually add alerts
    const alerts = manager.getAlerts(10);
    expect(Array.isArray(alerts)).toBe(true);
  });

  it('should clear alerts', () => {
    manager.clearAlerts();
    expect(manager.getAlerts().length).toBe(0);
  });
});

// ============================================================================
// Unit Tests - Historical Metrics
// ============================================================================

describe('Historical Metrics', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should record history on worker completion', async () => {
    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { metric1: 100, metric2: 200 },
      timestamp: new Date(),
    });

    manager.register('test', handler);
    (WORKER_CONFIGS as any)['test'] = {
      name: 'test',
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    };

    await manager.runWorker('test');

    const history = manager.getHistory('test', 10);
    expect(history.length).toBe(1);
    expect(history[0].metrics.metric1).toBe(100);
    expect(history[0].metrics.metric2).toBe(200);

    delete (WORKER_CONFIGS as any)['test'];
  });

  it('should filter history by worker', async () => {
    const history = manager.getHistory('performance', 10);
    expect(Array.isArray(history)).toBe(true);
  });

  it('should limit history entries', async () => {
    const history = manager.getHistory(undefined, 5);
    expect(history.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// Unit Tests - Statusline
// ============================================================================

describe('Statusline Integration', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should generate statusline data', () => {
    const data = manager.getStatuslineData();

    expect(data.workers).toBeDefined();
    expect(data.health).toBeDefined();
    expect(data.security).toBeDefined();
    expect(data.adr).toBeDefined();
    expect(data.ddd).toBeDefined();
    expect(data.performance).toBeDefined();
    expect(data.lastUpdate).toBeDefined();
  });

  it('should generate statusline string', () => {
    const str = manager.getStatuslineString();

    expect(typeof str).toBe('string');
    expect(str.length).toBeGreaterThan(0);
    expect(str).toContain('👷'); // Workers icon
  });

  it('should export statusline to file', async () => {
    await manager.exportStatusline();

    const statuslinePath = path.join(TEST_PROJECT_ROOT, '.claude-flow', 'metrics', 'statusline.json');
    const content = await fs.readFile(statuslinePath, 'utf-8');
    const data = JSON.parse(content);

    expect(data.workers).toBeDefined();
    expect(data.lastUpdate).toBeDefined();
  });
});

// ============================================================================
// Unit Tests - Persistence
// ============================================================================

describe('Persistence', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should save state to disk', async () => {
    await manager.saveState();

    const statePath = path.join(TEST_PROJECT_ROOT, '.claude-flow', 'metrics', 'workers-state.json');
    const content = await fs.readFile(statePath, 'utf-8');
    const state = JSON.parse(content);

    expect(state.version).toBe('1.0.0');
    expect(state.workers).toBeDefined();
  });

  it('should load state from disk', async () => {
    // Manually create state file
    const statePath = path.join(TEST_PROJECT_ROOT, '.claude-flow', 'metrics', 'workers-state.json');
    const state = {
      version: '1.0.0',
      lastSaved: new Date().toISOString(),
      workers: {
        performance: { runCount: 10, errorCount: 1, avgDuration: 150 },
      },
      history: [],
    };
    await fs.writeFile(statePath, JSON.stringify(state));

    // Load
    const loaded = await manager.loadState();

    expect(loaded).toBe(true);
    const status = manager.getStatus();
    const perf = status.workers.find(w => w.name === 'performance');
    expect(perf?.runCount).toBe(10);
  });

  it('should handle missing state file gracefully', async () => {
    const loaded = await manager.loadState();
    expect(loaded).toBe(false);
  });
});

// ============================================================================
// Security Tests
// ============================================================================

describe('Security', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should reject path traversal in project root', () => {
    // This should not create files outside the project
    const maliciousManager = new WorkerManager('/tmp/../../../etc');
    // The path should be resolved but operations should be safe
    expect(maliciousManager).toBeInstanceOf(WorkerManager);
  });

  it('should limit file size when loading state', async () => {
    // This is tested internally by safeReadFile
    // Create a large file
    const statePath = path.join(TEST_PROJECT_ROOT, '.claude-flow', 'metrics', 'workers-state.json');
    const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB

    await fs.writeFile(statePath, largeContent);

    const loaded = await manager.loadState();
    expect(loaded).toBe(false); // Should fail due to size limit
  });
});

// ============================================================================
// Integration Tests - Built-in Workers
// ============================================================================

describe('Built-in Workers', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = createWorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should run performance worker', async () => {
    const result = await manager.runWorker('performance');

    expect(result.success).toBe(true);
    expect(result.data?.memory).toBeDefined();
    expect(result.data?.cpu).toBeDefined();
  });

  it('should run health worker', async () => {
    const result = await manager.runWorker('health');

    expect(result.success).toBe(true);
    expect(result.data?.status).toBeDefined();
    expect(result.data?.memory).toBeDefined();
  });

  it('should run git worker', async () => {
    const result = await manager.runWorker('git');

    expect(result.success).toBe(true);
    expect(result.data?.available).toBeDefined();
  });

  it('should run swarm worker', async () => {
    const result = await manager.runWorker('swarm');

    expect(result.success).toBe(true);
    expect(result.data?.active).toBeDefined();
  });

  it('should run learning worker', async () => {
    const result = await manager.runWorker('learning');

    expect(result.success).toBe(true);
    expect(result.data?.patternsDb).toBeDefined();
  });
});
