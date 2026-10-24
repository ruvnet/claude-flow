import { getErrorMessage } from '../../utils/error-handler.js';
/**
 * Advanced Memory Management Commands
 * Implements comprehensive memory operations with advanced capabilities
 * Converted from @cliffy to simple CLI pattern
 */

import { promises as fs } from 'node:fs';
import { join, extname, basename } from 'node:path';
import {
  AdvancedMemoryManager,
  type QueryOptions,
  type ExportOptions,
  type ImportOptions,
  type CleanupOptions,
} from '../../memory/advanced-memory-manager.js';
import { Logger } from '../../core/logger.js';

// Initialize logger
const logger = Logger.getInstance();

// Global memory manager instance
let memoryManager: AdvancedMemoryManager | null = null;

// Helper functions
function printSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

function printError(message: string): void {
  console.error(`❌ ${message}`);
}

function printWarning(message: string): void {
  console.warn(`⚠️  ${message}`);
}

function printInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

async function ensureMemoryManager(): Promise<AdvancedMemoryManager> {
  if (!memoryManager) {
    memoryManager = new AdvancedMemoryManager(
      {
        maxMemorySize: 1024 * 1024 * 1024, // 1GB
        autoCompress: true,
        autoCleanup: true,
        indexingEnabled: true,
        persistenceEnabled: true,
      },
      logger,
    );

    await memoryManager.initialize();
  }
  return memoryManager;
}

// === MAIN MEMORY COMMAND ===

export async function advancedMemoryCommand(
  subArgs: string[],
  flags: Record<string, any>,
): Promise<void> {
  const subcommand = subArgs[0];

  if (!subcommand) {
    showAdvancedMemoryHelp();
    return;
  }

  try {
    switch (subcommand) {
      case 'query':
        await queryCommand(subArgs.slice(1), flags);
        break;
      case 'export':
        await exportCommand(subArgs.slice(1), flags);
        break;
      case 'import':
        await importCommand(subArgs.slice(1), flags);
        break;
      case 'stats':
        await statsCommand(subArgs.slice(1), flags);
        break;
      case 'cleanup':
        await cleanupCommand(subArgs.slice(1), flags);
        break;
      case 'store':
        await storeCommand(subArgs.slice(1), flags);
        break;
      case 'get':
        await getCommand(subArgs.slice(1), flags);
        break;
      case 'delete':
        await deleteCommand(subArgs.slice(1), flags);
        break;
      case 'list':
        await listCommand(subArgs.slice(1), flags);
        break;
      case 'namespaces':
        await namespacesCommand(subArgs.slice(1), flags);
        break;
      case 'types':
        await typesCommand(subArgs.slice(1), flags);
        break;
      case 'tags':
        await tagsCommand(subArgs.slice(1), flags);
        break;
      case 'config':
        await configCommand(subArgs.slice(1), flags);
        break;
      default:
        printError(`Unknown command: ${subcommand}`);
        showAdvancedMemoryHelp();
    }
  } catch (error) {
    const message = getErrorMessage(error);
    printError(`Command failed: ${message}`);
    logger.error('Advanced memory command error', { error: message, subcommand, subArgs, flags });
  }
}

