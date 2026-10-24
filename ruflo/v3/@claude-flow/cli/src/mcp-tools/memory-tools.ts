/**
 * Memory MCP Tools for CLI
 *
 * Tool definitions for memory management with file-based persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { MCPTool } from './types.js';

// Simple file-based memory store
interface MemoryEntry {
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  storedAt: string;
  accessCount: number;
  lastAccessed: string;
}

interface MemoryStore {
  entries: Record<string, MemoryEntry>;
  version: string;
}

const MEMORY_DIR = '.claude-flow/memory';
const MEMORY_FILE = 'store.json';

function getMemoryPath(): string {
  return resolve(join(MEMORY_DIR, MEMORY_FILE));
}

function ensureMemoryDir(): void {
  const dir = resolve(MEMORY_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadMemoryStore(): MemoryStore {
  try {
    const path = getMemoryPath();
    if (existsSync(path)) {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return empty store on error
  }
  return { entries: {}, version: '3.0.0' };
}

function saveMemoryStore(store: MemoryStore): void {
  ensureMemoryDir();
  writeFileSync(getMemoryPath(), JSON.stringify(store, null, 2), 'utf-8');
}

export const memoryTools: MCPTool[] = [
  {
    name: 'memory/store',
    description: 'Store a value in memory (persisted to disk)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        value: { description: 'Value to store' },
        metadata: { type: 'object', description: 'Optional metadata' },
      },
      required: ['key', 'value'],
    },
    handler: async (input) => {
      const store = loadMemoryStore();
      const now = new Date().toISOString();

      const entry: MemoryEntry = {
        key: input.key as string,
        value: input.value,
        metadata: (input.metadata as Record<string, unknown>) || {},
        storedAt: now,
        accessCount: 0,
        lastAccessed: now,
      };

      store.entries[input.key as string] = entry;
      saveMemoryStore(store);

      return {
        success: true,
        key: input.key,
        stored: true,
        storedAt: now,
        totalEntries: Object.keys(store.entries).length,
      };
    },
  },
  {
    name: 'memory/retrieve',
    description: 'Retrieve a value from memory',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const store = loadMemoryStore();
      const key = input.key as string;
      const entry = store.entries[key];

      if (entry) {
        // Update access stats
        entry.accessCount++;
        entry.lastAccessed = new Date().toISOString();
        saveMemoryStore(store);

        return {
          key,
          value: entry.value,
          metadata: entry.metadata,
          storedAt: entry.storedAt,
          accessCount: entry.accessCount,
          found: true,
        };
      }

      return {
        key,
        value: null,
        found: false,
      };
    },
  },
  {
    name: 'memory/search',
    description: 'Search memory by keyword',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Result limit' },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const store = loadMemoryStore();
      const query = (input.query as string).toLowerCase();
      const limit = (input.limit as number) || 10;
      const startTime = performance.now();

      const results = Object.values(store.entries)
        .filter(entry => {
          const keyMatch = entry.key.toLowerCase().includes(query);
          const valueStr = typeof entry.value === 'string' ? entry.value.toLowerCase() : JSON.stringify(entry.value).toLowerCase();
          const valueMatch = valueStr.includes(query);
          return keyMatch || valueMatch;
        })
        .slice(0, limit)
        .map(entry => ({
          key: entry.key,
          value: entry.value,
          score: 1.0, // Simple keyword match
          storedAt: entry.storedAt,
        }));

      const duration = performance.now() - startTime;

      return {
        query: input.query,
        results,
        total: results.length,
        searchTime: `${duration.toFixed(2)}ms`,
      };
    },
  },
  {
    name: 'memory/delete',
    description: 'Delete a memory entry',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const store = loadMemoryStore();
      const key = input.key as string;
      const existed = key in store.entries;

      if (existed) {
        delete store.entries[key];
        saveMemoryStore(store);
      }

      return {
        success: existed,
        key,
        deleted: existed,
        remainingEntries: Object.keys(store.entries).length,
      };
    },
  },
  {
    name: 'memory/list',
    description: 'List all memory entries',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Result limit' },
        offset: { type: 'number', description: 'Result offset' },
      },
    },
    handler: async (input) => {
      const store = loadMemoryStore();
      const limit = (input.limit as number) || 50;
      const offset = (input.offset as number) || 0;

      const allEntries = Object.values(store.entries);
      const entries = allEntries.slice(offset, offset + limit).map(e => ({
        key: e.key,
        storedAt: e.storedAt,
        accessCount: e.accessCount,
        preview: typeof e.value === 'string'
          ? e.value.substring(0, 50) + (e.value.length > 50 ? '...' : '')
          : JSON.stringify(e.value).substring(0, 50),
      }));

      return {
        entries,
        total: allEntries.length,
        limit,
        offset,
      };
    },
  },
  {
    name: 'memory/stats',
    description: 'Get memory storage statistics',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const store = loadMemoryStore();
      const entries = Object.values(store.entries);
      const totalSize = JSON.stringify(store).length;

      return {
        totalEntries: entries.length,
        totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
        version: store.version,
        backend: 'file',
        location: getMemoryPath(),
        oldestEntry: entries.length > 0
          ? entries.reduce((a, b) => a.storedAt < b.storedAt ? a : b).storedAt
          : null,
        newestEntry: entries.length > 0
          ? entries.reduce((a, b) => a.storedAt > b.storedAt ? a : b).storedAt
          : null,
      };
    },
  },
];
