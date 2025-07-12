# 🔧 Claude Flow v2.0.0 Troubleshooting Guide

## 🚨 Current Known Issues

### ⚠️ Critical: Local Build Issues (KNOWN)

**Status**: 269+ TypeScript compilation errors preventing local builds

**Symptoms**:
```bash
npm run build
# Error: Cannot find module '../utils/error-handler.js'
# Error: 'TypedEventEmitter' is not defined
# Error: Property 'data' does not exist on type 'MemoryEntry'
```

**Root Cause**: Import/export resolution issues in hybrid Deno/Node.js codebase

**✅ IMMEDIATE SOLUTION**: Use NPX version (fully functional)
```bash
# Instead of local build, use NPX
npx claude-flow@2.0.0 <command>
```

**Development Status**: Active fixes in progress (80% import issues resolved)

---

### ⚠️ Test Suite Failures

**Symptoms**:
```bash
npm test
# Error: Could not locate module ../utils/error-handler.js mapped as: $1
# ReferenceError: You are trying to `import` a file after the Jest environment has been torn down
```

**Root Cause**: Jest module resolution conflicts with ES modules

**✅ SOLUTION**: NPX version has been thoroughly tested
```bash
# Use NPX for reliable functionality
npx claude-flow@2.0.0 status
npx claude-flow@2.0.0 swarm "test objective"
```

---

### ✅ FIXED: NPX Cache Conflicts (v2.0.0-alpha.17+)

**Previous Issue**: ENOTEMPTY errors when running multiple claude-flow instances concurrently

**Symptoms (FIXED)**:
```bash
npm error code ENOTEMPTY
npm error syscall rename
npm error ENOTEMPTY: directory not empty, rename '/private/tmp/.npm/_npx/[hash]/node_modules/[package]' -> '[dest]'
```

**✅ SOLUTION**: Automatic per-process cache isolation
- Each process gets its own NPX cache directory
- True parallel execution maintained (no serialization)
- Automatic cleanup on process exit
- Zero performance overhead

**Verification**:
```bash
# Test concurrent operations (should work flawlessly)
node test/npx-cache-fix-test.js
node test/npx-isolation-integration-test.js
```

**📖 Detailed Guide**: [NPX Cache Conflicts](./troubleshooting/npx-cache-conflicts.md)

---

### ✅ FIXED: Swarm LoadBalancer Error

**Previous Issue**: `LoadBalancer is not defined` error in swarm operations

**Status**: **RESOLVED** in latest swarm-new.js implementation

**Solution**: Use latest NPX version
```bash
npx claude-flow@2.0.0 swarm "your objective"
```

---

## 🔍 Diagnostic Commands

### Quick Health Check

```bash
# Verify NPX availability and version
npx claude-flow@2.0.0 --version

# System status check
npx claude-flow@2.0.0 status

# Test basic functionality
npx claude-flow@2.0.0 --help

# Validate swarm functionality
npx claude-flow@2.0.0 swarm "test basic functionality" --max-agents 2 --timeout 1
```

### Expected Healthy Output

```bash
$ npx claude-flow@2.0.0 status
✅ Claude-Flow System Status:
🟡 Not Running (orchestrator not started)
🤖 Agents: 0 active
📋 Tasks: 0 in queue
💾 Memory: Ready (1 entries)
🖥️  Terminal Pool: Ready
🌐 MCP Server: Stopped

💡 Quick Actions:
   Run "claude-flow start" to begin orchestration
   Run "claude-flow agent spawn researcher" to create an agent
```

---

## 🛠️ Installation Issues

### NPX Installation Problems

**Issue**: NPX command not found or fails
```bash
npx: command not found
```

**Solutions**:
```bash
# Update Node.js to version 20+
node --version  # Should be 20.0.0 or higher

# Update NPM to latest
npm install -g npm@latest

# Clear NPX cache
npx clear-npx-cache

# Alternative: Install globally first
npm install -g claude-flow@2.0.0
claude-flow --version
```

### Permission Issues

**Issue**: Permission denied errors
```bash
Error: EACCES: permission denied
```

**Solutions**:
```bash
# Use NPX (recommended - no global installation)
npx claude-flow@2.0.0 <command>

# Or fix npm permissions (if using global install)
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules
```

### Network/Proxy Issues

**Issue**: NPX fails to download package
```bash
npm ERR! network request failed
```

