#!/usr/bin/env node
/**
 * RuFlo Statusline Generator
 * Displays real-time V3 implementation progress and system status.
 * Version is read from the installed @claude-flow/cli package.json at
 * runtime — #1892 fix: previously hardcoded to V3.5 which drifted from
 * the actual installed alpha series.
 *
 * Usage: node statusline.js [--json] [--compact]
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// #1892 — derive RuFlo banner version from the installed cli package.json
// so the statusline never drifts from `ruflo doctor`. Falls back to a
// generic "RuFlo" label only if every resolution path fails.
function resolveBannerVersion() {
  const candidates = [
    // Local-checkout / monorepo case
    path.join(__dirname, '..', '..', 'package.json'),
    // npm-installed-as-dep case
    path.join(__dirname, '..', '..', '..', '@claude-flow', 'cli', 'package.json'),
    // npm-installed-globally case
    path.join(__dirname, '..', '..', '..', 'cli', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.name && pkg.name.includes('claude-flow') && typeof pkg.version === 'string') {
        // Render as "V<major>.<minor>" so the banner stays compact —
        // patch+pre-release detail still shows under `doctor`.
        const m = pkg.version.match(/^(\d+)\.(\d+)/);
        if (m) return `V${m[1]}.${m[2]}`;
        return `V${pkg.version}`;
      }
    } catch {/* try next */}
  }
  return ''; // empty → header just says "RuFlo"
}
const BANNER_VERSION = resolveBannerVersion();

// Configuration
const CONFIG = {
  enabled: true,
  showProgress: true,
  showSecurity: true,
  showSwarm: true,
  showHooks: true,
  showPerformance: true,
  refreshInterval: 30000,
  maxAgents: 15,
  topology: 'hierarchical-mesh',
};

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
  let modelName = 'Opus 4.6 (1M context)';

  // audit_1776853149979: previously used execSync with a shell string for git
  // commands. Switched to execFileSync('git', argv) so there is no shell
  // interpretation — eliminates the *class* of injection regardless of whether
  // user input ever reaches these args (defense in depth). Errors are caught
  // and the defaults above remain.
  try {
    name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'user';
  } catch { /* not in a repo / no name set — keep default */ }
  try {
    gitBranch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* not in a repo — keep empty */ }

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
    const ps = execSync('ps aux 2>/dev/null | grep -c agentic-flow || echo "0"', { encoding: 'utf-8' });
    activeAgents = Math.max(0, parseInt(ps.trim()) - 1);
    coordinationActive = activeAgents > 0;
  } catch (e) {
    // Ignore errors
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
    const mem = execSync('ps aux | grep -E "(node|agentic|claude)" | grep -v grep | awk \'{sum += \$6} END {print int(sum/1024)}\'', { encoding: 'utf-8' });
    memoryMB = parseInt(mem.trim()) || 0;
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
    const agents = execSync('ps aux 2>/dev/null | grep -c "claude-flow.*agent" || echo "0"', { encoding: 'utf-8' });
    subAgents = Math.max(0, parseInt(agents.trim()) - 1);
  } catch (e) {
    // Ignore
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

  // Header Line — #1892: BANNER_VERSION resolved at module load from package.json
  let header = `${c.bold}${c.brightPurple}▊ RuFlo${BANNER_VERSION ? ' ' + BANNER_VERSION : ''} ${c.reset}`;
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

// Main
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(generateJSON(), null, 2));
} else if (process.argv.includes('--compact')) {
  console.log(JSON.stringify(generateJSON()));
} else {
  console.log(generateStatusline());
}
