/**
 * MemoryTools
 *
 * MCP tools for memory management operations.
 */

import type {
  MCPTool,
  MCPToolProvider,
  MCPToolResult,
  Memory,
  MemoryQuery,
  MemoryBackend
} from '../../../shared/types';

export class MemoryTools implements MCPToolProvider {
  private backend: MemoryBackend;

  constructor(backend: MemoryBackend) {
    this.backend = backend;
  }

  /**
   * Get available tools
   */
  getTools(): MCPTool[] {
    return [
      {
        name: 'memory_store',
        description: 'Store a memory entry',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique memory identifier' },
            agentId: { type: 'string', description: 'Agent that owns this memory' },
            content: { type: 'string', description: 'Memory content' },
            type: { type: 'string', description: 'Memory type' },
            timestamp: { type: 'number', description: 'Timestamp' },
            embedding: { type: 'array', items: { type: 'number' }, description: 'Vector embedding' },
            metadata: { type: 'object', description: 'Additional metadata' }
          },
          required: ['id', 'agentId', 'content', 'type']
        }
      },
      {
        name: 'memory_search',
        description: 'Search memories with filters',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Filter by agent ID' },
            type: { type: 'string', description: 'Filter by memory type' },
            limit: { type: 'number', description: 'Maximum results' },
            offset: { type: 'number', description: 'Offset for pagination' }
          }
        }
      },
      {
        name: 'memory_vector_search',
        description: 'Search memories by vector similarity',
        parameters: {
          type: 'object',
          properties: {
            embedding: { type: 'array', items: { type: 'number' }, description: 'Query embedding' },
            k: { type: 'number', description: 'Number of results' }
          },
          required: ['embedding']
        }
      },
      {
        name: 'memory_retrieve',
        description: 'Retrieve a memory by ID',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Memory ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'memory_delete',
        description: 'Delete a memory',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Memory ID' }
          },
          required: ['id']
        }
      }
    ];
  }

  /**
   * Execute a tool
   */
  async execute(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      switch (toolName) {
        case 'memory_store':
          return await this.storeMemory(params as Memory);

        case 'memory_search':
          return await this.searchMemories(params as MemoryQuery);

        case 'memory_vector_search':
          return await this.vectorSearch(
            params.embedding as number[],
            params.k as number | undefined
          );

        case 'memory_retrieve':
          return await this.retrieveMemory(params.id as string);

        case 'memory_delete':
          return await this.deleteMemory(params.id as string);

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async storeMemory(memory: Memory): Promise<MCPToolResult> {
    await this.backend.store(memory);
    return { success: true };
  }

  private async searchMemories(query: MemoryQuery): Promise<MCPToolResult> {
    const memories = await this.backend.query(query);
    return { success: true, memories };
  }

  private async vectorSearch(embedding: number[], k?: number): Promise<MCPToolResult> {
    const results = await this.backend.vectorSearch(embedding, k || 10);
    return { success: true, results };
  }

  private async retrieveMemory(id: string): Promise<MCPToolResult> {
    const memory = await this.backend.retrieve(id);
    return { success: true, memories: memory ? [memory] : [] };
  }

  private async deleteMemory(id: string): Promise<MCPToolResult> {
    await this.backend.delete(id);
    return { success: true };
  }
}

export { MemoryTools as default };
