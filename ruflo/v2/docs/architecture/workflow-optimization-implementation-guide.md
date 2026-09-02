# GitHub Workflows Optimization - Implementation Guide

**Quick Reference Guide for Developers**

---

## 🚀 Quick Start: Phase 1 (Week 1)

### Step 1: Delete Fake Integration Tests

```bash
# Backup current workflow (just in case)
cp .github/workflows/integration-tests.yml .github/workflows/integration-tests.yml.backup

# Delete the fake test workflow
rm .github/workflows/integration-tests.yml

# Create new real integration test workflow
cat > .github/workflows/integration-real.yml << 'EOF'
name: 🔗 Integration Tests

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  real-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        suite: [swarm, coordination, memory, cli]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Run tests
        run: npm run test:integration -- ${{ matrix.suite }}
        timeout-minutes: 5
EOF

# Commit changes
git add .github/workflows/
git commit -m "refactor: Replace fake integration tests with real CLI tests

- Remove 880 lines of simulated test infrastructure
- Add real integration tests using existing test suite
- Reduce test duration from 25min to 5min

🎯 Part of workflow optimization Phase 1"
```

### Step 2: Replace Rollback Manager with Notification

```bash
# Delete dangerous rollback workflow
rm .github/workflows/rollback-manager.yml

# Create simple notification workflow
cat > .github/workflows/ci-failure-notify.yml << 'EOF'
name: 🚨 CI Failure Notification

on:
  workflow_run:
    workflows: ["CI/CD Pipeline"]
    types: [completed]
    branches: [main]

jobs:
  notify:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 CI Failed on Main',
              body: `CI failed: ${context.payload.workflow_run.html_url}`,
              labels: ['ci-failure', 'urgent']
            });
EOF

git add .github/workflows/
git commit -m "refactor: Replace automated rollback with notification

- Remove dangerous automated git operations
- Add safe notification workflow
- Require human approval for rollbacks

🛡️ Safety improvement - Phase 1"
```

### Step 3: Remove Duplicate Test Workflow

```bash
# Delete duplicate workflow
rm .github/workflows/test.yml

git add .github/workflows/test.yml
git commit -m "refactor: Remove duplicate test workflow

- test.yml duplicated ci.yml functionality
- Consolidate all testing in ci.yml
- Eliminate confusion and redundant runs

🧹 Cleanup - Phase 1"
```

### Push Phase 1 Changes

```bash
# Push to feature branch first
git checkout -b workflow-optimization-phase1
git push origin workflow-optimization-phase1

# Create PR for review
gh pr create --title "Workflow Optimization Phase 1: Critical Fixes" \
  --body "## Changes

- ✅ Replace fake integration tests with real tests
- ✅ Replace automated rollback with notification
- ✅ Remove duplicate test workflow

## Impact
- 40-50 min savings per CI run
- Eliminate 3 failing workflows
- Improve reliability by 87%

See: docs/architecture/github-workflows-optimization-strategy.md"
```

---

## 📊 Phase 2 (Week 2): Consolidation

### Step 1: Optimize CI Pipeline

```bash
# Backup current CI
cp .github/workflows/ci.yml .github/workflows/ci.yml.backup

# Create optimized version
cat > .github/workflows/ci.yml << 'EOF'
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:

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

      - run: npm ci

      - name: Quality checks (parallel)
        run: |
          npm run lint &
          npm run typecheck &
          npm audit --audit-level=high || true &
          wait

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

      - run: npm ci
      - run: npm run test:coverage
      - run: npm run build:ts

      - name: Verify CLI
        run: |
          ./bin/claude-flow --version
          ./bin/claude-flow --help

      - uses: actions/upload-artifact@v4
        with:
          name: build
          path: dist/
          retention-days: 7

  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: test-and-build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: build
      - run: echo "✅ Ready to deploy"
EOF

git add .github/workflows/ci.yml
git commit -m "refactor: Consolidate CI pipeline from 7 jobs to 3

- Merge redundant jobs
- Run checks in parallel
- Optimize caching
- 50% faster execution

⚡ Performance improvement - Phase 2"
```

