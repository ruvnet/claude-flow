export interface MaestroSpec {
  name: string;
  description: string;
  version: string;
  goals: string[];
  workflow: WorkflowPhase[];
}

export interface WorkflowPhase {
  step: string;
  agent: string; // Name of the sub-agent
  input?: string;
  input_from?: string; // Reference to previous step's output
  input_transform?: string;
  output_format: string;
  next_step_on_success?: string;
  parallel_tasks?: Array<{ task: string; agent: string; input: string }>;
  environment?: string;
  on_failure?: string;
}

export interface TaskItem {
  id: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  assignedAgent?: string;
  dependencies?: string[];
  priority: number;
  metadata?: Record<string, any>;
}

export interface AgentProfile {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  maxConcurrentTasks: number;
  priority: number;
}

export interface SteeringContext {
  domain: string;
  guidelines: string;
  constraints: string[];
  examples?: string[];
}

export type WorkflowPhase = 
  | 'Requirements Clarification'
  | 'Research & Design'
  | 'Implementation Planning'
  | 'Task Execution'
  | 'Completed';

export interface MaestroWorkflowState {
  featureName: string;
  currentPhase: WorkflowPhase;
  currentTaskIndex: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  lastActivity: Date;
  history: Array<{ phase: WorkflowPhase; status: 'completed' | 'failed' | 'in-progress' | 'approved'; timestamp: Date; output?: any; error?: string }>;
  // Add more state as needed, e.g., for human-in-the-loop gates
}

// ===== KIRO ENHANCEMENT TYPES =====

export interface KiroEnhancedSpec extends MaestroSpec {
  livingDocumentation: LivingDocumentationConfig;
  agentHooks: AgentHookConfig[];
  consensusRequirements: ConsensusRequirements;
  patternLearning: PatternLearningConfig;
  enhancedMetadata: SpecMetadata;
}

export interface LivingDocumentationConfig {
  enabled: boolean;
  syncMode: 'bidirectional' | 'spec-to-code' | 'code-to-spec';
  autoUpdateThreshold: number; // 0-1, how much change triggers auto-update
  conflictResolution: 'manual' | 'spec-wins' | 'code-wins' | 'merge';
  versionTracking: boolean;
  changeDetectionGranularity: 'file' | 'function' | 'line';
  realTimeSync: boolean;
  watchPatterns: string[]; // File patterns to watch
  excludePatterns: string[]; // File patterns to exclude
}

export interface AgentHookConfig {
  type: 'file-change' | 'code-quality' | 'documentation' | 'testing' | 'deployment';
  trigger: HookTrigger;
  actions: HookAction[];
  conditions: HookCondition[];
  priority: number;
  enabled: boolean;
  agentTypes: string[]; // Which agent types should handle this hook
  metadata: Record<string, any>;
}

export interface HookTrigger {
  event: 'file-modified' | 'file-created' | 'file-deleted' | 'git-commit' | 'test-failed' | 'build-failed';
  patterns: string[]; // File patterns or other patterns
  debounceMs: number; // Debounce multiple triggers
  batchingEnabled: boolean;
  conditions?: string[]; // Additional trigger conditions
}

export interface HookAction {
  type: 'spawn-agent' | 'update-spec' | 'run-tests' | 'generate-docs' | 'quality-check';
  agentType: string;
  parameters: Record<string, any>;
  timeout: number;
  retryCount: number;
  background: boolean;
}

export interface HookCondition {
  type: 'file-size' | 'file-age' | 'git-status' | 'test-status' | 'custom';
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'matches';
  value: any;
  negate?: boolean;
}

export interface ConsensusRequirements {
  enabled: boolean;
  algorithm: 'simple-majority' | 'weighted-vote' | 'byzantine-fault-tolerant' | 'raft';
  minimumAgents: number;
  quorumPercentage: number; // 0-1, what percentage needed for consensus
  timeoutMs: number;
  retryCount: number;
  validatorAgentTypes: string[];
  consensusScope: 'design-phase' | 'implementation-phase' | 'all-phases';
  conflictResolution: 'revote' | 'escalate' | 'fallback-to-human';
}

export interface PatternLearningConfig {
  enabled: boolean;
  learningMode: 'passive' | 'active' | 'hybrid';
  dataCollection: {
    specHistory: boolean;
    designDecisions: boolean;
    implementationOutcomes: boolean;
    userFeedback: boolean;
  };
  modelType: 'rule-based' | 'ml-based' | 'hybrid';
  adaptationThreshold: number; // How much data before adapting
  confidenceThreshold: number; // Minimum confidence for suggestions
}

export interface SpecMetadata {
  createdAt: Date;
  lastModified: Date;
  version: string;
  contributors: string[];
  reviewers: string[];
  approvalStatus: 'draft' | 'under-review' | 'approved' | 'deprecated';
  tags: string[];
  relatedSpecs: string[];
  implementationStatus: {
    phase: string;
    progress: number; // 0-1
    quality: number; // 0-1
    testCoverage: number; // 0-1
  };
  metrics: {
    cycleTime: number; // ms from spec to implementation
    defectRate: number;
    changeFrequency: number;
    stakeholderSatisfaction: number; // 0-1
  };
}

// ===== ENHANCED WORKFLOW TYPES =====

