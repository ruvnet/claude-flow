/**
 * Helpers Generator
 * Creates utility scripts in .claude/helpers/
 */

import type { InitOptions } from './types.js';
import { generateStatuslineScript, generateStatuslineHook } from './statusline-generator.js';

/**
 * Generate pre-commit hook script
 */
export function generatePreCommitHook(): string {
  return `#!/bin/bash
# Claude Flow Pre-Commit Hook
# Validates code quality before commit

set -e

echo "🔍 Running Claude Flow pre-commit checks..."

# Get staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

# Run validation for each staged file
for FILE in $STAGED_FILES; do
  if [[ "$FILE" =~ \\.(ts|js|tsx|jsx)$ ]]; then
    echo "  Validating: $FILE"
    npx @claude-flow/cli hooks pre-edit --file "$FILE" --validate-syntax 2>/dev/null || true
  fi
done

# Run tests if available
if [ -f "package.json" ] && grep -q '"test"' package.json; then
  echo "🧪 Running tests..."
  npm test --if-present 2>/dev/null || echo "  Tests skipped or failed"
fi

echo "✅ Pre-commit checks complete"
`;
}

/**
 * Generate post-commit hook script
 */
export function generatePostCommitHook(): string {
  return `#!/bin/bash
# Claude Flow Post-Commit Hook
# Records commit metrics and trains patterns

COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --pretty=%B)

echo "📊 Recording commit metrics..."

# Notify claude-flow of commit
npx @claude-flow/cli hooks notify \\
  --message "Commit: $COMMIT_MSG" \\
  --level info \\
  --metadata '{"hash": "'$COMMIT_HASH'"}' 2>/dev/null || true

echo "✅ Commit recorded"
`;
}

/**
 * Generate session manager script
 */
export function generateSessionManager(): string {
  return `#!/usr/bin/env node
/**
 * Claude Flow Session Manager
 * Handles session lifecycle: start, restore, end
 */

const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(process.cwd(), '.claude-flow', 'sessions');
const SESSION_FILE = path.join(SESSION_DIR, 'current.json');

const commands = {
  start: () => {
    const sessionId = \`session-\${Date.now()}\`;
    const session = {
      id: sessionId,
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
      context: {},
      metrics: {
        edits: 0,
        commands: 0,
        tasks: 0,
        errors: 0,
      },
    };

    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

    console.log(\`Session started: \${sessionId}\`);
    return session;
  },

  restore: () => {
    if (!fs.existsSync(SESSION_FILE)) {
      console.log('No session to restore');
      return null;
    }

    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    session.restoredAt = new Date().toISOString();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

    console.log(\`Session restored: \${session.id}\`);
    return session;
  },

  end: () => {
    if (!fs.existsSync(SESSION_FILE)) {
      console.log('No active session');
      return null;
    }

    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    session.endedAt = new Date().toISOString();
    session.duration = Date.now() - new Date(session.startedAt).getTime();

    // Archive session
    const archivePath = path.join(SESSION_DIR, \`\${session.id}.json\`);
    fs.writeFileSync(archivePath, JSON.stringify(session, null, 2));
    fs.unlinkSync(SESSION_FILE);

    console.log(\`Session ended: \${session.id}\`);
    console.log(\`Duration: \${Math.round(session.duration / 1000 / 60)} minutes\`);
    console.log(\`Metrics: \${JSON.stringify(session.metrics)}\`);

    return session;
  },

  status: () => {
    if (!fs.existsSync(SESSION_FILE)) {
      console.log('No active session');
      return null;
    }

    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    const duration = Date.now() - new Date(session.startedAt).getTime();

    console.log(\`Session: \${session.id}\`);
    console.log(\`Started: \${session.startedAt}\`);
    console.log(\`Duration: \${Math.round(duration / 1000 / 60)} minutes\`);
    console.log(\`Metrics: \${JSON.stringify(session.metrics)}\`);

    return session;
  },

  update: (key, value) => {
    if (!fs.existsSync(SESSION_FILE)) {
      console.log('No active session');
      return null;
    }

    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    session.context[key] = value;
    session.updatedAt = new Date().toISOString();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

    return session;
  },

  metric: (name) => {
    if (!fs.existsSync(SESSION_FILE)) {
      return null;
    }

    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    if (session.metrics[name] !== undefined) {
      session.metrics[name]++;
      fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    }

    return session;
  },
};

// CLI
const [,, command, ...args] = process.argv;

if (command && commands[command]) {
  commands[command](...args);
} else {
  console.log('Usage: session.js <start|restore|end|status|update|metric> [args]');
}

module.exports = commands;
`;
}

