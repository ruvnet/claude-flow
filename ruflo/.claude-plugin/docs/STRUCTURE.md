# Claude Flow Plugin Structure

## Official Claude Code Plugin Format

This plugin follows the official Claude Code plugin specification.

## Directory Structure

```
claude-flow/
├── .claude-plugin/              # Plugin metadata and documentation
│   ├── plugin.json              # Plugin manifest
│   ├── marketplace.json         # Marketplace distribution metadata
│   ├── README.md                # Complete documentation (20KB)
│   ├── STRUCTURE.md             # This file
│   ├── docs/
│   │   └── QUICKSTART.md        # 5-minute quickstart
│   └── scripts/
│       ├── install.sh           # Installation script
│       ├── verify.sh            # Verification script
│       └── uninstall.sh         # Uninstallation script
│
├── commands/                     # 150+ slash commands
│   ├── coordination/            # Swarm coordination (6 commands)
│   ├── sparc/                   # SPARC methodology (18 commands)
│   ├── github/                  # GitHub integration (18 commands)
│   ├── hive-mind/               # Hive mind (11 commands)
│   ├── hooks/                   # Hooks configuration (5 commands)
│   ├── memory/                  # Memory management (5 commands)
│   ├── monitoring/              # Monitoring (5 commands)
│   ├── optimization/            # Optimization (5 commands)
│   ├── analysis/                # Analysis (5 commands)
│   ├── automation/              # Automation (6 commands)
│   ├── swarm/                   # Swarm management (15 commands)
│   ├── workflows/               # Workflows (5 commands)
│   ├── training/                # Neural training (5 commands)
│   └── flow-nexus/              # Flow Nexus integration (9 commands)
│
├── agents/                      # 74+ specialized agents
│   ├── core/                    # Core development (5 agents)
│   ├── swarm/                   # Swarm coordination (5 agents)
│   ├── consensus/               # Consensus protocols (7 agents)
│   ├── github/                  # GitHub automation (13 agents)
│   ├── specialized/             # Specialized development (8 agents)
│   ├── sparc/                   # SPARC methodology (4 agents)
│   ├── hive-mind/               # Hive mind (5 agents)
│   └── optimization/            # Performance optimization (5 agents)
│
└── hooks/                       # Event handlers
    └── hooks.json               # Hook configuration

```

## Installation

Users install with:

```
/plugin add ruvnet/claude-flow
/restart
```

## Components

### Plugin Metadata
- **plugin.json**: Plugin manifest with configuration
  - Plugin name, version, description
  - Author and repository information
  - MCP server configuration
  - Engine requirements
- **marketplace.json**: Marketplace distribution metadata
  - Marketplace owner information
  - Plugin listing and features
  - Requirements and dependencies

### Commands (`commands/`)
- Markdown files (.md)
- Automatically discovered by Claude Code
- 150+ commands across 19 categories
- Named with kebab-case (e.g., `coordination-swarm-init.md`)

### Agents (`agents/`)
- Markdown files with YAML frontmatter
- Available for delegation
- 74+ specialized agents across 20 categories
- Named with kebab-case (e.g., `backend-dev.md`)

### Hooks (`hooks/hooks.json`)
- Event handler configuration
- Integration with Claude Flow coordination
- Pre/post task execution, session management

## MCP Integration

The plugin configures 3 MCP servers:

1. **claude-flow** (Required)
   - 40+ orchestration tools
   - Swarm coordination
   - Agent management

2. **ruv-swarm** (Optional)
   - Enhanced coordination
   - WASM acceleration

3. **flow-nexus** (Optional)
   - 70+ cloud tools
   - Requires authentication

## Documentation

- **README.md**: Complete plugin documentation (20KB)
- **marketplace.json**: Marketplace distribution metadata
- **docs/INSTALLATION.md**: Installation instructions
- **docs/PLUGIN_SUMMARY.md**: Production status
- **docs/STRUCTURE.md**: This file
- **docs/QUICKSTART.md**: 5-minute quickstart

## Version

- **Version**: 2.5.0
- **License**: MIT
- **Author**: rUv
- **Compatibility**: Claude Code >= 2.0.0

## Status

✅ **PRODUCTION READY**
