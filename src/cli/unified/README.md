# Unified CLI System

This directory contains the unified CLI implementation for Claude-Flow, designed to eliminate code duplication and provide a consistent command interface.

## Architecture

### Core Components

- **`interfaces.ts`** - Core interfaces and types for the unified system
- **`command-registry.ts`** - Central command registration and execution
- **`node-runtime.ts`** - Node.js runtime adapter for environment operations
- **`cli.ts`** - Main CLI entry point with Commander.js integration
- **`commands/`** - Unified command implementations

### Key Benefits

1. **Eliminates Duplication** - Single implementation per command instead of TypeScript + JavaScript versions
2. **Consistent Interface** - All commands use the same `CommandContext` interface
3. **Runtime Abstraction** - Commands work regardless of runtime environment
4. **Type Safety** - Full TypeScript support with proper interfaces
5. **Better Error Handling** - Structured `CLIError` with user-friendly messages

## Usage

### Basic Integration

```typescript
import { main } from './unified/cli.js';

// Run the unified CLI
await main(process.argv);
```

### Custom Command Registration

```typescript
import { UnifiedCommandRegistry } from './unified/command-registry.js';
import { myCommand } from './commands/my-command.js';

const registry = new UnifiedCommandRegistry();
registry.register('my-command', myCommand);
await registry.execute('my-command', ['arg1', 'arg2'], { verbose: true });
```

### Creating New Commands

```typescript
import type { CommandHandler } from '../interfaces.js';

export const myCommand: CommandHandler = {
  description: 'My custom command',
  options: [
    {
      flag: '--verbose',
      description: 'Enable verbose output',
      aliases: ['-v']
    }
  ],
  examples: [
    'claude-flow my-command --verbose'
  ],
  action: async (ctx) => {
    console.log('Command executed with args:', ctx.args);
    console.log('Flags:', ctx.flags);
    
    // Use runtime adapter for file operations
    const content = await ctx.runtime.readFile('./some-file.txt');
    console.log('File content:', content);
  }
};
```

## Migration Guide

### From Duplicate Commands

1. **Analyze both implementations** (TypeScript and JavaScript versions)
2. **Identify common functionality** and merge into unified command
3. **Use CommandContext interface** for consistent parameter handling
4. **Abstract runtime operations** through `ctx.runtime`
5. **Maintain backward compatibility** for command syntax
6. **Add comprehensive error handling** with `CLIError`

### Example Migration

Before (TypeScript version):
```typescript
// commands/status.ts
export async function statusAction(ctx: CommandContext): Promise<void> {
  const config = await loadSparcConfig();
  // ... implementation
}
```

Before (JavaScript version):
```javascript
// simple-commands/status.js
export async function statusCommand(subArgs, flags) {
  const configContent = await Deno.readTextFile('.roomodes');
  // ... implementation
}
```

After (Unified):
```typescript
// unified/commands/status.ts
export const statusCommand: CommandHandler = {
  description: 'Show system status',
  action: async (ctx: CommandContext) => {
    const config = await ctx.runtime.readFile('.roomodes');
    // ... merged implementation
  }
};
```

## Testing

Run the test suite to validate the unified CLI:

```bash
npx tsx src/cli/unified/test-unified-cli.ts
```

## Command Migration Status

### Completed ✅
- **status** - System status and monitoring

### In Progress 🔄
- (None currently)

### Planned 📋
- **agent** - Agent management commands
- **sparc** - SPARC development modes
- **memory** - Memory operations
- **config** - Configuration management
- **init** - Project initialization
- **start** - System startup
- **swarm** - Swarm coordination
- **task** - Task management
- **mcp** - MCP server operations

## File Structure

```
unified/
├── README.md                 # This file
├── interfaces.ts             # Core interfaces
├── node-runtime.ts           # Runtime adapter
├── command-registry.ts       # Command system
├── cli.ts                    # Main entry point
├── index.ts                  # Module exports
├── test-unified-cli.ts       # Test suite
└── commands/
    ├── status.ts             # Status command
    ├── agent.ts              # (Planned)
    ├── sparc.ts              # (Planned)
    └── ...                   # (Other commands)
```

## Design Principles

1. **Gradual Migration** - Commands can be migrated one at a time
2. **Backward Compatibility** - Existing command syntax must be preserved
3. **Runtime Abstraction** - No direct dependency on specific runtime APIs
4. **Type Safety** - Full TypeScript support for better developer experience
5. **Error Handling** - Consistent, user-friendly error messages
6. **Testing** - Each command should be testable in isolation

## Next Steps

1. **Continue command migration** following established patterns
2. **Update main CLI entry points** to use unified system
3. **Comprehensive testing** of all migrated commands
4. **Performance optimization** and bundle size analysis
5. **Documentation updates** for users and developers