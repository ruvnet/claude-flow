# 🎓 Claude Code Skills Capabilities Guide

**Version**: 2.0.0
**Last Updated**: October 19, 2025

> **21 built-in skills + unlimited custom skills.** Discover what each skill does, when to use it, and how to combine skills for complex workflows.

---

## 📖 Table of Contents

1. [What Are Skills?](#-what-are-skills)
2. [Quick Start](#-quick-start)
3. [Built-In Skills Catalog](#-built-in-skills-catalog-21-total)
   - [AI & Memory](#-ai--memory-3-skills)
   - [GitHub Integration](#-github-integration-5-skills)
   - [Swarm Orchestration](#-swarm-orchestration-4-skills)
   - [Development & Quality](#-development--quality-3-skills)
   - [Cloud Platform](#-cloud-platform-3-skills)
   - [Automation & Tools](#-automation--tools-2-skills)
   - [Performance](#-performance-1-skill)
4. [Skills in Action](#-skills-in-action)
5. [Combining Skills](#-combining-skills-for-complex-workflows)
6. [Creating Custom Skills](#-creating-custom-skills)
7. [Skill Selection Guide](#-skill-selection-guide)
8. [Best Practices](#-best-practices)

---

## 🌟 What Are Skills?

Skills are **modular capabilities** that Claude Code discovers and uses automatically. Think of them as expert knowledge modules that Claude activates when needed.

**How it works:**
1. **You ask Claude** to do something ("Implement semantic search")
2. **Claude finds relevant skills** (agentdb-vector-search)
3. **Claude loads skill instructions** (how to implement it)
4. **Claude executes** using the skill's expertise
5. **Claude learns** and gets faster next time (46% improvement)

**Two types of skills available:**
- ✅ **21 Built-In Skills** (automatic via claude-flow MCP)
- ✅ **Custom Skills** (create your own with agentic-flow)

A skill is simply a directory with a `SKILL.md` file containing instructions:

### Skill Structure

```yaml
---
name: "AgentDB Vector Search"
description: "Implement semantic search with 150x-12,500x performance.
Use for RAG systems, documentation search, similarity matching."
---

# Instructions
[Detailed step-by-step guidance...]

# Examples
[Code examples and use cases...]

# Best Practices
[What works well, what to avoid...]
```

**Key features:**
- 📝 **YAML frontmatter**: Name and description (max 1024 chars)
- 🎯 **Progressive disclosure**: Claude only loads when relevant
- 🧠 **Context persistence**: Learns from usage (46% faster over time)
- 🔄 **Composable**: Skills work together for complex tasks

---

## 🚀 Quick Start

### Installation (30 seconds)

```bash
# Install claude-flow for 21 built-in skills
npm install -g claude-flow@alpha

# Add MCP server (makes skills available)
claude mcp add claude-flow npx claude-flow@alpha mcp start

# Verify it's running
claude mcp list
# ✓ claude-flow@alpha   npx claude-flow@alpha mcp start   ✓ Running

# That's it! All 21 skills are now available.
```

### Using Skills (No Setup Required)

Skills activate automatically when relevant:

```
You: "I need semantic search for my documentation"

Claude: I'll use the agentdb-vector-search skill to implement this.
[Automatically loads skill instructions and implements solution]
```

### Creating Custom Skills (Optional)

```bash
# Install agentic-flow for custom skill creation
npm install -g agentic-flow@latest

# Initialize skill directories
npx agentic-flow skills init

# Create sample skills
npx agentic-flow skills create

# Install skill builder
npx agentic-flow skills init-builder
```

---

## 📚 Built-In Skills Catalog (21 Total)

All 21 skills are **automatically available** with claude-flow MCP server. No setup required - just use them!

### 🧠 AI & Memory (3 skills)

#### 1. **agentdb-memory-patterns**
```yaml
description: "Implement persistent memory patterns for AI agents using AgentDB.
Includes session memory, long-term storage, pattern learning, and context management.
Use when building stateful agents, chat systems, or intelligent assistants."
```

**Key capabilities:**
- Session memory across conversations
- Long-term pattern storage
- Context management with AgentDB
- Cross-agent memory sharing

**When to use:**
- Building chatbots with memory
- Creating stateful AI assistants
- Implementing conversation history
- Pattern recognition tasks

---

#### 2. **agentdb-vector-search**
```yaml
description: "Implement semantic vector search with AgentDB for intelligent
document retrieval, similarity matching, and context-aware querying. Use when
building RAG systems, semantic search engines, or intelligent knowledge bases."
```

**Key capabilities:**
- 150x-12,500x faster than traditional search
- Semantic similarity matching
- Vector embeddings with AgentDB
- Intelligent document retrieval

**When to use:**
- RAG (Retrieval Augmented Generation) systems
- Documentation search
- Code similarity detection
- Recommendation engines

---

#### 3. **reasoningbank-intelligence**
```yaml
description: "Implement adaptive learning with ReasoningBank for pattern recognition,
strategy optimization, and continuous improvement. Use when building self-learning
agents, optimizing workflows, or implementing meta-cognitive systems."
```

**Key capabilities:**
- Pattern learning from execution
- Strategy optimization
- 46% performance improvement over time
- Meta-cognitive capabilities

**When to use:**
- Self-improving agents
- Workflow optimization
- Pattern-based decision making
- Continuous improvement systems

---

### ☁️ Flow Nexus Platform (3 skills)

#### 4. **flow-nexus-platform**
```yaml
description: "Comprehensive Flow Nexus platform management - authentication,
sandboxes, app deployment, payments, and challenges."
```

**Key capabilities:**
- User authentication and management
- E2B sandbox deployment
- Application marketplace
- Payment and credit systems

---

#### 5. **flow-nexus-neural**
```yaml
description: "Train and deploy neural networks in distributed E2B sandboxes
with Flow Nexus."
```

**Key capabilities:**
- Distributed neural network training
- Cloud-based model deployment
- WASM acceleration
- Multi-node coordination

---

#### 6. **flow-nexus-swarm**
```yaml
description: "Cloud-based AI swarm deployment and event-driven workflow
automation with Flow Nexus platform."
```

**Key capabilities:**
- Cloud swarm deployment
- Event-driven workflows
- Message queue processing
- Scalable agent coordination

---

### 🐙 GitHub Integration (5 skills)

**When to use GitHub skills:**
- Automated code reviews
- Multi-repo synchronization
- Release management
- CI/CD pipeline creation
- Project board automation

#### 7. **github-code-review**
```yaml
description: "Comprehensive GitHub code review with AI-powered swarm coordination."
```

**Key capabilities:**
- Multi-agent code analysis
- Security vulnerability detection
- Performance bottleneck identification
- Automated PR reviews

---

#### 8. **github-multi-repo**
```yaml
description: "Multi-repository coordination, synchronization, and architecture
management with AI swarm orchestration."
```

**Key capabilities:**
- Cross-repo synchronization
- Version alignment
- Dependency management
- Organization-wide automation

---

#### 9. **github-project-management**
```yaml
description: "Comprehensive GitHub project management with swarm-coordinated
issue tracking, project board automation, and sprint planning."
```

**Key capabilities:**
- Intelligent issue tracking
- Project board automation
- Sprint planning
- Team coordination

---

#### 10. **github-release-management**
```yaml
description: "Comprehensive GitHub release orchestration with AI swarm coordination
for automated versioning, testing, deployment, and rollback management."
```

**Key capabilities:**
- Automated versioning
- Release orchestration
- Testing coordination
- Rollback management

---

#### 11. **github-workflow-automation**
```yaml
description: "Advanced GitHub Actions workflow automation with AI swarm coordination,
intelligent CI/CD pipelines, and comprehensive repository management."
```

**Key capabilities:**
- CI/CD pipeline automation
- Workflow optimization
- Intelligent build coordination
- Repository automation

---

### 🤖 Swarm & Orchestration (4 skills)

#### 12. **swarm-orchestration**
```yaml
description: "Orchestrate multi-agent swarms with agentic-flow for parallel task
execution, dynamic topology, and intelligent coordination. Use when scaling beyond
single agents, implementing complex workflows, or building distributed AI systems."
```

**Key capabilities:**
- Multi-agent coordination
- Dynamic topology selection
- Parallel task execution
- Distributed decision making

**When to use:**
- Complex multi-step tasks
- Parallel code generation
- Distributed code reviews
- Large-scale refactoring

---

#### 13. **swarm-advanced**
```yaml
description: "Advanced swarm orchestration patterns for research, development,
testing, and complex distributed workflows."
```

**Key capabilities:**
- Research swarms
- Development coordination
- Testing automation
- Complex workflow patterns

---

#### 14. **hive-mind-advanced**
```yaml
description: "Advanced Hive Mind collective intelligence system for queen-led
multi-agent coordination with consensus mechanisms and persistent memory."
```

**Key capabilities:**
- Queen-led coordination
- Consensus mechanisms
- Collective intelligence
- Hierarchical decision making

---

#### 15. **stream-chain**
```yaml
description: "Stream-JSON chaining for multi-agent pipelines, data transformation,
and sequential workflows."
```

**Key capabilities:**
- Pipeline processing
- Data transformation
- Sequential workflows
- Stream processing

---

### 📊 Development & Quality (3 skills)

#### 16. **sparc-methodology**
```yaml
description: "SPARC (Specification, Pseudocode, Architecture, Refinement, Completion)
comprehensive development methodology with multi-agent orchestration."
```

**Key capabilities:**
- Systematic development phases
- Specification-driven design
- Test-driven development
- Multi-agent coordination

**When to use:**
- Complex feature development
- Architecture design
- Systematic refactoring
- Team development workflows

---

#### 17. **pair-programming**
```yaml
description: "AI-assisted pair programming with multiple modes (driver/navigator/switch),
real-time verification, quality monitoring, and comprehensive testing. Supports TDD,
debugging, refactoring, and learning sessions."
```

**Key capabilities:**
- Driver/Navigator modes
- Real-time verification
- TDD workflows
- Quality monitoring

---

#### 18. **verification-quality**
```yaml
description: "Comprehensive truth scoring, code quality verification, and automatic
rollback system with 0.95 accuracy threshold for ensuring high-quality agent outputs
and codebase reliability."
```

**Key capabilities:**
- Truth scoring
- Quality verification
- Automatic rollback
- Reliability assurance

---

### 🔧 Automation & Tools (2 skills)

#### 19. **hooks-automation**
```yaml
description: "Automated coordination, formatting, and learning from Claude Code
operations using intelligent hooks with MCP integration. Includes pre/post task
hooks, session management, Git integration, memory coordination, and neural pattern
training for enhanced development workflows."
```

**Key capabilities:**
- Pre/post task automation
- Session management
- Git integration
- Neural pattern training

---

#### 20. **skill-builder**
```yaml
description: "Create new Claude Code Skills with proper YAML frontmatter, progressive
disclosure structure, and complete directory organization. Use when you need to build
custom skills for specific workflows, generate skill templates, or understand the
Claude Skills specification."
```

**Key capabilities:**
- Interactive skill generation
- YAML validation
- Template system
- Best practices

---

### ⚡ Performance & Analysis (1 skill)

#### 21. **performance-analysis**
```yaml
description: "Comprehensive performance analysis, bottleneck detection, and
optimization recommendations for Claude Flow swarms."
```

**Key capabilities:**
- Bottleneck detection
- Performance profiling
- Optimization recommendations
- Metrics collection

---

---

## 🎬 Skills in Action

### Single Skill Examples

#### Example 1: Semantic Search (agentdb-vector-search)

```
You: "Add semantic search to our documentation site"

Claude (using agentdb-vector-search skill):
├─ Analyzes your documentation structure
├─ Sets up AgentDB vector database
├─ Generates embeddings for all docs
├─ Implements search API endpoint
├─ Creates search UI component
└─ Adds relevance scoring

Result: Working semantic search in minutes
Performance: 150x faster than traditional search
Learning: Pattern stored for 46% faster next time
```

---

#### Example 2: Code Review (github-code-review)

```
You: "Review PR #123 for security and performance"

Claude (using github-code-review skill):
├─ Spawns security auditor agent
├─ Spawns performance analyzer agent
├─ Spawns code quality reviewer agent
├─ Coordinates findings via shared memory
└─ Generates unified review report

Result: Comprehensive multi-angle review
Agents: 3 specialized reviewers in parallel
Time: 3.2 seconds for 2,847 files
```

---

#### Example 3: SPARC Development (sparc-methodology)

```
You: "Build user authentication system"

Claude (using sparc-methodology skill):
├─ Specification: Requirements analysis
├─ Pseudocode: Algorithm design
├─ Architecture: System design
├─ Refinement: TDD implementation
└─ Completion: Integration & testing

Result: Complete auth system with tests
Process: Systematic, test-driven approach
Quality: 90%+ code coverage
```

---

### Combined Skills Workflows

#### Workflow 1: Full-Stack Development

```
Task: "Build REST API with tests and deploy to GitHub"

Skills activated:
┌─────────────────────────────────────────┐
│ 1. sparc-methodology                     │
│    Plans development phases              │
├─────────────────────────────────────────┤
│ 2. swarm-orchestration                   │
│    Spawns parallel agents:               │
│    ├─ backend-dev (API)                  │
│    ├─ tester (tests)                     │
│    └─ reviewer (quality)                 │
├─────────────────────────────────────────┤
│ 3. agentdb-memory-patterns               │
│    Coordinates agents via shared memory  │
├─────────────────────────────────────────┤
│ 4. github-workflow-automation            │
│    Creates CI/CD pipeline                │
├─────────────────────────────────────────┤
│ 5. verification-quality                  │
│    Validates output (0.95 threshold)     │
├─────────────────────────────────────────┤
│ 6. reasoningbank-intelligence            │
│    Stores patterns for next time         │
└─────────────────────────────────────────┘

Result: Production-ready API + CI/CD
Time: Minutes instead of hours
Learning: 46% faster on next similar project
```

---

#### Workflow 2: Multi-Repo Release

```
Task: "Coordinate release across 5 microservices"

Skills activated:
┌─────────────────────────────────────────┐
│ 1. github-multi-repo                     │
│    Syncs versions across repos           │
├─────────────────────────────────────────┤
│ 2. github-release-management             │
│    Orchestrates release process          │
├─────────────────────────────────────────┤
│ 3. swarm-orchestration                   │
│    Parallel testing across services      │
├─────────────────────────────────────────┤
│ 4. verification-quality                  │
│    Validates each service                │
└─────────────────────────────────────────┘

Result: Coordinated multi-repo release
Services: 5 microservices in sync
Safety: Rollback on any failure
```

---

#### Workflow 3: Performance Optimization

```
Task: "Optimize slow React application"

Skills activated:
┌─────────────────────────────────────────┐
│ 1. performance-analysis                  │
│    Identifies bottlenecks                │
├─────────────────────────────────────────┤
│ 2. agentdb-vector-search                 │
│    Finds similar optimization patterns   │
├─────────────────────────────────────────┤
│ 3. reasoningbank-intelligence            │
│    Applies learned optimizations         │
├─────────────────────────────────────────┤
│ 4. pair-programming                      │
│    Guides implementation step-by-step    │
└─────────────────────────────────────────┘

Result: 4x performance improvement
Approach: Data-driven + pattern-based
Validation: Before/after metrics
```

---

## 🔗 Combining Skills for Complex Workflows

### How the Systems Work Together

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code (User)                       │
└────────────────┬───────────────────────┬────────────────────┘
                 │                       │
    ┌────────────▼─────────┐   ┌────────▼──────────┐
    │  claude-flow Skills  │   │ agentic-flow Skills│
    │  (21 Built-In)       │   │  (Custom Created)  │
    └────────────┬─────────┘   └────────┬──────────┘
                 │                       │
                 │    ┌──────────────────┘
                 │    │
    ┌────────────▼────▼──────────────────────────────┐
    │         MCP Integration Layer                  │
    │  • claude-flow: 213+ coordination tools        │
    │  • ruv-swarm: Enhanced coordination            │
    │  • flow-nexus: Cloud capabilities              │
    │  • agentic-flow: Multi-provider agent runtime  │
    └────────────┬───────────────────────────────────┘
                 │
    ┌────────────▼───────────────────────────────────┐
    │        Execution & Memory Layer                │
    │  • AgentDB: Vector search + memory             │
    │  • ReasoningBank: Pattern learning             │
    │  • 54 Specialized Agents                       │
    │  • SPARC Methodology                           │
    └────────────────────────────────────────────────┘
```

### Skill Discovery Process

**When Claude Code starts:**

1. **Personal Skills** (`~/.claude/skills/`)
   - Loads custom skills you've created
   - Available across all projects

2. **Project Skills** (`.claude/skills/`)
   - Loads team-shared skills
   - Version-controlled with git

3. **Built-In Skills** (from claude-flow MCP)
   - 21 pre-configured skills
   - Automatically loaded via MCP

4. **Skill Activation**
   - Claude matches task description to skill descriptions
   - Loads full skill content when matched
   - Can use multiple skills simultaneously

### Example: Full Integration

```
User Request: "Build a REST API with comprehensive tests and deploy to GitHub"

Claude Code coordinates:
┌─────────────────────────────────────────────────────────────┐
│ 1. sparc-methodology skill                                   │
│    └─> Plans systematic development phases                  │
├─────────────────────────────────────────────────────────────┤
│ 2. swarm-orchestration skill                                │
│    ├─> Spawns backend-dev agent (API implementation)        │
│    ├─> Spawns tester agent (test creation)                  │
│    └─> Spawns reviewer agent (code review)                  │
├─────────────────────────────────────────────────────────────┤
│ 3. agentdb-memory-patterns skill                            │
│    └─> Coordinates agents via shared memory                 │
├─────────────────────────────────────────────────────────────┤
│ 4. github-workflow-automation skill                         │
│    └─> Creates CI/CD pipeline                               │
├─────────────────────────────────────────────────────────────┤
│ 5. verification-quality skill                               │
│    └─> Validates output quality (0.95 threshold)            │
├─────────────────────────────────────────────────────────────┤
│ 6. reasoningbank-intelligence skill                         │
│    └─> Stores successful patterns for future use            │
└─────────────────────────────────────────────────────────────┘

MCP Tools Used:
- mcp__claude-flow__swarm_init (topology setup)
- mcp__claude-flow__agent_spawn (create agents)
- mcp__claude-flow__memory_usage (coordination)
- mcp__claude-flow__github_workflow_auto (CI/CD)

Result: Complete REST API with tests, deployed to GitHub,
        patterns stored for 46% faster next execution
```

---

## 💡 Benefits

### 1. **Context Persistence** 🧠
Unlike prompts that reset every session, Skills maintain context through AgentDB:
```javascript
// Traditional: Context lost every time
"Please analyze this API design"  // Forgets previous analyses

// With Skills: Context accumulates
AgentDB stores: [previous API patterns, success metrics, failure cases]
Skill applies: Learned best practices from 100+ prior analyses
```

### 2. **Adaptive Intelligence** 🎯
Skills learn and improve through feedback loops:
- **First run**: 70% success rate, generic approach
- **After 10 runs**: 90% success rate, optimized patterns
- **After 100 runs**: Domain expertise encoded in memory graph

### 3. **Modular Reusability** 🔧
Build once, use everywhere:
```bash
# Personal project
~/.claude/skills/api-design/

# Team repository
.claude/skills/api-design/

# Organization-wide
Shared across all Claude Code instances
```

### 4. **Multi-Agent Coordination** 🤝
Skills orchestrate complex workflows automatically:
```
Swarm Orchestration Skill:
  1. Spawn coder agent (write implementation)
  2. Spawn tester agent (write tests)
  3. Spawn reviewer agent (code review)
  4. Coordinate via shared AgentDB memory
  5. Synthesize final output
```

### 5. **Traceable Reasoning** 📊
Every decision leaves an audit trail:
- What skill was activated?
- What reasoning pattern was applied?
- What memory was retrieved from AgentDB?
- What was the confidence score?
- What feedback was recorded?

### 6. **Zero Configuration** ⚡
Skills auto-discover and self-organize:
```bash
# Create skill directory
npx agentic-flow skills init

# Create example skills
npx agentic-flow skills create

# That's it! Claude Code finds them automatically
```

---

## 🚀 Quick Start

### Prerequisites

```bash
# Verify Node.js installation
node --version    # v18.0.0 or higher
npm --version     # v9.0.0 or higher

# Option 1: Install claude-flow (includes 21 built-in skills + 213+ MCP tools)
npm install -g claude-flow@alpha
npx claude-flow --version  # Should show 2.7.0 or higher

# Option 2: Install agentic-flow (for custom skill creation)
npm install -g agentic-flow@latest
npx agentic-flow --version  # Should show 1.7.3 or higher

# Recommended: Install both for full capabilities
npm install -g claude-flow@alpha agentic-flow@latest
```

### Setup MCP Servers

```bash
# Add claude-flow MCP server (required for 21 built-in skills)
claude mcp add claude-flow npx claude-flow@alpha mcp start

# Optional: Add additional MCP servers for enhanced capabilities
claude mcp add ruv-swarm npx ruv-swarm mcp start              # Enhanced coordination
claude mcp add flow-nexus npx flow-nexus@latest mcp start    # Cloud features
claude mcp add agentic-flow npx agentic-flow@latest mcp start  # Multi-provider agents

# Verify MCP servers are running
claude mcp list

# Should show:
# claude-flow@alpha   npx claude-flow@alpha mcp start   ✓ Running
```

### Step 1: Initialize Skills Directories

```bash
# Initialize both personal and project skills
npx agentic-flow skills init
```

**What this does:**
- ✅ Creates `~/.claude/skills/` (personal, global)
- ✅ Creates `.claude/skills/` (project, version-controlled)

**Output:**
```
🎨 Initializing agentic-flow Skills
═══════════════════════════════════════════════════════════════

✓ Created personal skills directory: /home/user/.claude/skills
✓ Created project skills directory: /workspace/.claude/skills

✓ Skills directories initialized!
```

> 💡 **Pro Tip**: Personal skills are available across ALL projects. Project skills are team-shared via git.

---

### Step 2: Create Example Skills

```bash
# Create 4 built-in agentic-flow skills
npx agentic-flow skills create
```

**What you get:**
```
✓ Created 4 agentic-flow skills!

Skills installed:
  • AgentDB Vector Search    - Semantic search with vector embeddings
  • AgentDB Memory Patterns  - Memory management & persistence
  • Swarm Orchestration      - Multi-agent coordination
  • ReasoningBank Intelligence - Pattern learning & adaptation
```

**File structure:**
```
.claude/skills/
  ├── agentdb-vector-search/
  │   └── SKILL.md
  ├── agentdb-memory-patterns/
  │   └── SKILL.md
  ├── swarm-orchestration/
  │   └── SKILL.md
  └── reasoningbank-intelligence/
      └── SKILL.md
```

---

### Step 3: Install Skill Builder Framework

```bash
# Install the comprehensive skill creation framework
npx agentic-flow skills init-builder
```

**What this provides:**
- ✅ **Interactive skill generator** - Build skills through guided prompts
- ✅ **3 skill templates** - Minimal, full-featured, and advanced patterns
- ✅ **YAML validation** - Automatic frontmatter verification
- ✅ **Generation scripts** - Automated skill scaffolding
- ✅ **Best practices guide** - Industry-standard patterns
- ✅ **Example skills** - Real-world implementations

**File structure:**
```
.claude/skills/skill-builder/
  ├── SKILL.md                    # Main skill-builder skill
  ├── README.md                   # Quick reference guide
  ├── docs/
  │   ├── SPECIFICATION.md        # Complete Claude Skills spec
  │   ├── EXAMPLES.md             # Real-world examples
  │   └── BEST_PRACTICES.md       # Design patterns
  ├── scripts/
  │   ├── generate-skill.sh       # Interactive skill generator
  │   ├── validate-skill.sh       # YAML/structure validator
  │   ├── test-skill.sh           # Skill testing utility
  │   └── publish-skill.sh        # Team sharing helper
  ├── resources/
  │   ├── templates/              # Pre-built skill templates
  │   │   ├── minimal.md          # Basic skill structure
  │   │   ├── full-featured.md    # Complete with all sections
  │   │   └── advanced.md         # Multi-agent coordination
  │   └── schemas/
  │       ├── skill-schema.json   # JSON schema for validation
  │       └── frontmatter.yaml    # YAML frontmatter spec
  └── templates/                  # Working example skills
      ├── api-design-pattern.md
      ├── testing-framework.md
      └── documentation-generator.md
```

**Why use skill-builder?**
- 🚀 **10x faster** than manual skill creation
- ✅ **Guaranteed valid** YAML frontmatter
- 📝 **Best practices** automatically applied
- 🎨 **Customizable** templates for your domain
- 🔧 **Team-ready** sharing and validation tools

---

### Step 4: List All Available Skills

```bash
# See all installed skills
npx agentic-flow skills list
```

**Output:**
```
📚 Installed Claude Code Skills
═══════════════════════════════════════════════════════════════

Personal Skills (~/.claude/skills/)
  • Skill Builder
     Create new Claude Code Skills with proper YAML frontmatter...

Project Skills (.claude/skills/)
  • AgentDB Memory Patterns
     Implement persistent memory patterns for AI agents...
  • AgentDB Vector Search
     Implement semantic vector search with AgentDB...
  • Swarm Orchestration
     Orchestrate multi-agent swarms with agentic-flow...
  • ReasoningBank Intelligence
     Implement adaptive learning with ReasoningBank...
```

---

## 📚 Understanding the 4 Built-In Sample Skills

When you run `npx agentic-flow skills create`, you get 4 production-ready skills:

### 1. AgentDB Vector Search

**What it does:** Semantic search with 150x-12,500x performance improvement

**When to use:**
- Building RAG (Retrieval Augmented Generation) systems
- Implementing intelligent search in documentation
- Creating recommendation engines
- Finding similar code/content

**Key capabilities:**
```javascript
// Vector embeddings with AgentDB
await db.vectorDB.insert(embedding, {
  id: 'doc-123',
  content: 'React hooks tutorial',
  tags: ['react', 'hooks']
});

// Semantic search (finds similar meaning, not just keywords)
const results = await db.vectorDB.search(queryEmbedding, {
  k: 10,  // Top 10 results
  threshold: 0.7  // 70% similarity minimum
});
```

**Example use cases:**
- Documentation search (search by meaning)
- Code similarity detection
- Intelligent autocomplete
- Content recommendations

---

### 2. AgentDB Memory Patterns

**What it does:** Persistent memory management across sessions

**When to use:**
- Building stateful agents that remember context
- Creating chat systems with conversation history
- Implementing pattern learning
- Storing user preferences

**Key capabilities:**
```javascript
// Session memory - persists across conversations
await reasoningbank.storeMemory('user_preference', 'dark mode', {
  namespace: 'settings',
  sessionId: 'user-123'
});

// Cross-session retrieval
const prefs = await reasoningbank.queryMemories('user preferences', {
  namespace: 'settings',
  sessionId: 'user-123'
});

// Pattern learning - remember what works
await reasoningbank.storePattern({
  pattern: 'api-pagination',
  approach: 'cursor-based',
  success: true,
  confidence: 0.95
});
```

**Example use cases:**
- Chat history management
- User preference storage
- Pattern recognition
- Context persistence

---

### 3. Swarm Orchestration

**What it does:** Multi-agent coordination with intelligent task distribution

**When to use:**
- Complex tasks requiring multiple specialized agents
- Parallel code generation (frontend + backend + tests)
- Comprehensive code reviews
- Large-scale refactoring

**Key capabilities:**
```javascript
// Initialize coordinated swarm
const swarm = await initializeSwarm({
  topology: 'mesh',  // Agents communicate peer-to-peer
  agents: [
    { type: 'coder', focus: 'implementation' },
    { type: 'tester', focus: 'test coverage' },
    { type: 'reviewer', focus: 'code quality' }
  ],
  coordination: 'agentdb'  // Shared memory
});

// Agents work in parallel, share context via AgentDB
for (const agent of swarm.agents) {
  await agent.execute();  // Parallel execution
  await agentDB.store(agent.results);  // Share findings
}

// Synthesize collective intelligence
const synthesis = await agentDB.synthesize({
  namespace: 'code-review',
  strategy: 'consensus'
});
```

**Example use cases:**
- Multi-agent code generation
- Distributed code review
- Parallel testing workflows
- Complex refactoring

---

### 4. ReasoningBank Intelligence

**What it does:** Adaptive learning with 46% performance improvement

**When to use:**
- Tasks you repeat frequently (API design, testing patterns)
- Workflows that benefit from learning
- Domain-specific knowledge accumulation
- Performance optimization

**Key capabilities:**
```javascript
// Store successful patterns
await reasoningbank.storePattern({
  domain: 'api-design',
  pattern: 'authentication',
  approach: 'JWT with refresh tokens',
  metrics: {
    security: 'excellent',
    performance: 'optimized',
    maintainability: 'high'
  },
  success: true
});

// Query learned patterns
const bestApproach = await reasoningbank.queryPatterns('authentication', {
  domain: 'api-design',
  sortBy: 'success_rate'
});

// Continuous improvement - learns from each execution
// First time: generic approach
// After 10 runs: optimized with learned patterns
// After 100 runs: domain expertise
```

**Example use cases:**
- API design patterns
- Testing strategies
- Code architecture decisions
- Performance optimization

---

## 🎨 Using Skills with Claude Code

### Concept: Autonomous Skill Discovery

**Claude Code automatically discovers and uses skills** when they're relevant to your task. You don't need to explicitly invoke them. Claude decides when to apply which skill based on context.

### Workflow 1: Semantic Search Implementation

**Scenario**: You need to implement semantic search for a documentation site.

#### Step 1: Ask Claude Code

Open Claude Code and type:
```
I need to implement semantic search for our documentation.
The docs are in markdown files and I want users to search by meaning, not keywords.
```

#### Step 2: Claude Discovers the Skill

Claude Code automatically:
1. ✅ Scans `.claude/skills/`
2. ✅ Finds `agentdb-vector-search/SKILL.md`
3. ✅ Recognizes "semantic search" matches skill description
4. ✅ Loads skill instructions

#### Step 3: Claude Applies the Skill

Claude responds with:
```
I'll help you implement semantic search using AgentDB's vector search capabilities.
I found the AgentDB Vector Search skill which provides a 150x-12,500x performance
improvement over traditional search.

Here's my implementation plan:
[Detailed plan based on skill instructions...]
```

#### Step 4: Skill Execution

Claude follows the skill's reasoning pattern:
```javascript
// 1. Initialize AgentDB with vector support
import { AgentDB } from 'agentdb';

const db = new AgentDB({
  mode: 'node',
  vectorDimensions: 384,  // From skill template
  enableOptimizations: true
});

// 2. Create vector index (from skill instructions)
await db.vectorDB.createIndex({
  dimension: 384,
  metric: 'cosine'
});

// 3. Index documents with embeddings
const docs = await loadMarkdownFiles('./docs/**/*.md');
for (const doc of docs) {
  const embedding = await generateEmbedding(doc.content);
  await db.vectorDB.insert(embedding, {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    url: doc.url
  });
}

// 4. Implement search function
async function searchDocs(query) {
  const queryEmbedding = await generateEmbedding(query);
  const results = await db.vectorDB.search(queryEmbedding, {
    k: 10,
    includeMetadata: true
  });
  return results;
}
```

#### Step 5: Learning Loop

After successful execution:
```javascript
// AgentDB stores the pattern
await db.storePattern({
  skill: 'agentdb-vector-search',
  task: 'documentation search',
  approach: 'markdown indexing with 384-dim embeddings',
  performance: { searchTime: '2ms', accuracy: '95%' },
  success: true
});
```

**Next time**: Claude remembers this approach and applies it 46% faster.

---

### Workflow 2: Multi-Agent Code Review

**Scenario**: You want to review a large codebase with multiple specialized agents.

#### Step 1: Ask Claude Code

```
I need a comprehensive code review of our TypeScript backend.
Check for bugs, security issues, performance problems, and best practices.
```

#### Step 2: Claude Discovers Swarm Orchestration Skill

Claude Code:
1. ✅ Recognizes "comprehensive review" needs multiple specialized agents
2. ✅ Loads `swarm-orchestration/SKILL.md`
3. ✅ Plans multi-agent coordination

#### Step 3: Skill Orchestrates Agents

```
I'll coordinate a swarm of specialized review agents:

Spawning agents:
  1. Security Auditor - Scanning for vulnerabilities
  2. Performance Analyzer - Identifying bottlenecks
  3. Code Quality Reviewer - Checking best practices
  4. Type Safety Checker - Verifying TypeScript types

Coordination mode: Mesh topology with shared AgentDB memory
```

#### Step 4: Agents Execute in Parallel

```javascript
// Behind the scenes (from swarm-orchestration skill)
const swarm = await initializeSwarm({
  topology: 'mesh',
  agents: [
    { type: 'security', focus: 'OWASP Top 10' },
    { type: 'performance', focus: 'Big O analysis' },
    { type: 'quality', focus: 'SOLID principles' },
    { type: 'types', focus: 'TypeScript strictness' }
  ],
  coordination: 'agentdb'  // Shared memory via AgentDB
});

// Each agent stores findings in shared memory
for (const agent of swarm.agents) {
  await agent.execute();
  await agentDB.store(agent.findings, {
    namespace: 'code-review',
    agentId: agent.id
  });
}

// Synthesize final report
const allFindings = await agentDB.query({
  namespace: 'code-review',
  similarity: 'cluster'  // Group related issues
});
```

#### Step 5: Synthesized Results

Claude presents unified findings:
```
Code Review Complete (4 agents, 2,847 files analyzed in 3.2 seconds)

🔴 Critical (3):
  - SQL injection vulnerability in auth.ts:42
  - Unvalidated user input in api/users.ts:156
  - Memory leak in websocket handler

🟡 Warnings (12):
  - N+1 query pattern in database/posts.ts
  - Missing error boundaries in React components
  [...]

✅ Best Practices (8 suggestions):
  - Consider using dependency injection
  - Add JSDoc comments for public APIs
  [...]

Performance Analysis:
  - Average response time: 45ms → could be 12ms with caching
  - Database queries: 234 → could be 67 with batching
```

---

### Workflow 3: Adaptive Learning with ReasoningBank

**Scenario**: You're building a REST API and want Claude to learn your patterns.

#### Step 1: First API Implementation

```
Create a REST API endpoint for user registration.
```

Claude (first time, generic approach):
```javascript
// Basic implementation (no prior learning)
app.post('/api/users', async (req, res) => {
  const user = await User.create(req.body);
  res.json(user);
});
```

**Result**: Works but missing validation, error handling, security.

#### Step 2: Feedback & Learning

```
This needs better error handling, validation, and security.
```

Claude improves and stores the pattern:
```javascript
// Improved implementation
app.post('/api/users', [
  validateRequest(userSchema),    // Added validation
  sanitizeInput(),                 // Added sanitization
  async (req, res, next) => {
    try {
      const user = await User.create(req.body);
      res.status(201).json({
        success: true,
        data: user
      });
    } catch (error) {
      next(error);  // Proper error handling
    }
  }
]);

// AgentDB stores this pattern via ReasoningBank skill
await reasoningbank.storePattern({
  domain: 'rest-api',
  pattern: 'user-registration',
  approach: 'validation + sanitization + try-catch',
  confidence: 0.95
});
```

#### Step 3: Second API Implementation (Learning Applied)

```
Create a REST API endpoint for password reset.
```

Claude (with learned patterns):
```javascript
// Automatically applies learned patterns!
app.post('/api/auth/reset-password', [
  validateRequest(passwordResetSchema),  // ✅ Remembered validation
  sanitizeInput(),                       // ✅ Remembered sanitization
  rateLimiter({ max: 5, window: '15m' }), // ✅ Added security best practice
  async (req, res, next) => {
    try {
      const token = await generateResetToken(req.body.email);
      await sendResetEmail(req.body.email, token);

      res.status(200).json({
        success: true,
        message: 'Reset email sent'
      });
    } catch (error) {
      next(error);  // ✅ Proper error handling
    }
  }
]);
```

**Result**: 46% faster implementation, 90%+ best practices compliance, zero manual reminders.

---

## 🤖 Using Skills with Claude Agent SDK & agentic-flow Agents

### Concept: Programmatic Skill Execution

The **Claude Agent SDK** (released October 2025) enables programmatic agent development with Skills support. **agentic-flow** extends the SDK with multi-agent coordination, persistent memory, and vector search.

### Claude Agent SDK Integration

**Official SDK usage with Skills:**
```typescript
import { Agent } from '@anthropic-ai/claude-agent-sdk';

// Create agent (auto-discovers skills in ~/.claude/skills/)
const agent = new Agent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-5-20250929',
  skillsDir: './.claude/skills'  // Project-specific skills
});

// Agent automatically uses relevant skills
const result = await agent.run({
  task: 'Implement semantic search for our documentation'
});

// Skills are loaded automatically based on task description matching
```

### agentic-flow Enhancement of Claude Agent SDK

**agentic-flow adds enterprise capabilities:**

```javascript
import * as agenticFlow from 'agentic-flow';
import { AgentDB } from 'agentdb';

// Initialize with AgentDB memory backend
const db = new AgentDB({
  mode: 'node',
  vectorDimensions: 384,
  enableOptimizations: true
});

// Initialize ReasoningBank with AgentDB
await agenticFlow.reasoningbank.initialize({
  backend: 'agentdb',
  db
});

// Run agent with persistent learning
const agent = await agenticFlow.createAgent({
  type: 'coder',
  model: 'claude-sonnet-4-5-20250929',
  skillsDir: './.claude/skills',
  memory: db,  // Persistent memory across sessions
  learning: true  // Enable ReasoningBank pattern learning
});

// Execute task - skills auto-discovered + patterns learned
const result = await agent.execute({
  task: 'Implement semantic search for our documentation'
});

// Pattern automatically stored in AgentDB for future use
// Next time: 46% faster with learned patterns
```

### Multi-Agent Coordination with Skills

**agentic-flow swarm orchestration:**

```javascript
import * as agenticFlow from 'agentic-flow';

// Initialize swarm with shared AgentDB memory
const swarm = await agenticFlow.swarm.initialize({
  topology: 'mesh',  // Agents communicate peer-to-peer
  agents: [
    {
      type: 'researcher',
      skillsDir: './.claude/skills',  // All agents share skills
      memory: 'shared'  // Shared AgentDB instance
    },
    {
      type: 'coder',
      skillsDir: './.claude/skills',
      memory: 'shared'
    },
    {
      type: 'tester',
      skillsDir: './.claude/skills',
      memory: 'shared'
    }
  ],
  coordination: {
    backend: 'agentdb',  // Coordinate via vector memory
    consensus: 'majority'  // Decision-making strategy
  }
});

// Orchestrate task across multiple agents
// Each agent uses relevant skills + shares learnings via AgentDB
const result = await swarm.orchestrate({
  task: 'Build a REST API with comprehensive tests'
});

// All agents contribute patterns to shared memory
// Future executions benefit from collective intelligence
```

### Skills + Claude Agent SDK + agentic-flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User Application                      │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │  Claude Agent SDK       │  ← Official Anthropic SDK
        │  - Agent creation       │
        │  - Skill discovery      │
        │  - Task execution       │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │  agentic-flow Layer     │  ← Enterprise features
        │  - Multi-agent swarms   │
        │  - AgentDB integration  │
        │  - ReasoningBank        │
        │  - Skill-builder        │
        └────────────┬────────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
┌────▼─────┐  ┌─────▼──────┐  ┌────▼──────┐
│  Skills  │  │  AgentDB   │  │ Reasoning │
│ (.claude)│  │  (Memory)  │  │   Bank    │
└──────────┘  └────────────┘  └───────────┘
```

While Claude Code uses skills automatically, you can also invoke them programmatically via the agentic-flow agent system.

### Agent + Skill Integration

```bash
# Run an agent with specific skill context
npx agentic-flow \
  --agent coder \
  --task "Implement semantic search" \
  --skill agentdb-vector-search
```

**What happens:**
1. Agent loads with skill's reasoning patterns pre-loaded
2. Skill provides domain-specific context
3. Agent applies skill patterns to the task
4. Results stored in AgentDB for future learning

### Example: Full-Stack Application with Skills

```bash
# Scenario: Build a complete app with coordinated agents
npx agentic-flow \
  --agent swarm \
  --task "Build a todo app with React + Node + PostgreSQL" \
  --skill swarm-orchestration
```

**Behind the scenes:**
```javascript
// swarm-orchestration skill coordinates multiple agents
const swarm = {
  agents: [
    { type: 'backend-dev', task: 'Build Node/Express API', skill: 'api-patterns' },
    { type: 'frontend-dev', task: 'Build React UI', skill: 'react-patterns' },
    { type: 'database-architect', task: 'Design PostgreSQL schema', skill: 'db-design' },
    { type: 'tester', task: 'Write Jest tests', skill: 'testing-patterns' },
    { type: 'reviewer', task: 'Code review', skill: 'quality-checks' }
  ],
  coordination: {
    memory: 'agentdb',      // Shared context
    topology: 'hierarchical', // Backend → Frontend → Tests
    feedback: 'continuous'    // Real-time learning
  }
};

// Execute with skill-guided reasoning
for (const agent of swarm.agents) {
  const skillContext = await loadSkill(agent.skill);
  const result = await agent.execute({
    task: agent.task,
    context: skillContext,
    sharedMemory: agentDB
  });

  // Store patterns for future use
  await reasoningbank.learn(result);
}
```

**Output**: Complete app in minutes with learned best practices applied.

---

## 🛠️ Creating Custom Skills

### When to Create a Custom Skill

Create a skill when you have a **repeatable reasoning pattern** that:
- ✅ You use frequently across projects
- ✅ Requires domain-specific knowledge
- ✅ Benefits from learning and adaptation
- ✅ Needs coordination with other skills/agents

### Method 1: Using Skill Builder (Recommended)

The skill-builder framework provides **3 ways** to create skills:

#### Option A: Interactive Generation with Claude Code

**Step 1: Ask Claude Code to use skill-builder**

```
Use the skill-builder to create a custom skill for GraphQL API design.
I want it to cover schema design, resolvers, and performance optimization.
```

**Step 2: Claude discovers and uses skill-builder skill**

Claude (automatically loads skill-builder skill):
```
I'll help you create a GraphQL API Design skill using the skill-builder framework.

Following the skill-builder template...
✓ Analyzing requirements
✓ Selecting template: full-featured (comprehensive with examples)
✓ Generating YAML frontmatter
✓ Creating progressive disclosure structure
✓ Adding code examples
✓ Validating skill structure

Creating: .claude/skills/graphql-api-design/SKILL.md
```

**Step 3: Claude generates a complete skill**

```yaml
---
name: "GraphQL API Design"
description: "Design GraphQL APIs following best practices for schema design,
resolvers, and performance. Use when building or refactoring GraphQL services."
---

# GraphQL API Design

## What This Skill Does
Guides the design of GraphQL APIs with focus on schema-first development,
efficient resolvers, and query optimization.

## When to Use
- Designing new GraphQL schemas
- Refactoring existing APIs
- Optimizing query performance
- Implementing federation

## Prerequisites
- Node.js 18+
- GraphQL 16+
- Apollo Server or similar

## Quick Start

### 1. Schema Design
\`\`\`graphql
# Design schema with clear types
type User {
  id: ID!
  email: String!
  posts: [Post!]!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
}
\`\`\`

### 2. Resolver Pattern
\`\`\`javascript
const resolvers = {
  Query: {
    user: async (_, { id }, { dataSources }) => {
      return dataSources.userAPI.getUser(id);
    }
  },
  User: {
    posts: async (user, _, { dataSources }) => {
      return dataSources.postAPI.getPostsByUserId(user.id);
    }
  }
};
\`\`\`

### 3. Performance Optimization
- Use DataLoader for N+1 query prevention
- Implement query complexity analysis
- Add caching layers
- Monitor resolver timing

## Advanced Patterns
[Detailed federation, subscriptions, etc...]

## Learn More
- Schema design principles
- Resolver best practices
- Performance optimization strategies
```

#### Step 3: Skill is Auto-Discovered

```bash
# Verify it's available
npx agentic-flow skills list

# Output includes:
# • GraphQL API Design
#    Design GraphQL APIs following best practices...
```

---

### Method 2: Manual Creation

#### Step 1: Create Directory

```bash
mkdir -p .claude/skills/my-custom-skill
```

#### Step 2: Create SKILL.md

```bash
cat > .claude/skills/my-custom-skill/SKILL.md << 'EOF'
---
name: "My Custom Skill"
description: "Brief description of what this skill does and when to use it.
Maximum 1024 characters."
---

# My Custom Skill

## What This Skill Does
Explain the skill's purpose clearly.

## When to Use
- Use case 1
- Use case 2

## Prerequisites
- Requirement 1
- Requirement 2

## Quick Start
Step-by-step instructions...

EOF
```

#### Step 3: Validate

```bash
# Use skill-builder to validate
npx agentic-flow skills validate .claude/skills/my-custom-skill/SKILL.md
```

**Output:**
```
✓ YAML frontmatter valid
✓ Name field present (64 char max)
✓ Description field present (1024 char max)
✓ Markdown structure valid
✓ Skill ready to use
```

---

## 🚀 Advanced Workflows

### Workflow 1: Using Skill Builder to Create Domain-Specific Skills

**Scenario**: Your team builds microservices with Node.js and wants standardized patterns.

#### Step 1: Generate microservice design skill

Ask Claude Code:
```
Use skill-builder to create a skill for microservice architecture design.
Include service boundaries, communication patterns, and observability.
Base it on our Node.js + Docker + Kubernetes stack.
```

Claude (using skill-builder):
```
Creating "Microservice Architecture Design" skill...

✓ Analyzing domain: microservices, Node.js, K8s
✓ Loading template: advanced (multi-agent coordination)
✓ Generating sections:
  - Service boundary patterns
  - Communication strategies (sync/async)
  - Observability stack (logs, metrics, traces)
  - Deployment patterns
  - Testing strategies
✓ Adding tech-specific examples (Node.js, Docker, K8s)
✓ Validating against Claude Skills specification

Created: .claude/skills/microservice-architecture-design/SKILL.md
```

#### Step 2: Generate companion testing skill

```
Use skill-builder to create a microservice testing skill.
Cover unit, integration, contract, and E2E testing.
```

Claude generates:
```
.claude/skills/microservice-testing-patterns/SKILL.md
```

#### Step 3: Use both skills together

```
Design and implement a payment microservice with complete test coverage.
```

Claude Code:
1. ✅ Discovers `microservice-architecture-design` skill
2. ✅ Applies service boundary patterns
3. ✅ Discovers `microservice-testing-patterns` skill
4. ✅ Generates comprehensive test suite
5. ✅ Stores learned patterns in AgentDB for future projects

**Result**: Consistent microservice architecture across your entire team.

---

### Workflow 2: Skill Builder + AgentDB Learning Loop

**Scenario**: Build a skill that gets smarter with each use.

#### Step 1: Create adaptive skill

```
Use skill-builder to create a React performance optimization skill.
Make it learn from each optimization and improve recommendations.
```

Claude generates skill with ReasoningBank integration:
```yaml
---
name: "React Performance Optimization"
description: "Adaptive React optimization with learning from past improvements.
Uses ReasoningBank to remember successful patterns."
---

# React Performance Optimization

## Quick Start

### 1. Profile Current Performance
\`\`\`javascript
// ReasoningBank checks: Have we optimized similar components?
const priorOptimizations = await reasoningbank.queryPatterns('react-perf', {
  componentType: 'data-table',
  sortBy: 'impact'
});

// Apply learned patterns automatically
if (priorOptimizations.length > 0) {
  console.log('Applying learned patterns:', priorOptimizations[0].approach);
}
\`\`\`

### 2. Apply Optimizations
[Skill guides through optimizations...]

### 3. Store Results
\`\`\`javascript
// After optimization, record results
await reasoningbank.storePattern({
  domain: 'react-perf',
  componentType: 'data-table',
  approach: 'virtualization + memoization',
  metrics: {
    beforeFPS: 15,
    afterFPS: 60,
    improvement: '4x'
  },
  success: true
});
\`\`\`
```

#### Step 2: Use the skill multiple times

**First use:**
```
Optimize this React data table component.
```

Claude applies generic best practices (no prior learning).

**After 5 uses:**
Claude now knows:
- Virtualization works best for >1000 rows
- useMemo is critical for computed columns
- React.memo prevents unnecessary rerenders

**After 20 uses:**
Claude has domain expertise:
- Automatically suggests optimal patterns
- Predicts performance impact
- Applies 95%+ best practices without prompting

---

### Workflow 3: Cross-Skill Composition

Skills can reference and coordinate with each other:

```yaml
---
name: "Full-Stack E-Commerce Platform"
description: "Build complete e-commerce platform coordinating multiple skills."
---

# Full-Stack E-Commerce Platform

## Skill Dependencies
This meta-skill orchestrates:
1. `microservice-architecture-design` - Backend services
2. `react-performance-optimization` - Frontend performance
3. `agentdb-vector-search` - Product search
4. `swarm-orchestration` - Multi-agent coordination
5. `reasoningbank-intelligence` - Pattern learning

## Execution Flow
1. **Architecture Phase** (microservice-architecture-design)
   - Design service boundaries
   - Define communication patterns
   - Plan data consistency strategy

2. **Implementation Phase** (swarm-orchestration)
   - Spawn: Backend team (payment, catalog, user services)
   - Spawn: Frontend team (React components)
   - Spawn: Testing team (contract + E2E tests)
   - Coordinate via AgentDB shared memory

3. **Optimization Phase** (react-performance-optimization, agentdb-vector-search)
   - Optimize product catalog rendering
   - Implement semantic product search
   - Add intelligent recommendations

4. **Learning Phase** (reasoningbank-intelligence)
   - Store successful patterns
   - Record performance metrics
   - Prepare for next e-commerce project
```

**Using this meta-skill:**
```
Build an e-commerce platform for selling digital products.
```

Claude Code orchestrates all 5 skills automatically!

### Workflow 2: Feedback-Driven Skill Evolution

Skills improve through usage:

```javascript
// After each execution, store metrics
await reasoningbank.recordExecution({
  skill: 'graphql-api-design',
  task: 'user-service-schema',
  approach: 'federation with dataloaders',
  metrics: {
    executionTime: '2.3s',
    queryComplexity: 'optimized',
    resolverEfficiency: '98%'
  },
  success: true,
  feedback: 'Excellent performance, will use this pattern again'
});

// Next time: Skill adapts based on learned patterns
```

### Workflow 4: Team-Wide Skill Sharing and Customization

#### Sharing Skills Across Your Team

```bash
# 1. Create team-specific skills in project directory
cd /your-project
npx agentic-flow skills init  # Creates .claude/skills/

# 2. Generate team skills with skill-builder
# Ask Claude Code:
"Use skill-builder to create our team's API design standards skill.
Include our preferred patterns: REST with OpenAPI, JWT auth,
cursor pagination, and error handling standards."

# 3. Commit to version control
git add .claude/skills/
git commit -m "feat: Add team API design standards skill"
git push origin main

# 4. Team members pull and use automatically
git pull
# Claude Code discovers team skills on next run
```

#### Customizing Sample Skills for Your Stack

**Scenario**: You love the AgentDB vector search skill but use Python, not JavaScript.

```bash
# 1. Copy the sample skill
cp -r .claude/skills/agentdb-vector-search \
      .claude/skills/agentdb-python-search

# 2. Edit and customize
code .claude/skills/agentdb-python-search/SKILL.md
```

**Update code examples to Python:**
```yaml
---
name: "AgentDB Vector Search (Python)"
description: "Semantic vector search with AgentDB for Python projects.
150x-12,500x performance improvement. Use for RAG systems and semantic search."
---

# AgentDB Vector Search (Python)

## Quick Start

### 1. Installation
\`\`\`bash
pip install agentdb
\`\`\`

### 2. Initialize
\`\`\`python
from agentdb import AgentDB

db = AgentDB(
    mode='python',
    vector_dimensions=384,
    enable_optimizations=True
)
\`\`\`

### 3. Index Documents
\`\`\`python
# Generate embeddings
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')

docs = load_documents('./docs/**/*.md')
for doc in docs:
    embedding = model.encode(doc.content)
    db.vector_db.insert(
        embedding=embedding,
        metadata={
            'id': doc.id,
            'title': doc.title,
            'content': doc.content
        }
    )
\`\`\`

### 4. Semantic Search
\`\`\`python
query = "How do I implement authentication?"
query_embedding = model.encode(query)

results = db.vector_db.search(
    query_embedding,
    k=10,
    threshold=0.7
)

for result in results:
    print(f"{result.score:.2f} - {result.metadata['title']}")
\`\`\`
```

**Now Claude Code applies Python patterns automatically:**
```
Implement semantic search for our Python documentation.
```

Claude discovers your customized Python skill and generates Python code!

---

#### Creating Organization-Wide Skill Library

**For enterprises with multiple teams:**

```bash
# 1. Create organization skill repository
git clone https://github.com/your-org/claude-skills.git ~/.claude/skills-org

# 2. Symlink org skills to personal directory
ln -s ~/.claude/skills-org/* ~/.claude/skills/

# 3. Keep skills updated
cd ~/.claude/skills-org
git pull

# Now all org skills available in all projects!
```

**Organization skill structure:**
```
~/.claude/skills-org/
  ├── security/
  │   ├── owasp-top-10/SKILL.md
  │   └── security-review/SKILL.md
  ├── api-design/
  │   ├── rest-standards/SKILL.md
  │   └── graphql-patterns/SKILL.md
  ├── testing/
  │   ├── unit-testing/SKILL.md
  │   └── e2e-testing/SKILL.md
  └── deployment/
      ├── kubernetes-deploy/SKILL.md
      └── ci-cd-pipeline/SKILL.md
```

**Benefits:**
- ✅ Consistent standards across all teams
- ✅ Centralized best practices
- ✅ Easy updates (git pull)
- ✅ Version controlled
- ✅ Team-specific customization still possible

---

#### Publishing Skills to NPM (Advanced)

**For skill creators who want to share with the community:**

```bash
# 1. Create skill package
mkdir agentic-flow-skills-web3
cd agentic-flow-skills-web3

# 2. Package structure
cat > package.json << 'EOF'
{
  "name": "agentic-flow-skills-web3",
  "version": "1.0.0",
  "description": "Claude Code skills for Web3 development",
  "keywords": ["agentic-flow", "claude-code", "skills", "web3"],
  "files": ["skills/"],
  "scripts": {
    "postinstall": "mkdir -p ~/.claude/skills && cp -r skills/* ~/.claude/skills/"
  }
}
EOF

# 3. Add your skills
mkdir -p skills/
cp -r .claude/skills/solidity-patterns skills/
cp -r .claude/skills/smart-contract-security skills/

# 4. Publish
npm publish

# 5. Users install with:
npm install -g agentic-flow-skills-web3
# Skills automatically copied to ~/.claude/skills/
```

---

## 🛠️ Skill Builder Advanced Features

### Template System

Skill-builder includes 3 production templates:

#### 1. Minimal Template (5 sections, ~100 lines)
**Best for:** Simple, focused skills with single responsibility

```yaml
---
name: "Code Formatter"
description: "Format code with Prettier/ESLint standards."
---

# Code Formatter

## What This Skill Does
Applies consistent code formatting.

## When to Use
- Before committing code
- Enforcing team standards

## Quick Start
[Basic formatting commands...]

## Examples
[2-3 code examples]

## Learn More
[Links to docs]
```

---

#### 2. Full-Featured Template (12 sections, ~300 lines)
**Best for:** Comprehensive skills with multiple use cases

```yaml
---
name: "API Design Patterns"
description: "Design REST/GraphQL APIs following industry best practices."
---

# API Design Patterns

## What This Skill Does
[Detailed description]

## When to Use
[5+ use cases]

## Prerequisites
[Requirements]

## Quick Start
[Getting started]

## Step-by-Step Guide
[Detailed walkthrough]

## Advanced Patterns
[Complex scenarios]

## Best Practices
[Industry standards]

## Common Pitfalls
[What to avoid]

## Troubleshooting
[Solutions to common issues]

## Examples
[10+ real-world examples]

## Reference
[Complete API docs]

## Learn More
[External resources]
```

---

#### 3. Advanced Template (15+ sections, ~500 lines)
**Best for:** Multi-agent coordination and complex workflows

```yaml
---
name: "Full-Stack Application Builder"
description: "Coordinate multiple agents to build complete applications."
---

# Full-Stack Application Builder

## What This Skill Does
[Orchestration overview]

## Skill Dependencies
- backend-api-design
- frontend-react-patterns
- database-optimization
- testing-frameworks
- deployment-automation

## Multi-Agent Coordination
[How agents collaborate]

## Prerequisites
[Tech stack requirements]

## Architecture Overview
[System design patterns]

## Phase 1: Planning
[Requirements analysis]

## Phase 2: Backend Development
[API implementation with coordination]

## Phase 3: Frontend Development
[UI implementation with coordination]

## Phase 4: Integration
[Connecting frontend + backend]

## Phase 5: Testing
[Comprehensive test strategy]

## Phase 6: Deployment
[CI/CD pipeline]

## Agent Communication Patterns
[How agents share context via AgentDB]

## Learning & Optimization
[ReasoningBank integration]

## Monitoring & Observability
[Performance tracking]

## Troubleshooting
[Debug multi-agent issues]

## Examples
[Complete application examples]
```

---

### Validation System

**Built-in validation checks:**

```bash
bash .claude/skills/skill-builder/scripts/validate-skill.sh my-skill/SKILL.md
```

**Checks performed:**
1. ✅ **YAML Frontmatter**
   - Valid YAML syntax
   - Required fields (name, description)
   - Field length limits
   - No special characters

2. ✅ **Markdown Structure**
   - Proper heading hierarchy
   - Code block formatting
   - Link validity
   - No broken references

3. ✅ **Progressive Disclosure**
   - Quick Start section exists
   - Complexity increases gradually
   - Advanced sections at end

4. ✅ **Code Examples**
   - Syntax highlighting specified
   - No placeholder code
   - Runnable examples

5. ✅ **Security**
   - No hardcoded secrets
   - No sensitive data
   - Safe command examples

**Example validation output:**
```
🔍 Validating: microservice-patterns/SKILL.md
═══════════════════════════════════════════════

✓ YAML frontmatter: Valid
  - name: "Microservice Patterns" (21 chars)
  - description: 487 chars (max 1024)

✓ Markdown structure: Valid
  - 12 sections
  - Proper heading hierarchy
  - 18 code blocks

✓ Progressive disclosure: Excellent
  - Quick Start: 5 min read
  - Step-by-Step: 15 min
  - Advanced: 30+ min

✓ Code examples: 18 found
  - All have syntax highlighting
  - All runnable

✓ Security: No issues

✅ Skill ready for use!

Next steps:
  1. Test with Claude Code
  2. Share with team (git commit)
  3. Publish to npm (optional)
```

---

### Generation Scripts

#### Interactive Generator

```bash
bash .claude/skills/skill-builder/scripts/generate-skill.sh
```

**Features:**
- Guided prompts for all metadata
- Template selection
- Auto-validation
- Section customization
- Example code generation

**Example session:**
```
🎨 agentic-flow Skill Generator
═══════════════════════════════════════

Let's create a new skill!

Skill name: Database Query Optimization
Description: Optimize SQL queries with indexing, query
             planning, and performance analysis.

Category:
  1. api-design
  2. testing
  3. database       ← Selected
  4. documentation
  5. custom

Template:
  1. minimal        (Quick reference)
  2. full-featured  ← Selected (Comprehensive guide)
  3. advanced       (Multi-agent coordination)

Include sections:
  [✓] Quick Start
  [✓] Prerequisites
  [✓] Step-by-Step Guide
  [✓] Examples (how many? 10)
  [✓] Best Practices
  [✓] Troubleshooting
  [ ] Advanced Patterns (optional)

Generate code examples?
  Technology: PostgreSQL
  Examples: [indexes, query plans, EXPLAIN ANALYZE]

✓ Generating skill...
✓ Adding 10 examples...
✓ Validating...
✓ Success!

Created: .claude/skills/database-query-optimization/SKILL.md

Test it:
  "Optimize this slow database query: SELECT * FROM users..."
```

#### Batch Generator

**Create multiple skills at once:**

```bash
bash .claude/skills/skill-builder/scripts/batch-generate.sh skills.yaml
```

**skills.yaml:**
```yaml
skills:
  - name: "API Authentication"
    description: "JWT, OAuth2, and session-based auth patterns"
    template: full-featured
    category: api-design

  - name: "React Component Library"
    description: "Build reusable React components"
    template: full-featured
    category: frontend

  - name: "Docker Compose Workflows"
    description: "Multi-container development environments"
    template: minimal
    category: devops
```

**Output:**
```
🎨 Batch Skill Generator
═══════════════════════════════════════

Processing 3 skills...

✓ [1/3] API Authentication
✓ [2/3] React Component Library
✓ [3/3] Docker Compose Workflows

All skills created successfully!

Skills available:
  • api-authentication
  • react-component-library
  • docker-compose-workflows

Test them with Claude Code!
```

---

### Testing Skills

**Test script validates skill functionality:**

```bash
bash .claude/skills/skill-builder/scripts/test-skill.sh \
     database-query-optimization/SKILL.md
```

**Test scenarios:**
1. **Discovery Test**: Can Claude Code find the skill?
2. **Activation Test**: Does it activate for relevant queries?
3. **Execution Test**: Does it provide correct guidance?
4. **Learning Test**: Does it store patterns in AgentDB?

**Example output:**
```
🧪 Testing Skill: database-query-optimization
═══════════════════════════════════════════════

Test 1: Discovery
  Query: "List installed skills"
  ✓ Skill appears in list

Test 2: Activation
  Query: "Optimize this slow query"
  ✓ Skill automatically activated

Test 3: Execution
  Query: "Add index to speed up user lookups"
  ✓ Provided correct guidance
  ✓ Generated runnable SQL
  ✓ Explained trade-offs

Test 4: Learning
  ✓ Pattern stored in AgentDB
  ✓ Confidence score: 0.92

Test 5: Repeated Use
  Query: "Optimize another user query"
  ✓ Applied learned patterns
  ✓ 38% faster than first execution

✅ All tests passed!

Skill performance:
  - Activation rate: 95%
  - Correctness: 100%
  - Learning improvement: 38%
```

---

## ✅ Best Practices

### 1. **Skill Naming**
```
✅ Good: "GraphQL API Design"
❌ Bad: "gql" or "api_design_123"

✅ Good: "React Component Patterns"
❌ Bad: "ReactStuff"
```

### 2. **Description Clarity**
```yaml
✅ Good:
description: "Design GraphQL APIs with schema-first development,
efficient resolvers, and federation. Use when building or
refactoring GraphQL services."

❌ Bad:
description: "GraphQL stuff"
```

### 3. **Progressive Disclosure**
```markdown
✅ Good Structure:
## Quick Start (5 minutes)
Basic usage

## Step-by-Step Guide (15 minutes)
Detailed walkthrough

## Advanced Patterns (30+ minutes)
Complex scenarios

## Reference
Complete API docs
```

### 4. **Use AgentDB for Context**
```javascript
✅ Good:
await reasoningbank.storePattern({
  skill: 'api-design',
  pattern: 'pagination',
  approach: 'cursor-based',
  performance: 'excellent'
});

❌ Bad:
// No learning loop, patterns forgotten
```

### 5. **Skill Composition**
```yaml
✅ Good:
# Reference other skills
See also: `agentdb-vector-search`, `swarm-orchestration`

❌ Bad:
# Duplicate instructions from other skills
```

---

## 🐛 Troubleshooting

### Issue: Skills Not Discovered

**Problem**: Claude Code doesn't find your skill.

**Solutions**:
```bash
# 1. Verify skill location (MUST be top level!)
ls ~/.claude/skills/          # Personal
ls .claude/skills/            # Project

# Should see: my-skill/SKILL.md
# NOT: subdirectory/my-skill/SKILL.md

# 2. Validate YAML frontmatter
npx agentic-flow skills validate .claude/skills/my-skill/SKILL.md

# 3. Restart Claude Code
# Skills are loaded at startup

# 4. Check file permissions
chmod 644 .claude/skills/my-skill/SKILL.md
```

### Issue: Skill Executes Incorrectly

**Problem**: Skill loads but doesn't work as expected.

**Solutions**:
```bash
# 1. Check skill description matches use case
npx agentic-flow skills list

# 2. Add debugging context
await reasoningbank.debug({
  skill: 'my-skill',
  context: 'What am I trying to do?',
  expected: 'What should happen?',
  actual: 'What actually happened?'
});

# 3. Review skill instructions
cat .claude/skills/my-skill/SKILL.md
```

### Issue: Skills Conflict

**Problem**: Multiple skills activate for same task.

**Solution**:
```yaml
# Make descriptions more specific
❌ description: "Build APIs"
✅ description: "Build REST APIs with Express and TypeScript.
                Use for traditional RESTful services, not GraphQL."
```

---

## 🎯 Summary

### What You Learned

✅ **21 Built-In Skills** from claude-flow (AI, GitHub, Swarm, SPARC, Performance)
✅ **Custom Skill Creation** with agentic-flow's skill-builder
✅ **213+ MCP Tools** for coordination, memory, and automation
✅ **54 Specialized Agents** for all development scenarios
✅ **Dual-System Integration** combining pre-built + custom capabilities
✅ **AgentDB + ReasoningBank** for persistent learning (46% faster over time)
✅ **Skills compose and coordinate** for complex multi-agent workflows

### Quick Reference

#### claude-flow (Built-In Skills)
```bash
# Install and setup MCP server
npm install -g claude-flow@alpha
claude mcp add claude-flow npx claude-flow@alpha mcp start

# Verify 21 skills are available
claude mcp list

# Skills auto-discovered by Claude Code - no additional setup!
```

#### agentic-flow (Custom Skills)
```bash
# Initialize skill directories
npx agentic-flow skills init

# Create 4 sample skills
npx agentic-flow skills create

# List all skills (built-in + custom)
npx agentic-flow skills list

# Install skill builder framework
npx agentic-flow skills init-builder

# Validate custom skill
npx agentic-flow skills validate <path>
```

#### Combined Usage
```bash
# Install both systems
npm install -g claude-flow@alpha agentic-flow@latest

# Setup MCP servers
claude mcp add claude-flow npx claude-flow@alpha mcp start

# Create custom skills
npx agentic-flow skills init
npx agentic-flow skills create

# Now you have:
# ✅ 21 built-in claude-flow skills
# ✅ 4 sample agentic-flow skills
# ✅ 213+ MCP coordination tools
# ✅ 54 specialized agents
# ✅ Custom skill creation framework
```

### Skill Categories Available

| Category | claude-flow Built-In | agentic-flow Custom | Total |
|----------|---------------------|---------------------|-------|
| AI & Memory | 3 | 2 | 5 |
| GitHub Integration | 5 | 0 | 5 |
| Swarm Orchestration | 4 | 1 | 5 |
| Development & Quality | 3 | 0 | 3 |
| Flow Nexus Platform | 3 | 0 | 3 |
| **Total** | **21** | **4** | **25** |

Plus unlimited custom skills you create!

### Next Steps

1. **Install claude-flow MCP**: Get 21 built-in skills instantly
2. **Try built-in skills**: Test agentdb-vector-search, swarm-orchestration, github-code-review
3. **Install agentic-flow**: Add custom skill creation capabilities
4. **Create your first custom skill**: Use skill-builder for your domain
5. **Build multi-agent workflows**: Combine claude-flow + custom skills
6. **Explore MCP tools**: 213+ coordination tools available
7. **Share with your team**: Commit custom skills to git
8. **Join the community**: Share your skills on GitHub

### Integration Patterns

**Simple Task (1 skill):**
```
User: "Implement semantic search"
→ agentdb-vector-search skill (built-in)
→ Done in minutes
```

**Complex Task (multiple skills):**
```
User: "Build REST API with tests and deploy"
→ sparc-methodology (planning)
→ swarm-orchestration (parallel dev)
→ agentdb-memory-patterns (coordination)
→ github-workflow-automation (CI/CD)
→ verification-quality (validation)
→ reasoningbank-intelligence (learning)
→ Complete production-ready system
```

**Custom Domain (built-in + custom):**
```
1. Use claude-flow built-in: swarm-orchestration
2. Create custom: your-company-api-standards (agentic-flow)
3. Combine: Company-specific development with best practices
4. Learn: Patterns stored for 46% faster next time
```

---

## 🌐 Resources

### claude-flow
- **Repository**: [https://github.com/ruvnet/claude-flow](https://github.com/ruvnet/claude-flow)
- **Wiki**: [claude-flow wiki](https://github.com/ruvnet/claude-flow/wiki)
- **21 Built-In Skills**: Available via MCP server
- **213+ MCP Tools**: Coordination, memory, GitHub, neural patterns
- **54 Agents**: Core dev to advanced distributed systems

### agentic-flow
- **Documentation**: [agentic-flow docs](https://github.com/ruvnet/agentic-flow/tree/main/docs)
- **Examples**: [Example skills](https://github.com/ruvnet/agentic-flow/tree/main/examples)
- **AgentDB**: [agentdb package](https://github.com/ruvnet/agentdb)
- **skill-builder**: Custom skill creation framework
- **Issues**: [GitHub Issues](https://github.com/ruvnet/agentic-flow/issues)

### Official Anthropic
- **Claude Code**: [Official docs](https://docs.claude.com/en/docs/claude-code)
- **Claude Skills Specification**: [Skills guide](https://docs.claude.com/en/docs/claude-code/skills)
- **Agent SDK**: [Agent development](https://docs.claude.com/en/docs/agent-sdk)

---

## 📊 Performance Metrics

### With claude-flow + agentic-flow Integration:

- **84.8% SWE-Bench solve rate** (vs industry avg 43%)
- **32.3% token reduction** through intelligent coordination
- **2.8-4.4x speed improvement** with parallel agent execution
- **46% faster** on repeated tasks (ReasoningBank learning)
- **150x-12,500x faster search** (AgentDB vector operations)
- **27+ neural models** for pattern recognition
- **0.95 accuracy threshold** for quality verification

---

**Version**: claude-flow v2.0 + agentic-flow v1.7.3
**Philosophy**: Pre-built excellence + custom specialization
**Architecture**: 21 built-in skills + unlimited custom + 213+ MCP tools
**Result**: Enterprise-grade adaptive intelligence that learns how to think

🚀 **Start building adaptive AI systems today:**

```bash
# Full installation (recommended)
npm install -g claude-flow@alpha agentic-flow@latest

# Setup MCP server for built-in skills
claude mcp add claude-flow npx claude-flow@alpha mcp start

# Create custom skills
npx agentic-flow skills init
npx agentic-flow skills create
npx agentic-flow skills init-builder

# You now have access to:
# ✅ 21 claude-flow built-in skills
# ✅ 4 agentic-flow sample skills
# ✅ 213+ MCP coordination tools
# ✅ 54 specialized agents
# ✅ Custom skill creation framework
# ✅ AgentDB vector memory
# ✅ ReasoningBank pattern learning
# ✅ SPARC methodology
# ✅ Complete GitHub integration

# Ready to build production AI systems! 🎯
```
