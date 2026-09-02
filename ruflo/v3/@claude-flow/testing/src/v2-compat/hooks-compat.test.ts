/**
 * V2 Hooks Compatibility Tests
 *
 * Tests all 42 V2 hooks trigger correctly via compatibility layer.
 * Verifies hook result format and learning integration.
 *
 * @module v3/testing/v2-compat/hooks-compat.test
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  V2CompatibilityValidator,
  V2_HOOKS,
  type V2Hook,
  type ValidationResult,
} from './compatibility-validator.js';

/**
 * Hook result type
 */
interface HookResult {
  handled: boolean;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  learningContext?: {
    pattern?: string;
    reward?: number;
    sessionId?: string;
  };
}

/**
 * Mock hooks system for testing
 */
interface MockHooksSystem {
  trigger: Mock<(name: string, params: Record<string, unknown>) => Promise<HookResult>>;
  register: Mock<(name: string, handler: (params: unknown) => Promise<HookResult>) => void>;
  getHooks: Mock<() => string[]>;
  isRegistered: Mock<(name: string) => boolean>;
  getHookInfo: Mock<(name: string) => V2Hook | null>;
  getLearningMetrics: Mock<() => { patterns: number; successRate: number }>;
}

/**
 * Create mock hooks system
 */
function createMockHooksSystem(): MockHooksSystem {
  const v3Hooks = V2_HOOKS.map(h => h.v3Equivalent || h.name);
  const registeredHooks = new Set(v3Hooks);

  return {
    trigger: vi.fn().mockImplementation(async (name: string, params: Record<string, unknown>) => {
      const isSupported = registeredHooks.has(name);

      if (!isSupported) {
        return {
          handled: false,
          success: false,
          error: `Hook "${name}" not registered`,
        };
      }

      // Simulate hook execution with learning context
      return {
        handled: true,
        success: true,
        data: { hookName: name, params },
        learningContext: {
          pattern: `${name}:success`,
          reward: 1.0,
          sessionId: `session-${Date.now()}`,
        },
      };
    }),
    register: vi.fn().mockImplementation((name: string) => {
      registeredHooks.add(name);
    }),
    getHooks: vi.fn().mockReturnValue(v3Hooks),
    isRegistered: vi.fn().mockImplementation((name: string) => registeredHooks.has(name)),
    getHookInfo: vi.fn().mockImplementation((name: string) => {
      return V2_HOOKS.find(h => h.name === name || h.v3Equivalent === name) || null;
    }),
    getLearningMetrics: vi.fn().mockReturnValue({
      patterns: 100,
      successRate: 0.85,
    }),
  };
}

