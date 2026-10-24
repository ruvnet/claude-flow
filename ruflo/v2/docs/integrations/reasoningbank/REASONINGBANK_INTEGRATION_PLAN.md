# ReasoningBank Integration Plan for claude-flow v2.7.0

**Status**: 🟡 Proposal
**Priority**: High
**Target Release**: v2.7.0
**Dependencies**: agentic-flow@1.4.11+

---

## Executive Summary

This plan outlines comprehensive integration of agentic-flow's ReasoningBank learning memory system into claude-flow as first-class CLI parameters and SDK features. Current integration is limited to agent execution; this extends it to include intelligent memory-based learning.

**Key Benefits:**
- 🧠 **Agents learn from experience** (23% → 98% success rate)
- ⚡ **Faster over time** (4.2s → 1.2s, 3.5x improvement)
- 🎯 **Knowledge transfer** across similar tasks
- 🔐 **PII-safe** automatic scrubbing
- 💾 **Persistent learning** across sessions

---

## Current Integration Status

### ✅ What's Working (v2.6.0-alpha.2)

**Agent Execution:**
```bash
claude-flow agent run coder "Create REST API"
  --provider openrouter
  --model "meta-llama/llama-3.1-8b-instruct"
  --temperature 0.7
  --max-tokens 4096
  --stream
  --verbose
```

**Files:**
- `src/execution/agent-executor.ts` - Wraps agentic-flow CLI
- `src/execution/provider-manager.ts` - Multi-provider configuration
- `src/cli/simple-commands/agent.js` - CLI interface
- `package.json` - Dependency: `agentic-flow@1.4.6`

### ❌ What's Missing

**ReasoningBank Features:**
- No `--enable-memory` flag
- No automatic pre-task memory retrieval
- No automatic post-task learning
- No memory database configuration
- No consolidation scheduling
- Dependency on outdated version (1.4.6, needs 1.4.11)

---

## Integration Architecture

### Phase 1: Dependency Update

**File: `package.json`**

```json
{
  "dependencies": {
    "agentic-flow": "1.4.11"  // Update from 1.4.6
  }
}
```

**Why:** v1.4.11 includes complete ReasoningBank CLI support with bug fixes.

---

### Phase 2: Interface Extensions

**File: `src/execution/agent-executor.ts`**

#### 2.1 Extend AgentExecutionOptions Interface

```typescript
export interface AgentExecutionOptions {
  // Existing parameters
  agent: string;
  task: string;
  provider?: 'anthropic' | 'openrouter' | 'onnx' | 'gemini';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json' | 'markdown';
  stream?: boolean;
  verbose?: boolean;
  retryOnError?: boolean;
  timeout?: number;

  // NEW: ReasoningBank parameters
  enableMemory?: boolean;           // Enable ReasoningBank learning
  memoryDatabase?: string;          // Path to .swarm/memory.db
  memoryRetrievalK?: number;        // Top-k memories to retrieve (default: 3)
  memoryLearning?: boolean;         // Enable post-task learning (default: true)
  memoryConsolidateEvery?: number;  // Auto-consolidate every N tasks (default: 20)
  memoryMinConfidence?: number;     // Minimum confidence threshold (default: 0.5)
  memoryDomain?: string;            // Domain filter for memories
  memoryTaskId?: string;            // Unique task ID for tracking
}
```

#### 2.2 Extend AgentExecutionResult Interface

```typescript
export interface AgentExecutionResult {
  // Existing fields
  success: boolean;
  output: string;
  error?: string;
  provider: string;
  model: string;
  tokens?: number;
  cost?: number;
  duration: number;
  agent: string;
  task: string;

  // NEW: ReasoningBank metrics
  memoryEnabled?: boolean;
  memoriesRetrieved?: number;
  memoriesUsed?: string[];          // IDs of memories applied
  memoryLearned?: boolean;          // Whether new memories were created
  memoryVerdict?: 'success' | 'failure';
  memoryConfidence?: number;
  newMemoryIds?: string[];          // IDs of newly created memories
}
```

