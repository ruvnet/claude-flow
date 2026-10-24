# Claude Flow V3 Master Helper (Windows PowerShell)
# Cross-platform development automation for claude-flow v3

param(
    [Parameter(Position=0)]
    [string]$Command = "help",

    [Parameter(Position=1)]
    [string]$Metric = "",

    [Parameter(Position=2)]
    [string]$Value = "",

    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$RemainingArgs = @()
)

# Configuration
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$ClaudeDir = Join-Path $ProjectRoot ".claude"
$HelpersDir = Join-Path $ClaudeDir "helpers"
$MetricsDir = Join-Path $ProjectRoot ".claude-flow\metrics"
$SecurityDir = Join-Path $ProjectRoot ".claude-flow\security"

# Color functions for PowerShell
function Write-ColoredOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [string]$Prefix = ""
    )

    $colorMap = @{
        "Red" = "Red"
        "Green" = "Green"
        "Yellow" = "Yellow"
        "Blue" = "Blue"
        "Purple" = "Magenta"
        "Cyan" = "Cyan"
        "White" = "White"
    }

    Write-Host "$Prefix$Message" -ForegroundColor $colorMap[$Color]
}

function Log-Info { param([string]$Message) Write-ColoredOutput "ℹ️  $Message" "Blue" }
function Log-Success { param([string]$Message) Write-ColoredOutput "✅ $Message" "Green" }
function Log-Warning { param([string]$Message) Write-ColoredOutput "⚠️  $Message" "Yellow" }
function Log-Error { param([string]$Message) Write-ColoredOutput "❌ $Message" "Red" }
function Log-Header { param([string]$Message) Write-ColoredOutput $Message "Purple" }

# Ensure required directories exist
function Setup-Directories {
    @($ClaudeDir, $HelpersDir, $MetricsDir, $SecurityDir) | ForEach-Object {
        if (!(Test-Path $_)) {
            New-Item -ItemType Directory -Force -Path $_ | Out-Null
        }
    }
}

# Initialize V3 project
function Initialize-V3Project {
    Log-Header "🚀 Initializing Claude Flow V3 Project"

    Setup-Directories

    # Copy helper templates if they don't exist
    if (!(Test-Path (Join-Path $HelpersDir "progress-manager.ps1"))) {
        Log-Info "Setting up helper templates..."
        $templateDir = Join-Path $ScriptDir "templates"
        if (Test-Path $templateDir) {
            Copy-Item "$templateDir\*.ps1" $HelpersDir -Force -ErrorAction SilentlyContinue
        }
    }

    # Create default configuration files
    Create-DefaultConfigs

    # Validate setup
    try {
        $validatorPath = Join-Path $HelpersDir "config-validator.ps1"
        if (Test-Path $validatorPath) {
            & $validatorPath | Out-Null
            Log-Success "V3 project initialized successfully"
            Log-Info "Platform: Windows (PowerShell $($PSVersionTable.PSVersion))"
            Log-Info "Project root: $ProjectRoot"
            Log-Info "Run 'claude-flow-v3.ps1 status' to see current progress"
        } else {
            Log-Warning "Validator not found, but basic setup complete"
        }
    }
    catch {
        Log-Error "Initialization completed with warnings. Run 'claude-flow-v3.ps1 validate' for details"
    }
}

# Create default configuration files
function Create-DefaultConfigs {
    # Default V3 progress file
    $progressFile = Join-Path $MetricsDir "v3-progress.json"
    if (!(Test-Path $progressFile)) {
        $progressData = @{
            domains = @{
                completed = 0
                total = 5
                list = @(
                    @{name="task-management"; status="pending"; progress=0},
                    @{name="session-management"; status="pending"; progress=0},
                    @{name="health-monitoring"; status="pending"; progress=0},
                    @{name="lifecycle-management"; status="pending"; progress=0},
                    @{name="event-coordination"; status="pending"; progress=0}
                )
            }
            swarm = @{
                activeAgents = 0
                totalAgents = 15
                topology = "hierarchical-mesh"
            }
            ddd = @{
                progress = 0
                orchestratorRefactored = $false
            }
            lastUpdated = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        }
        $progressData | ConvertTo-Json -Depth 4 | Set-Content $progressFile
    }

    # Default performance metrics
    $perfFile = Join-Path $MetricsDir "performance.json"
    if (!(Test-Path $perfFile)) {
        $perfData = @{
            flashAttention = @{speedup="1.0x"; target="2.49x-7.47x"}
            memory = @{reduction="0%"; target="50-75%"}
            codeReduction = @{linesRemoved=0; target="10,000+"}
            startupTime = @{current="2000ms"; target="500ms"}
            lastUpdated = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        }
        $perfData | ConvertTo-Json -Depth 3 | Set-Content $perfFile
    }

    # Default security audit
    $securityFile = Join-Path $SecurityDir "audit-status.json"
    if (!(Test-Path $securityFile)) {
        $securityData = @{
            status = "PENDING"
            cvesFixed = 0
            totalCves = 3
            criticalVulnerabilities = @(
                @{id="CVE-1"; description="Input validation bypass"; status="pending"},
                @{id="CVE-2"; description="Path traversal vulnerability"; status="pending"},
                @{id="CVE-3"; description="Command injection vulnerability"; status="pending"}
            )
            lastAudit = $null
        }
        $securityData | ConvertTo-Json -Depth 3 | Set-Content $securityFile
    }
}

