# WSL better-sqlite3 Error - Troubleshooting Guide

## ⚡ Automatic Error Recovery (v2.7.35+)

**Good news!** Starting with v2.7.35, claude-flow includes **automatic error recovery** that handles this issue without manual intervention.

### What Happens Automatically:
1. ✅ Detects ENOTEMPTY and better-sqlite3 errors
2. ✅ Cleans npm/npx cache automatically
3. ✅ Applies WSL-specific fixes
4. ✅ Retries initialization (up to 5 times with `--force`)
5. ✅ Falls back to JSON storage if SQLite fails

### Just Run:
```bash
npx claude-flow@alpha init --force
```

The `--force` flag enables **automatic error recovery** and will:
- Detect and clean npm cache errors
- Apply WSL environment optimizations
- Retry up to 5 times with exponential backoff
- Automatically switch to JSON storage if needed

---

## Error Description
```
[Error: ENOTEMPTY: directory not empty, rmdir '/home/username/.npm/_npx/xxxxx/node_modules/better-sqlite3']
errno: -39
```

When running: `npx claude-flow@alpha init --force` on Windows Subsystem for Linux (WSL)

**Note:** If you're using v2.7.35+, automatic recovery handles this. Manual fixes below are only needed for older versions or edge cases.

## Root Causes

1. **File locking conflicts** between Windows and WSL filesystems
2. **NPX cache corruption** due to interrupted installations
3. **Permission issues** with npm cache directories
4. **Native module compilation** issues specific to WSL

## Solutions (Try in order)

### Solution 1: Clear NPM/NPX Cache
```bash
# Clear npm cache
npm cache clean --force

# Remove npx cache directory
rm -rf ~/.npm/_npx

# Retry installation
npx claude-flow@alpha init --force
```

### Solution 2: Use npm instead of npx
```bash
# Install globally first
npm install -g claude-flow@alpha

# Then run init
claude-flow init --force
```

### Solution 3: Manual Directory Cleanup
```bash
# Find the problematic directory
ls -la ~/.npm/_npx/

# Force remove with elevated permissions if needed
sudo rm -rf ~/.npm/_npx/*/node_modules/better-sqlite3

# Clear entire npx cache
rm -rf ~/.npm/_npx

# Retry
npx claude-flow@alpha init --force
```

### Solution 4: Fix WSL File Permissions
```bash
# Ensure proper ownership
sudo chown -R $(whoami) ~/.npm

# Fix permissions
chmod -R 755 ~/.npm

# Clear and retry
npm cache clean --force
npx claude-flow@alpha init --force
```

### Solution 5: Rebuild better-sqlite3
```bash
# Install build tools if missing
sudo apt-get update
sudo apt-get install -y build-essential python3

# Clear cache and retry with rebuild flag
npm cache clean --force
rm -rf ~/.npm/_npx
npx claude-flow@alpha init --force
```

### Solution 6: Use WSL2 with Proper Node Version
```bash
# Check WSL version
wsl --list --verbose

# Ensure using WSL2 (not WSL1)
wsl --set-version Ubuntu 2

# Use Node 18+ (better-sqlite3 compatibility)
node --version

# Install/update node if needed via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Retry installation
npx claude-flow@alpha init --force
```

### Solution 7: Run from Linux Filesystem (Not Windows Mount)
```bash
# Bad: Running from /mnt/c/Users/... (Windows filesystem)
cd /mnt/c/Users/username/project  # ❌

# Good: Running from WSL filesystem
cd ~/projects/your-project  # ✅

# Copy project to WSL if needed
cp -r /mnt/c/Users/username/project ~/projects/

# Run from WSL filesystem
cd ~/projects/project
npx claude-flow@alpha init --force
```

## Prevention

### Best Practices for WSL Users

1. **Always work in WSL filesystem** (`~/` not `/mnt/c/`)
2. **Use Node 18+** for better native module support
3. **Keep npm updated**: `npm install -g npm@latest`
4. **Regular cache cleanup**: Add to `.bashrc`:
   ```bash
   alias npm-clean="npm cache clean --force && rm -rf ~/.npm/_npx"
   ```

## Quick Fix Script

Create a script to automate the fix:

```bash
#!/bin/bash
# wsl-fix-npx.sh

echo "🔧 Fixing WSL NPX cache issues..."

# Stop any running node processes
pkill -f node || true

# Clean npm cache
echo "📦 Cleaning npm cache..."
npm cache clean --force

# Remove npx cache
echo "🗑️  Removing npx cache..."
rm -rf ~/.npm/_npx

# Fix permissions
echo "🔐 Fixing permissions..."
sudo chown -R $(whoami) ~/.npm
chmod -R 755 ~/.npm

# Verify node/npm
echo "✅ Verifying Node.js..."
node --version
npm --version

echo "🎉 Cleanup complete! Try running your command again."
echo "Command: npx claude-flow@alpha init --force"
```

Usage:
```bash
chmod +x wsl-fix-npx.sh
./wsl-fix-npx.sh
npx claude-flow@alpha init --force
```

## Still Having Issues?

### Report the Issue
If none of the solutions work, gather this information:

```bash
# System info
cat /etc/os-release
node --version
npm --version
wsl --list --verbose  # Run from Windows PowerShell

# Error details
npx claude-flow@alpha init --force --verbose 2>&1 | tee error-log.txt
```

Then report at: https://github.com/ruvnet/claude-flow/issues

### Alternative: Use Docker
If WSL issues persist, consider using Docker:

```bash
# Pull claude-flow Docker image (if available)
docker pull ruvnet/claude-flow:latest

# Run in container
docker run -it -v $(pwd):/workspace ruvnet/claude-flow:latest init --force
```

## Technical Background

The `ENOTEMPTY` error occurs because:

1. **WSL filesystem translation layer** can cause delays in file operations
2. **better-sqlite3** is a native Node.js module requiring compilation
3. **NPX temporary directories** may not be fully cleaned before reuse
4. **Windows Defender** or antivirus may lock files during scanning

The error code `-39` (ENOTEMPTY) means the system tried to remove a directory that still contains files, typically due to:
- Race conditions in cleanup
- File handles still open
- Filesystem caching inconsistencies