**Solutions**:
```bash
# Check npm registry
npm config get registry

# Use specific registry
npm config set registry https://registry.npmjs.org/

# Behind corporate proxy
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080

# Alternative: Download and run locally
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow
npm install
# Note: Local build currently has issues, use NPX instead
```

---

## 🐝 Swarm Operation Issues

### Swarm Initialization Failures

**Issue**: Swarm fails to initialize
```bash
❌ Failed to execute swarm: <error>
```

**Diagnostic Steps**:
```bash
# 1. Check basic functionality
npx claude-flow@2.0.0 status

# 2. Try minimal swarm
npx claude-flow@2.0.0 swarm "test" --max-agents 1 --timeout 1

# 3. Check verbose output
npx claude-flow@2.0.0 swarm "test" --verbose

# 4. Try different strategy
npx claude-flow@2.0.0 swarm "test" --strategy research
```

**Common Solutions**:
```bash
# Use simpler configuration
npx claude-flow@2.0.0 swarm "simple objective" --max-agents 2

# Increase timeout for complex tasks
npx claude-flow@2.0.0 swarm "complex task" --timeout 30

# Use centralized mode for reliability
npx claude-flow@2.0.0 swarm "task" --mode centralized
```

### Agent Spawning Issues

**Issue**: Agents fail to spawn or become unresponsive

**Diagnostic**:
```bash
# Check agent list
npx claude-flow@2.0.0 agent list

# Try spawning single agent
npx claude-flow@2.0.0 agent spawn researcher "Test Agent"

# Check memory usage
npx claude-flow@2.0.0 memory search "agent"
```

**Solutions**:
```bash
# Reduce concurrent agents
npx claude-flow@2.0.0 swarm "task" --max-agents 3

# Use specific agent types
npx claude-flow@2.0.0 swarm "task" --strategy development

# Clear memory if needed
npx claude-flow@2.0.0 memory search "." --limit 100
```

### Task Timeout Issues

**Issue**: Tasks timeout or hang indefinitely

**Solutions**:
```bash
# Increase task timeout
npx claude-flow@2.0.0 swarm "task" --timeout 60

# Use background mode
npx claude-flow@2.0.0 swarm "long task" --background

# Monitor progress
npx claude-flow@2.0.0 swarm "task" --monitor

# Break into smaller tasks
npx claude-flow@2.0.0 swarm "phase 1: setup" --max-agents 2
npx claude-flow@2.0.0 swarm "phase 2: implementation" --max-agents 3
```

---

## 🚀 SPARC Mode Issues

### Mode Not Found

**Issue**: SPARC mode not recognized
```bash
Unknown mode: <mode-name>
```

**Solutions**:
```bash
# List available modes
npx claude-flow@2.0.0 sparc modes

# Get mode information
npx claude-flow@2.0.0 sparc info <mode-name>

# Use auto-detection
npx claude-flow@2.0.0 sparc "describe your objective"
```

### Mode Execution Failures

**Issue**: SPARC mode starts but fails to complete

**Diagnostic**:
```bash
# Try with verbose output
npx claude-flow@2.0.0 sparc <mode> "objective" --verbose

# Use simpler objective
npx claude-flow@2.0.0 sparc code "create hello world function"

# Check system status
npx claude-flow@2.0.0 status
```

---

## 🤖 Agent Management Issues

### Agent Communication Failures

**Issue**: Agents don't communicate or coordinate properly

**Solutions**:
```bash
# Use centralized coordination
npx claude-flow@2.0.0 swarm "task" --mode centralized

# Reduce agent count
npx claude-flow@2.0.0 swarm "task" --max-agents 3

# Check memory system
npx claude-flow@2.0.0 memory search "coordination"

# Use verbose monitoring
npx claude-flow@2.0.0 swarm "task" --monitor --verbose
```

### Memory Issues

**Issue**: Shared memory corruption or inconsistency

**Diagnostic**:
```bash
# Check memory status
npx claude-flow@2.0.0 memory search "." --limit 10

# List memory partitions
npx claude-flow@2.0.0 memory list

# Test memory operations
npx claude-flow@2.0.0 memory store "test" "value"
npx claude-flow@2.0.0 memory get "test"
```

**Solutions**:
```bash
# Use memory namespaces
npx claude-flow@2.0.0 swarm "task" --memory-namespace clean

# Clear specific entries
npx claude-flow@2.0.0 memory delete "problematic-key"

# Restart with fresh memory
npx claude-flow@2.0.0 init --sparc --force
```