#### 2.3 Add ReasoningBank Methods to AgentExecutor Class

```typescript
export class AgentExecutor {
  private readonly agenticFlowPath: string;
  private readonly hooksManager: any;
  private memoryEnabled: boolean = false;
  private memoryDatabase: string = '.swarm/memory.db';
  private taskCounter: number = 0;

  /**
   * Initialize ReasoningBank database
   */
  async initializeMemory(dbPath?: string): Promise<void> {
    const db = dbPath || this.memoryDatabase;

    try {
      const { stdout } = await execAsync(
        `${this.agenticFlowPath} reasoningbank init --db-path ${db}`
      );

      this.memoryEnabled = true;
      console.log('✅ ReasoningBank initialized:', db);
    } catch (error: any) {
      console.error('Failed to initialize ReasoningBank:', error.message);
      throw error;
    }
  }

  /**
   * Retrieve relevant memories before task execution
   */
  async retrieveMemories(
    task: string,
    options: {
      k?: number;
      domain?: string;
      minConfidence?: number;
    } = {}
  ): Promise<any[]> {
    if (!this.memoryEnabled) return [];

    try {
      const k = options.k || 3;
      const args = [
        'reasoningbank', 'retrieve',
        '--query', `"${task}"`,
        '--k', k.toString(),
      ];

      if (options.domain) {
        args.push('--domain', options.domain);
      }

      if (options.minConfidence) {
        args.push('--min-confidence', options.minConfidence.toString());
      }

      const { stdout } = await execAsync(
        `${this.agenticFlowPath} ${args.join(' ')}`
      );

      return JSON.parse(stdout);
    } catch (error) {
      console.warn('Memory retrieval failed, continuing without memories');
      return [];
    }
  }

  /**
   * Learn from task execution
   */
  async learnFromExecution(
    taskId: string,
    result: AgentExecutionResult,
    memories: any[]
  ): Promise<string[]> {
    if (!this.memoryEnabled) return [];

    try {
      const verdict = result.success ? 'success' : 'failure';

      const { stdout } = await execAsync(
        `${this.agenticFlowPath} reasoningbank learn ` +
        `--task-id ${taskId} ` +
        `--verdict ${verdict} ` +
        `--confidence ${result.success ? 0.7 : 0.5}`
      );

      const newMemoryIds = JSON.parse(stdout).memoryIds || [];

      // Auto-consolidate if threshold reached
      this.taskCounter++;
      if (this.taskCounter % 20 === 0) {
        await this.consolidateMemories();
      }

      return newMemoryIds;
    } catch (error) {
      console.warn('Learning failed, skipping memory creation');
      return [];
    }
  }

  /**
   * Run memory consolidation (dedup + prune)
   */
  async consolidateMemories(): Promise<void> {
    if (!this.memoryEnabled) return;

    try {
      await execAsync(
        `${this.agenticFlowPath} reasoningbank consolidate`
      );
      console.log('✅ Memory consolidation complete');
    } catch (error) {
      console.warn('Consolidation failed:', error);
    }
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats(): Promise<any> {
    if (!this.memoryEnabled) {
      return { enabled: false, totalMemories: 0 };
    }

    try {
      const { stdout } = await execAsync(
        `${this.agenticFlowPath} reasoningbank status --json`
      );
      return JSON.parse(stdout);
    } catch (error) {
      return { enabled: true, error: error.message };
    }
  }

  /**
   * Enhanced execute with ReasoningBank integration
   */
  async execute(options: AgentExecutionOptions): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const taskId = options.memoryTaskId || `task-${Date.now()}`;

    try {
      // Step 1: Initialize memory if requested
      if (options.enableMemory && !this.memoryEnabled) {
        await this.initializeMemory(options.memoryDatabase);
      }

      // Step 2: Retrieve relevant memories (pre-task)
      let memories: any[] = [];
      if (this.memoryEnabled && options.enableMemory !== false) {
        memories = await this.retrieveMemories(options.task, {
          k: options.memoryRetrievalK,
          domain: options.memoryDomain,
          minConfidence: options.memoryMinConfidence,
        });

        console.log(`🧠 Retrieved ${memories.length} relevant memories`);
      }

      // Step 3: Trigger pre-execution hook
      if (this.hooksManager) {
        await this.hooksManager.trigger('pre-agent-execute', {
          agent: options.agent,
          task: options.task,
          provider: options.provider || 'anthropic',
          timestamp: Date.now(),
          memories,
        });
      }

      // Step 4: Build and execute command
      const command = this.buildCommand(options, memories);
      const { stdout, stderr } = await execAsync(command, {
        timeout: options.timeout || 300000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const duration = Date.now() - startTime;

      // Step 5: Create result
      const result: AgentExecutionResult = {
        success: true,
        output: stdout,
        provider: options.provider || 'anthropic',
        model: options.model || 'default',
        duration,
        agent: options.agent,
        task: options.task,
        memoryEnabled: this.memoryEnabled,
        memoriesRetrieved: memories.length,
        memoriesUsed: memories.map((m: any) => m.id),
      };

      // Step 6: Learn from execution (post-task)
      if (this.memoryEnabled && options.memoryLearning !== false) {
        const newMemoryIds = await this.learnFromExecution(
          taskId,
          result,
          memories
        );

        result.memoryLearned = newMemoryIds.length > 0;
        result.newMemoryIds = newMemoryIds;
        result.memoryVerdict = 'success';
        result.memoryConfidence = 0.7;
      }

      // Step 7: Trigger post-execution hook
      if (this.hooksManager) {
        await this.hooksManager.trigger('post-agent-execute', {
          agent: options.agent,
          task: options.task,
          result,
          success: true,
        });
      }

      return result;
    } catch (error: any) {
      // Error handling with learning
      const duration = Date.now() - startTime;
      const result: AgentExecutionResult = {
        success: false,
        output: '',
        error: error.message,
        provider: options.provider || 'anthropic',
        model: options.model || 'default',
        duration,
        agent: options.agent,
        task: options.task,
        memoryEnabled: this.memoryEnabled,
      };

      // Learn from failure
      if (this.memoryEnabled && options.memoryLearning !== false) {
        const newMemoryIds = await this.learnFromExecution(
          taskId,
          result,
          []
        );
        result.memoryLearned = newMemoryIds.length > 0;
        result.newMemoryIds = newMemoryIds;
        result.memoryVerdict = 'failure';
        result.memoryConfidence = 0.5;
      }

      if (this.hooksManager) {
        await this.hooksManager.trigger('agent-execute-error', {
          agent: options.agent,
          task: options.task,
          error: error.message,
        });
      }

      return result;
    }
  }

  /**
   * Build command with memory injection
   */
  private buildCommand(
    options: AgentExecutionOptions,
    memories: any[] = []
  ): string {
    const parts = [this.agenticFlowPath];

    // Existing parameters
    parts.push('--agent', options.agent);

    // Inject memories into task prompt
    let taskPrompt = options.task;
    if (memories.length > 0) {
      const memoryContext = memories
        .map((m: any, i: number) =>
          `Memory ${i + 1}: ${m.title}\n${m.description}`
        )
        .join('\n\n');

      taskPrompt = `${memoryContext}\n\n---\n\nTask: ${options.task}`;
    }

    parts.push('--task', `"${taskPrompt.replace(/"/g, '\\"')}"`);

    // ... rest of existing parameters ...
    if (options.provider) parts.push('--provider', options.provider);
    if (options.model) parts.push('--model', options.model);
    if (options.temperature !== undefined) {
      parts.push('--temperature', options.temperature.toString());
    }
    if (options.maxTokens) {
      parts.push('--max-tokens', options.maxTokens.toString());
    }
    if (options.outputFormat) {
      parts.push('--output-format', options.outputFormat);
    }
    if (options.stream) parts.push('--stream');
    if (options.verbose) parts.push('--verbose');

    return parts.join(' ');
  }
}
```

---

### Phase 3: CLI Parameter Additions

**File: `src/cli/simple-commands/agent.js`**

#### 3.1 Add Memory Flags to buildAgenticFlowCommand

```javascript
function buildAgenticFlowCommand(agent, task, flags) {
  const parts = ['npx', 'agentic-flow'];

  // Existing flags
  parts.push('--agent', agent);
  parts.push('--task', `"${task.replace(/"/g, '\\"')}"`);

  if (flags.provider) parts.push('--provider', flags.provider);
  if (flags.model) parts.push('--model', flags.model);
  if (flags.temperature) parts.push('--temperature', flags.temperature);
  if (flags.maxTokens) parts.push('--max-tokens', flags.maxTokens);
  if (flags.format) parts.push('--output-format', flags.format);
  if (flags.stream) parts.push('--stream');
  if (flags.verbose) parts.push('--verbose');

  // NEW: ReasoningBank flags
  if (flags.enableMemory) parts.push('--enable-memory');
  if (flags.memoryDb) parts.push('--memory-db', flags.memoryDb);
  if (flags.memoryK) parts.push('--memory-k', flags.memoryK);
  if (flags.memoryDomain) parts.push('--memory-domain', flags.memoryDomain);
  if (flags.noLearning) parts.push('--no-learning');

  return parts.join(' ');
}
```

#### 3.2 Update Help Text

```javascript
function showAgentHelp() {
  console.log('Agent commands:');
  console.log('\n🚀 Agentic-Flow Integration (v2.7.0):');
  console.log('  run <agent> "<task>" [options]   Execute agent with multi-provider support');
  console.log('  agents                           List all 66+ agentic-flow agents');

  console.log('\n🧠 ReasoningBank Memory (NEW):');
  console.log('  memory init                      Initialize learning database');
  console.log('  memory status                    Show memory statistics');
  console.log('  memory consolidate               Run memory cleanup');
  console.log('  memory list [--sort] [--limit]   List stored memories');

  console.log('\nExecution Options (for run command):');
  console.log('  --provider <provider>            Provider: anthropic, openrouter, onnx, gemini');
  console.log('  --model <model>                  Specific model to use');
  console.log('  --temperature <temp>             Temperature (0.0-1.0)');
  console.log('  --max-tokens <tokens>            Maximum tokens');
  console.log('  --format <format>                Output format: text, json, markdown');
  console.log('  --stream                         Enable streaming');
  console.log('  --verbose                        Verbose output');

  console.log('\n🧠 Memory Options (NEW):');
  console.log('  --enable-memory                  Enable ReasoningBank learning');
  console.log('  --memory-db <path>               Database path (default: .swarm/memory.db)');
  console.log('  --memory-k <number>              Retrieve top-k memories (default: 3)');
  console.log('  --memory-domain <domain>         Filter memories by domain');
  console.log('  --no-learning                    Disable post-task learning');
  console.log('  --memory-min-confidence <num>    Minimum confidence (default: 0.5)');

  console.log('\nExamples:');
  console.log('\n  # Basic execution with learning');
  console.log('  claude-flow agent run coder "Build REST API" --enable-memory');

  console.log('\n  # With domain filtering');
  console.log('  claude-flow agent run coder "Add auth" --enable-memory --memory-domain web');

  console.log('\n  # Memory management');
  console.log('  claude-flow agent memory init');
  console.log('  claude-flow agent memory status');
  console.log('  claude-flow agent memory list --sort confidence --limit 10');

  console.log('\n  # Retrieve without learning (read-only)');
  console.log('  claude-flow agent run researcher "Research topic" --enable-memory --no-learning');
}
```

#### 3.3 Add Memory Management Commands

```javascript
async function memoryCommand(subArgs, flags) {
  const memoryCmd = subArgs[1];

  switch (memoryCmd) {
    case 'init':
      await initMemory(flags);
      break;

    case 'status':
      await memoryStatus(flags);
      break;

    case 'consolidate':
      await memoryConsolidate(flags);
      break;

    case 'list':
      await memoryList(subArgs, flags);
      break;

    default:
      showMemoryHelp();
  }
}

