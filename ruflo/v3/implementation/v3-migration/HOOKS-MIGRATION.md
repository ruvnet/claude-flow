# Hooks System Migration Guide

> Migrating from V2 Self-Learning Hooks to V3 ReasoningBank-Based Hooks

## Overview

V2 has an extensive hooks system with 42+ hook types across CLI, shell scripts, and agentic-flow integrations. V3 consolidates this into a ReasoningBank-based system with 13 core hooks, but many V2 hooks need migration.

## Architecture Comparison

### V2 Hooks Architecture
```
v2/
├── hooks/                          # Shell hooks
│   ├── bash-hook.sh               # Bash safety
│   ├── file-hook.sh               # File operations
│   └── git-commit-hook.sh         # Git formatting
├── bin/hooks.js                   # CLI hooks (14 types)
└── src/
    ├── hooks/
    │   ├── hook-matchers.ts       # Pattern matching
    │   └── redaction-hook.ts      # Secret redaction
    ├── services/agentic-flow-hooks/
    │   ├── hook-manager.ts        # Hook orchestration
    │   ├── llm-hooks.ts          # LLM operations
    │   ├── memory-hooks.ts       # Memory operations
    │   ├── neural-hooks.ts       # Neural training
    │   ├── performance-hooks.ts  # Performance
    │   └── workflow-hooks.ts     # Workflow lifecycle
    └── verification/hooks.ts      # Verification
```

### V3 Hooks Architecture
```
v3/
├── @claude-flow/shared/src/hooks/
│   ├── registry.ts               # Hook registration
│   └── executor.ts               # Hook execution
├── @claude-flow/cli/src/commands/
│   └── hooks.ts                  # CLI commands
└── mcp/tools/hooks-tools.ts      # MCP tools (9 hooks)
```

## Hook Migration Status

### Core Hooks - Implemented ✅

| Hook | V2 | V3 | Notes |
|------|----|----|-------|
| pre-edit | `bin/hooks.js` | `hooks-tools.ts` | ReasoningBank integration |
| post-edit | `bin/hooks.js` | `hooks-tools.ts` | Trajectory recording |
| pre-command | `bin/hooks.js` | `hooks-tools.ts` | Risk assessment |
| post-command | `bin/hooks.js` | `hooks-tools.ts` | Outcome learning |
| route | New in V3 | `hooks-tools.ts` | Pattern-based routing |
| explain | New in V3 | `hooks-tools.ts` | Decision transparency |
| pretrain | CLAUDE.md | `hooks-tools.ts` | Repository bootstrap |
| metrics | CLAUDE.md | `hooks-tools.ts` | Learning dashboard |
| list | New in V3 | `hooks-tools.ts` | Hook listing |

### CLI Hooks - Missing ❌

| Hook | V2 Location | Priority | V3 Migration Path |
|------|-------------|----------|-------------------|
| **pre-task** | `bin/hooks.js` | HIGH | Add to hooks-tools.ts |
| **post-task** | `bin/hooks.js` | HIGH | Add to hooks-tools.ts |
| **session-end** | `bin/hooks.js` | HIGH | Add session management |
| **session-restore** | `bin/hooks.js` | HIGH | Add session management |
| post-search | `bin/hooks.js` | MEDIUM | Add search caching |
| mcp-initialized | `bin/hooks.js` | LOW | MCP internal |
| agent-spawned | `bin/hooks.js` | LOW | Event-based |
| task-orchestrated | `bin/hooks.js` | LOW | Event-based |
| neural-trained | `bin/hooks.js` | MEDIUM | Add to neural module |
| notify | `bin/hooks.js` | LOW | Add notification system |

### Shell Hooks - Missing ❌

These need TypeScript conversions:

#### bash-hook.sh → bash-safety.ts
```typescript
// V2: hooks/bash-hook.sh
// Features:
// - Add -i flag to rm commands
// - Alias ll -> ls -lah
// - Redirect test files to /tmp
// - Warn about secrets in commands
// - Warn about missing dependencies

// V3 Migration:
export class BashSafetyHook {
  private dangerousPatterns = [
    /rm\s+-rf\s+\//,
    /dd\s+if=/,
    /mkfs\./,
    />\s*\/dev\/sd/
  ];

  private secretPatterns = [
    /password\s*=/i,
    /api[_-]?key\s*=/i,
    /secret\s*=/i,
    /token\s*=/i
  ];

  async preCommand(command: string): Promise<HookResult> {
    // Check for dangerous commands
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(command)) {
        return { blocked: true, reason: 'Dangerous command detected' };
      }
    }

    // Check for secrets
    for (const pattern of this.secretPatterns) {
      if (pattern.test(command)) {
        return { warning: 'Potential secret in command', redacted: this.redact(command) };
      }
    }

    // Add safety flags
    let modified = command;
    if (command.includes('rm ') && !command.includes('-i')) {
      modified = command.replace(/rm\s+/, 'rm -i ');
    }

    return { modified, warnings: [] };
  }
}
```

