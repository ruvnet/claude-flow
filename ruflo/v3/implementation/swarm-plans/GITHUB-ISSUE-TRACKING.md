# GitHub Issue Tracking Plan

## Overview

This document defines the **GitHub issue tracking strategy** for the 15-agent swarm implementation of Claude-Flow v3. Agent #1 (Queen Coordinator) manages all issue lifecycle with frequent reply updates from all agents.

---

## Issue Hierarchy

```
GitHub Project: Claude-Flow v3 Implementation
├── Milestone: v3.0.0-alpha.1 (Week 1-2)
│   ├── Epic: Security Foundation
│   │   ├── Issue: CVE-1 Fix - Vulnerable dependencies
│   │   ├── Issue: CVE-2 Fix - Weak password hashing
│   │   └── Issue: CVE-3 Fix - Hardcoded credentials
│   └── Epic: Core Foundation
│       ├── Issue: Orchestrator decomposition
│       └── Issue: Type system modernization
│
├── Milestone: v3.0.0-alpha.5 (Week 3-6)
│   ├── Epic: Memory Unification
│   ├── Epic: Swarm Unification
│   └── Epic: MCP Optimization
│
├── Milestone: v3.0.0-beta.1 (Week 7-10)
│   ├── Epic: agentic-flow Integration
│   ├── Epic: CLI Modernization
│   └── Epic: Neural/Learning Integration
│
└── Milestone: v3.0.0 (Week 11-14)
    ├── Epic: Performance Optimization
    ├── Epic: Test Coverage
    └── Epic: Release Preparation
```

---

## Label System

### Agent Labels
```yaml
labels:
  - name: swarm:queen
    color: "6f42c1"
    description: Queen Coordinator (Agent #1)

  - name: swarm:security
    color: "d73a4a"
    description: Security Domain (Agents #2-4)

  - name: swarm:core
    color: "0075ca"
    description: Core Domain (Agents #5-6)

  - name: swarm:memory
    color: "1d76db"
    description: Memory Specialist (Agent #7)

  - name: swarm:swarm
    color: "0e8a16"
    description: Swarm Specialist (Agent #8)

  - name: swarm:mcp
    color: "5319e7"
    description: MCP Specialist (Agent #9)

  - name: swarm:integration
    color: "fbca04"
    description: Integration (Agents #10-12)

  - name: swarm:tdd
    color: "b60205"
    description: TDD Engineer (Agent #13)

  - name: swarm:performance
    color: "e99695"
    description: Performance Engineer (Agent #14)

  - name: swarm:release
    color: "c5def5"
    description: Release Engineer (Agent #15)
```

### Priority Labels
```yaml
labels:
  - name: priority:critical
    color: "b60205"
    description: Blocking release

  - name: priority:high
    color: "d93f0b"
    description: Must fix before milestone

  - name: priority:medium
    color: "fbca04"
    description: Should fix before release

  - name: priority:low
    color: "0e8a16"
    description: Nice to have
```

### Type Labels
```yaml
labels:
  - name: type:security
    color: "d73a4a"
    description: Security fix

  - name: type:feature
    color: "a2eeef"
    description: New feature

  - name: type:bug
    color: "d73a4a"
    description: Bug fix

  - name: type:refactor
    color: "1d76db"
    description: Code refactoring

  - name: type:test
    color: "0e8a16"
    description: Test-related

  - name: type:docs
    color: "0075ca"
    description: Documentation

  - name: type:perf
    color: "e99695"
    description: Performance improvement
```

### Status Labels
```yaml
labels:
  - name: status:blocked
    color: "b60205"
    description: Blocked by dependency

  - name: status:in-progress
    color: "fbca04"
    description: Currently being worked on

  - name: status:review
    color: "0e8a16"
    description: Ready for review

  - name: status:testing
    color: "1d76db"
    description: In testing phase
```

---

## Issue Templates

### Epic Issue Template

```markdown
---
name: Epic
about: Large feature or initiative tracking
title: "[EPIC] "
labels: ["epic"]
assignees: ''
---

## Epic: [Title]

### Overview
<!-- Brief description of this epic -->

### Scope
<!-- What's included and excluded -->

### Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Child Issues
<!-- Will be auto-populated -->
- [ ] #issue1
- [ ] #issue2

### Agents Assigned
- Primary: Agent #X
- Supporting: Agents #Y, #Z

### Timeline
- Start: Week X
- Target: Week Y

### Dependencies
<!-- Other epics/issues this depends on -->
- Depends on: #epic1
- Blocks: #epic2

---
## Progress Updates
<!-- Agents will add replies below -->
```

