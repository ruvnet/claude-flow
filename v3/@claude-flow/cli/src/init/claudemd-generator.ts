/**
 * CLAUDE.md Generator
 * Generates lean, enforceable Claude Code configuration optimized for token efficiency.
 *
 * Templates: minimal | standard | full | security | performance | solo
 * All templates use imperative rules and agent comms-first coordination.
 */

import type { InitOptions, ClaudeMdTemplate } from './types.js';

// --- Section Generators ---

function behavioralRules(): string {
  return `## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use \`/src\`, \`/tests\`, \`/docs\`, \`/config\`, \`/scripts\`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- NEVER add a \`Co-Authored-By\` trailer to user commits unless this project's \`.claude/settings.json\` has \`attribution.commit\` set (#2078). The Claude Code Bash tool may suggest one in its default commit-message template — ignore it. \`Co-Authored-By\` is semantic authorship attribution under git/GitHub convention; the tool is the facilitator, not a co-author.
- Keep files under 500 lines
- Validate input at system boundaries`;
}

function policyGovernedWorkflow(): string {
  return `## Ruflo Capability Brain & Implementation Loop

Ruflo is the coordination ledger and policy decision point. Claude Code is the
executor: after a Ruflo coordination call, continue implementing the task.

When it is registered, call
\`guidance_brain({ mode: "recommend", task: "..." })\` before complex Ruflo
work. Use its live registry instead of guessing tool names. Treat
\`registered\`, \`configured\`, \`reachable\`, \`healthy\`, and \`authorized\`
as separate facts. If the brain is unavailable, continue with the compatible
\`guidance_recommend\` tool, CLI discovery, and repository instructions.

Follow the returned loop:

1. Recall memory and ADR constraints.
2. Inspect source, runtime, dependencies, policy, and health.
3. Route to the smallest capable topology, agents, skills, and tools.
4. Plan acceptance criteria, safety envelope, ownership, and validation.
5. Execute in isolated scopes; the coding agent performs the work.
6. Test focused, regression, and failure paths.
7. Validate types, security, policy, compatibility, and artifacts.
8. Benchmark a source-bound candidate against a source-bound baseline.
9. Optimize measured bottlenecks without weakening safety.
10. Bind claims and evidence to exact source/build receipts.
11. Reconcile concurrent handoffs and disclose limitations.
12. Publish only through a separately authorized release gate.

### Concurrency and authority

- Never allow two writers in one worktree; give each writing agent an isolated
  worktree and explicit file ownership.
- Read-only research may run concurrently and report findings to the owner.
- Only the integration owner edits shared manifests and lockfiles or reconciles
  overlapping changes.
- A child may drop capabilities but cannot add tools, network, secrets, spend,
  concurrency, namespaces, or delegation depth.
- A lease or claim coordinates ownership; it does not authorize a side effect.
- Darwin, Flywheel, MetaHarness, memory, and neural systems may propose or
  evaluate candidates but cannot self-promote or expand their SafetyEnvelope.
- Bind tests, benchmarks, policy decisions, and release evidence to an exact
  commit or immutable dirty-worktree snapshot.`;
}

function agentComms(): string {
  return `## Agent Comms (SendMessage-First Coordination)

Named agents coordinate via \`SendMessage\`, not polling or shared state.

\`\`\`
Lead (you) ←→ architect ←→ developer ←→ tester ←→ reviewer
              (named agents message each other directly)
\`\`\`

### Spawning a Coordinated Team

\`\`\`javascript
// ALL agents in ONE message, each knows WHO to message next
Agent({ prompt: "Research the codebase. SendMessage findings to 'architect'.",
  subagent_type: "researcher", name: "researcher", run_in_background: true })
Agent({ prompt: "Wait for 'researcher'. Design solution. SendMessage to 'coder'.",
  subagent_type: "system-architect", name: "architect", run_in_background: true })
Agent({ prompt: "Wait for 'architect'. Implement it. SendMessage to 'tester'.",
  subagent_type: "coder", name: "coder", run_in_background: true })
Agent({ prompt: "Wait for 'coder'. Write tests. SendMessage results to 'reviewer'.",
  subagent_type: "tester", name: "tester", run_in_background: true })
Agent({ prompt: "Wait for 'tester'. Review code quality and security.",
  subagent_type: "reviewer", name: "reviewer", run_in_background: true })

// Kick off the pipeline
SendMessage({ to: "researcher", summary: "Start", message: "[task context]" })
\`\`\`

### Patterns

| Pattern | Flow | Use When |
|---------|------|----------|
| **Pipeline** | A → B → C → D | Sequential dependencies (feature dev) |
| **Fan-out** | Lead → A, B, C → Lead | Independent parallel work (research) |
| **Supervisor** | Lead ↔ workers | Ongoing coordination (complex refactor) |

### Rules

- ALWAYS name agents — \`name: "role"\` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with \`run_in_background: true\`
- After spawning, continue independent local work; wait only when a dependency
  genuinely blocks progress
- Do not poll repeatedly — agents message back or complete automatically
- Give every writing agent an isolated worktree and a non-overlapping file scope`;
}

