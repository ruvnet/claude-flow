# TypeScript Strict Mode Patterns Guide

*Consolidated by Agent 8 - Pattern Consolidator*  
*Last Updated: 2025-06-29*

## Overview

This guide consolidates all TypeScript strict mode fix patterns discovered during the comprehensive remediation effort. Use this as a reference for fixing similar issues and preventing future violations.

## Current Status

- **Total Errors Eliminated**: 783 (85.5% reduction)
- **Remaining Errors**: 133 
- **Key Patterns**: 6 major error categories with proven solutions
- **Automation Coverage**: 90% of fixes can be automated

## Pattern Categories

### 1. Bracket Notation (TS4111)

**Error**: Property comes from an index signature, so it must be accessed with bracket notation.

**Root Cause**: `noPropertyAccessFromIndexSignature: true` requires bracket notation for dynamic property access.

#### Patterns

```typescript
// ❌ Before
ctx.flags.verbose
process.env.NODE_ENV
obj.dynamicProperty

// ✅ After  
ctx.flags['verbose']
process.env['NODE_ENV']
obj['dynamicProperty']
```

#### Automation

```bash
# Fix all TS4111 errors automatically
node scripts/fix-ts4111-bracket-notation.ts
```

#### Special Cases

```typescript
// Optional chaining with bracket notation
obj.metadata?.['property']

// Environment variable access
import { safeEnv } from './types/strict-mode-utilities.js';
const nodeEnv = safeEnv.get('NODE_ENV') || 'development';
```

### 2. Exact Optional Properties (TS2412)

**Error**: Type 'undefined' is not assignable to type 'T' with 'exactOptionalPropertyTypes: true'.

**Root Cause**: Optional properties must explicitly include `| undefined` in their type.

#### Patterns

```typescript
// ❌ Before
interface Options { 
  prop?: string; 
}

// ✅ After
interface Options { 
  prop?: string | undefined; 
}
```

#### Factory Functions (Recommended)

```typescript
// ❌ Before - Manual object construction
const result: ProcessResult = { exitCode: 0, output: '' };
if (pid) result.pid = pid;

// ✅ After - Factory function
import { createProcessResult } from './types/strict-mode-utilities.js';
const result = createProcessResult({
  exitCode: 0,
  output: '',
  pid: pid  // undefined handled automatically
});
```

#### Available Utility Types

```typescript
import { 
  ExactOptional,
  StrictPartial,
  MakeOptionalWithUndefined,
  OptionalUndefined 
} from './types/strict-mode-utilities.js';

// Convert existing types to strict mode compliant
type StrictOptions = ExactOptional<Options>;
```

### 3. Undefined Parameter Handling (TS2345)

**Error**: Argument of type 'T | undefined' is not assignable to parameter of type 'T'.

**Root Cause**: Strict null checks require explicit undefined handling.

#### Patterns

```typescript
// ❌ Before
function process(data: string | undefined) {
  doSomething(data); // Error: data might be undefined
}

// ✅ After - Type guard
function process(data: string | undefined) {
  if (data) {
    doSomething(data); // TypeScript knows data is string
  }
}

// ✅ After - Nullish coalescing
function process(data: string | undefined) {
  doSomething(data ?? 'default');
}
```

#### Safe Access Utilities

```typescript
import { safeGet, getCommandOption } from './types/strict-mode-utilities.js';

// Safe object property access
const value = safeGet(obj, 'key', 'default');

// Safe CLI option access
const option = getCommandOption<string>(options, 'name', 'default');
```

### 4. Undefined Property Access (TS2532/TS18048)

**Error**: Object is possibly 'undefined' / Object is possibly 'null' or 'undefined'.

**Root Cause**: Strict null checks prevent access to potentially undefined objects.

#### Patterns

```typescript
// ❌ Before
obj.property // Error if obj might be undefined

// ✅ After - Optional chaining
obj?.property

// ✅ After - Null check
if (obj) {
  obj.property
}

// ✅ After - Type guard
function isNotUndefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

if (isNotUndefined(obj)) {
  obj.property // TypeScript knows obj is defined
}
```

### 5. Type Assignment Errors (TS2322/TS2375)

**Error**: Type 'X' is not assignable to type 'Y'.

**Root Cause**: Type mismatches in assignments and function calls.

#### Patterns

```typescript
// ❌ Before - Incompatible assignment
const result: StrictType = legacyObject;

// ✅ After - Conversion utility
import { toStrictQueryOptions } from './types/strict-mode-utilities.js';
const result = toStrictQueryOptions(legacyObject);

// ✅ After - Type assertion (when safe)
const result = legacyObject as StrictType;

// ✅ After - Factory function
const result = createStrictObject(legacyObject);
```