### Task Issue Template

```markdown
---
name: Task
about: Individual implementation task
title: "[TASK] "
labels: ["task"]
assignees: ''
---

## Task: [Title]

### Description
<!-- What needs to be done -->

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Technical Details
<!-- Implementation notes, file paths, etc. -->

**Files to modify:**
- `path/to/file1.ts`
- `path/to/file2.ts`

**Related modules:**
- module1
- module2

### Agent Assignment
- Assigned to: Agent #X
- Reviewer: Agent #Y

### TDD Checklist
- [ ] Acceptance test written (failing)
- [ ] Unit tests written (failing)
- [ ] Implementation complete
- [ ] Tests passing
- [ ] Code reviewed
- [ ] Merged

### Definition of Done
- [ ] Code implemented
- [ ] Tests passing (90%+ coverage)
- [ ] Documentation updated
- [ ] PR approved
- [ ] Merged to main

---
## Work Log
<!-- Agent will add progress replies -->
```

---

## Reply Templates

### Hourly Status Update

```markdown
## 🤖 Agent #X Status Update

**Time:** YYYY-MM-DD HH:MM UTC
**Status:** 🟢 Active / 🟡 Blocked / 🔴 Error

### Current Task
Working on: [Brief description]

### Progress
- [x] Completed step 1
- [x] Completed step 2
- [ ] In progress: step 3
- [ ] Pending: step 4

### Metrics
- Files modified: X
- Tests written: X
- Test coverage: X%

### Blockers
<!-- If any -->
- None / Blocked by #issue

### Next Steps
1. Next action 1
2. Next action 2

---
_Reply generated by Agent #X (claude-flow v3 swarm)_
```

### Task Completion Update

```markdown
## ✅ Task Completed: [Task Name]

**Agent:** #X ([Agent Name])
**Duration:** Xh Ym
**Completed:** YYYY-MM-DD HH:MM UTC

### Summary
Brief description of what was accomplished.

### Changes Made
- `path/to/file1.ts`: Description of change
- `path/to/file2.ts`: Description of change

### Test Results
```
Tests: XX passed, X failed
Coverage: XX.X%
```

### Metrics
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Lines of code | XXX | XXX | ±XX |
| Cyclomatic complexity | X.X | X.X | ±X.X |
| Test coverage | XX% | XX% | ±X% |

### PR Link
#PR-XXX

### Follow-up Items
- [ ] Related task 1 (#XXX)
- [ ] Related task 2 (#XXX)

---
_Task completed by Agent #X_
```

### Blocker Report

```markdown
## 🚫 Blocked: [Brief Description]

**Agent:** #X ([Agent Name])
**Blocked Since:** YYYY-MM-DD HH:MM UTC
**Severity:** 🔴 Critical / 🟠 High / 🟡 Medium

### Blocking Issue
Description of what's blocking progress.

### Dependencies
- Waiting on: #issue-XXX (Agent #Y)
- Required: [Resource/approval/information]

### Impact
- Delays: [What will be delayed]
- Affected agents: #A, #B, #C

### Workarounds Attempted
1. Attempted workaround 1 - Result
2. Attempted workaround 2 - Result

### Requested Action
- [ ] @agent-Y: Please complete #issue-XXX
- [ ] @queen: Escalate if not resolved by [time]

---
_Blocker reported by Agent #X_
```

### Daily Summary (Queen Coordinator)

```markdown
## 📊 Daily Swarm Summary

**Date:** YYYY-MM-DD
**Swarm Status:** 🟢 Healthy / 🟡 Degraded / 🔴 Critical

### Agent Activity

| Agent | Status | Tasks Completed | Current Task |
|-------|--------|-----------------|--------------|
| #1 Queen | 🟢 Active | 3 | Coordination |
| #2 Security Arch | 🟢 Active | 2 | CVE-2 Review |
| #3 Security Impl | 🟡 Blocked | 1 | Waiting on #2 |
| ... | ... | ... | ... |
| #15 Release | 🟢 Active | 1 | CI/CD Setup |

### Milestone Progress

**v3.0.0-alpha.1** (Week 1-2)
```
[████████░░░░░░░░░░░░] 40% Complete
```

- Security Foundation: 3/5 tasks ✅
- Core Foundation: 1/4 tasks ✅

### Today's Achievements
1. ✅ CVE-1 fix completed (#XXX)
2. ✅ Orchestrator decomposition plan approved (#XXX)
3. ✅ TDD test harness initialized (#XXX)

### Active Blockers
- 🚫 #XXX: Agent #3 waiting on security review
- 🚫 #XXX: Agent #7 needs clarification on AgentDB API

### Tomorrow's Priorities
1. Complete CVE-2 fix
2. Begin orchestrator implementation
3. Resolve Agent #7 blocker

### Metrics
- Total commits today: XX
- Tests added: XX
- Coverage change: +X.X%
- Issues closed: X
- Issues opened: X

---
_Daily summary by Queen Coordinator (Agent #1)_
```

