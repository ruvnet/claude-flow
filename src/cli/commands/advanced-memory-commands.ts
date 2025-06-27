/**
 * Advanced Memory Management Commands
 * Implements comprehensive memory operations with advanced capabilities
 */

import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join, extname, basename } from 'node:path';
import chalk from 'chalk';
import { AdvancedMemoryManager, QueryOptions, ExportOptions, ImportOptions, CleanupOptions } from '../../memory/advanced-memory-manager.js';
import { Logger } from '../../core/logger.js';

// Initialize logger
const logger = Logger.getInstance();

// Global memory manager instance
let memoryManager: AdvancedMemoryManager | null = null;

// Register cleanup handler for process termination
process.on('SIGINT', async () => {
  if (memoryManager) {
    console.log('\nShutting down memory manager...');
    await memoryManager.shutdown();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (memoryManager) {
    await memoryManager.shutdown();
  }
  process.exit(0);
});

// Helper functions
function printSuccess(message: string): void {
  console.log(chalk.green(`✅ ${message}`));
}

function printError(message: string): void {
  console.error(chalk.red(`❌ ${message}`));
}

function printWarning(message: string): void {
  console.warn(chalk.yellow(`⚠️  ${message}`));
}

function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ️  ${message}`));
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
    memoryManager = new AdvancedMemoryManager({
      maxMemorySize: 1024 * 1024 * 1024, // 1GB
      autoCompress: true,
      autoCleanup: true,
      indexingEnabled: true,
      persistenceEnabled: true
    }, logger);
    
    await memoryManager.initialize();
  }
  return memoryManager;
}

// === MAIN MEMORY COMMAND ===

export function createAdvancedMemoryCommand(): Command {
  const memoryCmd = new Command('memory')
    .description('Advanced memory management with indexing, compression, and cross-agent sharing')
    .action(() => {
      console.log(chalk.cyan.bold('🧠 Advanced Memory Management System\n'));
      console.log('Available commands:');
      console.log('  memory query <search> [options]     - Flexible searching with filters and aggregation');
      console.log('  memory export <file> [options]      - Export memory data in multiple formats');
      console.log('  memory import <file> [options]      - Import data with validation and transformation');
      console.log('  memory stats [options]              - Comprehensive statistics and optimization suggestions');
      console.log('  memory cleanup [options]            - Intelligent cleanup with archiving and retention');
      console.log('  memory store <key> <value> [opts]   - Store data with advanced options');
      console.log('  memory get <key> [options]          - Retrieve data with caching');
      console.log('  memory update <key> <value> [opts]  - Update existing entries');
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
      process.exit(0);
    });

  // === QUERY COMMAND ===
  memoryCmd
    .command('query')
    .description('Advanced query with filtering, search, and aggregation')
    .argument('<search>', 'Search term or pattern')
    .option('-n, --namespace <namespace>', 'Filter by namespace')
    .option('-t, --type <type>', 'Filter by data type')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--owner <owner>', 'Filter by owner')
    .option('--access-level <level>', 'Filter by access level (private|shared|public)')
    .option('--key-pattern <pattern>', 'Key pattern (regex)')
    .option('--value-search <text>', 'Search in values')
    .option('--full-text <text>', 'Full-text search')
    .option('--created-after <date>', 'Created after date (ISO format)')
    .option('--created-before <date>', 'Created before date (ISO format)')
    .option('--updated-after <date>', 'Updated after date (ISO format)')
    .option('--updated-before <date>', 'Updated before date (ISO format)')
    .option('--size-gt <bytes>', 'Size greater than (bytes)', parseInt)
    .option('--size-lt <bytes>', 'Size less than (bytes)', parseInt)
    .option('--include-expired', 'Include expired entries')
    .option('--limit <num>', 'Limit results', parseInt)
    .option('--offset <num>', 'Offset for pagination', parseInt)
    .option('--sort-by <field>', 'Sort by field (key|createdAt|updatedAt|lastAccessedAt|size|type)')
    .option('--sort-order <order>', 'Sort order (asc|desc)', 'asc')
    .option('--aggregate-by <field>', 'Generate aggregations (namespace|type|owner|tags)')
    .option('--include-metadata', 'Include full metadata in results')
    .option('--format <format>', 'Output format (table|json|csv)', 'table')
    .action(async (search, options) => {
      try {
        const manager = await ensureMemoryManager();
        const startTime = Date.now();

        // Build query options
        const queryOptions: QueryOptions = {
          fullTextSearch: search,
          namespace: options.namespace,
          type: options.type,
          tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined,
          owner: options.owner,
          accessLevel: options.accessLevel,
          keyPattern: options.keyPattern,
          valueSearch: options.valueSearch,
          createdAfter: options.createdAfter ? new Date(options.createdAfter) : undefined,
          createdBefore: options.createdBefore ? new Date(options.createdBefore) : undefined,
          updatedAfter: options.updatedAfter ? new Date(options.updatedAfter) : undefined,
          updatedBefore: options.updatedBefore ? new Date(options.updatedBefore) : undefined,
          sizeGreaterThan: options.sizeGt,
          sizeLessThan: options.sizeLt,
          includeExpired: options.includeExpired,
          limit: options.limit,
          offset: options.offset,
          sortBy: options.sortBy,
          sortOrder: options.sortOrder,
          aggregateBy: options.aggregateBy,
          includeMetadata: options.includeMetadata
        };

        const result = await manager.query(queryOptions);
        const duration = Date.now() - startTime;

        printSuccess(`Found ${result.total} entries in ${formatDuration(duration)}`);

        if (result.entries.length === 0) {
          printInfo('No entries match your query criteria.');
          return;
        }

        // Display results based on format
        switch (options.format) {
          case 'json':
            console.log(JSON.stringify({
              query: queryOptions,
              results: result,
              executionTime: duration
            }, null, 2));
            break;

          case 'csv':
            console.log('key,value,type,namespace,tags,size,created,updated');
            for (const entry of result.entries) {
              console.log([
                entry.key,
                JSON.stringify(entry.value).replace(/"/g, '""'),
                entry.type,
                entry.namespace,
                entry.tags.join(';'),
                entry.size,
                entry.createdAt.toISOString(),
                entry.updatedAt.toISOString()
              ].join(','));
            }
            break;

          default: // table
            console.log(chalk.cyan('\n📋 Query Results:\n'));
            for (const [i, entry] of result.entries.entries()) {
              const value = typeof entry.value === 'string' && entry.value.length > 100 
                ? entry.value.substring(0, 100) + '...'
                : JSON.stringify(entry.value);

              console.log(chalk.blue(`${i + 1}. ${entry.key}`));
              console.log(`   Type: ${entry.type} | Namespace: ${entry.namespace} | Size: ${formatBytes(entry.size)}`);
              console.log(`   Tags: [${entry.tags.join(', ')}]`);
              console.log(`   Value: ${value}`);
              console.log(`   Created: ${entry.createdAt.toLocaleString()} | Updated: ${entry.updatedAt.toLocaleString()}`);
              console.log(`   Last Accessed: ${entry.lastAccessedAt.toLocaleString()}`);
              
              if (options.includeMetadata && Object.keys(entry.metadata).length > 0) {
                console.log(`   Metadata: ${JSON.stringify(entry.metadata)}`);
              }
              console.log();
            }
        }

        // Show aggregations if requested
        if (result.aggregations) {
          console.log(chalk.cyan('\n📊 Aggregations:\n'));
          for (const [key, value] of Object.entries(result.aggregations)) {
            console.log(chalk.yellow(`${key}:`));
            for (const [subKey, stats] of Object.entries(value as Record<string, any>)) {
              console.log(`  ${subKey}: ${stats.count} entries, ${formatBytes(stats.totalSize)}`);
            }
            console.log();
          }
        }

        // Show pagination info
        if (result.total > result.entries.length) {
          const showing = (options.offset || 0) + result.entries.length;
          console.log(chalk.gray(`Showing ${showing} of ${result.total} entries`));
        }

      } catch (error) {
        printError(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
        if (options.debug) {
          console.error(error);
        }
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // === EXPORT COMMAND ===
  memoryCmd
    .command('export')
    .description('Export memory data in multiple formats')
    .argument('<file>', 'Output file path')
    .option('-f, --format <format>', 'Export format (json|csv|xml|yaml)', 'json')
    .option('-n, --namespace <namespace>', 'Export specific namespace')
    .option('-t, --type <type>', 'Export specific type')
    .option('--include-metadata', 'Include full metadata')
    .option('--compression', 'Enable compression')
    .option('--encrypt', 'Enable encryption')
    .option('--encrypt-key <key>', 'Encryption key')
    .option('--filter-query <json>', 'Advanced filtering (JSON query options)')
    .action(async (file, options) => {
      try {
        const manager = await ensureMemoryManager();
        
        // Determine format from file extension if not specified
        let format = options.format;
        if (!format) {
          const ext = extname(file).toLowerCase();
          switch (ext) {
            case '.json': format = 'json'; break;
            case '.csv': format = 'csv'; break;
            case '.xml': format = 'xml'; break;
            case '.yaml':
            case '.yml': format = 'yaml'; break;
            default: format = 'json';
          }
        }

        // Parse filter query if provided
        let filtering: QueryOptions | undefined;
        if (options.filterQuery) {
          try {
            filtering = JSON.parse(options.filterQuery);
          } catch (error) {
            printError('Invalid filter query JSON format');
            return;
          }
        }

        // Build export options
        const exportOptions: ExportOptions = {
          format: format as ExportOptions['format'],
          namespace: options.namespace,
          type: options.type,
          includeMetadata: options.includeMetadata,
          compression: options.compression,
          encryption: options.encrypt ? {
            enabled: true,
            key: options.encryptKey
          } : undefined,
          filtering
        };

        printInfo(`Starting export to ${file} (format: ${format})`);
        const startTime = Date.now();

        const result = await manager.export(file, exportOptions);
        const duration = Date.now() - startTime;

        printSuccess(`Export completed in ${formatDuration(duration)}`);
        console.log(`📊 Exported: ${result.entriesExported} entries`);
        console.log(`📁 File size: ${formatBytes(result.fileSize)}`);
        console.log(`🔒 Checksum: ${result.checksum}`);

        if (options.compression) {
          printInfo('Data was compressed during export');
        }
        if (options.encrypt) {
          printInfo('Data was encrypted during export');
        }

      } catch (error) {
        printError(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
        if (options.debug) {
          console.error(error);
        }
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // === IMPORT COMMAND ===
  memoryCmd
    .command('import')
    .description('Import memory data with validation and transformation')
    .argument('<file>', 'Input file path')
    .option('-f, --format <format>', 'Import format (json|csv|xml|yaml)')
    .option('-n, --namespace <namespace>', 'Target namespace for imported data')
    .option('--conflict-resolution <strategy>', 'Conflict resolution (overwrite|skip|merge|rename)', 'skip')
    .option('--validation', 'Enable data validation')
    .option('--key-mapping <json>', 'Key mapping for transformation (JSON object)')
    .option('--value-transform <js>', 'Value transformation JavaScript function')
    .option('--metadata-extract <js>', 'Metadata extraction JavaScript function')
    .option('--dry-run', 'Show what would be imported without making changes')
    .action(async (file, options) => {
      try {
        const manager = await ensureMemoryManager();

        // Check if file exists
        try {
          await fs.access(file);
        } catch {
          printError(`File not found: ${file}`);
          return;
        }

        // Determine format from file extension if not specified
        let format = options.format;
        if (!format) {
          const ext = extname(file).toLowerCase();
          switch (ext) {
            case '.json': format = 'json'; break;
            case '.csv': format = 'csv'; break;
            case '.xml': format = 'xml'; break;
            case '.yaml':
            case '.yml': format = 'yaml'; break;
            default:
              printError('Cannot determine format from file extension. Please specify --format');
              return;
          }
        }

        // Parse transformation options
        let transformation: ImportOptions['transformation'];
        if (options.keyMapping || options.valueTransform || options.metadataExtract) {
          transformation = {};
          
          if (options.keyMapping) {
            try {
              transformation.keyMapping = JSON.parse(options.keyMapping);
            } catch (error) {
              printError('Invalid key mapping JSON format');
              return;
            }
          }
          
          if (options.valueTransform) {
            try {
              // Create function from string (simplified - in production, use a proper sandbox)
              transformation.valueTransformation = new Function('value', options.valueTransform) as (value: any) => any;
            } catch (error) {
              printError('Invalid value transformation function');
              return;
            }
          }
          
          if (options.metadataExtract) {
            try {
              transformation.metadataExtraction = new Function('entry', options.metadataExtract) as (entry: any) => Record<string, any>;
            } catch (error) {
              printError('Invalid metadata extraction function');
              return;
            }
          }
        }

        // Build import options
        const importOptions: ImportOptions = {
          format: format as ImportOptions['format'],
          namespace: options.namespace,
          conflictResolution: options.conflictResolution as ImportOptions['conflictResolution'],
          validation: options.validation,
          transformation,
          dryRun: options.dryRun
        };

        if (options.dryRun) {
          printWarning('DRY RUN MODE - No changes will be made');
        }

        printInfo(`Starting import from ${file} (format: ${format})`);
        const startTime = Date.now();

        const result = await manager.import(file, importOptions);
        const duration = Date.now() - startTime;

        printSuccess(`Import completed in ${formatDuration(duration)}`);
        
        if (result.entriesImported > 0) {
          console.log(chalk.green(`📥 Imported: ${result.entriesImported} entries`));
        }
        if (result.entriesUpdated > 0) {
          console.log(chalk.blue(`🔄 Updated: ${result.entriesUpdated} entries`));
        }
        if (result.entriesSkipped > 0) {
          console.log(chalk.yellow(`⏭️  Skipped: ${result.entriesSkipped} entries`));
        }
        if (result.conflicts.length > 0) {
          console.log(chalk.red(`⚠️  Conflicts: ${result.conflicts.length}`));
          if (result.conflicts.length <= 10) {
            result.conflicts.forEach(conflict => {
              console.log(chalk.red(`   • ${conflict}`));
            });
          } else {
            result.conflicts.slice(0, 10).forEach(conflict => {
              console.log(chalk.red(`   • ${conflict}`));
            });
            console.log(chalk.red(`   ... and ${result.conflicts.length - 10} more`));
          }
        }

      } catch (error) {
        printError(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
        if (options.debug) {
          console.error(error);
        }
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // === STATS COMMAND ===
  memoryCmd
    .command('stats')
    .description('Comprehensive statistics with analytics and optimization suggestions')
    .option('--detailed', 'Show detailed statistics')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--export <file>', 'Export statistics to file')
    .action(async (options) => {
      try {
        const manager = await ensureMemoryManager();
        const startTime = Date.now();

        const stats = await manager.getStatistics();
        const duration = Date.now() - startTime;

        if (options.format === 'json') {
          const output = {
            statistics: stats,
            generatedAt: new Date().toISOString(),
            generationTime: duration
          };
          
          if (options.export) {
            await fs.writeFile(options.export, JSON.stringify(output, null, 2));
            printSuccess(`Statistics exported to ${options.export}`);
          } else {
            console.log(JSON.stringify(output, null, 2));
          }
          return;
        }

        // Table format display
        console.log(chalk.cyan.bold('🧠 Memory System Statistics\n'));

        // Overview
        console.log(chalk.yellow('📊 Overview:'));
        console.log(`   Total Entries: ${stats.overview.totalEntries.toLocaleString()}`);
        console.log(`   Total Size: ${formatBytes(stats.overview.totalSize)}`);
        console.log(`   Compressed Entries: ${stats.overview.compressedEntries.toLocaleString()} (${(stats.overview.compressionRatio * 100).toFixed(1)}% compression)`);
        console.log(`   Index Size: ${formatBytes(stats.overview.indexSize)}`);
        console.log(`   Memory Usage: ${formatBytes(stats.overview.memoryUsage)}`);
        console.log(`   Disk Usage: ${formatBytes(stats.overview.diskUsage)}`);
        console.log();

        // Distribution
        console.log(chalk.yellow('📈 Distribution:'));
        
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
        
        if (Object.keys(stats.distribution.byAccessLevel).length > 0) {
          console.log('   By Access Level:');
          for (const [level, data] of Object.entries(stats.distribution.byAccessLevel)) {
            console.log(`     ${level}: ${data.count} entries, ${formatBytes(data.size)}`);
          }
        }
        console.log();

        // Temporal
        console.log(chalk.yellow('⏰ Temporal Analysis:'));
        console.log(`   Created Last 24h: ${stats.temporal.entriesCreatedLast24h}`);
        console.log(`   Updated Last 24h: ${stats.temporal.entriesUpdatedLast24h}`);
        console.log(`   Accessed Last 24h: ${stats.temporal.entriesAccessedLast24h}`);
        if (stats.temporal.oldestEntry) {
          console.log(`   Oldest Entry: ${stats.temporal.oldestEntry.toLocaleString()}`);
        }
        if (stats.temporal.newestEntry) {
          console.log(`   Newest Entry: ${stats.temporal.newestEntry.toLocaleString()}`);
        }
        console.log();

        // Performance
        console.log(chalk.yellow('⚡ Performance:'));
        console.log(`   Average Query Time: ${formatDuration(stats.performance.averageQueryTime)}`);
        console.log(`   Average Write Time: ${formatDuration(stats.performance.averageWriteTime)}`);
        console.log(`   Cache Hit Ratio: ${(stats.performance.cacheHitRatio * 100).toFixed(1)}%`);
        console.log(`   Index Efficiency: ${(stats.performance.indexEfficiency * 100).toFixed(1)}%`);
        console.log();

        // Health
        console.log(chalk.yellow('🏥 Health:'));
        const healthColor = stats.health.recommendedCleanup ? chalk.red : chalk.green;
        console.log(`   Status: ${healthColor(stats.health.recommendedCleanup ? 'Needs Attention' : 'Healthy')}`);
        console.log(`   Expired Entries: ${stats.health.expiredEntries}`);
        console.log(`   Orphaned References: ${stats.health.orphanedReferences}`);
        console.log(`   Duplicate Keys: ${stats.health.duplicateKeys}`);
        console.log(`   Corrupted Entries: ${stats.health.corruptedEntries}`);
        console.log();

        // Optimization
        if (stats.optimization.suggestions.length > 0) {
          console.log(chalk.yellow('💡 Optimization Suggestions:'));
          stats.optimization.suggestions.forEach(suggestion => {
            console.log(`   • ${suggestion}`);
          });
          console.log();

          console.log(chalk.yellow('💰 Potential Savings:'));
          console.log(`   Compression: ${formatBytes(stats.optimization.potentialSavings.compression)}`);
          console.log(`   Cleanup: ${formatBytes(stats.optimization.potentialSavings.cleanup)}`);
          console.log(`   Deduplication: ${formatBytes(stats.optimization.potentialSavings.deduplication)}`);
          console.log();
        }

        if (options.detailed && stats.optimization.indexOptimization.length > 0) {
          console.log(chalk.yellow('🔍 Index Optimization:'));
          stats.optimization.indexOptimization.forEach(suggestion => {
            console.log(`   • ${suggestion}`);
          });
          console.log();
        }

        console.log(chalk.gray(`Statistics generated in ${formatDuration(duration)}`));

        // Export if requested
        if (options.export) {
          const output = {
            statistics: stats,
            generatedAt: new Date().toISOString(),
            generationTime: duration
          };
          await fs.writeFile(options.export, JSON.stringify(output, null, 2));
          printSuccess(`Statistics exported to ${options.export}`);
        }

      } catch (error) {
        printError(`Statistics generation failed: ${error instanceof Error ? error.message : String(error)}`);
        if (options.debug) {
          console.error(error);
        }
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // === CLEANUP COMMAND ===
  memoryCmd
    .command('cleanup')
    .description('Intelligent cleanup with archiving and retention policies')
    .option('--dry-run', 'Show what would be cleaned without making changes')
    .option('--remove-expired', 'Remove expired entries', true)
    .option('--remove-older-than <days>', 'Remove entries older than N days', parseInt)
    .option('--remove-unaccessed <days>', 'Remove entries not accessed in N days', parseInt)
    .option('--remove-orphaned', 'Remove orphaned references', true)
    .option('--remove-duplicates', 'Remove duplicate entries')
    .option('--compress-eligible', 'Compress eligible entries', true)
    .option('--archive-old', 'Enable archiving of old entries')
    .option('--archive-older-than <days>', 'Archive entries older than N days', parseInt)
    .option('--archive-path <path>', 'Archive directory path', './memory/archive')
    .option('--retention-policies <json>', 'Custom retention policies (JSON)')
    .option('--aggressive', 'Use aggressive cleanup settings')
    .action(async (options) => {
      try {
        const manager = await ensureMemoryManager();

        if (options.dryRun) {
          printWarning('DRY RUN MODE - No changes will be made');
        }

        // Parse retention policies
        let retentionPolicies;
        if (options.retentionPolicies) {
          try {
            retentionPolicies = JSON.parse(options.retentionPolicies);
          } catch (error) {
            printError('Invalid retention policies JSON format');
            return;
          }
        }

        // Apply aggressive settings if requested
        if (options.aggressive) {
          options.removeOlderThan = options.removeOlderThan || 30;
          options.removeUnaccessed = options.removeUnaccessed || 7;
          options.removeDuplicates = true;
          options.archiveOld = true;
          options.archiveOlderThan = options.archiveOlderThan || 90;
        }

        // Build cleanup options
        const cleanupOptions: CleanupOptions = {
          dryRun: options.dryRun,
          removeExpired: options.removeExpired,
          removeOlderThan: options.removeOlderThan,
          removeUnaccessed: options.removeUnaccessed,
          removeOrphaned: options.removeOrphaned,
          removeDuplicates: options.removeDuplicates,
          compressEligible: options.compressEligible,
          archiveOld: options.archiveOld ? {
            enabled: true,
            olderThan: options.archiveOlderThan || 365,
            archivePath: options.archivePath
          } : undefined,
          retentionPolicies
        };

        printInfo('Starting memory cleanup...');
        const startTime = Date.now();

        const result = await manager.cleanup(cleanupOptions);
        const duration = Date.now() - startTime;

        printSuccess(`Cleanup completed in ${formatDuration(duration)}`);

        if (result.entriesRemoved > 0) {
          console.log(chalk.red(`🗑️  Removed: ${result.entriesRemoved} entries`));
        }
        if (result.entriesArchived > 0) {
          console.log(chalk.blue(`📦 Archived: ${result.entriesArchived} entries`));
        }
        if (result.entriesCompressed > 0) {
          console.log(chalk.green(`🗜️  Compressed: ${result.entriesCompressed} entries`));
        }
        if (result.spaceSaved > 0) {
          console.log(chalk.yellow(`💾 Space Saved: ${formatBytes(result.spaceSaved)}`));
        }

        if (result.actions.length > 0) {
          console.log(chalk.cyan('\n📋 Actions Performed:'));
          result.actions.forEach(action => {
            console.log(`   • ${action}`);
          });
        }

        if (options.dryRun && (result.entriesRemoved > 0 || result.entriesArchived > 0)) {
          printInfo('Run without --dry-run to perform these actions');
        }

      } catch (error) {
        printError(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        if (options.debug) {
          console.error(error);
        }
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // === BASIC COMMANDS ===

  // Store command
  memoryCmd
    .command('store')
    .description('Store data with advanced options')
    .argument('<key>', 'Entry key')
    .argument('<value>', 'Entry value (JSON string)')
    .option('-n, --namespace <namespace>', 'Target namespace', 'default')
    .option('-t, --type <type>', 'Data type')
    .option('--tags <tags>', 'Tags (comma-separated)')
    .option('--metadata <json>', 'Additional metadata (JSON)')
    .option('--owner <owner>', 'Entry owner', 'system')
    .option('--access-level <level>', 'Access level (private|shared|public)', 'shared')
    .option('--ttl <ms>', 'Time-to-live in milliseconds', parseInt)
    .option('--compress', 'Force compression')
    .action(async (key, value, options) => {
      try {
        const manager = await ensureMemoryManager();

        // Parse value as JSON if possible
        let parsedValue;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }

        // Parse metadata if provided
        let metadata;
        if (options.metadata) {
          try {
            metadata = JSON.parse(options.metadata);
          } catch (error) {
            printError('Invalid metadata JSON format');
            return;
          }
        }

        const entryId = await manager.store(key, parsedValue, {
          namespace: options.namespace,
          type: options.type,
          tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined,
          metadata,
          owner: options.owner,
          accessLevel: options.accessLevel,
          ttl: options.ttl,
          compress: options.compress
        });

        printSuccess(`Entry stored successfully`);
        console.log(`📝 Entry ID: ${entryId}`);
        console.log(`🔑 Key: ${key}`);
        console.log(`📦 Namespace: ${options.namespace}`);
        console.log(`🏷️  Type: ${options.type || 'auto-detected'}`);
        
        if (options.tags) {
          console.log(`🏷️  Tags: [${options.tags}]`);
        }
        if (options.ttl) {
          const expiresAt = new Date(Date.now() + options.ttl);
          console.log(`⏰ Expires: ${expiresAt.toLocaleString()}`);
        }

      } catch (error) {
        printError(`Store failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // Get command
  memoryCmd
    .command('get')
    .description('Retrieve data with caching')
    .argument('<key>', 'Entry key')
    .option('-n, --namespace <namespace>', 'Target namespace')
    .option('--format <format>', 'Output format (json|pretty)', 'pretty')
    .action(async (key, options) => {
      try {
        const manager = await ensureMemoryManager();

        const entry = await manager.retrieve(key, {
          namespace: options.namespace,
          updateLastAccessed: true
        });

        if (!entry) {
          printWarning(`Entry not found: ${key}`);
          return;
        }

        if (options.format === 'json') {
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
            console.log(chalk.gray(`(showing first 500 characters of ${entry.value.length} total)`));
          } else {
            console.log(JSON.stringify(entry.value, null, 2));
          }
        }

      } catch (error) {
        printError(`Retrieve failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // Delete command
  memoryCmd
    .command('delete')
    .description('Delete specific entries')
    .argument('<key>', 'Entry key')
    .option('-n, --namespace <namespace>', 'Target namespace')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (key, options) => {
      try {
        const manager = await ensureMemoryManager();

        // Find entry first
        const entry = await manager.retrieve(key, { namespace: options.namespace });
        if (!entry) {
          printWarning(`Entry not found: ${key}`);
          return;
        }

        // Confirmation (simplified - in a real CLI, use a proper prompt library)
        if (!options.confirm) {
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
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // List command
  memoryCmd
    .command('list')
    .description('List entries with filtering')
    .option('-n, --namespace <namespace>', 'Filter by namespace')
    .option('-t, --type <type>', 'Filter by type')
    .option('--limit <num>', 'Limit results', parseInt, 20)
    .option('--offset <num>', 'Offset for pagination', parseInt, 0)
    .option('--sort-by <field>', 'Sort by field', 'updatedAt')
    .option('--sort-order <order>', 'Sort order (asc|desc)', 'desc')
    .action(async (options) => {
      try {
        const manager = await ensureMemoryManager();

        const result = await manager.query({
          namespace: options.namespace,
          type: options.type,
          limit: options.limit,
          offset: options.offset,
          sortBy: options.sortBy,
          sortOrder: options.sortOrder
        });

        if (result.entries.length === 0) {
          printInfo('No entries found');
          return;
        }

        console.log(chalk.cyan(`\n📋 Memory Entries (${result.total} total):\n`));

        for (const [i, entry] of result.entries.entries()) {
          const num = options.offset + i + 1;
          console.log(chalk.blue(`${num}. ${entry.key}`));
          console.log(`   Namespace: ${entry.namespace} | Type: ${entry.type} | Size: ${formatBytes(entry.size)}`);
          console.log(`   Updated: ${entry.updatedAt.toLocaleString()}`);
          
          if (entry.tags.length > 0) {
            console.log(`   Tags: [${entry.tags.join(', ')}]`);
          }
          console.log();
        }

        if (result.total > result.entries.length) {
          const showing = options.offset + result.entries.length;
          console.log(chalk.gray(`Showing ${showing} of ${result.total} entries`));
        }

      } catch (error) {
        printError(`List failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // Utility commands
  memoryCmd
    .command('namespaces')
    .description('List all namespaces')
    .action(async () => {
      try {
        const manager = await ensureMemoryManager();
        const namespaces = await manager.listNamespaces();
        
        if (namespaces.length === 0) {
          printInfo('No namespaces found');
          return;
        }

        console.log(chalk.cyan('\n📁 Namespaces:\n'));
        namespaces.forEach((namespace, i) => {
          console.log(`${i + 1}. ${namespace}`);
        });

      } catch (error) {
        printError(`Failed to list namespaces: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  memoryCmd
    .command('types')
    .description('List all data types')
    .action(async () => {
      try {
        const manager = await ensureMemoryManager();
        const types = await manager.listTypes();
        
        if (types.length === 0) {
          printInfo('No types found');
          return;
        }

        console.log(chalk.cyan('\n🏷️  Data Types:\n'));
        types.forEach((type, i) => {
          console.log(`${i + 1}. ${type}`);
        });

      } catch (error) {
        printError(`Failed to list types: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  memoryCmd
    .command('tags')
    .description('List all tags')
    .action(async () => {
      try {
        const manager = await ensureMemoryManager();
        const tags = await manager.listTags();
        
        if (tags.length === 0) {
          printInfo('No tags found');
          return;
        }

        console.log(chalk.cyan('\n🏷️  Tags:\n'));
        tags.forEach((tag, i) => {
          console.log(`${i + 1}. ${tag}`);
        });

      } catch (error) {
        printError(`Failed to list tags: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  // Configuration command
  memoryCmd
    .command('config')
    .description('View/update memory system configuration')
    .option('--show', 'Show current configuration')
    .option('--set <json>', 'Update configuration (JSON)')
    .action(async (options) => {
      try {
        const manager = await ensureMemoryManager();

        if (options.set) {
          try {
            const updates = JSON.parse(options.set);
            await manager.updateConfiguration(updates);
            printSuccess('Configuration updated');
          } catch (error) {
            printError('Invalid configuration JSON format');
            return;
          }
        }

        if (options.show || !options.set) {
          const config = manager.getConfiguration();
          console.log(chalk.cyan('\n⚙️  Memory System Configuration:\n'));
          console.log(JSON.stringify(config, null, 2));
        }

      } catch (error) {
        printError(`Configuration operation failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Ensure clean shutdown
        if (memoryManager) {
          await memoryManager.shutdown();
        }
      }
    });

  return memoryCmd;
}

// Export is already declared on the function itself