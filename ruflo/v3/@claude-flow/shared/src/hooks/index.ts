/**
 * V3 Hooks System - Main Export
 *
 * Provides extensible hook points for tool execution, file operations,
 * and session lifecycle events. Integrates with event bus for coordination.
 *
 * Example usage:
 *
 * ```typescript
 * import { createHookRegistry, createHookExecutor, HookEvent, HookPriority } from '@claude-flow/shared/hooks';
 *
 * const registry = createHookRegistry();
 * const executor = createHookExecutor(registry, eventBus);
 *
 * // Register a hook
 * const hookId = registry.register(
 *   HookEvent.PreToolUse,
 *   async (context) => {
 *     console.log('Before tool use:', context.tool?.name);
 *     return { success: true };
 *   },
 *   HookPriority.High
 * );
 *
 * // Execute hooks
 * const result = await executor.execute(
 *   HookEvent.PreToolUse,
 *   {
 *     event: HookEvent.PreToolUse,
 *     timestamp: new Date(),
 *     tool: { name: 'Read', parameters: { path: 'file.ts' } }
 *   }
 * );
 *
 * // Unregister hook
 * registry.unregister(hookId);
 * ```
 *
 * @module v3/shared/hooks
 */

// Export types
export type {
  HookContext,
  HookResult,
  HookHandler,
  HookDefinition,
  HookStats,
  HookExecutionOptions,
  ToolInfo,
  CommandInfo,
  FileOperationInfo,
  SessionInfo,
  AgentInfo,
  TaskInfo,
  MemoryInfo,
  ErrorInfo,
} from './types.js';

export {
  HookEvent,
  HookPriority,
} from './types.js';

// Export registry
export {
  HookRegistry,
  createHookRegistry,
} from './registry.js';

// Export executor
export type {
  AggregatedHookResult,
} from './executor.js';

export {
  HookExecutor,
  createHookExecutor,
} from './executor.js';

// Export task hooks
export {
  TaskHooksManager,
  createTaskHooksManager,
} from './task-hooks.js';

export type {
  PreTaskHookResult,
  PostTaskHookResult,
  AgentSuggestion,
  TaskPattern,
  TaskOutcome,
  LearningUpdate,
} from './task-hooks.js';

// Export session hooks
export {
  SessionHooksManager,
  createSessionHooksManager,
  InMemorySessionStorage,
} from './session-hooks.js';

export type {
  SessionState,
  SessionEndHookResult,
  SessionRestoreHookResult,
  SessionSummary,
  SessionStorage,
} from './session-hooks.js';

// Export safety hooks
export {
  BashSafetyHook,
  createBashSafetyHook,
  FileOrganizationHook,
  createFileOrganizationHook,
  GitCommitHook,
  createGitCommitHook,
} from './safety/index.js';

export type {
  BashSafetyResult,
  CommandRisk,
  FileOrganizationResult,
  FormatterRecommendation,
  LinterRecommendation,
  OrganizationIssue,
  GitCommitResult,
  CommitType,
  CommitValidationIssue,
} from './safety/index.js';