---

## 🐙 GitHub Integration Issues

### Authentication Problems

**Issue**: GitHub operations fail with auth errors

**Solutions**:
```bash
# Check GitHub CLI authentication
gh auth status

# Login to GitHub CLI
gh auth login

# Set environment variable
export GITHUB_TOKEN="your-token"

# Test GitHub access
gh repo view
```

### Repository Access Issues

**Issue**: Cannot access repository or create PRs

**Diagnostic**:
```bash
# Check repository permissions
gh repo view <owner>/<repo>

# Verify branch access
gh branch list

# Test basic operations
gh issue list --limit 5
```

---

## 📊 Performance Issues

### Slow Execution

**Issue**: Operations are significantly slower than expected

**Optimization**:
```bash
# Enable parallel execution
npx claude-flow@2.0.0 swarm "task" --parallel

# Reduce agent count
npx claude-flow@2.0.0 swarm "task" --max-agents 3

# Use appropriate strategy
npx claude-flow@2.0.0 swarm "task" --strategy development

# Monitor performance
npx claude-flow@2.0.0 swarm "task" --monitor

# Use background mode for long tasks
npx claude-flow@2.0.0 swarm "task" --background
```

### Memory Usage Issues

**Issue**: High memory consumption or out-of-memory errors

**Solutions**:
```bash
# Limit memory namespace
npx claude-flow@2.0.0 swarm "task" --memory-namespace limited

# Reduce concurrent agents
npx claude-flow@2.0.0 swarm "task" --max-agents 2

# Use simpler coordination
npx claude-flow@2.0.0 swarm "task" --mode centralized

# Monitor memory usage
npx claude-flow@2.0.0 monitor --metrics
```

---

## 🖥️ Environment Issues

### Node.js Version Problems

**Issue**: Compatibility issues with Node.js version

**Requirements**: Node.js 20.0.0 or higher

**Solutions**:
```bash
# Check current version
node --version

# Update Node.js (using nvm)
nvm install 20
nvm use 20

# Or download from nodejs.org
# https://nodejs.org/en/download/

# Verify NPM version
npm --version  # Should be 9.0.0+
```

### Environment Variables

**Issue**: Missing or incorrect environment variables

**Setup**:
```bash
# Claude API key (if using Claude integration)
export CLAUDE_API_KEY="your-api-key"

# GitHub token (for GitHub features)
export GITHUB_TOKEN="your-github-token"

# Optional: Custom configuration
export CLAUDE_FLOW_CONFIG="/path/to/config.json"

# Verify environment
echo $CLAUDE_API_KEY
echo $GITHUB_TOKEN
```

### Platform-Specific Issues

#### Windows Issues
```cmd
REM Use PowerShell or WSL for better compatibility
powershell

# Or use Windows Subsystem for Linux
wsl

# NPX command in Windows
npx.cmd claude-flow@2.0.0 --help
```

#### macOS Issues
```bash
# Update to latest Xcode command line tools
xcode-select --install

# Use Homebrew for Node.js
brew install node@20
brew link node@20
```

#### Linux Issues
```bash
# Update package manager
sudo apt update  # Ubuntu/Debian
sudo yum update   # CentOS/RHEL

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 🔒 Security Issues

### Permission Errors

**Issue**: Security or permission-related failures

**Solutions**:
```bash
# Use NPX (safer, no global installation)
npx claude-flow@2.0.0 <command>

# Check file permissions
ls -la claude-flow

# Fix permissions if needed
chmod +x claude-flow

# Run without elevated privileges
npx claude-flow@2.0.0 --help  # No sudo needed
```

### Network Security

**Issue**: Corporate firewall or security policies blocking NPX

**Solutions**:
```bash
# Configure corporate proxy
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080

# Use alternative registry
npm config set registry https://registry.npmjs.org/

# Download package manually
npm pack claude-flow@2.0.0
tar -xzf claude-flow-2.0.0.tgz
```

---

## 📋 Configuration Issues

### Initial Setup Problems

**Issue**: `init` command fails or creates incorrect structure

**Solutions**:
```bash
# Try basic init
npx claude-flow@2.0.0 init --minimal

# Force reinitialize
npx claude-flow@2.0.0 init --sparc --force

# Check directory permissions
ls -la .
mkdir .claude  # Manual creation if needed

