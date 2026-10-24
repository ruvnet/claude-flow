# @claude-flow/hooks

[![npm version](https://img.shields.io/npm/v/@claude-flow/hooks.svg)](https://www.npmjs.com/package/@claude-flow/hooks)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/hooks.svg)](https://www.npmjs.com/package/@claude-flow/hooks)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

> Event-driven lifecycle hooks with ReasoningBank learning integration for Claude Flow V3

The `@claude-flow/hooks` package provides a comprehensive hooks system for intercepting and extending Claude Flow operations. It enables intelligent task routing, pattern learning, background metrics collection, and real-time statusline integration.

## Features

- 🎣 **Hook Registry** - Priority-based hook registration with filtering and management
- ⚡ **Hook Executor** - Timeout handling, error recovery, and result aggregation
- 🤖 **Background Daemons** - Metrics collection, swarm monitoring, pattern learning
- 👷 **Background Workers** - 12 specialized workers for analysis, optimization, and automation
- 📊 **Statusline Integration** - Real-time status display for Claude Code
- 🧠 **ReasoningBank Learning** - Intelligent task routing based on learned patterns
- 🔧 **MCP Tools** - 13 MCP tools for programmatic hooks access
- 🔄 **V2 Compatibility** - Backward compatible with V2 hook commands

## Installation

```bash
# Using npm
npm install @claude-flow/hooks

# Using pnpm
pnpm add @claude-flow/hooks

# Using yarn
yarn add @claude-flow/hooks
```

## Quick Start

### Basic Usage

```typescript
import {
  HookRegistry,
  HookExecutor,
  HookEvent,
  HookPriority,
} from '@claude-flow/hooks';

// Create registry and executor
const registry = new HookRegistry();
const executor = new HookExecutor(registry);

// Register a pre-edit hook
registry.register(
  HookEvent.PreEdit,
  async (context) => {
    console.log(`Editing file: ${context.file?.path}`);
    return { success: true };
  },
  HookPriority.Normal,
  { name: 'log-edits' }
);

// Execute hooks
const result = await executor.preEdit('src/app.ts', 'modify');
console.log(`Hooks executed: ${result.hooksExecuted}`);
```

### Initialize with Daemons

```typescript
import { initializeHooks } from '@claude-flow/hooks';

// Initialize full system with background daemons
const { registry, executor, statusline } = await initializeHooks({
  enableDaemons: true,
  enableStatusline: true,
});

// Generate statusline
console.log(statusline.generateStatusline());
```

### Using MCP Tools

```typescript
import { hooksMCPTools, getHooksTool } from '@claude-flow/hooks';

// Get specific tool
const routeTool = getHooksTool('hooks/route');

// Execute routing
const result = await routeTool.handler({
  task: 'Implement user authentication',
  includeExplanation: true,
});

console.log(`Recommended agent: ${result.recommendedAgent}`);
console.log(`Confidence: ${result.confidence}%`);
```

## CLI Commands

### Hooks Daemon

Manage background daemon processes for metrics and learning.

```bash
# Start daemon with default 60s interval
hooks-daemon start

# Start with custom interval (30 seconds)
hooks-daemon start 30

# Stop daemon
hooks-daemon stop

# Check status
hooks-daemon status

# Run pattern consolidation
hooks-daemon consolidate

# Export learned patterns
hooks-daemon export json

# Rebuild HNSW index
hooks-daemon rebuild-index

# Notify activity (for hook integration)
hooks-daemon notify-activity
```

### Statusline

Generate statusline output for Claude Code integration.

```bash
# Display formatted statusline
statusline

# Output JSON data
statusline --json

# Compact JSON (single line)
statusline --compact

# Show help
statusline --help
```

**Example Output:**
```
▊ Claude Flow V3 ● agentic-flow@alpha  │  ⎇ v3
─────────────────────────────────────────────────────
🏗️  DDD Domains    [●●●●●]  5/5    ⚡ 1.0x → 2.49x-7.47x
🤖 Swarm Agents    ◉ [ 5/15]      🟢 CVE 3/3    💾 156 patterns
🔧 Architecture    DDD ●93%  │  Security ●CLEAN  │  Hooks ●ACTIVE
📊 Routing         89% accuracy │  Avg 4.2ms │  1547 operations
─────────────────────────────────────────────────────
```

## Hook Events

| Event | Description |
|-------|-------------|
| `PreToolUse` | Before any tool execution |
| `PostToolUse` | After tool execution completes |
| `PreEdit` | Before file modification |
| `PostEdit` | After file modification |
| `PreRead` | Before file read |
| `PostRead` | After file read |
| `PreCommand` | Before shell command execution |
| `PostCommand` | After shell command completes |
| `PreTask` | Before task starts |
| `PostTask` | After task completes |
| `TaskProgress` | During task execution |
| `SessionStart` | When session begins |
| `SessionEnd` | When session ends |
| `SessionRestore` | When restoring previous session |
| `AgentSpawn` | When agent is spawned |
| `AgentTerminate` | When agent terminates |
| `PreRoute` | Before task routing |
| `PostRoute` | After routing decision |
| `PatternLearned` | When new pattern is learned |
| `PatternConsolidated` | When patterns are consolidated |

## Hook Priorities

| Priority | Value | Use Case |
|----------|-------|----------|
| `Critical` | 1000 | Security validation, must run first |
| `High` | 100 | Pre-processing, preparation |
| `Normal` | 50 | Standard hooks |
| `Low` | 10 | Logging, metrics |
| `Background` | 1 | Async operations, runs last |

## Background Workers

The hooks system includes 12 specialized background workers that can be triggered automatically or manually dispatched.

### Available Workers

| Worker | Priority | Est. Time | Description |
|--------|----------|-----------|-------------|
| `ultralearn` | normal | 60s | Deep knowledge acquisition and learning |
| `optimize` | high | 30s | Performance optimization and tuning |
| `consolidate` | low | 20s | Memory consolidation and cleanup |
| `predict` | normal | 15s | Predictive preloading and anticipation |
| `audit` | critical | 45s | Security analysis and vulnerability scanning |
| `map` | normal | 30s | Codebase mapping and architecture analysis |
| `preload` | low | 10s | Resource preloading and cache warming |
| `deepdive` | normal | 60s | Deep code analysis and examination |
| `document` | normal | 45s | Auto-documentation generation |
| `refactor` | normal | 30s | Code refactoring suggestions |
| `benchmark` | normal | 60s | Performance benchmarking |
| `testgaps` | normal | 30s | Test coverage analysis |

### Worker CLI Commands

```bash
# List all available workers
claude-flow hooks worker list

# Detect triggers from prompt text
claude-flow hooks worker detect --prompt "optimize performance"

# Auto-dispatch when triggers match (confidence ≥0.6)
claude-flow hooks worker detect --prompt "deep dive into auth" --auto-dispatch --min-confidence 0.6

# Manually dispatch a worker
claude-flow hooks worker dispatch --trigger refactor --context "auth module"

# Check worker status
claude-flow hooks worker status

# Cancel a running worker
claude-flow hooks worker cancel --id worker_refactor_1_abc123
```

### Performance Targets

| Metric | Target |
|--------|--------|
| Trigger detection | <5ms |
| Worker spawn | <50ms |
| Max concurrent | 10 |

### UserPromptSubmit Integration

Workers are automatically triggered via the `UserPromptSubmit` hook when prompt patterns match worker triggers with confidence ≥0.6. Add this to your Claude settings:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "timeout": 6000,
        "command": "claude-flow hooks worker detect --prompt \"$USER_PROMPT\" --auto-dispatch --min-confidence 0.6"
      }]
    }]
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `hooks/pre-edit` | Get context and suggestions before file edit |
| `hooks/post-edit` | Record edit outcome for learning |
| `hooks/route` | Route task to optimal agent |
| `hooks/metrics` | Query learning metrics |
| `hooks/pre-command` | Assess command risk |
| `hooks/post-command` | Record command outcome |
| `hooks/daemon-status` | Get daemon status |
| `hooks/statusline` | Get statusline data |
| `hooks/worker-list` | List all 12 background workers |
| `hooks/worker-dispatch` | Dispatch a worker by trigger type |
| `hooks/worker-status` | Get status of running workers |
| `hooks/worker-detect` | Detect worker triggers from prompt text |
| `hooks/worker-cancel` | Cancel a running worker |

