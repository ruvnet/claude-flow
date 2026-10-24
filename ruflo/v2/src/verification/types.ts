/**
 * Verification Engine Types and Interfaces
 * Comprehensive type definitions for the verification system
 */

import type { AgentId, TaskId, SwarmId, TaskResult, AgentState } from '../swarm/types.js';

// ===== CORE VERIFICATION TYPES =====

export type VerificationLevel = 'basic' | 'standard' | 'strict' | 'critical';
export type VerificationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled';
export type CheckpointType = 'pre_execution' | 'mid_execution' | 'post_execution' | 'rollback_point';
export type ClaimType = 'task_completion' | 'quality_metric' | 'performance_benchmark' | 'system_state' | 'agent_capability';

// ===== TRUTH SCORING =====

export interface TruthScoreConfig {
  /** Minimum threshold for truth score (0-1, default: 0.95) */
  threshold: number;
  /** Weighted factors for scoring */
  weights: TruthScoringWeights;
  /** Enable/disable specific validation checks */
  checks: TruthValidationChecks;
  /** Confidence intervals for statistical validation */
  confidence: ConfidenceConfig;
}

export interface TruthScoringWeights {
  /** Weight for agent reliability history (0-1) */
  agentReliability: number;
  /** Weight for cross-validation results (0-1) */
  crossValidation: number;
  /** Weight for external verification (0-1) */
  externalVerification: number;
  /** Weight for consistency with known facts (0-1) */
  factualConsistency: number;
  /** Weight for logical coherence (0-1) */
  logicalCoherence: number;
}

export interface TruthValidationChecks {
  /** Validate against agent performance history */
  historicalValidation: boolean;
  /** Cross-check with multiple agents */
  crossAgentValidation: boolean;
  /** Verify against external sources */
  externalValidation: boolean;
  /** Check for logical consistency */
  logicalValidation: boolean;
  /** Validate statistical claims */
  statisticalValidation: boolean;
}

export interface ConfidenceConfig {
  /** Confidence level for statistical tests (e.g., 0.95 for 95%) */
  level: number;
  /** Sample size requirements */
  minSampleSize: number;
  /** Maximum acceptable error margin */
  maxErrorMargin: number;
}

export interface TruthScore {
  /** Overall truth score (0-1) */
  score: number;
  /** Individual component scores */
  components: TruthScoreComponents;
  /** Confidence intervals */
  confidence: ConfidenceInterval;
  /** Evidence supporting the score */
  evidence: TruthEvidence[];
  /** Computed timestamp */
  timestamp: Date;
  /** Validation metadata */
  metadata: Record<string, unknown>;
}

export interface TruthScoreComponents {
  agentReliability: number;
  crossValidation: number;
  externalVerification: number;
  factualConsistency: number;
  logicalCoherence: number;
  overall: number;
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
  level: number;
}

export interface TruthEvidence {
  type: 'agent_history' | 'cross_validation' | 'external_source' | 'logical_proof' | 'statistical_test';
  source: string;
  weight: number;
  score: number;
  details: Record<string, unknown>;
  timestamp: Date;
}

// ===== VERIFICATION PIPELINE =====

export interface VerificationPipelineConfig {
  /** Pipeline identification */
  id: string;
  name: string;
  description: string;
  
  /** Pipeline configuration */
  level: VerificationLevel;
  checkpoints: VerificationCheckpoint[];
  truthScoreConfig: TruthScoreConfig;
  
  /** Execution settings */
  parallel: boolean;
  timeout: number;
  retryAttempts: number;
  
  /** Rollback settings */
  enableRollback: boolean;
  snapshotInterval: number;
  maxSnapshots: number;
  
  /** Reporting settings */
  reportLevel: 'minimal' | 'standard' | 'detailed' | 'comprehensive';
  notifications: NotificationConfig[];
}

export interface VerificationCheckpoint {
  /** Checkpoint identification */
  id: string;
  name: string;
  type: CheckpointType;
  
  /** Execution configuration */
  mandatory: boolean;
  order: number;
  dependencies: string[];
  
  /** Validation rules */
  validators: CheckpointValidator[];
  conditions: CheckpointCondition[];
  
  /** Execution settings */
  timeout: number;
  retryAttempts: number;
  
  /** Rollback configuration */
  createSnapshot: boolean;
  rollbackOnFailure: boolean;
}