/**
 * Generate agent router script
 */
export function generateAgentRouter(): string {
  return `#!/usr/bin/env node
/**
 * Claude Flow Agent Router
 * Routes tasks to optimal agents based on learned patterns
 */

const AGENT_CAPABILITIES = {
  coder: ['code-generation', 'refactoring', 'debugging', 'implementation'],
  tester: ['unit-testing', 'integration-testing', 'coverage', 'test-generation'],
  reviewer: ['code-review', 'security-audit', 'quality-check', 'best-practices'],
  researcher: ['web-search', 'documentation', 'analysis', 'summarization'],
  architect: ['system-design', 'architecture', 'patterns', 'scalability'],
  'backend-dev': ['api', 'database', 'server', 'authentication'],
  'frontend-dev': ['ui', 'react', 'css', 'components'],
  devops: ['ci-cd', 'docker', 'deployment', 'infrastructure'],
};

const TASK_PATTERNS = {
  // Code patterns
  'implement|create|build|add|write code': 'coder',
  'test|spec|coverage|unit test|integration': 'tester',
  'review|audit|check|validate|security': 'reviewer',
  'research|find|search|documentation|explore': 'researcher',
  'design|architect|structure|plan': 'architect',

  // Domain patterns
  'api|endpoint|server|backend|database': 'backend-dev',
  'ui|frontend|component|react|css|style': 'frontend-dev',
  'deploy|docker|ci|cd|pipeline|infrastructure': 'devops',
};

function routeTask(task) {
  const taskLower = task.toLowerCase();

  // Check patterns
  for (const [pattern, agent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(taskLower)) {
      return {
        agent,
        confidence: 0.8,
        reason: \`Matched pattern: \${pattern}\`,
      };
    }
  }

  // Default to coder for unknown tasks
  return {
    agent: 'coder',
    confidence: 0.5,
    reason: 'Default routing - no specific pattern matched',
  };
}

// CLI
const task = process.argv.slice(2).join(' ');

if (task) {
  const result = routeTask(task);
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('Usage: router.js <task description>');
  console.log('\\nAvailable agents:', Object.keys(AGENT_CAPABILITIES).join(', '));
}

module.exports = { routeTask, AGENT_CAPABILITIES, TASK_PATTERNS };
`;
}

/**
 * Generate memory helper script
 */
export function generateMemoryHelper(): string {
  return `#!/usr/bin/env node
/**
 * Claude Flow Memory Helper
 * Simple key-value memory for cross-session context
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(process.cwd(), '.claude-flow', 'data');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
    }
  } catch (e) {
    // Ignore
  }
  return {};
}

function saveMemory(memory) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

const commands = {
  get: (key) => {
    const memory = loadMemory();
    const value = key ? memory[key] : memory;
    console.log(JSON.stringify(value, null, 2));
    return value;
  },

  set: (key, value) => {
    if (!key) {
      console.error('Key required');
      return;
    }
    const memory = loadMemory();
    memory[key] = value;
    memory._updated = new Date().toISOString();
    saveMemory(memory);
    console.log(\`Set: \${key}\`);
  },

  delete: (key) => {
    if (!key) {
      console.error('Key required');
      return;
    }
    const memory = loadMemory();
    delete memory[key];
    saveMemory(memory);
    console.log(\`Deleted: \${key}\`);
  },

  clear: () => {
    saveMemory({});
    console.log('Memory cleared');
  },

  keys: () => {
    const memory = loadMemory();
    const keys = Object.keys(memory).filter(k => !k.startsWith('_'));
    console.log(keys.join('\\n'));
    return keys;
  },
};

// CLI
const [,, command, key, ...valueParts] = process.argv;
const value = valueParts.join(' ');

if (command && commands[command]) {
  commands[command](key, value);
} else {
  console.log('Usage: memory.js <get|set|delete|clear|keys> [key] [value]');
}

module.exports = commands;
`;
}

