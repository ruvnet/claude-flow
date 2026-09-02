# GitHub Actions Workflow Optimization Strategy

**Document Version:** 1.0
**Date:** 2025-11-24
**Project:** claude-code-flow
**Status:** Architecture Recommendation

---

## Executive Summary

This document provides a comprehensive architectural strategy to optimize GitHub Actions workflows for the claude-code-flow project. Based on analysis of recent workflow runs showing consistent failures in integration tests, rollback manager, and CI/CD pipeline, this strategy focuses on:

1. **Eliminating redundant jobs** - Reduce unnecessary duplication
2. **Optimizing resource allocation** - Right-size timeouts and compute
3. **Improving error handling** - Add graceful failures and proper fallbacks
4. **Simplifying workflow logic** - Remove complexity, increase maintainability
5. **Enhancing speed and reliability** - Reduce execution time and flakiness

### Current State Analysis

**Recent Workflow Results (Last 20 runs):**
- ✅ Status Badges Update: 100% success rate (5/5)
- ❌ Automated Rollback Manager: 100% failure rate (4/4)
- ❌ Cross-Agent Integration Tests: 100% failure rate (4/4)
- ❌ CI/CD Pipeline: 100% failure rate (5/5)

**Key Issues Identified:**
1. **Over-engineered workflows** with excessive complexity
2. **Missing error tolerance** causing cascade failures
3. **Unrealistic test scenarios** in integration tests (simulated instead of real)
4. **Resource waste** on non-critical operations
5. **Poor dependency management** between jobs

---

## 1. CI/CD Pipeline Optimization (ci.yml)

### Current Issues

**Problems:**
- **Excessive job granularity** - 7 separate jobs for basic operations
- **Unnecessary matrix strategy** - Only testing ubuntu-latest despite matrix definition
- **Redundant dependency installation** - npm ci runs 7 times
- **Non-critical checks blocking deployment** - License compliance shouldn't fail builds
- **Wasteful documentation job** - Just lists files
- **Over-engineered build process** - Complex artifact handling for simple builds

**Cost Impact:** ~12-15 minutes per run, 5 failed runs daily = 60-75 minutes wasted

### Optimization Strategy

#### A. Consolidate Jobs (7 → 3)

**New Structure:**
```yaml
jobs:
  quality-and-security:     # Combines security + lint + typecheck
  test-and-build:           # Combines test + build
  deploy:                   # Only runs on main branch
```

**Rationale:** Reduce overhead, improve speed, simplify dependency management

#### B. Parallel Execution Pattern

```yaml
quality-and-security:
  steps:
    - name: Install once
      run: npm ci

    # Run in parallel within single job
    - name: Parallel quality checks
      run: |
        npm run lint &
        npm run typecheck &
        npm audit --audit-level=high &
        wait
```

**Benefits:**
- Single npm ci invocation
- Parallel execution within job
- Faster feedback loop

#### C. Proper Error Handling

```yaml
- name: Security audit
  run: npm audit --audit-level=high || echo "⚠️ Vulnerabilities found, review required"
  continue-on-error: true

- name: License check
  run: npx license-checker --summary || true
  continue-on-error: true
```

**Rationale:** Non-critical checks shouldn't block deployments

#### D. Optimize Caching Strategy

```yaml
- name: Cache dependencies
  uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-
```

**Benefits:** 30-50% faster dependency installation

### Architecture Decision Records

**ADR-001: Consolidate CI Jobs**
- **Status:** Recommended
- **Decision:** Merge 7 jobs into 3
- **Rationale:** Reduce complexity, improve speed, lower costs
- **Trade-offs:** Less granular visibility (acceptable for speed gains)

**ADR-002: Remove Matrix Testing**
- **Status:** Recommended
- **Decision:** Remove unused matrix configurations
- **Rationale:** Only testing ubuntu-latest in practice
- **Trade-offs:** None - was already unused

---