# Show current status
function Show-Status {
    $statusScript = Join-Path $HelpersDir "status-display.ps1"
    if (Test-Path $statusScript) {
        & $statusScript
    } else {
        Log-Info "Status display not available. Run 'claude-flow-v3.ps1 init' to set up helpers."
    }
}

# Update progress metrics
function Update-Progress {
    param([string]$Metric, [string]$Value)

    if ([string]::IsNullOrEmpty($Metric) -or [string]::IsNullOrEmpty($Value)) {
        Log-Error "Usage: update <metric> <value>"
        Log-Info "Available metrics: domain, agent, security, performance, memory, ddd"
        exit 1
    }

    $progressScript = Join-Path $HelpersDir "progress-manager.ps1"
    if (Test-Path $progressScript) {
        & $progressScript $Metric $Value
    } else {
        Log-Error "Progress manager not available. Run 'claude-flow-v3.ps1 init' first."
        exit 1
    }
}

# Validate configuration
function Validate-Config {
    $validatorScript = Join-Path $HelpersDir "config-validator.ps1"
    if (Test-Path $validatorScript) {
        & $validatorScript
    } else {
        Log-Error "Config validator not available. Run 'claude-flow-v3.ps1 init' first."
        exit 1
    }
}

# Create checkpoint
function Create-Checkpoint {
    param([string]$Message = "Auto checkpoint from V3 helper")

    $checkpointScript = Join-Path $HelpersDir "checkpoint-manager.ps1"
    if (Test-Path $checkpointScript) {
        & $checkpointScript "auto-checkpoint" $Message
    } else {
        Log-Warning "Checkpoint manager not available. Creating simple git commit..."
        try {
            git rev-parse --is-inside-work-tree 2>$null | Out-Null
            git add .
            git commit -m $Message
            Log-Success "Git commit created"
        }
        catch {
            Log-Info "No changes to commit or not in git repository"
        }
    }
}

# Run platform-specific helper
function Run-Helper {
    param([string]$HelperName, [string[]]$Arguments)

    $helperScript = Join-Path $HelpersDir "$HelperName.ps1"
    if (Test-Path $helperScript) {
        if ($Arguments) {
            & $helperScript @Arguments
        } else {
            & $helperScript
        }
    } else {
        Log-Error "Helper not found: $HelperName"
        Log-Info "Available helpers:"
        Get-ChildItem $HelpersDir -Filter "*.ps1" | ForEach-Object {
            Log-Info "  $($_.BaseName)"
        }
        exit 1
    }
}

# Main command handler
switch ($Command.ToLower()) {
    "init" {
        Initialize-V3Project
    }

    { $_ -in @("status", "st") } {
        Show-Status
    }

    "update" {
        Update-Progress $Metric $Value
    }

    { $_ -in @("validate", "check") } {
        Validate-Config
    }

    { $_ -in @("checkpoint", "cp") } {
        $message = if ($Metric) { "$Metric $Value" } else { "Auto checkpoint from V3 helper" }
        Create-Checkpoint $message
    }

    "github" {
        Run-Helper "github-integration" $RemainingArgs
    }

    "pr" {
        Run-Helper "pr-management" $RemainingArgs
    }

    "issue" {
        Run-Helper "issue-tracker" $RemainingArgs
    }

    "session" {
        Run-Helper "session-manager" $RemainingArgs
    }

    "platform-info" {
        Write-Host "Platform: Windows (PowerShell $($PSVersionTable.PSVersion))"
        Write-Host "Script directory: $ScriptDir"
        Write-Host "Project root: $ProjectRoot"
        Write-Host "Helpers directory: $HelpersDir"
        Write-Host "Execution Policy: $(Get-ExecutionPolicy -Scope CurrentUser)"
    }

    { $_ -in @("help", "--help", "-h", "") } {
        Write-Host @"
Claude Flow V3 Master Helper (Windows PowerShell)
================================================

Usage: .\claude-flow-v3.ps1 <command> [options]

Core Commands:
  init                     Initialize V3 project with helpers
  status, st               Show current development status
  update <metric> <value>  Update progress metrics
  validate, check          Validate project configuration
  checkpoint, cp [msg]     Create development checkpoint

Development Commands:
  github <action>          GitHub integration commands
  pr <action>              Pull request management
  issue <action>           Issue tracking commands
  session <action>         Development session management

Utility Commands:
  platform-info           Show platform and path information
  help                     Show this help message

Examples:
  .\claude-flow-v3.ps1 init                  # Set up V3 project
  .\claude-flow-v3.ps1 status                # Show current progress
  .\claude-flow-v3.ps1 update domain 3       # Mark 3 domains complete
  .\claude-flow-v3.ps1 update agent 8        # Set 8 agents active
  .\claude-flow-v3.ps1 checkpoint "Feature complete"
  .\claude-flow-v3.ps1 github status         # GitHub integration status

Platform: Windows (PowerShell $($PSVersionTable.PSVersion))
Claude Directory: $ClaudeDir

Note: If you get execution policy errors, run:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
"@
    }

    default {
        Log-Error "Unknown command: $Command"
        Log-Info "Run '.\claude-flow-v3.ps1 help' for usage information"
        exit 1
    }
}