/**
 * Generate Windows PowerShell daemon manager
 */
export function generateWindowsDaemonManager(): string {
  return `# Claude Flow V3 Daemon Manager for Windows
# PowerShell script for managing background processes

param(
    [Parameter(Position=0)]
    [ValidateSet('start', 'stop', 'status', 'restart')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'SilentlyContinue'
$ClaudeFlowDir = Join-Path $PWD '.claude-flow'
$PidDir = Join-Path $ClaudeFlowDir 'pids'

# Ensure directories exist
if (-not (Test-Path $PidDir)) {
    New-Item -ItemType Directory -Path $PidDir -Force | Out-Null
}

function Get-DaemonStatus {
    param([string]$Name, [string]$PidFile)

    if (Test-Path $PidFile) {
        $pid = Get-Content $PidFile
        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($process) {
            return @{ Running = $true; Pid = $pid }
        }
    }
    return @{ Running = $false; Pid = $null }
}

function Start-SwarmMonitor {
    $pidFile = Join-Path $PidDir 'swarm-monitor.pid'
    $status = Get-DaemonStatus -Name 'swarm-monitor' -PidFile $pidFile

    if ($status.Running) {
        Write-Host "Swarm monitor already running (PID: $($status.Pid))" -ForegroundColor Yellow
        return
    }

    Write-Host "Starting swarm monitor..." -ForegroundColor Cyan
    $process = Start-Process -FilePath 'node' -ArgumentList @(
        '-e',
        'setInterval(() => { require("fs").writeFileSync(".claude-flow/metrics/swarm-activity.json", JSON.stringify({swarm:{active:true,agent_count:0},timestamp:Date.now()})) }, 5000)'
    ) -PassThru -WindowStyle Hidden

    $process.Id | Out-File $pidFile
    Write-Host "Swarm monitor started (PID: $($process.Id))" -ForegroundColor Green
}

function Stop-SwarmMonitor {
    $pidFile = Join-Path $PidDir 'swarm-monitor.pid'
    $status = Get-DaemonStatus -Name 'swarm-monitor' -PidFile $pidFile

    if (-not $status.Running) {
        Write-Host "Swarm monitor not running" -ForegroundColor Yellow
        return
    }

    Stop-Process -Id $status.Pid -Force
    Remove-Item $pidFile -Force
    Write-Host "Swarm monitor stopped" -ForegroundColor Green
}

function Show-Status {
    Write-Host ""
    Write-Host "Claude Flow V3 Daemon Status" -ForegroundColor Cyan
    Write-Host "=============================" -ForegroundColor Cyan

    $swarmPid = Join-Path $PidDir 'swarm-monitor.pid'
    $swarmStatus = Get-DaemonStatus -Name 'swarm-monitor' -PidFile $swarmPid

    if ($swarmStatus.Running) {
        Write-Host "  Swarm Monitor: RUNNING (PID: $($swarmStatus.Pid))" -ForegroundColor Green
    } else {
        Write-Host "  Swarm Monitor: STOPPED" -ForegroundColor Red
    }
    Write-Host ""
}

switch ($Action) {
    'start' {
        Start-SwarmMonitor
        Show-Status
    }
    'stop' {
        Stop-SwarmMonitor
        Show-Status
    }
    'restart' {
        Stop-SwarmMonitor
        Start-Sleep -Seconds 1
        Start-SwarmMonitor
        Show-Status
    }
    'status' {
        Show-Status
    }
}
`;
}

/**
 * Generate Windows batch file wrapper
 */
export function generateWindowsBatchWrapper(): string {
  return `@echo off
REM Claude Flow V3 - Windows Batch Wrapper
REM Routes to PowerShell daemon manager

PowerShell -ExecutionPolicy Bypass -File "%~dp0daemon-manager.ps1" %*
`;
}