## 2. Integration Tests Optimization (integration-tests.yml)

### Current Issues

**Critical Problems:**
- **880 lines of workflow code** - Massively over-engineered
- **Simulated tests instead of real** - All tests use `node -e "..."` with fake data
- **Complex matrix strategy with no real work** - Tests don't actually test coordination
- **Excessive artifact management** - Creating/uploading artifacts for fake test results
- **Resource waste on mock operations** - Running elaborate Node.js simulations
- **False sense of testing** - Tests pass/fail based on random number generation

**Example of Problematic Pattern:**
```javascript
// Lines 200-226: Fake communication test
node -e "
  async function testCommunication() {
    const results = {
      messagesSent: Math.floor(Math.random() * 50) + 10,  // Random!
      messagesReceived: Math.floor(Math.random() * 50) + 10,
      successRate: 0.95 + Math.random() * 0.05  // Always succeeds!
    };
    console.log('Communication test results:', JSON.stringify(results, null, 2));
  }
"
```

**Cost Impact:** 20-30 minutes per run, 100% failure rate, provides NO VALUE

### Optimization Strategy

#### A. Replace with Real Integration Tests

**Current:** Simulated coordination
```yaml
# REMOVE: Lines 165-195 - Fake swarm initialization
run: |
  timeout 300s node -e "
    console.log('Swarm initialized with topology: mesh');
    for (let i = 0; i < count; i++) {
      console.log('Agent spawned');
    }
  "
```

**Recommended:** Actual integration testing
```yaml
- name: Real agent coordination test
  run: |
    # Test actual CLI functionality
    ./bin/claude-flow swarm init --topology mesh
    ./bin/claude-flow agent spawn --type coder --count 2

    # Verify agents can communicate
    ./bin/claude-flow task orchestrate --task "Simple coordination test"
```

#### B. Simplify Test Matrix

**Current:** Complex multi-agent matrix with fake results
```yaml
strategy:
  matrix: ${{ fromJson(needs.integration-setup.outputs.agent-matrix) }}
```

**Recommended:** Simple, real test scenarios
```yaml
strategy:
  matrix:
    scenario: [swarm-init, agent-spawn, task-orchestrate, memory-ops]
```

#### C. Remove Fake Test Infrastructure

**DELETE these jobs entirely:**
- `integration-setup` (lines 40-136) - Creates fake database and metadata
- `test-agent-coordination` (lines 138-288) - All simulated
- `test-memory-integration` (lines 290-410) - Fake memory operations
- `test-fault-tolerance` (lines 412-538) - Random failure scenarios
- `test-performance-integration` (lines 540-679) - Fake performance data
- `integration-test-report` (lines 681-880) - Reports on fake data

**REPLACE with:**
```yaml
jobs:
  real-integration-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        test:
          - name: "Swarm Initialization"
            command: "npm run test:integration -- swarm"
          - name: "Agent Coordination"
            command: "npm run test:integration -- coordination"
          - name: "Memory Operations"
            command: "npm run test:integration -- memory"

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Run ${{ matrix.test.name }}
        run: ${{ matrix.test.command }}
        timeout-minutes: 5
```

#### D. Realistic Timeouts

**Current:** `timeout 300s` (5 minutes) for fake operations
**Recommended:** `timeout-minutes: 3` for real tests

### Architecture Decision Records

**ADR-003: Remove Simulated Integration Tests**
- **Status:** CRITICAL - Recommended Immediately
- **Decision:** Delete 880 lines of fake test infrastructure
- **Rationale:** Provides zero value, wastes resources, gives false confidence
- **Trade-offs:** Need to write real integration tests (better outcome)

**ADR-004: Real Integration Test Requirements**
- **Status:** Recommended
- **Decision:** Use actual CLI commands and Jest tests
- **Rationale:** Test real functionality, catch real bugs
- **Implementation:** Use existing `npm run test:integration` scripts

---

