# Claude Flow V3 Helper System

The V3 Helper System provides cross-platform automation and development tools for claude-flow v3 users. These helpers enable automatic progress tracking, checkpointing, GitHub integration, and development workflow automation.

## 🚀 Quick Start

### Installation
```bash
# Copy helpers to your claude-flow v3 project
cp -r v3/helpers/ your-project/.claude/helpers/

# Make scripts executable (Linux/Mac)
chmod +x your-project/.claude/helpers/*.sh

# Windows users: Use PowerShell scripts (.ps1)
```

### Basic Usage
```bash
# Linux/Mac
./.claude/helpers/claude-flow-v3.sh init
./.claude/helpers/claude-flow-v3.sh status
./.claude/helpers/claude-flow-v3.sh update domain 3

# Windows (PowerShell)
.\.claude\helpers\claude-flow-v3.ps1 init
.\.claude\helpers\claude-flow-v3.ps1 status
.\.claude\helpers\claude-flow-v3.ps1 update domain 3
```

## 🛠️ Available Helpers

### 🎛️ Master Control Interface
- **`claude-flow-v3.sh`** (Linux/Mac) / **`claude-flow-v3.ps1`** (Windows)
  - Complete V3 development interface
  - Cross-platform progress tracking
  - Automated environment validation

### 📊 Progress Management
- **`progress-manager.sh/.ps1`** - Update development metrics
- **`status-display.sh/.ps1`** - Show current progress
- **`config-validator.sh/.ps1`** - Validate environment

### 🔄 Checkpoint System
- **`checkpoint-manager.sh/.ps1`** - Git-based checkpointing
- **`auto-commit.sh/.ps1`** - Automated commit system
- **`session-manager.sh/.ps1`** - Development session tracking

### 🔧 GitHub Integration
- **`github-integration.sh/.ps1`** - GitHub workflow automation
- **`pr-management.sh/.ps1`** - Pull request automation
- **`issue-tracker.sh/.ps1`** - Issue management

## 🌍 Cross-Platform Support

### Supported Platforms
- ✅ **Linux** (Ubuntu, Debian, CentOS, etc.)
- ✅ **macOS** (Intel & Apple Silicon)
- ✅ **Windows** (PowerShell 5.1+, PowerShell Core)

### Platform-Specific Features

#### Linux/macOS
```bash
# Bash-based helpers with full ANSI color support
./helpers/claude-flow-v3.sh status
./helpers/checkpoint-manager.sh auto-checkpoint "Feature complete"
```

#### Windows
```powershell
# PowerShell-based helpers with Windows Terminal integration
.\helpers\claude-flow-v3.ps1 status
.\helpers\checkpoint-manager.ps1 auto-checkpoint "Feature complete"
```

## 📋 Configuration Templates

### settings.json Template
```json
{
  "helpers": {
    "directory": ".claude/helpers",
    "enabled": true,
    "platform": "auto-detect",
    "scripts": {
      "master": ".claude/helpers/claude-flow-v3",
      "progressManager": ".claude/helpers/progress-manager",
      "checkpointManager": ".claude/helpers/checkpoint-manager",
      "configValidator": ".claude/helpers/config-validator"
    }
  },
  "v3Configuration": {
    "domains": {
      "total": 5,
      "names": ["task-management", "session-management", "health-monitoring", "lifecycle-management", "event-coordination"],
      "sourceDir": "src/domains"
    },
    "swarm": {
      "totalAgents": 15,
      "topology": "hierarchical-mesh",
      "coordination": "queen-led"
    },
    "performance": {
      "flashAttentionTarget": "2.49x-7.47x",
      "memoryReductionTarget": "50-75%"
    }
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/helpers/checkpoint-manager auto-checkpoint \"File edit: $TOOL_INPUT_file_path\""
          }
        ]
      }
    ]
  }
}
```

## 🎯 Customization Guide

### Adding Custom Helpers
1. Create your helper script in `.claude/helpers/custom/`
2. Follow the naming convention: `custom-helper-name.sh/.ps1`
3. Add to settings.json configuration
4. Test cross-platform compatibility

### Hook Integration
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/helpers/custom/pre-task-validation.sh \"$TOOL_INPUT_prompt\""
          }
        ]
      }
    ]
  }
}
```

### Progress Tracking Customization
```bash
# Add custom metrics
./helpers/progress-manager.sh add-metric "custom-metric" 75
./helpers/progress-manager.sh set-target "custom-target" "100%"
```

## 📊 Metrics & Tracking

### Default Metrics Tracked
- **Domain Progress**: DDD bounded context completion
- **Agent Deployment**: Swarm agent activation status
- **Security Status**: CVE fixes and audit progress
- **Performance**: Optimization target achievement
- **Memory Usage**: Reduction targets and current usage

### Custom Metrics
```bash
# Add project-specific metrics
./helpers/progress-manager.sh define-metric \
  --name "api-endpoints" \
  --total 20 \
  --current 12 \
  --target "100%"
```

## 🔌 Integration Examples

### CI/CD Pipeline Integration
```yaml
# GitHub Actions example
name: Claude Flow V3 Progress
on: [push]
jobs:
  update-progress:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Update V3 Progress
        run: |
          ./.claude/helpers/claude-flow-v3.sh update-from-ci
          ./.claude/helpers/checkpoint-manager.sh ci-checkpoint "Automated progress update"
```

### VS Code Integration
```json
{
  "tasks": [
    {
      "label": "V3 Status",
      "type": "shell",
      "command": "./.claude/helpers/claude-flow-v3.sh status",
      "group": "build",
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    }
  ]
}
```

## 🔧 Troubleshooting

### Permission Issues (Linux/Mac)
```bash
# Fix permission issues
find .claude/helpers -name "*.sh" -exec chmod +x {} \;
```

### Windows PowerShell Execution Policy
```powershell
# Allow local script execution
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Path Issues
```bash
# Add helpers to PATH (optional)
export PATH="$PATH:$(pwd)/.claude/helpers"
```

## 📚 Documentation

- [Installation Guide](./docs/installation.md)
- [Platform-Specific Setup](./docs/platform-setup.md)
- [Customization Examples](./docs/customization.md)
- [API Reference](./docs/api-reference.md)
- [Troubleshooting](./docs/troubleshooting.md)

## 🤝 Contributing

1. Follow the cross-platform development guidelines
2. Test on Linux, macOS, and Windows
3. Update documentation for new features
4. Ensure backward compatibility

---

*Claude Flow V3 Helper System - Enabling cross-platform development automation*