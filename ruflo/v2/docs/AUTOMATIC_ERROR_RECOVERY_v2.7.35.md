# Automatic Error Recovery Implementation - v2.7.35

## Summary

Implemented comprehensive automatic error recovery system for `claude-flow init` that handles the WSL better-sqlite3 ENOTEMPTY error **without manual intervention**.

## Changes Made

### 1. New Error Recovery Utility (`src/utils/error-recovery.ts`)

**Features:**
- ✅ Automatic ENOTEMPTY npm cache error detection
- ✅ WSL environment detection and optimization
- ✅ Automatic npm/npx cache cleanup
- ✅ Retry logic with exponential backoff (1s, 2s, 4s, 8s, 16s)
- ✅ Permission fixes for WSL environments
- ✅ better-sqlite3 verification and reinstallation

**Key Functions:**
```typescript
- isNpmCacheError(error): boolean
- isWSL(): boolean
- cleanNpmCache(): Promise<RecoveryResult>
- retryWithRecovery<T>(fn, options): Promise<T>
- recoverWSLErrors(): Promise<RecoveryResult>
- recoverInitErrors(error): Promise<RecoveryResult>
```

### 2. Enhanced DatabaseManager (`src/core/DatabaseManager.ts`)

**Improvements:**
- Added `initializeSQLiteWithRecovery()` method
- Automatic fallback from SQLite to JSON on errors
- Retry counter (max 3 attempts per provider)
- Enhanced error logging with recovery suggestions

**Flow:**
```
Try SQLite → Error? → Warn + Fallback to JSON
Initialize → Error? → Retry with JSON (3x max)
```

### 3. Updated Init Command (`src/cli/init/index.ts`)

**Enhanced with:**
- Wrapped entire initialization in `retryWithRecovery()`
- Proactive WSL detection and optimization
- Automatic cache cleanup on npm errors
- Extended retry count with `--force` flag (5 attempts vs 3)
- Comprehensive error recovery logging

**User Experience:**
```bash
npx claude-flow@alpha init --force

🔍 WSL environment detected
✅ WSL environment optimized

⚠️  Detected npm cache error (attempt 1/5)
🧹 Cleaning npm cache...
✅ Cache cleaned, retrying...

🔄 Retry attempt 1 after error recovery...
🎉 Project initialized successfully!
```

### 4. Test Coverage (`tests/unit/utils/error-recovery.test.ts`)

**Tests:**
- ✅ ENOTEMPTY error detection
- ✅ better-sqlite3 error detection
- ✅ WSL environment detection
- ✅ Retry logic with success
- ✅ Max retry handling
- ✅ onRetry callback execution
- ✅ Cache cleanup functionality
- ✅ Init error recovery

### 5. Documentation

**Created/Updated:**
- ✅ `docs/features/automatic-error-recovery.md` - Comprehensive guide
- ✅ `docs/troubleshooting/wsl-better-sqlite3-error.md` - Updated with auto-recovery info
- ✅ `docs/AUTOMATIC_ERROR_RECOVERY_v2.7.35.md` - This document

## How It Works

### Before (Manual Fix Required)

```bash
$ npx claude-flow@alpha init --force
[Error: ENOTEMPTY: directory not empty, rmdir '/home/user/.npm/_npx/xxx/node_modules/better-sqlite3']

# User had to manually:
$ npm cache clean --force
$ rm -rf ~/.npm/_npx
$ npx claude-flow@alpha init --force  # Try again
```

### After (Automatic Recovery)

```bash
$ npx claude-flow@alpha init --force

🔍 WSL environment detected
✅ WSL environment optimized

📁 Phase 1: Creating directory structure...
⚠️  Detected npm cache error (attempt 1/5)
🧹 Cleaning npm cache...
✅ npm cache cleaned
🗑️  Removing npx cache: /home/user/.npm/_npx
✅ npx cache removed
✅ Cache cleaned, retrying...

🔄 Retry attempt 1 after error recovery...
📁 Phase 1: Creating directory structure...
🎉 Project initialized successfully!

# No manual intervention needed!
```

## Recovery Strategies

### 1. npm Cache Errors

```typescript
if (isNpmCacheError(error)) {
  1. Run `npm cache clean --force`
  2. Remove `~/.npm/_npx` directory
  3. Fix permissions (WSL: `chmod -R 755 ~/.npm`)
  4. Retry with exponential backoff
}
```

### 2. WSL Environment

