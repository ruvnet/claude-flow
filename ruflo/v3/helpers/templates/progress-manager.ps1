# Claude Flow V3 Progress Manager Template (Windows PowerShell)

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Metric,

    [Parameter(Mandatory=$true, Position=1)]
    [string]$Value
)

$MetricsDir = Join-Path ${env:PROJECT_ROOT} ".claude-flow\metrics"
$SecurityDir = Join-Path ${env:PROJECT_ROOT} ".claude-flow\security"

# Fallback if PROJECT_ROOT not set
if ([string]::IsNullOrEmpty(${env:PROJECT_ROOT})) {
    $MetricsDir = ".claude-flow\metrics"
    $SecurityDir = ".claude-flow\security"
}

function Log-Success { param([string]$Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Log-Warning { param([string]$Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Log-Error { param([string]$Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Log-Info { param([string]$Message) Write-Host "ℹ️  $Message" -ForegroundColor Blue }

function Update-JsonFile {
    param(
        [string]$FilePath,
        [string]$JsonPath,
        $NewValue,
        [string]$SuccessMessage
    )

    if (Test-Path $FilePath) {
        try {
            $json = Get-Content $FilePath | ConvertFrom-Json

            # Simple property updates (extend as needed)
            switch ($JsonPath) {
                "domains.completed" { $json.domains.completed = [int]$NewValue }
                "swarm.activeAgents" { $json.swarm.activeAgents = [int]$NewValue }
                "ddd.progress" { $json.ddd.progress = [int]$NewValue }
                "cvesFixed" { $json.cvesFixed = [int]$NewValue }
                "flashAttention.speedup" { $json.flashAttention.speedup = $NewValue }
                "memory.reduction" { $json.memory.reduction = $NewValue }
            }

            $json.lastUpdated = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
            $json | ConvertTo-Json -Depth 4 | Set-Content $FilePath
            Log-Success $SuccessMessage
        }
        catch {
            Log-Error "Failed to update $FilePath : $_"
            exit 1
        }
    } else {
        Log-Error "File not found: $FilePath"
        exit 1
    }
}

# Update progress metric
switch ($Metric.ToLower()) {
    "domain" {
        $progressFile = Join-Path $MetricsDir "v3-progress.json"
        Update-JsonFile $progressFile "domains.completed" $Value "Updated domain count to $Value/5"
    }

    "agent" {
        $progressFile = Join-Path $MetricsDir "v3-progress.json"
        Update-JsonFile $progressFile "swarm.activeAgents" $Value "Updated active agents to $Value/15"
    }

    "security" {
        $securityFile = Join-Path $SecurityDir "audit-status.json"
        Update-JsonFile $securityFile "cvesFixed" $Value "Updated security: $Value/3 CVEs fixed"
    }

    "performance" {
        $perfFile = Join-Path $MetricsDir "performance.json"
        Update-JsonFile $perfFile "flashAttention.speedup" $Value "Updated Flash Attention speedup to $Value"
    }

    "memory" {
        $perfFile = Join-Path $MetricsDir "performance.json"
        Update-JsonFile $perfFile "memory.reduction" $Value "Updated memory reduction to $Value"
    }

    "ddd" {
        $progressFile = Join-Path $MetricsDir "v3-progress.json"
        Update-JsonFile $progressFile "ddd.progress" $Value "Updated DDD progress to $Value%"
    }

    default {
        Log-Error "Unknown metric: $Metric"
        Log-Info "Available metrics: domain, agent, security, performance, memory, ddd"
        exit 1
    }
}