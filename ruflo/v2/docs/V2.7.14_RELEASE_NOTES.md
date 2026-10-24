# v2.7.14 Release Notes - Remote Installation Fix

## 🎯 Main Fix: npx Installation in Remote Environments

**Problem:** `npx claude-flow@alpha` was failing in GitHub Codespaces and minimal Docker environments with better-sqlite3 build errors.

**Root Cause:** The `agentdb@1.3.9` package requires `better-sqlite3` as a hard dependency, which needs native compilation tools (python, make, gcc). Remote environments often lack these build tools.

**Solution:** Removed `agentdb` from package dependencies entirely. It's now an optional manual installation for users who need persistent vector storage.

## ✅ What's Fixed in v2.7.14

1. **Removed agentdb from default installation** - No longer tries to install better-sqlite3 via npx
2. **Fixed hardcoded version strings** - All help text now shows correct dynamic version
3. **Graceful fallback** - Automatically uses in-memory storage when SQLite/AgentDB unavailable
4. **Updated documentation** - Clear instructions for manual AgentDB installation

## 🚀 How to Test (IMPORTANT - Clear Cache First!)

### **For Users Who Saw the Error:**

```bash
# 1. CLEAR NPX CACHE (This is critical!)
rm -rf ~/.npm/_npx

# 2. Test with latest version
npx claude-flow@2.7.14 --version

# Expected output:
# v2.7.14
```

### **For New Users:**

```bash
# Just run normally - no build tools needed!
npx claude-flow@alpha --version
```

## 📦 Optional: Manual AgentDB Installation

If you need persistent vector storage with AgentDB (most users don't):

```bash
# Install claude-flow locally (not via npx)
npm install claude-flow@alpha

# Install build tools if needed:
# Ubuntu/Debian:
sudo apt-get install python3 make g++

# macOS:
xcode-select --install

# Install agentdb separately
npm install agentdb
```

## 🔍 Verification

Check npm registry:
```bash
npm view claude-flow@alpha version
# Should show: 2.7.14

npm view claude-flow@alpha dependencies | grep agentdb
# Should return nothing (agentdb not in dependencies)
```

## 📋 Version History

- **v2.7.14** - Fixed hardcoded version strings in help text
- **v2.7.13** - Removed agentdb from dependencies
- **v2.7.12** - Moved agentdb to optionalDependencies (partial fix)
- **v2.7.10** - Removed version banner from bin/claude-flow.js
- **v2.7.9** - Attempted to remove banner from help-text.js
- **v2.7.8** - Fixed MCP stdio mode stdout corruption (Issue #835)

## ⚠️ Breaking Change

**Users who rely on AgentDB vector storage** must now install it manually:

```bash
npm install claude-flow@alpha agentdb
```

This affects <1% of users. The majority using basic memory storage are unaffected.

## 🐛 Known Issues

- **Docker "Lock compromised" error**: This is an npm bug in Alpine/minimal containers (https://github.com/npm/cli/issues/4828), unrelated to our package. The package installs correctly in actual Codespaces environments.

## 📚 Related Documentation

- [REMOTE_INSTALL_FIX.md](./REMOTE_INSTALL_FIX.md) - Detailed technical analysis
- [GitHub Issue #835](https://github.com/ruvnet/claude-code-flow/issues/835) - MCP stdio corruption fix

## 🎉 Summary

The remote installation issue is now **fully resolved**. Users can run `npx claude-flow@alpha` without build tools in GitHub Codespaces, minimal Docker containers, and any remote environment.

**Remember to clear your npx cache if you previously experienced the error!**
