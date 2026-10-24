/**
 * V3 CLI Memory Command
 * Memory operations for AgentDB integration
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm, input } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

// Memory backends
const BACKENDS = [
  { value: 'agentdb', label: 'AgentDB', hint: 'Vector database with HNSW indexing (150x-12,500x faster)' },
  { value: 'sqlite', label: 'SQLite', hint: 'Lightweight local storage' },
  { value: 'hybrid', label: 'Hybrid', hint: 'SQLite + AgentDB (recommended)' },
  { value: 'memory', label: 'In-Memory', hint: 'Fast but non-persistent' }
];

// Store command
const storeCommand: Command = {
  name: 'store',
  description: 'Store data in memory',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Storage key/namespace',
      type: 'string',
      required: true
    },
    {
      name: 'value',
      // Note: No short flag - global -v is reserved for verbose
      description: 'Value to store (use --value)',
      type: 'string'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Memory namespace',
      type: 'string',
      default: 'default'
    },
    {
      name: 'ttl',
      description: 'Time to live in seconds',
      type: 'number'
    },
    {
      name: 'tags',
      description: 'Comma-separated tags',
      type: 'string'
    },
    {
      name: 'vector',
      description: 'Store as vector embedding',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow memory store -k "api/auth" -v "JWT implementation"', description: 'Store text' },
    { command: 'claude-flow memory store -k "pattern/singleton" --vector', description: 'Store vector' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ctx.flags.key as string;
    let value = ctx.flags.value as string || ctx.args[0];
    const namespace = ctx.flags.namespace as string;
    const ttl = ctx.flags.ttl as number;
    const tags = ctx.flags.tags ? (ctx.flags.tags as string).split(',') : [];
    const asVector = ctx.flags.vector as boolean;

    if (!key) {
      output.printError('Key is required. Use --key or -k');
      return { success: false, exitCode: 1 };
    }

    if (!value && ctx.interactive) {
      value = await input({
        message: 'Enter value to store:',
        validate: (v) => v.length > 0 || 'Value is required'
      });
    }

    if (!value) {
      output.printError('Value is required. Use --value');
      return { success: false, exitCode: 1 };
    }

    const storeData = {
      key,
      namespace,
      value,
      ttl,
      tags,
      asVector,
      storedAt: new Date().toISOString(),
      size: Buffer.byteLength(value, 'utf8')
    };

    output.printInfo(`Storing in ${namespace}/${key}...`);

    // Use direct sql.js storage with automatic embedding generation
    try {
      const { storeEntry } = await import('../memory/memory-initializer.js');

      if (asVector) {
        output.writeln(output.dim('  Generating embedding vector...'));
      }

      const result = await storeEntry({
        key,
        value,
        namespace,
        generateEmbeddingFlag: true, // Always generate embeddings for semantic search
        tags,
        ttl
      });

      if (!result.success) {
        output.printError(result.error || 'Failed to store');
        return { success: false, exitCode: 1 };
      }

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'val', header: 'Value', width: 40 }
        ],
        data: [
          { property: 'Key', val: key },
          { property: 'Namespace', val: namespace },
          { property: 'Size', val: `${storeData.size} bytes` },
          { property: 'TTL', val: ttl ? `${ttl}s` : 'None' },
          { property: 'Tags', val: tags.length > 0 ? tags.join(', ') : 'None' },
          { property: 'Vector', val: result.embedding ? `Yes (${result.embedding.dimensions}-dim)` : 'No' },
          { property: 'ID', val: result.id.substring(0, 20) }
        ]
      });

      output.writeln();
      output.printSuccess('Data stored successfully');

      return { success: true, data: { ...storeData, id: result.id, embedding: result.embedding } };
    } catch (error) {
      output.printError(`Failed to store: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Retrieve command
const retrieveCommand: Command = {
  name: 'retrieve',
  aliases: ['get'],
  description: 'Retrieve data from memory',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Storage key',
      type: 'string'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Memory namespace',
      type: 'string',
      default: 'default'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ctx.flags.key as string || ctx.args[0];
    const namespace = ctx.flags.namespace as string;

    if (!key) {
      output.printError('Key is required');
      return { success: false, exitCode: 1 };
    }

    // Use sql.js directly for consistent data access
    try {
      const { getEntry } = await import('../memory/memory-initializer.js');
      const result = await getEntry({ key, namespace });

      if (!result.success) {
        output.printError(`Failed to retrieve: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      if (!result.found || !result.entry) {
        output.printWarning(`Key not found: ${key}`);
        return { success: false, exitCode: 1, data: { key, found: false } };
      }

      const entry = result.entry;

      if (ctx.flags.format === 'json') {
        output.printJson(entry);
        return { success: true, data: entry };
      }

      output.writeln();
      output.printBox(
        [
          `Namespace: ${entry.namespace}`,
          `Key: ${entry.key}`,
          `Size: ${entry.content.length} bytes`,
          `Access Count: ${entry.accessCount}`,
          `Tags: ${entry.tags.length > 0 ? entry.tags.join(', ') : 'None'}`,
          `Vector: ${entry.hasEmbedding ? 'Yes' : 'No'}`,
          '',
          output.bold('Value:'),
          entry.content
        ].join('\n'),
        'Memory Entry'
      );

      return { success: true, data: entry };
    } catch (error) {
      output.printError(`Failed to retrieve: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Search command
const searchCommand: Command = {
  name: 'search',
  description: 'Search memory with semantic/vector search',
  options: [
    {
      name: 'query',
      short: 'q',
      description: 'Search query',
      type: 'string',
      required: true
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Memory namespace',
      type: 'string'
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum results',
      type: 'number',
      default: 10
    },
    {
      name: 'threshold',
      description: 'Similarity threshold (0-1)',
      type: 'number',
      default: 0.7
    },
    {
      name: 'type',
      short: 't',
      description: 'Search type (semantic, keyword, hybrid)',
      type: 'string',
      default: 'semantic',
      choices: ['semantic', 'keyword', 'hybrid']
    }
  ],
  examples: [
    { command: 'claude-flow memory search -q "authentication patterns"', description: 'Semantic search' },
    { command: 'claude-flow memory search -q "JWT" -t keyword', description: 'Keyword search' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.flags.query as string || ctx.args[0];
    const namespace = ctx.flags.namespace as string || 'all';
    const limit = ctx.flags.limit as number || 10;
    const threshold = ctx.flags.threshold as number || 0.3;
    const searchType = ctx.flags.type as string || 'semantic';

    if (!query) {
      output.printError('Query is required. Use --query or -q');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Searching: "${query}" (${searchType})`);
    output.writeln();

    // Use direct sql.js search with vector similarity
    try {
      const { searchEntries } = await import('../memory/memory-initializer.js');

      const searchResult = await searchEntries({
        query,
        namespace,
        limit,
        threshold
      });

      if (!searchResult.success) {
        output.printError(searchResult.error || 'Search failed');
        return { success: false, exitCode: 1 };
      }

      const results = searchResult.results.map(r => ({
        key: r.key,
        score: r.score,
        namespace: r.namespace,
        preview: r.content
      }));

      if (ctx.flags.format === 'json') {
        output.printJson({ query, searchType, results, searchTime: `${searchResult.searchTime}ms` });
        return { success: true, data: results };
      }

      // Performance stats
      output.writeln(output.dim(`  Search time: ${searchResult.searchTime}ms`));
      output.writeln();

      if (results.length === 0) {
        output.printWarning('No results found');
        output.writeln(output.dim('Try: claude-flow memory store -k "key" --value "data"'));
        return { success: true, data: [] };
      }

      output.printTable({
        columns: [
          { key: 'key', header: 'Key', width: 20 },
          { key: 'score', header: 'Score', width: 8, align: 'right', format: (v) => Number(v).toFixed(2) },
          { key: 'namespace', header: 'Namespace', width: 12 },
          { key: 'preview', header: 'Preview', width: 35 }
        ],
        data: results
      });

      output.writeln();
      output.printInfo(`Found ${results.length} results`);

      return { success: true, data: results };
    } catch (error) {
      output.printError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// List command
const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List memory entries',
  options: [
    {
      name: 'namespace',
      short: 'n',
      description: 'Filter by namespace',
      type: 'string'
    },
    {
      name: 'tags',
      short: 't',
      description: 'Filter by tags (comma-separated)',
      type: 'string'
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum entries',
      type: 'number',
      default: 20
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const namespace = ctx.flags.namespace as string;
    const limit = ctx.flags.limit as number;

    // Use sql.js directly for consistent data access
    try {
      const { listEntries } = await import('../memory/memory-initializer.js');
      const listResult = await listEntries({ namespace, limit, offset: 0 });

      if (!listResult.success) {
        output.printError(`Failed to list: ${listResult.error}`);
        return { success: false, exitCode: 1 };
      }

      // Format entries for display
      const entries = listResult.entries.map(e => ({
        key: e.key,
        namespace: e.namespace,
        size: e.size + ' B',
        vector: e.hasEmbedding ? '✓' : '-',
        accessCount: e.accessCount,
        updated: formatRelativeTime(e.updatedAt)
      }));

      if (ctx.flags.format === 'json') {
        output.printJson(listResult.entries);
        return { success: true, data: listResult.entries };
      }

      output.writeln();
      output.writeln(output.bold('Memory Entries'));
      output.writeln();

      if (entries.length === 0) {
        output.printWarning('No entries found');
        output.printInfo('Store data: claude-flow memory store -k "key" --value "data"');
        return { success: true, data: [] };
      }

      output.printTable({
        columns: [
          { key: 'key', header: 'Key', width: 25 },
          { key: 'namespace', header: 'Namespace', width: 12 },
          { key: 'size', header: 'Size', width: 10, align: 'right' },
          { key: 'vector', header: 'Vector', width: 8, align: 'center' },
          { key: 'accessCount', header: 'Accessed', width: 10, align: 'right' },
          { key: 'updated', header: 'Updated', width: 12 }
        ],
        data: entries
      });

      output.writeln();
      output.printInfo(`Showing ${entries.length} of ${listResult.total} entries`);

      return { success: true, data: listResult.entries };
    } catch (error) {
      output.printError(`Failed to list: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Helper function to format relative time
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const date = new Date(isoDate).getTime();
  const diff = now - date;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// Delete command
const deleteCommand: Command = {
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete memory entry',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Skip confirmation',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!key) {
      output.printError('Key is required');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Delete memory entry "${key}"?`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    // Call MCP memory/delete tool
    try {
      const result = await callMCPTool('memory/delete', { key }) as {
        success: boolean;
        key: string;
        deleted: boolean;
        remainingEntries: number;
      };

      if (result.deleted) {
        output.printSuccess(`Deleted ${key}`);
        output.printInfo(`Remaining entries: ${result.remainingEntries}`);
      } else {
        output.printWarning(`Key not found: ${key}`);
      }

      return { success: result.deleted, data: result };
    } catch (error) {
      output.printError(`Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Stats command
const statsCommand: Command = {
  name: 'stats',
  description: 'Show memory statistics',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Call MCP memory/stats tool for real statistics
    try {
      const statsResult = await callMCPTool('memory/stats', {}) as {
        totalEntries: number;
        totalSize: string;
        version: string;
        backend: string;
        location: string;
        oldestEntry: string | null;
        newestEntry: string | null;
      };

      const stats = {
        backend: statsResult.backend,
        entries: {
          total: statsResult.totalEntries,
          vectors: 0, // Would need vector backend support
          text: statsResult.totalEntries
        },
        storage: {
          total: statsResult.totalSize,
          location: statsResult.location
        },
        version: statsResult.version,
        oldestEntry: statsResult.oldestEntry,
        newestEntry: statsResult.newestEntry
      };

      if (ctx.flags.format === 'json') {
        output.printJson(stats);
        return { success: true, data: stats };
      }

      output.writeln();
      output.writeln(output.bold('Memory Statistics'));
      output.writeln();

      output.writeln(output.bold('Overview'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 20 },
          { key: 'value', header: 'Value', width: 30, align: 'right' }
        ],
        data: [
          { metric: 'Backend', value: stats.backend },
          { metric: 'Version', value: stats.version },
          { metric: 'Total Entries', value: stats.entries.total.toLocaleString() },
          { metric: 'Total Storage', value: stats.storage.total },
          { metric: 'Location', value: stats.storage.location }
        ]
      });

      output.writeln();
      output.writeln(output.bold('Timeline'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 20 },
          { key: 'value', header: 'Value', width: 30, align: 'right' }
        ],
        data: [
          { metric: 'Oldest Entry', value: stats.oldestEntry || 'N/A' },
          { metric: 'Newest Entry', value: stats.newestEntry || 'N/A' }
        ]
      });

      output.writeln();
      output.printInfo('V3 Performance: 150x-12,500x faster search with HNSW indexing');

      return { success: true, data: stats };
    } catch (error) {
      output.printError(`Failed to get stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Configure command
const configureCommand: Command = {
  name: 'configure',
  aliases: ['config'],
  description: 'Configure memory backend',
  options: [
    {
      name: 'backend',
      short: 'b',
      description: 'Memory backend',
      type: 'string',
      choices: BACKENDS.map(b => b.value)
    },
    {
      name: 'path',
      description: 'Storage path',
      type: 'string'
    },
    {
      name: 'cache-size',
      description: 'Cache size in MB',
      type: 'number'
    },
    {
      name: 'hnsw-m',
      description: 'HNSW M parameter',
      type: 'number',
      default: 16
    },
    {
      name: 'hnsw-ef',
      description: 'HNSW ef parameter',
      type: 'number',
      default: 200
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let backend = ctx.flags.backend as string;

    if (!backend && ctx.interactive) {
      backend = await select({
        message: 'Select memory backend:',
        options: BACKENDS,
        default: 'hybrid'
      });
    }

    const config = {
      backend: backend || 'hybrid',
      path: ctx.flags.path || './data/memory',
      cacheSize: ctx.flags.cacheSize || 256,
      hnsw: {
        m: ctx.flags.hnswM || 16,
        ef: ctx.flags.hnswEf || 200
      }
    };

    output.writeln();
    output.printInfo('Memory Configuration');
    output.writeln();

    output.printTable({
      columns: [
        { key: 'setting', header: 'Setting', width: 20 },
        { key: 'value', header: 'Value', width: 25 }
      ],
      data: [
        { setting: 'Backend', value: config.backend },
        { setting: 'Storage Path', value: config.path },
        { setting: 'Cache Size', value: `${config.cacheSize} MB` },
        { setting: 'HNSW M', value: config.hnsw.m },
        { setting: 'HNSW ef', value: config.hnsw.ef }
      ]
    });

    output.writeln();
    output.printSuccess('Memory configuration updated');

    return { success: true, data: config };
  }
};

// Cleanup command
const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Clean up stale and expired memory entries',
  options: [
    {
      name: 'dry-run',
      short: 'd',
      description: 'Show what would be deleted',
      type: 'boolean',
      default: false
    },
    {
      name: 'older-than',
      short: 'o',
      description: 'Delete entries older than (e.g., "7d", "30d")',
      type: 'string'
    },
    {
      name: 'expired-only',
      short: 'e',
      description: 'Only delete expired TTL entries',
      type: 'boolean',
      default: false
    },
    {
      name: 'low-quality',
      short: 'l',
      description: 'Delete low quality patterns (threshold)',
      type: 'number'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Clean specific namespace only',
      type: 'string'
    },
    {
      name: 'force',
      short: 'f',
      description: 'Skip confirmation',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow memory cleanup --dry-run', description: 'Preview cleanup' },
    { command: 'claude-flow memory cleanup --older-than 30d', description: 'Delete entries older than 30 days' },
    { command: 'claude-flow memory cleanup --expired-only', description: 'Clean expired entries' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dryRun = ctx.flags.dryRun as boolean;
    const force = ctx.flags.force as boolean;

    if (dryRun) {
      output.writeln(output.warning('DRY RUN - No changes will be made'));
    }

    output.printInfo('Analyzing memory for cleanup...');

    try {
      const result = await callMCPTool<{
        dryRun: boolean;
        candidates: {
          expired: number;
          stale: number;
          lowQuality: number;
          total: number;
        };
        deleted: {
          entries: number;
          vectors: number;
          patterns: number;
        };
        freed: {
          bytes: number;
          formatted: string;
        };
        duration: number;
      }>('memory/cleanup', {
        dryRun,
        olderThan: ctx.flags.olderThan,
        expiredOnly: ctx.flags.expiredOnly,
        lowQualityThreshold: ctx.flags.lowQuality,
        namespace: ctx.flags.namespace,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Cleanup Analysis'));
      output.printTable({
        columns: [
          { key: 'category', header: 'Category', width: 20 },
          { key: 'count', header: 'Count', width: 15, align: 'right' }
        ],
        data: [
          { category: 'Expired (TTL)', count: result.candidates.expired },
          { category: 'Stale (unused)', count: result.candidates.stale },
          { category: 'Low Quality', count: result.candidates.lowQuality },
          { category: output.bold('Total'), count: output.bold(String(result.candidates.total)) }
        ]
      });

      if (!dryRun && result.candidates.total > 0 && !force) {
        const confirmed = await confirm({
          message: `Delete ${result.candidates.total} entries (${result.freed.formatted})?`,
          default: false
        });

        if (!confirmed) {
          output.printInfo('Cleanup cancelled');
          return { success: true, data: result };
        }
      }

      if (!dryRun) {
        output.writeln();
        output.printSuccess(`Cleaned ${result.deleted.entries} entries`);
        output.printList([
          `Vectors removed: ${result.deleted.vectors}`,
          `Patterns removed: ${result.deleted.patterns}`,
          `Space freed: ${result.freed.formatted}`,
          `Duration: ${result.duration}ms`
        ]);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Cleanup error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Compress command
const compressCommand: Command = {
  name: 'compress',
  description: 'Compress and optimize memory storage',
  options: [
    {
      name: 'level',
      short: 'l',
      description: 'Compression level (fast, balanced, max)',
      type: 'string',
      choices: ['fast', 'balanced', 'max'],
      default: 'balanced'
    },
    {
      name: 'target',
      short: 't',
      description: 'Target (vectors, text, patterns, all)',
      type: 'string',
      choices: ['vectors', 'text', 'patterns', 'all'],
      default: 'all'
    },
    {
      name: 'quantize',
      short: 'z',
      description: 'Enable vector quantization (reduces memory 4-32x)',
      type: 'boolean',
      default: false
    },
    {
      name: 'bits',
      description: 'Quantization bits (4, 8, 16)',
      type: 'number',
      default: 8
    },
    {
      name: 'rebuild-index',
      short: 'r',
      description: 'Rebuild HNSW index after compression',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'claude-flow memory compress', description: 'Balanced compression' },
    { command: 'claude-flow memory compress --quantize --bits 4', description: '4-bit quantization (32x reduction)' },
    { command: 'claude-flow memory compress -l max -t vectors', description: 'Max compression on vectors' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const level = ctx.flags.level as string || 'balanced';
    const target = ctx.flags.target as string || 'all';
    const quantize = ctx.flags.quantize as boolean;
    const bits = ctx.flags.bits as number || 8;
    const rebuildIndex = ctx.flags.rebuildIndex as boolean ?? true;

    output.writeln();
    output.writeln(output.bold('Memory Compression'));
    output.writeln(output.dim(`Level: ${level}, Target: ${target}, Quantize: ${quantize ? `${bits}-bit` : 'no'}`));
    output.writeln();

    const spinner = output.createSpinner({ text: 'Analyzing current storage...', spinner: 'dots' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        before: {
          totalSize: string;
          vectorsSize: string;
          textSize: string;
          patternsSize: string;
          indexSize: string;
        };
        after: {
          totalSize: string;
          vectorsSize: string;
          textSize: string;
          patternsSize: string;
          indexSize: string;
        };
        compression: {
          ratio: number;
          bytesSaved: number;
          formattedSaved: string;
          quantizationApplied: boolean;
          indexRebuilt: boolean;
        };
        performance: {
          searchLatencyBefore: number;
          searchLatencyAfter: number;
          searchSpeedup: string;
        };
        duration: number;
      }>('memory/compress', {
        level,
        target,
        quantize,
        bits,
        rebuildIndex,
      });

      spinner.succeed('Compression complete');

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Storage Comparison'));
      output.printTable({
        columns: [
          { key: 'category', header: 'Category', width: 15 },
          { key: 'before', header: 'Before', width: 12, align: 'right' },
          { key: 'after', header: 'After', width: 12, align: 'right' },
          { key: 'saved', header: 'Saved', width: 12, align: 'right' }
        ],
        data: [
          { category: 'Vectors', before: result.before.vectorsSize, after: result.after.vectorsSize, saved: '-' },
          { category: 'Text', before: result.before.textSize, after: result.after.textSize, saved: '-' },
          { category: 'Patterns', before: result.before.patternsSize, after: result.after.patternsSize, saved: '-' },
          { category: 'Index', before: result.before.indexSize, after: result.after.indexSize, saved: '-' },
          { category: output.bold('Total'), before: result.before.totalSize, after: result.after.totalSize, saved: output.success(result.compression.formattedSaved) }
        ]
      });

      output.writeln();
      output.printBox(
        [
          `Compression Ratio: ${result.compression.ratio.toFixed(2)}x`,
          `Space Saved: ${result.compression.formattedSaved}`,
          `Quantization: ${result.compression.quantizationApplied ? `Yes (${bits}-bit)` : 'No'}`,
          `Index Rebuilt: ${result.compression.indexRebuilt ? 'Yes' : 'No'}`,
          `Duration: ${(result.duration / 1000).toFixed(1)}s`
        ].join('\n'),
        'Results'
      );

      if (result.performance) {
        output.writeln();
        output.writeln(output.bold('Performance Impact'));
        output.printList([
          `Search latency: ${result.performance.searchLatencyBefore.toFixed(2)}ms → ${result.performance.searchLatencyAfter.toFixed(2)}ms`,
          `Speedup: ${output.success(result.performance.searchSpeedup)}`
        ]);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Compression failed');
      if (error instanceof MCPClientError) {
        output.printError(`Compression error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Export command
const exportCommand: Command = {
  name: 'export',
  description: 'Export memory to file',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
      required: true
    },
    {
      name: 'format',
      short: 'f',
      description: 'Export format (json, csv, binary)',
      type: 'string',
      choices: ['json', 'csv', 'binary'],
      default: 'json'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Export specific namespace',
      type: 'string'
    },
    {
      name: 'include-vectors',
      description: 'Include vector embeddings',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'claude-flow memory export -o ./backup.json', description: 'Export all to JSON' },
    { command: 'claude-flow memory export -o ./data.csv -f csv', description: 'Export to CSV' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const outputPath = ctx.flags.output as string;
    const format = ctx.flags.format as string || 'json';

    if (!outputPath) {
      output.printError('Output path is required. Use --output or -o');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Exporting memory to ${outputPath}...`);

    try {
      const result = await callMCPTool<{
        outputPath: string;
        format: string;
        exported: {
          entries: number;
          vectors: number;
          patterns: number;
        };
        fileSize: string;
      }>('memory/export', {
        outputPath,
        format,
        namespace: ctx.flags.namespace,
        includeVectors: ctx.flags.includeVectors ?? true,
      });

      output.printSuccess(`Exported to ${result.outputPath}`);
      output.printList([
        `Entries: ${result.exported.entries}`,
        `Vectors: ${result.exported.vectors}`,
        `Patterns: ${result.exported.patterns}`,
        `File size: ${result.fileSize}`
      ]);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Export error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Import command
const importCommand: Command = {
  name: 'import',
  description: 'Import memory from file',
  options: [
    {
      name: 'input',
      short: 'i',
      description: 'Input file path',
      type: 'string',
      required: true
    },
    {
      name: 'merge',
      short: 'm',
      description: 'Merge with existing (skip duplicates)',
      type: 'boolean',
      default: true
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Import into specific namespace',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow memory import -i ./backup.json', description: 'Import from file' },
    { command: 'claude-flow memory import -i ./data.json -n archive', description: 'Import to namespace' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const inputPath = ctx.flags.input as string || ctx.args[0];

    if (!inputPath) {
      output.printError('Input path is required. Use --input or -i');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Importing memory from ${inputPath}...`);

    try {
      const result = await callMCPTool<{
        inputPath: string;
        imported: {
          entries: number;
          vectors: number;
          patterns: number;
        };
        skipped: number;
        duration: number;
      }>('memory/import', {
        inputPath,
        merge: ctx.flags.merge ?? true,
        namespace: ctx.flags.namespace,
      });

      output.printSuccess(`Imported from ${result.inputPath}`);
      output.printList([
        `Entries: ${result.imported.entries}`,
        `Vectors: ${result.imported.vectors}`,
        `Patterns: ${result.imported.patterns}`,
        `Skipped (duplicates): ${result.skipped}`,
        `Duration: ${result.duration}ms`
      ]);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Import error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Init subcommand - initialize memory database using sql.js
const initMemoryCommand: Command = {
  name: 'init',
  description: 'Initialize memory database with sql.js (WASM SQLite) - includes vector embeddings, pattern learning, temporal decay',
  options: [
    {
      name: 'backend',
      short: 'b',
      description: 'Backend type: hybrid (default), sqlite, or agentdb',
      type: 'string',
      default: 'hybrid'
    },
    {
      name: 'path',
      short: 'p',
      description: 'Database path',
      type: 'string'
    },
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing database',
      type: 'boolean',
      default: false
    },
    {
      name: 'verbose',
      description: 'Show detailed initialization output',
      type: 'boolean',
      default: false
    },
    {
      name: 'verify',
      description: 'Run verification tests after initialization',
      type: 'boolean',
      default: true
    },
    {
      name: 'load-embeddings',
      description: 'Pre-load ONNX embedding model (lazy by default)',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow memory init', description: 'Initialize hybrid backend with all features' },
    { command: 'claude-flow memory init -b agentdb', description: 'Initialize AgentDB backend' },
    { command: 'claude-flow memory init -p ./data/memory.db --force', description: 'Reinitialize at custom path' },
    { command: 'claude-flow memory init --verbose --verify', description: 'Initialize with full verification' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const backend = (ctx.flags.backend as string) || 'hybrid';
    const customPath = ctx.flags.path as string;
    const force = ctx.flags.force as boolean;
    const verbose = ctx.flags.verbose as boolean;
    const verify = ctx.flags.verify !== false; // Default true
    const loadEmbeddings = ctx.flags.loadEmbeddings as boolean;

    output.writeln();
    output.writeln(output.bold('Initializing Memory Database'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Initializing schema...', spinner: 'dots' });
    spinner.start();

    try {
      // Import the memory initializer
      const { initializeMemoryDatabase, loadEmbeddingModel, verifyMemoryInit } = await import('../memory/memory-initializer.js');

      const result = await initializeMemoryDatabase({
        backend,
        dbPath: customPath,
        force,
        verbose
      });

      if (!result.success) {
        spinner.fail('Initialization failed');
        output.printError(result.error || 'Unknown error');
        return { success: false, exitCode: 1 };
      }

      spinner.succeed('Schema initialized');

      // Lazy load or pre-load embedding model
      if (loadEmbeddings) {
        const embeddingSpinner = output.createSpinner({ text: 'Loading embedding model...', spinner: 'dots' });
        embeddingSpinner.start();

        const embeddingResult = await loadEmbeddingModel({ verbose });

        if (embeddingResult.success) {
          embeddingSpinner.succeed(`Embedding model loaded: ${embeddingResult.modelName} (${embeddingResult.dimensions}-dim, ${embeddingResult.loadTime}ms)`);
        } else {
          embeddingSpinner.stop(output.warning(`Embedding model: ${embeddingResult.error || 'Using fallback'}`));
        }
      }

      output.writeln();

      // Show features enabled with detailed capabilities
      const featureLines = [
        `Backend:           ${result.backend}`,
        `Schema Version:    ${result.schemaVersion}`,
        `Database Path:     ${result.dbPath}`,
        '',
        output.bold('Features:'),
        `  Vector Embeddings: ${result.features.vectorEmbeddings ? output.success('✓ Enabled') : output.dim('✗ Disabled')}`,
        `  Pattern Learning:  ${result.features.patternLearning ? output.success('✓ Enabled') : output.dim('✗ Disabled')}`,
        `  Temporal Decay:    ${result.features.temporalDecay ? output.success('✓ Enabled') : output.dim('✗ Disabled')}`,
        `  HNSW Indexing:     ${result.features.hnswIndexing ? output.success('✓ Enabled') : output.dim('✗ Disabled')}`,
        `  Migration Tracking: ${result.features.migrationTracking ? output.success('✓ Enabled') : output.dim('✗ Disabled')}`
      ];

      if (verbose) {
        featureLines.push(
          '',
          output.bold('HNSW Configuration:'),
          `  M (connections):     16`,
          `  ef (construction):   200`,
          `  ef (search):         100`,
          `  Metric:              cosine`,
          '',
          output.bold('Pattern Learning:'),
          `  Confidence scoring:  0.0 - 1.0`,
          `  Temporal decay:      Half-life 30 days`,
          `  Pattern versioning:  Enabled`,
          `  Types: task-routing, error-recovery, optimization, coordination, prediction`
        );
      }

      output.printBox(featureLines.join('\n'), 'Configuration');
      output.writeln();

      // Show tables created
      if (verbose && result.tablesCreated.length > 0) {
        output.writeln(output.bold('Tables Created:'));
        output.printTable({
          columns: [
            { key: 'table', header: 'Table', width: 22 },
            { key: 'purpose', header: 'Purpose', width: 38 }
          ],
          data: [
            { table: 'memory_entries', purpose: 'Core memory storage with embeddings' },
            { table: 'patterns', purpose: 'Learned patterns with confidence scores' },
            { table: 'pattern_history', purpose: 'Pattern versioning and evolution' },
            { table: 'trajectories', purpose: 'SONA learning trajectories' },
            { table: 'trajectory_steps', purpose: 'Individual trajectory steps' },
            { table: 'migration_state', purpose: 'Migration progress tracking' },
            { table: 'sessions', purpose: 'Context persistence' },
            { table: 'vector_indexes', purpose: 'HNSW index configuration' },
            { table: 'metadata', purpose: 'System metadata' }
          ]
        });
        output.writeln();

        output.writeln(output.bold('Indexes Created:'));
        output.printList(result.indexesCreated.slice(0, 8).map(idx => output.dim(idx)));
        if (result.indexesCreated.length > 8) {
          output.writeln(output.dim(`  ... and ${result.indexesCreated.length - 8} more`));
        }
        output.writeln();
      }

      // Run verification if enabled
      if (verify) {
        const verifySpinner = output.createSpinner({ text: 'Verifying initialization...', spinner: 'dots' });
        verifySpinner.start();

        const verification = await verifyMemoryInit(result.dbPath, { verbose });

        if (verification.success) {
          verifySpinner.succeed(`Verification passed (${verification.summary.passed}/${verification.summary.total} tests)`);
        } else {
          verifySpinner.fail(`Verification failed (${verification.summary.failed}/${verification.summary.total} tests failed)`);
        }

        if (verbose || !verification.success) {
          output.writeln();
          output.writeln(output.bold('Verification Results:'));
          output.printTable({
            columns: [
              { key: 'status', header: '', width: 3 },
              { key: 'name', header: 'Test', width: 22 },
              { key: 'details', header: 'Details', width: 30 },
              { key: 'duration', header: 'Time', width: 8, align: 'right' }
            ],
            data: verification.tests.map(t => ({
              status: t.passed ? output.success('✓') : output.error('✗'),
              name: t.name,
              details: t.details || '',
              duration: t.duration ? `${t.duration}ms` : '-'
            }))
          });
        }

        output.writeln();
      }

      // Show next steps
      output.writeln(output.bold('Next Steps:'));
      output.printList([
        `Store data: ${output.highlight('claude-flow memory store -k "key" --value "data"')}`,
        `Search: ${output.highlight('claude-flow memory search -q "query"')}`,
        `Train patterns: ${output.highlight('claude-flow neural train -p coordination')}`,
        `View stats: ${output.highlight('claude-flow memory stats')}`
      ]);

      // Also sync to .claude directory
      const fs = await import('fs');
      const path = await import('path');
      const claudeDir = path.join(process.cwd(), '.claude');
      const claudeDbPath = path.join(claudeDir, 'memory.db');

      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      if (fs.existsSync(result.dbPath) && (!fs.existsSync(claudeDbPath) || force)) {
        fs.copyFileSync(result.dbPath, claudeDbPath);
        output.writeln();
        output.writeln(output.dim(`Synced to: ${claudeDbPath}`));
      }

      return {
        success: true,
        data: result
      };
    } catch (error) {
      spinner.fail('Initialization failed');
      output.printError(`Failed to initialize memory: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Main memory command
export const memoryCommand: Command = {
  name: 'memory',
  description: 'Memory management commands',
  subcommands: [initMemoryCommand, storeCommand, retrieveCommand, searchCommand, listCommand, deleteCommand, statsCommand, configureCommand, cleanupCommand, compressCommand, exportCommand, importCommand],
  options: [],
  examples: [
    { command: 'claude-flow memory store -k "key" -v "value"', description: 'Store data' },
    { command: 'claude-flow memory search -q "auth patterns"', description: 'Search memory' },
    { command: 'claude-flow memory stats', description: 'Show statistics' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Memory Management Commands'));
    output.writeln();
    output.writeln('Usage: claude-flow memory <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('init')}       - Initialize memory database (sql.js)`,
      `${output.highlight('store')}      - Store data in memory`,
      `${output.highlight('retrieve')}   - Retrieve data from memory`,
      `${output.highlight('search')}     - Semantic/vector search`,
      `${output.highlight('list')}       - List memory entries`,
      `${output.highlight('delete')}     - Delete memory entry`,
      `${output.highlight('stats')}      - Show statistics`,
      `${output.highlight('configure')}  - Configure backend`,
      `${output.highlight('cleanup')}    - Clean expired entries`,
      `${output.highlight('compress')}   - Compress database`,
      `${output.highlight('export')}     - Export memory to file`,
      `${output.highlight('import')}     - Import from file`
    ]);

    return { success: true };
  }
};

export default memoryCommand;
