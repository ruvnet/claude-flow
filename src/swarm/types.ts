import { getErrorMessage } from '../utils/error-handler.js';
/**
 * Comprehensive types and interfaces for the swarm system
 */

import { EventEmitter } from 'node:events';

// ===== CORE SWARM TYPES =====

export interface SwarmId {
  id: string;
  timestamp: number;
  namespace: string;
}

export interface AgentId {
  id: string;
  swarmId: string;
  type: AgentType;
  instance: number;
}

export interface TaskId {
  id: string;
  swarmId: string;
  sequence: number;
  priority: number;
}

// ===== AGENT TYPES =====

export type AgentType = 
  | 'coordinator'    // Orchestrates and manages other agents
  | 'researcher'     // Performs research and data gathering
  | 'coder'          // Writes and maintains code (was 'coder')
  | 'analyst'        // Analyzes data and generates insights (was 'analyst')
  | 'architect'      // Designs system architecture and solutions
  | 'tester'         // Tests and validates functionality
  | 'reviewer'       // Reviews and validates work
  | 'optimizer'      // Optimizes performance and efficiency
  | 'documenter'     // Creates and maintains documentation
  | 'monitor'        // Monitors system health and performance
  | 'specialist';    // Domain-specific specialized agent

export type AgentStatus = 
  | 'initializing'   // Agent is starting up
  | 'idle'           // Available for tasks
  | 'busy'           // Currently executing task
  | 'paused'         // Temporarily unavailable
  | 'error'          // In error state
  | 'offline'        // Not available
  | 'terminating'    // Shutting down
  | 'terminated';    // Shut down

export interface AgentCapabilities {
  // Core capabilities
  codeGeneration: boolean;
  codeReview: boolean;
  testing: boolean;
  documentation: boolean;
  research: boolean;
  analysis: boolean;
  
  // Communication capabilities
  webSearch: boolean;
  apiIntegration: boolean;
  fileSystem: boolean;
  terminalAccess: boolean;
  
  // Specialized capabilities
  languages: string[];         // Programming languages
  frameworks: string[];        // Frameworks and libraries
  domains: string[];          // Domain expertise
  tools: string[];            // Available tools
  
  // Resource limits
  maxConcurrentTasks: number;
  maxMemoryUsage: number;
  maxExecutionTime: number;
  
  // Performance characteristics
  reliability: number;        // 0-1 reliability score
  speed: number;             // Relative speed rating
  quality: number;           // Quality rating
}

export interface AgentMetrics {
  // Performance metrics
  tasksCompleted: number;
  tasksFailed: number;
  averageExecutionTime: number;
  successRate: number;
  
  // Resource usage
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkUsage: number;
  
  // Quality metrics
  codeQuality: number;
  testCoverage: number;
  bugRate: number;
  userSatisfaction: number;
  
  // Time tracking
  totalUptime: number;
  lastActivity: Date;
  responseTime: number;
}

export interface AgentState {
  id: AgentId;
  name: string;
  type: AgentType;
  status: AgentStatus;
  capabilities: AgentCapabilities;
  metrics: AgentMetrics;
  
  // Current state
  currentTask?: TaskId;
  workload: number;           // 0-1 current workload
  health: number;             // 0-1 health score
  
  // Configuration
  config: AgentConfig;
  environment: AgentEnvironment;
  
  // Communication
  endpoints: string[];
  lastHeartbeat: Date;
  
  // History
  taskHistory: TaskId[];
  errorHistory: AgentError[];
  
  // Relationships
  parentAgent?: AgentId;
  childAgents: AgentId[];
  collaborators: AgentId[];
}

export interface AgentConfig {
  // Behavior settings
  autonomyLevel: number;      // 0-1 how autonomous the agent is
  learningEnabled: boolean;
  adaptationEnabled: boolean;
  
  // Resource limits
  maxTasksPerHour: number;
  maxConcurrentTasks: number;
  timeoutThreshold: number;
  
  // Communication settings
  reportingInterval: number;
  heartbeatInterval: number;
  
