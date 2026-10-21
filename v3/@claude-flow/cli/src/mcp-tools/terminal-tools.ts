/**
 * Terminal MCP Tools for CLI
 *
 * Terminal session management with real command execution.
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { existsSync } from 'node:fs';
import {
  mkdirRestricted,
  readFileMaybeEncrypted,
  writeFileRestricted,
} from '../fs-secure.js';
import { validateEnv, validateIdentifier, validatePath, validateText } from './validate-input.js';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

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
  return join(getProjectCwd(), STORAGE_DIR, TERMINAL_DIR);
}

function getTerminalPath(): string {
  return join(getTerminalDir(), TERMINAL_FILE);
}

function ensureTerminalDir(): void {
  const dir = getTerminalDir();
  if (!existsSync(dir)) {
    mkdirRestricted(dir);
  }
}

function loadTerminalStore(): TerminalStore {
  try {
    const path = getTerminalPath();
    if (existsSync(path)) {
      // ADR-096 Phase 3: readFileMaybeEncrypted handles both legacy
      // plaintext stores and post-migration encrypted ones via the RFE1
      // magic-byte sniff.
      return JSON.parse(readFileMaybeEncrypted(path, 'utf-8'));
    }
  } catch {
    // Return empty store
  }
  return { sessions: {}, version: '3.0.0' };
}

function saveTerminalStore(store: TerminalStore): void {
  ensureTerminalDir();
  // audit_1776853149979: terminal command history can contain credentials
  // pasted into commands; restrict to owner read/write (mode 0600).
  // ADR-096 Phase 3: opt-in AES-256-GCM encrypt-at-rest. Honored only
  // when CLAUDE_FLOW_ENCRYPT_AT_REST is set; otherwise legacy plaintext
  // path runs unchanged.
  writeFileRestricted(
    getTerminalPath(),
    JSON.stringify(store, null, 2),
    { encrypt: true },
  );
}

export const terminalTools: MCPTool[] = [
  {
    name: 'terminal_create',
    description: 'Create a new terminal session Use when native Bash is wrong because you need a persistent terminal session across turns/agents with output capture and replay. For one-shot shell commands, native Bash is fine.',
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
      // Validate user-provided input (#1425, audit_1776853149979)
      if (input.name) {
        const v = validateText(input.name, 'name', 256);
        if (!v.valid) return { success: false, error: v.error };
      }
      if (input.workingDir) {
        const v = validatePath(input.workingDir, 'workingDir');
        if (!v.valid) return { success: false, error: v.error };
      }
      // env is merged into execSync's process env on every command; reject
      // loader/runtime hijack vars (LD_PRELOAD, NODE_OPTIONS, …) and enforce
      // POSIX-shaped names + null-byte-free values.
      const vEnv = validateEnv(input.env, 'env');
      if (!vEnv.valid) return { success: false, error: vEnv.error };

      const store = loadTerminalStore();
      const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const session: TerminalSession = {
        id,
        name: (input.name as string) || `Terminal ${Object.keys(store.sessions).length + 1}`,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        workingDir: (input.workingDir as string) || getProjectCwd(),
        history: [],
        env: vEnv.sanitized,
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
    name: 'terminal_execute',
    description: 'Execute a command in a terminal session Use when native Bash is wrong because you need a persistent terminal session across turns/agents with output capture and replay. For one-shot shell commands, native Bash is fine.',
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
      // Validate user-provided input (#1425)
      const vCmd = validateText(input.command, 'command', 10_000);
      if (!vCmd.valid) return { success: false, error: vCmd.error };
      if (input.sessionId) {
        const v = validateIdentifier(input.sessionId, 'sessionId');
        if (!v.valid) return { success: false, error: v.error };
      }

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
          workingDir: getProjectCwd(),
          history: [],
          env: {},
        };
        store.sessions[id] = session;
      }

      const timeout = (input.timeout as number) || 30_000;
      const cwd = session.workingDir || getProjectCwd();
      const startTime = Date.now();
      let output: string;
      let exitCode: number;

      // dream-cycle 2026-09-21 (post-review): session.env was validated once
      // at terminal_create time and trusted forever after via the on-disk
      // store — a session persisted before a denylist update (or a store.json
      // edited/restored out of band) could carry an env that the *current*
      // validateEnv() would reject, silently bypassing the denylist for every
      // execute on that pre-existing session. Re-validate at execution time
      // too; drop (not fail the whole call) on now-invalid env so a stale
      // session degrades to a clean environment rather than blocking.
      const vSessionEnv = validateEnv(session.env, 'session.env');
      const effectiveEnv = vSessionEnv.valid ? vSessionEnv.sanitized : {};

      try {
        output = execSync(command, {
          cwd,
          encoding: 'utf-8',
          timeout,
          maxBuffer: 5 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...effectiveEnv },
        });
        exitCode = 0;
      } catch (err: any) {
        output = (err.stdout || '') + (err.stderr ? `\n[stderr] ${err.stderr}` : '');
        exitCode = err.status ?? 1;
      }

      const duration = Date.now() - startTime;
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
        success: exitCode === 0,
        sessionId: session.id,
        command,
        output,
        exitCode,
        executedAt: timestamp,
        duration,
      };
    },
  },
  {
    name: 'terminal_list',
    description: 'List all terminal sessions Use when native Bash is wrong because you need a persistent terminal session across turns/agents with output capture and replay. For one-shot shell commands, native Bash is fine.',
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
    name: 'terminal_close',
    description: 'Close a terminal session Use when native Bash is wrong because you need a persistent terminal session across turns/agents with output capture and replay. For one-shot shell commands, native Bash is fine.',
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
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.sessionId, 'sessionId');
      if (!vId.valid) return { success: false, error: vId.error };

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
    name: 'terminal_history',
    description: 'Get command history for a terminal session Use when native Bash is wrong because you need a persistent terminal session across turns/agents with output capture and replay. For one-shot shell commands, native Bash is fine.',
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
      // Validate user-provided input (#1425)
      if (input.sessionId) {
        const v = validateIdentifier(input.sessionId, 'sessionId');
        if (!v.valid) return { success: false, error: v.error };
      }

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
