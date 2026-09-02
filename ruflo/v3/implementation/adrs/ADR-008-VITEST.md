# ADR-008: Vitest Over Jest

**Status:** Implemented
**Date:** 2026-01-03

## Context

v2 uses Jest for testing. Vitest is a modern alternative that's faster and has better ESM support.

## Decision

**Migrate to Vitest for v3.**

## Rationale

**Vitest Advantages:**
- 10x faster (uses Vite)
- Better ESM support (native)
- Compatible Jest API (easy migration)
- Better watch mode
- Built-in coverage

**Migration:**
```json
// package.json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "vite": "^5.0.0"
  },
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

## Implementation

**Configuration:**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

**Test Migration:**
```typescript
// Before (Jest)
describe('Agent', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should spawn', async () => {
    const mock = jest.fn();
    // ...
  });
});

// After (Vitest - compatible API)
import { describe, it, beforeEach, vi } from 'vitest';

describe('Agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should spawn', async () => {
    const mock = vi.fn();
    // ...
  });
});
```

## Performance Comparison

| Metric | Jest | Vitest | Improvement |
|--------|------|--------|-------------|
| Test execution | ~30s | ~3s | 10x faster |
| Watch mode startup | ~5s | ~1s | 5x faster |
| ESM support | Partial | Native | Better DX |
| HMR | No | Yes | Instant feedback |

## Success Metrics

- [x] All tests migrated to Vitest
- [x] Test execution <5s (vs 30s+ with Jest)
- [x] Coverage reporting working
- [x] CI integration complete

---

**Implementation Date:** 2026-01-04
**Status:** ✅ Complete