```typescript
if (isWSL()) {
  1. Detect running from `/mnt/c/` (Windows mount) → Warn user
  2. Check for build tools (gcc, python3) → Suggest install
  3. Apply permission fixes
  4. Clean cache with WSL-specific handling
}
```

### 3. Database Initialization

```typescript
if (sqliteInitFails) {
  1. Try SQLite with recovery
  2. On error → Warn user
  3. Fallback to JSON provider
  4. Retry initialization (3x max)
  5. Success → Continue with JSON storage
}
```

### 4. better-sqlite3 Issues

```typescript
if (!better-sqlite3Available) {
  1. Attempt reinstall with retry
  2. Clean cache before each retry
  3. Verify installation after each attempt
  4. Max 3 retries with exponential backoff
  5. Fallback to JSON if all fail
}
```

## Configuration

### Retry Options

```typescript
interface RetryOptions {
  maxRetries?: number;      // 3 (normal) or 5 (--force)
  delay?: number;           // 1000ms initial delay
  onRetry?: (attempt, error) => void;
  cleanupFn?: () => Promise<void>;
}
```

### Recovery Result

```typescript
interface RecoveryResult {
  success: boolean;     // Recovery succeeded?
  action: string;       // Action taken
  message: string;      // User-friendly message
  recovered: boolean;   // Was recovery needed?
}
```

## Testing Checklist

- [ ] Test on Ubuntu WSL2
- [ ] Test on Debian WSL2
- [ ] Test with ENOTEMPTY error simulation
- [ ] Test with missing better-sqlite3
- [ ] Test from `/mnt/c/` (Windows filesystem)
- [ ] Test from `~/` (WSL filesystem)
- [ ] Test with `--force` flag
- [ ] Test without `--force` flag
- [ ] Test cache cleanup functionality
- [ ] Test SQLite → JSON fallback
- [ ] Test max retry exhaustion
- [ ] Test successful recovery after 1 retry
- [ ] Test successful recovery after multiple retries

## Docker Testing

### Dockerfile for Testing

```dockerfile
FROM ubuntu:22.04

# Install Node.js and build tools
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    python3 \
    git

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Create test user
RUN useradd -m -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

# Test command
CMD npx claude-flow@alpha init --force
```

### Test Commands

```bash
# Build test image
docker build -t claude-flow-test -f Dockerfile.test .

# Run test
docker run -it claude-flow-test

# Test with volume mount
docker run -it -v $(pwd):/workspace -w /workspace claude-flow-test

# Simulate WSL environment
docker run -it -e SIMULATE_WSL=1 claude-flow-test
```

## Rollout Plan

### Phase 1: Internal Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Docker tests pass
- [ ] WSL manual testing

### Phase 2: Beta Release
- [ ] Release as v2.7.35-beta.1
- [ ] Gather feedback from WSL users
- [ ] Monitor error rates
- [ ] Collect recovery metrics

### Phase 3: Production Release
- [ ] Release as v2.7.35
- [ ] Update documentation
- [ ] Announce on GitHub
- [ ] Close related issues

## Metrics to Track

```typescript
// Recovery success rate
const recoveryMetrics = {
  totalErrors: 0,
  recoveredErrors: 0,
  successRate: 0,
  avgRetries: 0,
  cacheCleanups: 0,
  wslOptimizations: 0,
  sqliteToJsonFallbacks: 0
};
```

## Known Limitations

1. **Cannot fix all errors**: Some errors (disk full, permissions) may not be recoverable
2. **Requires network**: npm cache operations need internet access
3. **WSL1 limitations**: WSL1 has more filesystem issues than WSL2
4. **Build tools**: better-sqlite3 requires gcc/python3 (auto-detects and warns)

## Future Enhancements

1. **Telemetry**: Track recovery success rates
2. **Smart caching**: Detect when cache cleanup is needed proactively
3. **Pre-flight checks**: Verify environment before initialization
4. **Better diagnostics**: Detailed error reports for unrecoverable issues
5. **Parallel recovery**: Try multiple recovery strategies simultaneously

## Related Issues

Closes:
- Issue #XXX: WSL better-sqlite3 ENOTEMPTY error
- Issue #XXX: npm cache corruption during init
- Issue #XXX: Improve error handling for initialization

## References

- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [npm cache Documentation](https://docs.npmjs.com/cli/v9/commands/npm-cache)
- [WSL Issues Tracker](https://github.com/microsoft/WSL/issues)
- [Node.js Error Codes](https://nodejs.org/api/errors.html)

---

**Status**: ✅ Implementation Complete - Ready for Testing
**Next**: Docker validation and beta release
