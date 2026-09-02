# ADR-010: Remove Deno Support

**Status:** Implemented
**Date:** 2026-01-03

## Context

v2 attempted to support both Node.js and Deno runtimes. This added complexity without clear benefit.

**Issues:**
- Dual testing required
- Different module systems
- Import path differences
- Limited adoption of Deno version

## Decision

**v3 will support Node.js 20+ only. Deno support removed.**

## Rationale

**Focus on Node.js:**
- Primary user base on Node
- Better ecosystem (npm packages)
- Simpler build and test
- Deno can run Node code via compatibility

**If Deno support needed:**
- Wait for Deno 2.0 full Node compatibility
- Add as plugin in v3.1+

## Migration

```typescript
// Remove Deno-specific code
- src/cli/main.deno.ts ❌
- deno.json ❌
- Deno imports ❌

// Keep Node-only
+ src/cli/main.ts ✅
+ package.json ✅
+ Node imports ✅
```

## Implementation

**Package.json Updates:**
```json
{
  "engines": {
    "node": ">=20.0.0"
  },
  "type": "module"
}
```

**ESM-Only:**
```typescript
// All imports use ESM syntax
import { Agent } from './agent.js';
export { Agent };

// No CommonJS
// const Agent = require('./agent'); ❌
```

**Node.js 20+ Features Used:**
- Native ESM support
- Native fetch API
- Native FormData
- Built-in test runner (optional)
- Performance hooks
- Better TypeScript integration

## Success Metrics

- [x] All Deno code removed
- [x] Single test suite (Node only)
- [x] Build simplified
- [x] Documentation updated

---

**Implementation Date:** 2026-01-04
**Status:** ✅ Complete
