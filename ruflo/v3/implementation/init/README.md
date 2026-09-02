# V3 Init System

Comprehensive initialization system for Claude Code integration with claude-flow V3.

## Overview

The V3 init system creates a complete development environment including:
- `.claude/` directory with settings, skills, commands, agents, and helpers
- `.claude-flow/` runtime configuration
- `.mcp.json` MCP server configuration
- Cross-platform support (Windows, macOS, Linux)

## Quick Start

### CLI Usage

```bash
# Default initialization (recommended settings)
npx @claude-flow/cli init

# Minimal setup (lightweight)
npx @claude-flow/cli init --minimal

# Full setup (everything enabled)
npx @claude-flow/cli init --full

# Force overwrite existing files
npx @claude-flow/cli init --force

# Interactive wizard
npx @claude-flow/cli init wizard
```

### Programmatic Usage

```typescript
import { executeInit, DEFAULT_INIT_OPTIONS } from '@claude-flow/cli/init';

const result = await executeInit({
  ...DEFAULT_INIT_OPTIONS,
  targetDir: process.cwd(),
  sourceBaseDir: '/path/to/claude-flow',
});

console.log(`Created ${result.created.files.length} files`);
console.log(`Platform: ${result.platform.os} (${result.platform.shell})`);
```

## Features

### Platform Auto-Detection

The init system automatically detects:
- Operating system (Windows, macOS, Linux)
- CPU architecture (x64, arm64)
- Default shell (PowerShell, Bash, Zsh)
- Config directory locations

### Component Selection

Choose which components to install:
- **Settings**: Claude Code hooks and permissions
- **Skills**: Specialized capabilities (50+)
- **Commands**: Quick action shortcuts
- **Agents**: Agent definitions (25+)
- **Helpers**: Utility scripts
- **Statusline**: Real-time progress display
- **MCP**: Server configuration
- **Runtime**: V3 configuration

### Preset Configurations

| Preset | Description |
|--------|-------------|
| `DEFAULT` | Recommended for most projects |
| `MINIMAL` | Lightweight, essential features only |
| `FULL` | Everything enabled |

## Documentation

- [Configuration Options](./CONFIGURATION.md)
- [Components Reference](./COMPONENTS.md)
- [Hooks Reference](./HOOKS.md)
- [Programmatic API](./API.md)

## Created Structure

```
project/
├── .claude/
│   ├── settings.json      # Hooks and permissions
│   ├── skills/            # 50+ skills
│   ├── commands/          # Command shortcuts
│   ├── agents/            # Agent definitions
│   ├── helpers/           # Utility scripts
│   ├── statusline.sh      # Unix statusline
│   └── statusline.mjs     # ESM module
├── .claude-flow/
│   ├── config.yaml        # Runtime config
│   ├── data/              # Persistent data
│   ├── logs/              # Log files
│   └── sessions/          # Session archives
└── .mcp.json              # MCP server config
```

## Cross-Platform Support

### Windows
- PowerShell daemon manager (`daemon-manager.ps1`)
- Batch wrapper (`daemon-manager.cmd`)
- Windows-compatible paths

### macOS
- Bash/Zsh compatible scripts
- Zsh statusline hooks
- Library/Application Support paths

### Linux
- Bash scripts
- XDG-compliant paths
- ~/.config directory support
