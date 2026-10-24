// memory.js - Memory management commands
import { printSuccess, printError, printWarning, printInfo } from '../utils.js';
import { promises as fs } from 'fs';
import { cwd, exit, existsSync } from '../node-compat.js';
import { getUnifiedMemory } from '../../memory/unified-memory-manager.js';
import { KeyRedactor } from '../../utils/key-redactor.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function memoryCommand(subArgs, flags) {
  const memorySubcommand = subArgs[0];
  const memoryStore = './memory/memory-store.json';

  // Extract namespace from flags or subArgs
  const namespace = flags?.namespace || flags?.ns || getNamespaceFromArgs(subArgs) || 'default';

  // Check for redaction flag
  const enableRedaction = flags?.redact || subArgs.includes('--redact') || subArgs.includes('--secure');

  // NEW: Detect memory mode (basic, reasoningbank, auto)
  const mode = await detectMemoryMode(flags, subArgs);

  // Helper to load memory data
  async function loadMemory() {
    try {
      const content = await fs.readFile(memoryStore, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  // Helper to save memory data
  async function saveMemory(data) {
    await fs.mkdir('./memory', { recursive: true });
    await fs.writeFile(memoryStore, JSON.stringify(data, null, 2, 'utf8'));
  }

  // NEW: Handle ReasoningBank-specific commands
  if (mode === 'reasoningbank' && ['init', 'status', 'consolidate', 'demo', 'test', 'benchmark'].includes(memorySubcommand)) {
    return await handleReasoningBankCommand(memorySubcommand, subArgs, flags);
  }

  // NEW: Handle new mode management commands
  if (['detect', 'mode', 'migrate'].includes(memorySubcommand)) {
    return await handleModeCommand(memorySubcommand, subArgs, flags);
  }

  // NEW: Delegate to ReasoningBank for regular commands if mode is set
  // Note: 'stats' is handled in switch statement for unified output
  if (mode === 'reasoningbank' && ['store', 'query', 'list'].includes(memorySubcommand)) {
    return await handleReasoningBankCommand(memorySubcommand, subArgs, flags);
  }

  switch (memorySubcommand) {
    case 'store':
      await storeMemory(subArgs, loadMemory, saveMemory, namespace, enableRedaction);
      break;

    case 'query':
      await queryMemory(subArgs, loadMemory, namespace, enableRedaction);
      break;

    case 'stats':
      // Always use showMemoryStats for unified output
      // It will detect mode and show appropriate stats
      await showMemoryStats(loadMemory, mode);
      break;

    case 'export':
      await exportMemory(subArgs, loadMemory, namespace);
      break;

    case 'import':
      await importMemory(subArgs, saveMemory, loadMemory);
      break;

    case 'clear':
      await clearMemory(subArgs, saveMemory, namespace);
      break;

    case 'list':
      await listNamespaces(loadMemory);
      break;

    default:
      showMemoryHelp();
  }
}

async function storeMemory(subArgs, loadMemory, saveMemory, namespace, enableRedaction = false) {
  const key = subArgs[1];
  let value = subArgs.slice(2).join(' ');

  if (!key || !value) {
    printError('Usage: memory store <key> <value> [--namespace <ns>] [--redact]');
    return;
  }

  try {
    // Apply redaction if enabled
    let redactedValue = value;
    let securityWarnings = [];

    if (enableRedaction) {
      redactedValue = KeyRedactor.redact(value, true);
      const validation = KeyRedactor.validate(value);

      if (!validation.safe) {
        securityWarnings = validation.warnings;
        printWarning('🔒 Redaction enabled: Sensitive data detected and redacted');
        securityWarnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
      }
    } else {
      // Even if redaction is not explicitly enabled, validate and warn
      const validation = KeyRedactor.validate(value);
      if (!validation.safe) {
        printWarning('⚠️  Potential sensitive data detected! Use --redact flag for automatic redaction');
        validation.warnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
        console.log('   💡 Tip: Add --redact flag to automatically redact API keys');
      }
    }

    const data = await loadMemory();

    if (!data[namespace]) {
      data[namespace] = [];
    }

    // Remove existing entry with same key
    data[namespace] = data[namespace].filter((e) => e.key !== key);

    // Add new entry with redacted value
    data[namespace].push({
      key,
      value: redactedValue,
      namespace,
      timestamp: Date.now(),
      redacted: enableRedaction && securityWarnings.length > 0,
    });

    await saveMemory(data);
    printSuccess(enableRedaction && securityWarnings.length > 0 ? '🔒 Stored successfully (with redaction)' : '✅ Stored successfully');
    console.log(`📝 Key: ${key}`);
    console.log(`📦 Namespace: ${namespace}`);
    console.log(`💾 Size: ${new TextEncoder().encode(redactedValue).length} bytes`);
    if (enableRedaction && securityWarnings.length > 0) {
      console.log(`🔒 Security: ${securityWarnings.length} sensitive pattern(s) redacted`);
    }
  } catch (err) {
    printError(`Failed to store: ${err.message}`);
  }
}

async function queryMemory(subArgs, loadMemory, namespace, enableRedaction = false) {
  const search = subArgs.slice(1).join(' ');

  if (!search) {
    printError('Usage: memory query <search> [--namespace <ns>] [--redact]');
    return;
  }

  try {
    const data = await loadMemory();
    const results = [];

    for (const [ns, entries] of Object.entries(data)) {
      if (namespace && ns !== namespace) continue;

      for (const entry of entries) {
        if (entry.key.includes(search) || entry.value.includes(search)) {
          results.push(entry);
        }
      }
    }

    if (results.length === 0) {
      printWarning('No results found');
      return;
    }

    printSuccess(`Found ${results.length} results:`);

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    for (const entry of results.slice(0, 10)) {
      console.log(`\n📌 ${entry.key}`);
      console.log(`   Namespace: ${entry.namespace}`);

      // Apply redaction to displayed value if requested
      let displayValue = entry.value;
      if (enableRedaction) {
        displayValue = KeyRedactor.redact(displayValue, true);
      }

      console.log(
        `   Value: ${displayValue.substring(0, 100)}${displayValue.length > 100 ? '...' : ''}`,
      );
      console.log(`   Stored: ${new Date(entry.timestamp).toLocaleString()}`);

      // Show redaction status
      if (entry.redacted) {
        console.log(`   🔒 Status: Redacted on storage`);
      } else if (enableRedaction) {
        console.log(`   🔒 Status: Redacted for display`);
      }
    }

    if (results.length > 10) {
      console.log(`\n... and ${results.length - 10} more results`);
    }
  } catch (err) {
    printError(`Failed to query: ${err.message}`);
  }
}

async function showMemoryStats(loadMemory, mode) {
  try {
    const rbInitialized = await isReasoningBankInitialized();

    // If in auto mode and ReasoningBank is initialized, show unified stats
    if (mode === 'reasoningbank' || (rbInitialized && mode !== 'basic')) {
      // Show unified statistics for both backends
      printSuccess('Memory Bank Statistics:\n');

      // JSON Storage stats
      const data = await loadMemory();
      let totalEntries = 0;
      const namespaceStats = {};

      for (const [namespace, entries] of Object.entries(data)) {
        namespaceStats[namespace] = entries.length;
        totalEntries += entries.length;
      }

      console.log('📁 JSON Storage (./memory/memory-store.json):');
      console.log(`   Total Entries: ${totalEntries}`);
      console.log(`   Namespaces: ${Object.keys(data).length}`);
      console.log(
        `   Size: ${(new TextEncoder().encode(JSON.stringify(data)).length / 1024).toFixed(2)} KB`,
      );

      if (Object.keys(data).length > 0) {
        console.log('   Namespace Breakdown:');
        for (const [namespace, count] of Object.entries(namespaceStats)) {
          console.log(`     ${namespace}: ${count} entries`);
        }
      }

      // ReasoningBank stats
      if (rbInitialized) {
        try {
          const { getStatus } = await import('../../reasoningbank/reasoningbank-adapter.js');
          const rbStats = await getStatus();

          console.log('\n🧠 ReasoningBank Storage (.swarm/memory.db):');
          console.log(`   Total Memories: ${rbStats.total_memories}`);
          console.log(`   Categories: ${rbStats.total_categories}`);
          console.log(`   Average Confidence: ${(rbStats.avg_confidence * 100).toFixed(1)}%`);
          console.log(`   Embeddings: ${rbStats.total_embeddings}`);
          console.log(`   Trajectories: ${rbStats.total_trajectories}`);

          // Get database file size
          try {
            const dbPath = rbStats.database_path || '.swarm/memory.db';
            const stats = await fs.stat(dbPath);
            console.log(`   Database Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          } catch (sizeErr) {
            // Ignore size calculation errors
          }

          console.log('\n💡 Active Mode: ReasoningBank (auto-selected)');
          console.log('   Use --basic flag to force JSON-only statistics');
        } catch (rbErr) {
          console.log('\n⚠️  ReasoningBank stats unavailable:', rbErr.message);
        }
      }
    } else {
      // Basic mode - JSON only
      const data = await loadMemory();
      let totalEntries = 0;
      const namespaceStats = {};

      for (const [namespace, entries] of Object.entries(data)) {
        namespaceStats[namespace] = entries.length;
        totalEntries += entries.length;
      }

      printSuccess('Memory Bank Statistics (JSON Mode):');
      console.log(`   Total Entries: ${totalEntries}`);
      console.log(`   Namespaces: ${Object.keys(data).length}`);
      console.log(
        `   Size: ${(new TextEncoder().encode(JSON.stringify(data)).length / 1024).toFixed(2)} KB`,
      );

      if (Object.keys(data).length > 0) {
        console.log('\n📁 Namespace Breakdown:');
        for (const [namespace, count] of Object.entries(namespaceStats)) {
          console.log(`   ${namespace}: ${count} entries`);
        }
      }

      if (!rbInitialized) {
        console.log('\n💡 Tip: Initialize ReasoningBank for AI-powered memory');
        console.log('   Run: memory init --reasoningbank');
      }
    }
  } catch (err) {
    printError(`Failed to get stats: ${err.message}`);
  }
}

async function exportMemory(subArgs, loadMemory, namespace) {
  const filename = subArgs[1] || `memory-export-${Date.now()}.json`;

  try {
    const data = await loadMemory();

    let exportData = data;
    if (namespace) {
      exportData = { [namespace]: data[namespace] || [] };
    }

    await fs.writeFile(filename, JSON.stringify(exportData, null, 2, 'utf8'));
    printSuccess(`Memory exported to ${filename}`);

    let totalEntries = 0;
    for (const entries of Object.values(exportData)) {
      totalEntries += entries.length;
    }
    console.log(
      `📦 Exported ${totalEntries} entries from ${Object.keys(exportData).length} namespace(s)`,
    );
  } catch (err) {
    printError(`Failed to export memory: ${err.message}`);
  }
}

async function importMemory(subArgs, saveMemory, loadMemory) {
  const filename = subArgs[1];

  if (!filename) {
    printError('Usage: memory import <filename>');
    return;
  }

  try {
    const importContent = await fs.readFile(filename, 'utf8');
    const importData = JSON.parse(importContent);

    // Load existing memory
    const existingData = await loadMemory();

    // Merge imported data
    let totalImported = 0;
    for (const [namespace, entries] of Object.entries(importData)) {
      if (!existingData[namespace]) {
        existingData[namespace] = [];
      }

      // Add entries that don't already exist (by key)
      const existingKeys = new Set(existingData[namespace].map((e) => e.key));
      const newEntries = entries.filter((e) => !existingKeys.has(e.key));

      existingData[namespace].push(...newEntries);
      totalImported += newEntries.length;
    }

    await saveMemory(existingData);
    printSuccess(`Imported ${totalImported} new entries from ${filename}`);
  } catch (err) {
    printError(`Failed to import memory: ${err.message}`);
  }
}

async function clearMemory(subArgs, saveMemory, namespace) {
  if (!namespace || namespace === 'default') {
    const nsFromArgs = getNamespaceFromArgs(subArgs);
    if (!nsFromArgs) {
      printError('Usage: memory clear --namespace <namespace>');
      printWarning('This will clear all entries in the specified namespace');
      return;
    }
    namespace = nsFromArgs;
  }

  try {
    // Helper to load memory data
    async function loadMemory() {
      try {
        const content = await fs.readFile('./memory/memory-store.json', 'utf8');
        return JSON.parse(content);
      } catch {
        return {};
      }
    }
    
    const data = await loadMemory();

    if (!data[namespace]) {
      printWarning(`Namespace '${namespace}' does not exist`);
      return;
    }

    const entryCount = data[namespace].length;
    delete data[namespace];

    await saveMemory(data);
    printSuccess(`Cleared ${entryCount} entries from namespace '${namespace}'`);
  } catch (err) {
    printError(`Failed to clear memory: ${err.message}`);
  }
}

async function listNamespaces(loadMemory) {
  try {
    const data = await loadMemory();
    const namespaces = Object.keys(data);

    if (namespaces.length === 0) {
      printWarning('No namespaces found');
      return;
    }

    printSuccess('Available namespaces:');
    for (const namespace of namespaces) {
      const count = data[namespace].length;
      console.log(`  ${namespace} (${count} entries)`);
    }
  } catch (err) {
    printError(`Failed to list namespaces: ${err.message}`);
  }
}

function getNamespaceFromArgs(subArgs) {
  const namespaceIndex = subArgs.indexOf('--namespace');
  if (namespaceIndex !== -1 && namespaceIndex + 1 < subArgs.length) {
    return subArgs[namespaceIndex + 1];
  }

  const nsIndex = subArgs.indexOf('--ns');
  if (nsIndex !== -1 && nsIndex + 1 < subArgs.length) {
    return subArgs[nsIndex + 1];
  }

  return null;
}

// Helper to load memory data (needed for import function)
async function loadMemory() {
  try {
    const content = await fs.readFile('./memory/memory-store.json', 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// NEW: Mode detection function
async function detectMemoryMode(flags, subArgs) {
  // Explicit ReasoningBank flag takes precedence
  if (flags?.reasoningbank || flags?.rb || subArgs.includes('--reasoningbank') || subArgs.includes('--rb')) {
    return 'reasoningbank';
  }

  // Auto mode: detect if ReasoningBank is initialized
  if (flags?.auto || subArgs.includes('--auto')) {
    const initialized = await isReasoningBankInitialized();
    return initialized ? 'reasoningbank' : 'basic';
  }

  // Explicit basic mode flag
  if (flags?.basic || subArgs.includes('--basic')) {
    return 'basic';
  }

  // Default: AUTO MODE with SQLite preference
  // Try to use ReasoningBank (SQLite) by default, initialize if needed
  const initialized = await isReasoningBankInitialized();

  if (initialized) {
    return 'reasoningbank';
  }

  // Not initialized yet - try to auto-initialize on first use
  try {
    const { initializeReasoningBank } = await import('../../reasoningbank/reasoningbank-adapter.js');
    const initialized = await initializeReasoningBank();

    // Check if initialization succeeded (returns true) or failed (returns false)
    if (!initialized) {
      // Initialization failed but didn't throw - fall back to JSON
      const isNpx = process.env.npm_config_user_agent?.includes('npx') ||
                    process.cwd().includes('_npx');
      if (isNpx) {
        console.log('\n✅ Automatically using JSON fallback for this command\n');
      } else {
        printWarning(`⚠️  SQLite unavailable, using JSON fallback`);
      }
      return 'basic';
    }

    printInfo('🗄️  Initialized SQLite backend (.swarm/memory.db)');
    return 'reasoningbank';
  } catch (error) {
    // SQLite/native binding initialization failed - fall back to JSON
    const isNativeBindingError = error.message?.includes('BetterSqlite3') ||
                          error.message?.includes('better-sqlite3') ||
                          error.message?.includes('hnswlib') ||
                          error.message?.includes('bindings') ||
                          error.message?.includes('could not run migrations') ||
                          error.message?.includes('ReasoningBank initialization failed') ||
                          error.message?.includes('Could not locate the bindings file');
    const isNpx = process.env.npm_config_user_agent?.includes('npx') ||
                  process.cwd().includes('_npx') ||
                  process.argv[1]?.includes('npx');

    if (isNativeBindingError) {
      // Silent fallback for native binding errors
      return 'basic';
    } else {
      printWarning(`⚠️  SQLite unavailable, using JSON fallback`);
      printWarning(`   Reason: ${error.message}`);
      return 'basic';
    }
  }
}

// NEW: Check if ReasoningBank is initialized
async function isReasoningBankInitialized() {
  try {
    // Check if .swarm/memory.db exists
    const dbPath = '.swarm/memory.db';
    await fs.access(dbPath);
    return true;
  } catch {
    return false;
  }
}

// NEW: Handle ReasoningBank commands
async function handleReasoningBankCommand(command, subArgs, flags) {
  const initialized = await isReasoningBankInitialized();

  // Lazy load the adapter (ES modules) with error handling for native bindings
  let adapterModule;
  try {
    adapterModule = await import('../../reasoningbank/reasoningbank-adapter.js');
  } catch (error) {
    // Native binding error - fallback to basic mode
    const isNativeBindingError = error.message?.includes('bindings') ||
                                  error.message?.includes('hnswlib') ||
                                  error.message?.includes('better-sqlite3') ||
                                  error.message?.includes('Could not locate');
    if (isNativeBindingError) {
      console.log('⚠️  ReasoningBank unavailable (native bindings not found)');
      console.log('   Using basic JSON memory instead');
      console.log('   💡 For full features, install locally: npm install claude-flow\n');
      // Fall back to basic memory stats
      if (command === 'status' || command === 'stats') {
        await showMemoryStats(async () => {
          try {
            const content = await fs.readFile('./memory/memory-store.json', 'utf8');
            return JSON.parse(content);
          } catch {
            return {};
          }
        }, 'basic');
      }
      return;
    }
    throw error;
  }
  const { initializeReasoningBank, storeMemory, queryMemories, listMemories, getStatus, checkReasoningBankTables, migrateReasoningBank, cleanup } = adapterModule;

  // Special handling for 'init' command
  if (command === 'init') {
    const dbPath = '.swarm/memory.db';

    if (initialized) {
      // Database exists - check if migration is needed
      printInfo('🔍 Checking existing database for ReasoningBank schema...\n');

      try {
        // Set the database path for ReasoningBank
        process.env.CLAUDE_FLOW_DB_PATH = dbPath;

        const tableCheck = await checkReasoningBankTables();

        if (tableCheck.exists) {
          printSuccess('✅ ReasoningBank already complete');
          console.log('Database: .swarm/memory.db');
          console.log('All ReasoningBank tables present\n');
          console.log('Use --reasoningbank flag with memory commands to enable AI features');
          return;
        }

        // Missing tables found - run migration
        console.log(`🔄 Migrating database: ${tableCheck.missingTables.length} tables missing`);
        console.log(`   Missing: ${tableCheck.missingTables.join(', ')}\n`);

        const migrationResult = await migrateReasoningBank();

        if (migrationResult.success) {
          printSuccess(`✓ Migration complete: added ${migrationResult.addedTables?.length || 0} tables`);
          console.log('\nNext steps:');
          console.log('  1. Store memories: memory store key "value" --reasoningbank');
          console.log('  2. Query memories: memory query "search" --reasoningbank');
          console.log('  3. Check status: memory status --reasoningbank');
        } else {
          printError(`❌ Migration failed: ${migrationResult.message}`);
          console.log('Try running: init --force to reinitialize');
        }
      } catch (error) {
        printError('❌ Migration check failed');
        console.error(error.message);
        console.log('\nTry running: init --force to reinitialize');
      } finally {
        // Cleanup after migration check
        cleanup();
        // Force exit to prevent hanging from embedding cache timers
        setTimeout(() => process.exit(0), 100);
      }
      return;
    }

    // Fresh initialization
    printInfo('🧠 Initializing ReasoningBank...');
    console.log('This will create: .swarm/memory.db\n');

    try {
      await initializeReasoningBank();
      printSuccess('✅ ReasoningBank initialized successfully!');
      console.log('\nNext steps:');
      console.log('  1. Store memories: memory store key "value" --reasoningbank');
      console.log('  2. Query memories: memory query "search" --reasoningbank');
      console.log('  3. Check status: memory status --reasoningbank');
    } catch (error) {
      printError('❌ Failed to initialize ReasoningBank');
      console.error(error.message);
    } finally {
      // Cleanup after init
      cleanup();
      // Force exit to prevent hanging from embedding cache timers
      setTimeout(() => process.exit(0), 100);
    }
    return;
  }

  // All other commands require initialization
  if (!initialized) {
    printError('❌ ReasoningBank not initialized');
    console.log('\nTo use ReasoningBank mode, first run:');
    console.log('  memory init --reasoningbank\n');
    return;
  }

  printInfo(`🧠 Using ReasoningBank mode...`);

  try {
    // Handle different commands
    switch (command) {
      case 'store':
        await handleReasoningBankStore(subArgs, flags, storeMemory);
        break;

      case 'query':
        await handleReasoningBankQuery(subArgs, flags, queryMemories);
        break;

      case 'list':
        await handleReasoningBankList(subArgs, flags, listMemories);
        break;

      case 'status':
        await handleReasoningBankStatus(getStatus);
        break;

      case 'stats':
        await handleReasoningBankStatus(getStatus);
        break;

      case 'consolidate':
      case 'demo':
      case 'test':
      case 'benchmark':
        // These still use CLI commands
        const cmd = `npx agentic-flow reasoningbank ${command}`;
        const { stdout } = await execAsync(cmd, { timeout: 60000 });
        if (stdout) console.log(stdout);
        break;

      default:
        printError(`Unknown ReasoningBank command: ${command}`);
    }
  } catch (error) {
    printError(`❌ ReasoningBank command failed`);
    console.error(error.message);
  } finally {
    // Always cleanup database connection
    cleanup();

    // Force process exit after cleanup (embedding cache timers prevent natural exit)
    // This is necessary because agentic-flow's embedding cache uses setTimeout
    // which keeps the event loop alive
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }
}

// NEW: Handle ReasoningBank store
async function handleReasoningBankStore(subArgs, flags, storeMemory) {
  const key = subArgs[1];
  const value = subArgs.slice(2).join(' ');

  if (!key || !value) {
    printError('Usage: memory store <key> <value> --reasoningbank');
    return;
  }

  try {
    const namespace = flags?.namespace || flags?.ns || getArgValue(subArgs, '--namespace') || 'default';

    const memoryId = await storeMemory(key, value, {
      namespace,
      agent: 'memory-agent',
      domain: namespace,
    });

    printSuccess('✅ Stored successfully in ReasoningBank');
    console.log(`📝 Key: ${key}`);
    console.log(`🧠 Memory ID: ${memoryId}`);
    console.log(`📦 Namespace: ${namespace}`);
    console.log(`💾 Size: ${new TextEncoder().encode(value).length} bytes`);
    console.log(`🔍 Semantic search: enabled`);
  } catch (error) {
    printError(`Failed to store: ${error.message}`);
  }
}

// NEW: Handle ReasoningBank query
async function handleReasoningBankQuery(subArgs, flags, queryMemories) {
  const search = subArgs.slice(1).join(' ');

  if (!search) {
    printError('Usage: memory query <search> --reasoningbank');
    return;
  }

  try {
    const namespace = flags?.namespace || flags?.ns || getArgValue(subArgs, '--namespace');
    const results = await queryMemories(search, {
      domain: namespace || 'general',
      limit: 10,
    });

    if (results.length === 0) {
      printWarning('No results found');
      return;
    }

    printSuccess(`Found ${results.length} results (semantic search):`);

    for (const entry of results) {
      console.log(`\n📌 ${entry.key}`);
      console.log(`   Namespace: ${entry.namespace}`);
      console.log(`   Value: ${entry.value.substring(0, 100)}${entry.value.length > 100 ? '...' : ''}`);
      console.log(`   Confidence: ${(entry.confidence * 100).toFixed(1)}%`);
      console.log(`   Usage: ${entry.usage_count} times`);
      if (entry.score) {
        console.log(`   Match Score: ${(entry.score * 100).toFixed(1)}%`);
      }
      console.log(`   Stored: ${new Date(entry.created_at).toLocaleString()}`);
    }
  } catch (error) {
    printError(`Failed to query: ${error.message}`);
  }
}

// NEW: Handle ReasoningBank list
async function handleReasoningBankList(subArgs, flags, listMemories) {
  try {
    const sort = flags?.sort || getArgValue(subArgs, '--sort') || 'created_at';
    const limit = parseInt(flags?.limit || getArgValue(subArgs, '--limit') || '10');

    const results = await listMemories({ sort, limit });

    if (results.length === 0) {
      printWarning('No memories found');
      return;
    }

    printSuccess(`ReasoningBank memories (${results.length} shown):`);

    for (const entry of results) {
      console.log(`\n📌 ${entry.key}`);
      console.log(`   Value: ${entry.value.substring(0, 80)}${entry.value.length > 80 ? '...' : ''}`);
      console.log(`   Confidence: ${(entry.confidence * 100).toFixed(1)}% | Usage: ${entry.usage_count}`);
    }
  } catch (error) {
    printError(`Failed to list: ${error.message}`);
  }
}

// NEW: Handle ReasoningBank status
async function handleReasoningBankStatus(getStatus) {
  try {
    const stats = await getStatus();

    printSuccess('📊 ReasoningBank Status:');
    console.log(`   Total memories: ${stats.total_memories}`);
    console.log(`   Average confidence: ${(stats.avg_confidence * 100).toFixed(1)}%`);
    console.log(`   Total usage: ${stats.total_usage}`);
    console.log(`   Embeddings: ${stats.total_embeddings}`);
    console.log(`   Trajectories: ${stats.total_trajectories}`);
  } catch (error) {
    printError(`Failed to get status: ${error.message}`);
  }
}

// NEW: Build agentic-flow reasoningbank command
function buildReasoningBankCommand(command, subArgs, flags) {
  const parts = ['npx', 'agentic-flow', 'reasoningbank'];

  // Map memory commands to reasoningbank commands
  const commandMap = {
    store: 'store',
    query: 'query',
    list: 'list',
    status: 'status',
    consolidate: 'consolidate',
    demo: 'demo',
    test: 'test',
    benchmark: 'benchmark',
  };

  parts.push(commandMap[command] || command);

  // Add arguments (skip the command itself)
  const args = subArgs.slice(1);
  args.forEach((arg) => {
    if (!arg.startsWith('--reasoningbank') && !arg.startsWith('--rb') && !arg.startsWith('--auto')) {
      parts.push(`"${arg}"`);
    }
  });

  // Add required --agent parameter
  parts.push('--agent', 'memory-agent');

  return parts.join(' ');
}

// NEW: Handle mode management commands
async function handleModeCommand(command, subArgs, flags) {
  switch (command) {
    case 'detect':
      await detectModes();
      break;

    case 'mode':
      await showCurrentMode();
      break;

    case 'migrate':
      await migrateMemory(subArgs, flags);
      break;

    default:
      printError(`Unknown mode command: ${command}`);
  }
}

// NEW: Detect and show available memory modes
async function detectModes() {
  printInfo('🔍 Detecting memory modes...\n');

  // Check basic mode
  const basicAvailable = await checkBasicMode();
  console.log(basicAvailable ? '✅ Basic Mode (active)' : '❌ Basic Mode (unavailable)');
  if (basicAvailable) {
    console.log('   Location: ./memory/memory-store.json');
    console.log('   Features: Simple key-value storage, fast');
  }

  console.log('');

  // Check ReasoningBank mode
  const rbAvailable = await isReasoningBankInitialized();
  console.log(rbAvailable ? '✅ ReasoningBank Mode (available)' : '⚠️  ReasoningBank Mode (not initialized)');
  if (rbAvailable) {
    console.log('   Location: .swarm/memory.db');
    console.log('   Features: AI-powered semantic search, learning');
  } else {
    console.log('   To enable: memory init --reasoningbank');
  }

  console.log('\n💡 Usage:');
  console.log('   Basic: memory store key "value"');
  console.log('   ReasoningBank: memory store key "value" --reasoningbank');
  console.log('   Auto-detect: memory query search --auto');
}

// NEW: Check if basic mode is available
async function checkBasicMode() {
  try {
    const memoryDir = './memory';
    await fs.access(memoryDir);
    return true;
  } catch {
    // Create directory if it doesn't exist
    try {
      await fs.mkdir(memoryDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

// NEW: Show current default mode
async function showCurrentMode() {
  const rbInitialized = await isReasoningBankInitialized();

  printInfo('📊 Current Memory Configuration:\n');
  console.log('Default Mode: AUTO (smart selection with JSON fallback)');
  console.log('Available Modes:');
  console.log('  • Basic Mode: Always available (JSON storage)');
  console.log(`  • ReasoningBank Mode: ${rbInitialized ? 'Initialized ✅ (will be used by default)' : 'Not initialized ⚠️ (JSON fallback active)'}`);

  console.log('\n💡 Mode Behavior:');
  console.log('   (no flag)                → AUTO: Use ReasoningBank if initialized, else JSON');
  console.log('   --reasoningbank or --rb  → Force ReasoningBank mode');
  console.log('   --basic                  → Force JSON mode');
  console.log('   --auto                   → Same as default (explicit)');
}

// NEW: Migrate memory between modes
async function migrateMemory(subArgs, flags) {
  const targetMode = flags?.to || getArgValue(subArgs, '--to');

  if (!targetMode || !['basic', 'reasoningbank'].includes(targetMode)) {
    printError('Usage: memory migrate --to <basic|reasoningbank>');
    return;
  }

  printInfo(`🔄 Migrating to ${targetMode} mode...\n`);

  if (targetMode === 'reasoningbank') {
    // Migrate basic → ReasoningBank
    const rbInitialized = await isReasoningBankInitialized();
    if (!rbInitialized) {
      printError('❌ ReasoningBank not initialized');
      console.log('First run: memory init --reasoningbank\n');
      return;
    }

    printWarning('⚠️  Migration from basic to ReasoningBank is not yet implemented');
    console.log('This feature is coming in v2.7.1\n');
    console.log('For now, you can:');
    console.log('  1. Export basic memory: memory export backup.json');
    console.log('  2. Manually import to ReasoningBank');
  } else {
    // Migrate ReasoningBank → basic
    printWarning('⚠️  Migration from ReasoningBank to basic is not yet implemented');
    console.log('This feature is coming in v2.7.1\n');
  }
}

// Helper to get argument value
function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return null;
}

function showMemoryHelp() {
  console.log('Memory commands:');
  console.log('  store <key> <value>    Store a key-value pair');
  console.log('  query <search>         Search for entries');
  console.log('  stats                  Show memory statistics');
  console.log('  export [filename]      Export memory to file');
  console.log('  import <filename>      Import memory from file');
  console.log('  clear --namespace <ns> Clear a namespace');
  console.log('  list                   List all namespaces');
  console.log();
  console.log('🧠 ReasoningBank Commands (NEW in v2.7.0):');
  console.log('  init --reasoningbank   Initialize ReasoningBank (AI-powered memory)');
  console.log('  status --reasoningbank Show ReasoningBank statistics');
  console.log('  detect                 Show available memory modes');
  console.log('  mode                   Show current memory configuration');
  console.log('  migrate --to <mode>    Migrate between basic/reasoningbank');
  console.log();
  console.log('Options:');
  console.log('  --namespace <ns>       Specify namespace for operations');
  console.log('  --ns <ns>              Short form of --namespace');
  console.log('  --limit <n>            Limit number of results (default: 10)');
  console.log('  --sort <field>         Sort results by: recent, oldest, key, value');
  console.log('  --format <type>        Export format: json, yaml');
  console.log('  --redact               🔒 Enable API key redaction (security feature)');
  console.log('  --secure               Alias for --redact');
  console.log();
  console.log('🎯 Mode Selection:');
  console.log('  (no flag)              AUTO MODE (default) - Uses ReasoningBank if initialized, else JSON fallback');
  console.log('  --reasoningbank, --rb  Force ReasoningBank mode (AI-powered)');
  console.log('  --basic                Force Basic mode (JSON storage)');
  console.log('  --auto                 Explicit auto-detect (same as default)');
  console.log();
  console.log('🔒 Security Features (v2.6.0):');
  console.log('  API Key Protection:    Automatically detects and redacts sensitive data');
  console.log('  Patterns Detected:     Anthropic, OpenRouter, Gemini, Bearer tokens, etc.');
  console.log('  Auto-Validation:       Warns when storing unredacted sensitive data');
  console.log('  Display Redaction:     Redact sensitive data when querying with --redact');
  console.log();
  console.log('Examples:');
  console.log('  # Basic mode (default - backward compatible)');
  console.log('  memory store previous_work "Research findings from yesterday"');
  console.log('  memory store api_config "key=sk-ant-..." --redact  # 🔒 Redacts API key');
  console.log('  memory query research --namespace sparc');
  console.log();
  console.log('  # ReasoningBank mode (AI-powered, opt-in)');
  console.log('  memory init --reasoningbank  # One-time setup');
  console.log('  memory store api_pattern "Always use env vars" --reasoningbank');
  console.log('  memory query "API configuration" --reasoningbank --limit 5  # Semantic search!');
  console.log('  memory list --reasoningbank --sort recent --limit 20');
  console.log('  memory export backup.json --format json --reasoningbank');
  console.log('  memory status --reasoningbank  # Show AI metrics');
  console.log();
  console.log('  # Auto-detect mode (smart selection)');
  console.log('  memory query config --auto  # Uses ReasoningBank if available');
  console.log();
  console.log('  # Mode management');
  console.log('  memory detect  # Show available modes');
  console.log('  memory mode    # Show current configuration');
  console.log();
  console.log('💡 Tips:');
  console.log('  • AUTO MODE (default): Automatically uses best available storage');
  console.log('  • ReasoningBank: AI-powered semantic search (learns from patterns)');
  console.log('  • JSON fallback: Always available, fast, simple key-value storage');
  console.log('  • Initialize ReasoningBank once: "memory init --reasoningbank"');
  console.log('  • Always use --redact when storing API keys or secrets!');
  console.log();
  console.log('🚀 Semantic Search (NEW in v2.7.25):');
  console.log('  NPX Mode:              Uses hash-based embeddings (text similarity)');
  console.log('                         • Fast, offline, zero dependencies');
  console.log('                         • Good for exact/partial text matching');
  console.log('  Local Install:         Uses transformer embeddings (semantic AI)');
  console.log('                         • Finds conceptually related content');
  console.log('                         • 384-dimensional vectors (Xenova/all-MiniLM-L6-v2)');
  console.log('                         • Install: npm install -g claude-flow@alpha');
  console.log('  Both modes work perfectly - choose based on your needs!');
}
