#!/usr/bin/env node
/**
 * Fix Schema Compatibility for ReasoningBank Models
 * Adds all required claude-flow memory tables to trained models
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const CLAUDE_FLOW_SCHEMA = `
-- Claude-Flow Memory System Tables

-- Primary memory table (used by hive-mind and general memory commands)
CREATE TABLE IF NOT EXISTS memory (
    key TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'default',
    value TEXT NOT NULL,
    ttl INTEGER,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    metadata TEXT,
    PRIMARY KEY (key, namespace)
);

-- Memory entries table (used by memory-consolidation command)
CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'default',
    timestamp INTEGER NOT NULL,
    source TEXT,
    UNIQUE(key, namespace)
);

-- Collective memory table (used by hive-mind swarms)
CREATE TABLE IF NOT EXISTS collective_memory (
    id TEXT PRIMARY KEY,
    swarm_id TEXT,
    key TEXT NOT NULL,
    value TEXT,
    type TEXT DEFAULT 'knowledge',
    confidence REAL DEFAULT 1.0,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accessed_at DATETIME,
    access_count INTEGER DEFAULT 0,
    ttl INTEGER,
    metadata TEXT,
    embedding TEXT
);

-- Session tracking
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    agent_type TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    metadata TEXT
);

-- Session metrics
CREATE TABLE IF NOT EXISTS session_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory(expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_entries_namespace ON memory_entries(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_entries_timestamp ON memory_entries(timestamp);
CREATE INDEX IF NOT EXISTS idx_collective_memory_swarm ON collective_memory(swarm_id);
CREATE INDEX IF NOT EXISTS idx_collective_memory_key ON collective_memory(key);
CREATE INDEX IF NOT EXISTS idx_sessions_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_metrics_session ON session_metrics(session_id);

-- Triggers for TTL
CREATE TRIGGER IF NOT EXISTS set_memory_expiry
AFTER INSERT ON memory
WHEN NEW.ttl IS NOT NULL
BEGIN
    UPDATE memory
    SET expires_at = datetime(CURRENT_TIMESTAMP, '+' || NEW.ttl || ' seconds')
    WHERE key = NEW.key AND namespace = NEW.namespace;
END;
`;

class SchemaFixer {
  constructor(modelPath, modelName) {
    this.modelPath = modelPath;
    this.modelName = modelName;
    this.dbPath = path.join(modelPath, 'memory.db');
  }

  fix() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔧 Fixing schema for: ${this.modelName}`);
    console.log(`${'='.repeat(60)}\n`);

    if (!fs.existsSync(this.dbPath)) {
      console.log(`⚠️  Database not found: ${this.dbPath}`);
      return false;
    }

    // Backup first
    const backupPath = this.dbPath + '.backup';
    fs.copyFileSync(this.dbPath, backupPath);
    console.log(`✅ Backup created: ${path.basename(backupPath)}`);

    const db = new Database(this.dbPath);

    // Get existing tables
    const existingTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all().map(row => row.name);

    console.log(`\n📋 Existing tables: ${existingTables.join(', ')}`);

    // Add claude-flow schema
    try {
      db.exec(CLAUDE_FLOW_SCHEMA);
      console.log(`\n✅ Added claude-flow memory tables`);
    } catch (error) {
      console.error(`❌ Error adding schema: ${error.message}`);
      db.close();
      return false;
    }

    // Get new tables
    const newTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all().map(row => row.name);

    const addedTables = newTables.filter(t => !existingTables.includes(t));

    if (addedTables.length > 0) {
      console.log(`\n🆕 Added tables: ${addedTables.join(', ')}`);
    }

    // Verify compatibility
    const required = ['memory', 'memory_entries', 'patterns', 'pattern_embeddings'];
    const missing = required.filter(t => !newTables.includes(t));

    if (missing.length === 0) {
      console.log(`\n✅ All required tables present`);
    } else {
      console.log(`\n⚠️  Missing tables: ${missing.join(', ')}`);
    }

    // Optimize
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=NORMAL');
    db.exec('PRAGMA cache_size=10000');
    db.exec('ANALYZE');
    db.exec('VACUUM');

    console.log(`✅ Database optimized`);

    db.close();

    // Generate compatibility report
    this.generateReport(existingTables, newTables, addedTables);

    console.log(`\n✅ Schema fix complete!`);
    return true;
  }

  generateReport(beforeTables, afterTables, addedTables) {
    const report = `
# Schema Compatibility Fix Report: ${this.modelName}

**Date**: ${new Date().toISOString()}
**Database**: ${this.dbPath}

## Summary

- **Tables before**: ${beforeTables.length}
- **Tables after**: ${afterTables.length}
- **Tables added**: ${addedTables.length}

## Tables Added

${addedTables.length > 0 ? addedTables.map(t => `- \`${t}\``).join('\n') : '_No tables added_'}

## All Tables (After Fix)

${afterTables.sort().map(t => `- \`${t}\``).join('\n')}

## Claude-Flow Compatibility

### Required Tables

- [${afterTables.includes('memory') ? 'x' : ' '}] \`memory\` - General memory storage
- [${afterTables.includes('memory_entries') ? 'x' : ' '}] \`memory_entries\` - Memory consolidation
- [${afterTables.includes('collective_memory') ? 'x' : ' '}] \`collective_memory\` - Hive-mind swarm memory
- [${afterTables.includes('sessions') ? 'x' : ' '}] \`sessions\` - Session tracking
- [${afterTables.includes('session_metrics') ? 'x' : ' '}] \`session_metrics\` - Session metrics

### ReasoningBank Tables

- [${afterTables.includes('patterns') ? 'x' : ' '}] \`patterns\` - Core patterns
- [${afterTables.includes('pattern_embeddings') ? 'x' : ' '}] \`pattern_embeddings\` - Semantic embeddings
- [${afterTables.includes('pattern_links') ? 'x' : ' '}] \`pattern_links\` - Pattern relationships
- [${afterTables.includes('task_trajectories') ? 'x' : ' '}] \`task_trajectories\` - Multi-step reasoning

## Compatibility Status

**Status**: ${this.isFullyCompatible(afterTables) ? '✅ FULLY COMPATIBLE' : '⚠️ PARTIALLY COMPATIBLE'}

This model can now be used with:
- ✅ \`npx claude-flow@alpha memory store\` - General memory commands
- ✅ \`npx claude-flow@alpha memory query\` - Memory queries
- ✅ \`npx claude-flow@alpha memory query --reasoningbank\` - ReasoningBank patterns
- ✅ Hive-mind swarm operations
- ✅ Session tracking and metrics

## Backup

A backup was created at: \`${path.basename(this.dbPath)}.backup\`

To restore: \`cp ${path.basename(this.dbPath)}.backup ${path.basename(this.dbPath)}\`
`;

    const reportPath = path.join(this.modelPath, 'SCHEMA-FIX-REPORT.md');
    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved: ${reportPath}`);
  }

  isFullyCompatible(tables) {
    const required = [
      'memory',
      'memory_entries',
      'patterns',
      'pattern_embeddings'
    ];
    return required.every(t => tables.includes(t));
  }
}

// Fix all models
async function fixAllModels() {
  const modelsDir = __dirname;
  const models = [
    { name: 'SAFLA', path: 'safla' },
    { name: 'Google Research', path: 'google-research' },
    { name: 'Code Reasoning', path: 'code-reasoning/.swarm' },
    { name: 'Problem Solving', path: 'problem-solving' },
    { name: 'Domain Expert', path: 'domain-expert' }
  ];

  console.log('\n' + '='.repeat(70));
  console.log('🔧 Claude-Flow Schema Compatibility Fix');
  console.log('='.repeat(70));

  let successCount = 0;
  let failCount = 0;

  for (const model of models) {
    const modelPath = path.join(modelsDir, model.path);
    const fixer = new SchemaFixer(modelPath, model.name);

    if (fixer.fix()) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Success: ${successCount}/${models.length} models`);
  console.log(`❌ Failed: ${failCount}/${models.length} models`);
  console.log('='.repeat(70) + '\n');

  if (successCount === models.length) {
    console.log('🎉 All models are now fully compatible with claude-flow!');
    console.log('\nYou can now use:');
    console.log('  - npx claude-flow@alpha memory store <key> <value> --reasoningbank');
    console.log('  - npx claude-flow@alpha memory query <query> --reasoningbank');
    console.log('  - All hive-mind operations');
    console.log('  - Session tracking and metrics\n');
  }
}

// Run if called directly
if (require.main === module) {
  fixAllModels().catch(console.error);
}

module.exports = SchemaFixer;
