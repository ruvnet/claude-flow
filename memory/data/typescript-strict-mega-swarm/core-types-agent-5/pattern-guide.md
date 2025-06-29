# TypeScript Strict Mode Pattern Guide
## Core Types Foundation Agent #5 - Pattern Documentation

This guide documents the established patterns for fixing TypeScript strict mode errors, particularly for `exactOptionalPropertyTypes: true` and `noPropertyAccessFromIndexSignature: true`.

## Pattern 1: Fixing exactOptionalPropertyTypes Errors

### Problem
With `exactOptionalPropertyTypes: true`, optional properties must explicitly include `| undefined` in their type.

### Solution
Use the strict type interfaces from `src/types/strict-mode-utilities.ts`.

#### Example 1: ProcessPoolResult
**Before:**
```typescript
const result: ProcessPoolResult = {
  exitCode: code || 0,
  output: ''
};
if (childProcess.pid !== undefined) {
  result.pid = childProcess.pid;
}
```

**After:**
```typescript
import { StrictProcessResult, createProcessResult } from '../types/strict-mode-utilities.js';

const result = createProcessResult({
  exitCode: code || 0,
  output: '',
  pid: childProcess.pid  // undefined is handled by the factory
});
```

#### Example 2: QueryOptions
**Before:**
```typescript
const queryOptions = createQueryOptions({ ... });
if (options.createdAfter) {
  queryOptions.createdAfter = new Date(options.createdAfter);
}
```

**After:**
```typescript
import { StrictQueryOptions } from '../types/strict-mode-utilities.js';

const queryOptions: StrictQueryOptions = {
  fullTextSearch: search,
  namespace: options.namespace,
  createdAfter: options.createdAfter ? new Date(options.createdAfter) : undefined,
  // ... all properties defined upfront with explicit undefined
};
```

## Pattern 2: Fixing noPropertyAccessFromIndexSignature Errors

### Problem
With `noPropertyAccessFromIndexSignature: true`, you cannot use dot notation to access properties from index signatures.

### Solution
Use bracket notation or the `safeEnv` utility for environment variables.

#### Example 1: Environment Variables
**Before:**
```typescript
const user = process.env.USER || process.env.USERNAME || 'unknown';
```

**After:**
```typescript
import { safeEnv } from '../../types/strict-mode-utilities.js';

const user = safeEnv.get('USER') || safeEnv.get('USERNAME') || 'unknown';
```

#### Example 2: Options Objects
**Before:**
```typescript
if (options.description) { ... }
if (options.type) { ... }
```

**After:**
```typescript
if (options['description']) { ... }
if (options['type']) { ... }
```

## Pattern 3: Available Strict Types

The following strict types are available in `src/types/strict-mode-utilities.ts`:

1. **StrictProcessResult** - For process execution results
2. **StrictQueryOptions** - For memory query operations
3. **StrictExportOptions** - For memory export operations
4. **StrictImportOptions** - For memory import operations
5. **StrictCleanupOptions** - For memory cleanup operations

Each has a corresponding factory function for safe object creation.

## Pattern 4: Utility Functions

### safeEnv
```typescript
safeEnv.get('KEY')              // returns string | undefined
safeEnv.getRequired('KEY')      // throws if not found
safeEnv.getWithDefault('KEY', 'default')  // returns string with fallback
```

### safeGet
```typescript
safeGet(obj, 'key', defaultValue)  // Safe property access with fallback
```

## Common Pitfalls to Avoid

1. **Don't mutate objects after creation** - Build complete objects upfront
2. **Don't use dot notation on Record types** - Always use bracket notation
3. **Don't forget undefined in optional property types** - Use `?: T | undefined`
4. **Don't ignore factory functions** - They ensure proper type compliance

## Migration Checklist

When fixing a file:
1. ✅ Import necessary strict types and utilities
2. ✅ Replace type annotations with strict versions
3. ✅ Build complete objects instead of mutating
4. ✅ Replace dot notation with bracket notation for index signatures
5. ✅ Use safeEnv for environment variables
6. ✅ Test that the functionality still works

## Files Already Fixed

- ✅ `src/agents/agent-manager.ts` - StrictProcessResult
- ✅ `src/cli/commands/advanced-memory-commands.ts` - All strict types
- ✅ `src/cli/commands/config.ts` - safeEnv utility

## Priority Files for Other Agents

1. **High Priority**
   - `src/cli/commands/enterprise.ts` - 70+ index signature errors
   - `src/memory/advanced-memory-manager.ts` - Uses non-strict types
   - `src/swarm/*.ts` - May have optional property issues

2. **Medium Priority**
   - `src/cli/commands/agent.ts` - Remaining type assignment issues
   - `src/sparc/*.ts` - Check for strict compliance
   - `src/core/*.ts` - Core modules may need updates

## Coordination Notes

- Agent #8 has fixed critical dependencies in ConfigManager, logger, and missing-types
- This agent (#5) has established the patterns and utilities
- Other agents should use these patterns consistently
- Check `/memory/data/typescript-strict-mega-swarm/` for coordination status