async function initMemory(flags) {
  const dbPath = flags.db || '.swarm/memory.db';

  printSuccess('🔧 Initializing ReasoningBank...');

  try {
    const { stdout } = await execAsync(
      `npx agentic-flow reasoningbank init --db-path ${dbPath}`
    );

    console.log(stdout);
    printSuccess('✅ ReasoningBank initialized!');
    console.log(`   Database: ${dbPath}`);
  } catch (error) {
    printError('Failed to initialize ReasoningBank');
    console.error(error.message);
    process.exit(1);
  }
}

async function memoryStatus(flags) {
  printSuccess('📊 ReasoningBank Status');

  try {
    const { stdout } = await execAsync(
      'npx agentic-flow reasoningbank status'
    );
    console.log(stdout);
  } catch (error) {
    printError('Failed to get memory status');
    console.error(error.message);
  }
}

async function memoryConsolidate(flags) {
  printSuccess('🔄 Running memory consolidation...');

  try {
    const { stdout } = await execAsync(
      'npx agentic-flow reasoningbank consolidate'
    );
    console.log(stdout);
    printSuccess('✅ Consolidation complete!');
  } catch (error) {
    printError('Consolidation failed');
    console.error(error.message);
  }
}

async function memoryList(subArgs, flags) {
  const sort = flags.sort || 'created_at';
  const limit = flags.limit || 10;

  printSuccess(`📚 Top ${limit} Memories (sorted by ${sort})`);

  try {
    const { stdout } = await execAsync(
      `npx agentic-flow reasoningbank list --sort ${sort} --limit ${limit}`
    );
    console.log(stdout);
  } catch (error) {
    printError('Failed to list memories');
    console.error(error.message);
  }
}
```

---

### Phase 4: Provider Manager Extensions

**File: `src/execution/provider-manager.ts`**

#### 4.1 Extend ExecutionConfig Interface

```typescript
export interface ExecutionConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  optimization?: {
    strategy: 'balanced' | 'cost' | 'quality' | 'speed' | 'privacy';
    maxCostPerTask?: number;
  };

  // NEW: ReasoningBank configuration
  reasoningbank?: {
    enabled: boolean;
    database: string;
    retrievalK: number;
    autoConsolidate: boolean;
    consolidateEvery: number;
    minConfidence: number;
    domains?: string[];
    piiScrubbing: boolean;
  };
}
```

#### 4.2 Update Default Configuration

```typescript
private getDefaultConfig(): ExecutionConfig {
  return {
    defaultProvider: 'anthropic',
    providers: {
      // ... existing providers ...
    },
    optimization: {
      strategy: 'balanced',
      maxCostPerTask: 0.5,
    },

    // NEW: ReasoningBank defaults
    reasoningbank: {
      enabled: false,
      database: '.swarm/memory.db',
      retrievalK: 3,
      autoConsolidate: true,
      consolidateEvery: 20,
      minConfidence: 0.5,
      domains: ['web', 'api', 'database', 'security'],
      piiScrubbing: true,
    },
  };
}
```

#### 4.3 Add ReasoningBank Methods

```typescript
/**
 * Get ReasoningBank configuration
 */