#### file-hook.sh → file-organization.ts
```typescript
// V2: hooks/file-hook.sh
// Features:
// - Block writes to root folder
// - Move test files to /tests/
// - Move source to /src/
// - Suggest formatters (Prettier, Black, gofmt)
// - Suggest linter configs

// V3 Migration:
export class FileOrganizationHook {
  private rootBlockedPatterns = [
    /^[^\/]+\.(ts|js|py|go|rs)$/,  // Source files
    /^[^\/]+\.test\.(ts|js)$/,     // Test files
    /^[^\/]+\.spec\.(ts|js)$/      // Spec files
  ];

  private directoryMappings = {
    'test': 'tests/',
    'spec': 'tests/',
    'src': 'src/'
  };

  async preEdit(filePath: string, operation: string): Promise<HookResult> {
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath);

    // Block root folder writes
    if (dirName === '.' || dirName === '') {
      for (const pattern of this.rootBlockedPatterns) {
        if (pattern.test(fileName)) {
          const suggested = this.suggestDirectory(fileName);
          return {
            blocked: true,
            reason: `Don't write to root. Suggested: ${suggested}`
          };
        }
      }
    }

    // Suggest formatters
    const formatter = this.suggestFormatter(filePath);

    return {
      warnings: formatter ? [`Consider running ${formatter}`] : []
    };
  }

  private suggestFormatter(filePath: string): string | null {
    const ext = path.extname(filePath);
    const formatters = {
      '.ts': 'prettier --write',
      '.js': 'prettier --write',
      '.py': 'black',
      '.go': 'gofmt -w',
      '.rs': 'rustfmt'
    };
    return formatters[ext] || null;
  }
}
```

#### git-commit-hook.sh → git-commit.ts
```typescript
// V2: hooks/git-commit-hook.sh
// Features:
// - Conventional commit prefixes
// - JIRA ticket extraction from branch
// - Co-Authored-By addition
// - Heredoc formatting

// V3 Migration:
export class GitCommitHook {
  private commitTypes = {
    feat: /^(add|implement|create|new)/i,
    fix: /^(fix|resolve|repair|patch)/i,
    docs: /^(doc|readme|comment)/i,
    refactor: /^(refactor|restructure|reorganize)/i,
    test: /^(test|spec|coverage)/i,
    chore: /^(chore|update|upgrade|bump)/i
  };

  async preCommit(message: string, branchName: string): Promise<HookResult> {
    let modified = message;

    // Detect commit type
    const type = this.detectType(message);
    if (type && !message.startsWith(`${type}:`)) {
      modified = `${type}: ${message}`;
    }

    // Extract JIRA ticket
    const ticket = this.extractTicket(branchName);
    if (ticket && !modified.includes(ticket)) {
      modified = `${modified}\n\nRefs: ${ticket}`;
    }

    // Add co-author
    modified += '\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>';

    return { modified };
  }

  private detectType(message: string): string | null {
    for (const [type, pattern] of Object.entries(this.commitTypes)) {
      if (pattern.test(message)) return type;
    }
    return null;
  }

  private extractTicket(branch: string): string | null {
    const match = branch.match(/([A-Z]+-\d+)/);
    return match ? match[1] : null;
  }
}
```

### Agentic Flow Hooks - Missing ❌

#### LLM Hooks (5 missing)
```typescript
// V2: src/services/agentic-flow-hooks/llm-hooks.ts
// Need to implement:
export interface LLMHooks {
  preLLMCall(request: LLMRequest): Promise<LLMRequest>;
  postLLMCall(response: LLMResponse): Promise<LLMResponse>;
  llmError(error: Error): Promise<ErrorHandler>;
  llmRetry(attempt: number): Promise<RetryConfig>;
  llmFallback(provider: string): Promise<string>;
}
```

#### Memory Hooks (5 missing)
```typescript
// V2: src/services/agentic-flow-hooks/memory-hooks.ts
// Need to implement:
export interface MemoryHooks {
  preMemoryStore(entry: MemoryEntry): Promise<MemoryEntry>;
  postMemoryStore(entry: MemoryEntry): Promise<void>;
  memorySync(entries: MemoryEntry[]): Promise<SyncResult>;
  memoryPersist(): Promise<PersistResult>;
  memoryExpire(expired: MemoryEntry[]): Promise<void>;
}
```

#### Neural Hooks (3 missing)
```typescript
// V2: src/services/agentic-flow-hooks/neural-hooks.ts
// Need to implement:
export interface NeuralHooks {
  preNeuralTrain(data: TrainingData): Promise<TrainingData>;
  postNeuralTrain(result: TrainingResult): Promise<void>;
  patternDetected(pattern: Pattern): Promise<void>;
}
```

#### Performance Hooks (4 missing)
```typescript
// V2: src/services/agentic-flow-hooks/performance-hooks.ts
// Need to implement:
export interface PerformanceHooks {
  performanceMetric(metric: Metric): Promise<void>;
  performanceBottleneck(bottleneck: Bottleneck): Promise<Optimization[]>;
  performanceOptimization(optimization: Optimization): Promise<ApplyResult>;
  performanceThreshold(threshold: Threshold): Promise<ThresholdAdjustment>;
}
```

#### Workflow Hooks (5 missing)
```typescript
// V2: src/services/agentic-flow-hooks/workflow-hooks.ts
// Need to implement:
export interface WorkflowHooks {
  workflowStart(workflow: Workflow): Promise<void>;
  workflowStep(step: WorkflowStep): Promise<StepOptimization>;
  workflowDecision(decision: Decision): Promise<DecisionEnhancement>;
  workflowComplete(workflow: Workflow): Promise<LearningExtraction>;
  workflowError(error: WorkflowError): Promise<RecoveryStrategy>;
}
```

### Verification Hooks - Missing ❌

```typescript
// V2: src/verification/hooks.ts
// Need to implement:
export interface VerificationHooks {
  verificationPreTask(task: Task): Promise<VerificationResult>;
  verificationPostTask(task: Task, result: TaskResult): Promise<ValidationResult>;
  verificationIntegrationTest(suite: TestSuite): Promise<TestResult>;
  verificationTruthTelemetry(data: any): Promise<TruthScore>;
  verificationRollbackTrigger(error: Error): Promise<RollbackPlan>;
}
```

## Hook Registration

### V2 Hook Manager
```typescript
// V2: src/services/agentic-flow-hooks/hook-manager.ts
class AgenticHookManager {
  private hooks: Map<HookType, HookRegistration[]>;

