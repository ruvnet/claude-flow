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

Claude-flow v2.0.0-alpha.17+ includes automatic NPX cache isolation that prevents these conflicts by giving each process its own isolated cache directory.

### How It Works

The solution uses per-process cache isolation:

1. **Unique Cache Directories**: Each process gets its own NPX cache at `/tmp/.npm-cache/claude-flow-[pid]-[timestamp]-[random]`
2. **Automatic Cleanup**: Cache directories are automatically removed when the process exits
3. **No Performance Impact**: True parallel execution is maintained - no serialization needed
4. **Cross-platform**: Works on Linux, macOS, and Windows

### Implementation

The fix is simple and efficient:
- Each NPX command runs with `NPM_CONFIG_CACHE` set to a unique directory
- No locks or synchronization needed
- Cache directories are cleaned up automatically on process exit

## Verification

To verify the fix is working, run the included test suites:

```bash
# Comprehensive test suite
node test/npx-cache-fix-test.js

# Integration test with real NPX commands
node test/npx-isolation-integration-test.js
```

Both tests should pass with no ENOTEMPTY errors.

## Alternative Workarounds

If you're using an older version without this fix, you can manually implement the same approach:

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
- `/src/utils/npx-isolated-cache.js` - Core isolation utility
- `/src/cli/simple-commands/init/index.js` - Uses `getIsolatedNpxEnv()` for NPX commands
- `/src/cli/simple-commands/init/batch-init.js` - Batch operations automatically get isolation

All NPX executions now use isolated cache directories, completely eliminating cache conflicts without sacrificing performance.