getReasoningBankConfig(): any {
  return this.config.reasoningbank || this.getDefaultConfig().reasoningbank;
}

/**
 * Enable/disable ReasoningBank
 */
async setReasoningBankEnabled(enabled: boolean): Promise<void> {
  if (!this.config.reasoningbank) {
    this.config.reasoningbank = this.getDefaultConfig().reasoningbank!;
  }

  this.config.reasoningbank.enabled = enabled;
  await this.saveConfig();
}

/**
 * Configure ReasoningBank settings
 */
async configureReasoningBank(settings: Partial<any>): Promise<void> {
  if (!this.config.reasoningbank) {
    this.config.reasoningbank = this.getDefaultConfig().reasoningbank!;
  }

  this.config.reasoningbank = {
    ...this.config.reasoningbank,
    ...settings,
  };

  await this.saveConfig();
}
```

---

### Phase 5: Configuration Schema

**File: `~/.claude/settings.json`**

```json
{
  "claude-flow": {
    "execution": {
      "defaultProvider": "anthropic",
      "providers": {
        "anthropic": {
          "name": "anthropic",
          "model": "claude-sonnet-4-5-20250929",
          "enabled": true,
          "priority": "quality"
        },
        "openrouter": {
          "name": "openrouter",
          "model": "meta-llama/llama-3.1-8b-instruct",
          "enabled": true,
          "priority": "cost"
        }
      },
      "optimization": {
        "strategy": "balanced",
        "maxCostPerTask": 0.5
      },
      "reasoningbank": {
        "enabled": true,
        "database": ".swarm/memory.db",
        "retrievalK": 3,
        "autoConsolidate": true,
        "consolidateEvery": 20,
        "minConfidence": 0.5,
        "domains": ["web", "api", "database", "security"],
        "piiScrubbing": true
      }
    }
  }
}
```

---

## Usage Examples

### Example 1: Enable Learning for Web Development

```bash
# First time: Initialize database
claude-flow agent memory init

