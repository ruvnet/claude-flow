# better-sqlite3 Usage Inventory - Claude-Flow v3

**Generated**: 2026-01-03
**Purpose**: Complete inventory of better-sqlite3 usage across codebase for sql.js migration

---

## Summary

- **Total files**: 17
- **Direct imports**: 15
- **Indirect usage**: 2 (patches)
- **External dependencies**: 2 (agentic-flow, agentdb)

---

## 1. Core Database Layer

### 1.1 Main Abstraction Layer ⭐ (Priority: Critical)

**File**: `/home/user/claude-flow/src/memory/sqlite-wrapper.js`
- **Line**: 14-19 (initialization)
- **Usage**: Dynamic require/import with error handling
- **Current features**:
  - Platform detection
  - Auto-rebuild on NODE_MODULE_VERSION mismatch
  - Graceful fallback messaging
- **Migration**: Add sql.js as alternative provider
- **Impact**: High - Core abstraction used by all database operations

```javascript
// Lines 14-19
let Database = null;
let sqliteAvailable = false;
let loadError = null;
let rebuildAttempted = false;

// Line 54-66: Loading logic
async function tryLoadSQLite() {
  try {
    const require = createRequire(import.meta.url);
    Database = require('better-sqlite3');
    sqliteAvailable = true;
    return true;
  } catch (requireErr) {
    // Fallback to ES module import
    // ... error handling
  }
}
```

---

### 1.2 Database Service

**File**: `/home/user/claude-flow/src/api/database-service.ts`
- **Line**: 559
- **Usage**: Dynamic import for SQLite initialization
- **Method**: `initializeSQLite()`
- **Migration**: Indirect - uses sqlite-wrapper abstractions
- **Impact**: Medium - API layer uses DatabaseManager

```typescript
// Line 556-570
private async initializeSQLite(): Promise<void> {
  try {
    // Import better-sqlite3 dynamically
    const Database = (await import('better-sqlite3')).default;
    this.db = new Database(this.config.database);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 1000');
    this.db.pragma('temp_store = memory');
  } catch (error) {
    throw new DatabaseError('Failed to initialize SQLite', { error });
  }
}
```

---

### 1.3 Database Manager

**File**: `/home/user/claude-flow/src/core/DatabaseManager.ts`
- **Line**: 197
- **Usage**: CommonJS require with error recovery
- **Method**: `SQLiteProvider` constructor
- **Migration**: Add SqlJsProvider as alternative
- **Impact**: High - Core persistence layer

```typescript
// Line 189-207
class SQLiteProvider implements IDatabaseProvider {
  private db: any;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    // Dynamic import to handle optional dependency
    try {
      const Database = require('better-sqlite3'); // Line 197
      this.db = new Database(dbPath);
    } catch (error) {
      // Check for native module version mismatch (NODE_MODULE_VERSION error)
      if (isNativeModuleVersionError(error)) {
        const recoveryMsg = getNativeModuleRecoveryMessage(error);
        throw new NativeModuleError(recoveryMsg, error as Error);
      }
      throw new Error('better-sqlite3 not available. Install with: npm install better-sqlite3');
    }
  }
}
```

---

### 1.4 Persistence Manager

**File**: `/home/user/claude-flow/src/core/persistence.ts`
- **Line**: 5
- **Usage**: ES module import (direct)
- **Type**: TypeScript with full type safety
- **Migration**: Replace with provider abstraction
- **Impact**: High - Manages agent/task persistence

```typescript
// Line 1-8
/**
 * Persistence layer for Claude-Flow using SQLite
 */

import Database from 'better-sqlite3'; // Line 5
import { join } from 'path';
import { mkdir } from 'fs/promises';
```

**Methods using better-sqlite3**:
- `initialize()` - Line 44-53
- `createTables()` - Line 55-100
- `saveAgent()` - Line 103-120
- `getAgent()` - Line 122-139
- All CRUD operations for agents/tasks

---

## 2. Memory Backends

### 2.1 SQLite Backend

**File**: `/home/user/claude-flow/src/memory/backends/sqlite.ts`
- **Line**: N/A (uses wrapper)
- **Usage**: Indirect via `sqlite-wrapper.js`
- **Migration**: Template for sql.js backend
- **Impact**: Medium - Memory storage layer