---

## Automation Scripts

### Issue Creation Script

```typescript
// scripts/create-swarm-issues.ts
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

interface IssueConfig {
  title: string;
  body: string;
  labels: string[];
  milestone: number;
  assignees: string[];
}

async function createEpic(config: IssueConfig): Promise<number> {
  const { data } = await octokit.issues.create({
    owner: 'anthropic',
    repo: 'claude-flow',
    ...config,
    labels: [...config.labels, 'epic']
  });
  return data.number;
}

async function createTask(
  epicNumber: number,
  config: IssueConfig
): Promise<number> {
  const body = `${config.body}\n\n**Parent Epic:** #${epicNumber}`;

  const { data } = await octokit.issues.create({
    owner: 'anthropic',
    repo: 'claude-flow',
    ...config,
    body,
    labels: [...config.labels, 'task']
  });

  // Update epic with child reference
  await addChildToEpic(epicNumber, data.number);

  return data.number;
}

// Create all v3 issues
async function initializeV3Issues() {
  // Create milestones
  const alpha1 = await createMilestone('v3.0.0-alpha.1', 'Week 1-2');
  const alpha5 = await createMilestone('v3.0.0-alpha.5', 'Week 3-6');
  const beta1 = await createMilestone('v3.0.0-beta.1', 'Week 7-10');
  const release = await createMilestone('v3.0.0', 'Week 11-14');

  // Create Security Epic
  const securityEpic = await createEpic({
    title: '[EPIC] Security Foundation',
    body: SECURITY_EPIC_TEMPLATE,
    labels: ['swarm:security', 'priority:critical'],
    milestone: alpha1,
    assignees: ['agent-2', 'agent-3', 'agent-4']
  });

  // Create security tasks
  await createTask(securityEpic, {
    title: '[TASK] CVE-1 Fix: Update vulnerable dependencies',
    body: CVE1_TASK_TEMPLATE,
    labels: ['swarm:security', 'type:security', 'priority:critical'],
    milestone: alpha1,
    assignees: ['agent-3']
  });

  // ... more tasks
}
```

### Reply Automation

```typescript
// scripts/agent-reply.ts
import { Octokit } from '@octokit/rest';

interface ReplyContext {
  issueNumber: number;
  agentId: number;
  agentName: string;
  type: 'status' | 'completion' | 'blocker' | 'daily';
  data: any;
}

async function postAgentReply(context: ReplyContext): Promise<void> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const body = generateReplyBody(context);

  await octokit.issues.createComment({
    owner: 'anthropic',
    repo: 'claude-flow',
    issue_number: context.issueNumber,
    body
  });

  // Update issue labels if needed
  if (context.type === 'completion') {
    await octokit.issues.update({
      owner: 'anthropic',
      repo: 'claude-flow',
      issue_number: context.issueNumber,
      state: 'closed'
    });
  } else if (context.type === 'blocker') {
    await octokit.issues.addLabels({
      owner: 'anthropic',
      repo: 'claude-flow',
      issue_number: context.issueNumber,
      labels: ['status:blocked']
    });
  }
}

function generateReplyBody(context: ReplyContext): string {
  switch (context.type) {
    case 'status':
      return STATUS_TEMPLATE
        .replace('{{agent}}', `#${context.agentId}`)
        .replace('{{time}}', new Date().toISOString())
        .replace('{{status}}', context.data.status)
        .replace('{{progress}}', formatProgress(context.data.progress));

    case 'completion':
      return COMPLETION_TEMPLATE
        .replace('{{agent}}', `#${context.agentId}`)
        .replace('{{summary}}', context.data.summary)
        .replace('{{metrics}}', formatMetrics(context.data.metrics));

    case 'blocker':
      return BLOCKER_TEMPLATE
        .replace('{{agent}}', `#${context.agentId}`)
        .replace('{{description}}', context.data.description)
        .replace('{{dependencies}}', formatDependencies(context.data.deps));

    case 'daily':
      return DAILY_TEMPLATE
        .replace('{{date}}', new Date().toISOString().split('T')[0])
        .replace('{{agentTable}}', formatAgentTable(context.data.agents))
        .replace('{{progress}}', formatMilestoneProgress(context.data.milestone));
  }
}
```

### GitHub Action for Automated Replies

```yaml
# .github/workflows/swarm-updates.yml
name: Swarm Status Updates

