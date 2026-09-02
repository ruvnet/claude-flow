/**
 * Verification and Truth Enforcement Interfaces
 * Core type definitions for the verification system
 */

// Core Verification Types
export interface VerificationConfig {
  enabled: boolean;
  mode: 'passive' | 'active' | 'strict';
  truth_threshold: number;
  rollback_enabled: boolean;
  weights: VerificationWeights;
  enforcement: EnforcementConfig;
  integrations: IntegrationConfig;
  reporting: ReportingConfig;
}

export interface VerificationWeights {
  tests: number;
  integration_tests: number;
  lint: number;
  type_check: number;
  build: number;
  performance: number;
}

export interface EnforcementConfig {
  passive: {
    log_only: boolean;
    warn_on_failure: boolean;
    block_on_failure: boolean;
  };
  active: {
    log_only: boolean;
    warn_on_failure: boolean;
    block_on_failure: boolean;
  };
  strict: {
    log_only: boolean;
    warn_on_failure: boolean;
    block_on_failure: boolean;
  };
}

export interface IntegrationConfig {
  github_actions: boolean;
  mcp_tools: boolean;
  npx_commands: boolean;
  memory_persistence: boolean;
}

export interface ReportingConfig {
  auto_generate: boolean;
  frequency: 'on_completion' | 'hourly' | 'daily';
  format: 'json' | 'html' | 'markdown';
  include_evidence: boolean;
}

// Checkpoint System
export interface Checkpoint {
  id: string;
  type: 'pre' | 'during' | 'post';
  agent_id: string;
  task_id: string;
  timestamp: number;
  required: boolean;
  validations: Validation[];
  state_snapshot: StateSnapshot;
  description: string;
  scope: CheckpointScope;
}

export interface Validation {
  name: string;
  type: 'test' | 'lint' | 'type' | 'build' | 'integration' | 'performance';
  command: string;
  expected_result: any;
  actual_result?: any;
  passed: boolean;
  weight: number;
  execution_time_ms: number;
  error_message?: string;
}

export type CheckpointScope = 'local' | 'agent' | 'task' | 'system' | 'global';

export interface CheckpointFilter {
  agent_id?: string;
  task_id?: string;
  type?: string;
  from_timestamp?: number;
  to_timestamp?: number;
  scope?: CheckpointScope;
}

// Truth Scoring System
export interface TruthScore {
  score: number;
  threshold: number;
  passed: boolean;
  discrepancies: Discrepancy[];
  evidence_quality: EvidenceQuality;
  timestamp: number;
  agent_id: string;
  task_id: string;
  calculation_method: string;
}

export interface Discrepancy {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  claimed_value: any;
  actual_value: any;
  impact_score: number;
}

export interface EvidenceQuality {
  completeness: number; // 0-1
  freshness: number; // 0-1
  reliability: number; // 0-1
  coverage: number; // 0-1
  overall: number; // 0-1
}

export interface AgentClaims {
  task_id: string;
  agent_id: string;
  timestamp: number;
  test_claims: TestClaims;
  quality_claims: QualityClaims;
  build_claims: BuildClaims;
  performance_claims: PerformanceClaims;
  integration_claims: IntegrationClaims;
}

export interface TestClaims {
  all_tests_pass: boolean;
  test_coverage_percentage: number;
  no_failing_tests: boolean;
  performance_tests_pass: boolean;
}

export interface QualityClaims {
  no_lint_errors: boolean;
  no_type_errors: boolean;
  code_complexity_acceptable: boolean;
  security_scan_clean: boolean;
}

export interface BuildClaims {
  builds_successfully: boolean;
  no_build_warnings: boolean;
  deployment_ready: boolean;
  dependencies_resolved: boolean;
}

export interface PerformanceClaims {
  meets_performance_targets: boolean;
  memory_usage_acceptable: boolean;
  response_time_acceptable: boolean;
  throughput_acceptable: boolean;
}

export interface IntegrationClaims {
  api_compatibility_maintained: boolean;
  database_migrations_successful: boolean;
  external_services_compatible: boolean;
  cross_agent_communication_working: boolean;
}

// Evidence Collection
export interface Evidence {
  test_results: TestResults;
  code_quality: CodeQuality;
  system_health: SystemHealth;
  agent_coordination: AgentCoordination;
  collection_timestamp: number;
  collection_duration_ms: number;
}

export interface TestResults {
  unit_tests: TestExecution;
  integration_tests: TestExecution;
  e2e_tests: TestExecution;
  cross_agent_tests: TestExecution;
  performance_tests: TestExecution;
}

export interface TestExecution {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage_percentage: number;
  execution_time_ms: number;
  failures: TestFailure[];
}