```typescript
// Line 32-38: Dynamic import from wrapper
if (!this.sqliteLoaded) {
  const module = await import('../sqlite-wrapper.js');
  createDatabase = module.createDatabase;
  isSQLiteAvailable = module.isSQLiteAvailable;
  this.sqliteLoaded = true;
}
```

---

### 2.2 SQLite Store

**File**: `/home/user/claude-flow/src/memory/sqlite-store.js`
- **Line**: 10
- **Usage**: Import from wrapper
- **Type**: JavaScript (MCP server)
- **Migration**: Indirect - uses wrapper
- **Impact**: Medium - MCP memory persistence

```javascript
// Line 1-12
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import { createDatabase } from './sqlite-wrapper.js'; // Line 10
import { getSwarmDir } from '../utils/project-root.js';
import { sessionSerializer } from './enhanced-session-serializer.js';
```

---

## 3. CLI Commands

### 3.1 Hive Mind Main

**File**: `/home/user/claude-flow/src/cli/simple-commands/hive-mind.js`
- **Lines**: 38, 46
- **Usage**: Dual loading (require + dynamic import)
- **Migration**: Use abstraction layer
- **Impact**: Low - CLI utility

```javascript
// Line 36-49
try {
  Database = require('better-sqlite3'); // Line 38
  DatabaseAvailable = true;
} catch (error) {
  console.warn('⚠️  better-sqlite3 not available, falling back to in-memory storage');
  try {
    // Try ES module import
    const sqlite = await import('better-sqlite3'); // Line 46
    Database = sqlite.default;
    DatabaseAvailable = true;
  } catch (importError) {
    // Fallback handled
  }
}
```

---

### 3.2 Hive Mind Wizard

**File**: `/home/user/claude-flow/src/cli/simple-commands/hive-mind-wizard.js`
- **Line**: 4
- **Usage**: Direct require
- **Migration**: Add try-catch with sql.js fallback
- **Impact**: Low - Setup wizard

```javascript
// Line 1-10
const fs = require('fs-extra');
const path = require('path');
const Database = require('better-sqlite3'); // Line 4
const ora = require('ora');
```

---

### 3.3 Hive Mind Memory

**File**: `/home/user/claude-flow/src/cli/simple-commands/hive-mind/memory.js`
- **Line**: 7
- **Usage**: ES module import
- **Migration**: Use abstraction layer
- **Impact**: Low - Memory CLI utilities

```javascript
// Line 1-10
/**
 * Hive Mind Memory Management CLI
 */
import fs from 'fs-extra';
import path from 'path';
import Database from 'better-sqlite3'; // Line 7
```

---

### 3.4 Metrics Reader

**File**: `/home/user/claude-flow/src/cli/simple-commands/hive-mind/metrics-reader.js`
- **Line**: 6
- **Usage**: ES module import
- **Migration**: Use abstraction layer
- **Impact**: Low - Metrics utilities

```javascript
// Line 1-10
/**
 * Hive Mind Metrics Reader
 */
import fs from 'fs-extra';
import path from 'path';
import Database from 'better-sqlite3'; // Line 6
```

---

### 3.5 Database Optimizer

**File**: `/home/user/claude-flow/src/cli/simple-commands/hive-mind/db-optimizer.js`
- **Line**: 8
- **Usage**: ES module import
- **Migration**: Use abstraction layer
- **Impact**: Low - Maintenance utilities

```javascript
// Line 1-12
/**
 * Hive Mind Database Optimizer
 */
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3'; // Line 8
```

---

### 3.6 MCP Wrapper

**File**: `/home/user/claude-flow/src/cli/simple-commands/hive-mind/mcp-wrapper.js`
- **Line**: 132
- **Usage**: Type annotation only (JSDoc)
- **Migration**: Update type annotation
- **Impact**: None - Type hint only

```javascript
// Line 132
/** @type {import('better-sqlite3').Database | null} */
this.db = null;
```

---

### 3.7 Hive Mind Init

**File**: `/home/user/claude-flow/src/cli/simple-commands/init/hive-mind-init.js`
- **Lines**: 304, 307
- **Usage**: Dynamic import with error handling
- **Migration**: Add sql.js as fallback
- **Impact**: Medium - Initialization logic

