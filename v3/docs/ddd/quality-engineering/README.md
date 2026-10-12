# Quality Engineering Domain

> **Retired (2026-10-09):** the in-repo `v3/plugins/agentic-qe` implementation described here was removed; it never wrapped the real `agentic-qe` package. This document is kept for history. Use the maintained [`agentic-qe`](https://www.npmjs.com/package/agentic-qe) npm package or its Claude Code plugin `agentic-qe-fleet` ([proffesor-for-testing/agentic-qe](https://github.com/proffesor-for-testing/agentic-qe)).

## Overview

The Quality Engineering (QE) domain provides comprehensive automated testing, quality assessment, and continuous validation capabilities for Claude Flow V3. It is implemented as the `agentic-qe` plugin with 51 specialized QE agents organized across 12 Domain-Driven Design bounded contexts.

## Strategic Design

### Domain Vision

> Enable intelligent, automated quality engineering that learns from patterns, predicts defects, and ensures continuous quality at scale.

### Core Subdomains

```
Quality Engineering Domain
├── Test Generation (Core)          # AI-powered test creation
├── Test Execution (Core)           # Parallel execution and reporting
├── Coverage Analysis (Core)        # Gap detection and prioritization
├── Quality Assessment (Core)       # Gates and readiness decisions
├── Defect Intelligence (Core)      # Prediction and root cause
├── Requirements Validation (Support) # BDD and testability
├── Code Intelligence (Support)     # Knowledge graph and search
├── Security Compliance (Core)      # SAST/DAST and audit
├── Contract Testing (Support)      # API contract validation
├── Visual Accessibility (Support)  # Visual regression and a11y
├── Chaos Resilience (Core)         # Chaos engineering and load
└── Learning Optimization (Generic) # Cross-domain transfer learning
```

### Subdomain Classification

| Subdomain | Type | Complexity | Business Value |
|-----------|------|------------|----------------|
| Test Generation | Core | High | Critical |
| Test Execution | Core | Medium | Critical |
| Coverage Analysis | Core | High | High |
| Quality Assessment | Core | Medium | Critical |
| Defect Intelligence | Core | High | High |
| Requirements Validation | Supporting | Medium | Medium |
| Code Intelligence | Supporting | High | Medium |
| Security Compliance | Core | High | Critical |
| Contract Testing | Supporting | Medium | Medium |
| Visual Accessibility | Supporting | Medium | Medium |
| Chaos Resilience | Core | High | High |
| Learning Optimization | Generic | Medium | Medium |

## Context Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Quality Engineering Domain                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                        ┌─────────────────────────┐                               │
│                        │    Queen Coordinator    │                               │
│                        │   (Hierarchical Root)   │                               │
│                        └───────────┬─────────────┘                               │
│                                    │                                             │
│        ┌───────────────────────────┼───────────────────────────┐                 │
│        │                           │                           │                 │
│        ▼                           ▼                           ▼                 │
│  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐          │
│  │ Test Creation │         │ Test Quality  │         │   Security    │          │
│  │   Cluster     │         │   Cluster     │         │   Cluster     │          │
│  ├───────────────┤         ├───────────────┤         ├───────────────┤          │
│  │ • test-gen    │◄───────►│ • coverage    │◄───────►│ • security    │          │
│  │ • test-exec   │ Shared  │ • quality     │ Shared  │ • contract    │          │
│  │ • req-valid   │ Kernel  │ • defect      │ Kernel  │ • chaos       │          │
│  └───────────────┘         └───────────────┘         └───────────────┘          │
│        │                           │                           │                 │
│        │                           │                           │                 │
│        └───────────────────────────┼───────────────────────────┘                 │
│                                    │                                             │
│                                    ▼                                             │
│                        ┌─────────────────────────┐                               │
│                        │   Support Services      │                               │
│                        ├─────────────────────────┤                               │
│                        │ • code-intelligence     │                               │
│                        │ • visual-accessibility  │                               │
│                        │ • learning-optimization │                               │
│                        └─────────────────────────┘                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                    Integration with Claude Flow V3
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│ Security      │          │ Memory        │          │ Coordination  │
│ Domain (V3)   │          │ Domain (V3)   │          │ Domain (V3)   │
├───────────────┤          ├───────────────┤          ├───────────────┤
│ Conformist    │          │ Shared Kernel │          │ Shared Kernel │
│ (Security     │          │ (AgentDB/HNSW │          │ (Hive Mind    │
│  compliance   │          │  memory       │          │  consensus)   │
│  uses V3)     │          │  sharing)     │          │               │
└───────────────┘          └───────────────┘          └───────────────┘
```

### Integration Relationships

| QE Context | V3 Domain | Relationship | Description |
|------------|-----------|--------------|-------------|
| test-generation | Core | Customer-Supplier | QE generates tests, Core executes |
| coverage-analysis | Memory | Shared Kernel | Shared HNSW vector index |
| security-compliance | Security | Conformist | QE adapts to V3 security |
| code-intelligence | Memory | Shared Kernel | Shared knowledge graph storage |
| chaos-resilience | Coordination | Partnership | Coordinated fault injection |
| learning-optimization | Integration | Shared Kernel | Shared ReasoningBank |
| quality-assessment | Core | Customer-Supplier | QE assesses, Core acts |

## Bounded Contexts

### 1. Test Generation Context

**Responsibility**: AI-powered creation of tests across paradigms

**Agents**: 12
- `unit-test-generator` - Unit test creation with mocking
- `integration-test-generator` - Component integration tests
- `e2e-test-generator` - End-to-end scenario tests
- `property-test-generator` - Property-based testing
- `mutation-test-generator` - Mutation testing for test quality
- `fuzz-test-generator` - Fuzz testing for edge cases
- `api-test-generator` - REST/GraphQL API tests
- `performance-test-generator` - Load and performance tests
- `security-test-generator` - Security-focused tests
- `accessibility-test-generator` - WCAG compliance tests
- `contract-test-generator` - Contract-based tests
- `bdd-test-generator` - Behavior-driven development

**Ubiquitous Language**:
- **Test Fixture**: Setup state for test execution
- **Test Case**: Individual test with assertion
- **Test Suite**: Collection of related test cases
- **Mock**: Simulated dependency with programmed behavior
- **Stub**: Simplified dependency providing canned responses

### 2. Test Execution Context

**Responsibility**: Running tests with parallelization, retry, and reporting

**Agents**: 8
- `test-runner` - Core test execution engine
- `parallel-executor` - Parallelization coordinator
- `retry-manager` - Flaky test retry logic
- `result-aggregator` - Combines results across runs
- `flaky-test-detector` - Identifies non-deterministic tests
- `timeout-manager` - Execution timeout handling
- `resource-allocator` - Test resource management
- `test-reporter` - Report generation

**Ubiquitous Language**:
- **Test Run**: Single execution of a test suite
- **Flaky Test**: Non-deterministic test with intermittent failures
- **Parallel Shard**: Subset of tests for parallel execution
- **Test Report**: Summary of execution results

### 3. Coverage Analysis Context

**Responsibility**: O(log n) gap detection and prioritization

**Agents**: 6
- `coverage-collector` - Gathers coverage data
- `gap-detector` - Identifies uncovered code
- `priority-ranker` - Ranks gaps by importance
- `hotspot-analyzer` - Finds frequently changed uncovered code
- `trend-tracker` - Tracks coverage over time
- `impact-assessor` - Assesses risk of uncovered code

**Ubiquitous Language**:
- **Coverage Gap**: Code without test coverage
- **Hotspot**: High-change area without coverage
- **Coverage Delta**: Change in coverage between runs
- **Risk Score**: Assessed risk of uncovered code

### 4. Quality Assessment Context

**Responsibility**: Quality gates and release readiness decisions

**Agents**: 5
- `quality-gate-evaluator` - Evaluates gate criteria
- `readiness-assessor` - Determines release readiness
- `risk-calculator` - Calculates quality risk
- `metric-aggregator` - Combines quality metrics
- `decision-maker` - Makes go/no-go decisions

**Ubiquitous Language**:
- **Quality Gate**: Threshold criteria for quality
- **Readiness Score**: Numeric assessment of release readiness
- **Quality Debt**: Accumulated quality issues
- **Go/No-Go Decision**: Binary release decision

### 5. Defect Intelligence Context

**Responsibility**: ML-based defect prediction and root cause analysis

**Agents**: 4
- `defect-predictor` - Predicts likely defects
- `root-cause-analyzer` - Determines defect causes
- `pattern-detector` - Finds recurring defect patterns
- `regression-tracker` - Tracks regression defects

**Ubiquitous Language**:
- **Defect Prediction**: ML-based likelihood assessment
- **Root Cause**: Underlying reason for defect
- **Defect Pattern**: Recurring defect signature
- **Regression**: Previously fixed defect that recurs

### 6. Requirements Validation Context

**Responsibility**: BDD validation and testability analysis

**Agents**: 3
- `bdd-validator` - Validates BDD specifications
- `testability-analyzer` - Assesses requirement testability
- `requirement-tracer` - Traces requirements to tests

**Ubiquitous Language**:
- **Given-When-Then**: BDD scenario format
- **Testability Score**: How easily a requirement can be tested
- **Requirement Trace**: Link from requirement to test

### 7. Code Intelligence Context

**Responsibility**: Knowledge graph and semantic code search

**Agents**: 5
- `knowledge-graph-builder` - Builds code knowledge graph
- `semantic-searcher` - Semantic code search
- `dependency-analyzer` - Analyzes code dependencies
- `complexity-assessor` - Measures code complexity
- `pattern-miner` - Discovers code patterns

**Ubiquitous Language**:
- **Knowledge Graph**: Graph of code entities and relationships
- **Semantic Query**: Natural language code search
- **Dependency Chain**: Series of code dependencies
- **Complexity Score**: Cyclomatic/cognitive complexity

### 8. Security Compliance Context

**Responsibility**: SAST, DAST, and compliance auditing

**Agents**: 4
- `sast-scanner` - Static application security testing
- `dast-scanner` - Dynamic application security testing
- `audit-trail-manager` - Compliance audit management
- `compliance-checker` - Standards compliance verification

**Ubiquitous Language**:
- **SAST Finding**: Static analysis security issue
- **DAST Finding**: Dynamic analysis security issue
- **Compliance Standard**: Security standard (OWASP, PCI-DSS)
- **Audit Trail**: Record of security-relevant actions

### 9. Contract Testing Context

**Responsibility**: API contract validation

**Agents**: 3
- `openapi-validator` - OpenAPI/Swagger validation
- `graphql-validator` - GraphQL schema validation
- `grpc-validator` - gRPC/Protobuf validation

**Ubiquitous Language**:
- **Contract**: API specification agreement
- **Provider**: API implementation
- **Consumer**: API client
- **Contract Violation**: Mismatch between spec and implementation

### 10. Visual Accessibility Context

**Responsibility**: Visual regression and WCAG compliance

**Agents**: 3
- `visual-regression-detector` - Screenshot comparison
- `wcag-checker` - Accessibility compliance
- `screenshot-differ` - Image diff analysis

**Ubiquitous Language**:
- **Visual Baseline**: Reference screenshot
- **Visual Diff**: Detected screenshot changes
- **WCAG Violation**: Accessibility standard failure
- **Contrast Ratio**: Text/background contrast measurement

### 11. Chaos Resilience Context

**Responsibility**: Chaos engineering and resilience validation

**Agents**: 4
- `chaos-injector` - Injects controlled failures
- `load-generator` - Generates load for stress testing
- `resilience-assessor` - Assesses system resilience
- `recovery-validator` - Validates recovery procedures

**Ubiquitous Language**:
- **Chaos Experiment**: Controlled failure injection
- **Blast Radius**: Scope of chaos impact
- **Recovery Time**: Time to recover from failure
- **Resilience Score**: System's ability to handle failures

### 12. Learning Optimization Context

**Responsibility**: Cross-domain transfer learning

**Agents**: 2
- `cross-domain-learner` - Transfers patterns across domains
- `pattern-optimizer` - Optimizes learned patterns

**Ubiquitous Language**:
- **Transfer Learning**: Applying patterns from one domain to another
- **Pattern Effectiveness**: Success rate of applied patterns
- **Dream Cycle**: Offline pattern consolidation

## Agent Inventory

### Total: 51 QE Agents + 7 TDD Subagents

| Context | Agent Count | Complexity |
|---------|-------------|------------|
| test-generation | 12 | High |
| test-execution | 8 | Medium |
| coverage-analysis | 6 | High |
| quality-assessment | 5 | Medium |
| defect-intelligence | 4 | High |
| requirements-validation | 3 | Medium |
| code-intelligence | 5 | High |
| security-compliance | 4 | High |
| contract-testing | 3 | Medium |
| visual-accessibility | 3 | Medium |
| chaos-resilience | 4 | High |
| learning-optimization | 2 | Medium |
| **Total** | **59** | - |

### TDD Subagents (7)

Used for London-style TDD red-green-refactor cycles:

1. `requirement-analyzer` - Analyzes requirements for testability
2. `test-designer` - Designs test structure and assertions
3. `red-phase-executor` - Executes failing test phase
4. `green-phase-implementer` - Implements minimal passing code
5. `refactor-advisor` - Suggests refactoring improvements
6. `coverage-verifier` - Verifies coverage targets met
7. `cycle-coordinator` - Orchestrates the TDD cycle

## Memory Namespaces

All QE data is stored under the `aqe/v3/` namespace prefix:

| Namespace | Purpose | Vector Dim | HNSW Config |
|-----------|---------|------------|-------------|
| `aqe/v3/test-patterns` | Learned test generation patterns | 384 | M=16, efC=200 |
| `aqe/v3/coverage-data` | Coverage analysis results | 384 | M=12, efC=150 |
| `aqe/v3/defect-patterns` | Defect intelligence data | 384 | M=16, efC=200 |
| `aqe/v3/code-knowledge` | Code knowledge graph | 384 | M=24, efC=300 |
| `aqe/v3/security-findings` | Security scan results | 384 | M=16, efC=200 |
| `aqe/v3/contracts` | API contract definitions | 384 | M=12, efC=150 |
| `aqe/v3/visual-baselines` | Visual regression baselines | 768 | M=32, efC=400 |
| `aqe/v3/chaos-experiments` | Chaos experiment data | 384 | M=12, efC=150 |
| `aqe/v3/learning-trajectories` | ReasoningBank trajectories | 384 | M=16, efC=200 |

## Related Documentation

- [ADR-030: Agentic-QE Integration](../../implementation/adrs/ADR-030-agentic-qe-integration.md)
- [Domain Model](./domain-model.md)
- [Integration Points](./integration-points.md)
- [ADR-015: Unified Plugin System](../../implementation/adrs/ADR-015-unified-plugin-system.md)
- [ADR-006: Unified Memory Service](../../implementation/adrs/ADR-006-UNIFIED-MEMORY.md)
