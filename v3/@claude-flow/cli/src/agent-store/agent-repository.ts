import { existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from '../mcp-tools/types.js';

export type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'opus-4.7' | 'inherit';

export interface AgentRecord {
  agentId: string;
  agentType: string;
  status: 'idle' | 'busy' | 'terminated';
  health: number;
  taskCount: number;
  config: Record<string, unknown>;
  createdAt: string;
  domain?: string;
  model?: ClaudeModel;
  modelRoutedBy?: 'explicit' | 'router' | 'codemod' | 'default' | 'hybrid';
  modelId?: string;
  provider?: 'anthropic' | 'openrouter';
  openrouterModel?: string;
  lastResult?: Record<string, unknown>;
  activeTaskCount?: number;
}

export interface AgentStore {
  agents: Record<string, AgentRecord>;
  version: string;
}

const STORAGE_DIR = '.claude-flow';
const AGENT_DIR = 'agents';
const AGENT_FILE = 'store.json';
const LOCK_FILE = '.lock';
const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_MS = 30000;
const LOCK_RETRY_INTERVAL = 50;

function getProjectRoot(): string {
  return getProjectCwd();
}

function getAgentDir(): string {
  return join(getProjectRoot(), STORAGE_DIR, AGENT_DIR);
}

function getAgentPath(): string {
  return join(getAgentDir(), AGENT_FILE);
}

function getLockPath(): string {
  return join(getAgentDir(), LOCK_FILE);
}

function ensureDir(): void {
  const dir = getAgentDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function acquireLock(): void {
  ensureDir();
  const lockPath = getLockPath();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(lockPath, String(process.pid), { mode: 0o600 });
      fd as unknown as number;
      return;
    } catch {
      const elapsed = Date.now() - deadline + LOCK_TIMEOUT_MS;
      if (elapsed > STALE_LOCK_MS) {
        try {
          const stats = existsSync(lockPath);
          if (stats) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {
        }
      }
    }
  }
  throw new Error('Failed to acquire agent store lock after 5s');
}

function releaseLock(): void {
  try {
    const lockPath = getLockPath();
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch {
  }
}

export class AgentRepository {
  loadStore(): AgentStore {
    try {
      const path = getAgentPath();
      if (existsSync(path)) {
        const data = readFileSync(path, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
    }
    return { agents: {}, version: '3.0.0' };
  }

  saveStore(store: AgentStore): void {
    ensureDir();
    const targetPath = getAgentPath();
    const tmpPath = join(getAgentDir(), `${AGENT_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}`);
    try {
      writeFileSync(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600, encoding: 'utf-8' });
      renameSync(tmpPath, targetPath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }

  withLock<T>(fn: () => T): T {
    acquireLock();
    try {
      return fn();
    } finally {
      releaseLock();
    }
  }

  getAgent(agentId: string): AgentRecord | undefined {
    return this.loadStore().agents[agentId];
  }

  getAllActiveAgents(): AgentRecord[] {
    const store = this.loadStore();
    return Object.values(store.agents).filter(a => a.status !== 'terminated');
  }

  updateAgent(agentId: string, partial: Partial<AgentRecord>): boolean {
    return this.withLock(() => {
      const store = this.loadStore();
      if (!store.agents[agentId]) return false;
      store.agents[agentId] = { ...store.agents[agentId], ...partial };
      this.saveStore(store);
      return true;
    });
  }

  incrementActiveTask(agentId: string): void {
    this.withLock(() => {
      const store = this.loadStore();
      const agent = store.agents[agentId];
      if (!agent) return;
      agent.activeTaskCount = (agent.activeTaskCount || 0) + 1;
      agent.status = 'busy';
      this.saveStore(store);
    });
  }

  decrementActiveTask(agentId: string, result?: Record<string, unknown>): void {
    this.withLock(() => {
      const store = this.loadStore();
      const agent = store.agents[agentId];
      if (!agent) return;
      const wasTerminated = agent.status === 'terminated';
      agent.activeTaskCount = Math.max(0, (agent.activeTaskCount || 1) - 1);
      if (agent.activeTaskCount === 0 && !wasTerminated) {
        agent.status = 'idle';
      }
      if (result !== undefined) {
        agent.lastResult = result;
      }
      agent.taskCount = (agent.taskCount || 0) + 1;
      this.saveStore(store);
    });
  }

  terminateAgent(agentId: string): boolean {
    return this.updateAgent(agentId, { status: 'terminated' });
  }
}

export const agentRepository = new AgentRepository();