  // Security settings
  permissions: string[];
  trustedAgents: AgentId[];
  
  // Specialization
  expertise: Record<string, number>;
  preferences: Record<string, any>;
}

export interface AgentEnvironment {
  // Runtime environment
  runtime: 'deno' | 'node' | 'claude' | 'browser';
  version: string;
  
  // Available resources
  workingDirectory: string;
  tempDirectory: string;
  logDirectory: string;
  
  // Network configuration
  apiEndpoints: Record<string, string>;
  credentials: Record<string, string>;
  
  // Tool access
  availableTools: string[];
  toolConfigs: Record<string, any>;
}

export interface AgentError {
  timestamp: Date;
  type: string;
  message: string;
  stack?: string;
  context: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolved: boolean;
}

// ===== TASK TYPES =====

export type TaskType = 
  | 'research'       // Information gathering and research
  | 'analysis'       // Data analysis and insights
  | 'coding'         // Code generation and modification
  | 'testing'        // Test creation and execution
  | 'review'         // Code and content review
  | 'documentation'  // Documentation creation
  | 'deployment'     // Deployment and operations
  | 'monitoring'     // System monitoring
  | 'coordination'   // Cross-agent coordination
  | 'communication'  // External communication
  | 'maintenance'    // System maintenance
  | 'optimization'   // Performance optimization
  | 'validation'     // Validation and verification
  | 'integration'    // System integration
  | 'custom'         // Custom task type
  // Analyst-specific task types
  | 'data-analysis'
  | 'performance-analysis'
  | 'statistical-analysis'
  | 'visualization'
  | 'predictive-modeling'
  | 'anomaly-detection'
  | 'trend-analysis'
  | 'business-intelligence'
  | 'quality-analysis' | 'system-design' | 'architecture-review' | 'api-design' | 'cloud-architecture' | 'microservices-design' | 'security-architecture' | 'scalability-design' | 'database-architecture' | 'code-generation' | 'code-review' | 'refactoring' | 'debugging' | 'api-development' | 'database-design' | 'performance-optimization' | 'task-orchestration' | 'progress-tracking' | 'resource-allocation' | 'workflow-management' | 'team-coordination' | 'status-reporting' | 'fact-check' | 'literature-review' | 'market-analysis' | 'unit-testing' | 'integration-testing' | 'e2e-testing' | 'performance-testing' | 'security-testing' | 'api-testing' | 'test-automation' | 'test-analysis';

export type TaskStatus = 
  | 'created'        // Task has been created
  | 'queued'         // Waiting for assignment
  | 'assigned'       // Assigned to an agent
  | 'running'        // Currently being executed
  | 'paused'         // Temporarily paused
  | 'completed'      // Successfully completed
  | 'failed'         // Failed with error
  | 'cancelled'      // Cancelled by user/system
  | 'timeout'        // Timed out
  | 'retrying'       // Being retried
  | 'blocked';       // Blocked by dependencies

export type TaskPriority = 
  | 'critical'       // Must be done immediately
  | 'high'           // Important, do soon
  | 'normal'         // Standard priority
  | 'low'            // Can be delayed
  | 'background';    // Run when resources available

export interface TaskRequirements {
  // Agent requirements
  agentType?: AgentType;
  capabilities: string[];
  minReliability?: number;
  
  // Resource requirements
  estimatedDuration?: number;
  maxDuration?: number;
  memoryRequired?: number;
  cpuRequired?: number;
  
  // Environment requirements
  tools: string[];
  permissions: string[];
  environment?: Record<string, any>;
  
  // Quality requirements
  reviewRequired?: boolean;
  testingRequired?: boolean;
  documentationRequired?: boolean;
}

export interface TaskConstraints {
  // Time constraints
  deadline?: Date;
  startAfter?: Date;
  maxRetries?: number;
  maxTokens?: number;
  timeoutAfter?: number;
  
  // Resource constraints
  maxCost?: number;
  exclusiveAccess?: string[];
  
  // Dependency constraints
  dependencies: TaskId[];
  dependents: TaskId[];
  conflicts: TaskId[];
  
