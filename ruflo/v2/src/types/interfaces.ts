/**
 * Core interfaces for the claude-flow init system
 */

export type InitMode = 'standard' | 'github' | 'hive-mind' | 'sparc' | 'neural' | 'enterprise';
export type TopologyType = 'mesh' | 'hierarchical' | 'ring' | 'star';
export type ConsensusType = 'raft' | 'byzantine' | 'gossip' | 'proof-of-learning';
export type AgentType = 'researcher' | 'coder' | 'analyst' | 'optimizer' | 'coordinator' | 'tester' | 'reviewer';

// Core initialization interfaces
export interface IInitMode {
  initialize(config: InitConfig): Promise<InitResult>;
  validate(): boolean;
  getDescription(): string;
  getRequiredComponents(): string[];
}

export interface InitConfig {
  mode?: InitMode;
  topology?: TopologyType;
  maxAgents?: number;
  strategy?: 'balanced' | 'specialized' | 'adaptive';
  database?: 'sqlite' | 'json';
  configPath?: string;
  debug?: boolean;
  configManager?: any;
  databaseManager?: any;
  topologyManager?: any;
  agentRegistry?: any;
  metricsCollector?: any;
}

export interface InitResult {
  success: boolean;
  mode: InitMode;
  components?: string[];
  topology?: TopologyType;
  duration?: number;
  message?: string;
  error?: string;
  metadata?: Record<string, any>;
}

// Consensus interfaces
export interface IConsensusAlgorithm {
  propose(decision: Decision): Promise<Vote[]>;
  execute(consensus: Consensus): Promise<Result>;
  getType(): ConsensusType;
  initialize(): Promise<void>;
}

export interface Decision {
  id: string;
  type: 'agent-spawn' | 'task-assignment' | 'resource-allocation' | 'topology-change';
  proposer: string;
  data: any;
  timestamp: Date;
}

export interface Vote {
  agentId: string;
  decision: boolean;
  confidence: number;
  reasoning?: string;
}

export interface Consensus {
  decisionId: string;
  outcome: boolean;
  votes: Vote[];
  confidence: number;
  timestamp: Date;
}

export interface Result {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// Topology interfaces
export interface ITopology {
  configure(agents: Agent[]): Promise<Network>;
  optimize(): Promise<Optimization>;
  getConnections(): Connection[];
  getType(): TopologyType;
}

export interface Agent {
  id: string;
  type: AgentType;
  capabilities: string[];
  status: 'active' | 'idle' | 'busy' | 'offline';
  metadata: Record<string, any>;
  connections?: string[];
  performance?: AgentPerformance;
}

export interface Network {
  topology: TopologyType;
  agents: Agent[];
  connections: Connection[];
  metrics: NetworkMetrics;
}

export interface Connection {
  from: string;
  to: string;
  type: 'direct' | 'relay' | 'broadcast';
  weight?: number;
  latency?: number;
}

export interface Optimization {
  type: 'latency' | 'throughput' | 'reliability';
  changes: TopologyChange[];
  expectedImprovement: number;
}

export interface TopologyChange {
  action: 'add-connection' | 'remove-connection' | 'modify-weight';
  connection: Connection;
  reason: string;
}

export interface NetworkMetrics {
  totalAgents: number;
  totalConnections: number;
  averageLatency: number;
  throughput: number;
  reliability: number;
}

// Database interfaces
export interface IDatabaseProvider {
  initialize(): Promise<void>;
  store(key: string, value: any, namespace?: string): Promise<void>;
  retrieve(key: string, namespace?: string): Promise<any>;
  delete(key: string, namespace?: string): Promise<boolean>;
  list(namespace?: string): Promise<string[]>;
  close(): Promise<void>;
}

// Agent coordination interfaces
export interface IAgentCoordinator {
  spawn(type: AgentType, config: AgentConfig): Promise<Agent>;
  coordinate(task: Task): Promise<Result>;
  monitor(): Promise<Metrics>;
  shutdown(agentId: string): Promise<void>;
}

export interface AgentConfig {
  capabilities?: string[];
  maxConcurrency?: number;
  timeout?: number;
  resources?: ResourceAllocation;
  metadata?: Record<string, any>;
}

export interface Task {
  id: string;
  type: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  requiredCapabilities: string[];
  deadline?: Date;
  dependencies?: string[];
  data?: any;
}

export interface ResourceAllocation {
  memory: number;
  cpu: number;
  storage: number;
  network: number;
}

export interface AgentPerformance {
  tasksCompleted: number;
  averageResponseTime: number;
  successRate: number;
  resourceUtilization: ResourceAllocation;
  lastActivity: Date;
}

export interface Metrics {
  agents: AgentMetrics[];
  system: SystemMetrics;
  performance: PerformanceMetrics;
}

export interface AgentMetrics {
  agentId: string;
  type: AgentType;
  performance: AgentPerformance;
  status: 'active' | 'idle' | 'busy' | 'offline';
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
  networkLatency: number;
  activeConnections: number;
}

export interface PerformanceMetrics {
  throughput: number;
  latency: number;
  errorRate: number;
  bottlenecks: string[];
}

// Hive Mind interfaces
export interface IHiveMindQueen {
  strategize(objective: Objective): Promise<Strategy>;
  delegate(tasks: Task[]): Promise<Assignment[]>;
  monitor(): Promise<QueenMetrics>;
  adapt(feedback: Feedback[]): Promise<void>;
}

export interface Objective {
  id: string;
  description: string;
  goals: Goal[];
  constraints: Constraint[];
  deadline?: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface Goal {
  description: string;
  metric: string;
  target: number;
  weight: number;
}

export interface Constraint {
  type: 'resource' | 'time' | 'dependency' | 'capability';
  description: string;
  value: any;
}

export interface Strategy {
  approach: string;
  phases: StrategyPhase[];
  resourceAllocation: ResourceAllocation;
  expectedOutcome: string;
  riskAssessment: Risk[];
}

export interface StrategyPhase {
  name: string;
  description: string;
  tasks: Task[];
  dependencies: string[];
  duration: number;
}

export interface Risk {
  description: string;
  probability: number;
  impact: number;
  mitigation: string;
}

export interface Assignment {
  agentId: string;
  task: Task;
  deadline: Date;
  resources: ResourceAllocation;
}

export interface QueenMetrics {
  strategiesCreated: number;
  tasksAssigned: number;
  successRate: number;
  adaptationCount: number;
  performanceScore: number;
}

export interface Feedback {
  source: string;
  type: 'performance' | 'outcome' | 'suggestion';
  rating: number;
  comments: string;
  data?: any;
}

// Configuration interfaces
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface DatabaseConfig {
  type: 'sqlite' | 'json';
  path?: string;
  options?: Record<string, any>;
}

export interface TopologyConfig {
  type: TopologyType;
  maxAgents: number;
  connectionStrategy: 'full' | 'sparse' | 'hub' | 'ring';
  optimization: boolean;
}

export interface InitializationMetrics {
  mode: InitMode;
  duration: number;
  success: boolean;
  components?: string[];
  error?: string;
  timestamp: string;
}