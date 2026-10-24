/**
 * Session MCP Tools for CLI
 *
 * Tool definitions for session management with file persistence.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MCPTool } from './types.js';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const SESSION_DIR = 'sessions';

interface SessionRecord {
  sessionId: string;
  name: string;
  description?: string;
  savedAt: string;
  stats: {
    tasks: number;
    agents: number;
    memoryEntries: number;
    totalSize: number;
  };
  data?: {
    memory?: Record<string, unknown>;
    tasks?: Record<string, unknown>;
    agents?: Record<string, unknown>;
  };
}

function getSessionDir(): string {
  return join(process.cwd(), STORAGE_DIR, SESSION_DIR);
}

function getSessionPath(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(getSessionDir(), `${safeId}.json`);
}

function ensureSessionDir(): void {
  const dir = getSessionDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadSession(sessionId: string): SessionRecord | null {
  try {
    const path = getSessionPath(sessionId);
    if (existsSync(path)) {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return null on error
  }
  return null;
}

function saveSession(session: SessionRecord): void {
  ensureSessionDir();
  writeFileSync(getSessionPath(session.sessionId), JSON.stringify(session, null, 2), 'utf-8');
}

function listSessions(): SessionRecord[] {
  ensureSessionDir();
  const dir = getSessionDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));

  const sessions: SessionRecord[] = [];
  for (const file of files) {
    try {
      const data = readFileSync(join(dir, file), 'utf-8');
      sessions.push(JSON.parse(data));
    } catch {
      // Skip invalid files
    }
  }

  return sessions;
}

// Load related stores for session data
function loadRelatedStores(options: { includeMemory?: boolean; includeTasks?: boolean; includeAgents?: boolean }) {
  const data: SessionRecord['data'] = {};

  if (options.includeMemory) {
    try {
      const memoryPath = join(process.cwd(), STORAGE_DIR, 'memory', 'store.json');
      if (existsSync(memoryPath)) {
        data.memory = JSON.parse(readFileSync(memoryPath, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  if (options.includeTasks) {
    try {
      const taskPath = join(process.cwd(), STORAGE_DIR, 'tasks', 'store.json');
      if (existsSync(taskPath)) {
        data.tasks = JSON.parse(readFileSync(taskPath, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  if (options.includeAgents) {
    try {
      const agentPath = join(process.cwd(), STORAGE_DIR, 'agents', 'store.json');
      if (existsSync(agentPath)) {
        data.agents = JSON.parse(readFileSync(agentPath, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  return data;
}

export const sessionTools: MCPTool[] = [
  {
    name: 'session/save',
    description: 'Save current session state',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Session name' },
        description: { type: 'string', description: 'Session description' },
        includeMemory: { type: 'boolean', description: 'Include memory in session' },
        includeTasks: { type: 'boolean', description: 'Include tasks in session' },
        includeAgents: { type: 'boolean', description: 'Include agents in session' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Load related data based on options
      const data = loadRelatedStores({
        includeMemory: input.includeMemory as boolean,
        includeTasks: input.includeTasks as boolean,
        includeAgents: input.includeAgents as boolean,
      });

      // Calculate stats
      const stats = {
        tasks: data.tasks ? Object.keys((data.tasks as { tasks?: object }).tasks || {}).length : 0,
        agents: data.agents ? Object.keys((data.agents as { agents?: object }).agents || {}).length : 0,
        memoryEntries: data.memory ? Object.keys((data.memory as { entries?: object }).entries || {}).length : 0,
        totalSize: 0,
      };

      const session: SessionRecord = {
        sessionId,
        name: input.name as string,
        description: input.description as string,
        savedAt: new Date().toISOString(),
        stats,
        data: Object.keys(data).length > 0 ? data : undefined,
      };

      // Calculate size
      const sessionJson = JSON.stringify(session);
      session.stats.totalSize = Buffer.byteLength(sessionJson, 'utf-8');

      saveSession(session);

      return {
        sessionId,
        name: session.name,
        savedAt: session.savedAt,
        stats: session.stats,
        path: getSessionPath(sessionId),
      };
    },
  },
  {
    name: 'session/restore',
    description: 'Restore a saved session',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to restore' },
        name: { type: 'string', description: 'Session name to restore' },
      },
    },
    handler: async (input) => {
      let session: SessionRecord | null = null;

      // Try to find by sessionId first
      if (input.sessionId) {
        session = loadSession(input.sessionId as string);
      }

      // Try to find by name if sessionId not found
      if (!session && input.name) {
        const sessions = listSessions();
        session = sessions.find(s => s.name === input.name) || null;
      }

      // Try to find latest if no params
      if (!session && !input.sessionId && !input.name) {
        const sessions = listSessions();
        if (sessions.length > 0) {
          sessions.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
          session = sessions[0];
        }
      }

      if (session) {
        // Restore data to respective stores
        if (session.data?.memory) {
          const memoryDir = join(process.cwd(), STORAGE_DIR, 'memory');
          if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
          writeFileSync(join(memoryDir, 'store.json'), JSON.stringify(session.data.memory, null, 2), 'utf-8');
        }
        if (session.data?.tasks) {
          const taskDir = join(process.cwd(), STORAGE_DIR, 'tasks');
          if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
          writeFileSync(join(taskDir, 'store.json'), JSON.stringify(session.data.tasks, null, 2), 'utf-8');
        }
        if (session.data?.agents) {
          const agentDir = join(process.cwd(), STORAGE_DIR, 'agents');
          if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });
          writeFileSync(join(agentDir, 'store.json'), JSON.stringify(session.data.agents, null, 2), 'utf-8');
        }

        return {
          sessionId: session.sessionId,
          name: session.name,
          restored: true,
          restoredAt: new Date().toISOString(),
          stats: session.stats,
        };
      }

      return {
        sessionId: input.sessionId || input.name || 'latest',
        restored: false,
        error: 'Session not found',
      };
    },
  },
  {
    name: 'session/list',
    description: 'List saved sessions',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum sessions to return' },
        sortBy: { type: 'string', description: 'Sort field (date, name, size)' },
      },
    },
    handler: async (input) => {
      let sessions = listSessions();

      // Sort
      const sortBy = (input.sortBy as string) || 'date';
      if (sortBy === 'date') {
        sessions.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
      } else if (sortBy === 'name') {
        sessions.sort((a, b) => a.name.localeCompare(b.name));
      } else if (sortBy === 'size') {
        sessions.sort((a, b) => b.stats.totalSize - a.stats.totalSize);
      }

      // Apply limit
      const limit = (input.limit as number) || 10;
      sessions = sessions.slice(0, limit);

      return {
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          name: s.name,
          description: s.description,
          savedAt: s.savedAt,
          stats: s.stats,
        })),
        total: sessions.length,
        limit,
      };
    },
  },
  {
    name: 'session/delete',
    description: 'Delete a saved session',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to delete' },
      },
      required: ['sessionId'],
    },
    handler: async (input) => {
      const sessionId = input.sessionId as string;
      const path = getSessionPath(sessionId);

      if (existsSync(path)) {
        unlinkSync(path);
        return {
          sessionId,
          deleted: true,
          deletedAt: new Date().toISOString(),
        };
      }

      return {
        sessionId,
        deleted: false,
        error: 'Session not found',
      };
    },
  },
  {
    name: 'session/info',
    description: 'Get detailed session information',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
    handler: async (input) => {
      const sessionId = input.sessionId as string;
      const session = loadSession(sessionId);

      if (session) {
        const path = getSessionPath(sessionId);
        const stat = statSync(path);

        return {
          sessionId: session.sessionId,
          name: session.name,
          description: session.description,
          savedAt: session.savedAt,
          stats: session.stats,
          fileSize: stat.size,
          path,
          hasData: {
            memory: !!session.data?.memory,
            tasks: !!session.data?.tasks,
            agents: !!session.data?.agents,
          },
        };
      }

      return {
        sessionId,
        error: 'Session not found',
      };
    },
  },
];
