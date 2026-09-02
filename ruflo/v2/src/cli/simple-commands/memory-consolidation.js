// memory-consolidation.js - Database consolidation utility
import { printSuccess, printError, printWarning, printInfo } from '../utils.js';
import { promises as fs } from 'fs';
import path from 'path';
import { existsSync } from '../node-compat.js';
// Dynamic imports for optional dependencies
let sqlite3;
let sqliteOpen;

async function loadSqliteModules() {
  try {
    const sqlite3Module = await import('sqlite3');
    sqlite3 = sqlite3Module.default;
    const sqliteModule = await import('sqlite');
    sqliteOpen = sqliteModule.open;
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Memory database consolidation strategy
 * Consolidates multiple memory storage locations into a unified structure
 */
export class MemoryConsolidator {
  constructor() {
    this.primaryLocations = {
      json: './memory/memory-store.json',
      sqlite: './.claude-flow/memory/unified-memory.db',
      backup: './.claude-flow/memory/backups/'
    };

    this.knownLocations = [
      // JSON stores
      './memory/memory-store.json',
      './.claude-flow/memory/store.json',
      
      // SQLite databases
      './.swarm/memory.db',
      './.hive-mind/memory.db',
      './.hive-mind/hive.db',
      './.ruv-swarm/swarm.db',
      './data/hive-mind.db',
      
      // Legacy locations
      './memory.json',
      './data/memory.json'
    ];
  }

  /**
   * Scan for all memory storage locations
   */
  async scanMemoryLocations() {
    const found = {
      json: [],
      sqlite: [],
      total: 0,
      sizeBytes: 0
    };

    // Check known locations
    for (const location of this.knownLocations) {
      if (existsSync(location)) {
        const stats = await fs.stat(location);
        const type = location.endsWith('.db') ? 'sqlite' : 'json';
        
        found[type].push({
          path: location,
          size: stats.size,
          modified: stats.mtime
        });
        
        found.total++;
        found.sizeBytes += stats.size;
      }
    }

    // Scan for additional .db files
    try {
      const dbFiles = await this.findDatabaseFiles('.');
      for (const dbFile of dbFiles) {
        if (!this.knownLocations.includes(dbFile)) {
          const stats = await fs.stat(dbFile);
          found.sqlite.push({
            path: dbFile,
            size: stats.size,
            modified: stats.mtime
          });
          found.total++;
          found.sizeBytes += stats.size;
        }
      }
    } catch (err) {
      // Ignore scan errors
    }

    return found;
  }

  /**
   * Find all .db files recursively
   */
  async findDatabaseFiles(dir, files = []) {
    try {
      const items = await fs.readdir(dir);
      
      for (const item of items) {
        // Skip node_modules and hidden directories
        if (item === 'node_modules' || item.startsWith('.git')) continue;
        
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory() && item.startsWith('.')) {
          // Check hidden directories for db files
          await this.findDatabaseFiles(fullPath, files);
        } else if (item.endsWith('.db')) {
          files.push(fullPath);
        }
      }
    } catch (err) {
      // Ignore permission errors
    }
    
    return files;
  }

  /**
   * Create consolidation plan
   */
  async createConsolidationPlan(locations) {
    const plan = {
      steps: [],
      estimatedTime: 0,
      totalData: locations.sizeBytes,
      backupRequired: locations.total > 0
    };

    // Step 1: Backup existing data
    if (plan.backupRequired) {
      plan.steps.push({
        action: 'backup',
        description: 'Create backups of all existing memory stores',
        sources: [...locations.json, ...locations.sqlite].map(l => l.path),
        destination: this.primaryLocations.backup
      });
      plan.estimatedTime += 2; // seconds
    }

    // Step 2: Convert JSON stores to unified format
    if (locations.json.length > 0) {
      plan.steps.push({
        action: 'convert-json',
        description: 'Convert JSON memory stores to unified format',
        sources: locations.json.map(l => l.path),
        destination: this.primaryLocations.sqlite
      });
      plan.estimatedTime += locations.json.length * 1;
    }

    // Step 3: Merge SQLite databases
    if (locations.sqlite.length > 0) {
      plan.steps.push({
        action: 'merge-sqlite',
        description: 'Merge SQLite databases into unified store',
        sources: locations.sqlite.map(l => l.path),
        destination: this.primaryLocations.sqlite
      });
      plan.estimatedTime += locations.sqlite.length * 2;
    }

    // Step 4: Create indices for performance
    plan.steps.push({
      action: 'optimize',
      description: 'Create indices and optimize unified database',
      destination: this.primaryLocations.sqlite
    });
    plan.estimatedTime += 1;

    // Step 5: Update configuration
    plan.steps.push({
      action: 'update-config',
      description: 'Update memory configuration to use unified store',
      config: {
        memoryStore: this.primaryLocations.sqlite,
        backupLocation: this.primaryLocations.backup,
        legacySupport: true
      }
    });

    return plan;
  }

  /**
   * Execute consolidation plan
   */
  async executeConsolidation(plan, options = {}) {
    const results = {
      success: false,
      stepsCompleted: 0,
      errors: [],
      backupPath: null,
      newStorePath: null
    };

    try {
      for (const step of plan.steps) {
        printInfo(`Executing: ${step.description}`);
        
        switch (step.action) {
          case 'backup':
            results.backupPath = await this.createBackups(step.sources, step.destination);
            break;
            
          case 'convert-json':
            await this.convertJsonToSqlite(step.sources, step.destination);
            break;
            
          case 'merge-sqlite':
            await this.mergeSqliteDatabases(step.sources, step.destination);
            break;
            
          case 'optimize':
            await this.optimizeDatabase(step.destination);
            break;
            
          case 'update-config':
            await this.updateConfiguration(step.config);
            break;
        }
        
        results.stepsCompleted++;
        printSuccess(`✓ ${step.description}`);
      }
      
      results.success = true;
      results.newStorePath = this.primaryLocations.sqlite;
      
    } catch (err) {
      results.errors.push(err.message);
      printError(`Failed at step ${results.stepsCompleted + 1}: ${err.message}`);
    }
    
    return results;
  }

  /**
   * Create backups of all memory stores
   */
  async createBackups(sources, backupDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}`);
    
    await fs.mkdir(backupPath, { recursive: true });
    
    for (const source of sources) {
      if (existsSync(source)) {
        const filename = path.basename(source);
        const dest = path.join(backupPath, filename);
        await fs.copyFile(source, dest);
      }
    }
    
    return backupPath;
  }

  /**
   * Convert JSON memory stores to SQLite
   */
  async convertJsonToSqlite(jsonFiles, dbPath) {
    if (!sqlite3 || !sqliteOpen) {
      throw new Error('SQLite modules not available. Install sqlite3 and sqlite packages.');
    }
    
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    
    const db = await sqliteOpen({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    // Create unified schema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'default',
        timestamp INTEGER NOT NULL,
        source TEXT,
        UNIQUE(key, namespace)
      );
      
      CREATE INDEX IF NOT EXISTS idx_namespace ON memory_entries(namespace);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON memory_entries(timestamp);
      CREATE INDEX IF NOT EXISTS idx_key ON memory_entries(key);
    `);
    
    // Import each JSON file
    for (const jsonFile of jsonFiles) {
      if (!existsSync(jsonFile)) continue;
      
      try {
        const content = await fs.readFile(jsonFile, 'utf8');
        const data = JSON.parse(content);
        
        const stmt = await db.prepare(`
          INSERT OR REPLACE INTO memory_entries (key, value, namespace, timestamp, source)
          VALUES (?, ?, ?, ?, ?)
        `);
        
        for (const [namespace, entries] of Object.entries(data)) {
          for (const entry of entries) {
            await stmt.run(
              entry.key,
              entry.value,
              entry.namespace || namespace,
              entry.timestamp,
              jsonFile
            );
          }
        }
        
        await stmt.finalize();
      } catch (err) {
        printWarning(`Failed to import ${jsonFile}: ${err.message}`);
      }
    }
    
    await db.close();
  }

  /**
   * Merge multiple SQLite databases
   */
  async mergeSqliteDatabases(dbFiles, targetDb) {
    if (!sqlite3 || !sqliteOpen) {
      throw new Error('SQLite modules not available. Install sqlite3 and sqlite packages.');
    }
    
    const db = await sqliteOpen({
      filename: targetDb,
      driver: sqlite3.Database
    });
    
    for (const dbFile of dbFiles) {
      if (!existsSync(dbFile) || dbFile === targetDb) continue;
      
      try {
        // Attach the source database
        const alias = `db_${path.basename(dbFile, '.db')}`;
        await db.exec(`ATTACH DATABASE '${dbFile}' AS ${alias}`);
        
        // Get tables from source database
        const tables = await db.all(`
          SELECT name FROM ${alias}.sqlite_master 
          WHERE type='table' AND name LIKE '%memory%'
        `);
        
        // Copy data from each memory-related table
        for (const table of tables) {
          try {
            await db.exec(`
              INSERT OR IGNORE INTO memory_entries (key, value, namespace, timestamp, source)
              SELECT 
                COALESCE(key, ''), 
                COALESCE(value, ''), 
                COALESCE(namespace, 'default'),
                COALESCE(timestamp, strftime('%s', 'now') * 1000),
                '${dbFile}'
              FROM ${alias}.${table.name}
              WHERE key IS NOT NULL AND value IS NOT NULL
            `);
          } catch (err) {
            // Table structure might be different, skip
          }
        }
        
        await db.exec(`DETACH DATABASE ${alias}`);
      } catch (err) {
        printWarning(`Failed to merge ${dbFile}: ${err.message}`);
      }
    }
    
    await db.close();
  }

  /**
   * Optimize the unified database
   */
  async optimizeDatabase(dbPath) {
    if (!sqlite3 || !sqliteOpen) {
      throw new Error('SQLite modules not available. Install sqlite3 and sqlite packages.');
    }
    
    const db = await sqliteOpen({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    // Add performance optimizations
    await db.exec(`
      -- Enable Write-Ahead Logging for better performance
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      
      -- Optimize database
      VACUUM;
      ANALYZE;
      
      -- Create additional indices for common queries
      CREATE INDEX IF NOT EXISTS idx_key_value ON memory_entries(key, value);
      CREATE INDEX IF NOT EXISTS idx_namespace_timestamp ON memory_entries(namespace, timestamp);
    `);
    
    await db.close();
  }

  /**
   * Update configuration to use unified store
   */
  async updateConfiguration(config) {
    const configPath = './.claude-flow/memory-config.json';
    
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    
    // Create symlinks for backward compatibility
    if (config.legacySupport) {
      try {
        // Create symlink from old JSON location to new
        if (existsSync('./memory/memory-store.json')) {
          await fs.rename('./memory/memory-store.json', './memory/memory-store.json.old');
        }
        // Note: We don't create actual symlinks to SQLite as JSON/SQLite formats differ
        // Instead, the memory manager will check the config and use the unified store
      } catch (err) {
        // Ignore symlink errors
      }
    }
  }

  /**
   * Generate consolidation report
   */
  generateReport(scanResults, plan, executionResults) {
    const report = [];
    
    report.push('📊 Memory Consolidation Report');
    report.push('================================\n');
    
    report.push('📁 Discovered Memory Stores:');
    report.push(`  • JSON files: ${scanResults.json.length}`);
    report.push(`  • SQLite databases: ${scanResults.sqlite.length}`);
    report.push(`  • Total size: ${(scanResults.sizeBytes / 1024 / 1024).toFixed(2)} MB\n`);
    
    report.push('📋 Consolidation Plan:');
    for (const step of plan.steps) {
      report.push(`  ✓ ${step.description}`);
    }
    report.push(`  • Estimated time: ${plan.estimatedTime} seconds\n`);
    
    if (executionResults) {
      report.push('✅ Execution Results:');
      report.push(`  • Success: ${executionResults.success ? 'Yes' : 'No'}`);
      report.push(`  • Steps completed: ${executionResults.stepsCompleted}/${plan.steps.length}`);
      
      if (executionResults.backupPath) {
        report.push(`  • Backup location: ${executionResults.backupPath}`);
      }
      
      if (executionResults.newStorePath) {
        report.push(`  • Unified store: ${executionResults.newStorePath}`);
      }
      
      if (executionResults.errors.length > 0) {
        report.push('\n❌ Errors:');
        for (const error of executionResults.errors) {
          report.push(`  • ${error}`);
        }
      }
    }
    
    return report.join('\n');
  }
}

/**
 * Memory consolidation command
 */
export async function memoryConsolidationCommand(subArgs, flags) {
  // Load SQLite modules if available
  const sqliteAvailable = await loadSqliteModules();
  
  const consolidator = new MemoryConsolidator();
  const action = subArgs[0];
  
  switch (action) {
    case 'scan':
      await scanMemoryStores(consolidator);
      break;
      
    case 'plan':
      await createConsolidationPlan(consolidator);
      break;
      
    case 'execute':
      await executeConsolidation(consolidator, flags);
      break;
      
    case 'report':
      await generateConsolidationReport(consolidator);
      break;
      
    default:
      showConsolidationHelp();
  }
}

async function scanMemoryStores(consolidator) {
  printInfo('Scanning for memory storage locations...');
  
  const results = await consolidator.scanMemoryLocations();
  
  printSuccess(`Found ${results.total} memory storage locations:`);
  
  if (results.json.length > 0) {
    console.log('\n📄 JSON Stores:');
    for (const store of results.json) {
      console.log(`  • ${store.path} (${(store.size / 1024).toFixed(1)} KB)`);
    }
  }
  
  if (results.sqlite.length > 0) {
    console.log('\n🗄️ SQLite Databases:');
    for (const db of results.sqlite) {
      console.log(`  • ${db.path} (${(db.size / 1024).toFixed(1)} KB)`);
    }
  }
  
  console.log(`\n💾 Total size: ${(results.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
}

async function createConsolidationPlan(consolidator) {
  const scanResults = await consolidator.scanMemoryLocations();
  const plan = await consolidator.createConsolidationPlan(scanResults);
  
  printSuccess('📋 Consolidation Plan Created:');
  
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    console.log(`\n${i + 1}. ${step.description}`);
    
    if (step.sources) {
      console.log('   Sources:');
      for (const source of step.sources) {
        console.log(`   • ${source}`);
      }
    }
    
    if (step.destination) {
      console.log(`   Destination: ${step.destination}`);
    }
  }
  
  console.log(`\n⏱️ Estimated time: ${plan.estimatedTime} seconds`);
  console.log('\nRun "memory-consolidate execute" to perform consolidation');
}

async function executeConsolidation(consolidator, flags) {
  const sqliteAvailable = await loadSqliteModules();
  
  if (!sqliteAvailable) {
    printError('SQLite modules not available.');
    printInfo('Install required packages: npm install sqlite3 sqlite');
    return;
  }
  
  const scanResults = await consolidator.scanMemoryLocations();
  
  if (scanResults.total === 0) {
    printWarning('No memory stores found to consolidate');
    return;
  }
  
  const plan = await consolidator.createConsolidationPlan(scanResults);
  
  if (!flags.force) {
    printWarning('This will consolidate all memory stores into a unified database.');
    printWarning('A backup will be created before any changes are made.');
    console.log('\nUse --force flag to proceed without confirmation');
    return;
  }
  
  printInfo('Starting memory consolidation...');
  const results = await consolidator.executeConsolidation(plan);
  
  const report = consolidator.generateReport(scanResults, plan, results);
  console.log('\n' + report);
  
  if (results.success) {
    printSuccess('\n✅ Memory consolidation completed successfully!');
    console.log(`Unified store location: ${results.newStorePath}`);
  } else {
    printError('\n❌ Memory consolidation failed');
    console.log('Check the errors above and try again');
  }
}

async function generateConsolidationReport(consolidator) {
  const scanResults = await consolidator.scanMemoryLocations();
  const plan = await consolidator.createConsolidationPlan(scanResults);
  
  const report = consolidator.generateReport(scanResults, plan);
  console.log(report);
}

function showConsolidationHelp() {
  console.log('Memory consolidation commands:');
  console.log('  scan       Scan for all memory storage locations');
  console.log('  plan       Create a consolidation plan');
  console.log('  execute    Execute the consolidation (use --force to skip confirmation)');
  console.log('  report     Generate a consolidation report');
  console.log();
  console.log('Examples:');
  console.log('  memory-consolidate scan');
  console.log('  memory-consolidate plan');
  console.log('  memory-consolidate execute --force');
  console.log('  memory-consolidate report');
}