  // Agent constraints
  preferredAgents?: AgentId[];
  excludedAgents?: AgentId[];
  requiresHuman?: boolean;
}

export interface TaskResult {
  // Result data
  output: any;
  artifacts: Record<string, any>;
  metadata: Record<string, any>;
  
  // Quality metrics
  quality: number;
  completeness: number;
  accuracy: number;
  
  // Performance metrics
  executionTime: number;
  resourcesUsed: Record<string, number>;
  
  // Validation
  validated: boolean;
  validationResults?: any;
  
  // Follow-up
  recommendations?: string[];
  nextSteps?: string[];
}

export interface TaskDefinition {
  id: TaskId;
  type: TaskType;
  name: string;
  description: string;
  
  // Task specification
  requirements: TaskRequirements;
  constraints: TaskConstraints;
  priority: TaskPriority;
  
  // Input/Output
  input: any;
  expectedOutput?: any;
  
  // Execution details
  instructions: string;
  context: Record<string, any>;
  parameters?: Record<string, any>;
  examples?: any[];
  
  // Tracking
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  
  // Assignment
  assignedTo?: AgentId;
  assignedAt?: Date;
  
  // Execution
  startedAt?: Date;
  completedAt?: Date;
  result?: TaskResult;
  error?: TaskError;
  
  // History
  attempts: TaskAttempt[];
  statusHistory: TaskStatusChange[];
}

export interface TaskAttempt {
  attemptNumber: number;
  agent: AgentId;
  startedAt: Date;
  completedAt?: Date;
  status: TaskStatus;
  result?: TaskResult;
  error?: TaskError;
  resourcesUsed: Record<string, number>;
}

export interface TaskStatusChange {
  timestamp: Date;
  from: TaskStatus;
  to: TaskStatus;
  reason: string;
  triggeredBy: AgentId | 'system' | 'user';
}

export interface TaskError {
  type: string;
  message: string;
  code?: string;
  stack?: string;
  context: Record<string, any>;
  recoverable: boolean;
  retryable: boolean;
}

// ===== SWARM TYPES =====

export type SwarmMode = 
  | 'centralized'    // Single coordinator manages all
  | 'distributed'    // Multiple coordinators
  | 'hierarchical'   // Tree structure of coordinators
  | 'mesh'           // Peer-to-peer coordination
  | 'hybrid';        // Mixed coordination strategies

export type SwarmStrategy = 
  | 'auto'           // Automatically determine approach
  | 'research'       // Research-focused strategy
  | 'development'    // Development-focused strategy
  | 'analysis'       // Analysis-focused strategy
  | 'testing'        // Testing-focused strategy
  | 'optimization'   // Performance optimization
  | 'maintenance'    // System maintenance
  | 'custom';        // Custom strategy

export interface SwarmObjective {
  id: string;
  name: string;
  description: string;
  
  // Strategy
  strategy: SwarmStrategy;
  mode: SwarmMode;
  
  // Requirements
  requirements: SwarmRequirements;
  constraints: SwarmConstraints;
  
  // Decomposition
  tasks: TaskDefinition[];
  dependencies: TaskDependency[];
  
  // Execution
  status: SwarmStatus;
  progress: SwarmProgress;
  
  // Timeline
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  deadline?: Date;
  
  // Results
  results?: SwarmResults;
  metrics: SwarmMetrics;
}

export interface SwarmRequirements {
  // Agent requirements
  minAgents: number;
  maxAgents: number;
  agentTypes: AgentType[];
  
  // Resource requirements
  estimatedDuration: number;
  maxDuration: number;
  resourceBudget?: Record<string, number>;
  
  // Quality requirements
  qualityThreshold: number;
  reviewCoverage: number;
  testCoverage: number;
  
  // Performance requirements
  throughputTarget?: number;
  latencyTarget?: number;
  reliabilityTarget: number;
}

export interface SwarmConstraints {
  // Time constraints
  deadline?: Date;
  milestones: SwarmMilestone[];
  