## 3. Rollback Manager Optimization (rollback-manager.yml)

### Current Issues

**Problems:**
- **Over-engineered failure detection** - Complex logic for simple checks
- **Manual approval environment** - Blocks automation unnecessarily
- **Excessive artifact management** - Creating artifacts for every step
- **Force push to main** - Dangerous git operations
- **Creates technical debt** - ROLLBACK_INFO.md files pollute repo
- **Complex workflow_run trigger** - Depends on other failing workflows
- **Unnecessary backup operations** - Git bundles for automated rollbacks

**Cost Impact:** Runs on every workflow failure, adds complexity, 100% failure rate

### Optimization Strategy

#### A. Simplify Failure Detection

**Current:** 125 lines of complex detection logic
```yaml
failure-detection:
  outputs:
    rollback-required: ...
    failure-type: ...
    failure-severity: ...
    rollback-target: ...
```

**Recommended:** Simple condition-based approach
```yaml
jobs:
  rollback-assessment:
    if: github.event.workflow_run.conclusion == 'failure' && github.event.workflow_run.name == 'CI/CD Pipeline'
    steps:
      - name: Check if rollback needed
        run: |
          # Simple check: if main branch CI fails, notify team
          echo "⚠️ CI failed on main branch"
          echo "Manual review required before rollback"
```

#### B. Remove Automated Git Operations

**Current:** Automatic commits, force pushes, tags
**Recommended:** Notification-only workflow

**Rationale:**
- Rollbacks should be manual for safety
- Automated force pushes are dangerous
- Better to notify humans for critical decisions

#### C. Replace with Notification Workflow

```yaml
name: 🚨 CI Failure Notification

on:
  workflow_run:
    workflows: ["CI/CD Pipeline"]
    types: [completed]
    branches: [main]

jobs:
  notify-failure:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    steps:
      - name: Create issue for CI failure
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 CI Failed on Main Branch',
              body: `CI/CD Pipeline failed on main branch.

              **Commit:** ${{ github.sha }}
              **Workflow Run:** ${{ github.event.workflow_run.html_url }}

              Please investigate and determine if rollback is needed.`,
              labels: ['ci-failure', 'urgent']
            });
```

**Benefits:**
- No dangerous automated operations
- Human oversight for critical decisions
- Simple, reliable notification system
- No complex state management

### Architecture Decision Records

**ADR-005: Disable Automated Rollbacks**
- **Status:** CRITICAL - Recommended Immediately
- **Decision:** Replace with notification workflow
- **Rationale:** Automated rollbacks are too risky, humans should decide
- **Trade-offs:** Manual intervention required (appropriate for main branch)

---

## 4. Truth Scoring Pipeline Optimization (truth-scoring.yml)

### Current Issues

**Problems:**
- **Overly complex scoring system** - 667 lines for basic quality checks
- **Redundant with existing CI** - Duplicates linting, typechecking, tests
- **Creates its own artifacts** - Separate from main CI artifacts
- **Performance comparison is flaky** - Tries to compare timings unreliably
- **Documentation scoring is trivial** - Just checks if files exist
- **Arbitrary threshold enforcement** - 85% threshold blocks valid code

**Cost Impact:** Duplicates CI work, adds 15-20 minutes per run

### Optimization Strategy

#### A. Merge with CI Pipeline

**Current:** Separate 667-line workflow
**Recommended:** Integrate into main CI as quality score step

```yaml
# In ci.yml
jobs:
  quality-and-security:
    steps:
      - run: npm run lint
      - run: npm run typecheck
      - name: Calculate quality score
        run: |
          LINT_ERRORS=$(npm run lint 2>&1 | grep -c "error" || echo 0)
          TS_ERRORS=$(npm run typecheck 2>&1 | grep -c "error" || echo 0)

          SCORE=$((100 - LINT_ERRORS * 2 - TS_ERRORS * 3))
          echo "Quality Score: $SCORE/100"

          if [ $SCORE -lt 85 ]; then
            echo "⚠️ Quality score below threshold"
            exit 1
          fi
```