export interface TestFailure {
  test_name: string;
  error_message: string;
  stack_trace: string;
  category: 'unit' | 'integration' | 'e2e' | 'performance';
}

export interface CodeQuality {
  lint_results: LintResults;
  type_results: TypeResults;
  complexity_metrics: ComplexityMetrics;
  security_scan: SecurityResults;
}

export interface LintResults {
  errors: number;
  warnings: number;
  total_files_checked: number;
  issues: LintIssue[];
}

export interface LintIssue {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface TypeResults {
  errors: number;
  warnings: number;
  total_files_checked: number;
  issues: TypeIssue[];
}

export interface TypeIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  code: number;
}

export interface ComplexityMetrics {
  cyclomatic_complexity: number;
  cognitive_complexity: number;
  lines_of_code: number;
  maintainability_index: number;
}

export interface SecurityResults {
  vulnerabilities_found: number;
  severity_breakdown: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  scan_coverage_percentage: number;
}

export interface SystemHealth {
  build_results: BuildResults;
  deployment_status: DeploymentStatus;
  performance_metrics: PerformanceMetrics;
  resource_usage: ResourceMetrics;
}

export interface BuildResults {
  success: boolean;
  build_time_ms: number;
  warnings: number;
  errors: number;
  output_size_bytes: number;
}

export interface DeploymentStatus {
  deployable: boolean;
  environment_validated: boolean;
  dependencies_satisfied: boolean;
  configuration_valid: boolean;
}

export interface PerformanceMetrics {
  response_time_p95_ms: number;
  throughput_requests_per_second: number;
  error_rate_percentage: number;
  cpu_usage_percentage: number;
  memory_usage_mb: number;
}

export interface ResourceMetrics {
  cpu_usage_percentage: number;
  memory_usage_mb: number;
  disk_usage_mb: number;
  network_io_mbps: number;
  file_descriptors_used: number;
}

export interface AgentCoordination {
  communication_logs: CommunicationLogs;
  state_consistency: StateValidation;
  task_dependencies: DependencyValidation;
}

export interface CommunicationLogs {
  total_messages: number;
  successful_deliveries: number;
  failed_deliveries: number;
  average_latency_ms: number;
  message_types: Record<string, number>;
}

export interface StateValidation {
  consistent: boolean;
  inconsistencies: StateInconsistency[];
  last_validated: number;
}

export interface StateInconsistency {
  type: string;
  description: string;
  affected_agents: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface DependencyValidation {
  satisfied: boolean;
  missing_dependencies: string[];
  circular_dependencies: string[];
  version_conflicts: VersionConflict[];
}

export interface VersionConflict {
  dependency: string;
  required_version: string;
  actual_version: string;
  affected_agents: string[];
}

// State Management
export interface StateSnapshot {
  id: string;
  timestamp: number;
  agent_states: Map<string, AgentState>;
  system_state: SystemState;
  task_states: Map<string, TaskState>;
  memory_state: MemoryState;
  file_system_state: FileSystemState;
  database_state: DatabaseState;
  checksum: string;
  metadata: SnapshotMetadata;
}

export interface SnapshotMetadata {
  version: string;
  created_by: string;
  description: string;
  tags: string[];
  size_bytes: number;
  compression_ratio: number;
}

export interface AgentState {
  id: string;
  status: 'idle' | 'active' | 'error' | 'suspended';
  current_task: string | null;
  capabilities: string[];
  memory: AgentMemory;
  configuration: AgentConfig;
  performance_metrics: PerformanceMetrics;
  last_heartbeat: number;
}

export interface AgentMemory {
  working_memory: Record<string, any>;
  long_term_memory: Record<string, any>;
  shared_memory_keys: string[];
  memory_usage_mb: number;
}

export interface AgentConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
  retry_attempts: number;
  custom_parameters: Record<string, any>;
}

export interface SystemState {
  version: string;
  uptime_ms: number;
  active_agents: number;
  active_tasks: number;
  memory_usage: ResourceMetrics;
  configuration: SystemConfig;
}

export interface SystemConfig {
  max_agents: number;
  max_concurrent_tasks: number;
  truth_threshold: number;
  verification_enabled: boolean;
  rollback_enabled: boolean;
}

export interface TaskState {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  assigned_agent: string;
  dependencies: string[];
  start_time: number;
  end_time?: number;
  progress_percentage: number;
  result?: any;
  error?: string;
}

export interface MemoryState {
  total_size_mb: number;
  used_size_mb: number;
  fragmentation_percentage: number;
  cache_hit_rate: number;
  active_sessions: number;
}

export interface FileSystemState {
  total_files: number;
  total_size_mb: number;
  last_modified: number;
  checksums: Record<string, string>;
  permissions_valid: boolean;
}

