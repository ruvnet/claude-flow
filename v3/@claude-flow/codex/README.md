# @claude-flow/codex

<p align="center">
  <strong>OpenAI Codex CLI Adapter for Claude Flow V3</strong><br/>
  <em>Self-learning multi-agent orchestration following the <a href="https://agentics.org">Agentics Foundation</a> standard</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@claude-flow/codex"><img src="https://img.shields.io/npm/v/@claude-flow/codex?label=npm&color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@claude-flow/codex"><img src="https://img.shields.io/npm/dm/@claude-flow/codex?label=downloads&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/ruvnet/ruflo"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://agentics.org"><img src="https://img.shields.io/badge/standard-Agentics-purple" alt="Agentics Standard"></a>
</p>

---

## Why @claude-flow/codex?

Transform OpenAI Codex CLI into a **self-improving AI development system**. While Codex executes code, claude-flow orchestrates, coordinates, and **learns from every interaction**.

| Traditional Codex | With Claude-Flow |
|-------------------|------------------|
| Stateless execution | Persistent vector memory |
| Single-agent | Multi-agent swarms (up to 15) |
| Manual coordination | Automatic orchestration |
| No learning | Self-learning patterns (HNSW) |
| One platform | Dual-mode (Claude Code + Codex) |

## Key Concept: Execution Model

```
┌─────────────────────────────────────────────────────────────────┐
│  CLAUDE-FLOW = ORCHESTRATOR (tracks state, stores memory)       │
│  CODEX = EXECUTOR (writes code, runs commands, implements)      │
└─────────────────────────────────────────────────────────────────┘
```

**Codex does the work. Claude-flow coordinates and learns.**

### The Self-Learning Loop

```
    ┌──────────────┐
    │   SEARCH     │ ──→ Find relevant patterns from past successes
    │   memory     │
    └──────┬───────┘
           │
    ┌──────▼───────┐
    │  COORDINATE  │ ──→ Initialize swarm, spawn specialized agents
    │   swarm      │
    └──────┬───────┘
           │
    ┌──────▼───────┐
    │   EXECUTE    │ ──→ Codex writes code, runs commands
    │   codex      │
    └──────┬───────┘
           │
    ┌──────▼───────┐
    │    STORE     │ ──→ Save successful patterns for future use
    │   memory     │
    └──────────────┘
```

## Quick Start

```bash
# Initialize for Codex (recommended)
npx ruflo@latest init --codex

# Full setup with all 137+ skills
npx ruflo@latest init --codex --full

# Dual mode (both Claude Code and Codex)
npx ruflo@latest init --dual
```

**That's it!** The MCP server is auto-registered, skills are installed, and your project is ready for self-learning development.

---

<details>
<summary><b>Features</b></summary>

| Feature | Description |
|---------|-------------|
| **AGENTS.md Generation** | Creates project instructions for Codex |
| **MCP Integration** | Self-learning via memory and vector search |
| **137+ Skills** | Invoke with `$skill-name` syntax |
| **Vector Memory** | Semantic pattern search (384-dim embeddings) |
| **Dual Platform** | Supports both Claude Code and Codex |
| **Auto-Registration** | MCP server registered during init |
| **HNSW Search** | 150x-12,500x faster pattern matching |
| **Self-Learning** | Learn from successes, remember patterns |
| **GPT-5.3 Support** | Optimized for latest OpenAI models |
| **Neural Training** | Train patterns with SONA architecture |

</details>

---

<details>
<summary><b>MCP Integration (Self-Learning)</b></summary>

### Automatic Registration

When you run `init --codex`, the MCP server is **automatically registered** with Codex:

```bash
# Verify MCP is registered
codex mcp list

# Expected output:
# Name         Command  Args                   Status
# claude-flow  npx      claude-flow mcp start  enabled
```

### Manual Registration

If MCP is not present, add manually:

```bash
codex mcp add claude-flow -- npx claude-flow mcp start
```

### MCP Tools Reference

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `memory_search` | Semantic vector search | **BEFORE** starting any task |
| `memory_store` | Save patterns with embeddings | **AFTER** completing successfully |
| `swarm_init` | Initialize coordination | Start of complex tasks |
| `agent_spawn` | Register agent roles | Multi-agent workflows |
| `neural_train` | Train on patterns | Periodic improvement |

### Tool Parameters

**memory_search**
```json
{
  "query": "search terms",
  "namespace": "patterns",
  "limit": 5
}
```

**memory_store**
```json
{
  "key": "pattern-name",
  "value": "what worked",
  "namespace": "patterns",
  "upsert": true
}
```

**swarm_init**
```json
{
  "topology": "hierarchical",
  "maxAgents": 5,
  "strategy": "specialized"
}
```

</details>

---

<details>
<summary><b>Self-Learning Workflow</b></summary>

### The 4-Step Pattern

```
1. LEARN:    memory_search(query="task keywords") → Find similar patterns
2. COORD:    swarm_init(topology="hierarchical") → Set up coordination
3. EXECUTE:  YOU write code, run commands        → Codex does real work
4. REMEMBER: memory_store(key, value, upsert=true) → Save for future
```

### Complete Example Prompt

```
Build an email validator using a learning-enabled swarm.

STEP 1 - LEARN (use MCP tool):
Use tool: memory_search
  query: "validation utility function patterns"
  namespace: "patterns"
If score > 0.7, use that pattern as reference.

STEP 2 - COORDINATE (use MCP tools):
Use tool: swarm_init with topology="hierarchical", maxAgents=3
Use tool: agent_spawn with type="coder", name="validator"

STEP 3 - EXECUTE (YOU do this - DON'T STOP HERE):
Create /tmp/validator/email.js with validateEmail() function
Create /tmp/validator/test.js with test cases
Run the tests

STEP 4 - REMEMBER (use MCP tool):
Use tool: memory_store
  key: "pattern-email-validator"
  value: "Email validation: regex, returns boolean, test cases"
  namespace: "patterns"
  upsert: true

YOU execute all code. MCP tools are for learning only.
```

### Similarity Score Guide

| Score | Meaning | Action |
|-------|---------|--------|
| > 0.7 | Strong match | Use the pattern directly |
| 0.5 - 0.7 | Partial match | Adapt and modify |
| < 0.5 | Weak match | Create new approach |

</details>

---

<details>
<summary><b>Directory Structure</b></summary>

```
project/
├── AGENTS.md                    # Main project instructions (Codex format)
├── .agents/
│   ├── config.toml              # Project configuration
│   ├── skills/                  # 137+ skills
│   │   ├── swarm-orchestration/
│   │   │   └── SKILL.md
│   │   ├── memory-management/
│   │   │   └── SKILL.md
│   │   ├── sparc-methodology/
│   │   │   └── SKILL.md
│   │   └── ...
│   └── README.md                # Directory documentation
├── .codex/                      # Local overrides (gitignored)
│   ├── config.toml              # Local development settings
│   └── AGENTS.override.md       # Local instruction overrides
└── .claude-flow/                # Runtime data
    ├── config.yaml              # Runtime configuration
    ├── data/                    # Memory and cache
    │   └── memory.db            # SQLite with vector embeddings
    └── logs/                    # Log files
```

### Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Main instructions for Codex (required) |
| `.agents/config.toml` | Project-wide configuration |
| `.codex/config.toml` | Local overrides (gitignored) |
| `.claude-flow/data/memory.db` | Vector memory database |

</details>

---

<details>
<summary><b>Templates</b></summary>

### Available Templates

| Template | Skills | Learning | Best For |
|----------|--------|----------|----------|
| `minimal` | 2 | Basic | Quick prototypes |
| `default` | 4 | Yes | Standard projects |
| `full` | 137+ | Yes | Full-featured development |
| `enterprise` | 137+ | Advanced | Team environments |