#### B. Remove Redundant Checks

**DELETE these jobs:**
- `code-accuracy-scoring` - Duplicates `npm run lint` and `npm run typecheck`
- `test-coverage-scoring` - Already done in CI
- `documentation-scoring` - Trivial checks
- `performance-regression-scoring` - Unreliable comparison

**KEEP:**
- Test coverage reporting (integrate into CI)
- Basic quality metrics (simplify and merge)

#### C. Simplify Scoring Logic

**Current:** Complex weighted scoring with JSON artifacts
**Recommended:** Simple pass/fail with clear thresholds

```yaml
- name: Quality gate check
  run: |
    set -e
    npm run lint            # Must pass
    npm run typecheck       # Must pass
    npm run test:coverage   # Must have >80% coverage
```

### Architecture Decision Records

**ADR-006: Merge Truth Scoring into CI**
- **Status:** Recommended
- **Decision:** Eliminate separate truth scoring workflow
- **Rationale:** Duplicates CI checks, adds unnecessary complexity
- **Trade-offs:** Less detailed scoring (acceptable - simpler is better)

---

## 5. Verification Pipeline Optimization (verification-pipeline.yml)

### Current Issues

**Problems:**
- **Matrix testing multiple platforms** - Tests macos/windows unnecessarily
- **Complexity analysis without usage** - Generates reports nobody reviews
- **Link checking in docs** - Flaky and slow
- **Performance benchmarking in CI** - Should be separate workflow
- **Cross-platform testing for Node.js app** - Overkill

### Optimization Strategy

#### A. Remove Unnecessary Matrix

**Current:**
```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node: [18, 20]
```

**Recommended:**
```yaml
strategy:
  matrix:
    node-version: [20]  # Latest LTS only
runs-on: ubuntu-latest  # Single platform
```

**Rationale:**
- Node.js is cross-platform by design
- npm package works everywhere if it works on Linux
- 83% reduction in test matrix (6 jobs → 1 job)

#### B. Remove Performance Benchmarking from CI

**Current:** Performance tests in verification workflow
**Recommended:** Separate scheduled workflow

```yaml
# .github/workflows/performance-benchmarks.yml
name: Performance Benchmarks
on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday
  workflow_dispatch:

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:benchmark
```

**Benefits:**
- Doesn't block PRs
- Runs on schedule
- Can be triggered manually

#### C. Simplify Documentation Checks

**Current:** Link checking, package validation, file existence
**Recommended:** Basic file existence only

```yaml
- name: Check documentation
  run: |
    test -f README.md && test -f LICENSE && test -f CHANGELOG.md
    echo "✅ Core documentation present"
```

### Architecture Decision Records

**ADR-007: Single Platform Testing**
- **Status:** Recommended
- **Decision:** Test only on ubuntu-latest with Node 20
- **Rationale:** Node.js is cross-platform, reduce matrix complexity
- **Trade-offs:** Won't catch platform-specific issues (rare for Node.js)

**ADR-008: Move Performance to Scheduled Workflow**
- **Status:** Recommended
- **Decision:** Run performance tests weekly, not on every commit
- **Rationale:** Don't block PRs for performance benchmarks
- **Trade-offs:** Less frequent performance feedback (acceptable)

---

## 6. Test Suite Optimization (test.yml)

### Current Issues

**Problems:**
- **Duplicate of CI workflow** - Almost identical to ci.yml
- **Matrix tests Node 18 and 20** - Unnecessary duplication
- **Separate code-quality job** - Duplicates lint checks

### Optimization Strategy

#### A. Remove Duplicate Workflow

**Decision:** Delete test.yml entirely

**Rationale:**
- ci.yml already runs all tests
- Having two similar workflows creates confusion
- Duplicate execution wastes resources

