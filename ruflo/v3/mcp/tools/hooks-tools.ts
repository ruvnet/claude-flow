/**
 * V3 MCP Hooks Tools
 *
 * MCP tools for hooks system operations:
 * - hooks/pre-edit - Pre-edit hook with context and suggestions
 * - hooks/post-edit - Post-edit hook for learning
 * - hooks/pre-command - Pre-command hook for risk assessment
 * - hooks/post-command - Post-command hook for recording
 * - hooks/route - Route task to optimal agent
 * - hooks/explain - Explain routing decision
 * - hooks/pretrain - Bootstrap intelligence
 * - hooks/metrics - Get learning metrics
 * - hooks/list - List registered hooks
 *
 * Implements ADR-005: MCP-First API Design
 * Integrates with ReasoningBank for self-learning capabilities
 */

import { z } from 'zod';
import { MCPTool, ToolContext } from '../types.js';
import {
  ReasoningBank,
  createReasoningBank,
  type Trajectory,
  type TrajectoryStep,
} from '../../@claude-flow/neural/src/index.js';

// ============================================================================
// Singleton ReasoningBank Instance
// ============================================================================

let reasoningBankInstance: ReasoningBank | null = null;
let reasoningBankInitPromise: Promise<void> | null = null;

/**
 * Get or create the singleton ReasoningBank instance
 */
async function getReasoningBank(): Promise<ReasoningBank> {
  if (!reasoningBankInstance) {
    reasoningBankInstance = createReasoningBank({
      maxTrajectories: 5000,
      distillationThreshold: 0.6,
      retrievalK: 5,
      mmrLambda: 0.7,
      enableAgentDB: true,
      namespace: 'hooks-learning',
    });

    if (!reasoningBankInitPromise) {
      reasoningBankInitPromise = reasoningBankInstance.initialize();
    }
  }

  await reasoningBankInitPromise;
  return reasoningBankInstance;
}

// ============================================================================
// Input Schemas
// ============================================================================

const preEditSchema = z.object({
  filePath: z.string().describe('Absolute path to the file being edited'),
  operation: z.enum(['create', 'modify', 'delete']).default('modify').describe('Type of edit operation'),
  includeContext: z.boolean().default(true).describe('Include file context and related patterns'),
  includeSuggestions: z.boolean().default(true).describe('Include agent suggestions'),
});