### Usage

```bash
# Minimal (fastest init)
npx ruflo@latest init --codex --minimal

# Default
npx ruflo@latest init --codex

# Full (all skills)
npx ruflo@latest init --codex --full
```

### Template Contents

**Minimal:**
- Core swarm orchestration
- Basic memory management

**Default:**
- Swarm orchestration
- Memory management
- SPARC methodology
- Basic coding patterns

**Full:**
- All 137+ skills
- GitHub integration
- Security scanning
- Performance optimization
- AgentDB vector search
- Neural pattern training

</details>

---

<details>
<summary><b>Platform Comparison (Claude Code vs Codex)</b></summary>

| Feature | Claude Code | OpenAI Codex |
|---------|-------------|--------------|
| Config File | `CLAUDE.md` | `AGENTS.md` |
| Skills Dir | `.claude/skills/` | `.agents/skills/` |
| Skill Syntax | `/skill-name` | `$skill-name` |
| Settings | `settings.json` | `config.toml` |
| MCP | Native | Via `codex mcp add` |
| Overrides | `.claude.local.md` | `.codex/config.toml` |

### Dual Mode

Run `init --dual` to set up both platforms:

```bash
npx ruflo@latest init --dual
```

This creates:
- `CLAUDE.md` for Claude Code users
- `AGENTS.md` for Codex users
- Shared `.claude-flow/` runtime
- Cross-compatible skills

</details>

---

<details>
<summary><b>Skill Invocation</b></summary>

### Syntax

In OpenAI Codex CLI, invoke skills with `$` prefix:

```
$swarm-orchestration
$memory-management
$sparc-methodology
$security-audit
$agent-coder
$agent-tester
$github-workflow
$performance-optimization
```

### Complete Skills Table (137+ Skills)

#### V3 Core Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| V3 Security Overhaul | `$v3-security-overhaul` | Complete security architecture with CVE remediation |
| V3 Memory Unification | `$v3-memory-unification` | Unify 6+ memory systems into AgentDB with HNSW |
| V3 Integration Deep | `$v3-integration-deep` | Deep agentic-flow integration (ADR-001) |
| V3 Performance Optimization | `$v3-performance-optimization` | Achieve 2.49x-7.47x speedup targets |
| V3 Swarm Coordination | `$v3-swarm-coordination` | 15-agent hierarchical mesh coordination |
| V3 DDD Architecture | `$v3-ddd-architecture` | Domain-Driven Design architecture |
| V3 Core Implementation | `$v3-core-implementation` | Core module implementation |
| V3 MCP Optimization | `$v3-mcp-optimization` | MCP server optimization and transport |
| V3 CLI Modernization | `$v3-cli-modernization` | CLI modernization and hooks enhancement |

#### AgentDB & Memory Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| AgentDB Advanced | `$agentdb-advanced` | Advanced QUIC sync, distributed coordination |
| AgentDB Memory Patterns | `$agentdb-memory-patterns` | Persistent memory patterns for AI agents |
| AgentDB Learning | `$agentdb-learning` | AI learning plugins with AgentDB |
| AgentDB Optimization | `$agentdb-optimization` | Quantization (4-32bit), performance tuning |
| AgentDB Vector Search | `$agentdb-vector-search` | Semantic vector search with HNSW |
| ReasoningBank AgentDB | `$reasoningbank-agentdb` | ReasoningBank with AgentDB integration |
| ReasoningBank Intelligence | `$reasoningbank-intelligence` | Adaptive learning with ReasoningBank |

