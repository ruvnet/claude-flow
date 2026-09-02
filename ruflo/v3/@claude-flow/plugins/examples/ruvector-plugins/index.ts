/**
 * RuVector Plugin Collection
 *
 * High-value plugins using @ruvector WASM packages for Claude Flow.
 *
 * @packageDocumentation
 */

// Core plugins
export { reasoningBankPlugin, ReasoningBank } from './reasoning-bank.js';
export { semanticCodeSearchPlugin, SemanticCodeSearch } from './semantic-code-search.js';
export { sonaLearningPlugin, SONALearning } from './sona-learning.js';
export { intentRouterPlugin, IntentRouter } from './intent-router.js';
export { mcpToolOptimizerPlugin, MCPToolOptimizer } from './mcp-tool-optimizer.js';
export { hookPatternLibraryPlugin, HookPatternLibrary } from './hook-pattern-library.js';

// Types
export type {
  ReasoningTrajectory,
  ReasoningStep,
  RetrievalResult,
  VerdictJudgment,
} from './reasoning-bank.js';

export type {
  CodeChunk,
  CodeSearchResult,
  CodeSearchOptions,
} from './semantic-code-search.js';

export type {
  LearningPattern,
  AdaptationResult,
  SONAConfig,
} from './sona-learning.js';

export type {
  Intent,
  IntentHandler,
  RouteResult,
  RouterConfig,
} from './intent-router.js';

export type {
  ToolUsagePattern,
  ToolSequence,
  OptimizationSuggestion,
} from './mcp-tool-optimizer.js';

export type {
  HookPattern,
  PatternMatch,
  HookRecommendation,
} from './hook-pattern-library.js';

// Re-export classes for direct usage
export { ReasoningBank } from './reasoning-bank.js';
export { SemanticCodeSearch } from './semantic-code-search.js';
export { SONALearning } from './sona-learning.js';
export { IntentRouter } from './intent-router.js';
export { MCPToolOptimizer } from './mcp-tool-optimizer.js';
export { HookPatternLibrary } from './hook-pattern-library.js';

/**
 * Register all RuVector plugins with the default registry.
 */
export async function registerAllRuVectorPlugins(): Promise<void> {
  const { getDefaultRegistry } = await import('../../src/index.js');
  const registry = getDefaultRegistry();

  await Promise.all([
    import('./reasoning-bank.js').then(m => registry.register(m.reasoningBankPlugin)),
    import('./semantic-code-search.js').then(m => registry.register(m.semanticCodeSearchPlugin)),
    import('./sona-learning.js').then(m => registry.register(m.sonaLearningPlugin)),
    import('./intent-router.js').then(m => registry.register(m.intentRouterPlugin)),
    import('./mcp-tool-optimizer.js').then(m => registry.register(m.mcpToolOptimizerPlugin)),
    import('./hook-pattern-library.js').then(m => registry.register(m.hookPatternLibraryPlugin)),
  ]);
}
