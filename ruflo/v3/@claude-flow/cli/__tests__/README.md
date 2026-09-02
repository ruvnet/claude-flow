# CLI Module Tests

This directory contains comprehensive tests for the V3 CLI module using Vitest.

## Test Files

### 1. `cli.test.ts` (~15+ tests)
Tests for the main CLI class covering:
- Version command (`--version`, `-V`)
- Help output (`--help`, `-h`)
- Command parsing (long flags, short flags, equals syntax)
- Positional arguments
- Boolean flags and negation
- Global flags (`--quiet`, `--format`, `--config`, `--no-color`)
- Error handling (unknown commands, missing options)
- Subcommand execution and aliases
- Exit codes

### 2. `mcp-client.test.ts` (~10+ tests)
Tests for MCP tool invocation:
- `callMCPTool()` - Tool execution with various inputs
- `getToolMetadata()` - Metadata retrieval
- `listMCPTools()` - Tool listing and filtering by category
- `hasTool()` - Tool existence checks
- `getToolCategories()` - Category enumeration
- `validateToolInput()` - Input validation against schemas
- `MCPClientError` - Custom error handling

### 3. `commands.test.ts` (~48+ tests)
Tests for all CLI commands:

**Agent Commands (spawn, list, status, stop, metrics):**
- Spawning agents with various configurations
- Listing agents with filters
- Getting agent status and metrics
- Stopping agents (graceful/force)
- Agent performance metrics

**Swarm Commands (init, start, status, stop, scale, coordinate):**
- Initializing swarms with different topologies
- Starting swarm execution with objectives
- Checking swarm status
- Stopping and scaling swarms
- V3 15-agent coordination structure

**Memory Commands (store, retrieve, search, list, delete, stats, configure):**
- Storing data in memory (with/without vectors)
- Retrieving data by key
- Semantic/vector search
- Listing memory entries
- Deleting entries
- Viewing statistics
- Backend configuration

**Config Commands (init, get, set, providers, reset, export, import):**
- Initializing configuration
- Getting/setting config values
- Managing AI providers
- Resetting to defaults
- Exporting/importing configuration

## Mocking Strategy

### MCP Tools
All MCP tools are mocked at the module level to prevent actual tool execution:
- `agent-tools.js` - Mocked agent operations
- `swarm-tools.js` - Mocked swarm coordination
- `memory-tools.js` - Mocked memory operations
- `config-tools.js` - Mocked configuration

### Output
The `output` module is fully mocked to capture formatted output without console pollution.

### Prompts
Interactive prompts (`select`, `confirm`, `input`, `multiSelect`) are mocked to return default values for non-interactive testing.

### Process
`process.exit()` is mocked to throw errors instead of terminating the test process.

## Running Tests

```bash
# Run all CLI tests
npm test -- v3/@claude-flow/cli/__tests__/

# Run specific test file
npm test -- v3/@claude-flow/cli/__tests__/cli.test.ts

# Run with coverage
npm test -- v3/@claude-flow/cli/__tests__/ --coverage

# Run in watch mode
npm test -- v3/@claude-flow/cli/__tests__/ --watch
```

## Test Coverage Goals

- **Statements**: >80%
- **Branches**: >75%
- **Functions**: >80%
- **Lines**: >80%

## Key Testing Patterns

### 1. Command Execution
```typescript
const result = await command.action!(ctx);
expect(result.success).toBe(true);
expect(result.data).toHaveProperty('expectedField');
```

### 2. Flag Parsing
```typescript
ctx.flags = { myFlag: 'value', _: [] };
await command.action!(ctx);
// Assertions in action callback
```

### 3. Error Handling
```typescript
try {
  await cli.run(['invalid-command']);
} catch (e) {
  expect((e as Error).message).toContain('process.exit');
}
```

### 4. Output Validation
```typescript
const output = consoleOutput.join('');
expect(output).toContain('Expected text');
```

## Notes

- All tests are non-interactive (`interactive: false`)
- Console output is captured for verification
- Process exits are converted to exceptions
- MCP client is fully isolated from actual MCP server
- Tests use unique command names to avoid conflicts
