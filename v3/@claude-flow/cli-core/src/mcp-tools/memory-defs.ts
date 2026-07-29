/**
 * MCPTool *definitions* for the memory_* family (alpha.2 — ADR-100 §Discovery).
 *
 * Pure data — name, description, inputSchema only. No handler functions.
 *
 * The handler implementations stay in @claude-flow/cli (they need the heavy
 * SqliteHnswMemoryBackend for semantic search) OR can be wired against
 * cli-core's own JsonMemoryBackend for the lite path.
 *
 * cli-core ships these definitions so an MCP server can advertise the
 * memory_* tools to a Claude session without paying the cold-cache cost
 * of pulling the full handler tree. The handler is dynamic-imported only
 * at request time.
 *
 * Descriptions match the 3.6.30 sharpening (#1748 Issue 4 — "Use when
 * native X is wrong because Y" framing).
 */

import type { MCPTool } from './types.js';

// We use Pick<MCPTool, ...> to express that these are def-only — no handler.
// The handler is supplied by whatever package wires the tool to a backend.
export type MCPToolDef = Pick<MCPTool, 'name' | 'description' | 'inputSchema'> & {
  category?: string;
};

export const memoryToolDefs: MCPToolDef[] = [
  {
    name: 'memory_store',
    description:
      'Persistent key-value store with vector embedding — survives across sessions and is searchable by meaning, not just by file path. Use when native Write is wrong because the data is not a file (e.g. a learned pattern, a decision, a budget config) AND you need to recall it later by semantic query, not by path. Defaults to namespace="default"; pass --upsert=true to update an existing key.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key (unique within namespace)' },
        value: { description: 'Value to store (string or object)' },
        namespace: { type: 'string', description: 'Namespace for organization (default: "default")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for filtering' },
        ttl: { type: 'number', description: 'Time-to-live in seconds (optional)' },
        upsert: { type: 'boolean', description: 'If true, update existing key instead of failing (default: false)' },
        provenance_type: {
          type: 'string',
          enum: ['user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'],
          description: 'ADR-323: who/what produced this value, so shared-namespace retrieval can filter by trust level. Default: "unknown".',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_retrieve',
    description:
      'Read back a value previously stored via memory_store, by exact (namespace, key) — lossless, includes metadata. Use when native Read is wrong because the value is not a file (it lives in the .swarm/memory.db SQLite store) AND you know the exact key. For semantic lookup by meaning, use memory_search.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Namespace (default: "default")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_search',
    description:
      'Find stored memories by meaning (vector similarity), not by literal text — finds "JWT auth pattern" when you query "token-based login flow". Use when native Grep is wrong because Grep matches characters and you need to find conceptually-related entries across past sessions. Backed by HNSW index over ONNX embeddings (heavy backend) or substring fallback (lite cli-core JSON backend); returns top-k with similarity scores.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (semantic similarity)' },
        namespace: { type: 'string', description: 'Namespace to search (default: "default")' },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
        threshold: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.3)' },
        smart: { type: 'boolean', description: 'Enable SmartRetrieval pipeline — query expansion, RRF fusion, recency boost, MMR diversity (default: false). No-op in cli-core lite backend.' },
        provenance_filter: {
          type: 'array',
          items: { type: 'string', enum: ['user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'] },
          description: 'ADR-323: restrict results to these provenance types. Omit for no filtering.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_delete',
    description:
      'Remove a stored memory entry by exact (namespace, key). Use when a previously stored decision is invalidated or contains stale data. No native equivalent — Write to a file does not affect the .swarm/memory.db SQLite store.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Namespace (default: "default")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_list',
    description:
      'Enumerate stored memory entries (optionally filtered by namespace/tags) without semantic search. Use when native Glob is wrong because the entries are not files (they live in .swarm/memory.db). For inspection / audit / "what is in my memory" — pair with memory_search for retrieval-by-meaning.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace filter (optional)' },
        limit: { type: 'number', description: 'Maximum entries (default: 100)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tag filter (intersection)' },
      },
    },
  },
  {
    name: 'memory_stats',
    description:
      'Backend health and size summary — total entries, namespaces in use, on-disk size in bytes, backend identifier (json or sqlite-hnsw). Useful for "what does this project have stored?" diagnostics.',
    category: 'memory',
    inputSchema: { type: 'object', properties: {} },
  },
];