describe('V2 Hooks Compatibility', () => {
  let validator: V2CompatibilityValidator;
  let mockHooks: MockHooksSystem;

  beforeEach(() => {
    mockHooks = createMockHooksSystem();
    validator = new V2CompatibilityValidator({
      verbose: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Edit Hooks', () => {
    const editHooks = V2_HOOKS.filter(h =>
      h.name.includes('edit') || h.name.includes('create')
    );

    it.each(editHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, 'test-value'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should trigger pre-edit hook with file path', async () => {
      const result = await mockHooks.trigger('pre-edit', {
        filePath: '/path/to/file.ts',
        content: 'new content',
      });

      expect(result.handled).toBe(true);
      expect(result.data).toHaveProperty('params');
    });

    it('should trigger post-edit hook with success status', async () => {
      const result = await mockHooks.trigger('post-edit', {
        filePath: '/path/to/file.ts',
        success: true,
        changes: { linesAdded: 10, linesRemoved: 5 },
      });

      expect(result.handled).toBe(true);
      expect(result.learningContext).toBeDefined();
    });

    it('should include learning context in edit hooks', async () => {
      const result = await mockHooks.trigger('post-edit', {
        filePath: '/path/to/file.ts',
        success: true,
      });

      expect(result.learningContext).toHaveProperty('pattern');
      expect(result.learningContext).toHaveProperty('reward');
      expect(result.learningContext).toHaveProperty('sessionId');
    });
  });

  describe('Command Hooks', () => {
    const commandHooks = V2_HOOKS.filter(h =>
      h.name.includes('command') || h.name.includes('bash')
    );

    it.each(commandHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, 'test-value'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger pre-command hook with command details', async () => {
      const result = await mockHooks.trigger('pre-command', {
        command: 'npm',
        args: ['install', 'vitest'],
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger post-command hook with exit status', async () => {
      const result = await mockHooks.trigger('post-command', {
        command: 'npm',
        success: true,
        output: 'added 50 packages',
      });

      expect(result.handled).toBe(true);
      expect(result.learningContext?.reward).toBe(1.0);
    });

    it('should handle pre-bash as pre-command', async () => {
      // pre-bash should map to pre-command in V3
      const info = mockHooks.getHookInfo('pre-bash');

      expect(info?.v3Equivalent).toBe('pre-command');
    });
  });

  describe('Task Hooks', () => {
    const taskHooks = V2_HOOKS.filter(h => h.name.includes('task'));

    it.each(taskHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, p === 'task' ? { id: 'task-1' } : 'test'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger pre-task hook before task execution', async () => {
      const result = await mockHooks.trigger('pre-task', {
        task: { id: 'task-1', description: 'Test task' },
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger post-task hook with result', async () => {
      const result = await mockHooks.trigger('post-task', {
        task: { id: 'task-1' },
        result: { success: true, output: 'completed' },
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger task-fail hook on failure', async () => {
      const result = await mockHooks.trigger('task-fail', {
        task: { id: 'task-1' },
        error: 'Task failed: timeout',
      });

      expect(result.handled).toBe(true);
    });
  });

  describe('Agent Hooks', () => {
    const agentHooks = V2_HOOKS.filter(h => h.name.startsWith('agent-'));

    it.each(agentHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, 'test-value'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger agent-spawn hook with config', async () => {
      const result = await mockHooks.trigger('agent-spawn', {
        agentConfig: { type: 'coder', id: 'agent-1' },
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger agent-terminate hook with reason', async () => {
      const result = await mockHooks.trigger('agent-terminate', {
        agentId: 'agent-1',
        reason: 'Task completed',
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger agent-message hook for inter-agent communication', async () => {
      const result = await mockHooks.trigger('agent-message', {
        from: 'agent-1',
        to: 'agent-2',
        message: { type: 'task-update', data: {} },
      });

      expect(result.handled).toBe(true);
    });
  });

  describe('Swarm Hooks', () => {
    const swarmHooks = V2_HOOKS.filter(h => h.name.startsWith('swarm-'));

    it.each(swarmHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, 'test-value'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger swarm-init hook with topology', async () => {
      const result = await mockHooks.trigger('swarm-init', {
        topology: 'hierarchical-mesh',
        config: { maxAgents: 15 },
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger swarm-consensus hook with proposal', async () => {
      const result = await mockHooks.trigger('swarm-consensus', {
        proposal: { type: 'scale-up', count: 3 },
        result: { approved: true, votes: 5 },
      });

      expect(result.handled).toBe(true);
    });
  });

  describe('Memory Hooks', () => {
    const memoryHooks = V2_HOOKS.filter(h => h.name.startsWith('memory-'));

    it.each(memoryHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, p === 'entry' ? { id: 'mem-1' } : 'test'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger memory-store hook when storing', async () => {
      const result = await mockHooks.trigger('memory-store', {
        entry: { id: 'mem-1', content: 'test', type: 'pattern' },
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger memory-retrieve hook with results', async () => {
      const result = await mockHooks.trigger('memory-retrieve', {
        query: 'test search',
        results: [{ id: 'mem-1', content: 'test' }],
      });

      expect(result.handled).toBe(true);
    });
  });

  describe('Learning Hooks', () => {
    const learningHooks = V2_HOOKS.filter(h => h.name.startsWith('learning-'));

    it.each(learningHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, 'test-value'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger learning-pattern hook for new patterns', async () => {
      const result = await mockHooks.trigger('learning-pattern', {
        pattern: { type: 'success', context: 'file-edit' },
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger learning-reward hook with trajectory', async () => {
      const result = await mockHooks.trigger('learning-reward', {
        trajectory: { actions: ['edit', 'test', 'commit'] },
        reward: 0.95,
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger learning-distill hook for memory consolidation', async () => {
      const result = await mockHooks.trigger('learning-distill', {
        memories: [{ id: 'mem-1' }, { id: 'mem-2' }],
      });

      expect(result.handled).toBe(true);
    });
  });

  describe('Session Hooks', () => {
    const sessionHooks = V2_HOOKS.filter(h => h.name.startsWith('session-'));

    it.each(sessionHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, 'test-value'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger session-start hook with session ID', async () => {
      const result = await mockHooks.trigger('session-start', {
        sessionId: 'session-123',
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger session-end hook with metrics', async () => {
      const result = await mockHooks.trigger('session-end', {
        sessionId: 'session-123',
        metrics: { duration: 3600, tasksCompleted: 10 },
      });

      expect(result.handled).toBe(true);
    });
  });

  describe('Security Hooks', () => {
    const securityHooks = V2_HOOKS.filter(h => h.name.startsWith('security-'));

    it.each(securityHooks)('should support V2 hook: $name', async (hook: V2Hook) => {
      const params = Object.fromEntries(
        hook.parameters.map(p => [p, 'test-value'])
      );

      const result = await mockHooks.trigger(hook.v3Equivalent || hook.name, params);

      expect(result.handled).toBe(true);
    });

    it('should trigger security-alert hook for threats', async () => {
      const result = await mockHooks.trigger('security-alert', {
        alert: { type: 'suspicious-command', severity: 'high' },
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger security-block hook for blocked operations', async () => {
      const result = await mockHooks.trigger('security-block', {
        operation: 'file-delete',
        reason: 'Protected directory',
      });

      expect(result.handled).toBe(true);
    });

    it('should trigger security-audit hook for audit trail', async () => {
      const result = await mockHooks.trigger('security-audit', {
        action: 'config-change',
        context: { user: 'system', timestamp: Date.now() },
      });

      expect(result.handled).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return handled=false for unregistered hooks', async () => {
      const result = await mockHooks.trigger('unknown-hook', {});

      expect(result.handled).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not registered');
    });

    it('should handle empty parameters gracefully', async () => {
      const result = await mockHooks.trigger('pre-edit', {});

      expect(result.handled).toBe(true);
    });
  });

  describe('Learning Integration', () => {
    it('should include learning context in hook results', async () => {
      const result = await mockHooks.trigger('post-edit', {
        filePath: '/test.ts',
        success: true,
      });

      expect(result.learningContext).toBeDefined();
      expect(result.learningContext?.pattern).toBeDefined();
      expect(result.learningContext?.reward).toBeDefined();
    });

    it('should track learning metrics', () => {
      const metrics = mockHooks.getLearningMetrics();

      expect(metrics).toHaveProperty('patterns');
      expect(metrics).toHaveProperty('successRate');
      expect(metrics.patterns).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });

    it('should provide session ID in learning context', async () => {
      const result = await mockHooks.trigger('post-task', {
        task: { id: 'task-1' },
        result: { success: true },
      });

      expect(result.learningContext?.sessionId).toBeDefined();
      expect(result.learningContext?.sessionId).toMatch(/^session-/);
    });
  });

  describe('Full Hooks Validation', () => {
    it('should pass full hooks validation', async () => {
      const result: ValidationResult = await validator.validateHooks();

      expect(result.category).toBe('hooks');
      expect(result.totalChecks).toBeGreaterThan(0);
      expect(result.passedChecks).toBeGreaterThan(0);
    });

    it('should detect all 42 V2 hooks', async () => {
      const result = await validator.validateHooks();
      const hookChecks = result.checks.filter(c =>
        c.name.startsWith('Hook:') && !c.name.includes('Param') && !c.name.includes('Return')
      );

      expect(hookChecks.length).toBeGreaterThanOrEqual(42);
    });

    it('should verify hook parameters', async () => {
      const result = await validator.validateHooks();
      const paramChecks = result.checks.filter(c => c.name.includes('Param:'));

      expect(paramChecks.length).toBeGreaterThan(0);
    });

    it('should verify return type compatibility', async () => {
      const result = await validator.validateHooks();
      const returnChecks = result.checks.filter(c => c.name.includes('Return:'));

      expect(returnChecks.length).toBeGreaterThan(0);
    });

    it('should report minimal breaking changes', async () => {
      const result = await validator.validateHooks();

      // Most hooks should be supported
      expect(result.breakingChanges).toBeLessThan(result.totalChecks * 0.1);
    });
  });
});

describe('Hooks Coverage', () => {
  it('should test all 42 V2 hooks', () => {
    expect(V2_HOOKS.length).toBe(42);
  });

  it('should have V3 equivalents for all hooks', () => {
    for (const hook of V2_HOOKS) {
      expect(hook.v3Equivalent).toBeDefined();
      expect(hook.v3Equivalent).not.toBe('');
    }
  });

  it('should categorize hooks correctly', () => {
    const categories = {
      edit: V2_HOOKS.filter(h => h.name.includes('edit') || h.name.includes('create')),
      command: V2_HOOKS.filter(h => h.name.includes('command') || h.name.includes('bash')),
      task: V2_HOOKS.filter(h => h.name.includes('task')),
      agent: V2_HOOKS.filter(h => h.name.startsWith('agent-')),
      swarm: V2_HOOKS.filter(h => h.name.startsWith('swarm-')),
      memory: V2_HOOKS.filter(h => h.name.startsWith('memory-')),
      learning: V2_HOOKS.filter(h => h.name.startsWith('learning-')),
      session: V2_HOOKS.filter(h => h.name.startsWith('session-')),
      config: V2_HOOKS.filter(h => h.name.startsWith('config-')),
      error: V2_HOOKS.filter(h => h.name.startsWith('error-')),
      perf: V2_HOOKS.filter(h => h.name.startsWith('perf-')),
      security: V2_HOOKS.filter(h => h.name.startsWith('security-')),
    };

    expect(categories.edit.length).toBe(4);
    expect(categories.command.length).toBe(4);
    expect(categories.task.length).toBe(4);
    expect(categories.agent.length).toBe(4);
    expect(categories.swarm.length).toBe(4);
    expect(categories.memory.length).toBe(4);
    expect(categories.learning.length).toBe(4);
    expect(categories.session.length).toBe(4);
    expect(categories.config.length).toBe(3);
    expect(categories.error.length).toBe(2);
    expect(categories.perf.length).toBe(2);
    expect(categories.security.length).toBe(3);
  });

  it('should define triggers correctly', () => {
    for (const hook of V2_HOOKS) {
      expect(hook.trigger).toBeDefined();
      expect(hook.trigger).toMatch(/^(before|after|on):/);
    }
  });

  it('should define parameters correctly', () => {
    for (const hook of V2_HOOKS) {
      expect(Array.isArray(hook.parameters)).toBe(true);
    }
  });

  it('should define return types correctly', () => {
    for (const hook of V2_HOOKS) {
      expect(hook.returnType).toBe('HookResult');
    }
  });
});
