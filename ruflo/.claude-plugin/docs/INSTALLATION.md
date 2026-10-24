# 📦 Claude Flow Plugin Installation Guide

## Quick Installation

### Method 1: Install from GitHub (Recommended)

In Claude Code:

```
/plugin add ruvnet/claude-flow
```

This will:
- Clone the repository
- Install all 150+ commands
- Install all 74+ agents
- Configure MCP servers
- Set up hooks

### Method 2: Install from Local Directory

If you've cloned the repository:

```bash
# Clone the repository
git clone https://github.com/ruvnet/claude-flow.git
cd claude-flow

# In Claude Code, install the plugin
/plugin add .
```

### Step 2: Restart Claude Code

Restart to activate the plugin:

```
/restart
```

### Step 3: Verify Installation

```
/plugin list
```

Look for `claude-flow` in the active plugins list.

Try a command:
```
/coordination-swarm-init
```

Or type `/` to see all 150+ available commands.

---

## What Gets Installed

### ✅ 150+ Slash Commands

Commands organized by category:
- **Coordination** (6): swarm-init, agent-spawn, task-orchestrate
- **SPARC** (18): coder, tdd, architect, reviewer, optimizer
- **GitHub** (18): pr-manager, code-review-swarm, release-manager
- **Hive Mind** (11): init, spawn, consensus, memory
- **Memory** (5): usage, persist, search
- **Monitoring** (5): status, agents, metrics
- **Optimization** (5): topology-optimize, parallel-execution
- **Analysis** (5): performance-report, bottleneck-detect
- **Automation** (6): smart-spawn, auto-agent
- **Swarm** (15): init, spawn, status, monitor
- **Workflows** (5): create, execute, export
- **Training** (5): neural-train, pattern-learn
- **Flow Nexus** (9): swarm, workflow, sandbox
- And more...

### ✅ 74+ Specialized Agents

Available for delegation:
- **Core Development** (5): coder, planner, researcher, reviewer, tester
- **Swarm Coordination** (5): hierarchical, mesh, adaptive coordinators
- **Consensus** (7): Byzantine, Raft, Gossip protocols
- **GitHub** (13): PR manager, code review, releases
- **Specialized** (8): backend, mobile, ML, CI/CD
- And more...

### ✅ MCP Integration

3 MCP servers with 110+ tools:
- **claude-flow**: Core orchestration (40+ tools) - Required
- **ruv-swarm**: Enhanced coordination - Optional
- **flow-nexus**: Cloud features (70+ tools) - Optional

---

## Managing the Plugin

### List Installed Plugins

```
/plugin list
```

### Update Plugin

```
/plugin update claude-flow
```

Or pull latest from GitHub:
```
cd /path/to/claude-flow
git pull
```

### Remove Plugin

```
/plugin remove claude-flow
```

---

## MCP Server Setup (Optional)

The plugin defines MCP servers, but you may need to install the packages:

### Install MCP Packages

```bash
# Core MCP (recommended)
npm install -g claude-flow@alpha

# Optional enhanced coordination
npm install -g ruv-swarm

# Optional cloud features (requires authentication)
npm install -g flow-nexus@latest
```

MCP servers are automatically configured when you install the plugin.

---

## Verification

### Check Plugin Status

In Claude Code:
```
/plugin list
```

Look for `claude-flow` in the list with status "active".

### Test Commands

Type `/` in Claude Code and look for:
- Commands starting with `coordination-`
- Commands starting with `sparc-`
- Commands starting with `github-`
- Commands starting with `hive-mind-`

### Test Agents

Agents are automatically available for Claude Code to delegate to when appropriate.

---

## Troubleshooting

### Plugin Not Found

```
# Verify plugin is installed
/plugin list

# Try installing again
/plugin add ruvnet/claude-flow
```

### Commands Not Showing

```
# Verify plugin is installed
/plugin list

# Check directory structure
ls -la .claude-plugin/
ls -la commands/
ls -la agents/

# Restart Claude Code
/restart
```

### Installation Fails

```
# Try local installation
git clone https://github.com/ruvnet/claude-flow.git
cd claude-flow
/plugin add .
```

---

## Getting Help

- **Documentation**: See README.md for complete documentation
- **Quick Start**: See docs/QUICKSTART.md for 5-minute guide
- **GitHub Issues**: https://github.com/ruvnet/claude-flow/issues
- **Discussions**: https://github.com/ruvnet/claude-flow/discussions

---

## Uninstalling

To remove the plugin:

```
/plugin remove claude-flow
```

This will remove all commands, agents, and hooks.

---

**Version**: 2.5.0
**License**: MIT
**Author**: rUv

---

## Plugin Structure

After installation, the plugin structure is:

```
claude-flow/
├── .claude-plugin/
│   ├── plugin.json          # Plugin metadata
│   ├── README.md            # Documentation
│   ├── INSTALLATION.md      # This file
│   └── PLUGIN_SUMMARY.md    # Status overview
├── commands/                 # 150+ slash commands
│   ├── coordination/
│   ├── sparc/
│   ├── github/
│   ├── hive-mind/
│   └── ...
├── agents/                   # 74+ specialized agents
│   ├── core/
│   ├── swarm/
│   ├── consensus/
│   ├── github/
│   └── ...
└── hooks/                    # Event handlers
    └── hooks.json
```