  register(type: HookType, hook: Hook, options: HookOptions): void;
  execute(type: HookType, context: HookContext): Promise<HookResult>;
  unregister(type: HookType, hookId: string): void;
}
```

### V3 Hook Registry
```typescript
// V3: @claude-flow/shared/src/hooks/registry.ts
class HookRegistry {
  register(hook: HookDefinition): void;
  getHook(name: string): HookDefinition | undefined;
  listHooks(): HookDefinition[];
  enable(name: string): void;
  disable(name: string): void;
}
```

### Migration Path
```typescript
// Migration: Adapt V2 hook manager to V3 registry
import { HookRegistry } from '@claude-flow/shared/hooks';

const registry = new HookRegistry();

// Register V2-style hooks
registry.register({
  name: 'pre-task',
  type: 'pre',
  category: 'task',
  priority: 'high',
  handler: async (context) => {
    // V2 pre-task logic
    await storeTaskData(context.taskId, context.description);
    if (context.autoSpawnAgents) {
      await spawnRequiredAgents(context);
    }
    return { proceed: true };
  }
});
```

## CLI Commands

### V2 Hooks CLI
```bash
# V2 Commands
npx claude-flow hooks pre-task --description "Task" --task-id ID
npx claude-flow hooks post-task --task-id ID
npx claude-flow hooks pre-edit --file path
npx claude-flow hooks post-edit --file path --success true
npx claude-flow hooks pre-command --command "npm test"
npx claude-flow hooks post-command --command "npm test" --success true
npx claude-flow hooks session-end
npx claude-flow hooks session-restore --session-id latest
npx claude-flow hooks notify --message "Done" --level success
```

### V3 Hooks CLI
```bash
# V3 Commands (implemented)
npx claude-flow hooks pre-edit <filePath>
npx claude-flow hooks post-edit <filePath> --success true
npx claude-flow hooks pre-command "<command>"
npx claude-flow hooks post-command "<command>" --success true
npx claude-flow hooks route "<task description>"
npx claude-flow hooks explain "<task description>"
npx claude-flow hooks pretrain
npx claude-flow hooks metrics

# Missing V3 commands:
# - hooks pre-task
# - hooks post-task
# - hooks session-end
# - hooks session-restore
# - hooks notify
# - hooks build-agents
# - hooks transfer
# - hooks intelligence
```

## MCP Tools

### V3 Hooks MCP Tools (Implemented)
```typescript
// v3/mcp/tools/hooks-tools.ts
const hooksTools = [
  'hooks/pre-edit',
  'hooks/post-edit',
  'hooks/pre-command',
  'hooks/post-command',
  'hooks/route',
  'hooks/explain',
  'hooks/pretrain',
  'hooks/metrics',
  'hooks/list'
];
```

### Missing MCP Tools
```typescript
// Need to add:
const missingTools = [
  'hooks/pre-task',
  'hooks/post-task',
  'hooks/session-start',
  'hooks/session-end',
  'hooks/session-restore',
  'hooks/build-agents',
  'hooks/transfer',
  'hooks/intelligence'
];
```

## Implementation Priorities

### Priority 1 - HIGH (Week 1-2)
1. **pre-task / post-task** - Task lifecycle hooks
2. **session-end / session-restore** - Session management
3. **bash-safety.ts** - Convert bash-hook.sh
4. **file-organization.ts** - Convert file-hook.sh

### Priority 2 - MEDIUM (Week 3-4)
1. **workflow hooks** - Workflow lifecycle
2. **git-commit.ts** - Convert git-commit-hook.sh
3. **verification hooks** - Task verification
4. **build-agents** - Agent config generation

### Priority 3 - LOW (Week 5+)
1. **LLM hooks** - LLM integration
2. **memory hooks** - Memory lifecycle
3. **neural hooks** - Neural training
4. **performance hooks** - Performance optimization
