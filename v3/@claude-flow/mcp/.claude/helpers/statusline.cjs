#!/usr/bin/env node
/**
 * Claude Flow V3 Statusline Generator
 * Displays real-time V3 implementation progress and system status
 *
 * Usage: node statusline.cjs [options]
 *
 * Options:
 *   (default)   Safe multi-line output with collision zone avoidance
 *   --single    Single-line output (completely avoids collision)
 *   --unsafe    Legacy multi-line without collision avoidance
 *   --legacy    Alias for --unsafe
 *   --json      JSON output with pretty printing
 *   --compact   JSON output without formatting
 *
 * Collision Zone Fix (Issue #985):
 * Claude Code writes its internal status (e.g., "7s • 1p") at absolute
 * terminal coordinates (columns 15-25 on second-to-last line). The safe
 * mode pads the collision line with spaces to push content past column 25.
 *
 * IMPORTANT: This file uses .cjs extension to work in ES module projects.
 * The require() syntax is intentional for CommonJS compatibility.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  enabled: true,
  showProgress: true,
  showSecurity: true,
  showSwarm: true,
  showHooks: true,
  showPerformance: true,
  refreshInterval: 5000,
  maxAgents: 15,
  topology: 'hierarchical-mesh',
};

// Cross-platform helpers
const isWindows = process.platform === 'win32';
const nullDevice = isWindows ? 'NUL' : '/dev/null';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[0;33m',
  blue: '\x1b[0;34m',
  purple: '\x1b[0;35m',
  cyan: '\x1b[0;36m',
  brightRed: '\x1b[1;31m',
  brightGreen: '\x1b[1;32m',
  brightYellow: '\x1b[1;33m',
  brightBlue: '\x1b[1;34m',
  brightPurple: '\x1b[1;35m',
  brightCyan: '\x1b[1;36m',
  brightWhite: '\x1b[1;37m',
};

// Get user info
function getUserInfo() {
  let name = 'user';
  let gitBranch = '';
  let modelName = 'Unknown';

  try {
    const gitUserCmd = isWindows
      ? 'git config user.name 2>NUL || echo user'
      : 'git config user.name 2>/dev/null || echo "user"';
    const gitBranchCmd = isWindows
      ? 'git branch --show-current 2>NUL || echo.'
      : 'git branch --show-current 2>/dev/null || echo ""';
    name = execSync(gitUserCmd, { encoding: 'utf-8' }).trim();
    gitBranch = execSync(gitBranchCmd, { encoding: 'utf-8' }).trim();
    if (gitBranch === '.') gitBranch = ''; // Windows echo. outputs a dot
  } catch (e) {
    // Ignore errors
  }

  // Auto-detect model from Claude Code's config
  try {
    const homedir = require('os').homedir();
    const claudeConfigPath = path.join(homedir, '.claude.json');
    if (fs.existsSync(claudeConfigPath)) {
      const claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      // Try to find lastModelUsage - check current dir and parent dirs
      let lastModelUsage = null;
      const cwd = process.cwd();
      if (claudeConfig.projects) {
        // Try exact match first, then check if cwd starts with any project path
        for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
          if (cwd === projectPath || cwd.startsWith(projectPath + '/')) {
            lastModelUsage = projectConfig.lastModelUsage;
            break;
          }
        }
      }
      if (lastModelUsage) {
        const modelIds = Object.keys(lastModelUsage);
        if (modelIds.length > 0) {
          // Take the last model (most recently added to the object)
          // Or find the one with most tokens (most actively used this session)
          let modelId = modelIds[modelIds.length - 1];
          if (modelIds.length > 1) {
            // If multiple models, pick the one with most total tokens
            let maxTokens = 0;
            for (const id of modelIds) {
              const usage = lastModelUsage[id];
              const total = (usage.inputTokens || 0) + (usage.outputTokens || 0);
              if (total > maxTokens) {
                maxTokens = total;
                modelId = id;
              }
            }
          }
          // Parse model ID to human-readable name
          if (modelId.includes('opus')) modelName = 'Opus 4.5';
          else if (modelId.includes('sonnet')) modelName = 'Sonnet 4';
          else if (modelId.includes('haiku')) modelName = 'Haiku 4.5';
          else modelName = modelId.split('-').slice(1, 3).join(' ');
        }
      }
    }
  } catch (e) {
    // Fallback to Unknown if can't read config
  }

  return { name, gitBranch, modelName };
}

// Get learning stats from memory database
function getLearningStats() {
  const memoryPaths = [
    path.join(process.cwd(), '.swarm', 'memory.db'),
    path.join(process.cwd(), '.claude', 'memory.db'),
    path.join(process.cwd(), 'data', 'memory.db'),
  ];

  let patterns = 0;
  let sessions = 0;
  let trajectories = 0;

  // Try to read from sqlite database
  for (const dbPath of memoryPaths) {
    if (fs.existsSync(dbPath)) {
      try {
        // Count entries in memory file (rough estimate from file size)
        const stats = fs.statSync(dbPath);
        const sizeKB = stats.size / 1024;
        // Estimate: ~2KB per pattern on average
        patterns = Math.floor(sizeKB / 2);
        sessions = Math.max(1, Math.floor(patterns / 10));
        trajectories = Math.floor(patterns / 5);
        break;
      } catch (e) {
        // Ignore
      }
    }
  }

  // Also check for session files
  const sessionsPath = path.join(process.cwd(), '.claude', 'sessions');
  if (fs.existsSync(sessionsPath)) {
    try {
      const sessionFiles = fs.readdirSync(sessionsPath).filter(f => f.endsWith('.json'));
      sessions = Math.max(sessions, sessionFiles.length);
    } catch (e) {
      // Ignore
    }
  }

  return { patterns, sessions, trajectories };
}

// Get V3 progress from learning state (grows as system learns)
function getV3Progress() {
  const learning = getLearningStats();

  // DDD progress based on actual learned patterns
  // New install: 0 patterns = 0/5 domains, 0% DDD
  // As patterns grow: 10+ patterns = 1 domain, 50+ = 2, 100+ = 3, 200+ = 4, 500+ = 5
  let domainsCompleted = 0;
  if (learning.patterns >= 500) domainsCompleted = 5;
  else if (learning.patterns >= 200) domainsCompleted = 4;
  else if (learning.patterns >= 100) domainsCompleted = 3;
  else if (learning.patterns >= 50) domainsCompleted = 2;
  else if (learning.patterns >= 10) domainsCompleted = 1;

  const totalDomains = 5;
  const dddProgress = Math.min(100, Math.floor((domainsCompleted / totalDomains) * 100));

  return {
    domainsCompleted,
    totalDomains,
    dddProgress,
    patternsLearned: learning.patterns,
    sessionsCompleted: learning.sessions
  };
}

// Get security status based on actual scans
function getSecurityStatus() {
  // ponytail: read the NEWEST scan in .claude/security-scans/ and surface its
  // real findings count. Previously hardcoded totalCves=3 and counted scan
  // *files* as "CVEs fixed", fabricating "⚠ 3 CVEs" for every project.
  const scanResultsPath = path.join(process.cwd(), '.claude', 'security-scans');
  if (!fs.existsSync(scanResultsPath)) return { status: 'PENDING', findings: 0, cvesFixed: 0, totalCves: 0 };
  try {
    const files = fs.readdirSync(scanResultsPath).filter(f => f.endsWith('.json'));
    if (files.length === 0) return { status: 'PENDING', findings: 0, cvesFixed: 0, totalCves: 0 };
    let newest = files[0];
    let newestMtime = -1;
    for (const f of files) {
      const st = fs.statSync(path.join(scanResultsPath, f));
      if (st.mtimeMs > newestMtime) { newestMtime = st.mtimeMs; newest = f; }
    }
    const scan = JSON.parse(fs.readFileSync(path.join(scanResultsPath, newest), 'utf-8'));
    const findings = Math.max(0, scan.summary?.total ?? scan.totalFindings ?? scan.findings?.length ?? 0);
    const status = findings > 0 ? 'ISSUES' : 'CLEAN';
    return { status, findings, scannedAt: scan.timestamp, cvesFixed: 0, totalCves: 0 };
  } catch (e) {
    return { status: 'PENDING', findings: 0, cvesFixed: 0, totalCves: 0 };
  }
}

// Get swarm status
function getSwarmStatus() {
  let activeAgents = 0;
  let coordinationActive = false;

  try {
    if (isWindows) {
      // Windows: use tasklist and findstr
      const ps = execSync('tasklist 2>NUL | findstr /I "agentic-flow" 2>NUL | find /C /V "" 2>NUL || echo 0', { encoding: 'utf-8' });
      activeAgents = Math.max(0, parseInt(ps.trim()) || 0);
    } else {
      const ps = execSync('ps aux 2>/dev/null | grep -c agentic-flow || echo "0"', { encoding: 'utf-8' });
      activeAgents = Math.max(0, parseInt(ps.trim()) - 1);
    }
    coordinationActive = activeAgents > 0;
  } catch (e) {
    // Ignore errors - default to 0 agents
  }

  return {
    activeAgents,
    maxAgents: CONFIG.maxAgents,
    coordinationActive,
  };
}

// Get system metrics (dynamic based on actual state)
function getSystemMetrics() {
  let memoryMB = 0;
  let subAgents = 0;

  try {
    if (isWindows) {
      // Windows: use tasklist for memory info, fallback to process.memoryUsage
      // tasklist memory column is complex to parse, use Node.js API instead
      memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
    } else {
      const mem = execSync('ps aux | grep -E "(node|agentic|claude)" | grep -v grep | awk \'{sum += $6} END {print int(sum/1024)}\'', { encoding: 'utf-8' });
      memoryMB = parseInt(mem.trim()) || 0;
    }
  } catch (e) {
    // Fallback
    memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  }

  // Get learning stats for intelligence %
  const learning = getLearningStats();

  // Intelligence % based on learned patterns (0 patterns = 0%, 1000+ = 100%)
  const intelligencePct = Math.min(100, Math.floor((learning.patterns / 10) * 1));

  // Context % based on session history (0 sessions = 0%, grows with usage)
  const contextPct = Math.min(100, Math.floor(learning.sessions * 5));

  // Count active sub-agents from process list
  try {
    if (isWindows) {
      // Windows: use tasklist and findstr for agent counting
      const agents = execSync('tasklist 2>NUL | findstr /I "claude-flow" 2>NUL | find /C /V "" 2>NUL || echo 0', { encoding: 'utf-8' });
      subAgents = Math.max(0, parseInt(agents.trim()) || 0);
    } else {
      const agents = execSync('ps aux 2>/dev/null | grep -c "claude-flow.*agent" || echo "0"', { encoding: 'utf-8' });
      subAgents = Math.max(0, parseInt(agents.trim()) - 1);
    }
  } catch (e) {
    // Ignore - default to 0
  }

  return {
    memoryMB,
    contextPct,
    intelligencePct,
    subAgents,
  };
}

// Generate progress bar
function progressBar(current, total) {
  const width = 5;
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return '[' + '\u25CF'.repeat(filled) + '\u25CB'.repeat(empty) + ']';
}

// Generate full statusline
function generateStatusline() {
  const user = getUserInfo();
  const progress = getV3Progress();
  const security = getSecurityStatus();
  const swarm = getSwarmStatus();
  const system = getSystemMetrics();
  const lines = [];

  // Header Line
  let header = `${c.bold}${c.brightPurple}▊ Claude Flow V3 ${c.reset}`;
  header += `${swarm.coordinationActive ? c.brightCyan : c.dim}● ${c.brightCyan}${user.name}${c.reset}`;
  if (user.gitBranch) {
    header += `  ${c.dim}│${c.reset}  ${c.brightBlue}⎇ ${user.gitBranch}${c.reset}`;
  }
  header += `  ${c.dim}│${c.reset}  ${c.purple}${user.modelName}${c.reset}`;
  lines.push(header);

  // Separator
  lines.push(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);

  // Line 1: DDD Domain Progress
  const domainsColor = progress.domainsCompleted >= 3 ? c.brightGreen : progress.domainsCompleted > 0 ? c.yellow : c.red;
  lines.push(
    `${c.brightCyan}🏗️  DDD Domains${c.reset}    ${progressBar(progress.domainsCompleted, progress.totalDomains)}  ` +
    `${domainsColor}${progress.domainsCompleted}${c.reset}/${c.brightWhite}${progress.totalDomains}${c.reset}    ` +
    `${c.brightYellow}⚡ 1.0x${c.reset} ${c.dim}→${c.reset} ${c.brightYellow}2.49x-7.47x${c.reset}`
  );

  // Line 2: Swarm + CVE + Memory + Context + Intelligence
  const swarmIndicator = swarm.coordinationActive ? `${c.brightGreen}◉${c.reset}` : `${c.dim}○${c.reset}`;
  const agentsColor = swarm.activeAgents > 0 ? c.brightGreen : c.red;
  let securityIcon = security.status === 'CLEAN' ? '🟢' : security.status === 'IN_PROGRESS' ? '🟡' : '🔴';
  let securityColor = security.status === 'CLEAN' ? c.brightGreen : security.status === 'IN_PROGRESS' ? c.brightYellow : c.brightRed;

  lines.push(
    `${c.brightYellow}🤖 Swarm${c.reset}  ${swarmIndicator} [${agentsColor}${String(swarm.activeAgents).padStart(2)}${c.reset}/${c.brightWhite}${swarm.maxAgents}${c.reset}]  ` +
    `${c.brightPurple}👥 ${system.subAgents}${c.reset}    ` +
    `${securityIcon} ${securityColor}Findings ${security.findings || 0}${c.reset}    ` +
    `${c.brightCyan}💾 ${system.memoryMB}MB${c.reset}    ` +
    `${c.brightGreen}📂 ${String(system.contextPct).padStart(3)}%${c.reset}    ` +
    `${c.dim}🧠 ${String(system.intelligencePct).padStart(3)}%${c.reset}`
  );

  // Line 3: Architecture status
  const dddColor = progress.dddProgress >= 50 ? c.brightGreen : progress.dddProgress > 0 ? c.yellow : c.red;
  lines.push(
    `${c.brightPurple}🔧 Architecture${c.reset}    ` +
    `${c.cyan}DDD${c.reset} ${dddColor}●${String(progress.dddProgress).padStart(3)}%${c.reset}  ${c.dim}│${c.reset}  ` +
    `${c.cyan}Security${c.reset} ${securityColor}●${security.status}${c.reset}  ${c.dim}│${c.reset}  ` +
    `${c.cyan}Memory${c.reset} ${c.brightGreen}●AgentDB${c.reset}  ${c.dim}│${c.reset}  ` +
    `${c.cyan}Integration${c.reset} ${swarm.coordinationActive ? c.brightCyan : c.dim}●${c.reset}`
  );

  return lines.join('\n');
}

// Generate JSON data
function generateJSON() {
  return {
    user: getUserInfo(),
    v3Progress: getV3Progress(),
    security: getSecurityStatus(),
    swarm: getSwarmStatus(),
    system: getSystemMetrics(),
    performance: {
      flashAttentionTarget: '2.49x-7.47x',
      searchImprovement: '150x-12,500x',
      memoryReduction: '50-75%',
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Generate single-line output for Claude Code compatibility
 * This avoids the collision zone issue entirely by using one line
 * @see https://github.com/ruvnet/claude-flow/issues/985
 */