  // Resource constraints
  maxCost?: number;
  resourceLimits: Record<string, number>;
  
  // Quality constraints
  minQuality: number;
  requiredApprovals: string[];
  
  // Operational constraints
  allowedFailures: number;
  recoveryTime: number;
  maintenanceWindows?: TimeWindow[];
}

export interface SwarmMilestone {
  id: string;
  name: string;
  description: string;
  deadline: Date;
  requirements: string[];
  dependencies: string[];
  completed: boolean;
  completedAt?: Date;
}

export interface TimeWindow {
  start: Date;
  end: Date;
  type: 'maintenance' | 'blackout' | 'preferred';
  description: string;
}

export type SwarmStatus = 
  | 'planning'       // Decomposing objectives into tasks
  | 'initializing'   // Setting up agents and resources
  | 'executing'      // Running tasks
  | 'paused'         // Temporarily paused
  | 'completed'      // Successfully completed
  | 'failed'         // Failed to complete
  | 'cancelled'      // Cancelled by user
  | 'recovering'     // Recovering from failure
  | 'optimizing';    // Optimizing performance

export interface SwarmProgress {
  // Task progress
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  
  // Time progress
  estimatedCompletion: Date;
  timeRemaining: number;
  percentComplete: number;
  
  // Quality progress
  averageQuality: number;
  passedReviews: number;
  passedTests: number;
  
  // Resource usage
  resourceUtilization: Record<string, number>;
  costSpent: number;
  
  // Agent utilization
  activeAgents: number;
  idleAgents: number;
  busyAgents: number;
}

export interface SwarmResults {
  // Primary outputs
  outputs: Record<string, any>;
  artifacts: Record<string, any>;
  reports: Record<string, any>;
  
  // Quality metrics
  overallQuality: number;
  qualityByTask: Record<string, number>;
  
  // Performance metrics
  totalExecutionTime: number;
  resourcesUsed: Record<string, number>;
  efficiency: number;
  
  // Success metrics
  objectivesMet: string[];
  objectivesFailed: string[];
  
  // Recommendations
  improvements: string[];
  nextActions: string[];
}

export interface SwarmMetrics {
  // Performance metrics
  throughput: number;
  latency: number;
  efficiency: number;
  reliability: number;
  
  // Quality metrics
  averageQuality: number;
  defectRate: number;
  reworkRate: number;
  
  // Resource metrics
  resourceUtilization: Record<string, number>;
  costEfficiency: number;
  
  // Agent metrics
  agentUtilization: number;
  agentSatisfaction: number;
  collaborationEffectiveness: number;
  
  // Timeline metrics
  scheduleVariance: number;
  deadlineAdherence: number;
}

// ===== COORDINATION TYPES =====

export interface TaskDependency {
  task: TaskId;
  dependsOn: TaskId;
  type: DependencyType;
  constraint?: string;
}

export type DependencyType = 
  | 'finish-start'   // Must finish before next starts
  | 'start-start'    // Must start before next starts
  | 'finish-finish'  // Must finish before next finishes
  | 'start-finish'   // Must start before next finishes
  | 'resource'       // Shares a resource
  | 'data'          // Data dependency
  | 'approval';     // Requires approval

export interface CoordinationStrategy {
  name: string;
  description: string;
  
  // Agent selection
  agentSelection: AgentSelectionStrategy;
  
  // Task scheduling
  taskScheduling: TaskSchedulingStrategy;
  
  // Load balancing
  loadBalancing: LoadBalancingStrategy;
  
  // Fault tolerance
  faultTolerance: FaultToleranceStrategy;
  
  // Communication
  communication: CommunicationStrategy;
}

export type AgentSelectionStrategy = 
  | 'capability-based'   // Select based on capabilities
  | 'load-based'        // Select based on current load
  | 'performance-based' // Select based on performance history
  | 'random'           // Random selection
  | 'round-robin'      // Round-robin selection
  | 'affinity-based'   // Prefer agents with domain affinity
  | 'cost-based'       // Select based on cost
  | 'hybrid';          // Combination of strategies