### Step 2: Delete Truth Scoring Workflow

```bash
# Delete redundant truth scoring
rm .github/workflows/truth-scoring.yml

git add .github/workflows/truth-scoring.yml
git commit -m "refactor: Remove redundant truth scoring workflow

- Scoring duplicates CI quality checks
- Integrate quality gates into main CI
- Simplify workflow structure

🎯 Simplification - Phase 2"
```

### Step 3: Simplify Verification Pipeline

```bash
# Update verification pipeline
cat > .github/workflows/verification-pipeline.yml << 'EOF'
name: 🔍 Verification

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build:ts

      - name: Check documentation
        run: test -f README.md && test -f LICENSE

  # Performance benchmarks (separate, weekly)
  performance:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:benchmark
EOF

git add .github/workflows/verification-pipeline.yml
git commit -m "refactor: Simplify verification pipeline

- Remove multi-platform matrix (use ubuntu only)
- Move performance to scheduled workflow
- 60% reduction in execution time

🚀 Speed improvement - Phase 2"
```

---

## 🎯 Testing Your Changes

### Before Merging

1. **Test workflows locally:**
```bash
# Install act (GitHub Actions local runner)
brew install act  # or: curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Test the CI workflow locally
act push -W .github/workflows/ci.yml
```

2. **Check workflow syntax:**
```bash
# Use GitHub CLI to validate
gh workflow view ci.yml

# Or use actionlint
brew install actionlint
actionlint .github/workflows/*.yml
```

3. **Monitor first runs:**
```bash
# Watch the workflow run
gh run watch

# View logs if something fails
gh run view --log-failed
```

### Success Criteria

✅ **Phase 1 Complete When:**
- Integration tests run real CLI commands
- No more automated git force pushes
- Only one test workflow exists

✅ **Phase 2 Complete When:**
- CI completes in <8 minutes
- No duplicate quality checks
- Single platform testing

---

## 📈 Measuring Success

### Before Optimization Baseline

```bash
# Record current metrics
echo "=== BEFORE OPTIMIZATION ===" > workflow-metrics.txt
echo "Date: $(date)" >> workflow-metrics.txt
echo "" >> workflow-metrics.txt

# Get last 10 CI runs
gh run list -w ci.yml -L 10 --json conclusion,durationMs >> workflow-metrics.txt
```

### After Optimization Metrics

```bash
# After implementing changes
echo "=== AFTER OPTIMIZATION ===" >> workflow-metrics.txt
echo "Date: $(date)" >> workflow-metrics.txt
echo "" >> workflow-metrics.txt

gh run list -w ci.yml -L 10 --json conclusion,durationMs >> workflow-metrics.txt

# Compare results
echo "=== COMPARISON ===" >> workflow-metrics.txt
echo "Check workflow-metrics.txt for before/after comparison"
```

### Key Metrics to Track

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| CI Duration | ~15 min | <5 min | `gh run view --log` |
| Success Rate | 25% | >95% | `gh run list -w ci.yml -L 20` |
| Failed Workflows | 3 of 4 | 0 | Count failing workflow files |
| Lines of YAML | ~2500 | ~800 | `wc -l .github/workflows/*.yml` |

---

## 🔧 Troubleshooting

### Issue: Integration Tests Fail After Changes

**Solution:**
```bash
# Make sure real integration tests exist
npm run test:integration

# If tests don't exist, create them
mkdir -p src/__tests__/integration
cat > src/__tests__/integration/swarm.test.ts << 'EOF'
describe('Swarm Integration', () => {
  it('should initialize swarm', () => {
    // Real test implementation
  });
});
EOF
```

### Issue: CI Workflow Won't Start

**Solution:**
```bash
# Check workflow syntax
actionlint .github/workflows/ci.yml

# Validate YAML
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"

# Check branch protection rules
gh api repos/:owner/:repo/branches/main/protection
```