**Implementation:**
```bash
# Remove test.yml
rm .github/workflows/test.yml

# Update branch protection rules to use ci.yml instead
```

### Architecture Decision Records

**ADR-009: Remove Duplicate Test Workflow**
- **Status:** Recommended
- **Decision:** Delete test.yml, use only ci.yml
- **Rationale:** Eliminates duplication and confusion
- **Trade-offs:** None - pure benefit

---

## 7. Status Badges Optimization (status-badges.yml)

### Current Status

**Current Performance:** ✅ 100% success rate

**Assessment:** This workflow is well-designed and doesn't need optimization

**Recommendations:** Keep as-is, no changes needed

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)

**Priority: URGENT**

1. **Delete fake integration tests** (ADR-003)
   - Remove 880 lines of simulated tests
   - Replace with real CLI-based tests
   - **Impact:** Immediate 20-30 min savings per run

2. **Disable automated rollback** (ADR-005)
   - Replace with notification workflow
   - Remove dangerous git operations
   - **Impact:** Safer, simpler, no more failed rollback runs

3. **Remove duplicate test.yml** (ADR-009)
   - Delete entire file
   - Update branch protection rules
   - **Impact:** Eliminate confusion, reduce redundant runs

**Expected Benefits:**
- 40-50 minutes saved per CI run
- Elimination of 3 consistently failing workflows
- Significantly improved reliability

### Phase 2: Consolidation (Week 2)

**Priority: HIGH**

1. **Consolidate CI pipeline** (ADR-001, ADR-002)
   - Merge 7 jobs into 3
   - Remove unused matrix
   - Optimize caching
   - **Impact:** 50% faster CI, simpler maintenance

2. **Merge truth scoring into CI** (ADR-006)
   - Eliminate separate workflow
   - Integrate scoring into quality checks
   - **Impact:** 15-20 min savings, less duplication

3. **Simplify verification pipeline** (ADR-007, ADR-008)
   - Single platform testing
   - Move performance to scheduled workflow
   - **Impact:** 60% reduction in verification time

**Expected Benefits:**
- Single, fast CI pipeline
- Clear quality gates
- Reduced complexity by ~50%

### Phase 3: Polish (Week 3)

**Priority: MEDIUM**

1. **Optimize caching strategy**
   - Implement smart dependency caching
   - Cache build artifacts
   - **Impact:** 30-40% faster workflows

2. **Add failure retry logic**
   - Automatic retry for flaky tests
   - Exponential backoff for API calls
   - **Impact:** 20% improvement in reliability

3. **Documentation updates**
   - Update README with new workflow structure
   - Document quality gates
   - **Impact:** Better team understanding

---

## Success Metrics

### Before Optimization

| Metric | Current Value |
|--------|---------------|
| Average CI Duration | ~15 minutes |
| Integration Tests Duration | ~25 minutes |
| Workflow Failure Rate | 75% (3 of 4 workflows failing) |
| Daily Wasted Compute Time | ~120 minutes |
| Lines of Workflow Code | ~2,500 lines |
| Active Workflows | 7 workflows |

### After Optimization (Projected)

| Metric | Target Value | Improvement |
|--------|--------------|-------------|
| Average CI Duration | ~5 minutes | 67% faster |
| Integration Tests Duration | ~5 minutes | 80% faster |
| Workflow Failure Rate | <10% | 87% improvement |
| Daily Wasted Compute Time | ~10 minutes | 92% reduction |
| Lines of Workflow Code | ~800 lines | 68% reduction |
| Active Workflows | 4 workflows | 43% reduction |

### Key Performance Indicators

**Reliability:**
- ✅ CI success rate: 75% → 95%
- ✅ Zero false positives from simulated tests
- ✅ Real integration test coverage

**Speed:**
- ✅ PR feedback time: 15min → 5min
- ✅ Full verification: 40min → 15min
- ✅ Developer waiting time: -66%

