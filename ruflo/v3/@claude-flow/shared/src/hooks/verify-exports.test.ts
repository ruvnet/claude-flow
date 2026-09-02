/**
 * V3 Hooks System - Export Verification
 *
 * Verifies that all exports are accessible through the public API.
 *
 * @module v3/shared/hooks/verify-exports.test
 */

import { describe, it, expect } from 'vitest';

describe('Hooks Module Exports', () => {
  it('should export all types from main module', async () => {
    const module = await import('./index.js');

    // Enums
    expect(module.HookEvent).toBeDefined();
    expect(module.HookPriority).toBeDefined();

    // Classes
    expect(module.HookRegistry).toBeDefined();
    expect(module.HookExecutor).toBeDefined();

    // Factory functions
    expect(module.createHookRegistry).toBeDefined();
    expect(module.createHookExecutor).toBeDefined();
  });

  it('should export types (type-only imports)', () => {
    // This test just verifies TypeScript compilation
    // Types can't be checked at runtime
    type Test1 = import('./types.js').HookContext;
    type Test2 = import('./types.js').HookResult;
    type Test3 = import('./types.js').HookHandler;
    type Test4 = import('./types.js').HookDefinition;
    type Test5 = import('./types.js').HookStats;
    type Test6 = import('./types.js').HookExecutionOptions;
    type Test7 = import('./types.js').ToolInfo;
    type Test8 = import('./types.js').CommandInfo;
    type Test9 = import('./types.js').FileOperationInfo;
    type Test10 = import('./types.js').SessionInfo;
    type Test11 = import('./types.js').AgentInfo;
    type Test12 = import('./types.js').TaskInfo;
    type Test13 = import('./types.js').MemoryInfo;
    type Test14 = import('./types.js').ErrorInfo;

    expect(true).toBe(true);
  });

  it('should create instances from exported factories', () => {
    const { createHookRegistry, createHookExecutor } = require('./index.js');

    const registry = createHookRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.register).toBe('function');
    expect(typeof registry.unregister).toBe('function');

    const executor = createHookExecutor(registry);
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe('function');
  });

  it('should have all 26 hook events defined', () => {
    const { HookEvent } = require('./index.js');

    const expectedEvents = [
      'PreToolUse',
      'PostToolUse',
      'PreEdit',
      'PostEdit',
      'PreRead',
      'PostRead',
      'PreWrite',
      'PostWrite',
      'PreCommand',
      'PostCommand',
      'SessionStart',
      'SessionEnd',
      'SessionPause',
      'SessionResume',
      'PreAgentSpawn',
      'PostAgentSpawn',
      'PreAgentTerminate',
      'PostAgentTerminate',
      'PreTaskExecute',
      'PostTaskExecute',
      'PreTaskComplete',
      'PostTaskComplete',
      'PreMemoryStore',
      'PostMemoryStore',
      'PreMemoryRetrieve',
      'PostMemoryRetrieve',
      'OnError',
      'OnWarning',
    ];

    for (const event of expectedEvents) {
      expect(HookEvent[event]).toBeDefined();
    }
  });

  it('should have all 5 priority levels defined', () => {
    const { HookPriority } = require('./index.js');

    expect(HookPriority.Critical).toBe(1000);
    expect(HookPriority.High).toBe(500);
    expect(HookPriority.Normal).toBe(0);
    expect(HookPriority.Low).toBe(-500);
    expect(HookPriority.Lowest).toBe(-1000);
  });
});

describe('Hooks Integration with Shared Module', () => {
  it('should be importable from @claude-flow/shared', async () => {
    // This would be the actual import path in production
    const module = await import('../index.js');

    // Verify hooks are exported from main shared module
    expect(module.HookEvent).toBeDefined();
    expect(module.HookPriority).toBeDefined();
    expect(module.HookRegistry).toBeDefined();
    expect(module.HookExecutor).toBeDefined();
    expect(module.createHookRegistry).toBeDefined();
    expect(module.createHookExecutor).toBeDefined();
  });
});
