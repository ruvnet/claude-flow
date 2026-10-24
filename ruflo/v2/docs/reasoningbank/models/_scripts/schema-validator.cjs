#!/usr/bin/env node
/**
 * Claude-Flow Schema Validator
 * Ensures memory.db contains ALL required tables for full claude-flow compatibility
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class SchemaValidator {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);

    // Required tables for full claude-flow compatibility
    this.requiredTables = {
      // ReasoningBank core tables
      'patterns': {
        columns: ['id', 'description', 'context', 'success_rate', 'confidence', 'domain', 'tags', 'created_at', 'updated_at']
      },
      'pattern_embeddings': {
        columns: ['id', 'pattern_id', 'embedding', 'created_at']
      },
      'task_trajectories': {
        columns: ['id', 'memory_id', 'step_number', 'action', 'reasoning', 'outcome', 'created_at']
      },
      'pattern_links': {
        columns: ['id', 'source_id', 'target_id', 'link_type', 'strength', 'created_at']
      },

      // Claude-Flow memory tables
      'memories': {
        columns: ['id', 'key', 'value', 'namespace', 'created_at', 'updated_at', 'expires_at', 'metadata']
      },
      'memory_embeddings': {
        columns: ['id', 'memory_id', 'embedding', 'created_at']
      },

      // Claude-Flow session tables
      'sessions': {
        columns: ['id', 'session_id', 'agent_type', 'started_at', 'ended_at', 'metadata']
      },
      'session_metrics': {
        columns: ['id', 'session_id', 'metric_name', 'metric_value', 'recorded_at']
      },

      // Claude-Flow neural tables
      'neural_patterns': {
        columns: ['id', 'pattern_type', 'pattern_data', 'confidence', 'created_at']
      },
      'training_data': {
        columns: ['id', 'input', 'output', 'success', 'created_at']
      }
    };
  }

  validateSchema() {
    console.log(`\n🔍 Validating schema for: ${this.dbPath}\n`);

    const results = {
      valid: true,
      tables: {},
      missing: [],
      incomplete: []
    };

    // Get existing tables
    const existingTables = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all().map(row => row.name);

    // Check each required table
    for (const [tableName, schema] of Object.entries(this.requiredTables)) {
      if (!existingTables.includes(tableName)) {
        results.missing.push(tableName);
        results.valid = false;
        results.tables[tableName] = { exists: false, columns: [] };
        console.log(`❌ Missing table: ${tableName}`);
      } else {
        // Check columns
        const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
        const columnNames = columns.map(c => c.name);

        const missingColumns = schema.columns.filter(col => !columnNames.includes(col));

        if (missingColumns.length > 0) {
          results.incomplete.push({ table: tableName, missingColumns });
          results.valid = false;
          console.log(`⚠️  Table ${tableName} missing columns: ${missingColumns.join(', ')}`);
        } else {
          console.log(`✅ Table ${tableName} complete`);
        }

        results.tables[tableName] = {
          exists: true,
          columns: columnNames,
          complete: missingColumns.length === 0
        };
      }
    }

    console.log(`\n${results.valid ? '✅' : '❌'} Schema validation ${results.valid ? 'PASSED' : 'FAILED'}\n`);

    return results;
  }

  createMissingTables() {
    console.log('\n🔧 Creating missing tables...\n');

    const results = this.validateSchema();

    // Create missing tables
    for (const tableName of results.missing) {
      console.log(`Creating table: ${tableName}`);
      this.createTable(tableName);
    }

    // Add missing columns
    for (const { table, missingColumns } of results.incomplete) {
      for (const column of missingColumns) {
        console.log(`Adding column ${column} to ${table}`);
        this.addColumn(table, column);
      }
    }

    console.log('\n✅ Schema fixes applied\n');

    return this.validateSchema();
  }

  createTable(tableName) {
    const schemas = {
      'memories': `
        CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          namespace TEXT DEFAULT 'default',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME,
          metadata TEXT
        )
      `,
      'memory_embeddings': `
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL,
          embedding TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        )
      `,
      'sessions': `
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT UNIQUE NOT NULL,
          agent_type TEXT,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          ended_at DATETIME,
          metadata TEXT
        )
      `,
      'session_metrics': `
        CREATE TABLE IF NOT EXISTS session_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          metric_name TEXT NOT NULL,
          metric_value REAL NOT NULL,
          recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
        )
      `,
      'neural_patterns': `
        CREATE TABLE IF NOT EXISTS neural_patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pattern_type TEXT NOT NULL,
          pattern_data TEXT NOT NULL,
          confidence REAL DEFAULT 0.5,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      'training_data': `
        CREATE TABLE IF NOT EXISTS training_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          input TEXT NOT NULL,
          output TEXT NOT NULL,
          success INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `
    };

    if (schemas[tableName]) {
      this.db.exec(schemas[tableName]);
      console.log(`✅ Created table: ${tableName}`);
    }
  }

  addColumn(table, column) {
    const columnTypes = {
      'metadata': 'TEXT',
      'expires_at': 'DATETIME',
      'namespace': 'TEXT DEFAULT "default"'
    };

    const type = columnTypes[column] || 'TEXT';

    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`✅ Added column ${column} to ${table}`);
    } catch (error) {
      console.log(`⚠️  Could not add column ${column}: ${error.message}`);
    }
  }

  createIndexes() {
    console.log('\n🚀 Creating performance indexes...\n');

    const indexes = [
      // ReasoningBank indexes
      'CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC)',
      'CREATE INDEX IF NOT EXISTS idx_patterns_domain ON patterns(domain)',
      'CREATE INDEX IF NOT EXISTS idx_patterns_success ON patterns(success_rate DESC)',
      'CREATE INDEX IF NOT EXISTS idx_embeddings_pattern ON pattern_embeddings(pattern_id)',
      'CREATE INDEX IF NOT EXISTS idx_links_source ON pattern_links(source_id)',
      'CREATE INDEX IF NOT EXISTS idx_links_target ON pattern_links(target_id)',
      'CREATE INDEX IF NOT EXISTS idx_trajectories_memory ON task_trajectories(memory_id)',

      // Claude-Flow indexes
      'CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key)',
      'CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace)',
      'CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_memory_emb_id ON memory_embeddings(memory_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_id ON sessions(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_metrics_session ON session_metrics(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_neural_type ON neural_patterns(pattern_type)'
    ];

    for (const index of indexes) {
      this.db.exec(index);
    }

    console.log('✅ All indexes created\n');
  }

  optimizeDatabase() {
    console.log('🔧 Optimizing database...\n');

    // SQLite optimizations
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.db.exec('PRAGMA cache_size=10000');
    this.db.exec('PRAGMA temp_store=MEMORY');
    this.db.exec('PRAGMA mmap_size=268435456');
    this.db.exec('ANALYZE');
    this.db.exec('VACUUM');

    console.log('✅ Database optimized\n');
  }

  generateReport() {
    const results = this.validateSchema();

    const report = `
# Schema Validation Report

**Database**: ${this.dbPath}
**Validation Time**: ${new Date().toISOString()}
**Status**: ${results.valid ? '✅ VALID' : '❌ INVALID'}

## Table Summary

| Table | Status | Columns |
|-------|--------|---------|
${Object.entries(results.tables).map(([name, info]) =>
  `| ${name} | ${info.exists ? (info.complete ? '✅' : '⚠️') : '❌'} | ${info.columns.length} |`
).join('\n')}

## Missing Tables
${results.missing.length > 0 ? results.missing.map(t => `- ${t}`).join('\n') : '✅ None'}

## Incomplete Tables
${results.incomplete.length > 0 ? results.incomplete.map(i =>
  `- **${i.table}**: Missing ${i.missingColumns.join(', ')}`
).join('\n') : '✅ None'}

## Database Statistics

\`\`\`sql
${this.getStatistics()}
\`\`\`
`;

    return report;
  }

  getStatistics() {
    const stats = [];

    const tables = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all();

    for (const { name } of tables) {
      try {
        const count = this.db.prepare(`SELECT COUNT(*) as count FROM ${name}`).get();
        stats.push(`${name}: ${count.count} rows`);
      } catch (error) {
        stats.push(`${name}: error`);
      }
    }

    return stats.join('\n');
  }

  close() {
    this.db.close();
  }
}

// CLI usage
if (require.main === module) {
  const dbPath = process.argv[2];
  const action = process.argv[3] || 'validate';

  if (!dbPath) {
    console.error('Usage: node schema-validator.js <db-path> [validate|fix|report]');
    process.exit(1);
  }

  const validator = new SchemaValidator(dbPath);

  switch (action) {
    case 'validate':
      const results = validator.validateSchema();
      validator.close();
      process.exit(results.valid ? 0 : 1);
      break;

    case 'fix':
      validator.createMissingTables();
      validator.createIndexes();
      validator.optimizeDatabase();
      validator.close();
      break;

    case 'report':
      console.log(validator.generateReport());
      validator.close();
      break;

    default:
      console.error('Unknown action. Use: validate, fix, or report');
      process.exit(1);
  }
}

module.exports = SchemaValidator;