# Run task with learning enabled
claude-flow agent run coder "Build login form with CSRF protection" \
  --enable-memory \
  --memory-domain web \
  --provider openrouter

# Output:
# 🧠 Retrieved 2 relevant memories
#    Memory 1: CSRF token extraction strategy
#    Memory 2: Form validation patterns
# ✅ Task completed successfully
# 📚 Learned 1 new memory: "Login form implementation pattern"
```

### Example 2: Knowledge Transfer Across Tasks

```bash
# Task 1: Learn authentication
claude-flow agent run coder "Add JWT authentication" \
  --enable-memory \
  --memory-domain api

# Task 2: Similar task benefits from Memory 1
claude-flow agent run coder "Add OAuth2 authentication" \
  --enable-memory \
  --memory-domain api

# Output:
# 🧠 Retrieved 3 relevant memories
#    Memory 1: JWT authentication pattern (confidence: 0.85)
#    Memory 2: Token validation strategy (confidence: 0.78)
#    Memory 3: Session management (confidence: 0.71)
# ⚡ 46% faster execution (learned from Task 1)
```

### Example 3: Memory Management

```bash
# View statistics
claude-flow agent memory status
# Output:
# 📊 ReasoningBank Status
#    • Total memories: 47
#    • Average confidence: 0.76
#    • Total embeddings: 47
#    • Total trajectories: 152