export interface DatabaseState {
  connection_status: 'connected' | 'disconnected' | 'error';
  transaction_count: number;
  pending_migrations: number;
  data_integrity_check: boolean;
  backup_status: 'current' | 'stale' | 'missing';
}

// Rollback System
export interface RollbackResult {
  success: boolean;
  checkpoint_id: string;
  rollback_time_ms: number;
  verification_details: VerificationDetails;
  affected_components: string[];
  error_message?: string;
}

export interface VerificationDetails {
  verified: boolean;
  checks_performed: string[];
  failed_checks: string[];
  verification_time_ms: number;
}

export type RollbackMode = 'strict' | 'partial' | 'force' | 'simulation';

export interface RollbackOptions {
  mode: RollbackMode;
  verify_before_rollback: boolean;
  verify_after_rollback: boolean;
  create_backup_before: boolean;
  components_to_rollback: string[];
  exclude_components: string[];
}

// Cross-Agent Testing
export interface CrossAgentTest {
  id: string;
  name: string;
  description: string;
  participating_agents: string[];
  scenario: TestScenario;
  expected_outcomes: ExpectedOutcome[];
  validation_rules: ValidationRule[];
  dependencies: string[];
  timeout_ms: number;
  retry_attempts: number;
}

export interface TestScenario {
  description: string;
  setup: SetupStep[];
  interactions: AgentInteraction[];
  teardown: CleanupStep[];
  parallel_execution: boolean;
}

export interface SetupStep {
  description: string;
  action: string;
  parameters: Record<string, any>;
  expected_result: any;
  timeout_ms: number;
}

export interface AgentInteraction {
  from_agent: string;
  to_agent: string;
  message_type: string;
  payload: any;
  expected_response: any;
  timeout_ms: number;
  retry_on_failure: boolean;
}

export interface CleanupStep {
  description: string;
  action: string;
  parameters: Record<string, any>;
  ignore_errors: boolean;
}

export interface ExpectedOutcome {
  description: string;
  assertion: string;
  expected_value: any;
  tolerance?: number;
  mandatory: boolean;
}

export interface ValidationRule {
  name: string;
  type: 'timing' | 'data' | 'state' | 'communication';
  condition: string;
  error_message: string;
  weight: number;
}

export interface CrossAgentTestResult {
  test_id: string;
  passed: boolean;
  execution_time_ms: number;
  details: TestExecutionDetails;
  evidence: TestEvidence;
  error?: string;
}

export interface TestExecutionDetails {
  setup_results: SetupResult[];
  interaction_results: InteractionResult[];
  teardown_results: CleanupResult[];
  validation_results: ValidationResult[];
}

export interface SetupResult {
  step_index: number;
  success: boolean;
  execution_time_ms: number;
  actual_result: any;
  error_message?: string;
}

export interface InteractionResult {
  interaction_index: number;
  success: boolean;
  request_sent_at: number;
  response_received_at: number;
  actual_response: any;
  latency_ms: number;
  error_message?: string;
}

export interface CleanupResult {
  step_index: number;
  success: boolean;
  execution_time_ms: number;
  error_message?: string;
}

export interface ValidationResult {
  rule_name: string;
  passed: boolean;
  expected_value: any;
  actual_value: any;
  error_message?: string;
}

export interface TestEvidence {
  agent_logs: Record<string, string[]>;
  system_metrics: PerformanceMetrics;
  communication_trace: CommunicationTrace[];
  state_snapshots: StateSnapshot[];
}

export interface CommunicationTrace {
  timestamp: number;
  from_agent: string;
  to_agent: string;
  message_type: string;
  message_id: string;
  status: 'sent' | 'delivered' | 'failed' | 'timeout';
  latency_ms?: number;
}

// Reliability and Reporting
export interface ReliabilityReport {
  agent_id: string;
  reliability: number;
  pass_rate: number;
  sample_size: number;
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  last_updated: number;
  historical_scores: TruthScore[];
}

export interface ConsistencyReport {
  consistent: boolean;
  inconsistencies: Inconsistency[];
  checked_at: string;
  repair_suggestions: RepairSuggestion[];
  overall_health_score: number;
}

export interface Inconsistency {
  type: string;
  component: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affected_items: string[];
  detected_at: number;
}

export interface RepairSuggestion {
  inconsistency_type: string;
  suggested_action: string;
  risk_level: 'low' | 'medium' | 'high';
  estimated_duration_ms: number;
  requires_human_approval: boolean;
}

export interface VerificationReport {
  id: string;
  generated_at: string;
  report_type: 'summary' | 'detailed' | 'audit';
  time_period: {
    start: string;
    end: string;
  };
  summary: ReportSummary;
  agent_performance: Record<string, AgentPerformanceReport>;
  system_health: SystemHealthReport;
  trends: TrendAnalysis;
  recommendations: Recommendation[];
}