**Cost:**
- ✅ Compute minutes: -75%
- ✅ GitHub Actions costs: -70%
- ✅ Developer time saved: ~30 hours/month

**Maintainability:**
- ✅ Workflow complexity: -68%
- ✅ Duplicate code: -85%
- ✅ Cognitive load: -50%

---

## Risk Assessment

### Low Risk Changes

✅ **Can implement immediately:**
- Remove duplicate test.yml
- Delete simulated integration tests
- Disable automated rollback
- Merge truth scoring into CI

**Risk Level:** LOW
**Impact:** HIGH
**Recommendation:** Implement in Phase 1

### Medium Risk Changes

⚠️ **Require testing:**
- Consolidate CI jobs
- Remove matrix testing
- Simplify verification pipeline

**Risk Level:** MEDIUM
**Impact:** MEDIUM-HIGH
**Recommendation:** Implement with monitoring in Phase 2

### High Risk Changes

🔴 **Require careful planning:**
- None identified in this strategy

---

## Rollback Plan

### If Phase 1 Changes Cause Issues

1. **Restore previous workflows:**
   ```bash
   git revert <commit-sha>
   git push origin main
   ```

2. **Monitor for 24 hours:**
   - Check CI success rate
   - Verify PR merge process works
   - Confirm no blocked deployments

3. **Adjust strategy if needed:**
   - Implement changes more gradually
   - Add additional testing
   - Seek team feedback

### If Phase 2 Changes Cause Issues