export type TaskSchedulingStrategy = 
  | 'fifo'             // First in, first out
  | 'priority'         // Priority-based scheduling
  | 'deadline'         // Earliest deadline first
  | 'shortest-job'     // Shortest job first
  | 'critical-path'    // Critical path method
  | 'resource-aware'   // Consider resource availability
  | 'adaptive';        // Adaptive scheduling

export type LoadBalancingStrategy = 
  | 'work-stealing'    // Agents steal work from busy agents
  | 'work-sharing'     // Work is proactively shared
  | 'centralized'      // Central dispatcher
  | 'distributed'      // Distributed load balancing
  | 'predictive'       // Predict and prevent overload
  | 'reactive'         // React to overload conditions
  | 'load-based'       // Select based on current load
  | 'performance-based' // Select based on performance
  | 'capability-based' // Select based on capabilities
  | 'affinity-based'   // Prefer agents with domain affinity
  | 'cost-based'       // Select based on cost
  | 'hybrid';          // Combination of strategies

export type FaultToleranceStrategy = 
  | 'retry'            // Retry failed tasks
  | 'redundancy'       // Redundant execution
  | 'checkpoint'       // Checkpoint and recovery
  | 'circuit-breaker'  // Circuit breaker pattern
  | 'bulkhead'         // Isolate failures
  | 'timeout'          // Timeout protection
  | 'graceful-degradation'; // Degrade gracefully

export type CommunicationStrategy = 
  | 'direct'           // Direct agent-to-agent
  | 'broadcast'        // Broadcast to all
  | 'publish-subscribe' // Pub/sub messaging
  | 'request-response' // Request/response
  | 'event-driven'     // Event-driven communication
  | 'gossip'           // Gossip protocol
  | 'hierarchical';    // Hierarchical communication

// ===== MEMORY TYPES =====

export interface SwarmMemory {
  // Memory organization
  namespace: string;
  partitions: MemoryPartition[];
  
  // Access control
  permissions: MemoryPermissions;
  
  // Persistence
  persistent: boolean;
  backupEnabled: boolean;
  
  // Synchronization
  distributed: boolean;
  consistency: ConsistencyLevel;
  
  // Performance
  cacheEnabled: boolean;
  compressionEnabled: boolean;
}

export interface MemoryPartition {
  id: string;
  name: string;
  type: MemoryType;
  
  // Data
  entries: MemoryEntry[];
  
  // Configuration
  maxSize: number;
  ttl?: number;
  
  // Access patterns
  readOnly: boolean;
  shared: boolean;
  
  // Performance
  indexed: boolean;
  compressed: boolean;
}

export type MemoryType = 
  | 'knowledge'        // Knowledge base
  | 'state'           // Agent state
  | 'cache'           // Temporary cache
  | 'logs'            // Log entries
  | 'results'         // Task results
  | 'communication'   // Communication history
  | 'configuration'   // Configuration data
  | 'metrics';        // Performance metrics

export interface MemoryEntry {
  id: string;
  key: string;
  value: any;
  
  // Metadata
  type: string;
  tags: string[];
  
  // Ownership
  owner: AgentId;
  accessLevel: AccessLevel;
  
  // Lifecycle
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  
  // Versioning
  version: number;
  previousVersions?: MemoryEntry[];
  
  // Relationships
  references: string[];
  dependencies: string[];
}

export type AccessLevel = 
  | 'private'          // Only owner can access
  | 'team'            // Team members can access
  | 'swarm'           // All swarm agents can access
  | 'public'          // Publicly accessible
  | 'system';         // System-level access

export interface MemoryPermissions {
  read: AccessLevel;
  write: AccessLevel;
  delete: AccessLevel;
  share: AccessLevel;
}

export type ConsistencyLevel = 
  | 'strong'          // Strong consistency
  | 'eventual'        // Eventual consistency
  | 'weak'            // Weak consistency
  | 'session';        // Session consistency

// ===== MONITORING TYPES =====

export interface MonitoringConfig {
  // Collection settings
  metricsEnabled: boolean;
  loggingEnabled: boolean;
  tracingEnabled: boolean;
  