function generateSingleLine() {
  if (!CONFIG.enabled) return '';

  const user = getUserInfo();
  const progress = getV3Progress();
  const security = getSecurityStatus();
  const swarm = getSwarmStatus();
  const system = getSystemMetrics();

  const swarmIndicator = swarm.coordinationActive ? '●' : '○';
  const securityStatus = security.status === 'CLEAN' ? '✓' :
                         security.cvesFixed > 0 ? '~' : '✗';

  return `${c.brightPurple}CF-V3${c.reset} ${c.dim}|${c.reset} ` +
    `${c.cyan}D:${progress.domainsCompleted}/${progress.totalDomains}${c.reset} ${c.dim}|${c.reset} ` +
    `${c.yellow}S:${swarmIndicator}${swarm.activeAgents}/${swarm.maxAgents}${c.reset} ${c.dim}|${c.reset} ` +
    `${security.status === 'CLEAN' ? c.green : c.red}Findings:${security.findings || 0}${c.reset} ${c.dim}|${c.reset} ` +
    `${c.dim}🧠${system.intelligencePct}%${c.reset}`;
}

/**
 * Generate safe multi-line statusline that avoids Claude Code collision zone
 * The collision zone is columns 15-25 on the second-to-last line.
 * We pad that line with spaces to push content past column 25.
 * @see https://github.com/ruvnet/claude-flow/issues/985
 */
