# Claude Flow V3 Helper System Installation Guide

This guide covers installing the V3 helper system across all supported platforms.

## 🚀 Quick Installation

### For New Projects
```bash
# Copy the entire helper system to your project
cp -r /path/to/claude-flow/v3/helpers/ your-project/.claude/helpers/

# Make scripts executable (Linux/macOS)
chmod +x your-project/.claude/helpers/*.sh
chmod +x your-project/.claude/helpers/templates/*.sh
```

### For Existing Projects
```bash
# Navigate to your project
cd your-existing-project

# Create Claude directory structure
mkdir -p .claude/helpers

# Copy helpers
cp -r /path/to/claude-flow/v3/helpers/* .claude/helpers/

# Initialize
./.claude/helpers/claude-flow-v3.sh init
```

## 🌍 Platform-Specific Setup

### Linux (Ubuntu/Debian/CentOS)

#### Prerequisites
```bash
# Install required tools
sudo apt update
sudo apt install git jq curl nodejs npm

# For CentOS/RHEL
sudo yum install git jq curl nodejs npm
```

#### Installation
```bash
# Copy helpers
cp -r v3/helpers/ .claude/helpers/

# Make executable
chmod +x .claude/helpers/*.sh .claude/helpers/templates/*.sh

# Initialize project
./.claude/helpers/claude-flow-v3.sh init

# Validate setup
./.claude/helpers/claude-flow-v3.sh validate
```

### macOS

#### Prerequisites
```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required tools
brew install git jq node
```

#### Installation
```bash
# Copy helpers
cp -r v3/helpers/ .claude/helpers/

# Make executable
chmod +x .claude/helpers/*.sh .claude/helpers/templates/*.sh

# Initialize project
./.claude/helpers/claude-flow-v3.sh init

# Validate setup
./.claude/helpers/claude-flow-v3.sh validate
```

### Windows

#### Prerequisites
```powershell
# Install Git for Windows (includes Git Bash)
# Download from: https://git-scm.com/download/win

# Install Node.js
# Download from: https://nodejs.org/

# Install PowerShell 7+ (recommended)
winget install Microsoft.PowerShell

# Verify PowerShell execution policy
Get-ExecutionPolicy -List
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### Installation (PowerShell)
```powershell
# Copy helpers
Copy-Item -Recurse -Path "v3\helpers\*" -Destination ".claude\helpers\"

# Initialize project
.\.claude\helpers\claude-flow-v3.ps1 init

# Validate setup
.\.claude\helpers\claude-flow-v3.ps1 validate
```

#### Installation (Git Bash/WSL)
```bash
# Copy helpers
cp -r v3/helpers/ .claude/helpers/

# Make executable
chmod +x .claude/helpers/*.sh .claude/helpers/templates/*.sh

# Initialize project
./.claude/helpers/claude-flow-v3.sh init
```

## 📋 Configuration

### Settings.json Integration
Add to your `.claude/settings.json`:

```json
{
  "helpers": {
    "directory": ".claude/helpers",
    "enabled": true,
    "platform": "auto-detect",
    "scripts": {
      "master": ".claude/helpers/claude-flow-v3",
      "progressManager": ".claude/helpers/templates/progress-manager",
      "statusDisplay": ".claude/helpers/templates/status-display",
      "configValidator": ".claude/helpers/templates/config-validator"
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
    }
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "timeout": 3000,
            "command": ".claude/helpers/templates/checkpoint-manager auto-checkpoint \"File edit: $TOOL_INPUT_file_path\""
          }
        ]
      }
    ]
  }
}
```

### Environment Variables (Optional)
```bash
# Linux/macOS
export CLAUDE_FLOW_V3_MODE=enabled
export CLAUDE_FLOW_HELPERS_DIR=.claude/helpers
export CLAUDE_FLOW_PLATFORM=auto

# Windows (PowerShell)
$env:CLAUDE_FLOW_V3_MODE = "enabled"
$env:CLAUDE_FLOW_HELPERS_DIR = ".claude\helpers"
$env:CLAUDE_FLOW_PLATFORM = "auto"
```

## 🔧 Post-Installation Verification

### Basic Functionality Test
```bash
# Linux/macOS
./.claude/helpers/claude-flow-v3.sh platform-info
./.claude/helpers/claude-flow-v3.sh status

# Windows
.\.claude\helpers\claude-flow-v3.ps1 platform-info
.\.claude\helpers\claude-flow-v3.ps1 status
```

### Full Validation
```bash
# Run comprehensive validation
./.claude/helpers/claude-flow-v3.sh validate

# Expected output: "All checks passed! V3 development environment is ready."
```

## 🛠️ Customization

### Adding Custom Helpers
1. Create your custom helper in `.claude/helpers/custom/`
2. Follow the naming convention: `custom-helper-name.sh/.ps1`
3. Add to settings.json configuration
4. Test across platforms

Example custom helper:
```bash
#!/bin/bash
# .claude/helpers/custom/my-custom-helper.sh

echo "Custom helper for my specific workflow"
# Your custom logic here
```

### Hook Integration
Add custom hooks to automate your workflow:

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

## ❗ Troubleshooting

### Permission Issues (Linux/macOS)
```bash
# Fix permission issues
find .claude/helpers -name "*.sh" -exec chmod +x {} \;
```

### Windows PowerShell Execution Policy
```powershell
# Check current policy
Get-ExecutionPolicy

# Allow local script execution
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# For corporate environments
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
```

### Path Issues
```bash
# Verify helper paths
ls -la .claude/helpers/
./.claude/helpers/claude-flow-v3.sh platform-info

# Add helpers to PATH (optional)
export PATH="$PATH:$(pwd)/.claude/helpers"
```

### Missing Dependencies
```bash
# Install missing tools
## Ubuntu/Debian
sudo apt install git jq nodejs npm

## macOS
brew install git jq node

## Windows (using chocolatey)
choco install git jq nodejs
```

## 🔄 Updates

### Updating Helpers
```bash
# Backup current helpers
cp -r .claude/helpers .claude/helpers.backup

# Copy new helpers
cp -r /path/to/new/v3/helpers/* .claude/helpers/

# Re-initialize
./.claude/helpers/claude-flow-v3.sh init
```

### Version Management
```bash
# Check helper version
./.claude/helpers/claude-flow-v3.sh --version

# View changelog
cat .claude/helpers/CHANGELOG.md
```

---

*Installation complete! Your V3 helper system is ready for cross-platform development automation.*