#### Swarm & Coordination Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| Swarm Orchestration | `$swarm-orchestration` | Multi-agent swarms with agentic-flow |
| Swarm Advanced | `$swarm-advanced` | Advanced swarm patterns for research/analysis |
| Hive Mind Advanced | `$hive-mind-advanced` | Collective intelligence system |
| Stream Chain | `$stream-chain` | Stream-JSON chaining for multi-agent pipelines |
| Worker Integration | `$worker-integration` | Background worker integration |
| Worker Benchmarks | `$worker-benchmarks` | Worker performance benchmarks |

#### GitHub Integration Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| GitHub Code Review | `$github-code-review` | AI-powered code review swarms |
| GitHub Project Management | `$github-project-management` | Swarm-coordinated project management |
| GitHub Multi-Repo | `$github-multi-repo` | Multi-repository coordination |
| GitHub Release Management | `$github-release-management` | Release orchestration with AI swarms |
| GitHub Workflow Automation | `$github-workflow-automation` | GitHub Actions automation |

#### SPARC Methodology Skills (30+)

| Skill | Syntax | Description |
|-------|--------|-------------|
| SPARC Methodology | `$sparc-methodology` | Full SPARC workflow orchestration |
| SPARC Specification | `$sparc:spec-pseudocode` | Capture full project context |
| SPARC Architecture | `$sparc:architect` | System architecture design |
| SPARC Coder | `$sparc:coder` | Clean, efficient code generation |
| SPARC Tester | `$sparc:tester` | Comprehensive testing |
| SPARC Reviewer | `$sparc:reviewer` | Code review and quality |
| SPARC Debugger | `$sparc:debugger` | Runtime bug troubleshooting |
| SPARC Optimizer | `$sparc:optimizer` | Refactor and modularize |
| SPARC Documenter | `$sparc:documenter` | Documentation generation |
| SPARC DevOps | `$sparc:devops` | DevOps automation |
| SPARC Security Review | `$sparc:security-review` | Static/dynamic security analysis |
| SPARC Integration | `$sparc:integration` | System integration |
| SPARC MCP | `$sparc:mcp` | MCP integration management |

#### Flow Nexus Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| Flow Nexus Neural | `$flow-nexus-neural` | Neural network training in E2B sandboxes |
| Flow Nexus Platform | `$flow-nexus-platform` | Platform management and authentication |
| Flow Nexus Swarm | `$flow-nexus-swarm` | Cloud-based AI swarm deployment |
| Flow Nexus Payments | `$flow-nexus:payments` | Credit management and billing |
| Flow Nexus Challenges | `$flow-nexus:challenges` | Coding challenges and achievements |
| Flow Nexus Sandbox | `$flow-nexus:sandbox` | E2B sandbox management |
| Flow Nexus App Store | `$flow-nexus:app-store` | App publishing and deployment |
| Flow Nexus Workflow | `$flow-nexus:workflow` | Event-driven workflow automation |

#### Development Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| Pair Programming | `$pair-programming` | AI-assisted pair programming |
| Skill Builder | `$skill-builder` | Create new Claude Code Skills |
| Verification Quality | `$verification-quality` | Truth scoring and quality verification |
| Performance Analysis | `$performance-analysis` | Bottleneck detection and optimization |
| Agentic Jujutsu | `$agentic-jujutsu` | Quantum-resistant version control |
| Hooks Automation | `$hooks-automation` | Automated coordination and learning |

#### Memory Management Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| Memory Neural | `$memory:neural` | Neural pattern training |
| Memory Usage | `$memory:memory-usage` | Memory usage analysis |
| Memory Search | `$memory:memory-search` | Semantic memory search |
| Memory Persist | `$memory:memory-persist` | Memory persistence |

#### Monitoring & Analysis Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| Real-Time View | `$monitoring:real-time-view` | Real-time monitoring |
| Agent Metrics | `$monitoring:agent-metrics` | Agent performance metrics |
| Swarm Monitor | `$monitoring:swarm-monitor` | Swarm activity monitoring |
| Token Usage | `$analysis:token-usage` | Token usage optimization |
| Performance Report | `$analysis:performance-report` | Performance reporting |
| Bottleneck Detect | `$analysis:bottleneck-detect` | Bottleneck detection |