function generateSafeStatusline() {
  if (!CONFIG.enabled) return '';

  const user = getUserInfo();
  const progress = getV3Progress();
  const security = getSecurityStatus();
  const swarm = getSwarmStatus();
  const system = getSystemMetrics();
  const lines = [];

  // Header Line
  let header = `${c.bold}${c.brightPurple}▊ Claude Flow V3 ${c.reset}`;
  header += `${swarm.coordinationActive ? c.brightCyan : c.dim}● ${c.brightCyan}${user.name}${c.reset}`;
  if (user.gitBranch) {
    header += `  ${c.dim}│${c.reset}  ${c.brightBlue}⎇ ${user.gitBranch}${c.reset}`;
  }
  header += `  ${c.dim}│${c.reset}  ${c.purple}${user.modelName}${c.reset}`;
  lines.push(header);

  // Separator
  lines.push(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);

  // Line 1: DDD Domain Progress
  const domainsColor = progress.domainsCompleted >= 3 ? c.brightGreen : progress.domainsCompleted > 0 ? c.yellow : c.red;
  lines.push(
    `${c.brightCyan}🏗️  DDD Domains${c.reset}    ${progressBar(progress.domainsCompleted, progress.totalDomains)}  ` +
    `${domainsColor}${progress.domainsCompleted}${c.reset}/${c.brightWhite}${progress.totalDomains}${c.reset}    ` +
    `${c.brightYellow}⚡ 1.0x${c.reset} ${c.dim}→${c.reset} ${c.brightYellow}2.49x-7.47x${c.reset}`
  );

  // Line 2 (COLLISION LINE): Swarm status with 24 spaces padding after emoji
  // The emoji (🤖) is 2 columns. 24 spaces pushes content to column 26, past the collision zone (15-25)
  const swarmIndicator = swarm.coordinationActive ? `${c.brightGreen}◉${c.reset}` : `${c.dim}○${c.reset}`;
  const agentsColor = swarm.activeAgents > 0 ? c.brightGreen : c.red;
  let securityIcon = security.status === 'CLEAN' ? '🟢' : security.status === 'IN_PROGRESS' ? '🟡' : '🔴';
  let securityColor = security.status === 'CLEAN' ? c.brightGreen : security.status === 'IN_PROGRESS' ? c.brightYellow : c.brightRed;

  // CRITICAL: 24 spaces after 🤖 (emoji is 2 cols, so 2+24=26, past collision zone cols 15-25)
  lines.push(
    `${c.brightYellow}🤖${c.reset}                        ` +  // 24 spaces padding
    `${swarmIndicator} [${agentsColor}${String(swarm.activeAgents).padStart(2)}${c.reset}/${c.brightWhite}${swarm.maxAgents}${c.reset}]  ` +
    `${c.brightPurple}👥 ${system.subAgents}${c.reset}  ` +
    `${securityIcon} ${securityColor}Findings ${security.findings || 0}${c.reset}  ` +
    `${c.brightCyan}💾 ${system.memoryMB}MB${c.reset}  ` +
    `${c.dim}🧠 ${system.intelligencePct}%${c.reset}`
  );

  // Line 3: Architecture status (this is the last line, not in collision zone)
  const dddColor = progress.dddProgress >= 50 ? c.brightGreen : progress.dddProgress > 0 ? c.yellow : c.red;
  lines.push(
    `${c.brightPurple}🔧 Architecture${c.reset}    ` +
    `${c.cyan}DDD${c.reset} ${dddColor}●${String(progress.dddProgress).padStart(3)}%${c.reset}  ${c.dim}│${c.reset}  ` +
    `${c.cyan}Security${c.reset} ${securityColor}●${security.status}${c.reset}  ${c.dim}│${c.reset}  ` +
    `${c.cyan}Memory${c.reset} ${c.brightGreen}●AgentDB${c.reset}  ${c.dim}│${c.reset}  ` +
    `${c.cyan}Integration${c.reset} ${swarm.coordinationActive ? c.brightCyan : c.dim}●${c.reset}`
  );

  return lines.join('\n');
}

// Main
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(generateJSON(), null, 2));
} else if (process.argv.includes('--compact')) {
  console.log(JSON.stringify(generateJSON()));
} else if (process.argv.includes('--single')) {
  // Single-line mode - completely avoids collision zone
  console.log(generateSingleLine());
} else if (process.argv.includes('--unsafe') || process.argv.includes('--legacy')) {
  // Legacy mode - original multi-line without collision avoidance
  console.log(generateStatusline());
} else {
  // Default: Safe multi-line mode with collision zone avoidance
  // Use --unsafe or --legacy to get the original behavior
  console.log(generateSafeStatusline());
}