## API Reference

### HookRegistry

```typescript
class HookRegistry {
  // Register a hook
  register(
    event: HookEvent,
    handler: HookHandler,
    priority: HookPriority,
    options?: HookRegistrationOptions
  ): string;

  // Unregister a hook
  unregister(hookId: string): boolean;

  // Get hooks for event
  getForEvent(event: HookEvent, enabledOnly?: boolean): HookEntry[];

  // Enable/disable hooks
  enable(hookId: string): boolean;
  disable(hookId: string): boolean;

  // List hooks with filtering
  list(filter?: HookListFilter): HookEntry[];

  // Get statistics
  getStats(): HookRegistryStats;
}
```

### HookExecutor

```typescript
class HookExecutor {
  // Execute hooks for any event
  execute<T>(
    event: HookEvent,
    context: Partial<HookContext<T>>,
    options?: HookExecutionOptions
  ): Promise<HookExecutionResult>;

  // Convenience methods
  preToolUse(toolName: string, parameters: Record<string, unknown>): Promise<HookExecutionResult>;
  postToolUse(toolName: string, parameters: Record<string, unknown>, duration: number): Promise<HookExecutionResult>;
  preEdit(filePath: string, operation: 'create' | 'modify' | 'delete'): Promise<HookExecutionResult>;
  postEdit(filePath: string, operation: 'create' | 'modify' | 'delete', duration: number): Promise<HookExecutionResult>;
  preCommand(command: string, workingDirectory?: string): Promise<HookExecutionResult>;
  postCommand(command: string, exitCode: number, output?: string, error?: string): Promise<HookExecutionResult>;
  sessionStart(sessionId: string): Promise<HookExecutionResult>;
  sessionEnd(sessionId: string): Promise<HookExecutionResult>;
  agentSpawn(agentId: string, agentType: string): Promise<HookExecutionResult>;
  agentTerminate(agentId: string, agentType: string, status: string): Promise<HookExecutionResult>;
}
```