#### Training Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| Specialization | `$training:specialization` | Agent specialization training |
| Neural Patterns | `$training:neural-patterns` | Neural pattern training |
| Pattern Learn | `$training:pattern-learn` | Pattern learning |
| Model Update | `$training:model-update` | Model updates |

#### Automation & Optimization Skills

| Skill | Syntax | Description |
|-------|--------|-------------|
| Self-Healing | `$automation:self-healing` | Self-healing workflows |
| Smart Agents | `$automation:smart-agents` | Smart agent auto-spawning |
| Session Memory | `$automation:session-memory` | Cross-session memory |
| Cache Manage | `$optimization:cache-manage` | Cache management |
| Parallel Execute | `$optimization:parallel-execute` | Parallel task execution |
| Topology Optimize | `$optimization:topology-optimize` | Automatic topology selection |

#### Hooks Skills (17 Hooks + 12 Workers)

| Skill | Syntax | Description |
|-------|--------|-------------|
| Pre-Edit | `$hooks:pre-edit` | Context before editing |
| Post-Edit | `$hooks:post-edit` | Record editing outcome |
| Pre-Task | `$hooks:pre-task` | Record task start |
| Post-Task | `$hooks:post-task` | Record task completion |
| Session End | `$hooks:session-end` | End session and persist |

#### Dual-Mode Skills (NEW)

| Skill | Syntax | Description |
|-------|--------|-------------|
| Dual Spawn | `$dual-spawn` | Spawn parallel Codex workers from Claude Code |
| Dual Coordinate | `$dual-coordinate` | Coordinate Claude Code + Codex execution |
| Dual Collect | `$dual-collect` | Collect results from parallel Codex instances |

### Custom Skills

Create custom skills in `.agents/skills/`:

```
.agents/skills/my-skill/
└── SKILL.md
```

**SKILL.md format:**
```markdown
# My Custom Skill

Instructions for what this skill does...

## Usage
Invoke with `$my-skill`
```

</details>

---

<details>
<summary><b>Dual-Mode Integration (Claude Code + Codex)</b></summary>

### Hybrid Execution Model

Run Claude Code for interactive development and spawn headless Codex workers for parallel background tasks:

```
┌─────────────────────────────────────────────────────────────────┐
│  CLAUDE CODE (interactive)  ←→  CODEX WORKERS (headless)        │
│  - Main conversation         - Parallel background execution    │
│  - Complex reasoning         - Bulk code generation            │
│  - Architecture decisions    - Test execution                   │
│  - Final integration         - File processing                  │
└─────────────────────────────────────────────────────────────────┘
```

### Setup

```bash
# Initialize dual-mode
npx ruflo@latest init --dual

# Creates both:
# - CLAUDE.md (Claude Code configuration)
# - AGENTS.md (Codex configuration)
# - Shared .claude-flow/ runtime
```

### Spawning Parallel Codex Workers

From Claude Code, spawn headless Codex instances:

```bash
# Spawn workers in parallel (each runs independently)
claude -p "Analyze src/auth/ for security issues" --session-id "task-1" &
claude -p "Write unit tests for src/api/" --session-id "task-2" &
claude -p "Optimize database queries in src/db/" --session-id "task-3" &
wait  # Wait for all to complete
```

### Dual-Mode Skills

| Skill | Platform | Description |
|-------|----------|-------------|
| `$dual-spawn` | Codex | Spawn parallel workers from orchestrator |
| `$dual-coordinate` | Both | Coordinate cross-platform execution |
| `$dual-collect` | Claude Code | Collect results from Codex workers |

### Dual-Mode Agents

| Agent | Type | Execution |
|-------|------|-----------|
| `codex-worker` | Worker | Headless background execution |
| `codex-coordinator` | Coordinator | Manage parallel worker pool |
| `dual-orchestrator` | Orchestrator | Route tasks to appropriate platform |

