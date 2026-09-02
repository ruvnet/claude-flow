# V3 Hooks System Implementation

## Overview

The V3 Hooks System provides a comprehensive event-driven architecture for intercepting, modifying, and recording operations throughout the claude-flow lifecycle. It integrates with the **ReasoningBank** neural learning system to enable self-improving agent behaviors.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        Hooks System                                 │
├─────────────────┬─────────────────┬─────────────────┬──────────────┤
│   Hook Registry │  Hook Executor  │  MCP Tools      │ CLI Commands │
│   (registration)│  (execution)    │  (API access)   │ (user access)│
└────────┬────────┴────────┬────────┴────────┬────────┴──────┬───────┘
         │                 │                 │               │
         └────────────────┬┴─────────────────┴───────────────┘
                          │
                  ┌───────▼───────┐
                  │ ReasoningBank │
                  │   (learning)  │
                  └───────────────┘
```

## Components

### 1. Hook Registry (`@claude-flow/shared/src/hooks/registry.ts`)

Manages hook registration, priority ordering, and lifecycle.

```typescript
import { createHookRegistry, HookEvent, HookPriority } from '@claude-flow/shared';

const registry = createHookRegistry();

// Register a hook
const hookId = registry.register(
  HookEvent.PreToolUse,
  async (context) => {
    console.log(`Tool ${context.tool?.name} about to be called`);
    return { success: true };
  },
  HookPriority.High
);

// Disable/enable hooks
registry.disable(hookId);
registry.enable(hookId);

// Get statistics
const stats = registry.getStats();
```

### 2. Hook Executor (`@claude-flow/shared/src/hooks/executor.ts`)

Executes registered hooks in priority order with error handling.

```typescript
import { createHookExecutor, HookContext } from '@claude-flow/shared';

const executor = createHookExecutor(registry, eventBus);

const context: HookContext = {
  event: HookEvent.PreToolUse,
  timestamp: new Date(),
  tool: { name: 'Read', parameters: { path: 'file.ts' } },
};

// Execute hooks
const result = await executor.execute(HookEvent.PreToolUse, context, {
  continueOnError: true,  // Don't abort on individual hook failures
});

// Execute with timeout
const timedResult = await executor.executeWithTimeout(
  HookEvent.PreToolUse,
  context,
  5000  // 5 second timeout
);
```

### 3. MCP Tools (`v3/mcp/tools/hooks-tools.ts`)

MCP-accessible tools for hooks system operations.

| Tool Name | Description |
|-----------|-------------|
| `hooks/pre-edit` | Get context and suggestions before file edits |
| `hooks/post-edit` | Record edit outcomes for learning |
| `hooks/pre-command` | Risk assessment before command execution |
| `hooks/post-command` | Record command outcomes |
| `hooks/route` | Route task to optimal agent |
| `hooks/explain` | Explain routing decision with transparency |
| `hooks/pretrain` | Bootstrap intelligence from repository |
| `hooks/metrics` | Get learning metrics and statistics |
| `hooks/list` | List registered hooks |

### 4. CLI Commands (`@claude-flow/cli/src/commands/hooks.ts`)

User-accessible CLI for hooks operations.

```bash
# Pre/Post Edit Hooks
npx claude-flow hooks pre-edit <filePath> [--operation modify]
npx claude-flow hooks post-edit <filePath> --success true

# Pre/Post Command Hooks
npx claude-flow hooks pre-command "npm test"
npx claude-flow hooks post-command "npm test" --success true --exit-code 0

# Task Routing
npx claude-flow hooks route "Implement user authentication"
npx claude-flow hooks explain "Implement user authentication" --verbose

# Intelligence Bootstrap
npx claude-flow hooks pretrain [--include-git --include-deps]
npx claude-flow hooks build-agents [--focus security]