function swarmConfig(options: InitOptions): string {
  return `## Swarm & Routing

### Config
- **Topology**: ${options.runtime.topology} (anti-drift)
- **Max Agents**: ${options.runtime.maxAgents}
- **Memory**: ${options.runtime.memoryBackend}
- **HNSW**: ${options.runtime.enableHNSW ? 'Enabled' : 'Disabled'}
- **Neural**: ${options.runtime.enableNeural ? 'Enabled' : 'Disabled'}

\`\`\`bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
\`\`\`

### Agent Routing

| Task | Agents | Topology |
|------|--------|----------|
| Bug Fix | researcher, coder, tester | hierarchical |
| Feature | architect, coder, tester, reviewer | hierarchical |
| Refactor | architect, coder, reviewer | hierarchical |
| Performance | perf-engineer, coder | hierarchical |
| Security | security-architect, auditor | hierarchical |

### When to Swarm
- **YES**: 3+ files, new features, cross-module refactoring, API changes, security, performance
- **NO**: single file edits, 1-2 line fixes, docs updates, config changes, questions

### 3-Tier Model Routing

| Tier | Handler | Use Cases |
|------|---------|-----------|
| 1 | Agent Booster (WASM) | Simple transforms — skip LLM, use Edit directly |
| 2 | Haiku | Simple tasks, low complexity |
| 3 | Sonnet/Opus | Architecture, security, complex reasoning |`;
}

function memoryAndLearning(): string {
  return `## Memory & Learning

### Before Any Task
\`\`\`bash
npx @claude-flow/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[task description]"
\`\`\`

### After Success
\`\`\`bash
npx @claude-flow/cli@latest memory store --namespace patterns --key "[name]" --value "[what worked]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
\`\`\`

### MCP Tools (use \`ToolSearch("keyword")\` to discover)

| Category | Key Tools |
|----------|-----------|
| **Memory** | \`memory_store\`, \`memory_search\`, \`memory_search_unified\` |
| **Bridge** | \`memory_import_claude\`, \`memory_bridge_status\` |
| **Swarm** | \`swarm_init\`, \`swarm_status\`, \`swarm_health\` |
| **Agents** | \`agent_spawn\`, \`agent_list\`, \`agent_status\` |
| **Hooks** | \`hooks_route\`, \`hooks_post-task\`, \`hooks_worker-dispatch\` |
| **Security** | \`aidefence_scan\`, \`aidefence_is_safe\`, \`aidefence_has_pii\` |
| **Hive-Mind** | \`hive-mind_init\`, \`hive-mind_consensus\`, \`hive-mind_spawn\` |

### Background Workers

| Worker | When |
|--------|------|
| \`audit\` | After security changes |
| \`optimize\` | After performance work |
| \`testgaps\` | After adding features |
| \`map\` | Every 5+ file changes |
| \`document\` | After API changes |

\`\`\`bash
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
\`\`\``;
}

function agentTypes(): string {
  return `## Agents

**Core**: \`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`
**Architecture**: \`system-architect\`, \`backend-dev\`, \`mobile-dev\`
**Security**: \`security-architect\`, \`security-auditor\`
**Performance**: \`performance-engineer\`, \`perf-analyzer\`
**Coordination**: \`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`
**GitHub**: \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`

Any string works as a custom agent type.`;
}