```javascript
// Line 304-315
// Dynamic import for better-sqlite3 with proper error handling
let Database;
try {
  Database = (await import('better-sqlite3')).default; // Line 307
  console.log('✅ Using SQLite for persistent storage');
} catch (error) {
  console.warn('⚠️  SQLite not available, using in-memory storage');
  console.warn('   Install better-sqlite3 for persistence: npm install better-sqlite3');
  useInMemory = true;
}
```

---

### 3.8 Swarm Metrics Integration

**File**: `/home/user/claude-flow/src/cli/simple-commands/swarm-metrics-integration.js`
- **Line**: 8
- **Usage**: ES module import
- **Migration**: Use abstraction layer
- **Impact**: Low - Metrics integration

```javascript
// Line 1-12
/**
 * Swarm Metrics Integration Service
 */
import fs from 'fs-extra';
import path from 'path';
import Database from 'better-sqlite3'; // Line 8
```

---

## 4. Utilities

### 4.1 Error Recovery

**File**: `/home/user/claude-flow/src/utils/error-recovery.ts`
- **Lines**: N/A (reference only)
- **Usage**: Detects better-sqlite3 errors
- **Functions**:
  - `isNpmCacheError()` - Line 28-34
  - `isNativeModuleVersionError()` - Line 40-46
  - `getNativeModuleRecoveryMessage()` - Line 52-80
  - `verifyBetterSqlite3()` - Line 267-274
- **Migration**: Add sql.js error detection
- **Impact**: High - Error handling infrastructure

```typescript
// Line 28-34
export function isNpmCacheError(error: any): boolean {
  const errorStr = error?.message || String(error);
  return (
    errorStr.includes('ENOTEMPTY') &&
    (errorStr.includes('npm') || errorStr.includes('npx') || errorStr.includes('_npx'))
  ) || errorStr.includes('better-sqlite3'); // Line 33
}
```

---

## 5. Patches & Workarounds

### 5.1 Agentic-Flow SQLite Fix

**File**: `/home/user/claude-flow/scripts/fix-agentic-flow-sqlite.sh`
- **Line**: 6, 16, 25-26
- **Usage**: Patches external dependency
- **Purpose**: Fixes broken better-sqlite3 import in agentic-flow
- **Migration**: Keep patch, add documentation
- **Impact**: Low - External dependency fix

```bash
# Line 6
QUERIES_FILE="node_modules/agentic-flow/dist/reasoningbank/db/queries.js"

# Line 16
if grep -q "import Database from 'better-sqlite3'" "$QUERIES_FILE"; then

# Line 25-26
sed -i '5s/const BetterSqlite3 = null; \/\/ Not used/import Database from '\''better-sqlite3'\'';/' "$QUERIES_FILE"
sed -i 's/new BetterSqlite3(/new Database(/g' "$QUERIES_FILE"
```

---

### 5.2 Hive Mind Timezone Fix Patch

**File**: `/home/user/claude-flow/src/patches/hive-mind-timezone-fix.patch`
- **Line**: 77
- **Usage**: Patch file showing better-sqlite3 import
- **Migration**: Update patch if needed
- **Impact**: None - Documentation only

```diff
# Line 77
+ import Database from 'better-sqlite3';
```

---

## 6. External Dependencies

### 6.1 agentic-flow

**Package**: `agentic-flow@^1.9.4`
- **Status**: Optional dependency
- **Uses**: better-sqlite3 for ReasoningBank database
- **File**: `dist/reasoningbank/db/queries.js`
- **Workaround**: Postinstall patch script
- **Migration**:
  - Keep as-is (optional dependency)
  - Document feature unavailability without better-sqlite3
  - Future: Consider contributing sql.js support upstream

**Impact**: Medium - Disables ReasoningBank features on Windows

---

### 6.2 agentdb

**Package**: `agentdb@^1.6.1`
- **Status**: Optional dependency
- **Uses**: better-sqlite3 for vector database
- **Patch**: `patches/agentdb-fix-imports.patch`
- **Migration**:
  - Keep as-is (optional dependency)
  - Unlikely to support sql.js (performance requirements)
  - Document vector search unavailability without better-sqlite3

**Impact**: Medium - Disables vector search on Windows

---

## 7. Install Scripts

### 7.1 ARM64 Installation Helper

