/**
 * @claude-flow/hooks - V3 Hooks System
 *
 * Event-driven lifecycle hooks with ReasoningBank learning integration.
 *
 * Features:
 * - Hook registration and execution
 * - Background daemons for metrics and learning
 * - Statusline integration
 * - MCP tool definitions
 * - V2 compatibility layer
 *
 * @packageDocumentation
 */

// Types
export * from './types.js';

// ReasoningBank - Vector-based pattern learning
export {
  ReasoningBank,
  reasoningBank,
  type GuidancePattern,
  type GuidanceResult,
  type RoutingResult,
  type ReasoningBankConfig,
  type ReasoningBankMetrics,
} from './reasoningbank/index.js';

// Guidance Provider - Claude-visible output generation
export {
  GuidanceProvider,
  guidanceProvider,
  type ClaudeHookOutput,
} from './reasoningbank/guidance-provider.js';

// Registry
export {
  HookRegistry,
  defaultRegistry,
  registerHook,
  unregisterHook,
} from './registry/index.js';

// Executor
export {
  HookExecutor,
  defaultExecutor,
  executeHooks,
} from './executor/index.js';

// Daemons
export {
  DaemonManager,
  MetricsDaemon,
  SwarmMonitorDaemon,
  HooksLearningDaemon,
  defaultDaemonManager,
} from './daemons/index.js';

// Statusline
export {
  StatuslineGenerator,
  createShellStatusline,
  parseStatuslineData,
  defaultStatuslineGenerator,
} from './statusline/index.js';

// MCP Tools
export {
  hooksMCPTools,
  getHooksTool,
  preEditTool,
  postEditTool,
  routeTaskTool,
  metricsTool,
  preCommandTool,
  postCommandTool,
  daemonStatusTool,
  statuslineTool,
  type MCPTool,
} from './mcp/index.js';

// Official Claude Code Hooks Bridge
export {
  OfficialHooksBridge,
  V3_TO_OFFICIAL_HOOK_MAP,
  V3_TOOL_MATCHERS,
  processOfficialHookInput,
  outputOfficialHookResult,
  executeWithBridge,
  type OfficialHookEvent,
  type OfficialHookInput,
  type OfficialHookOutput,
} from './bridge/official-hooks-bridge.js';

// IPI Detection Hook (ADR-178 Primitive 2 — ruvnet/ruflo#2630)
// Registers `@claude-flow/security`'s IpiDetector as a PreToolUse handler
// at HookPriority.Critical. CLAUDE_FLOW_IPI_MODE selects warn|block|hil.
export {
  getIpiMode,
  decideIpiOutcome,
  createIpiDetectionHandler,
  registerIpiDetectionHook,
  ipiDetectionHookId,
  type IpiMode,
} from './builtin/ipi-detection-hook.js';

// Seal-Propagation Listener (ADR-321 P2 escalation wiring — ruvnet/ruflo#2630)
// Routes AgentDBAdapter's `seal:propagation-detected` event through the
// same decideIpiOutcome/getIpiMode logic above. Callers register this
// against their own AgentDBAdapter instance — no default singleton exists.
export {
  registerSealPropagationListener,
  type SealPropagationEvent,
  type SealPropagationEmitter,
} from './builtin/seal-propagation-listener.js';

// Swarm Communication
export {
  SwarmCommunication,
  swarmComm,
  type SwarmMessage,
  type PatternBroadcast,
  type ConsensusRequest,
  type TaskHandoff,
  type SwarmAgentState,
  type SwarmConfig,
} from './swarm/index.js';

// Workers - Cross-platform background workers
export {
  WorkerManager,
  WorkerPriority,
  AlertSeverity,
  WORKER_CONFIGS,
  DEFAULT_THRESHOLDS,
  createWorkerManager,
  workerManager,
  // Worker factories
  createPerformanceWorker,
  createHealthWorker,
  createSwarmWorker,
  createGitWorker,
  createLearningWorker,
  createADRWorker,
  createDDDWorker,
  createSecurityWorker,
  createPatternsWorker,
  createCacheWorker,
  // Types
  type WorkerConfig,
  type WorkerResult,
  type WorkerMetrics,
  type WorkerManagerStatus,
  type WorkerHandler,
  type WorkerAlert,
  type AlertThreshold,
  type PersistedWorkerState,
  type HistoricalMetric,
  type StatuslineData,
} from './workers/index.js';

// Workers - MCP Tools
export {
  workerMCPTools,
  createWorkerToolHandler,
  workerRunTool,
  workerStatusTool,
  workerAlertsTool,
  workerHistoryTool,
  workerStatuslineTool,
  workerRunAllTool,
  workerStartTool,
  workerStopTool,
  type MCPToolDefinition,
  type MCPToolResult,
} from './workers/mcp-tools.js';

// Workers - Session Integration
export {
  onSessionStart,
  onSessionEnd,
  formatSessionStartOutput,
  generateShellHook,
  getGlobalManager,
  setGlobalManager,
  initializeGlobalManager,
  type SessionHookConfig,
  type SessionHookResult,
} from './workers/session-hook.js';

// Version
export const VERSION = '3.0.0-alpha.1';

/**
 * Initialize hooks system with default configuration
 */
export async function initializeHooks(options?: {
  enableDaemons?: boolean;
  enableStatusline?: boolean;
}): Promise<{
  registry: import('./registry/index.js').HookRegistry;
  executor: import('./executor/index.js').HookExecutor;
  statusline: import('./statusline/index.js').StatuslineGenerator;
}> {
  const { HookRegistry } = await import('./registry/index.js');
  const { HookExecutor } = await import('./executor/index.js');
  const { StatuslineGenerator } = await import('./statusline/index.js');
  const { DaemonManager, MetricsDaemon, SwarmMonitorDaemon, HooksLearningDaemon } = await import('./daemons/index.js');

  const registry = new HookRegistry();
  const executor = new HookExecutor(registry);
  const statusline = new StatuslineGenerator();

  // Start daemons if enabled
  if (options?.enableDaemons !== false) {
    const daemonManager = new DaemonManager();
    const metricsDaemon = new MetricsDaemon(daemonManager);
    const swarmDaemon = new SwarmMonitorDaemon(daemonManager);
    const learningDaemon = new HooksLearningDaemon(daemonManager);

    await Promise.all([
      metricsDaemon.start(),
      swarmDaemon.start(),
      learningDaemon.start(),
    ]);
  }

  return { registry, executor, statusline };
}

/**
 * Quick hooks execution helper
 */
export async function runHook(
  event: import('./types.js').HookEvent,
  context: Partial<import('./types.js').HookContext>
): Promise<import('./types.js').HookExecutionResult> {
  const { executeHooks } = await import('./executor/index.js');
  return executeHooks(event, context);
}

/**
 * Register a new hook with simplified API
 */
export function addHook(
  event: import('./types.js').HookEvent,
  handler: import('./types.js').HookHandler,
  options?: {
    priority?: import('./types.js').HookPriority;
    name?: string;
  }
): string {
  const { registerHook: register } = require('./registry/index.js');
  const { HookPriority } = require('./types.js');

  return register(
    event,
    handler,
    options?.priority ?? HookPriority.Normal,
    { name: options?.name }
  );
}
