/**
 * Local, synchronous, $0 structural signals shared by the statusline
 * (commands/hooks.ts's statuslineCommand) and the advisor-tip refresh
 * (funnel/advisor-tip.ts, ADR-316) — a single source of truth so the two
 * call sites can never silently drift on what "security status" or "swarm
 * status" means. Every function here is cheap, bounded, and never throws —
 * matching the statusline's own "never allowed to break the render"
 * discipline.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface SecurityStatus {
  status: 'CLEAN' | 'IN_PROGRESS' | 'PENDING';
  cvesFixed: number;
  totalCves: number;
}

export function getSecurityStatus(cwd: string = process.cwd()): SecurityStatus {
  // ponytail: read the NEWEST scan in .claude/security-scans/ and surface its
  // real findings count. Previously this hardcoded totalCves=3 and counted
  // scan *files* as "CVEs fixed", fabricating "⚠ 3 CVEs" for every project.
  // cvesFixed stays 0 — no mechanism tracks actual fixes yet.
  const scanResultsPath = path.join(cwd, '.claude', 'security-scans');
  if (!fs.existsSync(scanResultsPath)) return { status: 'PENDING', cvesFixed: 0, totalCves: 0 };
  try {
    const files = fs.readdirSync(scanResultsPath).filter((f: string) => f.endsWith('.json'));
    if (files.length === 0) return { status: 'PENDING', cvesFixed: 0, totalCves: 0 };
    let newest = files[0];
    let newestMtime = -1;
    for (const f of files) {
      const st = fs.statSync(path.join(scanResultsPath, f));
      if (st.mtimeMs > newestMtime) { newestMtime = st.mtimeMs; newest = f; }
    }
    const scan = JSON.parse(fs.readFileSync(path.join(scanResultsPath, newest), 'utf-8'));
    const totalCves: number =
      scan.summary?.total ?? scan.totalFindings ?? scan.findings?.length ?? 0;
    const status: SecurityStatus['status'] = totalCves > 0 ? 'IN_PROGRESS' : 'CLEAN';
    return { status, cvesFixed: 0, totalCves };
  } catch {
    return { status: 'PENDING', cvesFixed: 0, totalCves: 0 };
  }
}

export interface SwarmStatus {
  activeAgents: number;
  maxAgents: number;
  coordinationActive: boolean;
}

export function getSwarmStatus(): SwarmStatus {
  let activeAgents = 0;
  let coordinationActive = false;
  const maxAgents = 15;
  const isWindows = process.platform === 'win32';

  try {
    const psCmd = isWindows
      ? 'tasklist /FI "IMAGENAME eq node.exe" /NH 2>NUL | find /c /v "" 2>NUL || echo 0'
      : 'ps aux 2>/dev/null | grep -c agentic-flow || echo "0"';
    const ps = execSync(psCmd, { encoding: 'utf-8', timeout: 3000 });
    activeAgents = Math.max(0, parseInt(ps.trim()) - 1);
    coordinationActive = activeAgents > 0;
  } catch {
    // ps/tasklist unavailable or timed out — report zero
  }

  return { activeAgents, maxAgents, coordinationActive };
}

/** Count of uncommitted-changed files (git status --short line count). */
export function getGitUncommittedCount(): number | undefined {
  try {
    const out = execSync('git status --porcelain 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    return lines.length;
  } catch {
    return undefined;
  }
}
