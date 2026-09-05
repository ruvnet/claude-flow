/**
 * @claude-flow/codex - AGENTS.md Generator
 *
 * Generates AGENTS.md files for OpenAI Codex CLI
 * Following the Agentic AI Foundation standard
 */

import type { AgentsMdOptions, AgentsMdTemplate } from '../types.js';
import { BUILT_IN_SKILLS } from '../templates/index.js';

function concurrentRufloWorkflow(): string {
  return `## Ruflo + Codex Automated Workflow

Ruflo is the coordination ledger and policy decision point; Codex workers execute code, tests, and commands. A Ruflo coordination call records work but never replaces implementation.

Use \`guidance_brain({ mode: "recommend", task: "..." })\` when the task can
benefit from Ruflo-specific capabilities. Its live registry is authoritative
for tool presence; registration alone does not prove configuration,
reachability, health, or authorization. If it is not registered, use compatible
\`guidance_recommend\`, CLI discovery, and repository instructions.

1. **Recall** — search AgentDB memory and relevant ADRs for patterns and constraints.
2. **Inspect** — read source, runtime, dependency, policy, and health state.
3. **Route** — choose the smallest capable topology, agents, skills, and tools.
4. **Plan** — define acceptance criteria, safety envelope, ownership, and validation.
5. **Execute** — Codex workers implement in isolated scopes; Ruflo records coordination.
6. **Test** — run focused tests, regression tests, and failure-path checks.
7. **Validate** — check types, security, policy, compatibility, and artifact integrity.
8. **Benchmark** — compare a source-bound candidate with a source-bound baseline.
9. **Optimize** — improve measured bottlenecks without weakening the safety envelope.
10. **Receipt** — bind claims, evidence, and decisions to exact source/build inputs.
11. **Handoff** — reconcile concurrent work and disclose unresolved limitations.
12. **Publish** — only an independently authorized release gate may publish immutable artifacts.

### Concurrency and authority invariants

- Never allow two writers in one worktree.
- Read-only research agents may share a checkout; writing agents may not.
- A child may drop capabilities but can never add tools, servers, namespaces, network access, spend, concurrency, or delegation depth.
- Cancel dependent and not-yet-started sibling work when policy denies an action or a required dependency fails.
- MetaHarness may benchmark candidates concurrently, but it cannot promote, serve, or expand its own SafetyEnvelope.
- Only the integration agent changes shared manifests or lockfiles.
- Do not auto-commit, push, merge, release, or delete worktrees unless the user authorized that operation.
- Every consequential action must produce a policy decision receipt; production, destructive, spend, and promotion actions may require human approval.

### Repository harness adapter

When tracked repository instructions define a local collaboration harness:

1. Assign the isolated worktree before starting a writing session.
2. Start or register the session, inspect current claims, and acquire only the
   exact paths, resources, and development ports needed for the task.
3. Renew leases during long work, check acknowledged inbox messages at integration
   boundaries, and release claims when handing off or ending.
4. Record focused and integration evidence against the exact source state,
   then let the designated integration owner decide release.

A repository lease coordinates ownership; it does not grant authorization.
In-memory reference adapters demonstrate semantics but are not distributed,
restart-durable release authorities.
The worker still needs the current ADR-324/325 action capability and fencing
epoch for every protected side effect. Heartbeat and lease expiry establish
liveness; a PID is diagnostic only. HEAD alone is not an exact source-state
identity when tracked or untracked changes exist, so a release receipt must
bind a clean commit or an immutable snapshot including those changes.
`;
}

/**
 * Generate an AGENTS.md file based on the provided options
 */
export async function generateAgentsMd(options: AgentsMdOptions): Promise<string> {
  const template = options.template ?? 'default';

  switch (template) {
    case 'minimal':
      return generateMinimal(options);
    case 'full':
      return generateFull(options);
    case 'enterprise':
      return generateEnterprise(options);
    case 'default':
    default:
      return generateDefault(options);
  }
}

/**
 * Generate minimal AGENTS.md template
 */
