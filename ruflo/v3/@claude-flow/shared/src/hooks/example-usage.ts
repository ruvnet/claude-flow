/**
 * V3 Hooks System - Example Usage
 *
 * Demonstrates practical use cases for the hooks system.
 *
 * @module v3/shared/hooks/example-usage
 */

import { createHookRegistry } from './registry.js';
import { createHookExecutor } from './executor.js';
import { HookEvent, HookPriority, HookContext } from './types.js';
import { createEventBus } from '../core/event-bus.js';

// =============================================================================
// Example 1: Security Hooks - Prevent Dangerous Commands
// =============================================================================

export function setupSecurityHooks() {
  const registry = createHookRegistry();
  const eventBus = createEventBus();
  const executor = createHookExecutor(registry, eventBus);

  // Block dangerous commands
  registry.register(
    HookEvent.PreCommand,
    async (context) => {
      const dangerousPatterns = [
        /rm\s+-rf\s+\//,
        /format\s+c:/i,
        /del\s+\/f\s+\/s\s+\/q/i,
        /dd\s+if=/,
      ];

      const command = context.command?.command || '';

      for (const pattern of dangerousPatterns) {
        if (pattern.test(command)) {
          return {
            success: false,
            abort: true,
            error: new Error(`🛡️  Dangerous command blocked: ${command}`),
          };
        }
      }

      return { success: true };
    },
    HookPriority.Critical,
    {
      name: 'Security: Block Dangerous Commands',
      metadata: { category: 'security' },
    }
  );

  // Log security-sensitive commands
  registry.register(
    HookEvent.PostCommand,
    async (context) => {
      const sensitiveKeywords = ['password', 'secret', 'key', 'token', 'auth'];
      const command = context.command?.command.toLowerCase() || '';

      if (sensitiveKeywords.some(keyword => command.includes(keyword))) {
        console.warn('⚠️  Security-sensitive command executed:', command);
      }

      return { success: true };
    },
    HookPriority.Normal,
    {
      name: 'Security: Audit Sensitive Commands',
    }
  );

  return { registry, executor };
}

// =============================================================================
// Example 2: Learning Hooks - ReasoningBank Integration
// =============================================================================

export function setupLearningHooks() {
  const registry = createHookRegistry();
  const eventBus = createEventBus();
  const executor = createHookExecutor(registry, eventBus);

  // Pre-edit: Retrieve similar past edits
  registry.register(
    HookEvent.PreEdit,
    async (context) => {
      const filePath = context.file?.path;
      if (!filePath) {
        return { success: true };
      }

      console.log(`📚 Searching for similar edits to ${filePath}...`);

      // Example ReasoningBank search results (replace with actual agentic-flow call)
      const similarEdits = [
        { task: `Edit ${filePath}`, reward: 0.92, critique: 'Good test coverage' },
        { task: `Edit ${filePath}`, reward: 0.88, critique: 'Could improve error handling' },
      ];

      return {
        success: true,
        data: {
          metadata: {
            ...context.metadata,
            learningContext: similarEdits,
          },
        },
      };
    },
    HookPriority.High,
    {
      name: 'Learning: Pre-Edit Context Retrieval',
      timeout: 2000,
    }
  );

  // Post-edit: Store edit pattern
  registry.register(
    HookEvent.PostEdit,
    async (context) => {
      const success = context.metadata?.editSuccess ?? true;
      const filePath = context.file?.path;

      if (!filePath) {
        return { success: true };
      }

      console.log(`💾 Storing edit pattern for ${filePath} (success: ${success})`);

      // Example ReasoningBank storage (replace with actual agentic-flow call)
      const pattern = {
        task: `Edit ${filePath}`,
        reward: success ? 0.9 : 0.3,
        success,
      };

      console.log('Pattern stored:', pattern);

      return { success: true };
    },
    HookPriority.Normal,
    {
      name: 'Learning: Post-Edit Pattern Storage',
    }
  );

  return { registry, executor };
}

// =============================================================================
// Example 3: Performance Monitoring Hooks
// =============================================================================