function cliQuickRef(): string {
  return `## CLI Quick Reference

\`\`\`bash
npx @claude-flow/cli@latest init --wizard           # Setup
npx @claude-flow/cli@latest swarm init --v3-mode     # Start swarm
npx @claude-flow/cli@latest memory search --query "" # Vector search
npx @claude-flow/cli@latest hooks route --task ""    # Route to agent
npx @claude-flow/cli@latest doctor --fix             # Diagnostics
npx @claude-flow/cli@latest security scan            # Security scan
npx @claude-flow/cli@latest performance benchmark    # Benchmarks
\`\`\`

26 commands, 140+ subcommands. Use \`--help\` on any command for details.`;
}

function setupAndBoundary(): string {
  return `## Setup

\`\`\`bash
claude mcp add claude-flow -- npx -y ruflo@latest mcp start
npx ruflo@latest doctor --fix
\`\`\`

> The background \`daemon\` is optional. It runs interval workers that each spawn
> a headless \`claude\` session, so it consumes tokens continuously. Start it only
> if you want those sweeps: \`npx ruflo@latest daemon start\` (self-stops after 12h
> by default; \`--ttl 0\` to disable, \`daemon status --all\` to audit running daemons).

**Agent tool** handles execution (agents, files, code, git). **MCP tools** handle coordination (swarm, memory, hooks). **CLI** is the same via Bash.`;
}

function buildAndTest(): string {
  return `## Build & Test

- ALWAYS run tests after code changes
- ALWAYS verify build succeeds before committing

\`\`\`bash
npm run build && npm test
\`\`\``;
}

function securitySection(): string {
  return `## Security

- NEVER hardcode secrets in source — use environment variables
- Always validate input at boundaries (Zod schemas)
- Always sanitize file paths (prevent traversal)
- Always use parameterized queries (prevent injection)

\`\`\`bash
npx @claude-flow/cli@latest security scan --depth deep
npx @claude-flow/cli@latest security audit --report
\`\`\`

Agents: \`security-architect\` (threat modeling), \`security-auditor\` (vulnerability detection)`;
}

function performanceSection(): string {
  return `## Performance

- Always benchmark before AND after optimization
- Always profile before optimizing — never guess bottlenecks
- Use HNSW/DiskANN for vector search, Int8 quantization for memory reduction

\`\`\`bash
npx @claude-flow/cli@latest performance benchmark --suite all
npx @claude-flow/cli@latest performance profile --target "[component]"
\`\`\`

Agents: \`performance-engineer\` (profiling), \`perf-analyzer\` (bottleneck detection)`;
}

function hooksRef(): string {
  return `## Hooks

| Hook | Purpose |
|------|---------|
| \`pre-task\` / \`post-task\` | Task lifecycle + learning |
| \`pre-edit\` / \`post-edit\` | File editing + neural training |
| \`session-start\` / \`session-end\` | Session persistence |
| \`route\` | Route to optimal agent |
| \`intelligence\` | Pattern learning (SONA) |
| \`worker\` | Background worker dispatch |

\`\`\`bash
npx @claude-flow/cli@latest hooks pre-task --description "[task]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true
npx @claude-flow/cli@latest hooks session-start --session-id "[id]"
npx @claude-flow/cli@latest hooks route --task "[task]"
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
\`\`\``;
}

function intelligenceSystem(): string {
  return `## Intelligence (SONA + HNSW)

Pipeline: **RETRIEVE** (vector search) → **JUDGE** (success/failure) → **DISTILL** (extract patterns) → **CONSOLIDATE** (persist)

- **ONNX Embeddings**: all-MiniLM-L6-v2, 384-dim
- **HNSW/DiskANN**: 150x-12,500x faster search
- **SONA**: Sub-millisecond pattern adaptation
- **Claude Bridge**: Auto-imports \`~/.claude/projects/*/memory/*.md\` into AgentDB`;
}

function federationRef(): string {
  return `## Federation

Cross-installation agent collaboration with zero-trust security.

\`\`\`bash
npx @claude-flow/cli@latest federation init
npx @claude-flow/cli@latest federation join wss://peer:8443
npx @claude-flow/cli@latest federation send --to peer --type task-request --message "..."
npx @claude-flow/cli@latest federation status
\`\`\`

- 5-tier trust: UNTRUSTED → VERIFIED → ATTESTED → TRUSTED → PRIVILEGED
- PII pipeline: 14 types auto-stripped before data leaves your node
- mTLS + ed25519 handshake, HMAC-signed envelopes
- Compliance: HIPAA, SOC2, GDPR audit modes`;
}

