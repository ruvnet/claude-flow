# @claude-flow/claims

[![npm version](https://img.shields.io/npm/v/@claude-flow/claims.svg)](https://www.npmjs.com/package/@claude-flow/claims)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/claims.svg)](https://www.npmjs.com/package/@claude-flow/claims)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Issue claiming and work coordination for human-agent collaboration.**

## What is this?

This package provides a complete system for coordinating work between humans and AI agents:

- **Issue Claiming** - Claim issues to work on, preventing conflicts
- **Handoffs** - Transfer work between humans and agents seamlessly
- **Work Stealing** - Automatically reassign stalled work
- **Load Balancing** - Distribute work evenly across agents

## Installation

```bash
npm install @claude-flow/claims
```

Or install via Claude Flow CLI:

```bash
npx claude-flow plugins install @claude-flow/claims
```

---

## Quick Start

### Claim an Issue

```typescript
import { ClaimsService } from '@claude-flow/claims';

const claims = new ClaimsService();

// Human claims an issue
await claims.claim({
  issueId: 'ISSUE-123',
  claimant: 'human:alice',
  context: 'Working on the authentication fix'
});

// Agent claims an issue
await claims.claim({
  issueId: 'ISSUE-456',
  claimant: 'agent:coder-1:coder',
  context: 'Implementing new feature'
});
```

### Release a Claim

```typescript
await claims.release({
  issueId: 'ISSUE-123',
  claimant: 'human:alice',
  reason: 'Completed the work'
});
```

### Handoff Between Human and Agent

```typescript
// Human hands off to agent
await claims.handoff({
  issueId: 'ISSUE-123',
  from: 'human:alice',
  to: 'agent:coder-1:coder',
  reason: 'Need AI to continue implementation',
  progress: 40
});

// Agent accepts handoff
await claims.acceptHandoff({
  issueId: 'ISSUE-123',
  claimant: 'agent:coder-1:coder'
});
```

### Update Claim Status

```typescript
await claims.updateStatus({
  issueId: 'ISSUE-123',
  status: 'review-requested',
  progress: 80,
  note: 'Ready for code review'
});
```

---

## MCP Tools (17 Tools)

### Core Claiming (7 tools)

| Tool | Description |
|------|-------------|
| `claims_claim` | Claim an issue for work |
| `claims_release` | Release a claimed issue |
| `claims_handoff` | Request handoff to another claimant |
| `claims_accept-handoff` | Accept a pending handoff |
| `claims_status` | Update claim status |
| `claims_list` | List claims by criteria |
| `claims_board` | Visual board view of all claims |

### Work Stealing (4 tools)

| Tool | Description |
|------|-------------|
| `claims_mark-stealable` | Mark issue as available for stealing |
| `claims_steal` | Steal a stealable issue |
| `claims_stealable` | List all stealable issues |
| `claims_contest-steal` | Contest a steal attempt |

### Load Balancing (3 tools)

| Tool | Description |
|------|-------------|
| `claims_load` | Get agent load information |
| `claims_rebalance` | Suggest or apply load rebalancing |
| `claims_swarm-overview` | Overview of swarm workload |

### Additional (3 tools)

| Tool | Description |
|------|-------------|
| `claims_history` | Get claim history for an issue |
| `claims_metrics` | Get claiming metrics |
| `claims_config` | Get/set claims configuration |

---

## Claim Statuses

| Status | Description |
|--------|-------------|
| `active` | Currently being worked on |
| `paused` | Temporarily paused |
| `blocked` | Blocked by external dependency |
| `review-requested` | Ready for review |
| `handoff-pending` | Handoff requested, awaiting acceptance |
| `stealable` | Available for other agents to take |
| `completed` | Work finished |

---

## Work Stealing

When work stalls, issues can be marked as stealable:

```typescript
// Mark issue as stealable
await claims.markStealable({
  issueId: 'ISSUE-123',
  reason: 'overloaded',
  preferredTypes: ['coder', 'reviewer'],
  context: 'Need someone to continue the implementation'
});

// Another agent steals the issue
await claims.steal({
  issueId: 'ISSUE-123',
  stealer: 'agent:coder-2:coder'
});
```

### Steal Reasons

- `timeout` - Work has been idle too long
- `overloaded` - Current owner has too much work
- `blocked` - Work is blocked and owner can't proceed
- `voluntary` - Owner voluntarily releasing
- `rebalancing` - System rebalancing workload
- `abandoned` - Owner is no longer available

---

## Load Balancing

Automatically distribute work across agents:

```typescript
// Get current agent loads
const loads = await claims.getAgentLoads();

// Preview rebalancing suggestions
const suggestions = await claims.rebalance({ dryRun: true });

// Apply rebalancing
await claims.rebalance({
  dryRun: false,
  targetUtilization: 0.7
});
```

---

## Event Sourcing

All claim operations are event-sourced (ADR-007):

```typescript
// Events emitted
- ClaimCreated
- ClaimReleased
- ClaimStatusUpdated
- HandoffRequested
- HandoffAccepted
- HandoffRejected
- ClaimMarkedStealable
- ClaimStolen
- ClaimContested
```

---

## CLI Commands

```bash
# Claim an issue
npx claude-flow claims claim --issue ISSUE-123 --claimant "human:alice"

# Release a claim
npx claude-flow claims release --issue ISSUE-123

# View claims board
npx claude-flow claims board

# List stealable issues
npx claude-flow claims stealable

# Rebalance workload
npx claude-flow claims rebalance --dry-run
```

---

## Configuration

```yaml
# claude-flow.config.yaml
claims:
  autoExpiration:
    enabled: true
    idleTimeout: 3600000  # 1 hour
    checkInterval: 300000  # 5 minutes
  workStealing:
    enabled: true
    contestWindow: 30000  # 30 seconds
  loadBalancing:
    targetUtilization: 0.7
    maxIssuesPerAgent: 5
```

---

## License

MIT
