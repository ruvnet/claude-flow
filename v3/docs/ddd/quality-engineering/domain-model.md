# Quality Engineering Domain Model

> **Retired (2026-10-09):** the in-repo `v3/plugins/agentic-qe` implementation described here was removed; it never wrapped the real `agentic-qe` package. This document is kept for history. Use the maintained [`agentic-qe`](https://www.npmjs.com/package/agentic-qe) npm package or its Claude Code plugin `agentic-qe-fleet` ([proffesor-for-testing/agentic-qe](https://github.com/proffesor-for-testing/agentic-qe)).

## Overview

This document defines the domain entities, value objects, aggregates, and domain services for the Quality Engineering bounded contexts in the agentic-qe plugin.

## Core Domain Entities

### Entity: TestCase

```typescript
/**
 * A single test case with assertions and lifecycle
 */
interface TestCase {
  // Identity
  id: TestCaseId;

  // Core attributes
  name: string;
  description: string;
  type: TestType;
  status: TestStatus;

  // Classification
  framework: TestFramework;
  language: ProgrammingLanguage;
  tags: Tag[];

  // Execution
  setup: TestFixture | null;
  teardown: TestFixture | null;
  assertions: Assertion[];
  timeout: Duration;

  // Relationships
  targetFile: FilePath;
  targetFunction: FunctionName | null;
  generatedBy: AgentId;

  // Lifecycle
  createdAt: Timestamp;
  lastRunAt: Timestamp | null;
  lastResult: TestResult | null;
}

// Value Objects
type TestCaseId = Branded<string, 'TestCaseId'>;
type TestType = 'unit' | 'integration' | 'e2e' | 'property' | 'mutation' | 'fuzz' | 'api' | 'performance' | 'security' | 'accessibility' | 'contract' | 'bdd';
type TestStatus = 'draft' | 'active' | 'skipped' | 'deprecated';
type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest' | 'junit' | 'playwright' | 'cypress';
```

### Entity: TestSuite

```typescript
/**
 * Collection of related test cases
 */
interface TestSuite {
  // Identity
  id: TestSuiteId;

  // Core attributes
  name: string;
  description: string;

  // Composition
  testCases: TestCaseId[];
  nestedSuites: TestSuiteId[];

  // Configuration
  parallel: boolean;
  maxWorkers: number;
  retryCount: number;

  // Metadata
  tags: Tag[];
  owner: UserId | AgentId;

  // Lifecycle
  createdAt: Timestamp;
  lastRunAt: Timestamp | null;
}
```

### Entity: CoverageReport

```typescript
/**
 * Code coverage analysis results
 */
interface CoverageReport {
  // Identity
  id: CoverageReportId;

  // Metrics
  lineCoverage: Percentage;
  branchCoverage: Percentage;
  functionCoverage: Percentage;
  statementCoverage: Percentage;

  // File breakdown
  files: FileCoverage[];

  // Gaps
  gaps: CoverageGap[];
  hotspots: CoverageHotspot[];

  // Comparison
  previousReport: CoverageReportId | null;
  delta: CoverageDelta | null;

  // Metadata
  generatedAt: Timestamp;
  sourceCommit: CommitHash;
}

interface FileCoverage {
  path: FilePath;
  lines: { covered: number; total: number };
  branches: { covered: number; total: number };
  functions: { covered: number; total: number };
  uncoveredLines: LineNumber[];
  uncoveredBranches: BranchId[];
}

interface CoverageGap {
  id: CoverageGapId;
  file: FilePath;
  type: 'line' | 'branch' | 'function';
  location: CodeLocation;
  riskScore: RiskScore;
  priority: Priority;
  suggestedTests: TestSuggestion[];
}

interface CoverageHotspot {
  file: FilePath;
  changeFrequency: number;
  coveragePercentage: Percentage;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}
```

### Entity: QualityGate

```typescript
/**
 * Quality gate with pass/fail criteria
 */
interface QualityGate {
  // Identity
  id: QualityGateId;
  name: string;

  // Criteria
  criteria: QualityCriterion[];

  // Configuration
  failFast: boolean;
  required: boolean;

  // Status
  status: 'pending' | 'evaluating' | 'passed' | 'failed';
  lastEvaluation: QualityGateEvaluation | null;
}

interface QualityCriterion {
  metric: QualityMetric;
  operator: ComparisonOperator;
  threshold: number;
  weight: number;
}

type QualityMetric =
  | 'line_coverage'
  | 'branch_coverage'
  | 'test_pass_rate'
  | 'defect_density'
  | 'code_complexity'
  | 'security_vulnerabilities'
  | 'accessibility_violations'
  | 'performance_score'
  | 'contract_compliance';

type ComparisonOperator = '>' | '>=' | '<' | '<=' | '==' | '!=';

interface QualityGateEvaluation {
  gateId: QualityGateId;
  timestamp: Timestamp;
  passed: boolean;
  results: CriterionResult[];
  overallScore: number;
}
```

### Entity: DefectPrediction

```typescript
/**
 * ML-based defect prediction result
 */
interface DefectPrediction {
  // Identity
  id: DefectPredictionId;

  // Target
  file: FilePath;
  component: ComponentName | null;

  // Prediction
  likelihood: Probability;
  confidence: Probability;
  predictedDefectType: DefectType;

  // Analysis
  riskFactors: RiskFactor[];
  similarDefects: DefectId[];
  rootCauseHypothesis: string | null;

  // Recommendations
  preventiveActions: PreventiveAction[];

  // Metadata
  predictedAt: Timestamp;
  model: ModelVersion;
}

type DefectType =
  | 'logic_error'
  | 'null_reference'
  | 'race_condition'
  | 'memory_leak'
  | 'security_vulnerability'
  | 'performance_degradation'
  | 'api_misuse'
  | 'configuration_error';

interface RiskFactor {
  factor: string;
  contribution: Percentage;
  evidence: string;
}
```

### Entity: SecurityFinding

```typescript
/**
 * Security scan finding
 */
interface SecurityFinding {
  // Identity
  id: SecurityFindingId;

  // Classification
  type: SecurityFindingType;
  severity: Severity;
  confidence: Probability;

  // Location
  file: FilePath;
  line: LineNumber | null;
  column: ColumnNumber | null;
  codeSnippet: string | null;

  // Details
  title: string;
  description: string;
  cweId: CWEId | null;
  cveId: CVEId | null;
  owaspCategory: OWASPCategory | null;

  // Remediation
  remediation: string;
  references: URL[];

  // Status
  status: FindingStatus;
  falsePositive: boolean;
  suppressedReason: string | null;

  // Metadata
  scanner: ScannerType;
  detectedAt: Timestamp;
}

type SecurityFindingType =
  | 'injection'
  | 'authentication'
  | 'authorization'
  | 'xss'
  | 'csrf'
  | 'sensitive_data'
  | 'misconfiguration'
  | 'dependency_vulnerability';

type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
type FindingStatus = 'open' | 'confirmed' | 'remediated' | 'suppressed' | 'false_positive';
type ScannerType = 'sast' | 'dast' | 'sca' | 'secrets';
```

### Entity: ChaosExperiment

```typescript
/**
 * Chaos engineering experiment
 */
interface ChaosExperiment {
  // Identity
  id: ChaosExperimentId;
  name: string;

  // Target
  targetService: ServiceName;
  targetComponent: ComponentName | null;

  // Configuration
  failureType: FailureType;
  parameters: FailureParameters;
  duration: Duration;
  intensity: Percentage;

  // Execution
  status: ExperimentStatus;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;

  // Results
  impactAssessment: ImpactAssessment | null;
  recoveryMetrics: RecoveryMetrics | null;

  // Safety
  abortConditions: AbortCondition[];
  rollbackProcedure: RollbackProcedure;
}

type FailureType =
  | 'network_latency'
  | 'network_partition'
  | 'network_loss'
  | 'cpu_stress'
  | 'memory_pressure'
  | 'disk_failure'
  | 'process_kill'
  | 'clock_skew'
  | 'dns_failure';

type ExperimentStatus = 'draft' | 'scheduled' | 'running' | 'completed' | 'aborted' | 'failed';

interface ImpactAssessment {
  errorRate: Percentage;
  latencyIncrease: Duration;
  throughputDecrease: Percentage;
  affectedUsers: number;
  cascadeEffects: CascadeEffect[];
}

interface RecoveryMetrics {
  detectionTime: Duration;
  mitigationTime: Duration;
  recoveryTime: Duration;
  dataLoss: boolean;
  manualIntervention: boolean;
}
```

### Entity: Contract

```typescript
/**
 * API contract definition
 */
interface Contract {
  // Identity
  id: ContractId;
  name: string;
  version: SemanticVersion;

  // Type
  type: ContractType;

  // Definition
  specPath: FilePath;
  specContent: string;

  // Parties
  provider: ServiceName;
  consumers: ServiceName[];

  // Validation
  status: ContractStatus;
  lastValidated: Timestamp | null;
  violations: ContractViolation[];

  // Lifecycle
  publishedAt: Timestamp;
  deprecatedAt: Timestamp | null;
}

type ContractType = 'openapi' | 'graphql' | 'grpc' | 'asyncapi' | 'jsonschema';
type ContractStatus = 'draft' | 'published' | 'validated' | 'broken' | 'deprecated';

interface ContractViolation {
  id: ViolationId;
  type: ViolationType;
  location: string;
  expected: string;
  actual: string;
  severity: Severity;
}

type ViolationType =
  | 'missing_endpoint'
  | 'extra_endpoint'
  | 'schema_mismatch'
  | 'type_mismatch'
  | 'required_field_missing'
  | 'unauthorized_change';
```

## Value Objects

### CodeLocation

```typescript
interface CodeLocation {
  file: FilePath;
  startLine: LineNumber;
  endLine: LineNumber;
  startColumn: ColumnNumber;
  endColumn: ColumnNumber;
}
```

### TestResult

```typescript
interface TestResult {
  testCaseId: TestCaseId;
  runId: TestRunId;
  status: 'passed' | 'failed' | 'skipped' | 'error' | 'timeout';
  duration: Duration;
  error: TestError | null;
  assertions: AssertionResult[];
  output: string;
  screenshots: Screenshot[];
}

interface TestError {
  message: string;
  stack: string;
  type: string;
  expected?: unknown;
  actual?: unknown;
}
```

### RiskScore

```typescript
interface RiskScore {
  value: number; // 0-100
  factors: {
    changeFrequency: number;
    complexity: number;
    dependencyCount: number;
    historicalDefects: number;
    coverageGap: number;
  };
  level: 'low' | 'medium' | 'high' | 'critical';
}
```

### TestSuggestion

```typescript
interface TestSuggestion {
  type: TestType;
  description: string;
  priority: Priority;
  targetCode: CodeLocation;
  generationPrompt: string;
  estimatedEffort: Duration;
}
```

## Aggregates

### TestSuite Aggregate

```
TestSuite (Aggregate Root)
├── TestCase (Entity)
│   ├── TestFixture (Value Object)
│   ├── Assertion (Value Object)
│   └── TestResult (Value Object)
├── TestConfiguration (Value Object)
└── TestMetadata (Value Object)
```

**Invariants**:
- Test suite must have at least one test case or nested suite
- Test case IDs must be unique within suite
- Circular suite nesting is prohibited
- Parallel execution respects max workers

### CoverageReport Aggregate

```
CoverageReport (Aggregate Root)
├── FileCoverage (Entity)
│   └── UncoveredLine (Value Object)
├── CoverageGap (Entity)
│   └── TestSuggestion (Value Object)
├── CoverageHotspot (Entity)
└── CoverageDelta (Value Object)
```

**Invariants**:
- Coverage percentages must be between 0-100
- Gap locations must exist in source files
- Hotspot change frequency must be positive
- Delta requires valid previous report

### QualityGate Aggregate

```
QualityGate (Aggregate Root)
├── QualityCriterion (Entity)
│   └── ThresholdValue (Value Object)
├── QualityGateEvaluation (Entity)
│   └── CriterionResult (Value Object)
└── GateConfiguration (Value Object)
```

**Invariants**:
- Gate must have at least one criterion
- Criterion thresholds must be valid for metric type
- Evaluation results must cover all criteria
- Failed gate cannot be marked passed without override

### ChaosExperiment Aggregate

```
ChaosExperiment (Aggregate Root)
├── FailureConfiguration (Entity)
│   └── FailureParameters (Value Object)
├── AbortCondition (Entity)
├── ImpactAssessment (Entity)
│   └── CascadeEffect (Value Object)
├── RecoveryMetrics (Entity)
└── RollbackProcedure (Value Object)
```

**Invariants**:
- Experiment must have at least one abort condition
- Duration must be positive and bounded
- Intensity must be between 0-1
- Rollback procedure must be defined before execution

## Domain Services

### TestGenerationService

```typescript
interface TestGenerationService {
  /**
   * Generate tests for target code
   */
  generate(request: TestGenerationRequest): Promise<TestSuite>;

  /**
   * Suggest test improvements based on coverage
   */
  suggestImprovements(coverage: CoverageReport): Promise<TestSuggestion[]>;

  /**
   * Learn from successful test patterns
   */
  learnPattern(testCase: TestCase, effectiveness: number): Promise<void>;
}

interface TestGenerationRequest {
  target: FilePath;
  type: TestType;
  framework: TestFramework;
  coverageTarget?: Percentage;
  focusGaps?: boolean;
  style: 'tdd-london' | 'tdd-chicago' | 'bdd' | 'example-based';
}
```

### CoverageAnalysisService

```typescript
interface CoverageAnalysisService {
  /**
   * Analyze coverage with O(log n) gap detection
   */
  analyze(request: CoverageAnalysisRequest): Promise<CoverageReport>;

  /**
   * Prioritize coverage gaps by risk
   */
  prioritizeGaps(gaps: CoverageGap[]): Promise<CoverageGap[]>;

  /**
   * Track coverage trends over time
   */
  trackTrend(reports: CoverageReport[]): Promise<CoverageTrend>;
}

interface CoverageAnalysisRequest {
  report: FilePath | CoverageData;
  target: FilePath;
  algorithm: 'johnson-lindenstrauss' | 'full-scan';
  prioritize: boolean;
}
```

### QualityAssessmentService

```typescript
interface QualityAssessmentService {
  /**
   * Evaluate quality gates
   */
  evaluateGates(request: GateEvaluationRequest): Promise<QualityGateEvaluation[]>;

  /**
   * Calculate overall quality score
   */
  calculateScore(metrics: QualityMetrics): Promise<QualityScore>;

  /**
   * Make release readiness decision
   */
  assessReadiness(request: ReadinessRequest): Promise<ReadinessDecision>;
}
```

### DefectIntelligenceService

```typescript
interface DefectIntelligenceService {
  /**
   * Predict potential defects
   */
  predict(request: DefectPredictionRequest): Promise<DefectPrediction[]>;

  /**
   * Analyze root cause of defect
   */
  analyzeRootCause(defect: Defect): Promise<RootCauseAnalysis>;

  /**
   * Find similar historical defects
   */
  findSimilar(defect: Defect, k: number): Promise<DefectMatch[]>;
}
```

### SecurityComplianceService

```typescript
interface SecurityComplianceService {
  /**
   * Run security scans
   */
  scan(request: SecurityScanRequest): Promise<SecurityReport>;

  /**
   * Check compliance with standards
   */
  checkCompliance(standards: ComplianceStandard[]): Promise<ComplianceReport>;

  /**
   * Generate audit trail
   */
  generateAuditTrail(timeRange: TimeRange): Promise<AuditTrail>;
}
```

### ChaosResilienceService

```typescript
interface ChaosResilienceService {
  /**
   * Design chaos experiment
   */
  design(request: ExperimentDesignRequest): Promise<ChaosExperiment>;

  /**
   * Execute experiment (with safety checks)
   */
  execute(experiment: ChaosExperiment): Promise<ExperimentResult>;

  /**
   * Assess system resilience
   */
  assessResilience(results: ExperimentResult[]): Promise<ResilienceReport>;
}
```

## Domain Events

### Test Domain Events

```typescript
interface TestCaseCreated {
  testCaseId: TestCaseId;
  testSuiteId: TestSuiteId;
  type: TestType;
  generatedBy: AgentId;
  timestamp: Timestamp;
}

interface TestExecutionCompleted {
  testRunId: TestRunId;
  testSuiteId: TestSuiteId;
  results: TestResult[];
  duration: Duration;
  timestamp: Timestamp;
}

interface TestFlakinessDetected {
  testCaseId: TestCaseId;
  flakinessScore: number;
  failurePatterns: FailurePattern[];
  timestamp: Timestamp;
}
```

### Coverage Domain Events

```typescript
interface CoverageGapDetected {
  reportId: CoverageReportId;
  gap: CoverageGap;
  riskScore: RiskScore;
  timestamp: Timestamp;
}

interface CoverageThresholdBreached {
  reportId: CoverageReportId;
  metric: 'line' | 'branch' | 'function';
  threshold: Percentage;
  actual: Percentage;
  timestamp: Timestamp;
}
```

### Quality Domain Events

```typescript
interface QualityGateEvaluated {
  gateId: QualityGateId;
  passed: boolean;
  score: number;
  failedCriteria: QualityCriterion[];
  timestamp: Timestamp;
}

interface ReleaseReadinessDecided {
  decision: 'go' | 'no-go';
  confidence: Probability;
  blockers: string[];
  timestamp: Timestamp;
}
```

### Security Domain Events

```typescript
interface SecurityVulnerabilityDetected {
  findingId: SecurityFindingId;
  severity: Severity;
  cweId: CWEId | null;
  timestamp: Timestamp;
}

interface ComplianceViolationFound {
  standard: ComplianceStandard;
  violations: ComplianceViolation[];
  timestamp: Timestamp;
}
```

### Chaos Domain Events

```typescript
interface ChaosExperimentStarted {
  experimentId: ChaosExperimentId;
  target: ServiceName;
  failureType: FailureType;
  timestamp: Timestamp;
}

interface ChaosImpactDetected {
  experimentId: ChaosExperimentId;
  impact: ImpactAssessment;
  timestamp: Timestamp;
}

interface SystemRecoveryCompleted {
  experimentId: ChaosExperimentId;
  recoveryMetrics: RecoveryMetrics;
  timestamp: Timestamp;
}
```

## Repository Interfaces

### TestRepository

```typescript
interface TestRepository {
  save(testSuite: TestSuite): Promise<void>;
  findById(id: TestSuiteId): Promise<TestSuite | null>;
  findByTarget(path: FilePath): Promise<TestSuite[]>;
  findByTags(tags: Tag[]): Promise<TestSuite[]>;
  delete(id: TestSuiteId): Promise<void>;
}
```

### CoverageRepository

```typescript
interface CoverageRepository {
  save(report: CoverageReport): Promise<void>;
  findById(id: CoverageReportId): Promise<CoverageReport | null>;
  findLatest(project: ProjectId): Promise<CoverageReport | null>;
  findByCommit(commit: CommitHash): Promise<CoverageReport | null>;
  findHistory(project: ProjectId, limit: number): Promise<CoverageReport[]>;
}
```

### SecurityFindingRepository

```typescript
interface SecurityFindingRepository {
  save(finding: SecurityFinding): Promise<void>;
  findById(id: SecurityFindingId): Promise<SecurityFinding | null>;
  findByFile(path: FilePath): Promise<SecurityFinding[]>;
  findBySeverity(severity: Severity): Promise<SecurityFinding[]>;
  findOpen(): Promise<SecurityFinding[]>;
  markResolved(id: SecurityFindingId, resolution: string): Promise<void>;
}
```

## Factories

### TestCaseFactory

```typescript
class TestCaseFactory {
  static createUnit(params: UnitTestParams): TestCase;
  static createIntegration(params: IntegrationTestParams): TestCase;
  static createE2E(params: E2ETestParams): TestCase;
  static createFromPattern(pattern: TestPattern, target: CodeLocation): TestCase;
}
```

### ChaosExperimentFactory

```typescript
class ChaosExperimentFactory {
  static createNetworkLatency(target: ServiceName, latency: Duration): ChaosExperiment;
  static createNetworkPartition(target: ServiceName, partition: PartitionConfig): ChaosExperiment;
  static createResourceStress(target: ServiceName, resource: ResourceType, intensity: Percentage): ChaosExperiment;
  static createFromTemplate(template: ExperimentTemplate, target: ServiceName): ChaosExperiment;
}
```

## Type Definitions

```typescript
// Branded types for type safety
type Branded<T, B> = T & { __brand: B };

type FilePath = Branded<string, 'FilePath'>;
type LineNumber = Branded<number, 'LineNumber'>;
type ColumnNumber = Branded<number, 'ColumnNumber'>;
type Percentage = Branded<number, 'Percentage'>; // 0-100
type Probability = Branded<number, 'Probability'>; // 0-1
type Duration = Branded<number, 'Duration'>; // milliseconds
type Timestamp = Branded<number, 'Timestamp'>; // Unix epoch ms
type Priority = 'low' | 'medium' | 'high' | 'critical';
type Tag = Branded<string, 'Tag'>;
type CommitHash = Branded<string, 'CommitHash'>;
type SemanticVersion = Branded<string, 'SemanticVersion'>;
type CWEId = Branded<string, 'CWEId'>; // e.g., "CWE-79"
type CVEId = Branded<string, 'CVEId'>; // e.g., "CVE-2024-1234"
type OWASPCategory = string; // e.g., "A01:2021-Broken Access Control"

// ID types
type TestCaseId = Branded<string, 'TestCaseId'>;
type TestSuiteId = Branded<string, 'TestSuiteId'>;
type TestRunId = Branded<string, 'TestRunId'>;
type CoverageReportId = Branded<string, 'CoverageReportId'>;
type CoverageGapId = Branded<string, 'CoverageGapId'>;
type QualityGateId = Branded<string, 'QualityGateId'>;
type DefectPredictionId = Branded<string, 'DefectPredictionId'>;
type SecurityFindingId = Branded<string, 'SecurityFindingId'>;
type ChaosExperimentId = Branded<string, 'ChaosExperimentId'>;
type ContractId = Branded<string, 'ContractId'>;
type ViolationId = Branded<string, 'ViolationId'>;
type AgentId = Branded<string, 'AgentId'>;
type UserId = Branded<string, 'UserId'>;
type ProjectId = Branded<string, 'ProjectId'>;
type ServiceName = Branded<string, 'ServiceName'>;
type ComponentName = Branded<string, 'ComponentName'>;
type FunctionName = Branded<string, 'FunctionName'>;
type ProgrammingLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'go' | 'rust' | 'csharp';
type ModelVersion = Branded<string, 'ModelVersion'>;
```

## Related Documentation

- [README](./README.md) - Domain overview
- [Integration Points](./integration-points.md) - V3 integration details
- [ADR-030: Agentic-QE Integration](../../implementation/adrs/ADR-030-agentic-qe-integration.md)