# List top memories
claude-flow agent memory list --sort confidence --limit 5
# Output:
# 📚 Memory Bank Contents
# 1. CSRF token extraction (confidence: 0.92, used: 15 times)
# 2. API rate limiting (confidence: 0.89, used: 12 times)
# 3. Database connection pooling (confidence: 0.85, used: 10 times)

# Run consolidation
claude-flow agent memory consolidate
# Output:
# 🔄 Memory Consolidation Complete
#    • Duplicates removed: 3
#    • Contradictions detected: 0
#    • Pruned memories: 2
#    • Duration: 127ms
```

### Example 4: Read-Only Memory Access

```bash
# Research with memory context, but don't learn
claude-flow agent run researcher "Research React 19 features" \
  --enable-memory \
  --no-learning \
  --memory-domain web
```

### Example 5: Domain-Specific Learning

```bash
# Security domain
claude-flow agent run security-auditor "Audit authentication" \
  --enable-memory \
  --memory-domain security

# Database domain
claude-flow agent run database-architect "Design schema" \
  --enable-memory \
  --memory-domain database

# Memories are isolated by domain for better relevance
```

---

## Testing Strategy

### Unit Tests

**File: `tests/unit/agent-executor.test.ts`**

```typescript
describe('AgentExecutor with ReasoningBank', () => {
  it('should initialize memory database', async () => {
    const executor = new AgentExecutor();
    await executor.initializeMemory('.test/memory.db');

    const stats = await executor.getMemoryStats();
    expect(stats.enabled).toBe(true);
  });

  it('should retrieve memories before execution', async () => {
    const executor = new AgentExecutor();
    await executor.initializeMemory();

    const memories = await executor.retrieveMemories(
      'Build login form',
      { k: 3, domain: 'web' }
    );

    expect(Array.isArray(memories)).toBe(true);
  });

  it('should learn from successful execution', async () => {
    const executor = new AgentExecutor();
    await executor.initializeMemory();

    const result = await executor.execute({
      agent: 'coder',
      task: 'Create REST API',
      enableMemory: true,
    });

    expect(result.memoryLearned).toBe(true);
    expect(result.newMemoryIds).toHaveLength(1);
  });

  it('should auto-consolidate after N tasks', async () => {
    const executor = new AgentExecutor();
    await executor.initializeMemory();

    // Run 20 tasks
    for (let i = 0; i < 20; i++) {
      await executor.execute({
        agent: 'coder',
        task: `Task ${i}`,
        enableMemory: true,
      });
    }

    // Consolidation should have run automatically
    const stats = await executor.getMemoryStats();
    expect(stats.lastConsolidation).toBeDefined();
  });
});
```

### Integration Tests

**File: `tests/integration/reasoningbank-integration.test.ts`**

```typescript
describe('ReasoningBank CLI Integration', () => {
  it('should execute with memory enabled via CLI', async () => {
    const { stdout } = await execAsync(
      'claude-flow agent run coder "Test task" --enable-memory'
    );

    expect(stdout).toContain('🧠 Retrieved');
    expect(stdout).toContain('✅ Task completed');
  });

  it('should show memory statistics', async () => {
    const { stdout } = await execAsync(
      'claude-flow agent memory status'
    );

    expect(stdout).toContain('Total memories');
    expect(stdout).toContain('Average confidence');
  });

  it('should consolidate memories', async () => {
    const { stdout } = await execAsync(
      'claude-flow agent memory consolidate'
    );

    expect(stdout).toContain('Consolidation complete');
  });
});
```

---

## Documentation Updates

### README.md

Add section after "Quick Start":

```markdown
## 🧠 ReasoningBank: Learning Memory System