### Task Routing Rules

| Task Complexity | Platform | Reason |
|----------------|----------|--------|
| Simple (1-2 files) | Codex Headless | Fast, parallel |
| Medium (3-5 files) | Claude Code | Needs context |
| Complex (architecture) | Claude Code | Reasoning required |
| Bulk operations | Codex Workers | Parallelize |
| Final review | Claude Code | Integration |

### Example Workflow

```
1. Claude Code receives complex feature request
2. Designs architecture and creates plan
3. Spawns 4 Codex workers:
   - Worker 1: Implement data models
   - Worker 2: Create API endpoints
   - Worker 3: Write unit tests
   - Worker 4: Generate documentation
4. Workers execute in parallel (headless)
5. Claude Code collects and integrates results
6. Final review and refinement in Claude Code
```

### Memory Sharing

Both platforms share the same `.claude-flow/` runtime:

```
.claude-flow/
├── data/
│   └── memory.db      # Shared vector memory
├── config.yaml        # Shared configuration
└── sessions/          # Cross-platform sessions
```

### Benefits

| Feature | Benefit |
|---------|---------|
| **Parallel Execution** | 4-8x faster for bulk tasks |
| **Cost Optimization** | Route simple tasks to cheaper workers |
| **Context Preservation** | Shared memory across platforms |
| **Best of Both** | Interactive + batch processing |
| **Unified Learning** | Patterns learned by both platforms |

### CLI Commands (NEW in v3.0.0-alpha.8)

The `@claude-flow/codex` package now includes built-in dual-mode orchestration:

```bash
# List available collaboration templates
npx claude-flow-codex dual templates

# Run a feature development swarm
npx claude-flow-codex dual run --template feature --task "Add user authentication"

# Run a security audit swarm
npx claude-flow-codex dual run --template security --task "src/auth/"

# Run a refactoring swarm
npx claude-flow-codex dual run --template refactor --task "src/legacy/"

# Check collaboration status
npx claude-flow-codex dual status
```

### Codex Loop Runner

Codex does not expose Claude Code's `ScheduleWakeup`, so `@claude-flow/codex` provides a process-based equivalent:

```bash
# Run Codex repeatedly until it creates .codex/loop/default.complete or reaches 10 iterations
npx claude-flow-codex loop run "Fix failing tests and create the completion marker when done"

# Use command mode for recurring Ruflo workers or custom scripts
npx claude-flow-codex loop run --name testgaps --interval 270 --max-iterations 0 \
  --command "npx claude-flow hooks worker dispatch --trigger testgaps"

# Inspect or stop a loop from another terminal
npx claude-flow-codex loop status --name testgaps
npx claude-flow-codex loop stop --name testgaps
```

Loop state is stored in `.codex/loop/<name>.json`; `loop stop` writes `.codex/loop/<name>.stop`, which the runner observes between iterations.

### Pre-Built Templates

| Template | Pipeline | Platforms |
|----------|----------|-----------|
| **feature** | architect → coder → tester → reviewer | Claude (architect, reviewer) + Codex (coder, tester) |
| **security** | scanner → analyzer → fixer | Codex (scanner, fixer) + Claude (analyzer) |
| **refactor** | analyzer → planner → refactorer → validator | Claude (analyzer, planner) + Codex (refactorer, validator) |

### Programmatic API

```typescript
import { DualModeOrchestrator, CollaborationTemplates } from '@claude-flow/codex';

// Create orchestrator
const orchestrator = new DualModeOrchestrator({
  projectPath: process.cwd(),
  maxConcurrent: 4,
  sharedNamespace: 'collaboration',
  timeout: 300000,
});

// Listen to events
orchestrator.on('worker:started', ({ id, role }) => console.log(`Started: ${role}`));
orchestrator.on('worker:completed', ({ id }) => console.log(`Completed: ${id}`));

// Run collaboration with a template
const workers = CollaborationTemplates.featureDevelopment('Add OAuth2 login');
const result = await orchestrator.runCollaboration(workers, 'Feature: OAuth2');

console.log(`Success: ${result.success}`);
console.log(`Duration: ${result.totalDuration}ms`);
console.log(`Workers: ${result.workers.length}`);
```