on:
  schedule:
    - cron: '0 * * * *'  # Hourly
  workflow_dispatch:

jobs:
  status-update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Collect agent status
        id: status
        run: |
          # Query swarm status
          STATUS=$(npx claude-flow swarm status --json)
          echo "status=$STATUS" >> $GITHUB_OUTPUT

      - name: Post hourly updates
        uses: actions/github-script@v7
        with:
          script: |
            const status = JSON.parse('${{ steps.status.outputs.status }}');

            for (const agent of status.agents) {
              if (agent.currentIssue) {
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: agent.currentIssue,
                  body: generateStatusUpdate(agent)
                });
              }
            }

  daily-summary:
    runs-on: ubuntu-latest
    if: github.event.schedule == '0 0 * * *'  # Daily at midnight
    steps:
      - uses: actions/checkout@v4

      - name: Generate daily summary
        run: npx claude-flow swarm summary --daily > summary.md

      - name: Post to tracking issue
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const summary = fs.readFileSync('summary.md', 'utf8');

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: ${{ env.TRACKING_ISSUE }},
              body: summary
            });
```

---

## Issue Workflow

```
                        Issue Lifecycle
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   ┌──────────┐     ┌───────────┐     ┌──────────┐      │
    │   │  Open    │────►│ Assigned  │────►│ Active   │      │
    │   │          │     │           │     │          │      │
    │   └──────────┘     └───────────┘     └────┬─────┘      │
    │        │                                   │            │
    │        │                    ┌──────────────┼────────┐   │
    │        │                    │              │        │   │
    │        ▼                    ▼              ▼        ▼   │
    │   ┌──────────┐     ┌───────────┐     ┌──────────┐      │
    │   │ Blocked  │◄───►│  Review   │────►│  Closed  │      │
    │   │          │     │           │     │          │      │
    │   └──────────┘     └───────────┘     └──────────┘      │
    │                                                         │
    └─────────────────────────────────────────────────────────┘

    Status Labels:
    - Open: No label
    - Assigned: status:assigned
    - Active: status:in-progress
    - Blocked: status:blocked
    - Review: status:review
    - Closed: (closed state)
```

---

## Metrics & Reporting

### Weekly Metrics Dashboard

```markdown
## 📈 Weekly Swarm Metrics

**Week:** X of 14
**Sprint:** v3.0.0-alpha.X

### Velocity
| Metric | This Week | Last Week | Trend |
|--------|-----------|-----------|-------|
| Issues Closed | XX | XX | ↑ XX% |
| PRs Merged | XX | XX | ↓ XX% |
| Commits | XXX | XXX | → 0% |

### Coverage Progress
```
Week 1: [████░░░░░░] 40%
Week 2: [██████░░░░] 60%
Week 3: [████████░░] 80% ← Current
```

### Agent Performance
| Agent | Tasks Completed | Avg Completion Time | Blockers |
|-------|-----------------|---------------------|----------|
| #1 Queen | 15 | N/A (coordination) | 0 |
| #2 Security Arch | 8 | 4.2h | 1 |
| #3 Security Impl | 12 | 2.8h | 2 |
| ... | ... | ... | ... |

### Burndown
```
Remaining: ████████████████████░░░░ 80 tasks
Completed: ░░░░░░░░░░░░░░░░░░░░████ 20 tasks
```

### Risk Items
- 🔴 Security fixes behind schedule
- 🟡 Memory unification complexity higher than estimated
- 🟢 Core refactoring on track
```

---

## Related Documents

- [SWARM-OVERVIEW.md](./SWARM-OVERVIEW.md) - 15-agent swarm plan
- [AGENT-SPECIFICATIONS.md](./AGENT-SPECIFICATIONS.md) - Agent details
- [TDD-LONDON-SCHOOL-PLAN.md](./TDD-LONDON-SCHOOL-PLAN.md) - TDD methodology
- [DEPLOYMENT-PLAN.md](./DEPLOYMENT-PLAN.md) - Release strategy
