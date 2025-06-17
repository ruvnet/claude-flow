# Init Command - Modular Structure

This directory contains the modular implementation of the `claude-flow init` command, which initializes Claude Code integration files for projects.

## Directory Structure

```
init/
├── README.md                    # This file
├── index.js                     # Main entry point for init command
├── help.js                      # Help text and documentation
├── executable-wrapper.js        # Creates local executable wrappers
├── sparc-structure.js          # SPARC environment setup
├── templates/                   # Template files
│   ├── claude-md.js            # CLAUDE.md templates
│   ├── memory-bank-md.js       # memory-bank.md templates
│   ├── coordination-md.js      # coordination.md templates
│   └── readme-files.js         # README templates for directories
├── sparc/                       # SPARC-specific configuration
│   ├── roomodes-config.js      # .roomodes configuration
│   ├── workflows.js            # SPARC workflow templates
│   └── roo-readme.js           # .roo directory README
└── claude-commands/             # Claude Code slash commands
    ├── slash-commands.js        # Main slash command creator
    ├── sparc-commands.js        # SPARC-specific commands
    └── claude-flow-commands.js  # Claude-Flow specific commands
```

## What Gets Created

### With `--sparc` flag:

1. **Claude Code Configuration**:
   - `CLAUDE.md` - SPARC-enhanced project instructions
   - `.claude/` directory structure
   - `.claude/commands/` - Slash commands for Claude Code
   - `.claude/logs/` - Conversation logs directory

2. **Memory System**:
   - `memory-bank.md` - Memory system documentation
   - `memory/` directory structure
   - `memory/agents/` - Agent-specific memory
   - `memory/sessions/` - Session storage
   - `memory/claude-flow-data.json` - Persistence database

3. **Coordination System**:
   - `coordination.md` - Agent coordination documentation
   - `coordination/` directory structure

4. **SPARC Environment**:
   - `.roomodes` - SPARC mode configurations (17+ modes)
   - `.roo/` directory with templates and workflows

5. **Slash Commands Created**:
   - `/sparc` - Main SPARC command
   - `/sparc-<mode>` - Individual mode commands (architect, code, tdd, etc.)
   - `/claude-flow-help` - Help command
   - `/claude-flow-memory` - Memory system command
   - `/claude-flow-swarm` - Swarm coordination command

6. **Local Executable**:
   - `./claude-flow` (Unix/Mac/Linux)
   - `claude-flow.cmd` (Windows)

### With `--minimal` flag:
Creates minimal versions of all configuration files without SPARC features.

### With `--force` flag:
Overwrites existing files if they already exist.

## Usage

```bash
# Recommended first-time setup with SPARC
npx claude-flow@latest init --sparc

# Minimal setup
npx claude-flow init --minimal

# Force overwrite existing files
npx claude-flow init --force
```

## Module Responsibilities

- **index.js**: Main orchestration and file creation logic
- **help.js**: User documentation and examples
- **executable-wrapper.js**: Platform-specific executable creation
- **sparc-structure.js**: SPARC environment setup and integration
- **templates/**: All template content for generated files
- **sparc/**: SPARC-specific configurations and templates
- **claude-commands/**: Claude Code slash command generation

## Notes

- The init command detects Claude Code's `.claude/` directory structure
- Slash commands follow Claude Code's markdown format with YAML frontmatter
- SPARC modes are fully integrated with Claude-Flow's orchestration system
- All generated files include comprehensive documentation