</details>

---

<details>
<summary><b>Configuration</b></summary>

### .agents/config.toml

```toml
# Model configuration
model = "gpt-5.3"

# Approval policy: "always" | "on-request" | "never"
approval_policy = "on-request"

# Sandbox mode: "read-only" | "workspace-write" | "danger-full-access"
sandbox_mode = "workspace-write"

# Web search: "off" | "cached" | "live"
web_search = "cached"

# MCP Servers
[mcp_servers.claude-flow]
command = "npx"
args = ["claude-flow", "mcp", "start"]
enabled = true

# Skills
[[skills]]
path = ".agents/skills/swarm-orchestration"
enabled = true

[[skills]]
path = ".agents/skills/memory-management"
enabled = true

[[skills]]
path = ".agents/skills/sparc-methodology"
enabled = true
```

### .codex/config.toml (Local Overrides)

```toml
# Local development overrides (gitignored)
# These settings override .agents/config.toml

approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "live"

# Disable MCP in local if needed
[mcp_servers.claude-flow]
enabled = false
```

### Environment Variables

```bash
# Configuration paths
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_MEMORY_PATH=./.claude-flow/data

# Provider keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# MCP settings
CLAUDE_FLOW_MCP_PORT=3000
```

</details>

---

<details>
<summary><b>Vector Search Details</b></summary>

### Specifications

| Property | Value |
|----------|-------|
| Embedding Dimensions | 384 |
| Search Algorithm | HNSW |
| Speed Improvement | 150x-12,500x faster |
| Similarity Range | 0.0 - 1.0 |
| Storage | SQLite with vector extension |
| Model | all-MiniLM-L6-v2 |

### Namespaces

| Namespace | Purpose |
|-----------|---------|
| `patterns` | Successful code patterns |
| `solutions` | Bug fixes and solutions |
| `tasks` | Task completion records |
| `coordination` | Swarm state |
| `results` | Worker results |
| `default` | General storage |

### Example Searches

```javascript
// Find auth patterns
memory_search({ query: "authentication JWT patterns", namespace: "patterns" })

// Find bug solutions
memory_search({ query: "null pointer fix", namespace: "solutions" })

// Find past tasks
memory_search({ query: "user profile API", namespace: "tasks" })
```

</details>

---

<details>
<summary><b>API Reference</b></summary>

### CodexInitializer Class

```typescript
import { CodexInitializer } from '@claude-flow/codex';

class CodexInitializer {
  /**
   * Initialize a Codex project
   */
  async initialize(options: CodexInitOptions): Promise<CodexInitResult>;

  /**
   * Preview what would be created without writing files
   */
  async dryRun(options: CodexInitOptions): Promise<string[]>;
}
```

### initializeCodexProject Function

```typescript
import { initializeCodexProject } from '@claude-flow/codex';

/**
 * Quick initialization helper
 */
async function initializeCodexProject(
  projectPath: string,
  options?: Partial<CodexInitOptions>
): Promise<CodexInitResult>;
```

### Types

```typescript
interface CodexInitOptions {
  /** Project directory path */
  projectPath: string;
  /** Template to use */
  template?: 'minimal' | 'default' | 'full' | 'enterprise';
  /** Specific skills to include */
  skills?: string[];
  /** Overwrite existing files */
  force?: boolean;
  /** Enable dual mode (Claude Code + Codex) */
  dual?: boolean;
}

interface CodexInitResult {
  /** Whether initialization succeeded */
  success: boolean;
  /** List of files created */
  filesCreated: string[];
  /** List of skills generated */
  skillsGenerated: string[];
  /** Whether MCP was registered */
  mcpRegistered?: boolean;
  /** Non-fatal warnings */
  warnings?: string[];
  /** Fatal errors */
  errors?: string[];
}
```