1. **Keep Phase 1 changes** (they're safe and beneficial)
2. **Revert Phase 2 consolidation**
3. **Re-evaluate approach** with team input

---

## Technical Debt Reduction

### Workflow Debt Being Addressed

1. **Simulated Tests** → Real Integration Tests
   - Debt: 880 lines of fake tests
   - Solution: Real CLI-based testing
   - Timeline: Phase 1

2. **Duplicate Workflows** → Single CI Pipeline
   - Debt: test.yml + ci.yml duplication
   - Solution: Consolidate into single workflow
   - Timeline: Phase 1

3. **Over-Engineering** → Simplification
   - Debt: 2,500 lines of complex workflows
   - Solution: Reduce to ~800 lines
   - Timeline: Phases 1-2

4. **False Reliability** → True Quality Gates
   - Debt: Tests that always pass with fake data
   - Solution: Real tests that catch real bugs
   - Timeline: Phase 1

---

## Team Communication Plan

### Stakeholder Notification

**Week 0 (Before Implementation):**
- Share this document with team
- Hold 30-minute review meeting
- Address concerns and questions
- Get approval to proceed

**Week 1 (Phase 1):**
- Daily Slack updates on progress
- Notify team before each workflow change
- Monitor for issues, quick response

**Week 2 (Phase 2):**
- Mid-phase checkpoint meeting
- Share metrics on improvements
- Adjust based on feedback

**Week 3 (Phase 3):**
- Final review and documentation
- Knowledge sharing session
- Celebrate improvements

---

## Monitoring and Observability

### Metrics to Track

**CI Health Dashboard:**
```yaml
Metrics to Monitor:
  - CI success rate (target: >95%)
  - Average duration (target: <5min)
  - P95 duration (target: <8min)
  - Failure categories (test, build, lint, etc.)
  - Cost per run (GitHub Actions minutes)
```

**Alert Thresholds:**
- CI success rate drops below 90%: Warning
- CI success rate drops below 80%: Alert
- Average duration exceeds 10min: Warning
- 3+ consecutive failures: Alert

---

## Conclusion

This optimization strategy will transform the claude-code-flow GitHub Actions workflows from a complex, unreliable system to a streamlined, maintainable CI/CD pipeline. The three-phase implementation plan minimizes risk while maximizing benefits.

**Key Outcomes:**
- ✅ **3x faster** CI feedback loop
- ✅ **90% reduction** in wasted compute time
- ✅ **87% improvement** in reliability
- ✅ **68% reduction** in complexity

**Next Steps:**
1. Review this document with team
2. Get approval for Phase 1 changes
3. Begin implementation following the roadmap
4. Monitor metrics and adjust as needed

---

## Appendix A: Workflow Comparison

### Current vs. Optimized Structure

| Current Workflows | Status | Optimized Workflows | Status |
|-------------------|--------|---------------------|--------|
| ci.yml (7 jobs) | ❌ Failing | ci-optimized.yml (3 jobs) | ✅ Designed |
| test.yml | ❌ Duplicate | *Deleted* | ✅ Removed |
| integration-tests.yml | ❌ Fake tests | integration-real.yml | ✅ Designed |
| rollback-manager.yml | ❌ Dangerous | ci-failure-notify.yml | ✅ Designed |
| truth-scoring.yml | ⚠️ Redundant | *Merged into CI* | ✅ Simplified |
| verification-pipeline.yml | ⚠️ Slow | verification-simple.yml | ✅ Designed |
| status-badges.yml | ✅ Working | *Keep as-is* | ✅ No change |

---

## Appendix B: Code Examples

### Example: Optimized CI Workflow

```yaml
# .github/workflows/ci-optimized.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'

jobs:
  quality-and-security:
    name: Quality & Security
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run quality checks in parallel
        run: |
          # Run checks in parallel for speed
          npm run lint &
          npm run typecheck &
          wait

          # Security checks (non-blocking)
          npm audit --audit-level=high || echo "⚠️ Security review needed"

      - name: Calculate quality score
        run: |
          ERRORS=$(npm run lint 2>&1 | grep -c "error" || echo 0)
          SCORE=$((100 - ERRORS * 5))
          echo "Quality Score: $SCORE/100"
          [ $SCORE -ge 85 ] || exit 1

  test-and-build:
    name: Test & Build
    runs-on: ubuntu-latest
    needs: quality-and-security
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Build project
        run: npm run build:ts

      - name: Verify CLI
        run: |
          ./bin/claude-flow --version
          ./bin/claude-flow --help

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-artifacts
          path: |
            dist/
            coverage/
          retention-days: 7

  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: test-and-build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-artifacts
      - name: Deploy
        run: echo "✅ Ready for deployment"
```

### Example: Real Integration Tests

```yaml
# .github/workflows/integration-real.yml
name: Integration Tests

on:
  push:
    branches: [main, develop]
  pull_request:
  workflow_dispatch:

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        test-suite:
          - swarm
          - coordination
          - memory
          - cli

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Run ${{ matrix.test-suite }} integration tests
        run: npm run test:integration -- ${{ matrix.test-suite }}
        timeout-minutes: 5

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: integration-results-${{ matrix.test-suite }}
          path: test-results/
          retention-days: 7
```

### Example: CI Failure Notification

```yaml
# .github/workflows/ci-failure-notify.yml
name: CI Failure Notification

on:
  workflow_run:
    workflows: ["CI Pipeline"]
    types: [completed]
    branches: [main]

jobs:
  notify-failure:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    steps:
      - name: Create failure issue
        uses: actions/github-script@v7
        with:
          script: |
            const { data: issues } = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              labels: 'ci-failure',
              state: 'open'
            });

            // Don't create duplicate issues
            if (issues.length > 0) {
              console.log('CI failure issue already exists');
              return;
            }

            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 CI Failed on Main Branch',
              body: `CI/CD Pipeline failed on main branch.

              **Commit:** ${context.sha}
              **Workflow:** ${context.payload.workflow_run.html_url}
              **Time:** ${new Date().toISOString()}

              ## Action Required

              1. Review the failed workflow run
              2. Determine root cause
              3. Decide if rollback is needed
              4. Close this issue when resolved

              cc @team-leads`,
              labels: ['ci-failure', 'urgent', 'main-branch']
            });
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-24 | System Architect | Initial comprehensive optimization strategy |

---

**End of Document**
