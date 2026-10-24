#!/usr/bin/env pwsh
# Claude Flow CLI for PowerShell
# AI-Driven Development Toolkit

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Arguments
)

# Check if Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed or not in PATH"
    Write-Error "Please install Node.js from https://nodejs.org/"
    exit 1
}

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Run Claude Flow CLI
& node "$scriptDir\claude-flow" @Arguments

# Forward the exit code
exit $LASTEXITCODE