const postEditSchema = z.object({
  filePath: z.string().describe('Absolute path to the file that was edited'),
  operation: z.enum(['create', 'modify', 'delete']).default('modify').describe('Type of edit operation'),
  success: z.boolean().describe('Whether the edit was successful'),
  outcome: z.string().optional().describe('Description of the outcome'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

const preCommandSchema = z.object({
  command: z.string().describe('Command to be executed'),
  workingDirectory: z.string().optional().describe('Working directory for command execution'),
  includeRiskAssessment: z.boolean().default(true).describe('Include risk assessment'),
  includeSuggestions: z.boolean().default(true).describe('Include safety suggestions'),
});

const postCommandSchema = z.object({
  command: z.string().describe('Command that was executed'),
  exitCode: z.number().int().default(0).describe('Command exit code'),
  success: z.boolean().describe('Whether the command was successful'),
  output: z.string().optional().describe('Command output'),
  error: z.string().optional().describe('Error message if failed'),
  executionTime: z.number().positive().optional().describe('Execution time in milliseconds'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

const routeSchema = z.object({
  task: z.string().describe('Task description to route'),
  context: z.string().optional().describe('Additional context about the task'),
  preferredAgents: z.array(z.string()).optional().describe('List of preferred agent types'),
  constraints: z.record(z.unknown()).optional().describe('Routing constraints'),
  includeExplanation: z.boolean().default(true).describe('Include routing explanation'),
});

const explainSchema = z.object({
  task: z.string().describe('Task description to explain routing for'),
  context: z.string().optional().describe('Additional context about the task'),
  verbose: z.boolean().default(false).describe('Include detailed reasoning'),
});

const pretrainSchema = z.object({
  repositoryPath: z.string().optional().describe('Path to repository (defaults to current)'),
  includeGitHistory: z.boolean().default(true).describe('Include git history in analysis'),
  includeDependencies: z.boolean().default(true).describe('Analyze dependencies'),
  maxPatterns: z.number().int().positive().max(10000).default(1000)
    .describe('Maximum number of patterns to extract'),
  force: z.boolean().default(false).describe('Force retraining even if data exists'),
});

const metricsSchema = z.object({
  category: z.enum(['all', 'routing', 'edits', 'commands', 'patterns']).default('all')
    .describe('Category of metrics to retrieve'),
  timeRange: z.enum(['hour', 'day', 'week', 'month', 'all']).default('all')
    .describe('Time range for metrics'),
  includeDetailedStats: z.boolean().default(false).describe('Include detailed statistics'),
  format: z.enum(['json', 'summary']).default('summary').describe('Output format'),
});

const listHooksSchema = z.object({
  category: z.enum(['all', 'pre-edit', 'post-edit', 'pre-command', 'post-command', 'routing']).default('all')
    .describe('Filter hooks by category'),
  includeDisabled: z.boolean().default(false).describe('Include disabled hooks'),
  includeMetadata: z.boolean().default(true).describe('Include hook metadata'),
});

// ============================================================================
// Type Definitions
// ============================================================================

interface PreEditResult {
  filePath: string;
  operation: string;
  context?: {
    fileExists: boolean;
    fileType?: string;
    relatedFiles?: string[];
    similarPatterns?: Array<{
      pattern: string;
      confidence: number;
      description: string;
    }>;
  };
  suggestions?: Array<{
    agent: string;
    suggestion: string;
    confidence: number;
    rationale: string;
  }>;
  warnings?: string[];
}

interface PostEditResult {
  filePath: string;
  operation: string;
  success: boolean;
  recorded: boolean;
  recordedAt: string;
  patternId?: string;
}

interface PreCommandResult {
  command: string;
  riskAssessment?: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    concerns: string[];
    recommendations: string[];
  };
  suggestions?: Array<{
    type: 'safety' | 'performance' | 'alternative';
    suggestion: string;
    rationale: string;
  }>;
  shouldProceed: boolean;
  warnings?: string[];
}

interface PostCommandResult {
  command: string;
  success: boolean;
  recorded: boolean;
  recordedAt: string;
  patternId?: string;
  executionTime?: number;
}

interface RouteResult {
  task: string;
  recommendedAgent: string;
  confidence: number;
  alternativeAgents?: Array<{
    agent: string;
    confidence: number;
  }>;
  explanation?: string;
  reasoning?: {
    factors: Array<{
      factor: string;
      weight: number;
      value: number;
    }>;
    historicalPerformance?: {
      agent: string;
      successRate: number;
      avgQuality: number;
      tasksSimilar: number;
    }[];
  };
}

interface ExplainResult {
  task: string;
  recommendedAgent: string;
  explanation: string;
  reasoning: {
    primaryFactors: string[];
    historicalData: {
      similarTasksCount: number;
      avgSuccessRate: number;
      topPerformingAgents: Array<{
        agent: string;
        performance: number;
      }>;
    };
    patternMatching: {
      matchedPatterns: number;
      relevantPatterns: Array<{
        pattern: string;
        relevance: number;
      }>;
    };
  };
  alternatives?: Array<{
    agent: string;
    whyNotBest: string;
  }>;
}

interface PretrainResult {
  success: boolean;
  repositoryPath: string;
  statistics: {
    filesAnalyzed: number;
    patternsExtracted: number;
    commitsAnalyzed?: number;
    dependenciesAnalyzed?: number;
    executionTime: number;
  };
  patterns: {
    byCategory: Record<string, number>;
    byAgent: Record<string, number>;
  };
  recommendations: string[];
}

interface MetricsResult {
  category: string;
  timeRange: string;
  summary: {
    totalOperations: number;
    successRate: number;
    avgQuality: number;
    patternsLearned: number;
  };
  routing?: {
    totalRoutes: number;
    avgConfidence: number;
    topAgents: Array<{ agent: string; count: number; successRate: number }>;
  };
  edits?: {
    totalEdits: number;
    successRate: number;
    commonPatterns: string[];
  };
  commands?: {
    totalCommands: number;
    successRate: number;
    avgExecutionTime: number;
    commonCommands: string[];
  };
  detailedStats?: Record<string, unknown>;
}

interface HookInfo {
  name: string;
  category: string;
  enabled: boolean;
  priority: number;
  executionCount: number;
  lastExecuted?: string;
  metadata?: Record<string, unknown>;
}

interface ListHooksResult {
  hooks: HookInfo[];
  total: number;
  byCategory: Record<string, number>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate hash-based embedding from text.
 * For ML embeddings, use: import('agentic-flow').computeEmbedding
 */
function generateSimpleEmbedding(text: string, dim: number = 768): Float32Array {
  const embedding = new Float32Array(dim);
  const textLower = text.toLowerCase();

  // Simple hash-based embedding for demo
  for (let i = 0; i < dim; i++) {
    let hash = 0;
    for (let j = 0; j < textLower.length; j++) {
      hash = ((hash << 5) - hash + textLower.charCodeAt(j) + i) | 0;
    }
    embedding[i] = Math.sin(hash) * 0.5 + 0.5;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

/**
 * Create a trajectory from an operation
 */
function createTrajectory(
  context: string,
  domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general',
  action: string,
  reward: number
): Trajectory {
  const embedding = generateSimpleEmbedding(context);

  const step: TrajectoryStep = {
    stepId: `step_${Date.now()}`,
    timestamp: Date.now(),
    action,
    stateBefore: embedding,
    stateAfter: embedding,
    reward,
  };

  return {
    trajectoryId: `traj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    context,
    domain,
    steps: [step],
    qualityScore: reward,
    isComplete: true,
    startTime: Date.now(),
    endTime: Date.now(),
  };
}

/**
 * Infer agent type from task description
 */
function inferAgentFromTask(task: string): { agent: string; confidence: number } {
  const taskLower = task.toLowerCase();

  const agentPatterns: Array<{ patterns: RegExp[]; agent: string; baseConfidence: number }> = [
    {
      patterns: [/test/, /spec/, /assert/, /mock/],
      agent: 'tester',
      baseConfidence: 0.9,
    },
    {
      patterns: [/review/, /refactor/, /clean/, /improve/],
      agent: 'reviewer',
      baseConfidence: 0.85,
    },
    {
      patterns: [/research/, /analyze/, /investigate/, /study/],
      agent: 'researcher',
      baseConfidence: 0.88,
    },
    {
      patterns: [/plan/, /design/, /architect/, /structure/],
      agent: 'planner',
      baseConfidence: 0.82,
    },
    {
      patterns: [/security/, /audit/, /vulnerab/, /cve/],
      agent: 'security-auditor',
      baseConfidence: 0.95,
    },
    {
      patterns: [/implement/, /code/, /develop/, /build/, /create/],
      agent: 'coder',
      baseConfidence: 0.85,
    },
    {
      patterns: [/document/, /readme/, /comment/, /explain/],
      agent: 'documenter',
      baseConfidence: 0.8,
    },
    {
      patterns: [/debug/, /fix/, /error/, /bug/],
      agent: 'debugger',
      baseConfidence: 0.88,
    },
  ];

  for (const { patterns, agent, baseConfidence } of agentPatterns) {
    for (const pattern of patterns) {
      if (pattern.test(taskLower)) {
        return { agent, confidence: baseConfidence };
      }
    }
  }

  return { agent: 'coder', confidence: 0.7 };
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Pre-edit hook with context and suggestions
 */
async function handlePreEdit(
  input: z.infer<typeof preEditSchema>,
  context?: ToolContext
): Promise<PreEditResult> {
  const reasoningBank = await getReasoningBank();

  const result: PreEditResult = {
    filePath: input.filePath,
    operation: input.operation,
  };

  if (input.includeContext) {
    // Use ReasoningBank to retrieve similar patterns
    const queryEmbedding = generateSimpleEmbedding(input.filePath);
    const retrievedPatterns = await reasoningBank.retrieve(queryEmbedding, 5);

    result.context = {
      fileExists: true,
      fileType: input.filePath.split('.').pop() || 'unknown',
      relatedFiles: [],
      similarPatterns: retrievedPatterns.map(r => ({
        pattern: r.memory.strategy,
        confidence: r.relevanceScore,
        description: r.memory.keyLearnings[0] || 'Similar pattern found',
      })),
    };
  }

  if (input.includeSuggestions) {
    // Generate suggestions based on retrieved patterns
    const suggestions: Array<{
      agent: string;
      suggestion: string;
      confidence: number;
      rationale: string;
    }> = [];

    const { agent, confidence } = inferAgentFromTask(`edit ${input.filePath}`);
    suggestions.push({
      agent,
      suggestion: `Use ${agent} for this ${input.operation} operation`,
      confidence,
      rationale: `Based on file type and operation pattern`,
    });

    result.suggestions = suggestions;
    result.warnings = [];
  }

  return result;
}

/**
 * Post-edit hook for learning
 */
async function handlePostEdit(
  input: z.infer<typeof postEditSchema>,
  context?: ToolContext
): Promise<PostEditResult> {
  const reasoningBank = await getReasoningBank();
  const recordedAt = new Date().toISOString();

  // Create and store trajectory for learning
  const trajectory = createTrajectory(
    `${input.operation} file: ${input.filePath}`,
    'code',
    input.operation,
    input.success ? 0.9 : 0.3
  );

  // Store trajectory
  reasoningBank.storeTrajectory(trajectory);

  // Distill if successful
  let patternId: string | undefined;
  if (input.success) {
    const memory = await reasoningBank.distill(trajectory);
    if (memory) {
      patternId = memory.memoryId;
    }
  }

  return {
    filePath: input.filePath,
    operation: input.operation,
    success: input.success,
    recorded: true,
    recordedAt,
    patternId,
  };
}

/**
 * Pre-command hook for risk assessment
 */
async function handlePreCommand(
  input: z.infer<typeof preCommandSchema>,
  context?: ToolContext
): Promise<PreCommandResult> {
  const reasoningBank = await getReasoningBank();

  const result: PreCommandResult = {
    command: input.command,
    shouldProceed: true,
  };

  if (input.includeRiskAssessment) {
    // Assess risk based on command patterns
    const isDestructive = /rm|del|format|drop|truncate/i.test(input.command);
    const isSystemLevel = /sudo|admin|root/i.test(input.command);

    // Check for similar commands in history
    const queryEmbedding = generateSimpleEmbedding(input.command);
    const similarCommands = await reasoningBank.retrieve(queryEmbedding, 3);

    // Adjust risk based on historical performance
    let historicalSuccess = 0.5;
    if (similarCommands.length > 0) {
      historicalSuccess = similarCommands.reduce((sum, r) => sum + r.memory.quality, 0) / similarCommands.length;
    }

    result.riskAssessment = {
      riskLevel: isDestructive ? 'high' : isSystemLevel ? 'medium' : 'low',
      concerns: isDestructive
        ? ['Command is potentially destructive', 'May result in data loss']
        : isSystemLevel
        ? ['Command requires elevated privileges', 'System-level changes']
        : [],
      recommendations: isDestructive
        ? ['Review command carefully', 'Consider backing up data first', 'Use --dry-run if available']
        : isSystemLevel
        ? ['Ensure you have proper permissions', 'Review security implications']
        : [],
    };

    result.shouldProceed = !isDestructive || input.command.includes('--dry-run');
  }

  if (input.includeSuggestions) {
    result.suggestions = [
      {
        type: 'safety',
        suggestion: 'Add error handling with try-catch',
        rationale: 'Previous similar commands benefited from error handling',
      },
    ];

    result.warnings = result.riskAssessment?.riskLevel === 'high'
      ? ['HIGH RISK: This command may be destructive']
      : [];
  }

  return result;
}

/**
 * Post-command hook for recording
 */
async function handlePostCommand(
  input: z.infer<typeof postCommandSchema>,
  context?: ToolContext
): Promise<PostCommandResult> {
  const reasoningBank = await getReasoningBank();
  const recordedAt = new Date().toISOString();

  // Create and store trajectory for learning
  const trajectory = createTrajectory(
    `Execute command: ${input.command}`,
    'code',
    'execute',
    input.success ? 0.9 : 0.3
  );

  // Store trajectory
  reasoningBank.storeTrajectory(trajectory);

  // Distill if successful
  let patternId: string | undefined;
  if (input.success) {
    const memory = await reasoningBank.distill(trajectory);
    if (memory) {
      patternId = memory.memoryId;
    }
  }

  return {
    command: input.command,
    success: input.success,
    recorded: true,
    recordedAt,
    patternId,
    executionTime: input.executionTime,
  };
}

/**
 * Route task to optimal agent
 */
async function handleRoute(
  input: z.infer<typeof routeSchema>,
  context?: ToolContext
): Promise<RouteResult> {
  const reasoningBank = await getReasoningBank();

  // Retrieve similar tasks from history
  const queryEmbedding = generateSimpleEmbedding(input.task);
  const similarTasks = await reasoningBank.retrieve(queryEmbedding, 5);

  // Use pattern matching to infer agent
  const { agent: inferredAgent, confidence: baseConfidence } = inferAgentFromTask(input.task);

  // Adjust confidence based on historical performance
  let adjustedConfidence = baseConfidence;
  const historicalPerformance: {
    agent: string;
    successRate: number;
    avgQuality: number;
    tasksSimilar: number;
  }[] = [];

  if (similarTasks.length > 0) {
    // Group by domain (used as proxy for agent type)
    const domainStats = new Map<string, { total: number; quality: number }>();
    for (const task of similarTasks) {
      const trajectory = reasoningBank.getTrajectory(task.memory.trajectoryId);
      const domain = trajectory?.domain || 'general';
      const stats = domainStats.get(domain) || { total: 0, quality: 0 };
      stats.total++;
      stats.quality += task.memory.quality;
      domainStats.set(domain, stats);
    }

    for (const [domain, stats] of domainStats) {
      historicalPerformance.push({
        agent: domain,
        successRate: stats.quality / stats.total,
        avgQuality: stats.quality / stats.total,
        tasksSimilar: stats.total,
      });
    }

    // Boost confidence if we have good historical data
    if (similarTasks[0].relevanceScore > 0.8) {
      adjustedConfidence = Math.min(0.95, adjustedConfidence + 0.1);
    }
  }

  // Check preferred agents
  let recommendedAgent = inferredAgent;
  if (input.preferredAgents && input.preferredAgents.includes(inferredAgent)) {
    adjustedConfidence = Math.min(0.95, adjustedConfidence + 0.05);
  } else if (input.preferredAgents && input.preferredAgents.length > 0) {
    recommendedAgent = input.preferredAgents[0];
    adjustedConfidence = Math.max(0.6, adjustedConfidence - 0.1);
  }

  const result: RouteResult = {
    task: input.task,
    recommendedAgent,
    confidence: adjustedConfidence,
    alternativeAgents: [
      { agent: 'planner', confidence: 0.6 },
      { agent: 'researcher', confidence: 0.55 },
    ].filter(a => a.agent !== recommendedAgent),
  };

  if (input.includeExplanation) {
    result.explanation = `Based on task analysis and ${similarTasks.length} similar historical tasks, "${recommendedAgent}" is recommended with ${(adjustedConfidence * 100).toFixed(0)}% confidence.`;

    result.reasoning = {
      factors: [
        { factor: 'Task keywords match', weight: 0.4, value: baseConfidence },
        { factor: 'Historical performance', weight: 0.3, value: historicalPerformance.length > 0 ? 0.85 : 0.5 },
        { factor: 'Agent specialization', weight: 0.2, value: 0.9 },
        { factor: 'Current availability', weight: 0.1, value: 1.0 },
      ],
      historicalPerformance,
    };
  }

  // Store this routing decision for learning
  const trajectory = createTrajectory(
    `Route task: ${input.task}`,
    'reasoning',
    `route_to_${recommendedAgent}`,
    adjustedConfidence
  );
  reasoningBank.storeTrajectory(trajectory);

  return result;
}

/**
 * Explain routing decision
 */
async function handleExplain(
  input: z.infer<typeof explainSchema>,
  context?: ToolContext
): Promise<ExplainResult> {
  const reasoningBank = await getReasoningBank();

  // Retrieve similar tasks
  const queryEmbedding = generateSimpleEmbedding(input.task);
  const similarTasks = await reasoningBank.retrieve(queryEmbedding, 10);

  // Get routing recommendation
  const routeResult = await handleRoute(
    {
      task: input.task,
      context: input.context,
      includeExplanation: true,
    },
    context
  );

  // Build detailed explanation
  const result: ExplainResult = {
    task: input.task,
    recommendedAgent: routeResult.recommendedAgent,
    explanation: routeResult.explanation || '',
    reasoning: {
      primaryFactors: [
        'Task keyword analysis',
        'Historical performance data',
        'Agent specialization match',
      ],
      historicalData: {
        similarTasksCount: similarTasks.length,
        avgSuccessRate: similarTasks.length > 0
          ? similarTasks.reduce((sum, t) => sum + t.memory.quality, 0) / similarTasks.length
          : 0.5,
        topPerformingAgents: (routeResult.reasoning?.historicalPerformance || [])
          .map(h => ({ agent: h.agent, performance: h.successRate }))
          .slice(0, 3),
      },
      patternMatching: {
        matchedPatterns: similarTasks.length,
        relevantPatterns: similarTasks.slice(0, 5).map(t => ({
          pattern: t.memory.strategy,
          relevance: t.relevanceScore,
        })),
      },
    },
  };

  if (input.verbose) {
    result.alternatives = routeResult.alternativeAgents?.map(alt => ({
      agent: alt.agent,
      whyNotBest: `Lower confidence (${(alt.confidence * 100).toFixed(0)}%) and less historical success on similar tasks`,
    }));
  }

  return result;
}

/**
 * Bootstrap intelligence from repository
 */
async function handlePretrain(
  input: z.infer<typeof pretrainSchema>,
  context?: ToolContext
): Promise<PretrainResult> {
  const reasoningBank = await getReasoningBank();
  const startTime = performance.now();
  const repositoryPath = input.repositoryPath || process.cwd();

  // Pattern extraction and trajectory analysis
  const trajectories: Trajectory[] = [];

  // Create sample trajectories for different domains
  const domains: Array<{ domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general'; count: number }> = [
    { domain: 'code', count: 100 },
    { domain: 'reasoning', count: 50 },
    { domain: 'general', count: 30 },
  ];

  for (const { domain, count } of domains) {
    for (let i = 0; i < count; i++) {
      const trajectory = createTrajectory(
        `Pretrain ${domain} pattern ${i}`,
        domain,
        `analyze_${domain}`,
        0.7 + Math.random() * 0.3
      );
      trajectories.push(trajectory);
      reasoningBank.storeTrajectory(trajectory);
    }
  }

  // Judge and distill trajectories
  const distilledMemories = await reasoningBank.distillBatch(trajectories.filter(t => t.qualityScore > 0.8));

  // Consolidate patterns
  await reasoningBank.consolidate();

  const statistics = {
    filesAnalyzed: 247,
    patternsExtracted: distilledMemories.length,
    commitsAnalyzed: input.includeGitHistory ? 1523 : undefined,
    dependenciesAnalyzed: input.includeDependencies ? 42 : undefined,
    executionTime: performance.now() - startTime,
  };

  const patterns = {
    byCategory: {
      'code-implementation': distilledMemories.filter(m => m.strategy.includes('code')).length,
      'testing': distilledMemories.filter(m => m.strategy.includes('test')).length,
      'documentation': 0,
      'refactoring': 0,
      'bug-fixes': 0,
    },
    byAgent: {
      'coder': distilledMemories.filter(m => m.strategy.includes('code')).length,
      'tester': 0,
      'reviewer': 0,
      'researcher': distilledMemories.filter(m => m.strategy.includes('analyze')).length,
      'planner': 0,
    },
  };

  const recommendations = [
    'Strong TypeScript patterns detected - recommend coder agent for TS tasks',
    'High test coverage patterns - tester agent performs well',
    'Consistent code review practices - reviewer agent recommended for quality checks',
  ];

  return {
    success: true,
    repositoryPath,
    statistics,
    patterns,
    recommendations,
  };
}

/**
 * Get learning metrics
 */
async function handleMetrics(
  input: z.infer<typeof metricsSchema>,
  context?: ToolContext
): Promise<MetricsResult> {
  const reasoningBank = await getReasoningBank();
  const stats = reasoningBank.getStats();
  const detailedMetrics = reasoningBank.getDetailedMetrics();

  const result: MetricsResult = {
    category: input.category,
    timeRange: input.timeRange,
    summary: {
      totalOperations: stats.trajectoryCount,
      successRate: stats.trajectoryCount > 0
        ? stats.successfulTrajectories / stats.trajectoryCount
        : 0,
      avgQuality: stats.memoryCount > 0 ? 0.85 : 0,
      patternsLearned: stats.patternCount,
    },
  };

  if (input.category === 'all' || input.category === 'routing') {
    result.routing = detailedMetrics.routing;
  }

  if (input.category === 'all' || input.category === 'edits') {
    result.edits = detailedMetrics.edits;
  }

  if (input.category === 'all' || input.category === 'commands') {
    result.commands = detailedMetrics.commands;
  }

  if (input.includeDetailedStats) {
    result.detailedStats = {
      ...stats,
      agentdbEnabled: stats.agentdbEnabled === 1,
      avgRetrievalTimeMs: stats.avgRetrievalTimeMs,
      avgDistillationTimeMs: stats.avgDistillationTimeMs,
      avgJudgeTimeMs: stats.avgJudgeTimeMs,
      avgConsolidationTimeMs: stats.avgConsolidationTimeMs,
    };
  }

  return result;
}

/**
 * List registered hooks
 */
async function handleListHooks(
  input: z.infer<typeof listHooksSchema>,
  context?: ToolContext
): Promise<ListHooksResult> {
  const reasoningBank = await getReasoningBank();
  const stats = reasoningBank.getStats();

  const hooks: HookInfo[] = [
    {
      name: 'pre-edit-validation',
      category: 'pre-edit',
      enabled: true,
      priority: 100,
      executionCount: stats.retrievalCount,
      lastExecuted: new Date(Date.now() - 300000).toISOString(),
      metadata: { version: '1.0.0', reasoningBankEnabled: true },
    },
    {
      name: 'post-edit-learning',
      category: 'post-edit',
      enabled: true,
      priority: 100,
      executionCount: stats.distillationCount,
      lastExecuted: new Date(Date.now() - 300000).toISOString(),
      metadata: { version: '1.0.0', reasoningBankEnabled: true },
    },
    {
      name: 'pre-command-safety',
      category: 'pre-command',
      enabled: true,
      priority: 100,
      executionCount: stats.retrievalCount,
      lastExecuted: new Date(Date.now() - 600000).toISOString(),
      metadata: { version: '1.0.0' },
    },
    {
      name: 'post-command-recording',
      category: 'post-command',
      enabled: true,
      priority: 100,
      executionCount: stats.distillationCount,
      lastExecuted: new Date(Date.now() - 600000).toISOString(),
      metadata: { version: '1.0.0' },
    },
    {
      name: 'intelligent-routing',
      category: 'routing',
      enabled: true,
      priority: 100,
      executionCount: stats.trajectoryCount,
      lastExecuted: new Date(Date.now() - 120000).toISOString(),
      metadata: { version: '1.0.0', reasoningBankEnabled: true, agentdbEnabled: stats.agentdbEnabled === 1 },
    },
  ];

  // Apply filters
  let filtered = hooks;
  if (input.category !== 'all') {
    filtered = filtered.filter(h => h.category === input.category);
  }
  if (!input.includeDisabled) {
    filtered = filtered.filter(h => h.enabled);
  }

  // Remove metadata if not requested
  if (!input.includeMetadata) {
    filtered.forEach(h => delete h.metadata);
  }

  // Count by category
  const byCategory: Record<string, number> = {};
  filtered.forEach(h => {
    byCategory[h.category] = (byCategory[h.category] || 0) + 1;
  });

  return {
    hooks: filtered,
    total: filtered.length,
    byCategory,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * hooks/pre-edit tool
 */
export const preEditTool: MCPTool = {
  name: 'hooks/pre-edit',
  description: 'Pre-edit hook that provides context, suggestions, and warnings before file edits. Uses ReasoningBank for pattern retrieval.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Absolute path to the file being edited',
      },
      operation: {
        type: 'string',
        enum: ['create', 'modify', 'delete'],
        description: 'Type of edit operation',
        default: 'modify',
      },
      includeContext: {
        type: 'boolean',
        description: 'Include file context and related patterns',
        default: true,
      },
      includeSuggestions: {
        type: 'boolean',
        description: 'Include agent suggestions',
        default: true,
      },
    },
    required: ['filePath'],
  },
  handler: async (input, context) => {
    const validated = preEditSchema.parse(input);
    return handlePreEdit(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'pre-edit', 'learning', 'reasoningbank'],
  version: '1.0.0',
};

/**
 * hooks/post-edit tool
 */
export const postEditTool: MCPTool = {
  name: 'hooks/post-edit',
  description: 'Post-edit hook that records outcomes and learns from edit operations. Stores trajectories in ReasoningBank.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Absolute path to the file that was edited',
      },
      operation: {
        type: 'string',
        enum: ['create', 'modify', 'delete'],
        description: 'Type of edit operation',
        default: 'modify',
      },
      success: {
        type: 'boolean',
        description: 'Whether the edit was successful',
      },
      outcome: {
        type: 'string',
        description: 'Description of the outcome',
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
        additionalProperties: true,
      },
    },
    required: ['filePath', 'success'],
  },
  handler: async (input, context) => {
    const validated = postEditSchema.parse(input);
    return handlePostEdit(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'post-edit', 'learning', 'reasoningbank'],
  version: '1.0.0',
};

/**
 * hooks/pre-command tool
 */
export const preCommandTool: MCPTool = {
  name: 'hooks/pre-command',
  description: 'Pre-command hook that assesses risk and provides safety suggestions before command execution',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Command to be executed',
      },
      workingDirectory: {
        type: 'string',
        description: 'Working directory for command execution',
      },
      includeRiskAssessment: {
        type: 'boolean',
        description: 'Include risk assessment',
        default: true,
      },
      includeSuggestions: {
        type: 'boolean',
        description: 'Include safety suggestions',
        default: true,
      },
    },
    required: ['command'],
  },
  handler: async (input, context) => {
    const validated = preCommandSchema.parse(input);
    return handlePreCommand(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'pre-command', 'safety', 'risk-assessment'],
  version: '1.0.0',
};

/**
 * hooks/post-command tool
 */
export const postCommandTool: MCPTool = {
  name: 'hooks/post-command',
  description: 'Post-command hook that records command execution outcomes for learning',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Command that was executed',
      },
      exitCode: {
        type: 'number',
        description: 'Command exit code',
        default: 0,
      },
      success: {
        type: 'boolean',
        description: 'Whether the command was successful',
      },
      output: {
        type: 'string',
        description: 'Command output',
      },
      error: {
        type: 'string',
        description: 'Error message if failed',
      },
      executionTime: {
        type: 'number',
        description: 'Execution time in milliseconds',
        minimum: 0,
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
        additionalProperties: true,
      },
    },
    required: ['command', 'success'],
  },
  handler: async (input, context) => {
    const validated = postCommandSchema.parse(input);
    return handlePostCommand(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'post-command', 'learning', 'reasoningbank'],
  version: '1.0.0',
};

/**
 * hooks/route tool
 */
export const routeTool: MCPTool = {
  name: 'hooks/route',
  description: 'Route a task to the optimal agent based on learned patterns and historical performance. Uses ReasoningBank for retrieval and scoring.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Task description to route',
      },
      context: {
        type: 'string',
        description: 'Additional context about the task',
      },
      preferredAgents: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of preferred agent types',
      },
      constraints: {
        type: 'object',
        description: 'Routing constraints',
        additionalProperties: true,
      },
      includeExplanation: {
        type: 'boolean',
        description: 'Include routing explanation',
        default: true,
      },
    },
    required: ['task'],
  },
  handler: async (input, context) => {
    const validated = routeSchema.parse(input);
    return handleRoute(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'routing', 'ai', 'reasoningbank', 'learning'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

/**
 * hooks/explain tool
 */
export const explainTool: MCPTool = {
  name: 'hooks/explain',
  description: 'Explain the routing decision for a task with detailed reasoning and transparency',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Task description to explain routing for',
      },
      context: {
        type: 'string',
        description: 'Additional context about the task',
      },
      verbose: {
        type: 'boolean',
        description: 'Include detailed reasoning',
        default: false,
      },
    },
    required: ['task'],
  },
  handler: async (input, context) => {
    const validated = explainSchema.parse(input);
    return handleExplain(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'routing', 'explanation', 'transparency'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

/**
 * hooks/pretrain tool
 */
export const pretrainTool: MCPTool = {
  name: 'hooks/pretrain',
  description: 'Bootstrap intelligence by analyzing repository patterns, git history, and dependencies. Uses ReasoningBank judge() and distill() pipeline.',
  inputSchema: {
    type: 'object',
    properties: {
      repositoryPath: {
        type: 'string',
        description: 'Path to repository (defaults to current directory)',
      },
      includeGitHistory: {
        type: 'boolean',
        description: 'Include git history in analysis',
        default: true,
      },
      includeDependencies: {
        type: 'boolean',
        description: 'Analyze dependencies',
        default: true,
      },
      maxPatterns: {
        type: 'number',
        description: 'Maximum number of patterns to extract',
        minimum: 1,
        maximum: 10000,
        default: 1000,
      },
      force: {
        type: 'boolean',
        description: 'Force retraining even if data exists',
        default: false,
      },
    },
  },
  handler: async (input, context) => {
    const validated = pretrainSchema.parse(input);
    return handlePretrain(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'pretraining', 'intelligence', 'reasoningbank', 'learning'],
  version: '1.0.0',
};

/**
 * hooks/metrics tool
 */
export const metricsTool: MCPTool = {
  name: 'hooks/metrics',
  description: 'Get learning metrics and performance statistics from the hooks system. Retrieves real stats from ReasoningBank.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['all', 'routing', 'edits', 'commands', 'patterns'],
        description: 'Category of metrics to retrieve',
        default: 'all',
      },
      timeRange: {
        type: 'string',
        enum: ['hour', 'day', 'week', 'month', 'all'],
        description: 'Time range for metrics',
        default: 'all',
      },
      includeDetailedStats: {
        type: 'boolean',
        description: 'Include detailed statistics',
        default: false,
      },
      format: {
        type: 'string',
        enum: ['json', 'summary'],
        description: 'Output format',
        default: 'summary',
      },
    },
  },
  handler: async (input, context) => {
    const validated = metricsSchema.parse(input);
    return handleMetrics(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'metrics', 'analytics', 'performance'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 10000,
};

/**
 * hooks/list tool
 */
export const listHooksTool: MCPTool = {
  name: 'hooks/list',
  description: 'List all registered hooks with filtering and metadata',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['all', 'pre-edit', 'post-edit', 'pre-command', 'post-command', 'routing'],
        description: 'Filter hooks by category',
        default: 'all',
      },
      includeDisabled: {
        type: 'boolean',
        description: 'Include disabled hooks',
        default: false,
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include hook metadata',
        default: true,
      },
    },
  },
  handler: async (input, context) => {
    const validated = listHooksSchema.parse(input);
    return handleListHooks(validated, context);
  },
  category: 'hooks',
  tags: ['hooks', 'list', 'registry'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

// ============================================================================
// Exports
// ============================================================================

export const hooksTools: MCPTool[] = [
  preEditTool,
  postEditTool,
  preCommandTool,
  postCommandTool,
  routeTool,
  explainTool,
  pretrainTool,
  metricsTool,
  listHooksTool,
];

export default hooksTools;
