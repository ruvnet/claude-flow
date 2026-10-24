/**
 * Transfer MCP Tools
 * Pattern and plugin sharing via IPFS-based decentralized registry
 *
 * @module @claude-flow/cli/mcp-tools/transfer-tools
 * @version 3.0.0
 */

import type { MCPTool, MCPToolResult } from './types.js';

/**
 * Helper to create MCP tool result
 */
function createResult(data: unknown, isError = false): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

/**
 * Transfer MCP tools for pattern export, import, anonymization, and sharing
 */
export const transferTools: MCPTool[] = [
  // ═══════════════════════════════════════════════════════════════
  // ANONYMIZATION TOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'transfer/detect-pii',
    description: 'Detect PII in content without redacting',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content to scan for PII',
        },
      },
      required: ['content'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { detectPII } = await import('../transfer/anonymization/index.js');
        const result = detectPII((input as { content: string }).content);
        return createResult(result);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // IPFS TOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'transfer/ipfs-resolve',
    description: 'Resolve IPNS name to CID',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'IPNS name to resolve',
        },
      },
      required: ['name'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { resolveIPNS } = await import('../transfer/ipfs/client.js');
        const result = await resolveIPNS((input as { name: string }).name);
        return createResult({ success: true, cid: result });
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // PATTERN STORE TOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'transfer/store-search',
    description: 'Search the pattern store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
        minRating: {
          type: 'number',
          description: 'Minimum rating',
        },
        verified: {
          type: 'boolean',
          description: 'Only show verified patterns',
        },
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { PatternStore } = await import('../transfer/store/index.js');
        const store = new PatternStore();
        await store.initialize();
        const results = store.search(input as Parameters<typeof store.search>[0]);
        return createResult(results);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer/store-info',
    description: 'Get detailed info about a pattern',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Pattern ID',
        },
      },
      required: ['id'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { PatternStore } = await import('../transfer/store/index.js');
        const store = new PatternStore();
        await store.initialize();
        const pattern = store.getPattern((input as { id: string }).id);
        if (!pattern) {
          return createResult({ error: 'Pattern not found' }, true);
        }
        return createResult(pattern);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer/store-download',
    description: 'Download a pattern from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Pattern ID',
        },
        verify: {
          type: 'boolean',
          description: 'Verify pattern integrity',
        },
      },
      required: ['id'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { PatternStore } = await import('../transfer/store/index.js');
        const store = new PatternStore();
        await store.initialize();
        const result = await store.download(
          (input as { id: string }).id,
          { verify: (input as { verify?: boolean }).verify }
        );
        return createResult(result);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer/store-featured',
    description: 'Get featured patterns from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { PatternStore } = await import('../transfer/store/index.js');
        const store = new PatternStore();
        await store.initialize();
        const featured = store.getFeatured();
        const limit = (input as { limit?: number }).limit || 10;
        return createResult(featured.slice(0, limit));
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer/store-trending',
    description: 'Get trending patterns from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { PatternStore } = await import('../transfer/store/index.js');
        const store = new PatternStore();
        await store.initialize();
        const trending = store.getTrending();
        const limit = (input as { limit?: number }).limit || 10;
        return createResult(trending.slice(0, limit));
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // PLUGIN STORE TOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'transfer/plugin-search',
    description: 'Search the plugin store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
        type: {
          type: 'string',
          description: 'Filter by plugin type',
        },
        verified: {
          type: 'boolean',
          description: 'Only show verified plugins',
        },
        minRating: {
          type: 'number',
          description: 'Minimum rating',
        },
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { createPluginDiscoveryService, searchPlugins } = await import(
          '../plugins/store/index.js'
        );
        const discovery = createPluginDiscoveryService();
        const result = await discovery.discoverRegistry();
        if (!result.success || !result.registry) {
          return createResult({ error: result.error || 'Failed to discover registry' }, true);
        }
        const opts = input as Parameters<typeof searchPlugins>[1];
        const searchResult = searchPlugins(result.registry, opts);
        return createResult(searchResult);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer/plugin-info',
    description: 'Get detailed info about a plugin',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Plugin name or ID',
        },
      },
      required: ['name'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { createPluginDiscoveryService } = await import('../plugins/store/index.js');
        const discovery = createPluginDiscoveryService();
        const result = await discovery.discoverRegistry();
        if (!result.success || !result.registry) {
          return createResult({ error: result.error || 'Failed to discover registry' }, true);
        }
        const name = (input as { name: string }).name;
        const plugin = result.registry.plugins.find((p) => p.id === name || p.name === name);
        if (!plugin) {
          return createResult({ error: 'Plugin not found' }, true);
        }
        return createResult(plugin);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer/plugin-featured',
    description: 'Get featured plugins from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { createPluginDiscoveryService, getFeaturedPlugins } = await import(
          '../plugins/store/index.js'
        );
        const discovery = createPluginDiscoveryService();
        const result = await discovery.discoverRegistry();
        if (!result.success || !result.registry) {
          return createResult({ error: result.error || 'Failed to discover registry' }, true);
        }
        const featured = getFeaturedPlugins(result.registry);
        const limit = (input as { limit?: number }).limit || 10;
        return createResult(featured.slice(0, limit));
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer/plugin-official',
    description: 'Get official plugins from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (): Promise<MCPToolResult> => {
      try {
        const { createPluginDiscoveryService, getOfficialPlugins } = await import(
          '../plugins/store/index.js'
        );
        const discovery = createPluginDiscoveryService();
        const result = await discovery.discoverRegistry();
        if (!result.success || !result.registry) {
          return createResult({ error: result.error || 'Failed to discover registry' }, true);
        }
        const official = getOfficialPlugins(result.registry);
        return createResult(official);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },
];

export default transferTools;