### DaemonManager

```typescript
class DaemonManager {
  // Register and manage daemons
  register(config: DaemonConfig, task: () => Promise<void>): void;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;

  // Bulk operations
  startAll(): Promise<void>;
  stopAll(): Promise<void>;

  // Status
  getState(name: string): DaemonState | undefined;
  getAllStates(): DaemonState[];
  isRunning(name: string): boolean;
}
```

### StatuslineGenerator

```typescript
class StatuslineGenerator {
  // Register data sources
  registerDataSources(sources: StatuslineDataSources): void;

  // Generate output
  generateData(): StatuslineData;
  generateStatusline(): string;
  generateJSON(): string;
  generateCompactJSON(): string;

  // Configuration
  updateConfig(config: Partial<StatuslineConfig>): void;
  invalidateCache(): void;
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_FLOW_HOOK_TIMEOUT` | Hook execution timeout (ms) | `5000` |
| `CLAUDE_FLOW_REASONINGBANK_ENABLED` | Enable ReasoningBank | `true` |
| `CLAUDE_FLOW_HOOKS_NAMESPACE` | Learning namespace | `hooks-learning` |
| `CLAUDE_FLOW_HOOKS_LOG_LEVEL` | Logging level | `info` |
| `CLAUDE_FLOW_SHOW_HOOKS_METRICS` | Show hooks in statusline | `true` |
| `CLAUDE_FLOW_SHOW_SWARM_ACTIVITY` | Show swarm in statusline | `true` |
| `CLAUDE_FLOW_SHOW_PERFORMANCE` | Show performance targets | `true` |

## Integration with Claude Code

Add to your Claude settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "timeout": 5000,
        "command": "hooks-daemon start"
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "timeout": 3000,
        "command": "hooks-daemon stop"
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "timeout": 100,
        "command": "hooks-daemon notify-activity"
      }]
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "statusline"
  }
}
```

## Related Packages

- [@claude-flow/shared](../shared) - Shared utilities and types
- [@claude-flow/neural](../neural) - Neural network and SONA learning
- [@claude-flow/swarm](../swarm) - Multi-agent coordination
- [@claude-flow/memory](../memory) - AgentDB memory system

## License

MIT © [Claude Flow Team](https://github.com/ruvnet/claude-flow)
