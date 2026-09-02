# 🚀 CI/CD Pipeline Documentation

This document provides comprehensive information about the GitHub Actions CI/CD pipeline for Claude Flow.

## 📊 Pipeline Overview

Our CI/CD pipeline consists of four main workflows designed to ensure code quality, reliability, and automated deployment management:

1. **🔍 Verification Pipeline** - Comprehensive code verification and quality checks
2. **🎯 Truth Scoring Pipeline** - Automated truth scoring on pull requests  
3. **🔗 Cross-Agent Integration Tests** - Multi-agent system integration testing
4. **🔄 Automated Rollback Manager** - Intelligent rollback management

## 🔍 Verification Pipeline

**File:** `.github/workflows/verification-pipeline.yml`

### Purpose
Comprehensive verification of code changes including security, quality, testing, and build validation.

### Triggers
- Push to `main`, `develop`, `alpha-*` branches
- Pull requests to `main`, `develop`
- Manual dispatch

### Jobs

#### 🚀 Setup Verification
- Generates unique verification ID
- Sets up test matrix for multi-platform testing
- Caches dependencies for faster execution

#### 🛡️ Security Verification
- Security audit using `npm audit`
- License compliance checking
- Dependency vulnerability scanning
- Generates security reports

#### 📝 Code Quality
- ESLint analysis with JSON reporting
- TypeScript type checking
- Code formatting verification
- Complexity analysis

#### 🧪 Test Verification
- Multi-platform testing (Ubuntu, macOS, Windows)
- Multiple Node.js versions (18, 20)
- Unit, integration, and performance tests
- Coverage reporting

#### 🏗️ Build Verification
- TypeScript compilation
- Binary building (optional)
- CLI functionality testing
- Package creation

#### 📚 Documentation Verification
- Documentation file presence check
- Link validation in markdown files
- Package.json validation

#### ⚡ Performance Verification
- Performance benchmarking
- Memory leak detection
- Resource usage monitoring

#### 📊 Verification Report
- Aggregate all verification results
- Generate comprehensive reports
- Update status badges
- Post PR comments with results

### Artifacts
- Security reports (30 days retention)
- Quality reports (30 days retention)
- Test results (30 days retention)
- Build artifacts (30 days retention)
- Performance reports (30 days retention)
- Verification summary (90 days retention)

## 🎯 Truth Scoring Pipeline

**File:** `.github/workflows/truth-scoring.yml`

### Purpose
Automated scoring system to evaluate the "truthfulness" and quality of code changes using multiple metrics.

### Scoring Components

#### 📝 Code Accuracy Scoring (35% weight)
- ESLint errors and warnings analysis
- TypeScript compilation errors
- Static analysis results
- **Penalty System:**
  - Errors: -2 points each (max -20)
  - Warnings: -0.5 points each
  - TypeScript errors: -3 points each (max -15)

#### 🧪 Test Coverage Scoring (25% weight)
- Line coverage (40% of score)
- Branch coverage (30% of score)
- Function coverage (20% of score)
- Statement coverage (10% of score)

#### ⚡ Performance Regression Scoring (25% weight)
- Baseline vs current performance comparison
- **Regression Penalties:**
  - Performance degradation: -2x degradation percentage (max -50)
- **Improvement Bonuses:**
  - Performance improvements: +improvement percentage (max +10)

#### 📚 Documentation Scoring (15% weight)
- Base score: 70 points
- **Bonuses:**
  - README.md exists: +10
  - CHANGELOG.md exists: +10
  - LICENSE exists: +5
  - Documentation files updated: +2 per file (max +10)

### Scoring Thresholds
- **Pass Threshold:** 85/100
- **Failure Action:** Fail the pipeline if below threshold
- **PR Comments:** Automatic scoring results posted to PRs

### Truth Score Calculation
```
Final Score = (Code Accuracy × 0.35) + (Test Coverage × 0.25) + (Performance × 0.25) + (Documentation × 0.15)
```

