# Configuration Reference

Complete reference for V3 init configuration options.

## InitOptions

Main configuration interface for the init system.

```typescript
interface InitOptions {
  targetDir: string;           // Target directory for initialization
  sourceBaseDir?: string;      // Source directory for skills/commands/agents
  force: boolean;              // Overwrite existing files
  interactive: boolean;        // Enable interactive prompts
  components: InitComponents;  // Which components to install
  hooks: HooksConfig;          // Hook configuration
  skills: SkillsConfig;        // Skills to install
  commands: CommandsConfig;    // Commands to install
  agents: AgentsConfig;        // Agents to install
  statusline: StatuslineConfig; // Statusline options
  mcp: MCPConfig;              // MCP server config
  runtime: RuntimeConfig;      // V3 runtime config
}
```

## Components

```typescript
interface InitComponents {
  settings: boolean;    // .claude/settings.json
  skills: boolean;      // .claude/skills/
  commands: boolean;    // .claude/commands/
  agents: boolean;      // .claude/agents/
  helpers: boolean;     // .claude/helpers/
  statusline: boolean;  // statusline scripts
  mcp: boolean;         // .mcp.json
  runtime: boolean;     // .claude-flow/
}
```

### Default Components
```typescript
{
  settings: true,
  skills: true,
  commands: true,
  agents: true,
  helpers: true,
  statusline: false,  // Optional
  mcp: true,
  runtime: true,
}
```

## Hooks Configuration

```typescript
interface HooksConfig {
  preToolUse: boolean;        // Before tool operations
  postToolUse: boolean;       // After tool operations
  userPromptSubmit: boolean;  // On prompt submission
  sessionStart: boolean;      // On session start
  stop: boolean;              // On stop consideration
  notification: boolean;      // On notifications
  permissionRequest: boolean; // On permission requests
  timeout: number;            // Default timeout (ms)
  continueOnError: boolean;   // Continue on hook failure
}
```

### Default Hooks
```typescript
{
  preToolUse: true,
  postToolUse: true,
  userPromptSubmit: true,
  sessionStart: true,
  stop: true,
  notification: true,
  permissionRequest: true,
  timeout: 5000,
  continueOnError: true,
}
```

## Skills Configuration

```typescript
interface SkillsConfig {
  core: boolean;       // Core development skills
  agentdb: boolean;    // AgentDB integration skills
  github: boolean;     // GitHub automation skills
  flowNexus: boolean;  // Flow Nexus platform skills
  v3: boolean;         // V3-specific skills
  all: boolean;        // Install all available skills
}
```

### Skill Sets

| Set | Skills Count | Description |
|-----|-------------|-------------|
| core | 8 | Swarm, SPARC, hooks, pair programming |
| agentdb | 7 | Vector search, memory patterns, learning |
| github | 5 | Code review, releases, workflows |
| flowNexus | 3 | Neural, swarm, platform skills |
| v3 | 9 | V3 implementation skills |

## Commands Configuration

```typescript
interface CommandsConfig {
  core: boolean;         // Core commands
  analysis: boolean;     // Code analysis
  automation: boolean;   // Task automation
  github: boolean;       // GitHub operations
  hooks: boolean;        // Hook management
  monitoring: boolean;   // System monitoring
  optimization: boolean; // Performance tuning
  sparc: boolean;        // SPARC methodology
}
```

## Agents Configuration

```typescript
interface AgentsConfig {
  core: boolean;      // Basic development agents
  github: boolean;    // GitHub-integrated agents
  sparc: boolean;     // SPARC methodology agents
  swarm: boolean;     // Swarm coordination agents
  consensus: boolean; // Distributed consensus agents
  hiveMind: boolean;  // Collective intelligence agents
}
```

## MCP Configuration

```typescript
interface MCPConfig {
  claudeFlow: boolean;    // claude-flow MCP server
  agenticFlow: boolean;   // agentic-flow integration
  memory: boolean;        // Memory MCP tools
  neural: boolean;        // Neural MCP tools
  github: boolean;        // GitHub MCP integration
}
```

### MCP Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_FLOW_MODE` | `v3` | Operation mode |
| `CLAUDE_FLOW_HOOKS_ENABLED` | `true` | Enable hooks |
| `CLAUDE_FLOW_TOPOLOGY` | `hierarchical-mesh` | Swarm topology |
| `CLAUDE_FLOW_MAX_AGENTS` | `15` | Maximum agents |
| `CLAUDE_FLOW_MEMORY_BACKEND` | `hybrid` | Memory backend |

## Runtime Configuration

```typescript
interface RuntimeConfig {
  topology: 'mesh' | 'hierarchical' | 'hierarchical-mesh' | 'adaptive';
  maxAgents: number;
  memoryBackend: 'memory' | 'sqlite' | 'agentdb' | 'hybrid';
  enableHNSW: boolean;    // HNSW indexing
  enableNeural: boolean;  // Neural features
}
```

### Topology Options

| Topology | Description | Best For |
|----------|-------------|----------|
| `mesh` | Peer-to-peer | Small teams |
| `hierarchical` | Queen-led | Large projects |
| `hierarchical-mesh` | Hybrid | Most projects |
| `adaptive` | Auto-switching | Dynamic workloads |

## Statusline Configuration

```typescript
interface StatuslineConfig {
  enabled: boolean;
  style: 'minimal' | 'standard' | 'detailed';
  position: 'left' | 'right';
  refreshInterval: number;  // ms
}
```

## Preset Configurations

### DEFAULT_INIT_OPTIONS

Recommended for most projects:

```typescript
{
  targetDir: process.cwd(),
  force: false,
  interactive: true,
  components: {
    settings: true,
    skills: true,
    commands: true,
    agents: true,
    helpers: true,
    statusline: false,
    mcp: true,
    runtime: true,
  },
  hooks: {
    preToolUse: true,
    postToolUse: true,
    userPromptSubmit: true,
    sessionStart: true,
    stop: true,
    notification: true,
    permissionRequest: true,
    timeout: 5000,
    continueOnError: true,
  },
  skills: {
    core: true,
    agentdb: true,
    github: true,
    flowNexus: false,
    v3: true,
    all: false,
  },
  commands: {
    core: true,
    analysis: true,
    automation: true,
    github: true,
    hooks: true,
    monitoring: true,
    optimization: true,
    sparc: true,
  },
  agents: {
    core: true,
    github: true,
    sparc: true,
    swarm: true,
    consensus: false,
    hiveMind: false,
  },
  runtime: {
    topology: 'hierarchical-mesh',
    maxAgents: 15,
    memoryBackend: 'hybrid',
    enableHNSW: true,
    enableNeural: true,
  },
}
```

### MINIMAL_INIT_OPTIONS

Lightweight configuration:

```typescript
{
  // ... base options
  components: {
    settings: true,
    skills: true,
    commands: false,
    agents: false,
    helpers: false,
    statusline: false,
    mcp: true,
    runtime: true,
  },
  skills: { core: true, /* others false */ },
  agents: { core: true, /* others false */ },
  runtime: {
    topology: 'mesh',
    maxAgents: 5,
    memoryBackend: 'memory',
    enableHNSW: false,
    enableNeural: false,
  },
}
```

### FULL_INIT_OPTIONS

Everything enabled:

```typescript
{
  // All components: true
  // All skills: true (including flowNexus, all)
  // All commands: true
  // All agents: true (including consensus, hiveMind)
  // All hooks: true
  // All MCP servers: true
}
```
