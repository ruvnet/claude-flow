import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface WorktreeAssignment {
  agentId: string;
  branch: string;
  path: string;
  readOnly: boolean;
}

export interface WorktreeRunRecord {
  version: 1;
  runId: string;
  repoRoot: string;
  createdAt: number;
  assignments: WorktreeAssignment[];
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function assertId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`invalid ${label}: ${value}`);
}

export class CodexWorktreeCoordinator {
  readonly repoRoot: string;
  readonly registryDir: string;
  readonly worktreeBase: string;

  constructor(repoRoot: string) {
    this.repoRoot = resolve(repoRoot);
    const top = git(this.repoRoot, ['rev-parse', '--show-toplevel']);
    if (resolve(top) !== this.repoRoot) throw new Error(`repoRoot must be the git top-level: ${top}`);
    this.registryDir = join(this.repoRoot, '.claude-flow', 'swarm', 'worktrees');
    this.worktreeBase = join(dirname(this.repoRoot), '.ruflo-worktrees', basename(this.repoRoot));
  }

  prepare(
    runId: string,
    agents: Array<{ id: string; readOnly?: boolean }>,
    options: { allowDirty?: boolean; baseRef?: string } = {},
  ): WorktreeRunRecord {
    assertId(runId, 'run id');
    if (!agents.length) throw new Error('at least one agent is required');
    const unique = new Set<string>();
    for (const agent of agents) {
      assertId(agent.id, 'agent id');
      if (unique.has(agent.id)) throw new Error(`duplicate agent id: ${agent.id}`);
      unique.add(agent.id);
    }
    const registryPath = this.registryPath(runId);
    if (existsSync(registryPath)) return this.status(runId);
    if (!options.allowDirty && git(this.repoRoot, ['status', '--porcelain']).length > 0) {
      throw new Error('refusing to prepare writing worktrees from a dirty repository');
    }

    mkdirSync(this.registryDir, { recursive: true });
    mkdirSync(join(this.worktreeBase, runId), { recursive: true });
    const assignments: WorktreeAssignment[] = [];
    try {
      for (const agent of agents) {
        const readOnly = agent.readOnly === true;
        const branch = `ruflo/${runId}/${agent.id}`;
        const worktreePath = join(this.worktreeBase, runId, agent.id);
        if (readOnly) {
          git(this.repoRoot, ['worktree', 'add', '--detach', worktreePath, options.baseRef ?? 'HEAD']);
        } else {
          git(this.repoRoot, ['worktree', 'add', '-b', branch, worktreePath, options.baseRef ?? 'HEAD']);
        }
        assignments.push({ agentId: agent.id, branch: readOnly ? '' : branch, path: worktreePath, readOnly });
      }
      const record: WorktreeRunRecord = {
        version: 1,
        runId,
        repoRoot: this.repoRoot,
        createdAt: Date.now(),
        assignments,
      };
      this.writeRecord(registryPath, record);
      return record;
    } catch (error) {
      for (const assignment of assignments.reverse()) {
        try { git(this.repoRoot, ['worktree', 'remove', assignment.path]); } catch { /* retain work for recovery */ }
      }
      throw error;
    }
  }

  status(runId: string): WorktreeRunRecord {
    assertId(runId, 'run id');
    const file = this.registryPath(runId);
    if (!existsSync(file)) throw new Error(`unknown worktree run: ${runId}`);
    const record = JSON.parse(readFileSync(file, 'utf8')) as WorktreeRunRecord;
    if (record.version !== 1 || record.runId !== runId || resolve(record.repoRoot) !== this.repoRoot) {
      throw new Error('invalid worktree registry record');
    }
    const expectedPrefix = resolve(join(this.worktreeBase, runId));
    for (const assignment of record.assignments) {
      const actual = resolve(assignment.path);
      if (actual !== expectedPrefix && !actual.startsWith(`${expectedPrefix}/`)) {
        throw new Error(`registry path escapes owned worktree root: ${actual}`);
      }
    }
    return record;
  }

  integrate(runId: string, agentIds?: string[]): { merged: string[] } {
    const record = this.status(runId);
    const wanted = agentIds ? new Set(agentIds) : null;
    const merged: string[] = [];
    for (const assignment of record.assignments) {
      if (assignment.readOnly || (wanted && !wanted.has(assignment.agentId))) continue;
      git(this.repoRoot, ['merge', '--no-ff', '--no-edit', assignment.branch]);
      merged.push(assignment.agentId);
    }
    return { merged };
  }

  cleanup(runId: string): { removed: string[]; retained: string[] } {
    const record = this.status(runId);
    const removed: string[] = [];
    const retained: string[] = [];
    for (const assignment of record.assignments) {
      try {
        git(this.repoRoot, ['worktree', 'remove', assignment.path]);
        removed.push(assignment.agentId);
      } catch {
        retained.push(assignment.agentId);
      }
    }
    if (retained.length === 0) unlinkSync(this.registryPath(runId));
    return { removed, retained };
  }

  private registryPath(runId: string): string {
    return join(this.registryDir, `${runId}.json`);
  }

  private writeRecord(file: string, record: WorktreeRunRecord): void {
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  }
}