  // Collection intervals
  metricsInterval: number;
  heartbeatInterval: number;
  healthCheckInterval: number;
  
  // Retention settings
  retentionPeriod: number;
  maxLogSize: number;
  maxMetricPoints: number;
  
  // Alerting
  alertingEnabled: boolean;
  alertThresholds: Record<string, number>;
  
  // Export settings
  exportEnabled: boolean;
  exportFormat: string;
  exportDestination: string;
}

export interface SystemMetrics {
  timestamp: Date;
  
  // System metrics
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkUsage: number;
  
  // Swarm metrics
  activeSwarms: number;
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  runningTasks: number;
  
  // Performance metrics
  throughput: number;
  latency: number;
  errorRate: number;
  successRate: number;
  
  // Resource metrics
  resourceUtilization: Record<string, number>;
  queueLengths: Record<string, number>;
}

export interface Alert {
  id: string;
  timestamp: Date;
  level: AlertLevel;
  type: AlertType;
  message: string;
  
  // Context
  source: string;
  context: Record<string, any>;
  
  // Handling
  acknowledged: boolean;
  resolved: boolean;
  assignedTo?: string;
  
  // Escalation
  escalationLevel: number;
  escalatedAt?: Date;
}

export type AlertLevel = 
  | 'info'            // Informational
  | 'warning'         // Warning condition
  | 'error'           // Error condition
  | 'critical';       // Critical condition

export type AlertType = 
  | 'system'          // System-level alert
  | 'performance'     // Performance issue
  | 'resource'        // Resource issue
  | 'security'        // Security issue
  | 'agent'           // Agent-specific issue
  | 'task'            // Task-specific issue
  | 'swarm'           // Swarm-level issue
  | 'custom';         // Custom alert type

// ===== EVENT TYPES =====

export interface SwarmEvent {
  id: string;
  timestamp: Date;
  type: EventType;
  source: string;
  
  // Event data
  data: Record<string, any>;
  
  // Routing
  targets?: string[];
  broadcast: boolean;
  
  // Processing
  processed: boolean;
  processedAt?: Date;
  
  // Correlation
  correlationId?: string;
  causationId?: string;
}

export type EventType = 
  // Swarm events
  | 'swarm.created'
  | 'swarm.started'
  | 'swarm.paused'
  | 'swarm.resumed'
  | 'swarm.completed'
  | 'swarm.failed'
  | 'swarm.cancelled'
  
  // Agent events
  | 'agent.created'
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.error'
  | 'agent.heartbeat'
  
  // Task events
  | 'task.created'
  | 'task.assigned'
  | 'task.started'
  | 'task.paused'
  | 'task.resumed'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.retried'
  
  // Coordination events
  | 'coordination.load_balanced'
  | 'coordination.work_stolen'
  | 'coordination.agent_selected'
  | 'coordination.dependency_resolved'
  
  // System events
  | 'system.startup'
  | 'system.shutdown'
  | 'system.resource_limit'
  | 'system.performance_degradation'
  
  // Custom events
  | 'custom.user_defined';

// ===== INTERFACE EXTENSIONS =====

export interface SwarmEventEmitter extends EventEmitter {
  // Event emission
  emitSwarmEvent(event: SwarmEvent): boolean;
  emitSwarmEvents(events: SwarmEvent[]): boolean;
  
  // Event handling
  onSwarmEvent(type: EventType, handler: (event: SwarmEvent) => void): this;
  offSwarmEvent(type: EventType, handler: (event: SwarmEvent) => void): this;
  
  // Event filtering
  filterEvents(predicate: (event: SwarmEvent) => boolean): SwarmEvent[];
  
  // Event correlation
  correlateEvents(correlationId: string): SwarmEvent[];
}

// ===== UTILITY TYPES =====

export interface SwarmConfig {
  // Basic configuration
  name: string;
  description: string;
  version: string;
  
  // Operational settings
  mode: SwarmMode;
  strategy: SwarmStrategy;
  coordinationStrategy: CoordinationStrategy;
  