export interface CheckpointValidator {
  id: string;
  type: 'truth_score' | 'agent_claim' | 'integration_test' | 'state_validation' | 'custom';
  config: Record<string, unknown>;
  weight: number;
  required: boolean;
}

export interface CheckpointCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'regex' | 'custom';
  value: unknown;
  description: string;
}

export interface NotificationConfig {
  type: 'email' | 'webhook' | 'slack' | 'teams' | 'custom';
  endpoint: string;
  conditions: string[];
  template: string;
}

export interface VerificationResult {
  /** Result identification */
  id: string;
  pipelineId: string;
  timestamp: Date;
  
  /** Overall result */
  status: VerificationStatus;
  score: number;
  passed: boolean;
  
  /** Detailed results */
  checkpointResults: CheckpointResult[];
  truthScore: TruthScore;
  
  /** Performance metrics */
  duration: number;
  resourceUsage: ResourceUsage;
  
  /** Evidence and artifacts */
  evidence: VerificationEvidence[];
  artifacts: Record<string, unknown>;
  
  /** Error information */
  errors: VerificationError[];
  warnings: VerificationWarning[];
  
  /** Recommendations */
  recommendations: string[];
  nextSteps: string[];
}

export interface CheckpointResult {
  checkpointId: string;
  status: VerificationStatus;
  score: number;
  passed: boolean;
  duration: number;
  validatorResults: ValidatorResult[];
  evidence: VerificationEvidence[];
  errors: VerificationError[];
  warnings: VerificationWarning[];
}

export interface ValidatorResult {
  validatorId: string;
  status: VerificationStatus;
  score: number;
  passed: boolean;
  details: Record<string, unknown>;
  evidence: VerificationEvidence[];
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  disk: number;
  network: number;
  tokens?: number;
  apiCalls?: number;
}

export interface VerificationEvidence {
  type: string;
  source: string;
  timestamp: Date;
  data: Record<string, unknown>;
  reliability: number;
  weight: number;
}

export interface VerificationError {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context: Record<string, unknown>;
  recoverable: boolean;
  timestamp: Date;
}

export interface VerificationWarning {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  context: Record<string, unknown>;
  recommendation: string;
  timestamp: Date;
}

// ===== AGENT CLAIM VALIDATION =====

export interface AgentClaim {
  /** Claim identification */
  id: string;
  agentId: AgentId;
  taskId?: TaskId;
  swarmId?: SwarmId;
  
  /** Claim details */
  type: ClaimType;
  title: string;
  description: string;
  
  /** Claim data */
  data: Record<string, unknown>;
  metrics: ClaimMetrics;
  
  /** Supporting evidence */
  evidence: ClaimEvidence[];
  references: string[];
  
  /** Validation status */
  status: VerificationStatus;
  confidence: number;
  
  /** Timestamps */
  submittedAt: Date;
  validatedAt?: Date;
  
  /** Validation metadata */
  metadata: Record<string, unknown>;
}

export interface ClaimMetrics {
  /** Performance metrics */
  executionTime?: number;
  resourceUsage?: ResourceUsage;
  throughput?: number;
  errorRate?: number;
  
  /** Quality metrics */
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  
  /** Custom metrics */
  custom: Record<string, number>;
}

export interface ClaimEvidence {
  type: 'log_entry' | 'test_result' | 'measurement' | 'artifact' | 'witness_testimony' | 'external_verification';
  source: string;
  timestamp: Date;
  data: Record<string, unknown>;
  reliability: number;
  verifiable: boolean;
}

export interface ClaimValidationConfig {
  /** Validation rules */
  requiredEvidence: string[];
  minimumConfidence: number;
  crossValidationRequired: boolean;
  
  /** Verification methods */
  methods: ClaimValidationMethod[];
  
  /** Timeout and retry settings */
  timeout: number;
  retryAttempts: number;
  
  /** Quality thresholds */
  qualityThresholds: Record<string, number>;
}

export interface ClaimValidationMethod {
  name: string;
  type: 'historical_comparison' | 'cross_agent_verification' | 'external_validation' | 'statistical_test' | 'custom';
  config: Record<string, unknown>;
  weight: number;
  required: boolean;
}

export interface ClaimValidationResult {
  claimId: string;
  status: VerificationStatus;
  confidence: number;
  score: number;
  passed: boolean;
  
  methodResults: MethodValidationResult[];
  evidence: VerificationEvidence[];
  
  duration: number;
  timestamp: Date;
  