function envVars(): string {
  return `## Environment

\`\`\`bash
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
\`\`\``;
}

// --- Template Composers ---

const TEMPLATE_SECTIONS: Record<ClaudeMdTemplate, Array<(opts: InitOptions) => string>> = {
  minimal: [
    behavioralRules,
    (_opts) => policyGovernedWorkflow(),
    (_opts) => agentComms(),
    swarmConfig,
    (_opts) => buildAndTest(),
    (_opts) => cliQuickRef(),
    (_opts) => setupAndBoundary(),
  ],
  standard: [
    behavioralRules,
    (_opts) => policyGovernedWorkflow(),
    (_opts) => agentComms(),
    swarmConfig,
    (_opts) => memoryAndLearning(),
    (_opts) => agentTypes(),
    (_opts) => buildAndTest(),
    (_opts) => cliQuickRef(),
    (_opts) => setupAndBoundary(),
  ],
  full: [
    behavioralRules,
    (_opts) => policyGovernedWorkflow(),
    (_opts) => agentComms(),
    swarmConfig,
    (_opts) => memoryAndLearning(),
    (_opts) => agentTypes(),
    (_opts) => hooksRef(),
    (_opts) => intelligenceSystem(),
    (_opts) => federationRef(),
    (_opts) => buildAndTest(),
    (_opts) => envVars(),
    (_opts) => cliQuickRef(),
    (_opts) => setupAndBoundary(),
  ],
  security: [
    behavioralRules,
    (_opts) => policyGovernedWorkflow(),
    (_opts) => agentComms(),
    swarmConfig,
    (_opts) => securitySection(),
    (_opts) => memoryAndLearning(),
    (_opts) => agentTypes(),
    (_opts) => buildAndTest(),
    (_opts) => cliQuickRef(),
    (_opts) => setupAndBoundary(),
  ],
  performance: [
    behavioralRules,
    (_opts) => policyGovernedWorkflow(),
    (_opts) => agentComms(),
    swarmConfig,
    (_opts) => performanceSection(),
    (_opts) => memoryAndLearning(),
    (_opts) => agentTypes(),
    (_opts) => intelligenceSystem(),
    (_opts) => buildAndTest(),
    (_opts) => cliQuickRef(),
    (_opts) => setupAndBoundary(),
  ],
  solo: [
    behavioralRules,
    (_opts) => policyGovernedWorkflow(),
    (_opts) => agentComms(),
    (_opts) => memoryAndLearning(),
    (_opts) => buildAndTest(),
    (_opts) => cliQuickRef(),
    (_opts) => setupAndBoundary(),
  ],
};

// --- Public API ---

export function generateClaudeMd(options: InitOptions, template?: ClaudeMdTemplate): string {
  const tmpl = template ?? options.runtime.claudeMdTemplate ?? 'standard';
  const sections = TEMPLATE_SECTIONS[tmpl] ?? TEMPLATE_SECTIONS.standard;

  const header = `# Ruflo — Claude Code Configuration\n`;
  const body = sections.map(fn => fn(options)).join('\n\n');

  return `${header}\n${body}\n`;
}

export function generateMinimalClaudeMd(options: InitOptions): string {
  return generateClaudeMd(options, 'minimal');
}

export const CLAUDE_MD_TEMPLATES: Array<{ name: ClaudeMdTemplate; description: string }> = [
  { name: 'minimal', description: 'Lean start — rules, agent comms, swarm config, CLI ref (~80 lines)' },
  { name: 'standard', description: 'Recommended — adds memory, learning, agent types (~140 lines)' },
  { name: 'full', description: 'Everything — hooks, intelligence, federation (~220 lines)' },
  { name: 'security', description: 'Security-focused — adds scanning, audit, threat agents' },
  { name: 'performance', description: 'Performance-focused — adds benchmarking, profiling, SONA' },
  { name: 'solo', description: 'Solo developer — comms, memory, no swarm (~90 lines)' },
];

export default generateClaudeMd;