## 🔗 Cross-Agent Integration Tests

**File:** `.github/workflows/integration-tests.yml`

### Purpose
Comprehensive testing of multi-agent system integration, coordination, and performance under various conditions.

### Test Scenarios

#### 🤝 Agent Coordination Tests
- **Agent Types Tested:** coder, tester, reviewer, planner, researcher, backend-dev, performance-benchmarker
- **Test Matrix:** Configurable agent counts based on scope
- **Metrics:**
  - Inter-agent communication latency
  - Message success rates
  - Task distribution efficiency
  - Load balancing effectiveness

#### 🧠 Memory Sharing Integration
- Shared memory operations (store, retrieve, update, delete, search)
- Cross-agent memory synchronization
- Conflict resolution testing
- Data consistency verification

#### 🛡️ Fault Tolerance Tests
- **Failure Scenarios:**
  - Agent crashes
  - Network timeouts
  - Memory overflow
  - Task timeouts
  - Communication failures
- **Recovery Metrics:**
  - Detection time
  - Recovery time
  - Success rate (target: 90%+)

#### ⚡ Performance Integration Tests
- Multi-agent performance under load
- Scalability limits testing (1-15 agents)
- Throughput and latency measurements
- Resource utilization monitoring

### Test Scopes
- **Smoke:** Basic functionality (2 coder, 1 tester)
- **Core:** Standard testing (7 agents total)
- **Full:** Comprehensive testing (14+ agents)
- **Stress:** Maximum load testing (15+ agents)

### Success Criteria
- All coordination tests pass
- Memory synchronization works correctly
- 90%+ fault recovery success rate
- Performance within acceptable limits
- System remains stable under load

## 🔄 Automated Rollback Manager

**File:** `.github/workflows/rollback-manager.yml`

### Purpose
Intelligent automated rollback system that detects failures and can automatically revert to a known good state.

### Trigger Conditions

#### Automatic Triggers
- Verification Pipeline failure
- Truth Scoring Pipeline failure
- Integration Tests failure
- Push to main branch (monitoring)

#### Manual Triggers
- Workflow dispatch with parameters:
  - Rollback target (commit SHA/tag)
  - Rollback reason
  - Emergency mode flag
  - Rollback scope (application/database/infrastructure/full)

### Rollback Process

#### 🚨 Failure Detection
- Analyzes workflow run conclusions
- Determines failure severity:
  - **High:** Verification Pipeline, Integration Tests
  - **Medium:** Truth Scoring, other workflows
  - **Low:** Minor issues
- Identifies safe rollback target

#### 🔍 Pre-Rollback Validation
- Validates rollback target commit exists
- Ensures target is ancestor of current HEAD
- Creates backup of current state
- Tests rollback target viability

#### 🔄 Execute Rollback
- Creates rollback commit with metadata
- **Emergency Mode:** Force push with lease
- **Normal Mode:** Standard push
- Creates rollback tag for tracking

#### ✅ Post-Rollback Verification
- Build functionality verification
- Smoke tests execution
- CLI functionality testing
- System health checks

#### 📊 Rollback Monitoring
- System stability monitoring (15 minutes default)
- Performance monitoring
- Error rate tracking
- Automated reporting

### Approval Requirements
- **High Severity:** Automatic execution
- **Emergency Mode:** Automatic execution
- **Medium/Low Severity:** Manual approval required

### Artifacts and Reporting
- Failure detection reports (90 days)
- Pre-rollback validation (90 days)
- Rollback execution logs (90 days)
- Post-rollback monitoring (90 days)
- Stakeholder notifications (GitHub issues)

## 📊 Status Badges

**File:** `.github/workflows/status-badges.yml`

Dynamic status badges that update based on workflow results:

```markdown
[![Verification Pipeline](https://img.shields.io/github/actions/workflow/status/ruvnet/claude-code-flow/verification-pipeline.yml?branch=main&label=verification&style=flat-square)](https://github.com/ruvnet/claude-code-flow/actions/workflows/verification-pipeline.yml)
[![Truth Scoring](https://img.shields.io/github/actions/workflow/status/ruvnet/claude-code-flow/truth-scoring.yml?branch=main&label=truth%20score&style=flat-square)](https://github.com/ruvnet/claude-code-flow/actions/workflows/truth-scoring.yml)
[![Integration Tests](https://img.shields.io/github/actions/workflow/status/ruvnet/claude-code-flow/integration-tests.yml?branch=main&label=integration&style=flat-square)](https://github.com/ruvnet/claude-code-flow/actions/workflows/integration-tests.yml)
[![Rollback Manager](https://img.shields.io/github/actions/workflow/status/ruvnet/claude-code-flow/rollback-manager.yml?branch=main&label=rollback&style=flat-square)](https://github.com/ruvnet/claude-code-flow/actions/workflows/rollback-manager.yml)
```

## ⚙️ Configuration Files

### `.audit-ci.json`
Security audit configuration for automated vulnerability scanning.

### GitHub Issue Templates
- **Rollback Incident Report:** Structured template for incident documentation

## 🔧 Workflow Integration

### Artifact Sharing
All workflows generate artifacts that can be shared between jobs:
- Test results and coverage reports
- Security and quality analysis
- Performance benchmarks
- Rollback execution logs

### Environment Variables
Key environment variables used across workflows:
- `NODE_VERSION`: '20'
- `TRUTH_SCORE_THRESHOLD`: 85
- `REGRESSION_THRESHOLD`: 10
- `MAX_PARALLEL_AGENTS`: 8
- `ROLLBACK_RETENTION_DAYS`: 90

### Secrets Required
- `GITHUB_TOKEN`: Automatic token for repository access
- Additional secrets may be required for external integrations

## 📈 Performance Monitoring

### Metrics Collected
- Build times and success rates
- Test execution duration and coverage
- Truth score trends over time
- Integration test performance
- Rollback frequency and success rate

### Monitoring Windows
- **Real-time:** During workflow execution
- **Post-deployment:** 15-minute stability window
- **Long-term:** Daily/weekly trend analysis

## 🛠️ Maintenance and Updates

### Regular Maintenance Tasks
1. Update Node.js versions in workflows
2. Review and update truth scoring thresholds
3. Adjust integration test agent matrices
4. Clean up old artifacts and logs
5. Review rollback targets and procedures

### Workflow Updates
When updating workflows:
1. Test changes in feature branches
2. Use workflow dispatch for validation
3. Monitor metrics after deployment
4. Update documentation accordingly

## 🔍 Troubleshooting

### Common Issues

#### Verification Pipeline Failures
- Check security audit results
- Review ESLint and TypeScript errors
- Validate test failures
- Examine build logs

#### Truth Scoring Below Threshold
- Improve code quality (reduce ESLint errors)
- Increase test coverage
- Optimize performance
- Update documentation

#### Integration Test Failures
- Check agent coordination logs
- Review memory synchronization issues
- Analyze fault tolerance test results
- Monitor system performance

#### Rollback Issues
- Validate rollback target exists
- Check backup integrity
- Review approval requirements
- Monitor post-rollback stability

### Getting Help
1. Check workflow logs in GitHub Actions
2. Review artifact reports
3. Consult this documentation
4. Create issue with rollback incident template

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Claude Flow Wiki](https://github.com/ruvnet/claude-code-flow/wiki)
- [Agent System Documentation](../agent-system-documentation.md)
- [Performance Benchmarking](../reports/PERFORMANCE_METRICS_VALIDATION_REPORT.md)

---

*This documentation is automatically updated by the CI/CD pipeline. Last updated: $(date -u +%Y-%m-%d)*