  errors: VerificationError[];
  warnings: VerificationWarning[];
  recommendations: string[];
}

export interface MethodValidationResult {
  methodName: string;
  status: VerificationStatus;
  score: number;
  confidence: number;
  details: Record<string, unknown>;
  evidence: VerificationEvidence[];
}

// ===== INTEGRATION TESTING =====

export interface IntegrationTestConfig {
  /** Test identification */
  id: string;
  name: string;
  description: string;
  
  /** Test scope */
  agents: AgentId[];
  tasks: TaskId[];
  swarms: SwarmId[];
  
  /** Test scenarios */
  scenarios: TestScenario[];
  
  /** Execution settings */
  parallel: boolean;
  timeout: number;
  retryAttempts: number;
  
  /** Environment settings */
  environment: TestEnvironment;
  
  /** Validation criteria */
  validationCriteria: ValidationCriteria;
}

export interface TestScenario {
  id: string;
  name: string;
  description: string;
  
  /** Test steps */
  steps: TestStep[];
  
  /** Setup and teardown */
  setup?: TestStep[];
  teardown?: TestStep[];
  
  /** Dependencies */
  dependencies: string[];
  
  /** Expected outcomes */
  expectedResults: ExpectedResult[];
  
  /** Resource requirements */
  resources: ResourceRequirements;
}

export interface TestStep {
  id: string;
  name: string;
  type: 'agent_action' | 'system_action' | 'validation' | 'wait' | 'custom';
  
  /** Step configuration */
  config: Record<string, unknown>;
  params: Record<string, unknown>;
  
  /** Execution settings */
  timeout: number;
  retryAttempts: number;
  continueOnError: boolean;
  
  /** Validation */
  validators: TestValidator[];
  assertions: TestAssertion[];
}

export interface TestValidator {
  type: string;
  config: Record<string, unknown>;
  weight: number;
  required: boolean;
}

export interface TestAssertion {
  field: string;
  operator: string;
  expected: unknown;
  actual?: unknown;
  passed?: boolean;
  message?: string;
}

export interface ExpectedResult {
  type: 'agent_state' | 'task_result' | 'system_metric' | 'custom';
  criteria: Record<string, unknown>;
  tolerance: number;
  required: boolean;
}

export interface ResourceRequirements {
  cpu: number;
  memory: number;
  disk: number;
  network: number;
  agents: number;
  duration: number;
}

export interface TestEnvironment {
  name: string;
  variables: Record<string, string>;
  services: ServiceConfig[];
  constraints: EnvironmentConstraint[];
}

export interface ServiceConfig {
  name: string;
  type: string;
  config: Record<string, unknown>;
  healthCheck: HealthCheck;
}

export interface HealthCheck {
  type: 'http' | 'tcp' | 'exec' | 'custom';
  config: Record<string, unknown>;
  interval: number;
  timeout: number;
  retries: number;
}

export interface EnvironmentConstraint {
  type: string;
  value: unknown;
  description: string;
}

export interface ValidationCriteria {
  /** Performance criteria */
  maxExecutionTime: number;
  minThroughput: number;
  maxErrorRate: number;
  
  /** Quality criteria */
  minAccuracy: number;
  minReliability: number;
  minConsistency: number;
  
  /** Resource criteria */
  maxResourceUsage: ResourceUsage;
  
  /** Custom criteria */
  custom: Record<string, unknown>;
}

export interface IntegrationTestResult {
  /** Test identification */
  testId: string;
  timestamp: Date;
  
  /** Overall result */
  status: VerificationStatus;
  passed: boolean;
  score: number;
  
  /** Scenario results */
  scenarioResults: ScenarioResult[];
  
  /** Performance metrics */
  duration: number;
  resourceUsage: ResourceUsage;
  
  /** Quality metrics */
  coverage: TestCoverage;
  reliability: number;
  
  /** Evidence and artifacts */
  evidence: VerificationEvidence[];
  artifacts: Record<string, unknown>;
  logs: TestLog[];
  
  /** Error information */
  errors: VerificationError[];
  warnings: VerificationWarning[];
  
  /** Analysis and recommendations */
  analysis: TestAnalysis;
  recommendations: string[];
}

export interface ScenarioResult {
  scenarioId: string;
  status: VerificationStatus;
  passed: boolean;
  score: number;
  duration: number;
  
  stepResults: StepResult[];
  validationResults: ValidationResult[];
  