export function setupPerformanceHooks() {
  const registry = createHookRegistry();
  const eventBus = createEventBus();
  const executor = createHookExecutor(registry, eventBus);

  const performanceMetrics = new Map<string, { start: number; end?: number }>();

  // Start performance tracking
  registry.register(
    HookEvent.PreToolUse,
    async (context) => {
      const toolName = context.tool?.name;
      if (!toolName) {
        return { success: true };
      }

      const metricId = `tool-${toolName}-${Date.now()}`;
      performanceMetrics.set(metricId, { start: Date.now() });

      return {
        success: true,
        data: {
          metadata: {
            ...context.metadata,
            performanceMetricId: metricId,
          },
        },
      };
    },
    HookPriority.High,
    {
      name: 'Performance: Start Tool Tracking',
    }
  );

  // End performance tracking
  registry.register(
    HookEvent.PostToolUse,
    async (context) => {
      const metricId = context.metadata?.performanceMetricId as string;
      if (!metricId) {
        return { success: true };
      }

      const metric = performanceMetrics.get(metricId);
      if (metric) {
        metric.end = Date.now();
        const duration = metric.end - metric.start;

        console.log(`⏱️  Tool ${context.tool?.name} took ${duration}ms`);

        if (duration > 5000) {
          console.warn(`⚠️  Slow tool execution detected: ${duration}ms`);
        }
      }

      return { success: true };
    },
    HookPriority.Normal,
    {
      name: 'Performance: End Tool Tracking',
    }
  );

  return { registry, executor, performanceMetrics };
}

// =============================================================================
// Example 4: File Validation Hooks
// =============================================================================

export function setupFileValidationHooks() {
  const registry = createHookRegistry();
  const eventBus = createEventBus();
  const executor = createHookExecutor(registry, eventBus);

  // Validate file paths
  registry.register(
    HookEvent.PreWrite,
    async (context) => {
      const filePath = context.file?.path;
      if (!filePath) {
        return { success: true };
      }

      // Check for dangerous paths
      const dangerousPaths = ['../', '/etc/', '/sys/', 'C:\\Windows'];
      if (dangerousPaths.some(path => filePath.includes(path))) {
        return {
          success: false,
          abort: true,
          error: new Error(`🛡️  Dangerous file path blocked: ${filePath}`),
        };
      }

      // Check for sensitive files
      const sensitivePatterns = ['.env', 'credentials', 'secrets', '.pem', '.key'];
      if (sensitivePatterns.some(pattern => filePath.includes(pattern))) {
        console.warn(`⚠️  Writing to sensitive file: ${filePath}`);
      }

      return { success: true };
    },
    HookPriority.Critical,
    {
      name: 'File: Validate Write Path',
    }
  );

  // Check file size limits
  registry.register(
    HookEvent.PreWrite,
    async (context) => {
      const content = context.file?.content;
      if (!content) {
        return { success: true };
      }

      const maxSize = 10 * 1024 * 1024; // 10MB
      const size = Buffer.byteLength(content, 'utf8');

      if (size > maxSize) {
        return {
          success: false,
          abort: true,
          error: new Error(`File too large: ${size} bytes (max: ${maxSize})`),
        };
      }

      return { success: true };
    },
    HookPriority.High,
    {
      name: 'File: Check Size Limit',
    }
  );

  return { registry, executor };
}

// =============================================================================
// Example 5: Session Management Hooks
// =============================================================================

export function setupSessionHooks() {
  const registry = createHookRegistry();
  const eventBus = createEventBus();
  const executor = createHookExecutor(registry, eventBus);

  let activeSession: { id: string; startTime: Date } | null = null;

  // Initialize session
  registry.register(
    HookEvent.SessionStart,
    async (context) => {
      const sessionId = context.session?.id || `session-${Date.now()}`;

      activeSession = {
        id: sessionId,
        startTime: new Date(),
      };

      console.log(`🚀 Session started: ${sessionId}`);

      return {
        success: true,
        data: {
          session: {
            id: sessionId,
            startTime: activeSession.startTime,
          },
        },
      };
    },
    HookPriority.Critical,
    {
      name: 'Session: Initialize',
    }
  );

  // Cleanup session
  registry.register(
    HookEvent.SessionEnd,
    async (context) => {
      if (activeSession) {
        const duration = Date.now() - activeSession.startTime.getTime();
        console.log(`👋 Session ended: ${activeSession.id} (duration: ${duration}ms)`);

        activeSession = null;
      }

      return { success: true };
    },
    HookPriority.Critical,
    {
      name: 'Session: Cleanup',
    }
  );

  return { registry, executor };
}