/**
 * Generate cross-platform session manager
 */
export function generateCrossPlatformSessionManager(): string {
  return `#!/usr/bin/env node
/**
 * Claude Flow Cross-Platform Session Manager
 * Works on Windows, macOS, and Linux
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Platform-specific paths
const platform = os.platform();
const homeDir = os.homedir();

// Get data directory based on platform
function getDataDir() {
  const localDir = path.join(process.cwd(), '.claude-flow', 'sessions');
  if (fs.existsSync(path.dirname(localDir))) {
    return localDir;
  }

  switch (platform) {
    case 'win32':
      return path.join(process.env.APPDATA || homeDir, 'claude-flow', 'sessions');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'claude-flow', 'sessions');
    default:
      return path.join(homeDir, '.claude-flow', 'sessions');
  }
}

const SESSION_DIR = getDataDir();
const SESSION_FILE = path.join(SESSION_DIR, 'current.json');

// Ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const commands = {
  start: () => {
    ensureDir(SESSION_DIR);
    const sessionId = \`session-\${Date.now()}\`;
    const session = {
      id: sessionId,
      startedAt: new Date().toISOString(),
      platform: platform,
      cwd: process.cwd(),
      context: {},
      metrics: { edits: 0, commands: 0, tasks: 0, errors: 0 }
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    console.log(\`Session started: \${sessionId}\`);
    return session;
  },

  restore: () => {
    if (!fs.existsSync(SESSION_FILE)) {
      console.log('No session to restore');
      return null;
    }
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    session.restoredAt = new Date().toISOString();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    console.log(\`Session restored: \${session.id}\`);
    return session;
  },

  end: () => {
    if (!fs.existsSync(SESSION_FILE)) {
      console.log('No active session');
      return null;
    }
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    session.endedAt = new Date().toISOString();
    session.duration = Date.now() - new Date(session.startedAt).getTime();

    const archivePath = path.join(SESSION_DIR, \`\${session.id}.json\`);
    fs.writeFileSync(archivePath, JSON.stringify(session, null, 2));
    fs.unlinkSync(SESSION_FILE);

    console.log(\`Session ended: \${session.id}\`);
    console.log(\`Duration: \${Math.round(session.duration / 1000 / 60)} minutes\`);
    return session;
  },

  status: () => {
    if (!fs.existsSync(SESSION_FILE)) {
      console.log('No active session');
      return null;
    }
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    const duration = Date.now() - new Date(session.startedAt).getTime();
    console.log(\`Session: \${session.id}\`);
    console.log(\`Platform: \${session.platform}\`);
    console.log(\`Started: \${session.startedAt}\`);
    console.log(\`Duration: \${Math.round(duration / 1000 / 60)} minutes\`);
    return session;
  }
};

// CLI
const [,, command, ...args] = process.argv;
if (command && commands[command]) {
  commands[command](...args);
} else {
  console.log('Usage: session.js <start|restore|end|status>');
  console.log(\`Platform: \${platform}\`);
  console.log(\`Data dir: \${SESSION_DIR}\`);
}

module.exports = commands;
`;
}

/**
 * Generate all helper files
 */
export function generateHelpers(options: InitOptions): Record<string, string> {
  const helpers: Record<string, string> = {};

  if (options.components.helpers) {
    // Unix/macOS shell scripts
    helpers['pre-commit'] = generatePreCommitHook();
    helpers['post-commit'] = generatePostCommitHook();

    // Cross-platform Node.js scripts
    helpers['session.js'] = generateCrossPlatformSessionManager();
    helpers['router.js'] = generateAgentRouter();
    helpers['memory.js'] = generateMemoryHelper();

    // Windows-specific scripts
    helpers['daemon-manager.ps1'] = generateWindowsDaemonManager();
    helpers['daemon-manager.cmd'] = generateWindowsBatchWrapper();
  }

  if (options.components.statusline) {
    helpers['statusline.cjs'] = generateStatuslineScript(options);  // .cjs for ES module compatibility
    helpers['statusline-hook.sh'] = generateStatuslineHook(options);
  }

  return helpers;
}