  evidence: VerificationEvidence[];
  artifacts: Record<string, unknown>;
  
  errors: VerificationError[];
  warnings: VerificationWarning[];
}

export interface StepResult {
  stepId: string;
  status: VerificationStatus;
  passed: boolean;
  duration: number;
  
  validatorResults: ValidatorResult[];
  assertionResults: AssertionResult[];
  
  output: Record<string, unknown>;
  evidence: VerificationEvidence[];
}

export interface AssertionResult {
  field: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
  timestamp: Date;
}

export interface ValidationResult {
  type: string;
  passed: boolean;
  score: number;
  details: Record<string, unknown>;
  evidence: VerificationEvidence[];
}

export interface TestCoverage {
  agents: number;
  tasks: number;
  scenarios: number;
  steps: number;
  assertions: number;
  percentage: number;
}

export interface TestLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  source: string;
  context: Record<string, unknown>;
}

export interface TestAnalysis {
  bottlenecks: PerformanceBottleneck[];
  patterns: TestPattern[];
  insights: TestInsight[];
  trends: TestTrend[];
}

export interface PerformanceBottleneck {
  type: string;
  location: string;
  impact: number;
  description: string;
  recommendations: string[];
}

export interface TestPattern {
  type: string;
  pattern: string;
  frequency: number;
  significance: number;
  examples: string[];
}

export interface TestInsight {
  category: string;
  insight: string;
  confidence: number;
  evidence: string[];
  implications: string[];
}

export interface TestTrend {
  metric: string;
  direction: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  magnitude: number;
  significance: number;
  period: string;
}

// ===== STATE SNAPSHOT SYSTEM =====

export interface StateSnapshotConfig {
  /** Snapshot identification */
  id: string;
  name: string;
  description: string;
  
  /** Snapshot scope */
  scope: SnapshotScope;
  
  /** Storage settings */
  storage: SnapshotStorageConfig;
  
  /** Retention settings */
  retention: SnapshotRetentionConfig;
  
  /** Compression settings */
  compression: SnapshotCompressionConfig;
  
  /** Encryption settings */
  encryption?: SnapshotEncryptionConfig;
}

export interface SnapshotScope {
  /** Include agent states */
  includeAgents: boolean;
  agentFilter?: AgentFilter;
  
  /** Include task states */
  includeTasks: boolean;
  taskFilter?: TaskFilter;
  
  /** Include swarm states */
  includeSwarms: boolean;
  swarmFilter?: SwarmFilter;
  
  /** Include system state */
  includeSystem: boolean;
  systemComponents: string[];
  
  /** Include memory state */
  includeMemory: boolean;
  memoryPartitions: string[];
  
  /** Custom inclusions */
  custom: Record<string, boolean>;
}

export interface AgentFilter {
  types: string[];
  statuses: string[];
  tags: string[];
  exclude: AgentId[];
}

export interface TaskFilter {
  types: string[];
  statuses: string[];
  priorities: string[];
  exclude: TaskId[];
}

export interface SwarmFilter {
  modes: string[];
  strategies: string[];
  statuses: string[];
  exclude: SwarmId[];
}

export interface SnapshotStorageConfig {
  type: 'local' | 'remote' | 'distributed' | 'cloud';
  location: string;
  redundancy: number;
  checksum: boolean;
  versioning: boolean;
}

export interface SnapshotRetentionConfig {
  maxSnapshots: number;
  maxAge: number;
  strategy: 'fifo' | 'lru' | 'importance' | 'custom';
  archiveOld: boolean;
  archiveLocation?: string;
}

export interface SnapshotCompressionConfig {
  enabled: boolean;
  algorithm: 'gzip' | 'brotli' | 'lz4' | 'zstd';
  level: number;
  threshold: number;
}

export interface SnapshotEncryptionConfig {
  enabled: boolean;
  algorithm: 'aes-256-gcm' | 'chacha20-poly1305' | 'custom';
  keyDerivation: 'pbkdf2' | 'scrypt' | 'argon2';
  saltLength: number;
}

export interface StateSnapshot {
  /** Snapshot identification */
  id: string;
  name: string;
  description: string;
  
  /** Snapshot metadata */
  timestamp: Date;
  version: string;
  checksum: string;
  
  /** Snapshot scope */
  scope: SnapshotScope;
  