Claude-flow includes ReasoningBank, which gives agents long-term memory and learning capabilities.

### Enable Learning

```bash
# Initialize database (first time only)
claude-flow agent memory init

# Run agent with learning enabled
claude-flow agent run coder "Build feature" --enable-memory
```

### How It Works

1. **RETRIEVE** - Finds 3 relevant memories from past tasks
2. **EXECUTE** - Runs agent with memory context
3. **LEARN** - Extracts reusable strategies
4. **CONSOLIDATE** - Cleans up memories every 20 tasks

### Benefits

- 🎯 **98% success rate** after learning (vs 23% without)
- ⚡ **3.5x faster** over time
- 🔗 **Knowledge transfer** across similar tasks
- 🔐 **PII-safe** automatic scrubbing

See [ReasoningBank Guide](docs/REASONINGBANK_GUIDE.md) for details.
```

### New File: docs/REASONINGBANK_GUIDE.md

Create comprehensive user guide with:
- Concepts (4-phase loop)
- Configuration options
- CLI commands
- Usage patterns
- Best practices
- Troubleshooting

---

## Migration Path

### For Existing Users

1. **Update dependency:**
   ```bash
   npm install agentic-flow@1.4.11
   ```

2. **Initialize memory (optional):**
   ```bash
   claude-flow agent memory init
   ```

3. **Enable in config:**
   ```json
   {
     "claude-flow": {
       "execution": {
         "reasoningbank": {
           "enabled": true
         }
       }
     }
   }
   ```

4. **Use existing commands with `--enable-memory` flag**

### Backwards Compatibility

- ✅ All existing commands work unchanged
- ✅ Memory is **opt-in** via `--enable-memory` flag
- ✅ No breaking changes to APIs
- ✅ Graceful degradation if memory fails

---

## Performance Impact

### Memory Overhead

- **Storage**: ~1KB per memory (1000 memories = 1MB)
- **Retrieval latency**: 0.9-3ms per query
- **Learning latency**: 1-2s per task
- **Auto-consolidation**: 5-10ms every 20 tasks

### Network Overhead

- **None** - All operations are local SQLite
- **Optional**: LLM-based judgment requires API call

### Recommended Limits

- **Max memories**: 10,000 (optimal performance)
- **Consolidation threshold**: 5,000 memories
- **Retrieval k**: 3-5 memories per task

---

## Security Considerations

### PII Scrubbing

Automatic scrubbing of 9 patterns:
- Email addresses
- API keys (Anthropic, OpenAI, GitHub, Slack)
- Social Security Numbers
- Credit card numbers
- Phone numbers
- IP addresses
- URLs with secrets
- Bearer tokens
- Private keys

### Access Control

- Database stored in user's `.swarm/` directory
- File permissions: 600 (owner read/write only)
- No network access required
- Optional encryption at rest (future)

### Privacy

- Memories never leave local machine
- No telemetry or analytics
- Optional export/import for team sharing

---

## Release Checklist

### v2.7.0-alpha.1 (ReasoningBank Integration)

- [ ] Update `agentic-flow` dependency to 1.4.11
- [ ] Implement `AgentExecutor` ReasoningBank methods
- [ ] Add CLI flags to `agent.js`
- [ ] Extend `ProviderManager` with memory config
- [ ] Add `agent memory` subcommands
- [ ] Create unit tests (15+ tests)
- [ ] Create integration tests (10+ tests)
- [ ] Update README.md
- [ ] Create REASONINGBANK_GUIDE.md
- [ ] Add examples to docs/examples/
- [ ] Update CHANGELOG.md
- [ ] Test on Linux, macOS, Windows
- [ ] Alpha release to npm

### v2.7.0 (Stable Release)

- [ ] Collect feedback from alpha users
- [ ] Fix reported bugs
- [ ] Add advanced features (encryption, export/import)
- [ ] Performance optimization
- [ ] Comprehensive documentation
- [ ] Video tutorials
- [ ] Blog post announcement
- [ ] Stable release to npm

---

## Future Enhancements (v2.8.0+)

### Planned Features

1. **Memory Encryption**
   - Encrypt database at rest
   - Key management system
   - Optional encryption flag

2. **Team Collaboration**
   - Export/import memory banks
   - Shared team memories
   - Access control lists

3. **Advanced Learning**
   - Multi-agent memory sharing
   - Cross-domain learning
   - Meta-learning strategies

4. **Analytics Dashboard**
   - Memory usage visualization
   - Learning progress tracking
   - Performance metrics

5. **Cloud Sync** (optional)
   - Sync memories across devices
   - Backup to cloud storage
   - Team synchronization

---

## Conclusion

This integration plan provides:

✅ **Comprehensive** - All ReasoningBank features exposed
✅ **Backwards Compatible** - No breaking changes
✅ **Well Tested** - 25+ tests planned
✅ **Documented** - Complete user guide
✅ **Performant** - <5ms overhead per task
✅ **Secure** - PII scrubbing + local storage
✅ **Future-Proof** - Extensible architecture

**Target Release:** v2.7.0-alpha.1 (Q2 2025)
**Effort Estimate:** 2-3 weeks development + 1 week testing
**Breaking Changes:** None
**Migration Required:** Optional (opt-in feature)

---

**Questions or feedback?**
- GitHub Issues: https://github.com/ruvnet/claude-code-flow/issues
- Documentation: https://github.com/ruvnet/claude-code-flow/docs