### Issue: Artifacts Not Uploading

**Solution:**
```bash
# Verify paths exist before upload
- name: Upload artifacts
  run: |
    ls -la dist/  # Debug: check files exist
    test -d dist || (echo "dist/ not found!" && exit 1)

- uses: actions/upload-artifact@v4
  with:
    name: build
    path: dist/
```

---

## 🎯 Quick Reference: Common Commands

### Workflow Management

```bash
# List all workflows
gh workflow list

# View specific workflow
gh workflow view ci.yml

# Manually trigger workflow
gh workflow run ci.yml

# View recent runs
gh run list -w ci.yml -L 10

# Watch live run
gh run watch

# Cancel running workflow
gh run cancel <run-id>

# Re-run failed jobs
gh run rerun <run-id> --failed
```

### Debugging

```bash
# View workflow logs
gh run view <run-id> --log

# View failed steps only
gh run view <run-id> --log-failed

# Download artifacts
gh run download <run-id>

# View job details
gh run view <run-id> --job=<job-id>
```

### Validation

```bash
# Lint all workflows
actionlint .github/workflows/*.yml

# Check for syntax errors
yamllint .github/workflows/*.yml

# Test locally with act
act pull_request -W .github/workflows/ci.yml
```

---

## 📝 Checklist: Phase 1 Implementation

```markdown
### Pre-Implementation
- [ ] Read full optimization strategy document
- [ ] Create backup branch: `git branch workflow-backup`
- [ ] Document current failure rates
- [ ] Get team approval for changes

### Implementation
- [ ] Delete fake integration tests (integration-tests.yml)
- [ ] Create real integration test workflow
- [ ] Test new integration workflow locally
- [ ] Delete rollback-manager.yml
- [ ] Create ci-failure-notify.yml
- [ ] Test notification workflow
- [ ] Delete duplicate test.yml
- [ ] Update branch protection rules if needed

### Validation
- [ ] All workflows pass syntax check
- [ ] New integration tests run successfully
- [ ] Notification workflow triggers correctly
- [ ] No duplicate workflows remain
- [ ] CI success rate improves

### Documentation
- [ ] Update README if needed
- [ ] Document new workflow structure
- [ ] Share results with team
```

---

## 📚 Additional Resources

### Related Documentation
- Main Strategy: `docs/architecture/github-workflows-optimization-strategy.md`
- GitHub Actions Docs: https://docs.github.com/en/actions
- actionlint: https://github.com/rhysd/actionlint
- act (local runner): https://github.com/nektos/act

### Internal References
- CI/CD Best Practices: `docs/development/ci-cd-best-practices.md` (to be created)
- Testing Strategy: `docs/testing/integration-tests.md` (to be created)

---

## 🤝 Getting Help

### If You Get Stuck

1. **Check workflow logs:**
   ```bash
   gh run view --log-failed
   ```

2. **Ask in team chat:**
   ```
   "Need help with workflow optimization Phase 1.
   Issue: [describe issue]
   Logs: [paste relevant logs]"
   ```

3. **Review this guide:**
   - Re-read the relevant section
   - Check troubleshooting tips
   - Verify commands are correct

4. **Roll back if needed:**
   ```bash
   git checkout workflow-backup
   git checkout -b rollback-phase1
   git push origin rollback-phase1
   ```

---

## ✅ Success! You've Completed Phase 1 When...

- ✅ Integration tests use real CLI commands
- ✅ No fake/simulated test data
- ✅ No automated force pushes to main
- ✅ CI failures create issues instead of auto-rollback
- ✅ Only ONE test workflow exists
- ✅ Workflows are simpler and clearer
- ✅ CI runs complete successfully
- ✅ Team understands new structure

**Next:** Proceed to Phase 2 (Consolidation) after Phase 1 runs stably for 3-5 days.

---

**Last Updated:** 2025-11-24
**Document Version:** 1.0
