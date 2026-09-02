/**
 * Agentic Flow Hook System Type Definitions
 * 
 * This module defines the comprehensive hook system for integrating
 * agentic-flow with Claude Flow's existing infrastructure.
 */

import type { HookType, HookResult } from '../../cli/commands/hook-types.js';

// ===== Core Hook Types =====

export interface AgenticHookContext {
  sessionId: string;
  timestamp: number;
  correlationId: string;
  metadata: Record<string, any>;
  memory: MemoryContext;
  neural: NeuralContext;
  performance: PerformanceContext;
}

export interface MemoryContext {
  namespace: string;
  provider: string;
  ttl?: number;
  cache: Map<string, any>;
}

export interface NeuralContext {
  modelId: string;
  patterns: PatternStore;
  training: TrainingState;
}

export interface PerformanceContext {
  metrics: Map<string, PerformanceMetric>;
  bottlenecks: BottleneckAnalysis[];
  optimizations: OptimizationSuggestion[];
}

// ===== LLM Hook Types =====

export type LLMHookType = 
  | 'pre-llm-call'
  | 'post-llm-call'
  | 'llm-error'
  | 'llm-retry'
  | 'llm-fallback'
  | 'llm-cache-hit'
  | 'llm-cache-miss';

export interface LLMHookPayload {
  provider: string;
  model: string;
  operation: 'completion' | 'embedding' | 'function-call' | 'vision';
  request: LLMRequest;
  response?: LLMResponse;
  error?: Error;
  metrics?: LLMMetrics;
}

export interface LLMRequest {
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'function';
    content: string;
    name?: string;
  }>;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  functions?: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }>;
  tools?: Array<{
    type: string;
    function: Record<string, any>;
  }>;
}

export interface LLMResponse {
  id: string;
  choices: Array<{
    message?: {
      role: string;
      content: string;
      functionCall?: {
        name: string;
        arguments: string;
      };
    };
    text?: string;
    finishReason: string;
    index: number;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  created: number;
}

export interface LLMMetrics {
  latency: number;
  tokensPerSecond: number;
  costEstimate: number;
  cacheHit: boolean;
  retryCount: number;
  providerHealth: number; // 0-1 health score
}

// ===== Memory Hook Types =====

export type MemoryHookType =
  | 'pre-memory-store'
  | 'post-memory-store'
  | 'pre-memory-retrieve'
  | 'post-memory-retrieve'
  | 'memory-sync'
  | 'memory-persist'
  | 'memory-expire';

export interface MemoryHookPayload {
  operation: 'store' | 'retrieve' | 'sync' | 'persist' | 'expire';
  namespace: string;
  key?: string;
  value?: any;
  ttl?: number;
  provider: string;
  crossProvider?: boolean;
  syncTargets?: string[];
}

// ===== Neural Hook Types =====

export type NeuralHookType =
  | 'pre-neural-train'
  | 'post-neural-train'
  | 'neural-pattern-detected'
  | 'neural-prediction'
  | 'neural-adaptation';

export interface NeuralHookPayload {
  operation: 'train' | 'predict' | 'adapt' | 'analyze';
  modelId: string;
  patterns?: Pattern[];
  trainingData?: TrainingData;
  prediction?: Prediction;
  accuracy?: number;
  adaptations?: Adaptation[];
}

export interface Pattern {
  id: string;
  type: 'success' | 'failure' | 'optimization' | 'behavior';
  confidence: number;
  occurrences: number;
  context: Record<string, any>;
}

export interface TrainingData {
  inputs: any[];
  outputs: any[];
  labels?: string[];
  weights?: number[];
  batchSize: number;
  epochs: number;
}

export interface Prediction {
  input: any;
  output: any;
  confidence: number;
  alternatives: Array<{
    output: any;
    confidence: number;
  }>;
}

export interface Adaptation {
  type: 'parameter' | 'architecture' | 'strategy';
  target: string;
  oldValue: any;
  newValue: any;
  reason: string;
  impact: number; // -1 to 1
}

// ===== Performance Hook Types =====

export type PerformanceHookType =
  | 'performance-metric'
  | 'performance-bottleneck'
  | 'performance-optimization'
  | 'performance-threshold';

export interface PerformanceHookPayload {
  metric: string;
  value: number;
  unit: string;
  threshold?: number;
  bottleneck?: BottleneckInfo;
  optimization?: OptimizationInfo;
  context: Record<string, any>;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  tags: string[];
}

export interface BottleneckAnalysis {
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact: number; // 0-1
  suggestions: string[];
}

export interface OptimizationSuggestion {
  type: 'cache' | 'parallel' | 'batch' | 'algorithm' | 'resource';
  target: string;
  expectedImprovement: number; // percentage
  implementation: string;
  risk: 'low' | 'medium' | 'high';
}

export interface BottleneckInfo {
  location: string;
  type: string;
  severity: number;
  suggestions: string[];
}

export interface OptimizationInfo {
  applied: boolean;
  type: string;
  improvement: number;
  details: string;
}

// ===== Workflow Hook Types =====

export type WorkflowHookType =
  | 'workflow-start'
  | 'workflow-step'
  | 'workflow-decision'
  | 'workflow-complete'
  | 'workflow-error';

export interface WorkflowHookPayload {
  workflowId: string;
  step?: string;
  decision?: WorkflowDecision;
  state: Record<string, any>;
  metrics?: WorkflowMetrics;
  error?: Error;
}

export interface WorkflowDecision {
  point: string;
  options: string[];
  selected: string;
  confidence: number;
  reasoning: string;
  learnings: Learning[];
}

export interface Learning {
  type: 'success' | 'failure' | 'optimization';
  context: string;
  value: any;
  applicability: number; // 0-1
}

export interface WorkflowMetrics {
  duration: number;
  steps: number;
  decisions: number;
  errorRate: number;
  successRate: number;
  improvementRate: number;
}

// ===== Hook Registration & Management =====

export interface HookRegistration {
  id: string;
  type: AgenticHookType;
  handler: HookHandler;
  priority: number;
  filter?: HookFilter;
  options?: HookOptions;
}

export type AgenticHookType = 
  | LLMHookType 
  | MemoryHookType 
  | NeuralHookType 
  | PerformanceHookType 
  | WorkflowHookType
  | HookType; // Include existing Claude Flow hooks

export type HookHandler = (
  payload: HookPayload,
  context: AgenticHookContext
) => Promise<HookHandlerResult>;

export type HookPayload = 
  | LLMHookPayload
  | MemoryHookPayload
  | NeuralHookPayload
  | PerformanceHookPayload
  | WorkflowHookPayload;

export interface HookHandlerResult {
  continue: boolean;
  modified?: boolean;
  payload?: any;
  metadata?: Record<string, any>;
  sideEffects?: SideEffect[];
}

export interface SideEffect {
  type: 'memory' | 'neural' | 'metric' | 'notification' | 'log';
  action: string;
  data: any;
}

export interface HookFilter {
  providers?: string[];
  models?: string[];
  operations?: string[];
  namespaces?: string[];
  patterns?: RegExp[];
  conditions?: Array<{
    field: string;
    operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'nin' | 'regex';
    value: any;
  }>;
}

export interface HookOptions {
  async?: boolean;
  timeout?: number;
  retries?: number;
  fallback?: HookHandler;
  errorHandler?: (error: Error) => void;
  cache?: {
    enabled: boolean;
    ttl: number;
    key: (payload: HookPayload) => string;
  };
}

// ===== Hook Pipeline =====

export interface HookPipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
  errorStrategy: 'fail-fast' | 'continue' | 'rollback';
  metrics: PipelineMetrics;
}