  // Resource limits
  maxAgents: number;
  maxTasks: number;
  maxDuration: number;
  taskTimeoutMinutes?: number;
  resourceLimits: Record<string, number>;
  
  // Quality settings
  qualityThreshold: number;
  reviewRequired: boolean;
  testingRequired: boolean;
  
  // Monitoring settings
  monitoring: MonitoringConfig;
  
  // Memory settings
  memory: SwarmMemory;
  
  // Security settings
  security: SecurityConfig;
  
  // Performance settings
  performance: PerformanceConfig;
}

export interface SecurityConfig {
  authenticationRequired: boolean;
  authorizationRequired: boolean;
  encryptionEnabled: boolean;
  
  // Access control
  defaultPermissions: string[];
  adminRoles: string[];
  
  // Audit
  auditEnabled: boolean;
  auditLevel: string;
  
  // Validation
  inputValidation: boolean;
  outputSanitization: boolean;
}

export interface PerformanceConfig {
  // Concurrency
  maxConcurrency: number;
  defaultTimeout: number;
  
  // Caching
  cacheEnabled: boolean;
  cacheSize: number;
  cacheTtl: number;
  
  // Optimization
  optimizationEnabled: boolean;
  adaptiveScheduling: boolean;
  predictiveLoading: boolean;
  
  // Resource management
  resourcePooling: boolean;
  connectionPooling: boolean;
  memoryPooling: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  
  // Context
  validatedAt: Date;
  validator: string;
  context: Record<string, any>;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  severity: 'error' | 'critical';
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
  recommendation: string;
}

// ===== TYPE GUARDS =====

export function isAgentId(obj: any): obj is AgentId {
  return obj && typeof obj.id === 'string' && typeof obj.swarmId === 'string';
}

export function isTaskId(obj: any): obj is TaskId {
  return obj && typeof obj.id === 'string' && typeof obj.swarmId === 'string';
}

export function isSwarmEvent(obj: any): obj is SwarmEvent {
  return obj && typeof obj.id === 'string' && typeof obj.type === 'string';
}

export function isTaskDefinition(obj: any): obj is TaskDefinition {
  return obj && isTaskId(obj.id) && typeof obj.type === 'string';
}

export function isAgentState(obj: any): obj is AgentState {
  return obj && isAgentId(obj.id) && typeof obj.status === 'string';
}

// ===== CONSTANTS =====

export const SWARM_CONSTANTS = {
  // Timeouts
  DEFAULT_TASK_TIMEOUT: 5 * 60 * 1000,      // 5 minutes
  DEFAULT_AGENT_TIMEOUT: 30 * 1000,          // 30 seconds
  DEFAULT_HEARTBEAT_INTERVAL: 10 * 1000,     // 10 seconds
  
  // Limits
  MAX_AGENTS_PER_SWARM: 100,
  MAX_TASKS_PER_AGENT: 10,
  MAX_RETRIES: 3,
  
  // Quality thresholds
  MIN_QUALITY_THRESHOLD: 0.7,
  DEFAULT_QUALITY_THRESHOLD: 0.8,
  HIGH_QUALITY_THRESHOLD: 0.9,
  
  // Performance targets
  DEFAULT_THROUGHPUT_TARGET: 10,             // tasks per minute
  DEFAULT_LATENCY_TARGET: 1000,              // milliseconds
  DEFAULT_RELIABILITY_TARGET: 0.95,          // 95%
  
  // Resource limits
  DEFAULT_MEMORY_LIMIT: 512 * 1024 * 1024,   // 512MB
  DEFAULT_CPU_LIMIT: 1.0,                    // 1 CPU core
  DEFAULT_DISK_LIMIT: 1024 * 1024 * 1024,    // 1GB
} as const;

// ===== EXPORTS =====

export default {
  // Type exports are handled by TypeScript
  SWARM_CONSTANTS,
  
  // Utility functions
  isAgentId,
  isTaskId,
  isSwarmEvent,
  isTaskDefinition,
  isAgentState,
};