# Metrics & Management
npx claude-flow hooks metrics [--category routing]
npx claude-flow hooks list [--category pre-edit]
npx claude-flow hooks transfer <sourceProject>
```

## Hook Events

### Supported Events

| Event | Description | Trigger Point |
|-------|-------------|---------------|
| `PreToolUse` | Before any tool is called | Before Read, Write, Edit, Bash, etc. |
| `PostToolUse` | After tool completes | After tool returns result |
| `PreEdit` | Before file edit | Before Edit/Write operations |
| `PostEdit` | After file edit | After Edit/Write completes |
| `PreCommand` | Before bash command | Before Bash tool execution |
| `PostCommand` | After bash command | After Bash returns |
| `PreTask` | Before task starts | Task assignment |
| `PostTask` | After task completes | Task completion/failure |
| `SessionStart` | Session begins | MCP session initialization |
| `SessionEnd` | Session ends | MCP session shutdown |

### Priority Levels

```typescript
enum HookPriority {
  Critical = 1000,  // Security, validation
  High = 100,       // Pre-processing
  Normal = 50,      // Standard hooks
  Low = 10,         // Logging, metrics
  Background = 1,   // Async operations
}
```

## Swarm Communication Hooks

V3 introduces **SwarmCommunication** for agent-to-agent coordination within swarms.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Swarm Communication Hub                           │
├───────────────────┬──────────────────┬──────────────────┬───────────────┤
│ Agent Messaging   │ Pattern Broadcast│ Consensus Engine │ Task Handoff  │
│ (send/receive)    │ (share learning) │ (reach agreement)│ (delegation)  │
└─────────┬─────────┴────────┬─────────┴────────┬─────────┴───────┬───────┘
          │                  │                  │                 │
          └──────────────────┴────────┬─────────┴─────────────────┘
                                      │
                              ┌───────▼───────┐
                              │ ReasoningBank │
                              │   (learning)  │
                              └───────────────┘
```

### 1. Agent-to-Agent Messaging

Agents can share context and coordinate in real-time:

```typescript
import { swarmComm } from '@claude-flow/hooks';

await swarmComm.initialize();

// Send to specific agent
await swarmComm.sendMessage('security-auditor', 'Found auth vulnerability', {
  type: 'context',
  priority: 'high',
});

// Broadcast to all
await swarmComm.broadcastContext('Switching to security focus');

// Get messages for this agent
const messages = swarmComm.getMessages({ limit: 10, type: 'context' });
```

**CLI Usage:**
```bash
# Send message
npx @claude-flow/hooks swarm-send security-auditor "Found vulnerability" context high

# Broadcast to all
npx @claude-flow/hooks swarm-broadcast "Switching to security focus"

# Get messages
npx @claude-flow/hooks swarm-messages 10
```

### 2. Pattern Broadcasting

Share learned patterns across the swarm so all agents benefit:

```typescript
// Broadcast high-quality pattern
const pattern = await reasoningBank.searchPatterns('HNSW optimization', 1);
if (pattern[0].pattern.quality >= 0.7) {
  await swarmComm.broadcastPattern(pattern[0].pattern);
}

// Import patterns from other agents
const broadcasts = swarmComm.getPatternBroadcasts({ minQuality: 0.8 });
for (const bc of broadcasts) {
  await swarmComm.importBroadcastPattern(bc.id);
}
```

**CLI Usage:**
```bash
# Broadcast a new pattern
npx @claude-flow/hooks swarm-pattern-broadcast "Use HNSW for 150x faster search" memory

# List recent broadcasts
npx @claude-flow/hooks swarm-patterns memory 0.8

# Import a broadcast pattern
npx @claude-flow/hooks swarm-import-pattern bc_1234567890_abc123
```

### 3. Consensus Guidance

Help agents reach agreement on approach decisions:

```typescript
// Initiate consensus
const consensus = await swarmComm.initiateConsensus(
  'Which authentication method should we use?',
  ['JWT', 'OAuth2', 'Session'],
  30000 // 30 second timeout
);

// Vote
swarmComm.voteConsensus(consensus.id, 'JWT');

// Get guidance text
const guidance = swarmComm.generateConsensusGuidance(consensus.id);
console.log(guidance);
// **Consensus: Which authentication method?**
// Status: RESOLVED
// **Result**: JWT
// Confidence: 75%
// Participation: 100%
```

**CLI Usage:**
```bash
# Start consensus
npx @claude-flow/hooks swarm-consensus "Which auth method?" "JWT,OAuth2,Session" 30000

# Vote
npx @claude-flow/hooks swarm-vote cons_1234567890_abc "JWT"

# Check status
npx @claude-flow/hooks swarm-consensus-status cons_1234567890_abc
```

### 4. Task Handoff

Coordinate task delegation between agents:

```typescript
// Agent 1: Hand off task
const handoff = await swarmComm.initiateHandoff(
  'test-architect',
  'Write security tests for auth module',
  {
    filesModified: ['src/auth/login.ts', 'src/auth/session.ts'],
    patternsUsed: ['Use parameterized queries', 'Add rate limiting'],
    decisions: ['Chose JWT over sessions for stateless auth'],
    blockers: [],
    nextSteps: ['Write unit tests', 'Add integration tests'],
  }
);

// Agent 2: Accept handoff
swarmComm.acceptHandoff(handoff.id);
const context = swarmComm.generateHandoffContext(handoff.id);
// ## Task Handoff from security-auditor
// **Task**: Write security tests for auth module
// **Files Modified**: src/auth/login.ts, src/auth/session.ts
// **Patterns Used**: Use parameterized queries, Add rate limiting
// **Decisions Made**: Chose JWT over sessions for stateless auth
// **Next Steps**: [ ] Write unit tests, [ ] Add integration tests

// Agent 2: Complete handoff
swarmComm.completeHandoff(handoff.id, { testsWritten: 15 });
```

**CLI Usage:**
```bash
# Initiate handoff
npx @claude-flow/hooks swarm-handoff test-architect "Write auth tests" \
  '{"filesModified":["src/auth/login.ts"],"nextSteps":["Write unit tests"]}'

# Accept handoff
npx @claude-flow/hooks swarm-accept-handoff ho_1234567890_abc

# Complete handoff
npx @claude-flow/hooks swarm-complete-handoff ho_1234567890_abc '{"testsWritten":15}'

# List pending handoffs
npx @claude-flow/hooks swarm-handoffs
```

### Swarm Communication Events

| Event | Description | Data |
|-------|-------------|------|
| `message:sent` | Message sent | SwarmMessage |
| `message:delivered` | Message delivered | SwarmMessage |
| `pattern:broadcast` | Pattern broadcast | PatternBroadcast |
| `pattern:acknowledged` | Broadcast acknowledged | { broadcastId, agentId } |
| `consensus:initiated` | Consensus started | ConsensusRequest |
| `consensus:voted` | Vote cast | { consensusId, agentId, vote } |
| `consensus:resolved` | Consensus resolved | ConsensusRequest |
| `handoff:initiated` | Handoff started | TaskHandoff |
| `handoff:accepted` | Handoff accepted | TaskHandoff |
| `handoff:completed` | Handoff completed | TaskHandoff |
| `agent:registered` | Agent joined | SwarmAgentState |

### Swarm Statistics

```bash
npx @claude-flow/hooks swarm-stats
# {
#   "agentId": "agent_1234567890_abc",
#   "agentCount": 5,
#   "metrics": {
#     "messagesSent": 42,
#     "messagesReceived": 38,
#     "patternsBroadcast": 12,
#     "consensusInitiated": 3,
#     "consensusResolved": 3,
#     "handoffsInitiated": 8,
#     "handoffsCompleted": 7
#   },
#   "pendingMessages": 2,
#   "pendingHandoffs": 1,
#   "pendingConsensus": 0
# }
```

## ReasoningBank Integration

The hooks system integrates with **ReasoningBank** for adaptive learning:

### 4-Step Learning Pipeline

1. **RETRIEVE** - Top-k memory injection with MMR diversity
2. **JUDGE** - LLM-as-judge trajectory evaluation
3. **DISTILL** - Extract strategy memories from trajectories
4. **CONSOLIDATE** - Dedup, detect contradictions, prune patterns

### Trajectory Storage

```typescript
// Post-edit hook creates trajectory
const trajectory = createTrajectory(
  `modify file: ${filePath}`,
  'code',
  'edit',
  success ? 0.9 : 0.3  // Quality score
);

reasoningBank.storeTrajectory(trajectory);

// Successful operations are distilled into memories
if (success) {
  const memory = await reasoningBank.distill(trajectory);
}
```

### Pattern Retrieval

```typescript
// Pre-edit hook retrieves similar patterns
const queryEmbedding = generateSimpleEmbedding(filePath);
const patterns = await reasoningBank.retrieve(queryEmbedding, 5);

// Patterns inform suggestions
patterns.forEach(p => {
  console.log(`Similar pattern: ${p.memory.strategy}`);
  console.log(`Confidence: ${p.relevanceScore}`);
});
```

## V2 Compatibility

V3 maintains full backward compatibility with V2 hooks:

### V2 CLI Syntax (Supported)

```bash
# V2 syntax still works
npx claude-flow hooks pre-task --description "task"
npx claude-flow hooks session-restore --session-id "swarm-123"
npx claude-flow hooks post-edit --file "file.ts" --memory-key "swarm/agent/step"
npx claude-flow hooks notify --message "completed"
npx claude-flow hooks session-end --export-metrics true
```

### V2 MCP Tools (Deprecated but Functional)

The V2 underscore-based tool names are available via the compatibility layer:

| V2 Tool | V3 Equivalent |
|---------|---------------|
| `swarm_init` | `swarm/init` |
| `agent_spawn` | `agent/spawn` |
| `task_orchestrate` | `tasks/create` |
| `memory_usage` | `memory/store`, `memory/search` |
| `neural_status` | `system/status` |
| `neural_train` | `hooks/pretrain` |

## Configuration

### Hook Registry Options

```typescript
const registry = createHookRegistry({
  maxHooksPerEvent: 50,       // Limit hooks per event type
  defaultTimeout: 5000,       // Default execution timeout
  enableMetrics: true,        // Track execution statistics
  logLevel: 'info',           // Logging verbosity
});
```

### ReasoningBank Configuration

```typescript
const reasoningBank = createReasoningBank({
  maxTrajectories: 5000,        // Max stored trajectories
  distillationThreshold: 0.6,   // Min quality for distillation
  retrievalK: 5,                // Top-k retrieval
  mmrLambda: 0.7,               // Diversity vs relevance
  enableAgentDB: true,          // Use AgentDB for persistence
  namespace: 'hooks-learning',  // Storage namespace
});
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Hook execution overhead | <10ms | ~5ms |
| ReasoningBank retrieval | <50ms | ~30ms |
| Pattern distillation | <100ms | ~75ms |
| Metrics calculation | <5ms | ~2ms |

## Files

```
v3/
├── @claude-flow/hooks/src/
│   ├── types.ts                    # Hook type definitions
│   ├── index.ts                    # Module exports
│   ├── registry/
│   │   └── index.ts                # Hook registration
│   ├── executor/
│   │   └── index.ts                # Hook execution engine
│   ├── reasoningbank/
│   │   ├── index.ts                # ReasoningBank learning engine
│   │   └── guidance-provider.ts    # Claude-visible output generator
│   ├── swarm/
│   │   └── index.ts                # Swarm communication hub
│   ├── daemons/
│   │   └── index.ts                # Background daemon processes
│   ├── statusline/
│   │   └── index.ts                # Status line generation
│   ├── cli/
│   │   └── guidance-cli.ts         # CLI commands
│   ├── bridge/
│   │   └── official-hooks-bridge.ts # Official hooks bridge
│   ├── mcp/
│   │   └── index.ts                # MCP tools
│   └── __tests__/
│       ├── reasoningbank.test.ts   # ReasoningBank tests
│       └── guidance-provider.test.ts # GuidanceProvider tests
├── @claude-flow/shared/src/hooks/
│   ├── types.ts                    # Shared hook types
│   ├── registry.ts                 # Hook registry (shared)
│   └── index.ts                    # Shared exports
├── mcp/tools/
│   ├── hooks-tools.ts              # MCP hook tools
│   └── v2-compat-tools.ts          # V2 compatibility layer
└── implementation/hooks/
    ├── README.md                   # This documentation
    ├── CLI-REFERENCE.md            # CLI command reference
    ├── MCP-TOOLS.md                # MCP tools documentation
    └── STATUSLINE-DAEMONS.md       # Daemon documentation
```

## Usage Examples

### Example 1: Security Validation Hook

```typescript
registry.register(
  HookEvent.PreCommand,
  async (context) => {
    const command = context.command?.raw || '';

    // Block dangerous commands
    if (/rm -rf|format|drop database/i.test(command)) {
      return {
        success: false,
        abort: true,
        message: 'Command blocked by security hook',
      };
    }

    return { success: true };
  },
  HookPriority.Critical
);
```

### Example 2: Metrics Collection Hook

```typescript
registry.register(
  HookEvent.PostToolUse,
  async (context) => {
    const toolName = context.tool?.name;
    const duration = context.duration;

    await metricsCollector.record({
      tool: toolName,
      duration,
      timestamp: context.timestamp,
    });

    return { success: true };
  },
  HookPriority.Background
);
```

### Example 3: Intelligent Routing

```typescript
// Route task to optimal agent
const result = await executor.execute(HookEvent.PreTask, {
  event: HookEvent.PreTask,
  timestamp: new Date(),
  task: { description: 'Implement OAuth2 authentication' },
});

// Result contains routing recommendation
console.log(result.data?.recommendedAgent);  // 'security-auditor'
console.log(result.data?.confidence);        // 0.92
```

## Testing

```bash
# Run hooks tests
cd v3/@claude-flow/shared
npm test -- hooks.test.ts

# Run with coverage
npm test -- --coverage hooks/
```

## ADR References

- **ADR-005**: MCP-First API Design - Hooks exposed as MCP tools
- **ADR-006**: Unified Memory Service - ReasoningBank integration
- **ADR-007**: Event Sourcing - Hook events as audit trail