function generateMinimal(options: AgentsMdOptions): string {
  const {
    projectName,
    description = 'A Claude Flow powered project',
    buildCommand = 'npm run build',
    testCommand = 'npm test',
  } = options;

  return `# ${projectName}

> ${description}

## Quick Start

### Setup
\`\`\`bash
npm install && ${buildCommand}
\`\`\`

### Test
\`\`\`bash
${testCommand}
\`\`\`

## Agent Behavior

### Code Standards
- Keep files under 500 lines
- No hardcoded secrets or credentials
- Validate input at system boundaries
- Use typed interfaces for public APIs

### File Organization
- \`/src\` - Source code files
- \`/tests\` - Test files
- \`/docs\` - Documentation
- \`/config\` - Configuration files

## Skills

| Skill | Purpose |
|-------|---------|
| \`$swarm-orchestration\` | Multi-agent coordination for complex tasks |
| \`$memory-management\` | Pattern storage and semantic search |

## Security Rules

- NEVER commit .env files or secrets
- Always validate user inputs
- Prevent directory traversal attacks
- Use parameterized queries for databases
- Sanitize output to prevent XSS

${concurrentRufloWorkflow()}

## Links

- Documentation: https://github.com/ruvnet/ruflo
`;
}

/**
 * Generate default AGENTS.md template
 */
function generateDefault(options: AgentsMdOptions): string {
  const {
    projectName,
    description = 'A Claude Flow powered project',
    techStack = 'TypeScript, Node.js',
    buildCommand = 'npm run build',
    testCommand = 'npm test',
    devCommand = 'npm run dev',
    skills = ['swarm-orchestration', 'memory-management', 'sparc-methodology', 'security-audit'],
  } = options;

  const skillsTable = skills
    .map((skill) => {
      const info = BUILT_IN_SKILLS[skill as keyof typeof BUILT_IN_SKILLS];
      return info
        ? `| \`$${skill}\` | ${info.description} |`
        : `| \`$${skill}\` | Custom skill |`;
    })
    .join('\n');

  return `# ${projectName}

> Multi-agent orchestration framework for agentic coding

## Project Overview

${description}

**Tech Stack**: ${techStack}
**Architecture**: Domain-Driven Design with bounded contexts

## Quick Start

### Installation
\`\`\`bash
npm install
\`\`\`

### Build
\`\`\`bash
${buildCommand}
\`\`\`

### Test
\`\`\`bash
${testCommand}
\`\`\`

### Development
\`\`\`bash
${devCommand}
\`\`\`

## Agent Coordination

### Swarm Configuration

This project uses hierarchical swarm coordination for complex tasks:

| Setting | Value | Purpose |
|---------|-------|---------|
| Topology | \`hierarchical\` | Queen-led coordination (anti-drift) |
| Max Agents | 8 | Optimal team size |
| Strategy | \`specialized\` | Clear role boundaries |
| Consensus | \`raft\` | Leader-based consistency |

### When to Use Swarms

**Invoke swarm for:**
- Multi-file changes (3+ files)
- New feature implementation
- Cross-module refactoring
- API changes with tests
- Security-related changes
- Performance optimization

**Skip swarm for:**
- Single file edits
- Simple bug fixes (1-2 lines)
- Documentation updates
- Configuration changes

### Available Skills

Use \`$skill-name\` syntax to invoke:

| Skill | Use Case |
|-------|----------|
${skillsTable}

### Agent Types

| Type | Role | Use Case |
|------|------|----------|
| \`researcher\` | Requirements analysis | Understanding scope |
| \`architect\` | System design | Planning structure |
| \`coder\` | Implementation | Writing code |
| \`tester\` | Test creation | Quality assurance |
| \`reviewer\` | Code review | Security and quality |

## Execution Model

- **claude-flow** = LEDGER (coordinates: memory, routing, swarm state)
- **Codex** = EXECUTOR (writes code, runs tests, creates files)

**Critical rule:** DON'T STOP after calling claude-flow commands. Coordination commands return instantly — continue immediately with the next implementation step.

${concurrentRufloWorkflow()}

## MCP Integration

Use MCP tools for coordination, then keep coding:

| Tool | Purpose | Example |
|------|---------|---------|
| \`swarm_init\` | Start coordination | \`swarm_init({topology: "hierarchical"})\` |
| \`memory_store\` | Save patterns | \`memory_store({key: "auth", value: "JWT"})\` |
| \`memory_search\` | Find patterns | \`memory_search({query: "auth patterns"})\` |
| \`task_orchestrate\` | Assign work | \`task_orchestrate({task: "implement"})\` |

## Code Standards

### File Organization
- **NEVER** save to root folder
- \`/src\` - Source code files
- \`/tests\` - Test files
- \`/docs\` - Documentation
- \`/config\` - Configuration files

### Quality Rules
- Files under 500 lines
- No hardcoded secrets
- Input validation at boundaries
- Typed interfaces for public APIs
- TDD London School (mock-first) preferred

### Commit Messages
\`\`\`
<type>(<scope>): <description>

[optional body]
\`\`\`

Types: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`chore\`

Do not add a \`Co-Authored-By\` trailer unless the repository explicitly
configures and authorizes that attribution.

## Security

### Critical Rules
- NEVER commit secrets, credentials, or .env files
- NEVER hardcode API keys
- Always validate user input
- Use parameterized queries for SQL
- Sanitize output to prevent XSS

### Path Security
- Validate all file paths
- Prevent directory traversal (../)
- Use absolute paths internally

## Memory System

### Storing Patterns
\`\`\`bash
npx @claude-flow/cli memory store \\
  --key "pattern-name" \\
  --value "pattern description" \\
  --namespace patterns
\`\`\`

### Searching Memory
\`\`\`bash
npx @claude-flow/cli memory search \\
  --query "search terms" \\
  --namespace patterns
\`\`\`

## Quick Commands

\`\`\`bash
npx @claude-flow/cli memory search --query "relevant patterns"
npx @claude-flow/cli hooks route --task "current task description"
npx @claude-flow/cli swarm init --topology hierarchical
npx @claude-flow/cli hooks pre-task --description "task summary"
\`\`\`

## Links

- Documentation: https://github.com/ruvnet/ruflo
- Issues: https://github.com/ruvnet/ruflo/issues
`;
}