### Programmatic Usage

```typescript
import { CodexInitializer, initializeCodexProject } from '@claude-flow/codex';

// Quick initialization
const result = await initializeCodexProject('/path/to/project', {
  template: 'full',
  force: true,
  dual: false,
});

console.log(`Files created: ${result.filesCreated.length}`);
console.log(`Skills: ${result.skillsGenerated.length}`);
console.log(`MCP registered: ${result.mcpRegistered}`);

// Or use the class directly
const initializer = new CodexInitializer();
const result = await initializer.initialize({
  projectPath: '/path/to/project',
  template: 'enterprise',
  skills: ['swarm-orchestration', 'memory-management', 'security-audit'],
  force: false,
  dual: true,
});

if (result.warnings?.length) {
  console.warn('Warnings:', result.warnings);
}
```

</details>

---

<details>
<summary><b>Migration from Claude Code</b></summary>

### Convert CLAUDE.md to AGENTS.md

```typescript
import { migrate } from '@claude-flow/codex';

const result = await migrate({
  sourcePath: './CLAUDE.md',
  targetPath: './AGENTS.md',
  preserveComments: true,
  generateSkills: true,
});

console.log(`Migrated: ${result.success}`);
console.log(`Skills generated: ${result.skillsGenerated.length}`);
```

### Manual Migration Checklist

1. **Rename config file**: `CLAUDE.md` → `AGENTS.md`
2. **Move skills**: `.claude/skills/` → `.agents/skills/`
3. **Update syntax**: `/skill-name` → `$skill-name`
4. **Convert settings**: `settings.json` → `config.toml`
5. **Register MCP**: `codex mcp add claude-flow -- npx claude-flow mcp start`

### Dual Mode Alternative

Instead of migrating, use dual mode to support both:

```bash
npx ruflo@latest init --dual
```

This keeps both `CLAUDE.md` and `AGENTS.md` in sync.

</details>

---

<details>
<summary><b>Troubleshooting</b></summary>

### MCP Not Working

```bash
# Check if registered
codex mcp list

# Re-register
codex mcp remove claude-flow
codex mcp add claude-flow -- npx claude-flow mcp start

# Test connection
npx claude-flow mcp test
```

### Memory Search Returns Empty

```bash
# Initialize memory database
npx claude-flow memory init --force

# Check if entries exist
npx claude-flow memory list

# Manually add a test pattern
npx claude-flow memory store --key "test" --value "test pattern" --namespace patterns
```

### Skills Not Loading

```bash
# Verify skill directory
ls -la .agents/skills/

# Check config.toml for skill registration
cat .agents/config.toml | grep skills

# Rebuild skills
npx ruflo@latest init --codex --force
```

### Vector Search Slow

```bash
# Check HNSW index
npx claude-flow memory stats

# Rebuild index
npx claude-flow memory optimize --rebuild-index
```

</details>

---

## Related Packages

| Package | Description |
|---------|-------------|
| [@claude-flow/cli](https://www.npmjs.com/package/@claude-flow/cli) | Main CLI (26 commands, 140+ subcommands) |
| [claude-flow](https://www.npmjs.com/package/claude-flow) | Umbrella package |
| [@claude-flow/memory](https://www.npmjs.com/package/@claude-flow/memory) | AgentDB with HNSW vector search |
| [@claude-flow/security](https://www.npmjs.com/package/@claude-flow/security) | Security module |

## License

MIT

## Support

- Documentation: https://github.com/ruvnet/ruflo
- Issues: https://github.com/ruvnet/ruflo/issues