function showAdvancedMemoryHelp(): void {
  console.log('🧠 Advanced Memory Management System\n');
  console.log('Available commands:');
  console.log(
    '  memory query <search> [options]     - Flexible searching with filters and aggregation',
  );
  console.log('  memory export <file> [options]      - Export memory data in multiple formats');
  console.log(
    '  memory import <file> [options]      - Import data with validation and transformation',
  );
  console.log(
    '  memory stats [options]              - Comprehensive statistics and optimization suggestions',
  );
  console.log(
    '  memory cleanup [options]            - Intelligent cleanup with archiving and retention',
  );
  console.log('  memory store <key> <value> [opts]   - Store data with advanced options');
  console.log('  memory get <key> [options]          - Retrieve data with caching');
  console.log('  memory delete <key> [options]       - Delete specific entries');
  console.log('  memory list [options]               - List entries with filtering');
  console.log('  memory namespaces                   - List all namespaces');
  console.log('  memory types                        - List all data types');
  console.log('  memory tags                         - List all tags');
  console.log('  memory config [options]             - View/update configuration');
  console.log('\nFeatures:');
  console.log('  • Advanced querying with indexing and full-text search');
  console.log('  • Multiple export/import formats (JSON, CSV, XML, YAML)');
  console.log('  • Intelligent cleanup with retention policies');
  console.log('  • Compression and encryption support');
  console.log('  • Cross-agent sharing and synchronization');
  console.log('  • Performance analytics and optimization suggestions');
}

// === INDIVIDUAL COMMAND FUNCTIONS ===