/**
 * Generate full AGENTS.md template with all sections
 */
function generateFull(options: AgentsMdOptions): string {
  const base = generateDefault(options);

  const additionalSections = `
## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| HNSW Search | 150x-12,500x faster | Vector operations |
| Memory Reduction | 50-75% | Int8 quantization |
| MCP Response | <100ms | API latency |
| CLI Startup | <500ms | Cold start |
| SONA Adaptation | <0.05ms | Neural learning |

## Testing

### Running Tests
\`\`\`bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Coverage
npm run test:coverage

# Security tests
npm run test:security
\`\`\`

### Test Philosophy
- TDD London School (mock-first)
- Unit tests for business logic
- Integration tests for boundaries
- E2E tests for critical paths
- Security tests for sensitive operations

### Coverage Requirements
- Minimum 80% line coverage
- 100% coverage for security-critical code
- All public APIs must have tests

## MCP Integration

Claude Flow exposes tools via Model Context Protocol:

\`\`\`bash
# Start MCP server
npx ruflo mcp start

# List available tools
npx ruflo mcp tools
\`\`\`

### Available Tools

| Tool | Purpose | Example |
|------|---------|---------|
| \`swarm_init\` | Initialize swarm coordination | \`swarm_init({topology: "hierarchical"})\` |
| \`agent_spawn\` | Spawn new agents | \`agent_spawn({type: "coder", name: "dev-1"})\` |
| \`memory_store\` | Store in AgentDB | \`memory_store({key: "pattern", value: "..."})\` |
| \`memory_search\` | Semantic search | \`memory_search({query: "auth patterns"})\` |
| \`task_orchestrate\` | Task coordination | \`task_orchestrate({task: "implement feature"})\` |
| \`neural_train\` | Train neural patterns | \`neural_train({iterations: 10})\` |
| \`benchmark_run\` | Performance benchmarks | \`benchmark_run({type: "all"})\` |

## Hooks System

Claude Flow uses hooks for lifecycle automation:

### Core Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| \`pre-task\` | Before task starts | Get context, load patterns |
| \`post-task\` | After task completes | Record completion, train |
| \`pre-edit\` | Before file changes | Validate, backup |
| \`post-edit\` | After file changes | Train patterns, verify |
| \`pre-command\` | Before shell commands | Security check |
| \`post-command\` | After shell commands | Log results |

### Session Hooks

| Hook | Purpose |
|------|---------|
| \`session-start\` | Initialize context, load memory |
| \`session-end\` | Export metrics, consolidate memory |
| \`session-restore\` | Resume from checkpoint |
| \`notify\` | Send notifications |

### Intelligence Hooks

| Hook | Purpose |
|------|---------|
| \`route\` | Route task to appropriate agents |
| \`explain\` | Generate explanations |
| \`pretrain\` | Pre-train neural patterns |
| \`build-agents\` | Build specialized agents |
| \`transfer\` | Transfer learning between domains |

### Example Usage
\`\`\`bash
# Before starting a task
npx @claude-flow/cli hooks pre-task \\
  --description "implementing authentication"

# After completing a task
npx @claude-flow/cli hooks post-task \\
  --task-id "task-123" \\
  --success true

# Route a task to agents
npx @claude-flow/cli hooks route \\
  --task "implement OAuth2 login flow"
\`\`\`

## Background Workers

12 background workers provide continuous optimization:

| Worker | Priority | Purpose |
|--------|----------|---------|
| \`ultralearn\` | normal | Deep knowledge acquisition |
| \`optimize\` | high | Performance optimization |
| \`consolidate\` | low | Memory consolidation |
| \`predict\` | normal | Predictive preloading |
| \`audit\` | critical | Security analysis |
| \`map\` | normal | Codebase mapping |
| \`preload\` | low | Resource preloading |
| \`deepdive\` | normal | Deep code analysis |
| \`document\` | normal | Auto-documentation |
| \`refactor\` | normal | Refactoring suggestions |
| \`benchmark\` | normal | Performance benchmarking |
| \`testgaps\` | normal | Test coverage analysis |

### Managing Workers
\`\`\`bash
# List workers
npx @claude-flow/cli hooks worker list

# Trigger specific worker
npx @claude-flow/cli hooks worker dispatch --trigger audit

# Check worker status
npx @claude-flow/cli hooks worker status
\`\`\`

## Intelligence System

The RuVector Intelligence System provides neural learning:

### Components
- **SONA**: Self-Optimizing Neural Architecture (<0.05ms adaptation)
- **MoE**: Mixture of Experts for specialized routing
- **HNSW**: Hierarchical Navigable Small World for fast search
- **EWC++**: Elastic Weight Consolidation (prevents forgetting)
- **Flash Attention**: Optimized attention mechanism

### 4-Step Pipeline
1. **RETRIEVE** - Fetch relevant patterns via HNSW
2. **JUDGE** - Evaluate with verdicts (success/failure)
3. **DISTILL** - Extract key learnings via LoRA
4. **CONSOLIDATE** - Prevent catastrophic forgetting via EWC++

## Debugging

### Log Levels
\`\`\`bash
# Set log level
export CLAUDE_FLOW_LOG_LEVEL=debug

# Enable verbose mode
npx @claude-flow/cli --verbose <command>
\`\`\`

### Health Checks
\`\`\`bash
# Run diagnostics
npx @claude-flow/cli doctor --fix

# Check system status
npx @claude-flow/cli status
\`\`\`
`;

  return base + additionalSections;
}