# Verify after init
ls -la .claude/
cat .claude/settings.json
```

### Configuration File Issues

**Issue**: Invalid or corrupted configuration files

**Reset Solutions**:
```bash
# Backup existing config
cp .claude/settings.json .claude/settings.json.backup

# Reinitialize configuration
npx claude-flow@2.0.0 init --sparc --force

# Manual config check
cat .claude/settings.json | jq .  # Validate JSON

# Restore from backup if needed
cp .claude/settings.json.backup .claude/settings.json
```

---

## 🆘 Emergency Recovery

### Complete Reset

**When everything fails**:
```bash
# 1. Clear all local state
rm -rf .claude/
rm -rf swarm-runs/
rm -rf node_modules/

# 2. Clear NPX cache
npx clear-npx-cache

# 3. Verify environment
node --version  # Should be 20+
npm --version   # Should be 9+

# 4. Test basic NPX functionality
npx claude-flow@2.0.0 --version

# 5. Reinitialize project
npx claude-flow@2.0.0 init --sparc

# 6. Test basic operations
npx claude-flow@2.0.0 status
npx claude-flow@2.0.0 swarm "test recovery" --max-agents 1
```

### Data Recovery

**Recovering swarm results**:
```bash
# Check for swarm run directories
ls swarm-runs/

# Examine specific swarm
ls swarm-runs/swarm_<id>/
cat swarm-runs/swarm_<id>/status.json
cat swarm-runs/swarm_<id>/results.json

# Extract useful data
jq '.swarmStatus' swarm-runs/swarm_<id>/status.json
```

---

## 📞 Getting Help

### Self-Diagnosis Checklist

Before seeking help, run through this checklist:

1. ✅ **Version Check**: `npx claude-flow@2.0.0 --version`
2. ✅ **Basic Functionality**: `npx claude-flow@2.0.0 --help`
3. ✅ **System Status**: `npx claude-flow@2.0.0 status`
4. ✅ **Simple Test**: `npx claude-flow@2.0.0 swarm "test" --max-agents 1`
5. ✅ **Environment**: `node --version` (should be 20+)

### Collecting Debug Information

```bash
# System information
echo "Node: $(node --version)"
echo "NPM: $(npm --version)"
echo "OS: $(uname -a)"
echo "Claude Flow: $(npx claude-flow@2.0.0 --version)"

# Test basic operations
npx claude-flow@2.0.0 status > debug-status.txt 2>&1
npx claude-flow@2.0.0 swarm "debug test" --verbose > debug-swarm.txt 2>&1

# Configuration state
ls -la .claude/ > debug-config.txt 2>&1
cat .claude/settings.json >> debug-config.txt 2>&1
```

### Support Channels

1. **GitHub Issues**: https://github.com/ruvnet/claude-code-flow/issues
   - Include debug information
   - Specify NPX vs local build
   - Include error messages and steps to reproduce

2. **Documentation**: 
   - API Reference: `/API_REFERENCE.md`
   - Usage Guide: `/USAGE_GUIDE.md`
   - Setup Guide: `/SETUP.md`

3. **Community Resources**:
   - ruv-swarm documentation: https://github.com/ruvnet/ruv-FANN/tree/main/ruv-swarm
   - NPM package: https://www.npmjs.com/package/claude-flow/v/alpha

---

## 📈 Performance Monitoring

### Recommended Monitoring Commands

```bash
# Monitor swarm performance
npx claude-flow@2.0.0 swarm "task" --monitor --verbose

# Check system resources during execution
npx claude-flow@2.0.0 monitor --realtime --metrics

# Track memory usage
npx claude-flow@2.0.0 status --detailed

# Performance benchmarking
time npx claude-flow@2.0.0 swarm "benchmark task" --max-agents 3
```

### Performance Baselines (NPX)

| Operation | Expected Time | Normal Range | Alert If > |
|-----------|---------------|--------------|------------|
| `--version` | < 1s | 0.5-2s | 5s |
| `--help` | < 2s | 1-3s | 10s |
| `status` | < 3s | 2-5s | 15s |
| `swarm init` | < 10s | 5-15s | 30s |
| `agent spawn` | < 5s | 3-8s | 20s |

---

*This troubleshooting guide covers known issues as of 2025-01-05. For the latest updates, check the GitHub repository.*

*Last Updated: 2025-01-05*  
*Version: 2.0.0*  
*Status: NPX Production Ready | Local Build Issues Known*