### 6. Generic Index Signature Access

**Solution**: Use safe access patterns for dynamic objects.

```typescript
import { safeGet, safeEnv } from './types/strict-mode-utilities.js';

// Environment variables
const user = safeEnv.getWithDefault('USER', 'unknown');

// Dynamic object access
const value = safeGet(record, key, defaultValue);

// CLI options
const flags = getCommandOption<boolean>(options, 'verbose', false);
```

## Automation Tools

### Scripts

1. **fix-ts4111-bracket-notation.ts**
   - Fixes all TS4111 bracket notation errors
   - 100% success rate for standard patterns
   - Preserves method calls and built-in objects

2. **fix-bracket-notation.ts**
   - General bracket notation fixes
   - Handles edge cases and complex patterns

### Usage

```bash
# Fix specific error types
node scripts/fix-ts4111-bracket-notation.ts

# Verify fixes
npm run typecheck | grep TS4111
```

## Utility Library

**File**: `src/types/strict-mode-utilities.ts`

### Core Utilities

```typescript
// Safe environment access
safeEnv.get('KEY')                    // string | undefined
safeEnv.getRequired('KEY')            // string (throws if missing)
safeEnv.getWithDefault('KEY', 'def')  // string

// Safe object access
safeGet(obj, 'key', default)          // Safe property access

// Factory functions
createProcessResult(params)           // StrictProcessResult
createQueryOptions(options)           // StrictQueryOptions

// Type validation
isAssignableToOptional(value, check)  // Type guard
safeAssign(target, key, value)        // Safe assignment
```

### Type Utilities

```typescript
ExactOptional<T>                      // Makes optional props accept undefined
StrictPartial<T>                      // Partial with undefined support
MakeOptionalWithUndefined<T, K>       // Make specific props optional
OptionalUndefined<T>                  // Ensure optional props can be undefined
```

## Prevention Strategies

### ESLint Configuration

```json
{
  "rules": {
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/prefer-nullish-coalescing": "error", 
    "@typescript-eslint/prefer-optional-chain": "error"
  }
}
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

### Development Practices

1. **Use factory functions** for object creation
2. **Prefer bracket notation** for dynamic property access  
3. **Use utility types** for optional properties
4. **Implement type guards** for runtime validation
5. **Use nullish coalescing** over logical OR
6. **Define complete objects** upfront instead of mutation

## Quick Reference

| Error Code | Fix Pattern | Tool |
|------------|-------------|------|
| TS4111 | Use bracket notation: `obj['prop']` | fix-ts4111-bracket-notation.ts |
| TS2412 | Add `\| undefined` or use factory functions | strict-mode-utilities.ts |
| TS2345 | Check undefined before function calls | Type guards |
| TS2532 | Use optional chaining or null checks | `obj?.prop` |
| TS2322 | Use type assertions or conversions | Conversion utilities |
| TS2375 | Ensure type compatibility | Factory functions |

## Migration Checklist

When fixing TypeScript strict mode errors:

- [ ] Import strict-mode-utilities.ts
- [ ] Replace dot notation with bracket notation for index signatures
- [ ] Use factory functions for object creation
- [ ] Add undefined to optional property types
- [ ] Use type guards for undefined checking
- [ ] Test with `npm run typecheck`
- [ ] Verify functionality still works

## Success Metrics

- **783 errors eliminated** (85.5% reduction from original 916)
- **133 errors remaining** (achievable completion target)
- **100% TS4111 resolution** (bracket notation)
- **90% automation coverage** for remaining fixes

## Files Modified

Key files that have been updated with these patterns:

- `src/agents/agent-manager.ts`
- `src/cli/commands/advanced-memory-commands.ts`
- `src/cli/commands/index.ts`
- `src/cli/simple-orchestrator.ts`
- `src/coordination/work-stealing.ts`
- `src/core/orchestrator.ts`
- `src/mcp/session-manager.ts`
- `src/memory/swarm-memory.ts`
- `src/services/process-registry/registry.ts`

## Agent Coordination

This pattern guide consolidates work from:

- **Agent 10**: Bracket notation fixes (TS4111)
- **Agent 11**: Bracket notation summary
- **Agent 30**: Final validation and metrics
- **Core Types Agent 5**: Pattern establishment
- **Agent 8**: Pattern consolidation (this document)

## Next Steps

1. Apply remaining TS2345 undefined parameter fixes (20 errors)
2. Implement automated TS2412 fixes using factory functions
3. Create additional ESLint rules to prevent future violations
4. Document team migration path for strict mode adoption

---

*This guide represents the collective learning from fixing 783 TypeScript strict mode errors. Use these patterns to maintain type safety and prevent future violations.*