export interface EnhancedWorkflowPhase extends WorkflowPhase {
  hooks: AgentHookConfig[];
  consensusRequired: boolean;
  livingDocSync: boolean;
  patternLearningEnabled: boolean;
  qualityGates: QualityGate[];
  parallelExecution: boolean;
  backgroundMonitoring: boolean;
}

export interface QualityGate {
  id: string;
  name: string;
  type: 'automated' | 'manual' | 'hybrid';
  criteria: QualityCriteria[];
  threshold: number; // 0-1
  blocking: boolean; // Does failure block progression?
  agentTypes: string[]; // Which agents can validate this gate
}

export interface QualityCriteria {
  metric: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte';
  value: number;
  weight: number; // 0-1, importance of this criteria
  source: 'automated-test' | 'code-analysis' | 'human-review' | 'consensus';
}

// ===== LIVING DOCUMENTATION TYPES =====

export interface LivingDocumentationState {
  specVersion: string;
  codeVersion: string;
  lastSyncTimestamp: Date;
  syncStatus: 'in-sync' | 'diverged' | 'syncing' | 'conflict';
  changesSinceLastSync: DocumentationChange[];
  conflicts: SyncConflict[];
  automatedSyncEnabled: boolean;
}

export interface DocumentationChange {
  id: string;
  type: 'spec-change' | 'code-change';
  file: string;
  section?: string;
  oldValue: string;
  newValue: string;
  timestamp: Date;
  author: string;
  confidence: number; // 0-1, how confident we are about this change
}

export interface SyncConflict {
  id: string;
  type: 'content-conflict' | 'structural-conflict' | 'semantic-conflict';
  specSection: string;
  codeSection: string;
  description: string;
  resolutionStrategy: 'manual' | 'spec-wins' | 'code-wins' | 'merge';
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
}

// ===== CONSENSUS SYSTEM TYPES =====

export interface ConsensusSession {
  id: string;
  topic: string;
  participants: ConsensusParticipant[];
  status: 'pending' | 'active' | 'completed' | 'failed' | 'timeout';
  startedAt: Date;
  completedAt?: Date;
  result?: ConsensusResult;
  rounds: ConsensusRound[];
  metadata: Record<string, any>;
}

export interface ConsensusParticipant {
  agentId: string;
  agentType: string;
  weight: number; // Voting weight based on expertise
  reliability: number; // 0-1, historical reliability
  expertise: Record<string, number>; // Domain expertise scores
  availability: boolean;
}

export interface ConsensusRound {
  round: number;
  votes: ConsensusVote[];
  result: 'consensus' | 'no-consensus' | 'timeout';
  timestamp: Date;
  convergenceMetric: number; // How close to consensus
}

export interface ConsensusVote {
  agentId: string;
  option: string;
  confidence: number; // 0-1
  reasoning: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ConsensusResult {
  decision: string;
  confidence: number; // 0-1
  unanimity: boolean;
  participationRate: number; // 0-1
  qualityScore: number; // 0-1
  dissents: ConsensusDissent[];
  metadata: Record<string, any>;
}

export interface ConsensusDissent {
  agentId: string;
  reason: string;
  alternativeProposal?: string;
  severity: 'low' | 'medium' | 'high';
}

// ===== AGENT HOOK SYSTEM TYPES =====

export interface AgentHookEvent {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: Record<string, any>;
  processed: boolean;
  processingResults?: HookProcessingResult[];
}

export interface HookProcessingResult {
  hookId: string;
  agentId: string;
  status: 'success' | 'failed' | 'timeout';
  result?: any;
  error?: string;
  processingTime: number; // ms
  timestamp: Date;
}

// ===== PATTERN LEARNING TYPES =====

export interface PatternLearningData {
  specificationPatterns: SpecPattern[];
  designPatterns: DesignPattern[];
  implementationPatterns: ImplementationPattern[];
  outcomePatterns: OutcomePattern[];
}

export interface SpecPattern {
  id: string;
  domain: string;
  pattern: string;
  frequency: number;
  successRate: number;
  contexts: string[];
  examples: string[];
}

export interface DesignPattern {
  id: string;
  architecture: string;
  components: string[];
  relationships: string[];
  applicability: string[];
  pros: string[];
  cons: string[];
  usage_frequency: number;
}

export interface ImplementationPattern {
  id: string;
  language: string;
  framework: string;
  pattern_code: string;
  complexity: 'low' | 'medium' | 'high';
  maintainability: number; // 0-1
  performance: number; // 0-1
}

export interface OutcomePattern {
  id: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  quality: number; // 0-1
  timeline: number; // actual time taken
  stakeholder_satisfaction: number; // 0-1
  lessons_learned: string[];
}

// ===== ENHANCED ORCHESTRATOR STATE =====

export interface KiroEnhancedWorkflowState extends MaestroWorkflowState {
  livingDocState: LivingDocumentationState;
  activeHooks: string[]; // Active hook IDs
  consensusSessions: ConsensusSession[];
  patternLearningData: PatternLearningData;
  qualityMetrics: QualityMetrics;
  backgroundAgents: string[]; // Background monitoring agents
  enhancedMetadata: Record<string, any>;
}

export interface QualityMetrics {
  codeQuality: number; // 0-1
  documentationQuality: number; // 0-1
  testCoverage: number; // 0-1
  specCompleteness: number; // 0-1
  implementationFidelity: number; // 0-1, how well code matches spec
  consensusReliability: number; // 0-1
  cycletime: number; // ms
  defectDensity: number; // defects per KLOC
}
