# codex

> Multi-agent orchestration framework for agentic coding

## Project Overview

A Claude Flow powered project

**Tech Stack**: TypeScript, Node.js
**Architecture**: Domain-Driven Design with bounded contexts

## Quick Start

### Installation
```bash
npm install
```

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

### Development
```bash
npm run dev
```

## Agent Coordination

### Swarm Configuration

This project uses hierarchical swarm coordination for complex tasks:

| Setting | Value | Purpose |
|---------|-------|---------|
| Topology | `hierarchical` | Queen-led coordination (anti-drift) |
| Max Agents | 8 | Optimal team size |
| Strategy | `specialized` | Clear role boundaries |
| Consensus | `raft` | Leader-based consistency |

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

### Policy-Governed Concurrent Execution

- Ruflo coordinates and records policy decisions; Codex workers execute.
- Use `guidance_brain` for live capability routing; registration is distinct
  from configuration, reachability, health, and authorization.
- Follow the complete loop: recall, inspect, route, plan, execute, test,
  validate, benchmark, optimize, receipt, handoff, then authorized publish.
- Search AgentDB before planning and store only validated patterns after success.
- Use bounded fanout only for independent tasks.
- Every writing worker gets a unique git worktree and a reduced capability
  envelope. Never place two writers in one worktree.
- Read-only researchers may share a checkout.
- One integration agent owns shared manifests/lockfiles, consumes committed
  handoffs in dependency order, and runs scoped then full tests.
- Cancel dependent and not-yet-started sibling work on policy denial or dependency failure.
- MetaHarness can benchmark candidates concurrently but cannot authorize its
  own promotion or expand network, provider, spend, secret, or concurrency
  scope.
- Do not auto-commit, push, merge, release, or delete worktrees without user
  authorization.
- Existing projects start in ADR-324 `legacy` mode, may rehearse in `observe`,
  and opt into `enforce` after reviewing receipts.
- When tracked repository instructions define a local harness, assign the
  isolated worktree first, then register a session, inspect claims, acquire
  exact paths/resources/ports, renew leases, check acknowledged inbox messages, and
  release ownership on handoff or exit.
- A repository lease coordinates ownership; it does not grant authorization.
  Protected work still requires the ADR-324/325 capability and current fencing
  epoch.
- In-memory reference adapters are not distributed, restart-durable release
  authorities.
- Heartbeats and lease expiry establish liveness; PIDs are diagnostic only.
- `HEAD` alone is not an exact source-state identity in a dirty worktree.
  Release receipts bind a clean commit or an immutable snapshot of tracked and
  untracked changes.

### Available Skills

Use `$skill-name` syntax to invoke:

| Skill | Use Case |
|-------|----------|
| `$swarm-orchestration` | Multi-agent task coordination |
| `$memory-management` | Pattern storage and retrieval |
| `$sparc-methodology` | Structured development workflow |
| `$security-audit` | Security scanning and CVE detection |

### Agent Types

| Type | Role | Use Case |
|------|------|----------|
| `researcher` | Requirements analysis | Understanding scope |
| `architect` | System design | Planning structure |
| `coder` | Implementation | Writing code |
| `tester` | Test creation | Quality assurance |
| `reviewer` | Code review | Security and quality |

## Code Standards

### File Organization
- **NEVER** save to root folder
- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation
- `/config` - Configuration files

### Quality Rules
- Files under 500 lines
- No hardcoded secrets
- Input validation at boundaries
- Typed interfaces for public APIs
- TDD London School (mock-first) preferred

### Commit Messages
```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: ruflo-bot <ruflo-bot@users.noreply.github.com>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

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
```bash
npx @claude-flow/cli memory store \
  --key "pattern-name" \
  --value "pattern description" \
  --namespace patterns
```

### Searching Memory
```bash
npx @claude-flow/cli memory search \
  --query "search terms" \
  --namespace patterns
```

## Links

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
