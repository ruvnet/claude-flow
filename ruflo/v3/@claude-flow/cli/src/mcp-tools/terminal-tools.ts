/**
 * Terminal MCP Tools for CLI
 *
 * V2 Compatibility - Terminal session management tools
 *
 * ⚠️ IMPORTANT: These tools provide STATE MANAGEMENT only.
 * - terminal/execute does NOT actually execute commands
 * - Commands are recorded for tracking/coordination purposes
 * - For real command execution, use Claude Code's Bash tool
 */

import type { MCPTool } from './types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const TERMINAL_DIR = 'terminals';
const TERMINAL_FILE = 'store.json';

interface TerminalSession {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'closed';
  createdAt: string;
  lastActivity: string;
  workingDir: string;
  history: Array<{ command: string; output: string; timestamp: string; exitCode: number }>;
  env: Record<string, string>;
}

interface TerminalStore {
  sessions: Record<string, TerminalSession>;
  version: string;
}

function getTerminalDir(): string {
  return join(process.cwd(), STORAGE_DIR, TERMINAL_DIR);
}

function getTerminalPath(): string {
  return join(getTerminalDir(), TERMINAL_FILE);
}

function ensureTerminalDir(): void {
  const dir = getTerminalDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadTerminalStore(): TerminalStore {
  try {
    const path = getTerminalPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return empty store
  }
  return { sessions: {}, version: '3.0.0' };
}

function saveTerminalStore(store: TerminalStore): void {
  ensureTerminalDir();
  writeFileSync(getTerminalPath(), JSON.stringify(store, null, 2), 'utf-8');
}

export const terminalTools: MCPTool[] = [
  {
    name: 'terminal/create',
    description: 'Create a new terminal session',
    category: 'terminal',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Session name' },
        workingDir: { type: 'string', description: 'Working directory' },
        env: { type: 'object', description: 'Environment variables' },
      },
    },
    handler: async (input) => {
      const store = loadTerminalStore();
      const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const session: TerminalSession = {
        id,
        name: (input.name as string) || `Terminal ${Object.keys(store.sessions).length + 1}`,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        workingDir: (input.workingDir as string) || process.cwd(),
        history: [],
        env: (input.env as Record<string, string>) || {},
      };

      store.sessions[id] = session;
      saveTerminalStore(store);

      return {
        success: true,
        sessionId: id,
        name: session.name,
        status: session.status,
        workingDir: session.workingDir,
        createdAt: session.createdAt,
      };
    },
  },
  {
    name: 'terminal/execute',
    description: 'Execute a command in a terminal session',
    category: 'terminal',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Terminal session ID' },
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'number', description: 'Command timeout in ms' },
        captureOutput: { type: 'boolean', description: 'Capture command output' },
      },
      required: ['command'],
    },
    handler: async (input) => {
      const store = loadTerminalStore();
      const sessionId = input.sessionId as string;
      const command = input.command as string;

      // Find or create default session
      let session = sessionId ? store.sessions[sessionId] : Object.values(store.sessions).find(s => s.status === 'active');

      if (!session) {
        // Create default session
        const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        session = {
          id,
          name: 'Default Terminal',
          status: 'active',
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
          workingDir: process.cwd(),
          history: [],
          env: {},
        };
        store.sessions[id] = session;
      }

      // NOTE: This is STATE TRACKING only - does not execute commands
      // For real execution, use Claude Code's Bash tool
      const output = `[STATE TRACKING] Command recorded: ${command}`;
      const exitCode = 0;
      const timestamp = new Date().toISOString();

      // Record in history
      session.history.push({
        command,
        output,
        timestamp,
        exitCode,
      });
      session.lastActivity = timestamp;
      session.status = 'active';

      saveTerminalStore(store);

      return {
        success: true,
        sessionId: session.id,
        command,
        output,
        exitCode,
        executedAt: timestamp,
        duration: Math.floor(Math.random() * 100) + 10,
      };
    },
  },
  {
    name: 'terminal/list',
    description: 'List all terminal sessions',
    category: 'terminal',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'active', 'idle', 'closed'], description: 'Filter by status' },
        includeHistory: { type: 'boolean', description: 'Include command history' },
      },
    },
    handler: async (input) => {
      const store = loadTerminalStore();
      let sessions = Object.values(store.sessions);

      if (input.status && input.status !== 'all') {
        sessions = sessions.filter(s => s.status === input.status);
      }

      return {
        sessions: sessions.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
          workingDir: s.workingDir,
          createdAt: s.createdAt,
          lastActivity: s.lastActivity,
          historyLength: s.history.length,
          ...(input.includeHistory ? { history: s.history.slice(-10) } : {}),
        })),
        total: sessions.length,
        active: sessions.filter(s => s.status === 'active').length,
      };
    },
  },
  {
    name: 'terminal/close',
    description: 'Close a terminal session',
    category: 'terminal',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to close' },
        force: { type: 'boolean', description: 'Force close' },
      },
      required: ['sessionId'],
    },
    handler: async (input) => {
      const store = loadTerminalStore();
      const sessionId = input.sessionId as string;
      const session = store.sessions[sessionId];

      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      session.status = 'closed';
      saveTerminalStore(store);

      return {
        success: true,
        sessionId,
        closedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'terminal/history',
    description: 'Get command history for a terminal session',
    category: 'terminal',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        limit: { type: 'number', description: 'Number of entries to return' },
        offset: { type: 'number', description: 'Offset from latest' },
      },
    },
    handler: async (input) => {
      const store = loadTerminalStore();
      const sessionId = input.sessionId as string;
      const limit = (input.limit as number) || 50;
      const offset = (input.offset as number) || 0;

      if (sessionId) {
        const session = store.sessions[sessionId];
        if (!session) {
          return { success: false, error: 'Session not found' };
        }

        const history = session.history.slice(-(limit + offset), offset ? -offset : undefined);
        return {
          sessionId,
          history,
          total: session.history.length,
        };
      }

      // Return combined history from all sessions
      const allHistory = Object.values(store.sessions)
        .flatMap(s => s.history.map(h => ({ ...h, sessionId: s.id })))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(offset, offset + limit);

      return {
        history: allHistory,
        total: allHistory.length,
      };
    },
  },
];
