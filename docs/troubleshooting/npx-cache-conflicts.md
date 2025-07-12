# NPX Cache Conflicts - Troubleshooting Guide

## Problem

When running multiple `claude-flow` instances concurrently, you may encounter the following error:

```
npm error code ENOTEMPTY
npm error syscall rename
npm error path /private/tmp/.npm/_npx/[hash]/node_modules/[package]
npm error dest /private/tmp/.npm/_npx/[hash]/node_modules/.[package]-[random]
npm error errno -66
npm error ENOTEMPTY: directory not empty, rename '[source]' -> '[dest]'
```

This error occurs when multiple NPX processes attempt to access and modify the same cache directory simultaneously.

## Root Cause

NPX uses a shared cache directory (`/tmp/.npm/_npx/` or similar) to store downloaded packages. When multiple `claude-flow` processes run concurrently (e.g., in swarm mode or parallel batch operations), they compete for the same cache resources, causing directory rename conflicts.

## Solution

Claude-flow v2.0.0-alpha.17+ includes an automatic NPX cache lock manager that prevents these conflicts by:

1. **Serializing NPX operations**: Only one NPX command can run at a time
2. **Automatic retry logic**: If a lock is held, the system retries with exponential backoff
3. **Lock timeout protection**: Stale locks are automatically cleaned up after 30 seconds
4. **Process cleanup**: Locks are released on process exit, even on errors

## How It Works

The NPX cache manager creates a lock file at `~/.claude-flow/locks/npx.lock` that ensures exclusive access to NPX operations. This lock is:

- **Process-specific**: Each process gets a unique lock ID
- **Time-bounded**: Locks expire after 30 seconds to prevent deadlocks
- **Self-cleaning**: Locks are removed on normal exit, signals, or crashes

## Manual Lock Management

If you need to manually manage locks (e.g., for debugging), use the included CLI utility:

```bash
# Check lock status
node src/utils/npx-lock-cli.js status

# Force release a stuck lock
node src/utils/npx-lock-cli.js release

# Acquire a lock for testing
node src/utils/npx-lock-cli.js acquire
```

## Configuration

The lock manager uses these defaults:

- **Lock timeout**: 30 seconds
- **Retry interval**: 100ms
- **Max retries**: 300 (30 seconds total)
- **Lock directory**: `~/.claude-flow/locks/`

These values are optimized for typical usage and should not need adjustment.

## Verification

To verify the fix is working, you can run the included test script:

```bash
node test-concurrent-fix.js
```

This will launch multiple concurrent `claude-flow init` commands and verify they complete without ENOTEMPTY errors.

## Alternative Workarounds

If you're using an older version without this fix, you can:

1. **Use isolated cache directories**:
   ```bash
   NPM_CONFIG_CACHE=/tmp/claude-flow-cache-$$ npx --y claude-flow@alpha init --force
   ```

2. **Install globally to avoid NPX**:
   ```bash
   npm install -g claude-flow@alpha
   claude-flow init --force
   ```

3. **Run operations sequentially**:
   ```bash
   # In batch operations, disable parallelism
   claude-flow batch init --parallel=false
   ```

## Implementation Details

The fix is implemented in:
- `/src/utils/npx-cache-manager.js` - Core lock manager
- `/src/cli/simple-commands/init/index.js` - NPX operations wrapped with lock
- `/src/cli/simple-commands/init/batch-init.js` - Batch operations use lock

All NPX executions are now wrapped in `npxCacheManager.withLock()` to ensure exclusive access.