async function queryCommand(args: string[], flags: Record<string, any>): Promise<void> {
  const search = args[0];

  if (!search) {
    printError('Usage: memory query <search> [options]');
    console.log('Options:');
    console.log('  --namespace <ns>        Filter by namespace');
    console.log('  --type <type>           Filter by data type');
    console.log('  --tags <tags>           Filter by tags (comma-separated)');
    console.log('  --owner <owner>         Filter by owner');
    console.log('  --access-level <level>  Filter by access level (private|shared|public)');
    console.log('  --key-pattern <pattern> Key pattern (regex)');
    console.log('  --value-search <text>   Search in values');
    console.log('  --full-text <text>      Full-text search');
    console.log('  --created-after <date>  Created after date (ISO format)');
    console.log('  --created-before <date> Created before date (ISO format)');
    console.log('  --updated-after <date>  Updated after date (ISO format)');
    console.log('  --updated-before <date> Updated before date (ISO format)');
    console.log('  --size-gt <bytes>       Size greater than (bytes)');
    console.log('  --size-lt <bytes>       Size less than (bytes)');
    console.log('  --include-expired       Include expired entries');
    console.log('  --limit <num>           Limit results');
    console.log('  --offset <num>          Offset for pagination');
    console.log(
      '  --sort-by <field>       Sort by field (key|createdAt|updatedAt|lastAccessedAt|size|type)',
    );
    console.log('  --sort-order <order>    Sort order (asc|desc)');
    console.log('  --aggregate-by <field>  Generate aggregations (namespace|type|owner|tags)');
    console.log('  --include-metadata      Include full metadata in results');
    console.log('  --format <format>       Output format (table|json|csv)');
    return;
  }

  try {
    const manager = await ensureMemoryManager();
    const startTime = Date.now();

    // Build query options from flags
    const queryOptions: QueryOptions = {
      fullTextSearch: search,
      namespace: flags.namespace,
      type: flags.type,
      tags: flags.tags ? flags.tags.split(',').map((t: string) => t.trim()) : undefined,
      owner: flags.owner,
      accessLevel: flags['access-level'],
      keyPattern: flags['key-pattern'],
      valueSearch: flags['value-search'],
      createdAfter: flags['created-after'] ? new Date(flags['created-after']) : undefined,
      createdBefore: flags['created-before'] ? new Date(flags['created-before']) : undefined,
      updatedAfter: flags['updated-after'] ? new Date(flags['updated-after']) : undefined,
      updatedBefore: flags['updated-before'] ? new Date(flags['updated-before']) : undefined,
      sizeGreaterThan: flags['size-gt'] ? parseInt(flags['size-gt']) : undefined,
      sizeLessThan: flags['size-lt'] ? parseInt(flags['size-lt']) : undefined,
      includeExpired: flags['include-expired'],
      limit: flags.limit ? parseInt(flags.limit) : undefined,
      offset: flags.offset ? parseInt(flags.offset) : undefined,
      sortBy: flags['sort-by'],
      sortOrder: flags['sort-order'] || 'asc',
      aggregateBy: flags['aggregate-by'],
      includeMetadata: flags['include-metadata'],
    };

    const result = await manager.query(queryOptions);
    const duration = Date.now() - startTime;

    printSuccess(`Found ${result.total} entries in ${formatDuration(duration)}`);

    if (result.entries.length === 0) {
      printInfo('No entries match your query criteria.');
      return;
    }

    // Display results based on format
    const format = flags.format || 'table';
    switch (format) {
      case 'json':
        console.log(
          JSON.stringify(
            {
              query: queryOptions,
              results: result,
              executionTime: duration,
            },
            null,
            2,
          ),
        );
        break;

      case 'csv':
        console.log('key,value,type,namespace,tags,size,created,updated');
        for (const entry of result.entries) {
          console.log(
            [
              entry.key,
              JSON.stringify(entry.value).replace(/"/g, '""'),
              entry.type,
              entry.namespace,
              entry.tags.join(';'),
              entry.size,
              entry.createdAt.toISOString(),
              entry.updatedAt.toISOString(),
            ].join(','),
          );
        }
        break;

      default: // table
        console.log('\n📋 Query Results:\n');
        result.entries.forEach((entry, i) => {
          const value =
            typeof entry.value === 'string' && entry.value.length > 100
              ? entry.value.substring(0, 100) + '...'
              : JSON.stringify(entry.value);

          console.log(`${i + 1}. ${entry.key}`);
          console.log(
            `   Type: ${entry.type} | Namespace: ${entry.namespace} | Size: ${formatBytes(entry.size)}`,
          );
          console.log(`   Tags: [${entry.tags.join(', ')}]`);
          console.log(`   Value: ${value}`);
          console.log(
            `   Created: ${entry.createdAt.toLocaleString()} | Updated: ${entry.updatedAt.toLocaleString()}`,
          );
          console.log(`   Last Accessed: ${entry.lastAccessedAt.toLocaleString()}`);

          if (flags['include-metadata'] && Object.keys(entry.metadata).length > 0) {
            console.log(`   Metadata: ${JSON.stringify(entry.metadata)}`);
          }
          console.log();
        });
    }

    // Show aggregations if requested
    if (result.aggregations) {
      console.log('\n📊 Aggregations:\n');
      for (const [key, value] of Object.entries(result.aggregations)) {
        console.log(`${key}:`);
        for (const [subKey, stats] of Object.entries(value as Record<string, any>)) {
          console.log(`  ${subKey}: ${stats.count} entries, ${formatBytes(stats.totalSize)}`);
        }
        console.log();
      }
    }

    // Show pagination info
    if (result.total > result.entries.length) {
      const showing = (flags.offset ? parseInt(flags.offset) : 0) + result.entries.length;
      console.log(`Showing ${showing} of ${result.total} entries`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Query failed: ${message}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}

async function exportCommand(args: string[], flags: Record<string, any>): Promise<void> {
  const file = args[0];

  if (!file) {
    printError('Usage: memory export <file> [options]');
    console.log('Options:');
    console.log('  --format <format>       Export format (json|csv|xml|yaml)');
    console.log('  --namespace <namespace> Export specific namespace');
    console.log('  --type <type>           Export specific type');
    console.log('  --include-metadata      Include full metadata');
    console.log('  --compression           Enable compression');
    console.log('  --encrypt               Enable encryption');
    console.log('  --encrypt-key <key>     Encryption key');
    console.log('  --filter-query <json>   Advanced filtering (JSON query options)');
    return;
  }

  try {
    const manager = await ensureMemoryManager();

    // Determine format from file extension if not specified
    let format = flags.format;
    if (!format) {
      const ext = extname(file).toLowerCase();
      switch (ext) {
        case '.json':
          format = 'json';
          break;
        case '.csv':
          format = 'csv';
          break;
        case '.xml':
          format = 'xml';
          break;
        case '.yaml':
        case '.yml':
          format = 'yaml';
          break;
        default:
          format = 'json';
      }
    }

    // Parse filter query if provided
    let filtering: QueryOptions | undefined;
    if (flags['filter-query']) {
      try {
        filtering = JSON.parse(flags['filter-query']);
      } catch (error) {
        printError('Invalid filter query JSON format');
        return;
      }
    }

    // Build export options
    const exportOptions: ExportOptions = {
      format: format as ExportOptions['format'],
      namespace: flags.namespace,
      type: flags.type,
      includeMetadata: flags['include-metadata'],
      compression: flags.compression,
      encryption: flags.encrypt
        ? {
            enabled: true,
            key: flags['encrypt-key'],
          }
        : undefined,
      filtering,
    };

    printInfo(`Starting export to ${file} (format: ${format})`);
    const startTime = Date.now();

    const result = await manager.export(file, exportOptions);
    const duration = Date.now() - startTime;

    printSuccess(`Export completed in ${formatDuration(duration)}`);
    console.log(`📊 Exported: ${result.entriesExported} entries`);
    console.log(`📁 File size: ${formatBytes(result.fileSize)}`);
    console.log(`🔒 Checksum: ${result.checksum}`);

    if (flags.compression) {
      printInfo('Data was compressed during export');
    }
    if (flags.encrypt) {
      printInfo('Data was encrypted during export');
    }
  } catch (error) {
    printError(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}

async function importCommand(args: string[], flags: Record<string, any>): Promise<void> {
  const file = args[0];

  if (!file) {
    printError('Usage: memory import <file> [options]');
    console.log('Options:');
    console.log('  --format <format>           Import format (json|csv|xml|yaml)');
    console.log('  --namespace <namespace>     Target namespace for imported data');
    console.log(
      '  --conflict-resolution <strategy> Conflict resolution (overwrite|skip|merge|rename)',
    );
    console.log('  --validation                Enable data validation');
    console.log('  --dry-run                   Show what would be imported without making changes');
    return;
  }

  try {
    // Check if file exists
    try {
      await fs.access(file);
    } catch {
      printError(`File not found: ${file}`);
      return;
    }

    const manager = await ensureMemoryManager();

    // Determine format from file extension if not specified
    let format = flags.format;
    if (!format) {
      const ext = extname(file).toLowerCase();
      switch (ext) {
        case '.json':
          format = 'json';
          break;
        case '.csv':
          format = 'csv';
          break;
        case '.xml':
          format = 'xml';
          break;
        case '.yaml':
        case '.yml':
          format = 'yaml';
          break;
        default:
          printError('Cannot determine format from file extension. Please specify --format');
          return;
      }
    }

    // Build import options
    const importOptions: ImportOptions = {
      format: format as ImportOptions['format'],
      namespace: flags.namespace,
      conflictResolution: flags['conflict-resolution'] || 'skip',
      validation: flags.validation,
      dryRun: flags['dry-run'],
    };

    if (flags['dry-run']) {
      printWarning('DRY RUN MODE - No changes will be made');
    }

    printInfo(`Starting import from ${file} (format: ${format})`);
    const startTime = Date.now();

    const result = await manager.import(file, importOptions);
    const duration = Date.now() - startTime;

    printSuccess(`Import completed in ${formatDuration(duration)}`);

    if (result.entriesImported > 0) {
      console.log(`📥 Imported: ${result.entriesImported} entries`);
    }
    if (result.entriesUpdated > 0) {
      console.log(`🔄 Updated: ${result.entriesUpdated} entries`);
    }
    if (result.entriesSkipped > 0) {
      console.log(`⏭️  Skipped: ${result.entriesSkipped} entries`);
    }
    if (result.conflicts.length > 0) {
      console.log(`⚠️  Conflicts: ${result.conflicts.length}`);
      if (result.conflicts.length <= 10) {
        result.conflicts.forEach((conflict) => {
          console.log(`   • ${conflict}`);
        });
      } else {
        result.conflicts.slice(0, 10).forEach((conflict) => {
          console.log(`   • ${conflict}`);
        });
        console.log(`   ... and ${result.conflicts.length - 10} more`);
      }
    }
  } catch (error) {
    printError(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}

async function statsCommand(args: string[], flags: Record<string, any>): Promise<void> {
  try {
    const manager = await ensureMemoryManager();
    const startTime = Date.now();

    const stats = await manager.getStatistics();
    const duration = Date.now() - startTime;

    if (flags.format === 'json') {
      const output = {
        statistics: stats,
        generatedAt: new Date().toISOString(),
        generationTime: duration,
      };

      if (flags.export) {
        await fs.writeFile(flags.export, JSON.stringify(output, null, 2));
        printSuccess(`Statistics exported to ${flags.export}`);
      } else {
        console.log(JSON.stringify(output, null, 2));
      }
      return;
    }

    // Table format display
    console.log('🧠 Memory System Statistics\n');

    // Overview
    console.log('📊 Overview:');
    console.log(`   Total Entries: ${stats.overview.totalEntries.toLocaleString()}`);
    console.log(`   Total Size: ${formatBytes(stats.overview.totalSize)}`);
    console.log(
      `   Compressed Entries: ${stats.overview.compressedEntries.toLocaleString()} (${(stats.overview.compressionRatio * 100).toFixed(1)}% compression)`,
    );
    console.log(`   Index Size: ${formatBytes(stats.overview.indexSize)}`);
    console.log(`   Memory Usage: ${formatBytes(stats.overview.memoryUsage)}`);
    console.log(`   Disk Usage: ${formatBytes(stats.overview.diskUsage)}`);
    console.log();

    // Distribution
    console.log('📈 Distribution:');

    if (Object.keys(stats.distribution.byNamespace).length > 0) {
      console.log('   By Namespace:');
      for (const [namespace, data] of Object.entries(stats.distribution.byNamespace)) {
        console.log(`     ${namespace}: ${data.count} entries, ${formatBytes(data.size)}`);
      }
    }

    if (Object.keys(stats.distribution.byType).length > 0) {
      console.log('   By Type:');
      for (const [type, data] of Object.entries(stats.distribution.byType)) {
        console.log(`     ${type}: ${data.count} entries, ${formatBytes(data.size)}`);
      }
    }
    console.log();

    // Performance
    console.log('⚡ Performance:');
    console.log(`   Average Query Time: ${formatDuration(stats.performance.averageQueryTime)}`);
    console.log(`   Average Write Time: ${formatDuration(stats.performance.averageWriteTime)}`);
    console.log(`   Cache Hit Ratio: ${(stats.performance.cacheHitRatio * 100).toFixed(1)}%`);
    console.log(`   Index Efficiency: ${(stats.performance.indexEfficiency * 100).toFixed(1)}%`);
    console.log();

    // Health
    console.log('🏥 Health:');
    const healthStatus = stats.health.recommendedCleanup ? 'Needs Attention' : 'Healthy';
    console.log(`   Status: ${healthStatus}`);
    console.log(`   Expired Entries: ${stats.health.expiredEntries}`);
    console.log(`   Orphaned References: ${stats.health.orphanedReferences}`);
    console.log(`   Duplicate Keys: ${stats.health.duplicateKeys}`);
    console.log(`   Corrupted Entries: ${stats.health.corruptedEntries}`);
    console.log();

    // Optimization suggestions
    if (stats.optimization.suggestions.length > 0) {
      console.log('💡 Optimization Suggestions:');
      stats.optimization.suggestions.forEach((suggestion) => {
        console.log(`   • ${suggestion}`);
      });
      console.log();

      console.log('💰 Potential Savings:');
      console.log(
        `   Compression: ${formatBytes(stats.optimization.potentialSavings.compression)}`,
      );
      console.log(`   Cleanup: ${formatBytes(stats.optimization.potentialSavings.cleanup)}`);
      console.log(
        `   Deduplication: ${formatBytes(stats.optimization.potentialSavings.deduplication)}`,
      );
      console.log();
    }

    console.log(`Statistics generated in ${formatDuration(duration)}`);

    // Export if requested
    if (flags.export) {
      const output = {
        statistics: stats,
        generatedAt: new Date().toISOString(),
        generationTime: duration,
      };
      await fs.writeFile(flags.export, JSON.stringify(output, null, 2));
      printSuccess(`Statistics exported to ${flags.export}`);
    }
  } catch (error) {
    printError(`Stats failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}

async function cleanupCommand(args: string[], flags: Record<string, any>): Promise<void> {
  try {
    const manager = await ensureMemoryManager();

    if (flags['dry-run']) {
      printWarning('DRY RUN MODE - No changes will be made');
    }

    // Build cleanup options
    const cleanupOptions: CleanupOptions = {
      dryRun: flags['dry-run'],
      removeExpired: flags['remove-expired'] !== false,
      removeOlderThan: flags['remove-older-than']
        ? parseInt(flags['remove-older-than'])
        : undefined,
      removeUnaccessed: flags['remove-unaccessed']
        ? parseInt(flags['remove-unaccessed'])
        : undefined,
      removeOrphaned: flags['remove-orphaned'] !== false,
      removeDuplicates: flags['remove-duplicates'],
      compressEligible: flags['compress-eligible'] !== false,
      archiveOld: flags['archive-old']
        ? {
            enabled: true,
            olderThan: flags['archive-older-than'] ? parseInt(flags['archive-older-than']) : 365,
            archivePath: flags['archive-path'] || './memory/archive',
          }
        : undefined,
    };

    printInfo('Starting memory cleanup...');
    const startTime = Date.now();

    const result = await manager.cleanup(cleanupOptions);
    const duration = Date.now() - startTime;

    printSuccess(`Cleanup completed in ${formatDuration(duration)}`);

    if (result.entriesRemoved > 0) {
      console.log(`🗑️  Removed: ${result.entriesRemoved} entries`);
    }
    if (result.entriesArchived > 0) {
      console.log(`📦 Archived: ${result.entriesArchived} entries`);
    }
    if (result.entriesCompressed > 0) {
      console.log(`🗜️  Compressed: ${result.entriesCompressed} entries`);
    }
    if (result.spaceSaved > 0) {
      console.log(`💾 Space Saved: ${formatBytes(result.spaceSaved)}`);
    }

    if (result.actions.length > 0) {
      console.log('\n📋 Actions Performed:');
      result.actions.forEach((action) => {
        console.log(`   • ${action}`);
      });
    }

    if (flags['dry-run'] && (result.entriesRemoved > 0 || result.entriesArchived > 0)) {
      printInfo('Run without --dry-run to perform these actions');
    }
  } catch (error) {
    printError(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}

async function storeCommand(args: string[], flags: Record<string, any>): Promise<void> {
  const key = args[0];
  const value = args.slice(1).join(' ');

  if (!key || !value) {
    printError('Usage: memory store <key> <value> [options]');
    console.log('Options:');
    console.log('  --namespace <namespace> Target namespace (default: default)');
    console.log('  --type <type>           Data type');
    console.log('  --tags <tags>           Tags (comma-separated)');
    console.log('  --owner <owner>         Entry owner (default: system)');
    console.log('  --access-level <level>  Access level (private|shared|public, default: shared)');
    console.log('  --ttl <ms>              Time-to-live in milliseconds');
    console.log('  --compress              Force compression');
    return;
  }

  try {
    const manager = await ensureMemoryManager();

    // Parse value as JSON if possible
    let parsedValue;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }

    const entryId = await manager.store(key, parsedValue, {
      namespace: flags.namespace || 'default',
      type: flags.type,
      tags: flags.tags ? flags.tags.split(',').map((t: string) => t.trim()) : undefined,
      owner: flags.owner || 'system',
      accessLevel: flags['access-level'] || 'shared',
      ttl: flags.ttl ? parseInt(flags.ttl) : undefined,
      compress: flags.compress,
    });

    printSuccess('Entry stored successfully');
    console.log(`📝 Entry ID: ${entryId}`);
    console.log(`🔑 Key: ${key}`);
    console.log(`📦 Namespace: ${flags.namespace || 'default'}`);
    console.log(`🏷️  Type: ${flags.type || 'auto-detected'}`);

    if (flags.tags) {
      console.log(`🏷️  Tags: [${flags.tags}]`);
    }
    if (flags.ttl) {
      const expiresAt = new Date(Date.now() + parseInt(flags.ttl));
      console.log(`⏰ Expires: ${expiresAt.toLocaleString()}`);
    }
  } catch (error) {
    printError(`Store failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getCommand(args: string[], flags: Record<string, any>): Promise<void> {
  const key = args[0];

  if (!key) {
    printError('Usage: memory get <key> [options]');
    console.log('Options:');
    console.log('  --namespace <namespace> Target namespace');
    console.log('  --format <format>       Output format (json|pretty, default: pretty)');
    return;
  }

  try {
    const manager = await ensureMemoryManager();

    const entry = await manager.retrieve(key, {
      namespace: flags.namespace,
      updateLastAccessed: true,
    });

    if (!entry) {
      printWarning(`Entry not found: ${key}`);
      return;
    }

    if (flags.format === 'json') {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      printSuccess(`Entry found: ${key}`);
      console.log(`📝 Entry ID: ${entry.id}`);
      console.log(`🔑 Key: ${entry.key}`);
      console.log(`📦 Namespace: ${entry.namespace}`);
      console.log(`🏷️  Type: ${entry.type}`);
      console.log(`💾 Size: ${formatBytes(entry.size)}`);
      console.log(`📊 Version: ${entry.version}`);
      console.log(`👤 Owner: ${entry.owner}`);
      console.log(`🔒 Access: ${entry.accessLevel}`);

      if (entry.tags.length > 0) {
        console.log(`🏷️  Tags: [${entry.tags.join(', ')}]`);
      }

      console.log(`📅 Created: ${entry.createdAt.toLocaleString()}`);
      console.log(`📅 Updated: ${entry.updatedAt.toLocaleString()}`);
      console.log(`📅 Last Accessed: ${entry.lastAccessedAt.toLocaleString()}`);

      if (entry.expiresAt) {
        console.log(`⏰ Expires: ${entry.expiresAt.toLocaleString()}`);
      }

      if (entry.compressed) {
        console.log(`🗜️  Compressed: Yes`);
      }

      console.log(`💾 Value:`);
      if (typeof entry.value === 'string' && entry.value.length > 500) {
        console.log(entry.value.substring(0, 500) + '...');
        console.log(`(showing first 500 characters of ${entry.value.length} total)`);
      } else {
        console.log(JSON.stringify(entry.value, null, 2));
      }
    }
  } catch (error) {
    printError(`Retrieve failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function deleteCommand(args: string[], flags: Record<string, any>): Promise<void> {
  const key = args[0];

  if (!key) {
    printError('Usage: memory delete <key> [options]');
    console.log('Options:');
    console.log('  --namespace <namespace> Target namespace');
    console.log('  --confirm               Skip confirmation prompt');
    return;
  }

  try {
    const manager = await ensureMemoryManager();

    const entry = await manager.retrieve(key, { namespace: flags.namespace });
    if (!entry) {
      printWarning(`Entry not found: ${key}`);
      return;
    }

    if (!flags.confirm) {
      console.log(`About to delete entry: ${key} (namespace: ${entry.namespace})`);
      console.log('Add --confirm to proceed without this prompt');
      return;
    }

    const success = await manager.deleteEntry(entry.id);

    if (success) {
      printSuccess(`Entry deleted: ${key}`);
    } else {
      printError(`Failed to delete entry: ${key}`);
    }
  } catch (error) {
    printError(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listCommand(args: string[], flags: Record<string, any>): Promise<void> {
  try {
    const manager = await ensureMemoryManager();

    const result = await manager.query({
      namespace: flags.namespace,
      type: flags.type,
      limit: flags.limit ? parseInt(flags.limit) : 20,
      offset: flags.offset ? parseInt(flags.offset) : 0,
      sortBy: flags['sort-by'] || 'updatedAt',
      sortOrder: flags['sort-order'] || 'desc',
    });

    if (result.entries.length === 0) {
      printInfo('No entries found');
      return;
    }

    console.log(`\n📋 Memory Entries (${result.total} total):\n`);

    result.entries.forEach((entry, i) => {
      const num = (flags.offset ? parseInt(flags.offset) : 0) + i + 1;
      console.log(`${num}. ${entry.key}`);
      console.log(
        `   Namespace: ${entry.namespace} | Type: ${entry.type} | Size: ${formatBytes(entry.size)}`,
      );
      console.log(`   Updated: ${entry.updatedAt.toLocaleString()}`);

      if (entry.tags.length > 0) {
        console.log(`   Tags: [${entry.tags.join(', ')}]`);
      }
      console.log();
    });

    if (result.total > result.entries.length) {
      const showing = (flags.offset ? parseInt(flags.offset) : 0) + result.entries.length;
      console.log(`Showing ${showing} of ${result.total} entries`);
    }
  } catch (error) {
    printError(`List failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function namespacesCommand(args: string[], flags: Record<string, any>): Promise<void> {
  try {
    const manager = await ensureMemoryManager();
    const namespaces = await manager.listNamespaces();

    if (namespaces.length === 0) {
      printInfo('No namespaces found');
      return;
    }

    console.log('\n📁 Namespaces:\n');
    namespaces.forEach((namespace, i) => {
      console.log(`${i + 1}. ${namespace}`);
    });
  } catch (error) {
    printError(
      `Failed to list namespaces: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function typesCommand(args: string[], flags: Record<string, any>): Promise<void> {
  try {
    const manager = await ensureMemoryManager();
    const types = await manager.listTypes();

    if (types.length === 0) {
      printInfo('No types found');
      return;
    }

    console.log('\n🏷️  Data Types:\n');
    types.forEach((type, i) => {
      console.log(`${i + 1}. ${type}`);
    });
  } catch (error) {
    printError(`Failed to list types: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function tagsCommand(args: string[], flags: Record<string, any>): Promise<void> {
  try {
    const manager = await ensureMemoryManager();
    const tags = await manager.listTags();

    if (tags.length === 0) {
      printInfo('No tags found');
      return;
    }

    console.log('\n🏷️  Tags:\n');
    tags.forEach((tag, i) => {
      console.log(`${i + 1}. ${tag}`);
    });
  } catch (error) {
    printError(`Failed to list tags: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function configCommand(args: string[], flags: Record<string, any>): Promise<void> {
  try {
    const manager = await ensureMemoryManager();

    if (flags.set) {
      try {
        const updates = JSON.parse(flags.set);
        await manager.updateConfiguration(updates);
        printSuccess('Configuration updated');
      } catch (error) {
        printError('Invalid configuration JSON format');
        return;
      }
    }

    if (flags.show || !flags.set) {
      const config = manager.getConfiguration();
      console.log('\n⚙️  Memory System Configuration:\n');
      console.log(JSON.stringify(config, null, 2));
    }
  } catch (error) {
    printError(
      `Configuration operation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