  /** Snapshot data */
  agentStates: Record<string, AgentState>;
  taskStates: Record<string, TaskResult>;
  swarmStates: Record<string, SwarmState>;
  systemState: SystemState;
  memoryState: MemoryState;
  customState: Record<string, unknown>;
  
  /** Snapshot statistics */
  statistics: SnapshotStatistics;
  
  /** Storage information */
  storage: SnapshotStorageInfo;
  
  /** Validation information */
  validation: SnapshotValidation;
}

export interface SwarmState {
  id: SwarmId;
  status: string;
  progress: Record<string, unknown>;
  metrics: Record<string, unknown>;
  configuration: Record<string, unknown>;
  timestamp: Date;
}

export interface SystemState {
  timestamp: Date;
  version: string;
  uptime: number;
  resources: ResourceUsage;
  services: ServiceState[];
  configuration: Record<string, unknown>;
  health: HealthState;
}

export interface ServiceState {
  name: string;
  status: string;
  health: string;
  metrics: Record<string, unknown>;
  configuration: Record<string, unknown>;
  timestamp: Date;
}

export interface HealthState {
  overall: string;
  components: Record<string, string>;
  checks: HealthCheckResult[];
  timestamp: Date;
}

export interface HealthCheckResult {
  name: string;
  status: string;
  message: string;
  duration: number;
  timestamp: Date;
}

export interface MemoryState {
  timestamp: Date;
  partitions: Record<string, MemoryPartitionState>;
  statistics: MemoryStatistics;
  integrity: MemoryIntegrity;
}

export interface MemoryPartitionState {
  id: string;
  type: string;
  entries: number;
  size: number;
  lastModified: Date;
  checksum: string;
}

export interface MemoryStatistics {
  totalEntries: number;
  totalSize: number;
  utilizationRate: number;
  accessPatterns: Record<string, number>;
  performance: Record<string, number>;
}

export interface MemoryIntegrity {
  checksumValid: boolean;
  corruptedEntries: string[];
  missingReferences: string[];
  inconsistencies: string[];
}

export interface SnapshotStatistics {
  totalSize: number;
  compressedSize: number;
  compressionRatio: number;
  entryCount: Record<string, number>;
  captureTime: number;
  validationTime: number;
}

export interface SnapshotStorageInfo {
  type: string;
  location: string;
  size: number;
  checksum: string;
  encrypted: boolean;
  redundancy: number;
  accessibility: string;
}

export interface SnapshotValidation {
  checksumValid: boolean;
  structureValid: boolean;
  dataIntegrity: boolean;
  versionCompatible: boolean;
  errors: string[];
  warnings: string[];
  timestamp: Date;
}

export interface RollbackConfig {
  /** Rollback identification */
  id: string;
  snapshotId: string;
  reason: string;
  
  /** Rollback scope */
  scope: RollbackScope;
  
  /** Rollback strategy */
  strategy: RollbackStrategy;
  
  /** Safety settings */
  safety: RollbackSafetyConfig;
  
  /** Notification settings */
  notifications: NotificationConfig[];
}

export interface RollbackScope {
  includeAgents: boolean;
  includeTasks: boolean;
  includeSwarms: boolean;
  includeSystem: boolean;
  includeMemory: boolean;
  
  /** Partial rollback filters */
  agentFilter?: AgentFilter;
  taskFilter?: TaskFilter;
  swarmFilter?: SwarmFilter;
  
  /** Exclude from rollback */
  preserveData: string[];
}

export interface RollbackStrategy {
  type: 'immediate' | 'gradual' | 'selective' | 'custom';
  stopRunningTasks: boolean;
  backupCurrent: boolean;
  validateBefore: boolean;
  validateAfter: boolean;
  rollbackTimeout: number;
}

export interface RollbackSafetyConfig {
  requireConfirmation: boolean;
  maxRollbackTime: number;
  emergencyStop: boolean;
  backupRequired: boolean;
  validationRequired: boolean;
  approvalRequired: boolean;
}

export interface RollbackResult {
  /** Rollback identification */
  id: string;
  snapshotId: string;
  timestamp: Date;
  
  /** Result status */
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  success: boolean;
  
  /** Rollback details */
  scope: RollbackScope;
  duration: number;
  
  /** Component results */
  componentResults: ComponentRollbackResult[];
  
  /** Validation results */
  validation: RollbackValidation;
  
  /** Data preservation */
  preservedData: string[];
  lostData: string[];
  