/**
 * Generate enterprise AGENTS.md template with governance
 */
function generateEnterprise(options: AgentsMdOptions): string {
  const full = generateFull(options);

  const enterpriseSections = `
## Governance

### Approval Workflow
All significant changes require:
1. Code review by designated reviewer
2. Security scan passing
3. Test coverage > 80%
4. Documentation update
5. Change request ticket linked

### Change Classification

| Class | Approval | Review Time | Examples |
|-------|----------|-------------|----------|
| Standard | Auto | <1 hour | Bug fixes, docs, config |
| Normal | 1 reviewer | <4 hours | Features, refactoring |
| Major | 2 reviewers | <24 hours | Architecture, security |
| Emergency | Skip + post-review | Immediate | Production hotfix |

### Audit Trail
All agent actions are logged to:
- \`/logs/agent-actions.log\` - Local file log
- \`/logs/audit.json\` - Structured JSON log
- Central audit system (if configured via AUDIT_ENDPOINT)

\`\`\`bash
# View recent agent actions
npx @claude-flow/cli logs --type agent-actions --last 1h

# Export audit log
npx @claude-flow/cli logs export --format json --output audit.json
\`\`\`

### Compliance

#### SOC2 Controls
- All actions timestamped with actor ID
- Immutable audit log retention (90 days minimum)
- Access control for sensitive operations
- Automated security scanning

#### GDPR Data Handling
- PII detection and masking in logs
- Data minimization in memory storage
- Right to erasure support in AgentDB
- Cross-border transfer controls

#### PCI-DSS (if applicable)
- No storage of card data in agent memory
- Encrypted communication for sensitive data
- Access logging for cardholder data operations
- Quarterly security reviews

### Role-Based Access Control (RBAC)

| Role | Permissions |
|------|-------------|
| Developer | Read, write source code, run tests |
| Lead | Developer + approve PRs, deploy to staging |
| Admin | Lead + deploy to production, manage config |
| Security | Audit logs, security scans, CVE remediation |
| Observer | Read-only access to logs and metrics |

\`\`\`bash
# Check current role
npx @claude-flow/cli claims list

# Request elevated permissions
npx @claude-flow/cli claims request --permission deploy:production
\`\`\`

## Service Level Agreements (SLAs)

### Agent Response Times

| Operation | Target | Max | Escalation |
|-----------|--------|-----|------------|
| Code generation | <5s | 30s | Alert on-call |
| Memory search | <100ms | 500ms | Log warning |
| Security scan | <60s | 5min | Queue retry |
| Test execution | <2min | 10min | Split test suite |

### Availability Targets
- Agent availability: 99.9% uptime
- Memory system: 99.99% availability
- MCP server: 99.5% uptime

## Incident Response

### Severity Levels

| Level | Description | Response Time | Notification |
|-------|-------------|---------------|--------------|
| P1 | Production down | <15 min | Page on-call |
| P2 | Major feature broken | <1 hour | Slack alert |
| P3 | Minor issue | <4 hours | Email |
| P4 | Cosmetic/docs | Next sprint | Ticket |

### On Security Issue
1. **Contain** - Immediately stop affected agents
   \`\`\`bash
   npx @claude-flow/cli agent stop --all --force
   \`\`\`
2. **Isolate** - Quarantine compromised resources
3. **Document** - Record timeline in incident log
4. **Notify** - Alert security team via configured channel
5. **Remediate** - Apply fix with expedited review
6. **Review** - Post-incident analysis within 48 hours

### On Production Bug
1. **Assess** - Determine impact and scope
2. **Decide** - Roll back if safe, or forward-fix
   \`\`\`bash
   # Rollback
   npx @claude-flow/cli deployment rollback --env production

   # Or forward-fix
   npx @claude-flow/cli workflow run hotfix
   \`\`\`
3. **Document** - Capture reproduction steps
4. **Fix** - Create hotfix on dedicated branch
5. **Validate** - Full regression test suite
6. **Deploy** - With expedited review process

### Communication Templates

\`\`\`markdown
# Incident Started
**Status**: Investigating
**Impact**: [Brief description]
**Started**: [Timestamp]
**Next Update**: [ETA]

# Incident Resolved
**Status**: Resolved
**Impact**: [Summary]
**Duration**: [Time]
**Root Cause**: [Brief description]
**Prevention**: [Actions taken]
\`\`\`

## Disaster Recovery

### Backup Strategy
- **Memory DB**: Hourly snapshots, 7-day retention
- **Configuration**: Version controlled, immutable
- **Agent State**: Checkpoint every 10 tasks

### Recovery Procedures
\`\`\`bash
# Restore from backup
npx @claude-flow/cli memory restore --snapshot latest

# Restore specific checkpoint
npx @claude-flow/cli session restore --checkpoint <id>
\`\`\`

### Recovery Time Objectives
| Component | RTO | RPO |
|-----------|-----|-----|
| Memory DB | <1 hour | <1 hour |
| Agent State | <15 min | <10 tasks |
| Configuration | <5 min | 0 (git) |

## Monitoring & Alerting

### Key Metrics
- Agent task completion rate
- Average response latency
- Error rate by type
- Memory usage trends
- Security scan findings

### Alert Thresholds
\`\`\`yaml
alerts:
  - name: high_error_rate
    condition: error_rate > 5%
    duration: 5m
    severity: critical

  - name: slow_response
    condition: p99_latency > 10s
    duration: 10m
    severity: warning

  - name: memory_pressure
    condition: memory_usage > 90%
    duration: 1m
    severity: critical
\`\`\`

## Training & Onboarding

### New Team Member Checklist
- [ ] Read this AGENTS.md document
- [ ] Complete security awareness training
- [ ] Set up local development environment
- [ ] Run \`npx @claude-flow/cli doctor\` to verify setup
- [ ] Complete first guided task with mentor
- [ ] Review incident response procedures

### Knowledge Base
- Internal wiki: [Link to wiki]
- Architecture Decision Records: \`/docs/adr/\`
- Runbooks: \`/docs/runbooks/\`
`;

  return full + enterpriseSections;
}