// =============================================================================
// Example 6: Error Handling Hooks
// =============================================================================

export function setupErrorHooks() {
  const registry = createHookRegistry();
  const eventBus = createEventBus();
  const executor = createHookExecutor(registry, eventBus);

  const errorLog: Array<{ timestamp: Date; error: Error; context?: string }> = [];

  // Log all errors
  registry.register(
    HookEvent.OnError,
    async (context) => {
      const error = context.error?.error;
      if (!error) {
        return { success: true };
      }

      errorLog.push({
        timestamp: new Date(),
        error,
        context: context.error?.context,
      });

      console.error(`❌ Error occurred:`, error.message);

      return { success: true };
    },
    HookPriority.High,
    {
      name: 'Error: Log Errors',
    }
  );

  // Attempt recovery for recoverable errors
  registry.register(
    HookEvent.OnError,
    async (context) => {
      const recoverable = context.error?.recoverable ?? false;

      if (recoverable) {
        console.log(`🔄 Attempting error recovery...`);
        // Implement recovery logic here
      }

      return { success: true };
    },
    HookPriority.Normal,
    {
      name: 'Error: Attempt Recovery',
    }
  );

  return { registry, executor, errorLog };
}

// =============================================================================
// Demo: Run All Examples
// =============================================================================

export async function runDemo() {
  console.log('='.repeat(60));
  console.log('V3 Hooks System - Demo');
  console.log('='.repeat(60));

  // Example 1: Security Hooks
  console.log('\n📋 Example 1: Security Hooks');
  const { executor: securityExecutor } = setupSecurityHooks();

  const dangerousCommand: HookContext = {
    event: HookEvent.PreCommand,
    timestamp: new Date(),
    command: {
      command: 'rm -rf /',
      isDestructive: true,
    },
  };

  const securityResult = await securityExecutor.execute(
    HookEvent.PreCommand,
    dangerousCommand
  );

  console.log(`Security result: ${securityResult.success ? '✅ Passed' : '❌ Blocked'}`);

  // Example 2: Learning Hooks
  console.log('\n📋 Example 2: Learning Hooks');
  const { executor: learningExecutor } = setupLearningHooks();

  const editContext: HookContext = {
    event: HookEvent.PreEdit,
    timestamp: new Date(),
    file: {
      path: '/workspaces/project/src/app.ts',
      operation: 'edit',
    },
  };

  await learningExecutor.execute(HookEvent.PreEdit, editContext);

  // Example 3: Performance Monitoring
  console.log('\n📋 Example 3: Performance Monitoring');
  const { executor: perfExecutor } = setupPerformanceHooks();

  const toolContext: HookContext = {
    event: HookEvent.PreToolUse,
    timestamp: new Date(),
    tool: {
      name: 'Read',
      parameters: { path: 'file.ts' },
      category: 'file',
    },
  };

  const preToolResult = await perfExecutor.execute(HookEvent.PreToolUse, toolContext);

  // Brief delay representing tool execution time
  await new Promise(resolve => setTimeout(resolve, 100));

  await perfExecutor.execute(HookEvent.PostToolUse, {
    ...toolContext,
    event: HookEvent.PostToolUse,
    metadata: preToolResult.finalContext?.metadata,
  });

  // Get statistics
  console.log('\n📊 Hook Statistics');
  const stats = perfExecutor.getRegistry().getStats();
  console.log(`Total hooks: ${stats.totalHooks}`);
  console.log(`Total executions: ${stats.totalExecutions}`);
  console.log(`Average execution time: ${stats.avgExecutionTime.toFixed(2)}ms`);

  console.log('\n' + '='.repeat(60));
}

// Run demo if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch(console.error);
}