  /** Backup information */
  backupSnapshot?: string;
  
  /** Error information */
  errors: VerificationError[];
  warnings: VerificationWarning[];
  
  /** Recovery information */
  recoveryActions: string[];
  nextSteps: string[];
}

export interface ComponentRollbackResult {
  component: string;
  status: 'completed' | 'failed' | 'skipped';
  duration: number;
  itemsRolledBack: number;
  itemsFailed: number;
  errors: string[];
}

export interface RollbackValidation {
  preValidation: ValidationResult;
  postValidation: ValidationResult;
  dataIntegrity: boolean;
  systemHealth: boolean;
  functionalityPreserved: boolean;
}

// ===== UTILITY TYPES =====

export type VerificationCallback = (result: VerificationResult) => void | Promise<void>;
export type CheckpointCallback = (result: CheckpointResult) => void | Promise<void>;
export type ClaimValidationCallback = (result: ClaimValidationResult) => void | Promise<void>;
export type TestCompletionCallback = (result: IntegrationTestResult) => void | Promise<void>;
export type SnapshotCallback = (snapshot: StateSnapshot) => void | Promise<void>;
export type RollbackCallback = (result: RollbackResult) => void | Promise<void>;

// ===== TYPE GUARDS =====

export function isTruthScore(obj: unknown): obj is TruthScore {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as TruthScore).score === 'number' &&
    typeof (obj as TruthScore).components === 'object' &&
    (obj as TruthScore).timestamp instanceof Date
  );
}

export function isVerificationResult(obj: unknown): obj is VerificationResult {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as VerificationResult).id === 'string' &&
    typeof (obj as VerificationResult).status === 'string' &&
    typeof (obj as VerificationResult).passed === 'boolean'
  );
}

export function isAgentClaim(obj: unknown): obj is AgentClaim {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as AgentClaim).id === 'string' &&
    typeof (obj as AgentClaim).type === 'string' &&
    (obj as AgentClaim).submittedAt instanceof Date
  );
}

export function isStateSnapshot(obj: unknown): obj is StateSnapshot {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as StateSnapshot).id === 'string' &&
    (obj as StateSnapshot).timestamp instanceof Date &&
    typeof (obj as StateSnapshot).checksum === 'string'
  );
}

// ===== CONSTANTS =====

export const VERIFICATION_CONSTANTS = {
  // Default thresholds
  DEFAULT_TRUTH_THRESHOLD: 0.95,
  DEFAULT_CONFIDENCE_LEVEL: 0.95,
  DEFAULT_MIN_SAMPLE_SIZE: 30,
  DEFAULT_MAX_ERROR_MARGIN: 0.05,
  
  // Timeouts
  DEFAULT_VERIFICATION_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  DEFAULT_CHECKPOINT_TIMEOUT: 2 * 60 * 1000, // 2 minutes
  DEFAULT_CLAIM_VALIDATION_TIMEOUT: 1 * 60 * 1000, // 1 minute
  DEFAULT_TEST_TIMEOUT: 10 * 60 * 1000, // 10 minutes
  DEFAULT_ROLLBACK_TIMEOUT: 3 * 60 * 1000, // 3 minutes
  
  // Retry limits
  DEFAULT_RETRY_ATTEMPTS: 3,
  MAX_RETRY_ATTEMPTS: 10,
  
  // Snapshot limits
  DEFAULT_MAX_SNAPSHOTS: 100,
  DEFAULT_SNAPSHOT_RETENTION_DAYS: 30,
  DEFAULT_COMPRESSION_THRESHOLD: 1024 * 1024, // 1MB
  
  // Quality thresholds
  MIN_TRUTH_SCORE: 0.0,
  MAX_TRUTH_SCORE: 1.0,
  HIGH_CONFIDENCE_THRESHOLD: 0.9,
  MEDIUM_CONFIDENCE_THRESHOLD: 0.7,
  LOW_CONFIDENCE_THRESHOLD: 0.5,
  
  // Resource limits
  MAX_VERIFICATION_MEMORY: 512 * 1024 * 1024, // 512MB
  MAX_SNAPSHOT_SIZE: 1024 * 1024 * 1024, // 1GB
  MAX_TEST_DURATION: 60 * 60 * 1000, // 1 hour
} as const;

export default {
  VERIFICATION_CONSTANTS,
  isTruthScore,
  isVerificationResult,
  isAgentClaim,
  isStateSnapshot,
};