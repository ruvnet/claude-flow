/**
 * Legacy Hook System - Migration Notice
 * 
 * This hook system has been consolidated with the more advanced agentic-flow-hooks system.
 * All functionality is now available through the modern implementation at:
 * src/services/agentic-flow-hooks/
 * 
 * This file provides backward compatibility redirects while we complete the migration.
 */

// Re-export the modern agentic-flow-hooks system
export {
  agenticHookManager,
  initializeAgenticFlowHooks,
} from '../services/agentic-flow-hooks/index.js';

// Re-export verification system
export {
  verificationHookManager,
  initializeVerificationSystem,
  getVerificationSystemStatus,
  shutdownVerificationSystem,
} from '../verification/index.js';

// Re-export modern types with compatibility aliases
export type {
  AgenticHookContext as HookExecutionContext,
  HookRegistration as AgentHook,
  HookPayload as EventPayload,
  AgenticHookType as HookTrigger,
  HookHandlerResult as HookExecutionResult,
} from '../services/agentic-flow-hooks/types.js';

// Legacy hook templates for backward compatibility
export const QUALITY_HOOKS = {
  CODE_QUALITY: {
    name: 'Code Quality Monitor',
    description: 'Automatically runs code quality checks on file changes',
    type: 'workflow-step' as const,
    priority: 8,
    enabled: true
  },
  SECURITY_SCAN: {
    name: 'Security Scanner', 
    description: 'Scans for security vulnerabilities and credential leaks',
    type: 'workflow-step' as const,
    priority: 9,
    enabled: true
  },
  DOCUMENTATION_SYNC: {
    name: 'Documentation Sync',
    description: 'Automatically updates documentation when specifications change',
    type: 'workflow-step' as const,
    priority: 7,
    enabled: true
  },
  PERFORMANCE_MONITOR: {
    name: 'Performance Monitor',
    description: 'Analyzes performance impact of code changes', 
    type: 'workflow-step' as const,
    priority: 6,
    enabled: true
  }
};

// Legacy constants for backward compatibility
export const DEFAULT_HOOK_CONFIG = {
  maxConcurrentHooks: 10,
  defaultThrottleMs: 1000,
  defaultDebounceMs: 500,
  eventQueueSize: 1000,
  agentPoolSize: 50,
  enableMetrics: true,
  enablePersistence: true,
  logLevel: 'info' as const,
  watchPatterns: ['**/*.md', '**/*.ts', '**/*.js', '**/*.json'],
  ignorePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
};

export const HOOK_TRIGGERS = {
  FILE_SAVE: 'workflow-step',
  FILE_CHANGE: 'workflow-step',
  FILE_CREATE: 'workflow-start',
  FILE_DELETE: 'workflow-complete',
  TASK_COMPLETE: 'workflow-complete',
  TASK_FAIL: 'workflow-error',
  SPEC_UPDATE: 'workflow-step',
  CODE_CHANGE: 'workflow-step',
  AGENT_SPAWN: 'workflow-start',
  WORKFLOW_PHASE: 'workflow-step',
  TIME_INTERVAL: 'performance-metric'
} as const;

export const AGENT_TYPES = {
  QUALITY_ASSURANCE: 'quality_assurance',
  SECURITY_SCAN: 'security_scan', 
  DOCUMENTATION_SYNC: 'documentation_sync',
  PERFORMANCE_ANALYSIS: 'performance_analysis'
} as const;

/**
 * Migration utility class
 * Provides backward compatibility while encouraging migration to agentic-flow-hooks
 */
export class HookUtils {
  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createFilePatternCondition(pattern: string) {
    console.warn('HookUtils.createFilePatternCondition is deprecated. Use agenticHookManager.register() with proper HookFilter instead.');
    return { type: 'file_pattern', pattern };
  }

  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createSpawnAgentAction(agentType: string, config: Record<string, any>) {
    console.warn('HookUtils.createSpawnAgentAction is deprecated. Use agenticHookManager.register() with proper hook handlers instead.');
    return { type: 'spawn_agent', agentType, agentConfig: config };
  }

  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createQualityHook(options: any) {
    console.warn('HookUtils.createQualityHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.');
    return QUALITY_HOOKS.CODE_QUALITY;
  }

  /**
   * @deprecated Use agenticHookManager.register() instead  
   */
  static createSecurityHook(options: any) {
    console.warn('HookUtils.createSecurityHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.');
    return QUALITY_HOOKS.SECURITY_SCAN;
  }

  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createDocumentationHook(options: any) {
    console.warn('HookUtils.createDocumentationHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.');
    return QUALITY_HOOKS.DOCUMENTATION_SYNC;
  }

  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createPerformanceHook(options: any) {
    console.warn('HookUtils.createPerformanceHook is deprecated. Use agenticHookManager.register() with performance-metric hooks instead.');
    return QUALITY_HOOKS.PERFORMANCE_MONITOR;
  }
}

/**
 * @deprecated Use initializeAgenticFlowHooks() instead
 */
export function createHookEngine(config?: any) {
  console.warn('createHookEngine is deprecated. Use initializeAgenticFlowHooks() and agenticHookManager instead.');
  return {
    registerHook: () => console.warn('Use agenticHookManager.register() instead'),
    start: () => console.warn('Hooks are automatically initialized with agenticHookManager'),
    stop: () => console.warn('Use agenticHookManager shutdown methods instead')
  };
}

/**
 * @deprecated Use agenticHookManager.register() for individual hooks instead
 */
export async function setupDefaultHooks(engine?: any) {
  console.warn('setupDefaultHooks is deprecated. Use agenticHookManager.register() to register specific hooks instead.');
  console.info('Consider migrating to agentic-flow-hooks for advanced pipeline management and neural integration.');
  
  // Initialize verification system as part of default setup
  try {
    const { initializeVerificationSystem } = await import('../verification/index.js');
    await initializeVerificationSystem();
    console.info('✅ Verification system initialized with default hooks');
    return 9; // 4 legacy + 5 verification hooks
  } catch (error) {
    console.warn('Failed to initialize verification system:', error);
    return 4; // Return legacy count for backward compatibility
  }
}

// Migration notice for users
console.info(`
🔄 MIGRATION NOTICE: Hook System Consolidation

The legacy hook system in src/hooks/ has been consolidated with the advanced
agentic-flow-hooks system for better performance and functionality.

✅ New System Features:
  - Advanced pipeline management
  - Neural pattern learning  
  - Performance optimization
  - Memory coordination hooks
  - LLM integration hooks
  - Comprehensive verification system

🆕 Verification System:
  - Pre-task verification hooks
  - Post-task validation hooks
  - Integration test hooks
  - Truth telemetry hooks
  - Rollback trigger hooks

📖 Migration Guide:
  - Replace AgentHookEngine with agenticHookManager
  - Update hook registrations to use modern HookRegistration interface
  - Leverage new hook types: LLM, memory, neural, performance, workflow
  - Use verification hooks for quality assurance
  - See docs/maestro/specs/hooks-refactoring-plan.md for details

🚀 Get Started:
  import { agenticHookManager, initializeAgenticFlowHooks } from '../services/agentic-flow-hooks/'
  import { verificationHookManager, initializeVerificationSystem } from '../verification/'
  await initializeAgenticFlowHooks()
  await initializeVerificationSystem()
  agenticHookManager.register({ ... })
`);