**File**: `/home/user/claude-flow/scripts/install-arm64.js`
- **Lines**: 9, 11
- **Usage**: Test and rebuild better-sqlite3 on macOS ARM64
- **Migration**: Add sql.js check as fallback
- **Impact**: Low - Platform-specific helper

```javascript
// Line 7-16
async function checkSqliteBindings() {
  try {
    const Database = await import('better-sqlite3'); // Line 9
    const db = new Database.default(':memory:'); // Line 11
    db.close();
    return true;
  } catch (error) {
    // Silently fail - this is expected when better-sqlite3 doesn't compile
    return false;
  }
}
```

---

## Migration Priority Matrix

### Critical Priority (Week 1)
1. **sqlite-wrapper.js** - Core abstraction, affects all database operations
2. **DatabaseManager.ts** - Provider selection logic
3. **backends/sqlite.ts** - Template for sql.js backend

### High Priority (Week 2)
4. **persistence.ts** - Agent/task persistence
5. **database-service.ts** - API layer
6. **error-recovery.ts** - Error handling infrastructure

### Medium Priority (Week 3)
7. **hive-mind-init.js** - Initialization logic
8. **sqlite-store.js** - MCP memory persistence
9. All CLI commands (9 files) - Utilities

### Low Priority (Week 4)
10. **Patches** - Update documentation only
11. **install-arm64.js** - Platform helper
12. **External dependencies** - Document limitations

---

## Testing Requirements

### Per-File Testing
Each modified file should have:
- [ ] Unit tests with sql.js provider
- [ ] Unit tests with better-sqlite3 provider
- [ ] Unit tests with JSON fallback
- [ ] Integration tests for provider switching
- [ ] Error handling tests

### Platform Testing
- [ ] Windows 10/11 (sql.js primary)
- [ ] macOS Intel (better-sqlite3 primary)
- [ ] macOS ARM64 (better-sqlite3 with rebuild)
- [ ] Linux Ubuntu (better-sqlite3 primary)
- [ ] Alpine Linux (sql.js fallback)
- [ ] WSL (mixed environment)

---

## Estimated Migration Effort

| File | Lines to Change | Complexity | Hours |
|------|----------------|------------|-------|
| sqlite-wrapper.js | ~100 | High | 8 |
| DatabaseManager.ts | ~50 | Medium | 4 |
| backends/sqljs.ts (new) | ~350 | High | 12 |
| persistence.ts | ~20 | Low | 2 |
| database-service.ts | ~10 | Low | 1 |
| error-recovery.ts | ~30 | Medium | 3 |
| CLI files (9) | ~5 each | Low | 5 |
| Tests (new) | ~500 | High | 16 |
| Documentation | N/A | Medium | 8 |
| **Total** | **~1065** | **-** | **59 hours** |

**Estimated timeline**: ~8 working days (1 developer)

---

## Code Patterns to Replace

### Pattern 1: Direct Import
```javascript
// Before
import Database from 'better-sqlite3';
const db = new Database('path/to/db.sqlite');

// After
import { createDatabase } from './sqlite-wrapper.js';
const db = await createDatabase('path/to/db.sqlite');
```

### Pattern 2: Dynamic Import
```javascript
// Before
const Database = (await import('better-sqlite3')).default;

// After
const { createDatabase } = await import('./sqlite-wrapper.js');
const db = await createDatabase(dbPath);
```

### Pattern 3: Require
```javascript
// Before
const Database = require('better-sqlite3');

// After
const { createDatabase } = require('./sqlite-wrapper.js');
// (or migrate to ESM)
```

---

## Validation Checklist

### Pre-Migration
- [ ] All 17 files catalogued
- [ ] Dependencies mapped
- [ ] Test coverage baseline established
- [ ] Performance benchmarks collected

### During Migration
- [ ] sqlite-wrapper.js supports sql.js
- [ ] Provider selection logic implemented
- [ ] All files migrated to use abstraction
- [ ] Tests passing on all platforms

### Post-Migration
- [ ] Windows installation success rate >95%
- [ ] Performance within 2-5x of better-sqlite3
- [ ] No regressions on Linux/macOS
- [ ] Documentation updated

---

**Document Version**: 1.0
**Last Updated**: 2026-01-03
**Status**: Complete inventory for migration planning