export interface PipelineStage {
  name: string;
  hooks: HookRegistration[];
  parallel: boolean;
  condition?: (context: AgenticHookContext) => boolean;
  transform?: (result: HookHandlerResult) => HookHandlerResult;
}

export interface PipelineMetrics {
  executions: number;
  avgDuration: number;
  errorRate: number;
  throughput: number;
}

// ===== Provider Integration =====

export interface ProviderHookConfig {
  provider: string;
  hooks: {
    preCall?: HookRegistration[];
    postCall?: HookRegistration[];
    error?: HookRegistration[];
    cache?: HookRegistration[];
  };
  memory: {
    enabled: boolean;
    namespace: string;
    persistence: 'session' | 'persistent';
  };
  neural: {
    enabled: boolean;
    modelId: string;
    training: 'online' | 'batch' | 'hybrid';
  };
  performance: {
    tracking: boolean;
    optimization: boolean;
    thresholds: Record<string, number>;
  };
}

// ===== Self-Improvement Types =====

export interface SelfImprovementConfig {
  enabled: boolean;
  strategies: ImprovementStrategy[];
  evaluation: EvaluationConfig;
  adaptation: AdaptationConfig;
}

export interface ImprovementStrategy {
  name: string;
  type: 'reinforcement' | 'evolutionary' | 'gradient' | 'heuristic';
  target: 'latency' | 'accuracy' | 'cost' | 'reliability';
  parameters: Record<string, any>;
}

export interface EvaluationConfig {
  metrics: string[];
  window: number; // evaluation window in seconds
  minSamples: number;
  confidenceThreshold: number;
}

export interface AdaptationConfig {
  automatic: boolean;
  requiresApproval: boolean;
  maxChangeMagnitude: number;
  rollbackThreshold: number;
}

// ===== Hook Context Helpers =====

export interface HookContextBuilder {
  withSession(sessionId: string): HookContextBuilder;
  withMemory(namespace: string, provider: string): HookContextBuilder;
  withNeural(modelId: string): HookContextBuilder;
  withPerformance(metrics: PerformanceMetric[]): HookContextBuilder;
  withMetadata(metadata: Record<string, any>): HookContextBuilder;
  build(): AgenticHookContext;
}

// ===== Hook Registry Interface =====

export interface HookRegistry {
  register(registration: HookRegistration): void;
  unregister(id: string): void;
  getHooks(type: AgenticHookType, filter?: HookFilter): HookRegistration[];
  executeHooks(
    type: AgenticHookType,
    payload: HookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult[]>;
  createPipeline(config: Partial<HookPipeline>): HookPipeline;
  getMetrics(): Record<string, any>;
}

// ===== Pattern Store =====

export interface PatternStore {
  add(pattern: Pattern): void;
  get(id: string): Pattern | undefined;
  findSimilar(pattern: Partial<Pattern>, threshold: number): Pattern[];
  getByType(type: Pattern['type']): Pattern[];
  prune(maxAge: number): void;
  export(): Pattern[];
  import(patterns: Pattern[]): void;
}

// ===== Training State =====

export interface TrainingState {
  epoch: number;
  loss: number;
  accuracy: number;
  validationLoss?: number;
  validationAccuracy?: number;
  learningRate: number;
  optimizer: string;
  checkpoints: Checkpoint[];
}

export interface Checkpoint {
  epoch: number;
  timestamp: number;
  metrics: Record<string, number>;
  path: string;
}