export interface ReportSummary {
  total_verifications: number;
  average_truth_score: number;
  pass_rate: number;
  critical_issues: number;
  system_uptime_percentage: number;
}

export interface AgentPerformanceReport {
  agent_id: string;
  total_tasks: number;
  average_truth_score: number;
  pass_rate: number;
  trend: string;
  last_active: string;
  performance_metrics: PerformanceMetrics;
}

export interface SystemHealthReport {
  overall_health: number;
  component_health: Record<string, number>;
  active_issues: Issue[];
  resolved_issues: Issue[];
  uptime_statistics: UptimeStatistics;
}

export interface Issue {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  first_detected: string;
  last_detected: string;
  affected_components: string[];
  resolution_status: 'open' | 'in_progress' | 'resolved' | 'ignored';
}

export interface UptimeStatistics {
  total_uptime_percentage: number;
  longest_uptime_period_hours: number;
  total_downtime_minutes: number;
  number_of_incidents: number;
  mean_time_to_recovery_minutes: number;
}

export interface TrendAnalysis {
  truth_score_trend: TrendData;
  performance_trend: TrendData;
  reliability_trend: TrendData;
  issue_frequency_trend: TrendData;
}

export interface TrendData {
  direction: 'improving' | 'declining' | 'stable';
  rate_of_change: number;
  confidence: number;
  data_points: number;
}

export interface Recommendation {
  id: string;
  category: 'performance' | 'reliability' | 'security' | 'maintenance';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  estimated_impact: string;
  implementation_effort: 'low' | 'medium' | 'high';
  action_items: string[];
}

// Manager Interfaces
export interface VerificationManager {
  // Checkpoint management
  createCheckpoint(description: string, scope: CheckpointScope): Promise<string>;
  listCheckpoints(filter?: CheckpointFilter): Promise<Checkpoint[]>;
  deleteCheckpoint(id: string): Promise<void>;
  
  // Truth scoring
  calculateTruthScore(evidence: Evidence, claims: AgentClaims): Promise<TruthScore>;
  storeTruthScore(score: TruthScore): Promise<void>;
  getAgentReliability(agent_id: string): Promise<ReliabilityReport>;
  
  // State management
  captureSystemState(scope: StateScope): Promise<StateSnapshot>;
  rollbackToCheckpoint(checkpoint_id: string, options: RollbackOptions): Promise<RollbackResult>;
  validateStateConsistency(): Promise<ConsistencyReport>;
  
  // Integration testing
  runCrossAgentTests(suite?: string): Promise<TestResults>;
  validateAgentCommunication(): Promise<CommunicationLogs>;
  
  // Reporting
  generateVerificationReport(format: 'json' | 'html' | 'markdown'): Promise<string>;
  exportMetrics(timeframe: string): Promise<MetricsExport>;
}

export interface AgentVerificationInterface {
  // Required by all agents
  validateCapabilities(): Promise<CapabilityValidation>;
  reportTaskClaims(task_id: string, claims: TaskClaims): Promise<void>;
  provideEvidence(task_id: string): Promise<Evidence>;
  
  // State management
  saveState(): Promise<AgentState>;
  restoreState(state: AgentState): Promise<void>;
  validateState(): Promise<StateValidation>;
  
  // Communication verification
  validateMessage(message: AgentMessage): Promise<MessageValidation>;
  reportCommunicationMetrics(): Promise<CommunicationMetrics>;
}

export interface StateScope {
  include_agents: boolean;
  include_tasks: boolean;
  include_memory: boolean;
  include_filesystem: boolean;
  include_database: boolean;
  agent_filter?: string[];
  task_filter?: string[];
}

export interface CapabilityValidation {
  valid: boolean;
  missing_capabilities: string[];
  outdated_capabilities: string[];
  validation_time_ms: number;
}

export interface TaskClaims {
  task_id: string;
  claims: Record<string, any>;
  confidence: number;
  evidence_provided: boolean;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: any;
  timestamp: number;
  correlation_id?: string;
}

export interface MessageValidation {
  valid: boolean;
  issues: MessageIssue[];
  validation_time_ms: number;
}

export interface MessageIssue {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  field?: string;
}

export interface CommunicationMetrics {
  messages_sent: number;
  messages_received: number;
  average_latency_ms: number;
  error_rate: number;
  last_activity: number;
}

export interface MetricsExport {
  timeframe: string;
  exported_at: string;
  format: string;
  data: Record<string, any>;
  metadata: ExportMetadata;
}

export interface ExportMetadata {
  total_records: number;
  file_size_bytes: number;
  compression_used: boolean;
  export_duration_ms: number;
}