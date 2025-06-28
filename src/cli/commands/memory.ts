/**
 * Memory management commands
 */

import { Command } from '@cliffy/command';
import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { promises as fs } from 'fs';

interface MemoryEntry {
  key: string;
  value: string;
  namespace: string;
  timestamp: number;
}

export class SimpleMemoryManager {
  private filePath = "./memory/memory-store.json";
  private data: Record<string, MemoryEntry[]> = {};

  async load() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(content);
    } catch {
      // File doesn't exist yet
      this.data = {};
    }
  }

  async save() {
    await fs.mkdir("./memory", { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async store(key: string, value: string, namespace: string = "default") {
    await this.load();
    
    if (!this.data[namespace]) {
      this.data[namespace] = [];
    }

    // Remove existing entry with same key
    this.data[namespace] = this.data[namespace].filter(e => e.key !== key);
    
    // Add new entry
    this.data[namespace].push({
      key,
      value,
      namespace,
      timestamp: Date.now()
    });

    await this.save();
  }

  async query(search: string, namespace?: string) {
    await this.load();
    
    const results: MemoryEntry[] = [];
    const namespaces = namespace ? [namespace] : Object.keys(this.data);

    for (const ns of namespaces) {
      if (this.data[ns]) {
        for (const entry of this.data[ns]) {
          if (entry.key.includes(search) || entry.value.includes(search)) {
            results.push(entry);
          }
        }
      }
    }

    return results;
  }

  async getStats() {
    await this.load();
    
    let totalEntries = 0;
    const namespaceStats: Record<string, number> = {};

    for (const [namespace, entries] of Object.entries(this.data)) {
      namespaceStats[namespace] = entries.length;
      totalEntries += entries.length;
    }

    return {
      totalEntries,
      namespaces: Object.keys(this.data).length,
      namespaceStats,
      sizeBytes: new TextEncoder().encode(JSON.stringify(this.data)).length
    };
  }

  async exportData(filePath: string) {
    await this.load();
    await fs.writeFile(filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async importData(filePath: string) {
    const content = await fs.readFile(filePath, 'utf8');
    this.data = JSON.parse(content);
    await this.save();
  }

  async cleanup(daysOld: number = 30) {
    await this.load();
    
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    let removedCount = 0;

    for (const namespace of Object.keys(this.data)) {
      const before = this.data[namespace].length;
      this.data[namespace] = this.data[namespace].filter(e => e.timestamp > cutoffTime);
      removedCount += before - this.data[namespace].length;
    }

    await this.save();
    return removedCount;
  }
}

export const memoryCommand = new Command()
  .description('Manage memory bank')
  .action(() => {
    memoryCommand.showHelp();
  })
  // Store command
  .command('store', Command)
    .description('Store information in memory')
    .arguments('<key:string> <value:string>')
    .option('-n, --namespace <namespace:string>', 'Target namespace', { default: 'default' })
    .action(async (options: any, key: string, value: string) => {
      try {
        const memory = new SimpleMemoryManager();
        await memory.store(key, value, options.namespace);
        console.log(colors.green('✅ Stored successfully'));
        console.log(`📝 Key: ${key}`);
        console.log(`📦 Namespace: ${options.namespace}`);
        console.log(`💾 Size: ${new TextEncoder().encode(value).length} bytes`);
      } catch (error) {
        console.error(colors.red('Failed to store:'), (error as Error).message);
      }
    })
  // Query command
  .command('query', Command)
    .description('Search memory entries')
    .arguments('<search:string>')
    .option('-n, --namespace <namespace:string>', 'Filter by namespace')
    .option('-l, --limit <limit:number>', 'Limit results', { default: 10 })
    .action(async (options: any, search: string) => {
      try {
        const memory = new SimpleMemoryManager();
        const results = await memory.query(search, options.namespace);
        
        if (results.length === 0) {
          console.log(colors.yellow('No results found'));
          return;
        }

        console.log(colors.green(`✅ Found ${results.length} results:`));
        
        const limited = results.slice(0, options.limit);
        for (const entry of limited) {
          console.log(colors.blue(`\n📌 ${entry.key}`));
          console.log(`   Namespace: ${entry.namespace}`);
          console.log(`   Value: ${entry.value.substring(0, 100)}${entry.value.length > 100 ? '...' : ''}`);
          console.log(`   Stored: ${new Date(entry.timestamp).toLocaleString()}`);
        }

        if (results.length > options.limit) {
          console.log(colors.gray(`\n... and ${results.length - options.limit} more results`));
        }
      } catch (error) {
        console.error(colors.red('Failed to query:'), (error as Error).message);
      }
    })
  // Export command
  .command('export', Command)
    .description('Export memory to file')
    .arguments('<file:string>')
    .action(async (options: any, file: string) => {
      try {
        const memory = new SimpleMemoryManager();
        await memory.exportData(file);
        const stats = await memory.getStats();
        console.log(colors.green('✅ Memory exported successfully'));
        console.log(`📁 File: ${file}`);
        console.log(`📊 Entries: ${stats.totalEntries}`);
        console.log(`💾 Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
      } catch (error) {
        console.error(colors.red('Failed to export:'), (error as Error).message);
      }
    })
  // Import command
  .command('import', Command)
    .description('Import memory from file')
    .arguments('<file:string>')
    .action(async (options: any, file: string) => {
      try {
        const memory = new SimpleMemoryManager();
        await memory.importData(file);
        const stats = await memory.getStats();
        console.log(colors.green('✅ Memory imported successfully'));
        console.log(`📁 File: ${file}`);
        console.log(`📊 Entries: ${stats.totalEntries}`);
        console.log(`🗂️  Namespaces: ${stats.namespaces}`);
      } catch (error) {
        console.error(colors.red('Failed to import:'), (error as Error).message);
      }
    })
  // Stats command
  .command('stats', Command)
    .description('Show memory statistics')
    .action(async () => {
      try {
        const memory = new SimpleMemoryManager();
        const stats = await memory.getStats();
        
        console.log(colors.green('📊 Memory Bank Statistics:'));
        console.log(`   Total Entries: ${stats.totalEntries}`);
        console.log(`   Namespaces: ${stats.namespaces}`);
        console.log(`   Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
        
        if (stats.namespaces > 0) {
          console.log(colors.blue('\n📁 Namespace Breakdown:'));
          for (const [namespace, count] of Object.entries(stats.namespaceStats)) {
            console.log(`   ${namespace}: ${count} entries`);
          }
        }
      } catch (error) {
        console.error(colors.red('Failed to get stats:'), (error as Error).message);
      }
    })
  // Cleanup command
  .command('cleanup', Command)
    .description('Clean up old entries')
    .option('-d, --days <days:number>', 'Entries older than n days', { default: 30 })
    .action(async (options: any) => {
      try {
        const memory = new SimpleMemoryManager();
        const removed = await memory.cleanup(options.days);
        console.log(colors.green('✅ Cleanup completed'));
        console.log(`🗑️  Removed: ${removed} entries older than ${options.days} days`);
      } catch (error) {
        console.error(colors.red('Failed to cleanup:'), (error as Error).message);
      }
    });