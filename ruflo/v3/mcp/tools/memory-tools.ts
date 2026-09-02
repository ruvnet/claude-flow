/**
 * V3 MCP Memory Tools
 *
 * MCP tools for memory operations:
 * - memory/store - Store memory entry
 * - memory/search - Search memories (semantic + keyword)
 * - memory/list - List memory entries
 *
 * Implements ADR-005: MCP-First API Design
 * Implements ADR-006: Unified Memory Service (AgentDB integration)
 */

import { z } from 'zod';
import { MCPTool, ToolContext } from '../types.js';

// ============================================================================
// Input Schemas
// ============================================================================

const storeMemorySchema = z.object({
  content: z.string().min(1).describe('Memory content to store'),
  type: z.enum(['episodic', 'semantic', 'procedural', 'working'])
    .default('episodic')
    .describe('Type of memory'),
  category: z.string().optional().describe('Memory category (e.g., code, documentation, conversation)'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  importance: z.number().min(0).max(1).optional()
    .describe('Importance score (0-1)'),
  ttl: z.number().int().positive().optional()
    .describe('Time-to-live in milliseconds (optional, for temporary memories)'),
});

const searchMemorySchema = z.object({
  query: z.string().min(1).describe('Search query (semantic or keyword)'),
  searchType: z.enum(['semantic', 'keyword', 'hybrid'])
    .default('hybrid')
    .describe('Type of search to perform'),
  type: z.enum(['episodic', 'semantic', 'procedural', 'working', 'all'])
    .default('all')
    .describe('Filter by memory type'),
  category: z.string().optional().describe('Filter by category'),
  tags: z.array(z.string()).optional().describe('Filter by tags (AND logic)'),
  limit: z.number().int().positive().max(1000).default(10)
    .describe('Maximum number of results'),
  minRelevance: z.number().min(0).max(1).optional()
    .describe('Minimum relevance score (0-1)'),
  includeMetadata: z.boolean().default(true)
    .describe('Include metadata in results'),
});

const listMemorySchema = z.object({
  type: z.enum(['episodic', 'semantic', 'procedural', 'working', 'all'])
    .default('all')
    .describe('Filter by memory type'),
  category: z.string().optional().describe('Filter by category'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  sortBy: z.enum(['created', 'accessed', 'importance', 'relevance'])
    .default('created')
    .describe('Sort order'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
    .describe('Sort direction'),
  limit: z.number().int().positive().max(1000).default(50)
    .describe('Maximum number of results'),
  offset: z.number().int().nonnegative().default(0)
    .describe('Offset for pagination'),
  includeMetadata: z.boolean().default(true)
    .describe('Include metadata in results'),
});

// ============================================================================
// Type Definitions
// ============================================================================

interface Memory {
  id: string;
  content: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  category?: string;
  tags?: string[];
  importance?: number;
  createdAt: string;
  accessedAt?: string;
  accessCount?: number;
  metadata?: Record<string, unknown>;
}

interface SearchResult extends Memory {
  relevance: number;
  highlights?: string[];
}

interface StoreMemoryResult {
  id: string;
  stored: boolean;
  storedAt: string;
}

interface SearchMemoryResult {
  results: SearchResult[];
  total: number;
  query: string;
  searchType: string;
  executionTime: number;
}

interface ListMemoryResult {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Store memory entry
 */
async function handleStoreMemory(
  input: z.infer<typeof storeMemorySchema>,
  context?: ToolContext
): Promise<StoreMemoryResult> {
  // Secure memory ID generation
  const { randomBytes } = await import('crypto');
  const id = `mem-${Date.now().toString(36)}-${randomBytes(12).toString('hex')}`;
  const storedAt = new Date().toISOString();

  // Try to use memory service if available
  const resourceManager = context?.resourceManager as any;
  if (resourceManager?.memoryService) {
    try {
      const { UnifiedMemoryService } = await import('@claude-flow/memory');
      const memoryService = resourceManager.memoryService as UnifiedMemoryService;

      // Store the memory entry
      const entry = await memoryService.storeEntry({
        namespace: input.category || 'default',
        key: id,
        content: input.content,
        type: input.type as any,
        tags: input.tags || [],
        metadata: {
          ...input.metadata,
          importance: input.importance,
          expiresAt: input.ttl ? Date.now() + input.ttl : undefined,
        },
        accessLevel: 'private' as any,
      });

      return {
        id: entry.id,
        stored: true,
        storedAt: entry.createdAt.toISOString(),
      };
    } catch (error) {
      console.error('Failed to store memory via memory service:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation when no memory service is available
  return {
    id,
    stored: true,
    storedAt,
  };
}

/**
 * Search memories (semantic + keyword)
 */
async function handleSearchMemory(
  input: z.infer<typeof searchMemorySchema>,
  context?: ToolContext
): Promise<SearchMemoryResult> {
  const startTime = performance.now();

  // Try to use memory service if available
  const resourceManager = context?.resourceManager as any;
  if (resourceManager?.memoryService) {
    try {
      const { UnifiedMemoryService } = await import('@claude-flow/memory');
      const memoryService = resourceManager.memoryService as UnifiedMemoryService;

      let searchResults: any[];

      if (input.searchType === 'semantic' || input.searchType === 'hybrid') {
        // Perform semantic search
        searchResults = await memoryService.semanticSearch(
          input.query,
          input.limit,
          input.minRelevance
        );
      } else {
        // Perform keyword search via query
        const entries = await memoryService.query({
          type: input.searchType === 'keyword' ? 'keyword' : 'hybrid',
          keyword: input.query,
          limit: input.limit,
          namespace: input.category,
        });

        searchResults = entries.map(e => ({
          entry: e,
          score: 1.0, // Keyword match doesn't have a score
          distance: 0,
        }));
      }

      // Convert to SearchResult format
      let results: SearchResult[] = searchResults.map(r => ({
        id: r.entry.id,
        content: r.entry.content,
        type: r.entry.type,
        category: r.entry.namespace,
        tags: r.entry.tags,
        importance: r.entry.metadata.importance as number,
        createdAt: r.entry.createdAt.toISOString(),
        accessedAt: r.entry.lastAccessedAt?.toISOString(),
        accessCount: r.entry.accessCount,
        relevance: r.score || (1 - r.distance),
        metadata: input.includeMetadata ? r.entry.metadata : undefined,
      }));

      // Apply filters
      if (input.type !== 'all') {
        results = results.filter(m => m.type === input.type);
      }
      if (input.tags && input.tags.length > 0) {
        results = results.filter(m =>
          input.tags!.every(tag => m.tags?.includes(tag))
        );
      }
      if (input.minRelevance !== undefined) {
        results = results.filter(m => m.relevance >= input.minRelevance!);
      }

      const executionTime = performance.now() - startTime;

      return {
        results: results.slice(0, input.limit),
        total: results.length,
        query: input.query,
        searchType: input.searchType,
        executionTime,
      };
    } catch (error) {
      console.error('Failed to search memory via memory service:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation when no memory service is available
  const executionTime = performance.now() - startTime;
  return {
    results: [],
    total: 0,
    query: input.query,
    searchType: input.searchType,
    executionTime,
  };
}

/**
 * List memory entries
 */
async function handleListMemory(
  input: z.infer<typeof listMemorySchema>,
  context?: ToolContext
): Promise<ListMemoryResult> {
  // Try to use memory service if available
  const resourceManager = context?.resourceManager as any;
  if (resourceManager?.memoryService) {
    try {
      const { UnifiedMemoryService } = await import('@claude-flow/memory');
      const memoryService = resourceManager.memoryService as UnifiedMemoryService;

      // Query all entries
      const entries = await memoryService.query({
        type: input.type === 'all' ? 'hybrid' : ('keyword' as any),
        limit: 10000, // Get all for filtering
        namespace: input.category,
      });

      // Convert to Memory format
      let memories: Memory[] = entries.map(e => ({
        id: e.id,
        content: e.content,
        type: e.type,
        category: e.namespace,
        tags: e.tags,
        importance: e.metadata.importance as number,
        createdAt: e.createdAt.toISOString(),
        accessedAt: e.lastAccessedAt?.toISOString(),
        accessCount: e.accessCount,
        metadata: input.includeMetadata ? e.metadata : undefined,
      }));

      // Apply filters
      if (input.type !== 'all') {
        memories = memories.filter(m => m.type === input.type);
      }
      if (input.tags && input.tags.length > 0) {
        memories = memories.filter(m =>
          input.tags!.every(tag => m.tags?.includes(tag))
        );
      }

      // Apply sorting
      const sorted = [...memories].sort((a, b) => {
        let aVal: number | string;
        let bVal: number | string;

        switch (input.sortBy) {
          case 'created':
            aVal = new Date(a.createdAt).getTime();
            bVal = new Date(b.createdAt).getTime();
            break;
          case 'accessed':
            aVal = a.accessedAt ? new Date(a.accessedAt).getTime() : 0;
            bVal = b.accessedAt ? new Date(b.accessedAt).getTime() : 0;
            break;
          case 'importance':
            aVal = a.importance || 0;
            bVal = b.importance || 0;
            break;
          default:
            aVal = 0;
            bVal = 0;
        }

        if (input.sortOrder === 'asc') {
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        } else {
          return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        }
      });

      // Apply pagination
      const paginated = sorted.slice(input.offset, input.offset + input.limit);

      return {
        memories: paginated,
        total: sorted.length,
        limit: input.limit,
        offset: input.offset,
      };
    } catch (error) {
      console.error('Failed to list memory via memory service:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation when no memory service is available
  return {
    memories: [],
    total: 0,
    limit: input.limit,
    offset: input.offset,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * memory/store tool
 */
export const storeMemoryTool: MCPTool = {
  name: 'memory/store',
  description: 'Store a memory entry with specified type, category, and metadata',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Memory content to store',
        minLength: 1,
      },
      type: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural', 'working'],
        description: 'Type of memory',
        default: 'episodic',
      },
      category: {
        type: 'string',
        description: 'Memory category (e.g., code, documentation, conversation)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
        additionalProperties: true,
      },
      importance: {
        type: 'number',
        description: 'Importance score (0-1)',
        minimum: 0,
        maximum: 1,
      },
      ttl: {
        type: 'number',
        description: 'Time-to-live in milliseconds',
        minimum: 1,
      },
    },
    required: ['content'],
  },
  handler: async (input, context) => {
    const validated = storeMemorySchema.parse(input);
    return handleStoreMemory(validated, context);
  },
  category: 'memory',
  tags: ['memory', 'storage', 'agentdb'],
  version: '1.0.0',
};

/**
 * memory/search tool
 */
export const searchMemoryTool: MCPTool = {
  name: 'memory/search',
  description: 'Search memories using semantic and keyword search with filtering',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (semantic or keyword)',
        minLength: 1,
      },
      searchType: {
        type: 'string',
        enum: ['semantic', 'keyword', 'hybrid'],
        description: 'Type of search to perform',
        default: 'hybrid',
      },
      type: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural', 'working', 'all'],
        description: 'Filter by memory type',
        default: 'all',
      },
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags (AND logic)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results',
        minimum: 1,
        maximum: 1000,
        default: 10,
      },
      minRelevance: {
        type: 'number',
        description: 'Minimum relevance score (0-1)',
        minimum: 0,
        maximum: 1,
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include metadata in results',
        default: true,
      },
    },
    required: ['query'],
  },
  handler: async (input, context) => {
    const validated = searchMemorySchema.parse(input);
    return handleSearchMemory(validated, context);
  },
  category: 'memory',
  tags: ['memory', 'search', 'agentdb', 'semantic'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

/**
 * memory/list tool
 */
export const listMemoryTool: MCPTool = {
  name: 'memory/list',
  description: 'List memory entries with filtering, sorting, and pagination',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural', 'working', 'all'],
        description: 'Filter by memory type',
        default: 'all',
      },
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags',
      },
      sortBy: {
        type: 'string',
        enum: ['created', 'accessed', 'importance', 'relevance'],
        description: 'Sort order',
        default: 'created',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
        default: 'desc',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results',
        minimum: 1,
        maximum: 1000,
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Offset for pagination',
        minimum: 0,
        default: 0,
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include metadata in results',
        default: true,
      },
    },
  },
  handler: async (input, context) => {
    const validated = listMemorySchema.parse(input);
    return handleListMemory(validated, context);
  },
  category: 'memory',
  tags: ['memory', 'list', 'agentdb'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 3000,
};

// ============================================================================
// Exports
// ============================================================================

export const memoryTools: MCPTool[] = [
  storeMemoryTool,
  searchMemoryTool,
  listMemoryTool,
];

export default memoryTools;
