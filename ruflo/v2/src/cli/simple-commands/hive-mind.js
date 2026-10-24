/**
 * Hive Mind command for Claude-Flow v2.0.0
 * Advanced swarm intelligence with collective decision-making
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';
import readline from 'readline';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { args, cwd, exit, writeTextFile, readTextFile, mkdirAsync } from '../node-compat.js';
import {
  isInteractive,
  isRawModeSupported,
  warnNonInteractive,
  checkNonInteractiveAuth,
} from '../utils/interactive-detector.js';
import {
  safeInteractive,
  nonInteractiveProgress,
  nonInteractiveSelect,
} from '../utils/safe-interactive.js';

// Import SQLite for persistence - dynamically loaded to handle missing bindings
let Database = null;
let sqliteAvailable = false;

// Try to load better-sqlite3, but don't fail if bindings aren't available
async function loadSqlite() {
  if (Database !== null) return sqliteAvailable;
  try {
    // Try createRequire first for CommonJS modules (better-sqlite3 is CommonJS)
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    Database = require('better-sqlite3');
    // Test if bindings work by creating a temp in-memory database
    const testDb = new Database(':memory:');
    testDb.close();
    sqliteAvailable = true;
  } catch (requireErr) {
    // Fallback to dynamic import if createRequire fails
    try {
      const sqlite = await import('better-sqlite3');
      Database = sqlite.default || sqlite;
      const testDb = new Database(':memory:');
      testDb.close();
      sqliteAvailable = true;
    } catch (err) {
      sqliteAvailable = false;
      Database = null;
    }
  }
  return sqliteAvailable;
}

// Import help formatter
import { HelpFormatter } from '../help-formatter.js';

// Import MCP tool wrappers
import { MCPToolWrapper } from './hive-mind/mcp-wrapper.js';
import { HiveMindCore } from './hive-mind/core.js';
import { QueenCoordinator } from './hive-mind/queen.js';
import { CollectiveMemory } from './hive-mind/memory.js';
import { SwarmCommunication } from './hive-mind/communication.js';
import { HiveMindSessionManager } from './hive-mind/session-manager.js';
import { createAutoSaveMiddleware } from './hive-mind/auto-save-middleware.js';
import { HiveMindMetricsReader } from './hive-mind/metrics-reader.js';

function showHiveMindHelp() {
  console.log(`
${chalk.yellow('🧠 Claude Flow Hive Mind System')}

${chalk.bold('USAGE:')}
  claude-flow hive-mind [subcommand] [options]

${chalk.bold('SUBCOMMANDS:')}
  ${chalk.green('init')}         Initialize hive mind system
  ${chalk.green('spawn')}        Spawn hive mind swarm for a task
  ${chalk.green('status')}       Show hive mind status
  ${chalk.green('resume')}       Resume a paused hive mind session
  ${chalk.green('stop')}         Stop a running hive mind session
  ${chalk.green('sessions')}     List all hive mind sessions
  ${chalk.green('consensus')}    View consensus decisions
  ${chalk.green('memory')}       Manage collective memory
  ${chalk.green('metrics')}      View performance metrics
  ${chalk.green('wizard')}       Interactive hive mind wizard with Claude Code spawning

${chalk.bold('EXAMPLES:')}
  ${chalk.gray('# Initialize hive mind')}
  claude-flow hive-mind init

  ${chalk.gray('# Spawn swarm with interactive wizard')}
  claude-flow hive-mind spawn

  ${chalk.gray('# Quick spawn with objective')}
  claude-flow hive-mind spawn "Build microservices architecture"

  ${chalk.gray('# View current status')}
  claude-flow hive-mind status

  ${chalk.gray('# Interactive wizard with Claude Code spawning')}
  claude-flow hive-mind wizard

  ${chalk.gray('# Spawn with Claude Code coordination')}
  claude-flow hive-mind spawn "Build REST API" --claude

  ${chalk.gray('# Auto-spawn coordinated Claude Code instances')}
  claude-flow hive-mind spawn "Research AI trends" --auto-spawn --verbose

  ${chalk.gray('# List all sessions')}
  claude-flow hive-mind sessions

  ${chalk.gray('# Resume a paused session')}
  claude-flow hive-mind resume session-1234567890-abc123

${chalk.bold('KEY FEATURES:')}
  ${chalk.cyan('🐝')} Queen-led coordination with worker specialization
  ${chalk.cyan('🧠')} Collective memory and knowledge sharing
  ${chalk.cyan('🤝')} Consensus building for critical decisions
  ${chalk.cyan('⚡')} Parallel task execution with auto-scaling
  ${chalk.cyan('🔄')} Work stealing and load balancing
  ${chalk.cyan('📊')} Real-time metrics and performance tracking
  ${chalk.cyan('🛡️')} Fault tolerance and self-healing
  ${chalk.cyan('🔒')} Secure communication between agents

${chalk.bold('OPTIONS:')}
  --queen-type <type>    Queen coordinator type (strategic, tactical, adaptive)
  --max-workers <n>      Maximum worker agents (default: 8)
  --consensus <type>     Consensus algorithm (majority, weighted, byzantine)
  --memory-size <mb>     Collective memory size in MB (default: 100)
  --auto-scale           Enable auto-scaling based on workload
  --encryption           Enable encrypted communication
  --monitor              Real-time monitoring dashboard
  --verbose              Detailed logging
  --claude               Generate Claude Code spawn commands with coordination
  --spawn                Alias for --claude
  --auto-spawn           Automatically spawn Claude Code instances
  --execute              Execute Claude Code spawn commands immediately

${chalk.bold('For more information:')}
${chalk.blue('https://github.com/ruvnet/claude-flow/tree/main/docs/hive-mind')}
`);
}

/**
 * Initialize hive mind system
 */
async function initHiveMind(flags) {
  const spinner = ora('Initializing Hive Mind system...').start();

  try {
    // Create hive mind directory structure
    const hiveMindDir = path.join(cwd(), '.hive-mind');
    if (!existsSync(hiveMindDir)) {
      mkdirSync(hiveMindDir, { recursive: true });
    }

    // Check SQLite availability
    const hasSqlite = await loadSqlite();

    if (!hasSqlite) {
      // Fall back to JSON-based initialization
      spinner.text = 'Initializing Hive Mind with JSON fallback...';

      const fallbackPath = path.join(hiveMindDir, 'memory.json');
      const fallbackData = {
        metadata: {
          type: 'fallback',
          initialized: new Date().toISOString(),
          version: '2.0.0',
          warning: 'Using JSON fallback - SQLite bindings not available'
        },
        swarms: [],
        agents: [],
        tasks: [],
        collective_memory: [],
        consensus_votes: [],
        messages: []
      };

      await writeFile(fallbackPath, JSON.stringify(fallbackData, null, 2), 'utf8');

      spinner.succeed('Hive Mind initialized with JSON fallback');
      console.log(chalk.yellow('\n⚠️  Note: SQLite native bindings not available'));
      console.log(chalk.gray('   Using JSON fallback for data persistence'));
      console.log(chalk.gray('   For full SQLite features, install locally: npm install claude-flow'));
      return;
    }

    // Initialize SQLite database
    const dbPath = path.join(hiveMindDir, 'hive.db');
    const db = new Database(dbPath);

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        objective TEXT,
        status TEXT DEFAULT 'active',
        queen_type TEXT DEFAULT 'strategic',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        role TEXT,
        status TEXT DEFAULT 'idle',
        capabilities TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );
      
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        agent_id TEXT,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
      
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
        compressed INTEGER DEFAULT 0,
        size INTEGER DEFAULT 0,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );
      
      CREATE TABLE IF NOT EXISTS consensus_decisions (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        topic TEXT NOT NULL,
        decision TEXT,
        votes TEXT,
        algorithm TEXT DEFAULT 'majority',
        confidence REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );
    `);

    db.close();

    // Create configuration file
    const config = {
      version: '2.0.0',
      initialized: new Date().toISOString(),
      defaults: {
        queenType: 'strategic',
        maxWorkers: 8,
        consensusAlgorithm: 'majority',
        memorySize: 100,
        autoScale: true,
        encryption: false,
      },
      mcpTools: {
        enabled: true,
        parallel: true,
        timeout: 60000,
      },
    };

    await writeFile(path.join(hiveMindDir, 'config.json'), JSON.stringify(config, null, 2));

    spinner.succeed('Hive Mind system initialized successfully!');

    console.log('\n' + chalk.green('✓') + ' Created .hive-mind directory');
    console.log(chalk.green('✓') + ' Initialized SQLite database');
    console.log(chalk.green('✓') + ' Created configuration file');
    console.log('\n' + chalk.yellow('Next steps:'));
    console.log(
      '  1. Run ' + chalk.cyan('claude-flow hive-mind spawn') + ' to create your first swarm',
    );
    console.log(
      '  2. Use ' + chalk.cyan('claude-flow hive-mind wizard') + ' for interactive setup',
    );
  } catch (error) {
    spinner.fail('Failed to initialize Hive Mind system');
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Interactive wizard for hive mind operations
 */
// Wrapped wizard function that handles non-interactive environments
const hiveMindWizard = safeInteractive(
  // Interactive version
  async function (flags = {}) {
    console.log(chalk.yellow('\n🧙 Hive Mind Interactive Wizard\n'));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '🐝 Create new swarm', value: 'spawn' },
          { name: '📊 View swarm status', value: 'status' },
          { name: '🧠 Manage collective memory', value: 'memory' },
          { name: '🤝 View consensus decisions', value: 'consensus' },
          { name: '📈 Performance metrics', value: 'metrics' },
          { name: '🔧 Configure hive mind', value: 'config' },
          { name: '❌ Exit', value: 'exit' },
        ],
      },
    ]);

    switch (action) {
      case 'spawn':
        await spawnSwarmWizard();
        break;
      case 'status':
        await showStatus({});
        break;
      case 'memory':
        await manageMemoryWizard();
        break;
      case 'consensus':
        await showConsensus({});
        break;
      case 'metrics':
        await showMetrics({});
        break;
      case 'config':
        await configureWizard();
        break;
      case 'exit':
        console.log(chalk.gray('Exiting wizard...'));
        break;
    }
  },
  // Non-interactive fallback
  async function (flags = {}) {
    console.log(chalk.yellow('\n🧙 Hive Mind - Non-Interactive Mode\n'));

    // Default to creating a swarm with sensible defaults
    console.log(chalk.cyan('Creating new swarm with default settings...'));
    console.log(chalk.gray('Use command-line flags to customize:'));
    console.log(chalk.gray('  --objective "Your task"    Set swarm objective'));
    console.log(chalk.gray('  --queen-type strategic     Set queen type'));
    console.log(chalk.gray('  --max-workers 8            Set worker count'));
    console.log();

    const objective = flags.objective || 'General task coordination';
    const config = {
      name: flags.name || `swarm-${Date.now()}`,
      queenType: flags.queenType || flags['queen-type'] || 'strategic',
      maxWorkers: parseInt(flags.maxWorkers || flags['max-workers'] || '8'),
      consensusAlgorithm: flags.consensus || flags.consensusAlgorithm || 'majority',
      autoScale: flags.autoScale || flags['auto-scale'] || false,
      namespace: flags.namespace || 'default',
      verbose: flags.verbose || false,
      encryption: flags.encryption || false,
    };

    await spawnSwarm([objective], {
      ...flags,
      name: config.name,
      queenType: config.queenType,
      maxWorkers: config.maxWorkers,
      consensusAlgorithm: config.consensusAlgorithm,
      autoScale: config.autoScale,
      encryption: config.encryption,
      nonInteractive: true,
    });
  },
);

/**
 * Spawn swarm wizard
 */
async function spawnSwarmWizard() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'objective',
      message: 'What is the swarm objective?',
      validate: (input) => input.trim().length > 0 || 'Please enter an objective',
    },
    {
      type: 'input',
      name: 'name',
      message: 'Swarm name (optional):',
      default: (answers) => `swarm-${Date.now()}`,
    },
    {
      type: 'list',
      name: 'queenType',
      message: 'Select queen coordinator type:',
      choices: [
        { name: 'Strategic - High-level planning and coordination', value: 'strategic' },
        { name: 'Tactical - Detailed task management', value: 'tactical' },
        { name: 'Adaptive - Learns and adapts strategies', value: 'adaptive' },
      ],
      default: 'strategic',
    },
    {
      type: 'number',
      name: 'maxWorkers',
      message: 'Maximum number of worker agents:',
      default: 8,
      validate: (input) => (input > 0 && input <= 20) || 'Please enter a number between 1 and 20',
    },
    {
      type: 'checkbox',
      name: 'workerTypes',
      message: 'Select worker agent types:',
      choices: [
        { name: 'Researcher', value: 'researcher', checked: true },
        { name: 'Coder', value: 'coder', checked: true },
        { name: 'Analyst', value: 'analyst', checked: true },
        { name: 'Tester', value: 'tester', checked: true },
        { name: 'Architect', value: 'architect' },
        { name: 'Reviewer', value: 'reviewer' },
        { name: 'Optimizer', value: 'optimizer' },
        { name: 'Documenter', value: 'documenter' },
      ],
    },
    {
      type: 'list',
      name: 'consensusAlgorithm',
      message: 'Consensus algorithm for decisions:',
      choices: [
        { name: 'Majority - Simple majority voting', value: 'majority' },
        { name: 'Weighted - Expertise-weighted voting', value: 'weighted' },
        { name: 'Byzantine - Fault-tolerant consensus', value: 'byzantine' },
      ],
      default: 'majority',
    },
    {
      type: 'confirm',
      name: 'autoScale',
      message: 'Enable auto-scaling?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'monitor',
      message: 'Launch monitoring dashboard?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'spawnClaude',
      message: 'Spawn Claude Code instance with hive-mind coordination?',
      default: true,
    },
  ]);

  // Spawn the swarm with collected parameters
  const swarmResult = await spawnSwarm([answers.objective], {
    name: answers.name,
    queenType: answers.queenType,
    'queen-type': answers.queenType,
    maxWorkers: answers.maxWorkers,
    'max-workers': answers.maxWorkers,
    workerTypes: answers.workerTypes.join(','),
    consensus: answers.consensusAlgorithm,
    autoScale: answers.autoScale,
    'auto-scale': answers.autoScale,
    monitor: answers.monitor,
    namespace: answers.namespace || 'default',
    verbose: answers.verbose || false,
    spawnClaude: answers.spawnClaude, // Pass the Claude spawning preference
  });

  // If Claude Code spawning was requested, launch it using the same function as --claude flag
  if (answers.spawnClaude && swarmResult && swarmResult.swarmId) {
    // Create workers array in the same format expected by spawnClaudeCodeInstances
    const workers = answers.workerTypes.map((type, index) => ({
      id: `worker-${index + 1}`,
      type,
      role: 'worker',
      status: 'active',
      capabilities: getAgentCapabilities(type)
    }));
    
    // Create flags object with the wizard settings
    const claudeFlags = {
      queenType: answers.queenType,
      consensus: answers.consensusAlgorithm,
      autoScale: answers.autoScale,
      monitor: answers.monitor,
      namespace: answers.namespace || 'default',
      verbose: answers.verbose || false
    };
    
    // Use the same Claude spawning function as the --claude flag
    console.log(chalk.cyan(`\n🎯 Objective from wizard: "${answers.objective}"`));
    await spawnClaudeCodeInstances(
      swarmResult.swarmId,
      answers.name,
      answers.objective,
      workers,
      claudeFlags
    );
  }
  
  return swarmResult;
}

/**
 * Spawn a hive mind swarm
 */
async function spawnSwarm(args, flags) {
  // Load SQLite before using Database constructor
  const hasSqlite = await loadSqlite();
  if (!hasSqlite) {
    console.error(chalk.red('Error: SQLite is required for hive-mind spawn'));
    console.log(chalk.yellow('Please ensure better-sqlite3 is properly installed:'));
    console.log(chalk.gray('  npm install better-sqlite3'));
    console.log(chalk.gray('  # or for ARM64/M1: npm rebuild better-sqlite3'));
    return;
  }

  const objective = args.join(' ').trim();

  // Check for non-interactive mode FIRST
  const isNonInteractive = flags['non-interactive'] || flags.nonInteractive;
  
  if (!objective && !flags.wizard) {
    if (isNonInteractive) {
      console.error(chalk.red('Error: Objective required in non-interactive mode'));
      console.log('Usage: claude-flow hive-mind spawn "Your objective" --non-interactive');
    } else {
      console.error(chalk.red('Error: Please provide an objective or use --wizard flag'));
      console.log('Example: claude-flow hive-mind spawn "Build REST API"');
    }
    return;
  }
  
  // Log non-interactive mode status
  if (isNonInteractive && flags.verbose) {
    console.log(chalk.cyan('🤖 Running in non-interactive mode'));
  }

  // Validate parameters
  if (flags.verbose) {
    console.log(chalk.gray('🔍 Debug: Parsed flags:'));
    console.log(chalk.gray(JSON.stringify(flags, null, 2)));
  }

  // Validate queen type
  const validQueenTypes = ['strategic', 'tactical', 'adaptive'];
  const queenType = flags.queenType || flags['queen-type'] || 'strategic';
  if (!validQueenTypes.includes(queenType)) {
    console.error(chalk.red(`Error: Invalid queen type '${queenType}'. Must be one of: ${validQueenTypes.join(', ')}`));
    return;
  }

  // Validate max workers
  const maxWorkers = parseInt(flags.maxWorkers || flags['max-workers'] || '8');
  if (isNaN(maxWorkers) || maxWorkers < 1 || maxWorkers > 20) {
    console.error(chalk.red('Error: max-workers must be a number between 1 and 20'));
    return;
  }

  // Validate consensus algorithm
  const validConsensusTypes = ['majority', 'weighted', 'byzantine'];
  const consensusAlgorithm = flags.consensus || flags.consensusAlgorithm || 'majority';
  if (!validConsensusTypes.includes(consensusAlgorithm)) {
    console.error(chalk.red(`Error: Invalid consensus algorithm '${consensusAlgorithm}'. Must be one of: ${validConsensusTypes.join(', ')}`));
    return;
  }

  const spinner = ora('Spawning Hive Mind swarm...').start();

  try {
    // Initialize hive mind core with error handling
    let hiveMind;
    try {
      spinner.text = 'Initializing Hive Mind Core...';
      hiveMind = new HiveMindCore({
        objective,
        name: flags.name || `hive-${Date.now()}`,
        queenType: flags.queenType || flags['queen-type'] || 'strategic',
        maxWorkers: parseInt(flags.maxWorkers || flags['max-workers'] || '8'),
        consensusAlgorithm: flags.consensus || flags.consensusAlgorithm || 'majority',
        autoScale: flags.autoScale !== undefined ? flags.autoScale : (flags['auto-scale'] !== undefined ? flags['auto-scale'] : true),
        namespace: flags.namespace || 'default',
        encryption: flags.encryption || false,
      });
    } catch (error) {
      console.error('HiveMindCore initialization failed:', error);
      throw new Error(`Failed to initialize HiveMindCore: ${error.message}`);
    }

    spinner.text = 'Setting up database connection...';
    // Initialize database connection
    const dbDir = path.join(cwd(), '.hive-mind');
    const dbPath = path.join(dbDir, 'hive.db');

    // Ensure .hive-mind directory exists
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Check if database file exists and try to create a clean one if needed
    let db;
    try {
      spinner.text = 'Creating database connection...';
      db = new Database(dbPath);
      // Test the database with a simple query
      db.prepare('SELECT 1').get();
      spinner.text = 'Database connection established';
    } catch (error) {
      console.warn('Database issue detected, recreating...', error.message);
      spinner.text = 'Recreating database...';
      // Remove corrupted database
      if (existsSync(dbPath)) {
        try {
          const fs = await import('fs');
          fs.unlinkSync(dbPath);
        } catch (e) {
          console.warn('Could not remove corrupted database:', e.message);
        }
      }
      // Create new database
      db = new Database(dbPath);
    }

    // Initialize database schema if not exists
    spinner.text = 'Creating database schema...';
    try {
      db.exec(`
      CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        objective TEXT,
        queen_type TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );
      
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT DEFAULT 'idle',
        capabilities TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );
      
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        agent_id TEXT,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
      
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
        compressed INTEGER DEFAULT 0,
        size INTEGER DEFAULT 0,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );
      
      CREATE TABLE IF NOT EXISTS consensus_decisions (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        topic TEXT NOT NULL,
        decision TEXT,
        votes TEXT,
        algorithm TEXT DEFAULT 'majority',
        confidence REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        swarm_name TEXT NOT NULL,
        objective TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paused_at DATETIME,
        resumed_at DATETIME,
        completion_percentage REAL DEFAULT 0,
        checkpoint_data TEXT,
        metadata TEXT,
        parent_pid INTEGER,
        child_pids TEXT,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );
      
      CREATE TABLE IF NOT EXISTS session_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        checkpoint_name TEXT NOT NULL,
        checkpoint_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      
      CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        log_level TEXT DEFAULT 'info',
        message TEXT,
        agent_id TEXT,
        data TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);
      spinner.text = 'Database schema created successfully';
    } catch (error) {
      console.error('Database schema creation failed:', error);
      throw new Error(`Failed to create database schema: ${error.message}`);
    }

    // Create swarm record with safe ID generation
    spinner.text = 'Creating swarm record...';
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 11); // Use substring instead of substr
    const swarmId = `swarm-${timestamp}-${randomPart}`;
    try {
      db.prepare(
        `
        INSERT INTO swarms (id, name, objective, queen_type)
        VALUES (?, ?, ?, ?)
      `,
      ).run(swarmId, hiveMind.config.name, objective, hiveMind.config.queenType);
    } catch (error) {
      console.error('Failed to create swarm record:', error);
      throw new Error(`Failed to create swarm record: ${error.message}`);
    }

    // Create session for this swarm
    spinner.text = 'Creating session tracking...';
    const sessionManager = new HiveMindSessionManager();
    const sessionId = await sessionManager.createSession(swarmId, hiveMind.config.name, objective, {
      queenType: hiveMind.config.queenType,
      maxWorkers: hiveMind.config.maxWorkers,
      consensusAlgorithm: hiveMind.config.consensusAlgorithm,
      autoScale: hiveMind.config.autoScale,
      encryption: hiveMind.config.encryption,
      workerTypes: flags.workerTypes,
    });

    spinner.text = 'Session tracking established...';

    // Initialize auto-save middleware (use the same session manager)
    const autoSave = createAutoSaveMiddleware(sessionId, sessionManager, {
      saveInterval: 30000, // Save every 30 seconds
      autoStart: true,
    });

    // Close session manager after auto-save is set up
    // sessionManager.close(); // Don't close yet as auto-save needs it

    // Track initial swarm creation
    autoSave.trackChange('swarm_created', {
      swarmId,
      swarmName: hiveMind.config.name,
      objective,
      workerCount: hiveMind.config.maxWorkers,
    });

    spinner.text = 'Initializing Queen coordinator...';

    // Initialize Queen
    const queen = new QueenCoordinator({
      swarmId,
      type: hiveMind.config.queenType,
      objective,
    });

    // Spawn Queen agent
    const queenAgent = {
      id: `queen-${swarmId}`,
      swarmId,
      name: 'Queen Coordinator',
      type: 'coordinator',
      role: 'queen',
      status: 'active',
      capabilities: JSON.stringify(['coordination', 'planning', 'decision-making']),
    };

    db.prepare(
      `
      INSERT INTO agents (id, swarm_id, name, type, role, status, capabilities)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(...Object.values(queenAgent));

    spinner.text = 'Spawning worker agents...';

    // Determine worker types
    const workerTypes = flags.workerTypes
      ? flags.workerTypes.split(',')
      : ['researcher', 'coder', 'analyst', 'tester'];

    // Spawn worker agents
    const workers = [];
    for (let i = 0; i < Math.min(workerTypes.length, hiveMind.config.maxWorkers); i++) {
      const workerType = workerTypes[i % workerTypes.length];
      const workerId = `worker-${swarmId}-${i}`;

      const worker = {
        id: workerId,
        swarmId,
        name: `${workerType.charAt(0).toUpperCase() + workerType.slice(1)} Worker ${i + 1}`,
        type: workerType,
        role: 'worker',
        status: 'idle',
        capabilities: JSON.stringify(getAgentCapabilities(workerType)),
      };

      workers.push(worker);

      db.prepare(
        `
        INSERT INTO agents (id, swarm_id, name, type, role, status, capabilities)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(...Object.values(worker));

      // Track agent spawning for auto-save
      autoSave.trackAgentActivity(workerId, 'spawned', {
        type: workerType,
        name: worker.name,
      });
    }

    spinner.text = 'Initializing collective memory...';

    // Initialize collective memory
    const memory = new CollectiveMemory({
      swarmId,
      maxSize: flags.memorySize || 100,
    });

    // Store initial context
    memory.store('objective', objective, 'context');
    memory.store('queen_type', hiveMind.config.queenType, 'config');
    memory.store('worker_count', workers.length, 'metrics');
    memory.store('session_id', sessionId, 'system');

    spinner.text = 'Establishing communication channels...';

    // Initialize communication system
    const communication = new SwarmCommunication({
      swarmId,
      encryption: hiveMind.config.encryption,
    });

    db.close();

    spinner.succeed('Hive Mind swarm spawned successfully!');

    // Display swarm summary
    console.log('\n' + chalk.bold('🐝 Swarm Summary:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('Swarm ID:'), swarmId);
    console.log(chalk.cyan('Session ID:'), sessionId);
    console.log(chalk.cyan('Name:'), hiveMind.config.name);
    console.log(chalk.cyan('Objective:'), objective);
    console.log(chalk.cyan('Queen Type:'), hiveMind.config.queenType);
    console.log(chalk.cyan('Workers:'), workers.length);
    console.log(chalk.cyan('Worker Types:'), workerTypes.join(', '));
    console.log(chalk.cyan('Consensus:'), hiveMind.config.consensusAlgorithm);
    console.log(chalk.cyan('Auto-scaling:'), hiveMind.config.autoScale ? 'Enabled' : 'Disabled');
    console.log(chalk.gray('─'.repeat(50)));

    // Launch monitoring if requested
    if (flags.monitor) {
      console.log('\n' + chalk.yellow('Launching monitoring dashboard...'));
      // TODO: Implement monitoring dashboard
    }

    // Enhanced coordination instructions with MCP tools
    console.log('\n' + chalk.green('✓') + ' Swarm is ready for coordination');
    console.log(chalk.gray('Use "claude-flow hive-mind status" to view swarm activity'));
    console.log(chalk.gray('Session auto-save enabled - progress saved every 30 seconds'));
    console.log(chalk.blue('💡 To pause:') + ' Press Ctrl+C to safely pause and resume later');
    console.log(chalk.blue('💡 To resume:') + ' claude-flow hive-mind resume ' + sessionId);

    // Set up SIGINT handler for automatic session pausing
    let isExiting = false;
    const sigintHandler = async () => {
      if (isExiting) return;
      isExiting = true;

      console.log('\n\n' + chalk.yellow('⏸️  Pausing session...'));
      
      try {
        // Save current checkpoint using the existing session manager
        // const sessionManager = new HiveMindSessionManager(); // Use existing one
        
        // Create checkpoint data
        const checkpointData = {
          timestamp: new Date().toISOString(),
          swarmId,
          objective,
          workerCount: workers.length,
          workerTypes,
          status: 'paused_by_user',
          reason: 'User pressed Ctrl+C',
        };
        
        // Save checkpoint
        await sessionManager.saveCheckpoint(sessionId, 'auto-pause', checkpointData);
        
        // Pause the session
        await sessionManager.pauseSession(sessionId);
        
        // Close session manager
        sessionManager.close();
        
        console.log(chalk.green('✓') + ' Session paused successfully');
        console.log(chalk.cyan('\nTo resume this session, run:'));
        console.log(chalk.bold(`  claude-flow hive-mind resume ${sessionId}`));
        console.log();
        
        // Clean up auto-save if active
        if (global.autoSaveInterval) {
          clearInterval(global.autoSaveInterval);
        }
        
        process.exit(0);
      } catch (error) {
        console.error(chalk.red('Error pausing session:'), error.message);
        process.exit(1);
      }
    };

    // Register SIGINT handler
    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigintHandler);

    // Offer to spawn Claude Code instances with coordination instructions
    // Spawn Claude if --claude or --spawn flag is set
    if (flags.claude || flags.spawn) {
      await spawnClaudeCodeInstances(swarmId, hiveMind.config.name, objective, workers, flags);
    } else {
      console.log(
        '\n' +
          chalk.blue('💡 Pro Tip:') +
          ' Add --claude to spawn coordinated Claude Code instances',
      );
      console.log(chalk.gray('   claude-flow hive-mind spawn "objective" --claude'));
    }

    // Return swarm info for wizard use
    return { swarmId, hiveMind };
  } catch (error) {
    spinner.fail('Failed to spawn Hive Mind swarm');
    console.error(chalk.red('Error:'), error.message);

    // If error contains "sha3", provide specific guidance
    if (error.message.includes('sha3') || error.message.includes('SHA3')) {
      console.error('\n🔍 SHA3 Function Error Detected');
      console.error('This appears to be a SQLite extension or better-sqlite3 configuration issue.');
      console.error('\nPossible solutions:');
      console.error('1. Try removing the corrupted database: rm -rf .hive-mind/');
      console.error('2. Reinstall better-sqlite3: npm reinstall better-sqlite3');
      console.error('3. Check if any SQLite extensions are conflicting');
      console.error('\n🚨 Detailed error:');
      console.error(error.stack || error.message);
    }

    exit(1);
  }
}

/**
 * Get agent capabilities based on type
 */
function getAgentCapabilities(type) {
  const capabilities = {
    researcher: ['web-search', 'data-gathering', 'analysis', 'synthesis'],
    coder: ['code-generation', 'implementation', 'refactoring', 'debugging'],
    analyst: ['data-analysis', 'pattern-recognition', 'reporting', 'visualization'],
    tester: ['test-generation', 'quality-assurance', 'bug-detection', 'validation'],
    architect: ['system-design', 'architecture', 'planning', 'documentation'],
    reviewer: ['code-review', 'quality-check', 'feedback', 'improvement'],
    optimizer: ['performance-tuning', 'optimization', 'profiling', 'enhancement'],
    documenter: ['documentation', 'explanation', 'tutorial-creation', 'knowledge-base'],
  };

  return capabilities[type] || ['general'];
}

/**
 * Show hive mind status
 */
async function showStatus(flags) {
  try {
    const hiveMindDir = path.join(cwd(), '.hive-mind');
    const dbPath = path.join(hiveMindDir, 'hive.db');
    const fallbackPath = path.join(hiveMindDir, 'memory.json');

    // Check if hive-mind is initialized at all
    if (!existsSync(hiveMindDir)) {
      console.error(chalk.red('Error: Hive Mind not initialized'));
      console.log('Run "claude-flow hive-mind init" first');
      return;
    }

    // Check SQLite availability
    const hasSqlite = await loadSqlite();

    // If SQLite database exists but bindings aren't available
    if (existsSync(dbPath) && !hasSqlite) {
      console.log(chalk.yellow('⚠️  SQLite native bindings not available'));
      console.log(chalk.gray('   This is normal when using npx or remote execution'));
      console.log('');

      // Try to show basic status from fallback JSON
      if (existsSync(fallbackPath)) {
        try {
          const fallbackData = JSON.parse(await readFile(fallbackPath, 'utf8'));
          console.log(chalk.bold('🐝 Hive Mind Status (from fallback memory)'));
          console.log(chalk.cyan('  Database:'), chalk.yellow('JSON fallback'));
          console.log(chalk.cyan('  Swarms:'), fallbackData.swarms?.length || 0);
          console.log(chalk.cyan('  Agents:'), fallbackData.agents?.length || 0);
          console.log('');
          console.log(chalk.gray('💡 For full SQLite features, install locally:'));
          console.log(chalk.gray('   npm install claude-flow'));
          return;
        } catch {
          // Fallback file exists but couldn't be read
        }
      }

      // Show minimal status
      console.log(chalk.bold('🐝 Hive Mind Status'));
      console.log(chalk.cyan('  Initialized:'), chalk.green('Yes'));
      console.log(chalk.cyan('  Database:'), chalk.yellow('SQLite (unavailable in npx mode)'));
      console.log('');
      console.log(chalk.gray('💡 For full functionality, install locally:'));
      console.log(chalk.gray('   npm install claude-flow'));
      return;
    }

    if (!existsSync(dbPath)) {
      // Check for fallback JSON database
      if (existsSync(fallbackPath)) {
        try {
          const fallbackData = JSON.parse(await readFile(fallbackPath, 'utf8'));
          console.log(chalk.bold('🐝 Hive Mind Status (JSON fallback mode)'));
          console.log(chalk.cyan('  Database:'), chalk.yellow('JSON fallback'));
          console.log(chalk.cyan('  Swarms:'), fallbackData.swarms?.length || 0);
          console.log(chalk.cyan('  Agents:'), fallbackData.agents?.length || 0);
          console.log(chalk.cyan('  Tasks:'), fallbackData.tasks?.length || 0);
          return;
        } catch {
          console.error(chalk.red('Error: Hive Mind not initialized'));
          console.log('Run "claude-flow hive-mind init" first');
          return;
        }
      }
      console.error(chalk.red('Error: Hive Mind not initialized'));
      console.log('Run "claude-flow hive-mind init" first');
      return;
    }

    // Use the metrics reader for real data
    const metricsReader = new HiveMindMetricsReader(dbPath);
    const swarms = metricsReader.getActiveSwarms();

    if (swarms.length === 0) {
      console.log(chalk.gray('No active swarms found'));
      metricsReader.close();
      return;
    }

    console.log(chalk.bold('\n🐝 Active Hive Mind Swarms\n'));

    for (const swarm of swarms) {
      console.log(chalk.yellow('═'.repeat(60)));
      console.log(chalk.cyan('Swarm:'), swarm.name);
      console.log(chalk.cyan('ID:'), swarm.id);
      console.log(chalk.cyan('Objective:'), swarm.objective);
      console.log(chalk.cyan('Queen Type:'), swarm.queen_type);
      console.log(chalk.cyan('Status:'), chalk.green(swarm.status));
      console.log(chalk.cyan('Created:'), new Date(swarm.created_at).toLocaleString());
      
      // Show real agent count
      console.log(chalk.cyan('Total Agents:'), swarm.agent_count || 0);

      console.log('\n' + chalk.bold('Agents:'));

      // Group by role using real agent data
      const agents = swarm.agents || [];
      const queen = agents.find((a) => a.role === 'queen');
      const workers = agents.filter((a) => a.role === 'worker');

      if (queen) {
        console.log('  ' + chalk.magenta('👑 Queen:'), queen.name, chalk.gray(`(${queen.status})`));
      } else {
        console.log('  ' + chalk.gray('No queen assigned yet'));
      }

      console.log('  ' + chalk.blue('🐝 Workers:'));
      if (workers.length > 0) {
        workers.forEach((worker) => {
          const statusColor =
            worker.status === 'active' ? 'green' : worker.status === 'busy' ? 'yellow' : 'gray';
          console.log(`    - ${worker.name} (${worker.type}) ${chalk[statusColor](worker.status)}`);
        });
      } else {
        console.log('    ' + chalk.gray('No workers spawned yet'));
      }

      // Get real task statistics
      const taskStats = swarm.task_metrics || {
        total: 0,
        completed: 0,
        in_progress: 0,
        pending: 0,
        failed: 0
      };

      console.log('\n' + chalk.bold('Tasks:'));
      console.log(`  Total: ${taskStats.total}`);
      console.log(`  Completed: ${chalk.green(taskStats.completed || 0)}`);
      console.log(`  In Progress: ${chalk.yellow(taskStats.in_progress || 0)}`);
      console.log(`  Pending: ${chalk.gray(taskStats.pending || 0)}`);
      console.log(`  ${chalk.bold('Completion:')} ${swarm.completion_percentage || 0}%`);

      // Show real memory count
      console.log('\n' + chalk.bold('Collective Memory:'));
      console.log(`  Entries: ${swarm.memory_count || 0}`);

      // Show real consensus count
      console.log('\n' + chalk.bold('Consensus Decisions:'));
      console.log(`  Total: ${swarm.consensus_count || 0}`);
    }

    console.log(chalk.yellow('═'.repeat(60)) + '\n');

    metricsReader.close();
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Show consensus decisions
 */
async function showConsensus(flags) {
  // Load SQLite before using Database constructor
  const hasSqlite = await loadSqlite();
  if (!hasSqlite) {
    console.error(chalk.red('Error: SQLite is required for this command'));
    return;
  }
  try {
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    const db = new Database(dbPath);

    const decisions = db
      .prepare(
        `
      SELECT cd.*, s.name as swarm_name
      FROM consensus_decisions cd
      JOIN swarms s ON cd.swarm_id = s.id
      ORDER BY cd.created_at DESC
      LIMIT 20
    `,
      )
      .all();

    if (decisions.length === 0) {
      console.log(chalk.gray('No consensus decisions found'));
      db.close();
      return;
    }

    console.log(chalk.bold('\n🤝 Recent Consensus Decisions\n'));

    decisions.forEach((decision) => {
      console.log(chalk.yellow('─'.repeat(50)));
      console.log(chalk.cyan('Swarm:'), decision.swarm_name);
      console.log(chalk.cyan('Topic:'), decision.topic);
      console.log(chalk.cyan('Decision:'), decision.decision);
      console.log(chalk.cyan('Algorithm:'), decision.algorithm);
      console.log(chalk.cyan('Confidence:'), `${(decision.confidence * 100).toFixed(1)}%`);
      console.log(chalk.cyan('Time:'), new Date(decision.created_at).toLocaleString());

      if (decision.votes) {
        const votes = JSON.parse(decision.votes);
        console.log(chalk.cyan('Votes:'));

        // Handle vote summary format (for/against/abstain/details)
        if (votes.for !== undefined || votes.against !== undefined || votes.abstain !== undefined) {
          console.log(`  - for: ${votes.for || 0}`);
          console.log(`  - against: ${votes.against || 0}`);
          console.log(`  - abstain: ${votes.abstain || 0}`);

          // Display vote details properly if they exist
          if (votes.details && Array.isArray(votes.details)) {
            console.log('  - details:');
            votes.details.forEach((detail, index) => {
              if (typeof detail === 'object') {
                // Extract available fields
                const agent =
                  detail.agentId ||
                  detail.agent ||
                  detail.id ||
                  detail.name ||
                  `agent-${index + 1}`;
                const vote = detail.vote || detail.choice || detail.decision || 'unknown';
                const reason = detail.reason || detail.justification || detail.rationale;

                // Build display string
                let displayString = `    ${index + 1}. Agent: ${agent}, Vote: ${vote}`;

                // Add reason if available
                if (reason && reason !== 'N/A' && reason !== '') {
                  displayString += `, Reason: ${reason}`;
                }

                console.log(displayString);
              } else {
                console.log(`    ${index + 1}. ${detail}`);
              }
            });
          }
        } else {
          // Handle individual agent votes format
          Object.entries(votes).forEach(([agent, vote]) => {
            console.log(`  - ${agent}: ${vote}`);
          });
        }
      }
    });

    console.log(chalk.yellow('─'.repeat(50)) + '\n');

    db.close();
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Show performance metrics
 */
async function showMetrics(flags) {
  // Load SQLite before using Database constructor
  const hasSqlite = await loadSqlite();
  if (!hasSqlite) {
    console.error(chalk.red('Error: SQLite is required for this command'));
    return;
  }
  try {
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    const db = new Database(dbPath);

    // Get overall metrics
    const overallStats = db
      .prepare(
        `
      SELECT 
        (SELECT COUNT(*) FROM swarms) as total_swarms,
        (SELECT COUNT(*) FROM agents) as total_agents,
        (SELECT COUNT(*) FROM tasks) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks
    `,
      )
      .get();

    console.log(chalk.bold('\n📊 Hive Mind Performance Metrics\n'));

    // Get task status breakdown
    const taskBreakdown = db
      .prepare(
        `
      SELECT 
        status,
        COUNT(*) as count
      FROM tasks
      GROUP BY status
      ORDER BY count DESC
    `,
      )
      .all();

    console.log(chalk.cyan('Overall Statistics:'));
    console.log(`  Total Swarms: ${overallStats.total_swarms}`);
    console.log(`  Total Agents: ${overallStats.total_agents}`);
    console.log(`  Total Tasks: ${overallStats.total_tasks}`);
    console.log(`  Completed Tasks: ${overallStats.completed_tasks}`);
    console.log(
      `  Success Rate: ${
        overallStats.total_tasks > 0
          ? ((overallStats.completed_tasks / overallStats.total_tasks) * 100).toFixed(1) + '%'
          : 'N/A'
      }`,
    );

    if (taskBreakdown.length > 0) {
      console.log('\n' + chalk.cyan('Task Status Breakdown:'));
      taskBreakdown.forEach((status) => {
        const percentage =
          overallStats.total_tasks > 0
            ? ((status.count / overallStats.total_tasks) * 100).toFixed(1)
            : '0';
        const statusColor =
          status.status === 'completed'
            ? 'green'
            : status.status === 'in_progress'
              ? 'yellow'
              : status.status === 'failed'
                ? 'red'
                : 'gray';
        console.log(
          `  ${chalk[statusColor](status.status.charAt(0).toUpperCase() + status.status.slice(1))}: ${status.count} (${percentage}%)`,
        );
      });
    }

    // Get agent performance (check for completed_at column)
    let agentPerf = [];
    try {
      // Check if completed_at exists
      const hasCompletedAt = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
        WHERE name = 'completed_at'
      `,
        )
        .get();

      if (hasCompletedAt && hasCompletedAt.count > 0) {
        agentPerf = db
          .prepare(
            `
          SELECT 
            a.name,
            a.type,
            COUNT(t.id) as tasks_assigned,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as tasks_completed,
            AVG(CASE WHEN t.completed_at IS NOT NULL 
              THEN (julianday(t.completed_at) - julianday(t.created_at)) * 24 * 60 
              ELSE NULL END) as avg_completion_minutes
          FROM agents a
          LEFT JOIN tasks t ON a.id = t.agent_id
          GROUP BY a.id
          HAVING tasks_assigned > 0
          ORDER BY tasks_completed DESC
          LIMIT 10
        `,
          )
          .all();
      } else {
        // Simpler query without completed_at
        agentPerf = db
          .prepare(
            `
          SELECT 
            a.name,
            a.type,
            COUNT(t.id) as tasks_assigned,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as tasks_completed,
            NULL as avg_completion_minutes
          FROM agents a
          LEFT JOIN tasks t ON a.id = t.agent_id
          GROUP BY a.id
          HAVING tasks_assigned > 0
          ORDER BY tasks_completed DESC
          LIMIT 10
        `,
          )
          .all();
      }
    } catch (error) {
      console.warn('Could not get agent performance:', error.message);
    }

    if (agentPerf.length > 0) {
      console.log('\n' + chalk.cyan('Top Performing Agents:'));
      agentPerf.forEach((agent, index) => {
        const successRate =
          agent.tasks_assigned > 0
            ? ((agent.tasks_completed / agent.tasks_assigned) * 100).toFixed(1)
            : '0';
        console.log(`  ${index + 1}. ${agent.name} (${agent.type})`);
        console.log(
          `     Tasks: ${agent.tasks_completed}/${agent.tasks_assigned} (${successRate}%)`,
        );
        if (agent.avg_completion_minutes) {
          console.log(`     Avg Time: ${agent.avg_completion_minutes.toFixed(1)} minutes`);
        }
      });
    }

    // Get swarm performance
    const swarmPerf = db
      .prepare(
        `
      SELECT 
        s.name,
        s.objective,
        (SELECT COUNT(*) FROM agents a WHERE a.swarm_id = s.id) as agent_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.swarm_id = s.id) as task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.swarm_id = s.id AND t.status = 'completed') as completed_count,
        (SELECT COUNT(*) FROM collective_memory cm WHERE cm.swarm_id = s.id) as memory_entries,
        (SELECT COUNT(*) FROM consensus_decisions cd WHERE cd.swarm_id = s.id) as consensus_count
      FROM swarms s
      WHERE s.status = 'active'
      ORDER BY s.created_at DESC
      LIMIT 5
    `,
      )
      .all();

    if (swarmPerf.length > 0) {
      console.log('\n' + chalk.cyan('Active Swarm Performance:'));
      swarmPerf.forEach((swarm) => {
        const successRate =
          swarm.task_count > 0
            ? ((swarm.completed_count / swarm.task_count) * 100).toFixed(1)
            : '0';
        console.log(`\n  ${chalk.yellow(swarm.name)}`);
        console.log(`  Objective: ${swarm.objective.substring(0, 50)}...`);
        console.log(
          `  Agents: ${swarm.agent_count}, Tasks: ${swarm.completed_count}/${swarm.task_count} (${successRate}%)`,
        );
        console.log(
          `  Memory: ${swarm.memory_entries} entries, Consensus: ${swarm.consensus_count} decisions`,
        );
      });
    }

    // Get performance insights
    let avgTaskTime = { avg_minutes: null };
    try {
      // Check if completed_at exists
      const hasCompletedAt = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
        WHERE name = 'completed_at'
      `,
        )
        .get();

      if (hasCompletedAt && hasCompletedAt.count > 0) {
        avgTaskTime = db
          .prepare(
            `
          SELECT 
            AVG(CASE WHEN completed_at IS NOT NULL 
              THEN (julianday(completed_at) - julianday(created_at)) * 24 * 60 
              ELSE NULL END) as avg_minutes
          FROM tasks
          WHERE status = 'completed'
        `,
          )
          .get();
      }
    } catch (error) {
      console.warn('Could not calculate average task time:', error.message);
    }

    // Get agent type performance
    let agentTypePerf = [];
    try {
      // Check if completed_at exists
      const hasCompletedAt = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
        WHERE name = 'completed_at'
      `,
        )
        .get();

      if (hasCompletedAt && hasCompletedAt.count > 0) {
        agentTypePerf = db
          .prepare(
            `
          SELECT 
            a.type,
            COUNT(t.id) as total_tasks,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
            AVG(CASE WHEN t.completed_at IS NOT NULL 
              THEN (julianday(t.completed_at) - julianday(t.created_at)) * 24 * 60 
              ELSE NULL END) as avg_completion_minutes
          FROM agents a
          LEFT JOIN tasks t ON a.id = t.agent_id
          GROUP BY a.type
          HAVING total_tasks > 0
          ORDER BY completed_tasks DESC
        `,
          )
          .all();
      } else {
        // Simpler query without completed_at
        agentTypePerf = db
          .prepare(
            `
          SELECT 
            a.type,
            COUNT(t.id) as total_tasks,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
            NULL as avg_completion_minutes
          FROM agents a
          LEFT JOIN tasks t ON a.id = t.agent_id
          GROUP BY a.type
          HAVING total_tasks > 0
          ORDER BY completed_tasks DESC
        `,
          )
          .all();
      }
    } catch (error) {
      console.warn('Could not get agent type performance:', error.message);
    }

    if (avgTaskTime.avg_minutes) {
      console.log('\n' + chalk.cyan('Performance Insights:'));
      console.log(`  Average Task Completion Time: ${avgTaskTime.avg_minutes.toFixed(1)} minutes`);

      if (agentTypePerf.length > 0) {
        console.log('\n' + chalk.cyan('Agent Type Performance:'));
        agentTypePerf.forEach((type) => {
          const successRate =
            type.total_tasks > 0
              ? ((type.completed_tasks / type.total_tasks) * 100).toFixed(1)
              : '0';
          console.log(
            `  ${type.type.charAt(0).toUpperCase() + type.type.slice(1)}: ${type.completed_tasks}/${type.total_tasks} (${successRate}%)`,
          );
          if (type.avg_completion_minutes) {
            console.log(`    Average time: ${type.avg_completion_minutes.toFixed(1)} minutes`);
          }
        });
      }
    }

    console.log('\n');
    db.close();
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Manage collective memory wizard
 */
async function manageMemoryWizard() {
  console.log(chalk.blue('\n🧠 Collective Memory Management\n'));

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do with collective memory?',
      choices: [
        { name: '📋 View all memories', value: 'list' },
        { name: '🔍 Search memories', value: 'search' },
        { name: '💾 Store new memory', value: 'store' },
        { name: '📊 Memory statistics', value: 'stats' },
        { name: '🗑️ Clean old memories', value: 'clean' },
        { name: '📤 Export memory backup', value: 'export' },
        { name: '⬅️ Back to main menu', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'list':
      await listMemories();
      break;
    case 'search':
      await searchMemories();
      break;
    case 'store':
      await storeMemoryWizard();
      break;
    case 'stats':
      await showMemoryStats();
      break;
    case 'clean':
      await cleanMemories();
      break;
    case 'export':
      await exportMemoryBackup();
      break;
    case 'back':
      await hiveMindWizard();
      return;
  }

  // Ask if user wants to continue
  const { continue: continueAction } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'continue',
      message: 'Would you like to perform another memory operation?',
      default: true,
    },
  ]);

  if (continueAction) {
    await manageMemoryWizard();
  }
}

/**
 * Configure hive mind wizard
 */
async function configureWizard() {
  // TODO: Implement configuration wizard
  console.log(chalk.yellow('Configuration wizard coming soon...'));
}

/**
 * Main hive mind command handler
 */
export async function hiveMindCommand(args, flags) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  // Handle help flags
  if (
    !subcommand ||
    subcommand === '--help' ||
    subcommand === '-h' ||
    subcommand === 'help' ||
    flags.help
  ) {
    showHiveMindHelp();
    return;
  }

  // Warn about non-interactive environments for certain commands
  if ((subcommand === 'spawn' && (flags.claude || flags.spawn)) || subcommand === 'wizard') {
    warnNonInteractive('hive-mind ' + subcommand);
  }

  switch (subcommand) {
    case 'init':
      await initHiveMind(flags);
      break;

    case 'spawn':
      // Check for non-interactive mode FIRST (like alpha.83)
      if (flags['non-interactive'] || flags.nonInteractive) {
        // In non-interactive mode, skip wizard and use defaults
        if (subArgs.length === 0) {
          console.error(chalk.red('Error: Objective required in non-interactive mode'));
          console.log('Usage: claude-flow hive-mind spawn "Your objective" --non-interactive');
          return;
        }
        await spawnSwarm(subArgs, flags);
      } else if (flags.wizard || subArgs.length === 0) {
        await spawnSwarmWizard();
      } else {
        await spawnSwarm(subArgs, flags);
      }
      break;

    case 'status':
      await showStatus(flags);
      break;

    case 'sessions':
      await showSessions(flags);
      break;

    case 'resume':
      await resumeSession(subArgs, flags);
      break;

    case 'stop':
      await stopSession(subArgs, flags);
      break;

    case 'consensus':
      await showConsensus(flags);
      break;

    case 'memory':
      await manageMemoryWizard();
      break;

    case 'metrics':
      await showMetrics(flags);
      break;

    case 'wizard':
      await hiveMindWizard(flags);
      break;

    case 'help':
    case '--help':
    case '-h':
      showHiveMindHelp();
      break;

    default:
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
      console.log('Run "claude-flow hive-mind help" for usage information');
      exit(1);
  }
}

/**
 * List all memories in the collective memory store
 */
async function listMemories() {
  // Load SQLite before using Database constructor
  const hasSqlite = await loadSqlite();
  if (!hasSqlite) {
    console.error(chalk.red('Error: SQLite is required for this command'));
    return;
  }
  try {
    console.log(chalk.blue('\n📋 Collective Memory Store\n'));

    // Read directly from hive.db collective_memory table
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    const db = new Database(dbPath);

    const memories = db
      .prepare(
        `
        SELECT cm.*, s.name as swarm_name
        FROM collective_memory cm
        LEFT JOIN swarms s ON cm.swarm_id = s.id
        ORDER BY cm.created_at DESC
        LIMIT 50
      `,
      )
      .all();

    db.close();

    if (!memories || memories.length === 0) {
      console.log(chalk.yellow('No memories found in the collective store.'));
      console.log(
        chalk.gray('Try storing some memories first using the "💾 Store new memory" option.'),
      );
      return;
    }

    console.log(chalk.gray(`Found ${memories.length} memories in the collective store:\n`));

    memories.forEach((memory, index) => {
      console.log(chalk.cyan(`${index + 1}. ${memory.key}`));
      console.log(`   Swarm: ${memory.swarm_name || memory.swarm_id}`);
      console.log(`   Type: ${memory.type || 'knowledge'}`);
      console.log(`   Created: ${new Date(memory.created_at).toLocaleString()}`);
      console.log(`   Created by: ${memory.created_by || 'system'}`);
      
      // Parse and display value
      let displayValue = memory.value;
      try {
        const parsed = JSON.parse(memory.value);
        displayValue = JSON.stringify(parsed);
      } catch {
        // Keep as string
      }
      
      if (displayValue.length > 100) {
        console.log(`   Value: ${displayValue.substring(0, 100)}...`);
      } else {
        console.log(`   Value: ${displayValue}`);
      }
      
      if (memory.confidence !== null && memory.confidence !== 1) {
        console.log(`   Confidence: ${(memory.confidence * 100).toFixed(1)}%`);
      }
      
      console.log('');
    });
  } catch (error) {
    console.error(chalk.red('Error listing memories:'), error.message);
    console.log(chalk.gray('This might be because no memories have been stored yet.'));
  }
}

/**
 * Search memories by keyword
 */
async function searchMemories() {
  // Load SQLite before using Database constructor
  const hasSqlite = await loadSqlite();
  if (!hasSqlite) {
    console.error(chalk.red('Error: SQLite is required for this command'));
    return;
  }
  try {
    const { searchTerm } = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message: 'Enter search term:',
        validate: (input) => input.length > 0,
      },
    ]);

    console.log(chalk.blue(`\n🔍 Searching for: "${searchTerm}"\n`));

    // Search directly in hive.db collective_memory table
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    const db = new Database(dbPath);

    const searchPattern = `%${searchTerm}%`;
    const memories = db
      .prepare(
        `
        SELECT cm.*, s.name as swarm_name
        FROM collective_memory cm
        LEFT JOIN swarms s ON cm.swarm_id = s.id
        WHERE cm.key LIKE ? OR cm.value LIKE ? OR cm.type LIKE ?
        ORDER BY cm.created_at DESC
        LIMIT 50
      `,
      )
      .all(searchPattern, searchPattern, searchPattern);

    db.close();

    if (!memories || memories.length === 0) {
      console.log(chalk.yellow('No memories found matching your search.'));
      return;
    }

    console.log(chalk.gray(`Found ${memories.length} memories matching "${searchTerm}":\n`));

    memories.forEach((memory, index) => {
      console.log(chalk.green(`${index + 1}. ${memory.key}`));
      console.log(`   Swarm: ${memory.swarm_name || memory.swarm_id}`);
      console.log(`   Type: ${memory.type || 'knowledge'}`);
      console.log(`   Created: ${new Date(memory.created_at).toLocaleString()}`);
      
      // Parse and display value with highlighting
      let displayValue = memory.value;
      try {
        const parsed = JSON.parse(memory.value);
        displayValue = JSON.stringify(parsed, null, 2);
      } catch {
        // Keep as string
      }
      
      console.log(`   Value: ${displayValue}`);
      console.log('');
    });
  } catch (error) {
    console.error(chalk.red('Error searching memories:'), error.message);
  }
}

/**
 * Store new memory wizard
 */
async function storeMemoryWizard() {
  try {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'key',
        message: 'Memory key (identifier):',
        validate: (input) => input.length > 0,
      },
      {
        type: 'list',
        name: 'category',
        message: 'Memory category:',
        choices: [
          'consensus',
          'decision',
          'pattern',
          'learning',
          'coordination',
          'performance',
          'configuration',
          'general',
        ],
      },
      {
        type: 'editor',
        name: 'value',
        message: 'Memory content (JSON or text):',
      },
    ]);

    const mcpWrapper = await getMcpWrapper();
    let memoryValue;

    // Try to parse as JSON, fall back to string
    try {
      memoryValue = JSON.parse(answers.value);
    } catch {
      memoryValue = answers.value;
    }

    await mcpWrapper.storeMemory('hive-mind', answers.key, memoryValue, answers.category);

    console.log(chalk.green(`\n✅ Memory stored successfully!`));
    console.log(`Key: ${answers.key}`);
    console.log(`Category: ${answers.category}`);
  } catch (error) {
    console.error(chalk.red('Error storing memory:'), error.message);
  }
}

/**
 * Show memory statistics
 */
async function showMemoryStats() {
  try {
    console.log(chalk.blue('\n📊 Memory Statistics\n'));

    const mcpWrapper = await getMcpWrapper();

    // Search for all memories with an empty pattern to get everything
    const searchResult = await mcpWrapper.searchMemory('hive-mind', '');

    // Handle different possible response structures
    let memories = [];
    if (searchResult && Array.isArray(searchResult.results)) {
      memories = searchResult.results;
    } else if (searchResult && Array.isArray(searchResult)) {
      memories = searchResult;
    } else if (searchResult && searchResult.data && Array.isArray(searchResult.data)) {
      memories = searchResult.data;
    }

    if (!memories || memories.length === 0) {
      console.log(chalk.yellow('No memories found.'));
      console.log(chalk.gray('Use "Store new memory" to create your first memory.'));
      return;
    }

    // Calculate statistics
    const stats = {
      total: memories.length,
      categories: {},
      oldestDate: null,
      newestDate: null,
      totalSize: 0,
    };

    memories.forEach((memory) => {
      // Count by category
      const category = memory.category || memory.type || 'general';
      stats.categories[category] = (stats.categories[category] || 0) + 1;

      // Track dates
      const date = new Date(memory.timestamp || Date.now());
      if (!stats.oldestDate || date < stats.oldestDate) {
        stats.oldestDate = date;
      }
      if (!stats.newestDate || date > stats.newestDate) {
        stats.newestDate = date;
      }

      // Estimate size
      stats.totalSize += JSON.stringify(memory).length;
    });

    console.log(chalk.cyan('Total memories:'), stats.total);
    console.log(chalk.cyan('Estimated size:'), `${(stats.totalSize / 1024).toFixed(2)} KB`);
    console.log(
      chalk.cyan('Date range:'),
      `${stats.oldestDate?.toLocaleDateString()} - ${stats.newestDate?.toLocaleDateString()}`,
    );

    console.log(chalk.cyan('\nBy category:'));
    Object.entries(stats.categories).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
  } catch (error) {
    console.error(chalk.red('Error getting memory stats:'), error.message);
  }
}

/**
 * Clean old memories
 */
async function cleanMemories() {
  try {
    const { days } = await inquirer.prompt([
      {
        type: 'number',
        name: 'days',
        message: 'Remove memories older than how many days?',
        default: 30,
        validate: (input) => input > 0,
      },
    ]);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete memories older than ${days} days?`,
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Operation cancelled.'));
      return;
    }

    const mcpWrapper = await getMcpWrapper();

    // Get all memories first
    const searchResult = await mcpWrapper.searchMemory('hive-mind', '');

    // Handle different possible response structures
    let memories = [];
    if (searchResult && Array.isArray(searchResult.results)) {
      memories = searchResult.results;
    } else if (searchResult && Array.isArray(searchResult)) {
      memories = searchResult;
    } else if (searchResult && searchResult.data && Array.isArray(searchResult.data)) {
      memories = searchResult.data;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Filter memories older than cutoff date
    const oldMemories = memories.filter((memory) => {
      const memoryDate = new Date(memory.timestamp || 0);
      return memoryDate < cutoffDate;
    });

    if (oldMemories.length === 0) {
      console.log(chalk.yellow('\n🎉 No old memories found to clean.'));
      return;
    }

    console.log(chalk.green(`\n✅ Found ${oldMemories.length} old memories to clean.`));
    console.log(chalk.gray('Note: Individual memory deletion not yet implemented in MCPWrapper.'));
    console.log(chalk.gray('Consider implementing batch deletion or memory lifecycle management.'));
  } catch (error) {
    console.error(chalk.red('Error cleaning memories:'), error.message);
  }
}

/**
 * Export memory backup
 */
async function exportMemoryBackup() {
  try {
    const { filename } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filename',
        message: 'Export filename:',
        default: `hive-mind-memory-backup-${new Date().toISOString().split('T')[0]}.json`,
      },
    ]);

    const mcpWrapper = await getMcpWrapper();

    // Get all memories using search
    const searchResult = await mcpWrapper.searchMemory('hive-mind', '');

    // Handle different possible response structures
    let memories = [];
    if (searchResult && Array.isArray(searchResult.results)) {
      memories = searchResult.results;
    } else if (searchResult && Array.isArray(searchResult)) {
      memories = searchResult;
    } else if (searchResult && searchResult.data && Array.isArray(searchResult.data)) {
      memories = searchResult.data;
    }

    const backup = {
      exportDate: new Date().toISOString(),
      version: '1.0',
      totalMemories: memories.length,
      namespace: 'hive-mind',
      memories: memories,
    };

    const fs = await import('fs');
    fs.writeFileSync(filename, JSON.stringify(backup, null, 2));

    console.log(chalk.green(`\n✅ Memory backup exported to: ${filename}`));
    console.log(chalk.cyan(`Exported ${memories.length} memories`));
  } catch (error) {
    console.error(chalk.red('Error exporting memory backup:'), error.message);
  }
}

/**
 * Get active session ID for a swarm
 */
async function getActiveSessionId(swarmId) {
  const sessionManager = new HiveMindSessionManager();
  try {
    const sessions = await sessionManager.getActiveSessions();
    const activeSession = sessions.find(s => s.swarm_id === swarmId && s.status === 'active');
    return activeSession ? activeSession.id : null;
  } finally {
    sessionManager.close();
  }
}

/**
 * Spawn Claude Code with Hive Mind coordination instructions
 */
async function spawnClaudeCodeInstances(swarmId, swarmName, objective, workers, flags) {
  console.log('\n' + chalk.bold('🚀 Launching Claude Code with Hive Mind Coordination'));
  console.log(chalk.gray('─'.repeat(60)));

  const spinner = ora('Preparing Hive Mind coordination prompt...').start();

  try {
    // Generate comprehensive Hive Mind prompt
    const workerGroups = groupWorkersByType(workers);
    const hiveMindPrompt = generateHiveMindPrompt(
      swarmId,
      swarmName,
      objective,
      workers,
      workerGroups,
      flags,
    );

    spinner.succeed('Hive Mind coordination prompt ready!');

    // Display coordination summary
    console.log('\n' + chalk.bold('🧠 Hive Mind Configuration'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.cyan('Swarm ID:'), swarmId);
    console.log(chalk.cyan('Objective:'), objective);
    console.log(chalk.cyan('Queen Type:'), flags.queenType || 'strategic');
    console.log(chalk.cyan('Worker Count:'), workers.length);
    console.log(chalk.cyan('Worker Types:'), Object.keys(workerGroups).join(', '));
    console.log(chalk.cyan('Consensus Algorithm:'), flags.consensus || 'majority');
    console.log(chalk.cyan('MCP Tools:'), 'Full Claude-Flow integration enabled');

    try {
      // ALWAYS save the prompt file first (fix for issue #330)
      // Ensure sessions directory exists
      const sessionsDir = path.join('.hive-mind', 'sessions');
      await mkdirAsync(sessionsDir, { recursive: true });

      const promptFile = path.join(sessionsDir, `hive-mind-prompt-${swarmId}.txt`);
      await writeFile(promptFile, hiveMindPrompt, 'utf8');
      console.log(chalk.green(`\n✓ Hive Mind prompt saved to: ${promptFile}`));

      // Check if claude command exists
      const { spawn: childSpawn, execSync } = await import('child_process');
      let claudeAvailable = false;

      try {
        execSync('which claude', { stdio: 'ignore' });
        claudeAvailable = true;
      } catch {
        console.log(chalk.yellow('\n⚠️  Claude Code CLI not found in PATH'));
        console.log(chalk.gray('Install it with: npm install -g @anthropic-ai/claude-code'));
        console.log(chalk.gray('\nFalling back to displaying instructions...'));
      }

      if (claudeAvailable && !flags.dryRun) {
        // Inject memory coordination protocol into CLAUDE.md
        try {
          const { injectMemoryProtocol, enhanceHiveMindPrompt } = await import('./inject-memory-protocol.js');
          await injectMemoryProtocol();
          
          // Enhance the prompt with memory coordination instructions
          hiveMindPrompt = enhanceHiveMindPrompt(hiveMindPrompt, workers);
          console.log(chalk.green('📝 Memory coordination protocol injected into CLAUDE.md'));
        } catch (err) {
          // If injection module not available, continue with original prompt
          console.log(chalk.yellow('⚠️  Memory protocol injection not available, using standard prompt'));
        }
        
        // Check if we should run in non-interactive mode
        // Respect --non-interactive flag regardless of --claude
        const isNonInteractive = flags['non-interactive'] || flags.nonInteractive;
        
        // Build arguments in correct order: flags first, then prompt
        const claudeArgs = [];
        
        // Add non-interactive flags FIRST if needed
        if (isNonInteractive) {
          claudeArgs.push('-p'); // Print mode
          claudeArgs.push('--output-format', 'stream-json'); // JSON streaming  
          claudeArgs.push('--verbose'); // Verbose output
          console.log(chalk.cyan('🤖 Running in non-interactive mode'));
        }

        // Add auto-permission flag BEFORE the prompt
        if (flags['dangerously-skip-permissions'] !== false && !flags['no-auto-permissions']) {
          claudeArgs.push('--dangerously-skip-permissions');
          if (!isNonInteractive) {
            console.log(
              chalk.yellow(
                '🔓 Using --dangerously-skip-permissions by default for seamless hive-mind execution',
              ),
            );
          }
        }
        
        // Add the prompt as the LAST argument
        claudeArgs.push(hiveMindPrompt);

        // Spawn claude with properly ordered arguments
        const claudeProcess = childSpawn('claude', claudeArgs, {
          stdio: 'inherit',
          shell: false,
        });

        // Track child process PID in session
        const sessionManager = new HiveMindSessionManager();
        const sessionId = await getActiveSessionId(swarmId);
        if (sessionId && claudeProcess.pid) {
          sessionManager.addChildPid(sessionId, claudeProcess.pid);
        }

        // Set up SIGINT handler for automatic session pausing
        let isExiting = false;
        const sigintHandler = async () => {
          if (isExiting) return;
          isExiting = true;

          console.log('\n\n' + chalk.yellow('⏸️  Pausing session and terminating Claude Code...'));
          
          try {
            // Terminate Claude Code process
            if (claudeProcess && !claudeProcess.killed) {
              claudeProcess.kill('SIGTERM');
            }

            // Save checkpoint and pause session
            if (sessionId) {
              const checkpointData = {
                timestamp: new Date().toISOString(),
                swarmId,
                objective,
                status: 'paused_by_user',
                reason: 'User pressed Ctrl+C during Claude Code execution',
                claudePid: claudeProcess.pid,
              };
              
              await sessionManager.saveCheckpoint(sessionId, 'auto-pause-claude', checkpointData);
              await sessionManager.pauseSession(sessionId);
              
              console.log(chalk.green('✓') + ' Session paused successfully');
              console.log(chalk.cyan('\nTo resume this session, run:'));
              console.log(chalk.bold(`  claude-flow hive-mind resume ${sessionId}`));
            }
            
            sessionManager.close();
            process.exit(0);
          } catch (error) {
            console.error(chalk.red('Error pausing session:'), error.message);
            sessionManager.close();
            process.exit(1);
          }
        };

        // Register SIGINT handler
        process.on('SIGINT', sigintHandler);
        process.on('SIGTERM', sigintHandler);

        // Handle stdout
        if (claudeProcess.stdout) {
          claudeProcess.stdout.on('data', (data) => {
            console.log(data.toString());
          });
        }

        // Handle stderr
        if (claudeProcess.stderr) {
          claudeProcess.stderr.on('data', (data) => {
            console.error(chalk.red(data.toString()));
          });
        }

        // Handle process exit
        claudeProcess.on('exit', (code) => {
          // Remove child PID from session
          if (sessionId && claudeProcess.pid) {
            sessionManager.removeChildPid(sessionId, claudeProcess.pid);
            sessionManager.close();
          }

          if (code === 0) {
            console.log(chalk.green('\n✓ Claude Code completed successfully'));
          } else if (code !== null) {
            console.log(chalk.red(`\n✗ Claude Code exited with code ${code}`));
          }
        });

        console.log(chalk.green('\n✓ Claude Code launched with Hive Mind coordination'));
        console.log(chalk.blue('  The Queen coordinator will orchestrate all worker agents'));
        console.log(
          chalk.blue('  Use MCP tools for collective intelligence and task distribution'),
        );
        console.log(chalk.gray(`  Prompt file saved at: ${promptFile}`));
      } else if (flags.dryRun) {
        console.log(chalk.blue('\nDry run - would execute Claude Code with prompt:'));
        console.log(chalk.gray('Prompt length:'), hiveMindPrompt.length, 'characters');
        console.log(chalk.gray('\nFirst 500 characters of prompt:'));
        console.log(chalk.yellow(hiveMindPrompt.substring(0, 500) + '...'));
        console.log(chalk.gray(`\nFull prompt saved to: ${promptFile}`));
      } else {
        // Claude not available - show instructions with already saved prompt
        console.log(chalk.yellow('\n📋 Manual Execution Instructions:'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.gray('1. Install Claude Code:'));
        console.log(chalk.green('   npm install -g @anthropic-ai/claude-code'));
        console.log(chalk.gray('\n2. Run with the saved prompt:'));
        console.log(chalk.green(`   claude < ${promptFile}`));
        console.log(chalk.gray('\n3. Or copy the prompt manually:'));
        console.log(chalk.green(`   cat ${promptFile} | claude`));
        console.log(chalk.gray('\n4. With auto-permissions:'));
        console.log(chalk.green(`   claude --dangerously-skip-permissions < ${promptFile}`));
      }
    } catch (error) {
      console.error(chalk.red('\nFailed to launch Claude Code:'), error.message);

      // Save prompt as fallback
      const promptFile = `hive-mind-prompt-${swarmId}-fallback.txt`;
      await writeFile(promptFile, hiveMindPrompt, 'utf8');
      console.log(chalk.green(`\n✓ Prompt saved to: ${promptFile}`));
      console.log(chalk.yellow('\nYou can run Claude Code manually with the saved prompt'));
    }

    console.log('\n' + chalk.bold('💡 Pro Tips:'));
    console.log(chalk.gray('─'.repeat(30)));
    console.log('• Use --auto-spawn to launch instances automatically');
    console.log('• Add --verbose for detailed coordination context');
    console.log('• Monitor with: claude-flow hive-mind status');
    console.log('• Share memories: mcp__ruv-swarm__memory_usage');
  } catch (error) {
    spinner.fail('Failed to prepare Claude Code coordination');
    console.error(chalk.red('Error:'), error.message);
  }
}

/**
 * Generate comprehensive Hive Mind prompt for Claude Code
 */
function generateHiveMindPrompt(swarmId, swarmName, objective, workers, workerGroups, flags) {
  console.log(chalk.cyan(`\n🔍 generateHiveMindPrompt received objective: "${objective}"`));
  const currentTime = new Date().toISOString();
  const workerTypes = Object.keys(workerGroups);
  const queenType = flags.queenType || 'strategic';
  const consensusAlgorithm = flags.consensus || 'majority';

  return `🧠 HIVE MIND COLLECTIVE INTELLIGENCE SYSTEM
═══════════════════════════════════════════════

You are the Queen coordinator of a Hive Mind swarm with collective intelligence capabilities.

HIVE MIND CONFIGURATION:
📌 Swarm ID: ${swarmId}
📌 Swarm Name: ${swarmName}
🎯 Objective: ${objective}
👑 Queen Type: ${queenType}
🐝 Worker Count: ${workers.length}
🤝 Consensus Algorithm: ${consensusAlgorithm}
⏰ Initialized: ${currentTime}

WORKER DISTRIBUTION:
${workerTypes.map((type) => `• ${type}: ${workerGroups[type].length} agents`).join('\n')}

🔧 AVAILABLE MCP TOOLS FOR HIVE MIND COORDINATION:

1️⃣ **COLLECTIVE INTELLIGENCE**
   mcp__claude-flow__consensus_vote    - Democratic decision making
   mcp__claude-flow__memory_share      - Share knowledge across the hive
   mcp__claude-flow__neural_sync       - Synchronize neural patterns
   mcp__claude-flow__swarm_think       - Collective problem solving

2️⃣ **QUEEN COORDINATION**
   mcp__claude-flow__queen_command     - Issue directives to workers
   mcp__claude-flow__queen_monitor     - Monitor swarm health
   mcp__claude-flow__queen_delegate    - Delegate complex tasks
   mcp__claude-flow__queen_aggregate   - Aggregate worker results

3️⃣ **WORKER MANAGEMENT**
   mcp__claude-flow__agent_spawn       - Create specialized workers
   mcp__claude-flow__agent_assign      - Assign tasks to workers
   mcp__claude-flow__agent_communicate - Inter-agent communication
   mcp__claude-flow__agent_metrics     - Track worker performance

4️⃣ **TASK ORCHESTRATION**
   mcp__claude-flow__task_create       - Create hierarchical tasks
   mcp__claude-flow__task_distribute   - Distribute work efficiently
   mcp__claude-flow__task_monitor      - Track task progress
   mcp__claude-flow__task_aggregate    - Combine task results

5️⃣ **MEMORY & LEARNING**
   mcp__claude-flow__memory_store      - Store collective knowledge
   mcp__claude-flow__memory_retrieve   - Access shared memory
   mcp__claude-flow__neural_train      - Learn from experiences
   mcp__claude-flow__pattern_recognize - Identify patterns

📋 HIVE MIND EXECUTION PROTOCOL:

As the Queen coordinator, you must:

1. **INITIALIZE THE HIVE** (CRITICAL: Use Claude Code's Task Tool for Agents):
   
   Step 1: Optional MCP Coordination Setup (Single Message):
   [MCP Tools - Coordination Only]:
   ${workerTypes.map((type) => `   mcp__claude-flow__agent_spawn { "type": "${type}", "count": ${workerGroups[type].length} }`).join('\n')}
   mcp__claude-flow__memory_store { "key": "hive/objective", "value": "${objective}" }
   mcp__claude-flow__memory_store { "key": "hive/queen", "value": "${queenType}" }
   mcp__claude-flow__swarm_think { "topic": "initial_strategy" }
   
   Step 2: REQUIRED - Spawn ACTUAL Agents with Claude Code's Task Tool (Single Message):
   [Claude Code Task Tool - CONCURRENT Agent Execution]:
   ${workerTypes.map((type) => `   Task("${type.charAt(0).toUpperCase() + type.slice(1)} Agent", "You are a ${type} in the hive. Coordinate via hooks. ${getWorkerTypeInstructions(type).split('\n')[0]}", "${type}")`).join('\n')}
   
   Step 3: Batch ALL Todos Together (Single TodoWrite Call):
   TodoWrite { "todos": [
     { "id": "1", "content": "Initialize hive mind collective", "status": "in_progress", "priority": "high" },
     { "id": "2", "content": "Establish consensus protocols", "status": "pending", "priority": "high" },
     { "id": "3", "content": "Distribute initial tasks to workers", "status": "pending", "priority": "high" },
     { "id": "4", "content": "Set up collective memory", "status": "pending", "priority": "high" },
     { "id": "5", "content": "Monitor worker health", "status": "pending", "priority": "medium" },
     { "id": "6", "content": "Aggregate worker outputs", "status": "pending", "priority": "medium" },
     { "id": "7", "content": "Learn from patterns", "status": "pending", "priority": "low" },
     { "id": "8", "content": "Optimize performance", "status": "pending", "priority": "low" }
   ] }

2. **ESTABLISH COLLECTIVE INTELLIGENCE**:
   - Use consensus_vote for major decisions
   - Share all discoveries via memory_share
   - Synchronize learning with neural_sync
   - Coordinate strategy with swarm_think

3. **QUEEN LEADERSHIP PATTERNS**:
   ${
     queenType === 'strategic'
       ? `
   - Focus on high-level planning and coordination
   - Delegate implementation details to workers
   - Monitor overall progress and adjust strategy
   - Make executive decisions when consensus fails`
       : ''
   }
   ${
     queenType === 'tactical'
       ? `
   - Manage detailed task breakdowns and assignments
   - Closely monitor worker progress and efficiency
   - Optimize resource allocation and load balancing
   - Intervene directly when workers need guidance`
       : ''
   }
   ${
     queenType === 'adaptive'
       ? `
   - Learn from swarm performance and adapt strategies
   - Experiment with different coordination patterns
   - Use neural training to improve over time
   - Balance between strategic and tactical approaches`
       : ''
   }

4. **WORKER COORDINATION**:
   - Spawn workers based on task requirements
   - Assign tasks according to worker specializations
   - Enable peer-to-peer communication for collaboration
   - Monitor and rebalance workloads as needed

5. **CONSENSUS MECHANISMS**:
   ${consensusAlgorithm === 'majority' ? '- Decisions require >50% worker agreement' : ''}
   ${consensusAlgorithm === 'unanimous' ? '- All workers must agree for major decisions' : ''}
   ${consensusAlgorithm === 'weighted' ? '- Worker votes weighted by expertise and performance' : ''}
   ${consensusAlgorithm === 'quorum' ? '- Decisions require 2/3 worker participation' : ''}

6. **COLLECTIVE MEMORY**:
   - Store all important decisions in shared memory
   - Tag memories with worker IDs and timestamps
   - Use memory namespaces: hive/, queen/, workers/, tasks/
   - Implement memory consensus for critical data

7. **PERFORMANCE OPTIMIZATION**:
   - Monitor swarm metrics continuously
   - Identify and resolve bottlenecks
   - Train neural networks on successful patterns
   - Scale worker count based on workload

💡 HIVE MIND BEST PRACTICES:

✅ ALWAYS use BatchTool for parallel operations
✅ Store decisions in collective memory immediately
✅ Use consensus for critical path decisions
✅ Monitor worker health and reassign if needed
✅ Learn from failures and adapt strategies
✅ Maintain constant inter-agent communication
✅ Aggregate results before final delivery

❌ NEVER make unilateral decisions without consensus
❌ NEVER let workers operate in isolation
❌ NEVER ignore performance metrics
❌ NEVER skip memory synchronization
❌ NEVER abandon failing workers

🎯 OBJECTIVE EXECUTION STRATEGY:

For the objective: "${objective}"

1. Break down into major phases using swarm_think
2. Create specialized worker teams for each phase
3. Establish success criteria and checkpoints
4. Implement feedback loops and adaptation
5. Aggregate and synthesize all worker outputs
6. Deliver comprehensive solution with consensus

⚡ CRITICAL: CONCURRENT EXECUTION WITH CLAUDE CODE'S TASK TOOL:

The Hive Mind MUST use Claude Code's Task tool for actual agent execution:

✅ CORRECT Pattern:
[Single Message - All Agents Spawned Concurrently]:
  Task("Researcher", "Research patterns and best practices...", "researcher")
  Task("Coder", "Implement core features...", "coder")
  Task("Tester", "Create comprehensive tests...", "tester")
  Task("Analyst", "Analyze performance metrics...", "analyst")
  TodoWrite { todos: [8-10 todos ALL in ONE call] }

❌ WRONG Pattern:
Message 1: Task("agent1", ...)
Message 2: Task("agent2", ...)
Message 3: TodoWrite { single todo }
// This breaks parallel coordination!

Remember:
- Use Claude Code's Task tool to spawn ALL agents in ONE message
- MCP tools are ONLY for coordination setup, not agent execution
- Batch ALL TodoWrite operations (5-10+ todos minimum)
- Execute ALL file operations concurrently
- Store multiple memories simultaneously

🚀 BEGIN HIVE MIND EXECUTION:

Initialize the swarm now with the configuration above. Use your collective intelligence to solve the objective efficiently. The Queen must coordinate, workers must collaborate, and the hive must think as one.

Remember: You are not just coordinating agents - you are orchestrating a collective intelligence that is greater than the sum of its parts.`;
}

/**
 * Generate comprehensive coordination instructions for Claude Code instances
 */
function generateCoordinationInstructions(swarmId, swarmName, objective, workers) {
  return {
    swarmId,
    swarmName,
    objective,
    hiveMindEndpoint: 'ws://localhost:3000/hive-mind',
    mcpTools: [
      'mcp__ruv-swarm__memory_usage',
      'mcp__ruv-swarm__swarm_monitor',
      'mcp__ruv-swarm__task_orchestrate',
      'mcp__ruv-swarm__neural_train',
      'mcp__ruv-swarm__consensus_vote',
      'mcp__ruv-swarm__agent_spawn',
      'mcp__ruv-swarm__swarm_status',
    ],
    coordinationProtocol: {
      memoryNamespace: `hive-mind-${swarmId}`,
      consensusThreshold: 0.7,
      taskUpdateInterval: 30000,
      healthCheckInterval: 60000,
    },
    workerCapabilities: workers.map((w) => ({
      id: w.id,
      type: w.type,
      capabilities: JSON.parse(w.capabilities),
    })),
  };
}

/**
 * Group workers by type for specialized spawning
 */
function groupWorkersByType(workers) {
  return workers.reduce((groups, worker) => {
    if (!groups[worker.type]) {
      groups[worker.type] = [];
    }
    groups[worker.type].push(worker);
    return groups;
  }, {});
}

/**
 * Create Claude Code spawn command with coordination context
 */
function createClaudeCodeSpawnCommand(
  swarmId,
  swarmName,
  objective,
  workerType,
  typeWorkers,
  instructions,
) {
  const context = `You are a ${workerType} agent in the "${swarmName}" Hive Mind swarm.

🎯 MISSION: ${objective}

🐝 SWARM COORDINATION:
- Swarm ID: ${swarmId}
- Your Role: ${workerType.toUpperCase()} specialist
- Team Size: ${typeWorkers.length} ${workerType}(s)
- Coordination: Hive Mind collective intelligence

🧠 MANDATORY COORDINATION PROTOCOL:
1. BEFORE starting work:
   mcp__ruv-swarm__memory_usage {"action": "retrieve", "key": "hive-mind-${swarmId}/status"}
   mcp__ruv-swarm__swarm_status {"swarmId": "${swarmId}"}

2. DURING work (after each major step):
   mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/${workerType}/progress", "value": {"step": "X", "status": "Y", "findings": "Z"}}
   mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "update": {"agentId": "your-id", "progress": "details"}}

3. FOR decisions requiring consensus:
   mcp__ruv-swarm__consensus_vote {"swarmId": "${swarmId}", "topic": "decision topic", "vote": "your choice", "rationale": "reasoning"}

4. WHEN sharing insights:
   mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/insights/${workerType}", "value": {"insight": "your discovery", "impact": "significance"}}

5. BEFORE completing work:
   mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "experience": {"what": "learned", "outcome": "result"}}

🔧 SPECIALIZED CAPABILITIES:
${getWorkerTypeInstructions(workerType)}

🤝 COORDINATION RULES:
- Share ALL discoveries via memory_usage
- Vote on critical decisions using consensus_vote
- Update progress every 15 minutes via task_orchestrate
- Monitor other agents via swarm_status
- Learn from patterns via neural_train

Remember: You are part of a COLLECTIVE INTELLIGENCE. Your individual success depends on swarm coordination!`;

  const command = `claude code --context "${context.replace(/"/g, '\\"')}"`;

  return {
    title: `${workerType.toUpperCase()} Agent (${typeWorkers.length} instance${typeWorkers.length > 1 ? 's' : ''})`,
    command,
    context,
    workerType,
    count: typeWorkers.length,
  };
}

/**
 * Get specialized instructions for each worker type
 */
function getWorkerTypeInstructions(workerType) {
  const instructions = {
    researcher: `- Conduct thorough research using WebSearch and WebFetch
- Document findings in structured formats
- Validate source credibility and relevance
- Synthesize insights from multiple sources
- Share research methodology and results`,

    coder: `- Write clean, maintainable, well-documented code
- Follow project conventions and best practices
- Test implementations thoroughly
- Document code changes and decisions
- Review and optimize existing code`,

    analyst: `- Analyze data patterns and trends
- Create comprehensive reports and visualizations
- Identify key insights and recommendations
- Validate analytical methodologies
- Correlate findings across data sources`,

    tester: `- Design comprehensive test strategies
- Execute functional, integration, and performance tests
- Document test results and issues
- Verify bug fixes and improvements
- Ensure quality standards and coverage`,

    coordinator: `- Monitor overall progress and coordination
- Facilitate communication between agents
- Resolve conflicts and blockers
- Optimize resource allocation
- Ensure alignment with objectives`,

    architect: `- Design system architecture and components
- Define technical standards and patterns
- Create implementation guidelines
- Review and approve design decisions
- Ensure scalability and maintainability`,
  };

  return (
    instructions[workerType] ||
    `- Execute tasks according to ${workerType} best practices
- Collaborate effectively with team members
- Document work and share insights
- Maintain quality standards
- Contribute to collective objectives`
  );
}

/**
 * Show all hive mind sessions
 */
async function showSessions(flags) {
  try {
    // Use metrics reader for real session data
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    
    if (!existsSync(dbPath)) {
      console.log(chalk.gray('No hive mind database found'));
      return;
    }
    
    const metricsReader = new HiveMindMetricsReader(dbPath);
    const sessions = metricsReader.getActiveSessions();

    if (sessions.length === 0) {
      console.log(chalk.gray('No active or paused sessions found'));
      metricsReader.close();
      return;
    }

    console.log(chalk.bold('\n🗂️  Hive Mind Sessions\n'));

    sessions.forEach((session, index) => {
      const statusColor =
        session.status === 'active' ? 'green' : session.status === 'paused' ? 'yellow' : 'gray';
      const statusIcon =
        session.status === 'active' ? '🟢' : session.status === 'paused' ? '🟡' : '⚫';

      console.log(chalk.yellow('═'.repeat(60)));
      console.log(`${statusIcon} ${chalk.bold(session.swarm_name || session.id)}`);
      console.log(chalk.cyan('Session ID:'), session.id);
      console.log(chalk.cyan('Status:'), chalk[statusColor](session.status));
      console.log(chalk.cyan('Objective:'), session.objective || 'Not set');
      console.log(chalk.cyan('Progress:'), `${session.completion_percentage || 0}%`);
      console.log(chalk.cyan('Created:'), new Date(session.created_at).toLocaleString());
      console.log(chalk.cyan('Last Updated:'), new Date(session.updated_at).toLocaleString());

      if (session.paused_at) {
        console.log(chalk.cyan('Paused At:'), new Date(session.paused_at).toLocaleString());
      }

      console.log('\n' + chalk.bold('Real Progress:'));
      console.log(`  Agents: ${session.agent_count || 0}`);
      console.log(`  Tasks: ${session.completed_tasks || 0}/${session.task_count || 0}`);
      console.log(`  In Progress: ${session.in_progress_tasks || 0}`);
      console.log(`  Pending: ${session.pending_tasks || 0}`);

      if (session.checkpoint_data) {
        console.log('\n' + chalk.bold('Last Checkpoint:'));
        const checkpointStr = typeof session.checkpoint_data === 'string' 
          ? session.checkpoint_data 
          : JSON.stringify(session.checkpoint_data, null, 2);
        console.log(
          chalk.gray(checkpointStr.substring(0, 200) + (checkpointStr.length > 200 ? '...' : '')),
        );
      }
    });

    console.log(chalk.yellow('═'.repeat(60)) + '\n');

    console.log(chalk.blue('💡 Tips:'));
    console.log('  • Resume a session: claude-flow hive-mind resume <session-id>');
    console.log('  • View session details: claude-flow hive-mind status');

    metricsReader.close();
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Resume a paused hive mind session
 */
async function resumeSession(args, flags) {
  const sessionId = args[0];

  if (!sessionId) {
    console.error(chalk.red('Error: Please provide a session ID'));
    console.log('Usage: claude-flow hive-mind resume <session-id>');
    console.log('Run "claude-flow hive-mind sessions" to see available sessions');
    return;
  }

  const spinner = ora('Resuming Hive Mind session...').start();

  try {
    const sessionManager = new HiveMindSessionManager();

    // Get session details
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      spinner.fail(`Session ${sessionId} not found`);
      console.log('\nRun "claude-flow hive-mind sessions" to see available sessions');
      sessionManager.close();
      return;
    }

    // Allow resuming any session regardless of status
    spinner.text = `Resuming session from status: ${session.status}...`;

    if (session.status === 'stopped') {
      spinner.text = 'Restarting stopped session with original configuration...';
    }

    // Resume the session
    const resumedSession = await sessionManager.resumeSession(sessionId);

    spinner.succeed('Session resumed successfully!');

    // Display session summary
    console.log('\n' + chalk.bold('📋 Resumed Session Summary:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('Session ID:'), sessionId);
    console.log(chalk.cyan('Swarm Name:'), resumedSession.swarm_name);
    console.log(chalk.cyan('Objective:'), resumedSession.objective);
    console.log(chalk.cyan('Progress:'), `${resumedSession.statistics.completionPercentage}%`);
    console.log(
      chalk.cyan('Active Agents:'),
      `${resumedSession.statistics.activeAgents}/${resumedSession.statistics.totalAgents}`,
    );
    console.log(
      chalk.cyan('Tasks:'),
      `${resumedSession.statistics.completedTasks}/${resumedSession.statistics.totalTasks} completed`,
    );
    console.log(chalk.gray('─'.repeat(50)));

    // Show task breakdown
    console.log('\n' + chalk.bold('📊 Task Status:'));
    console.log(`  ✅ Completed: ${resumedSession.statistics.completedTasks}`);
    console.log(`  🔄 In Progress: ${resumedSession.statistics.inProgressTasks}`);
    console.log(`  ⏳ Pending: ${resumedSession.statistics.pendingTasks}`);

    // Show recent activity
    if (resumedSession.recentLogs && resumedSession.recentLogs.length > 0) {
      console.log('\n' + chalk.bold('📜 Recent Activity:'));
      resumedSession.recentLogs.slice(0, 5).forEach((log) => {
        const timestamp = new Date(log.timestamp).toLocaleTimeString();
        console.log(`  [${timestamp}] ${log.message}`);
      });
    }

    // Restore checkpoint if available
    if (resumedSession.checkpoint_data) {
      console.log('\n' + chalk.bold('♻️  Restoring from checkpoint...'));
      console.log(chalk.gray('Checkpoint data available for restoration'));
    }

    sessionManager.close();

    // Offer to spawn Claude Code with restored context
    if (flags.claude || flags.spawn) {
      console.log('\n' + chalk.yellow('🚀 Launching Claude Code with restored context...'));

      // Generate prompt with session context
      const restoredPrompt = generateRestoredSessionPrompt(resumedSession);

      // Launch Claude Code with restored context
      await launchClaudeWithContext(restoredPrompt, flags, sessionId);
    } else {
      console.log(
        '\n' +
          chalk.blue('💡 Pro Tip:') +
          ' Add --claude to spawn Claude Code with restored context',
      );
      console.log(chalk.gray('   claude-flow hive-mind resume ' + sessionId + ' --claude'));
    }
  } catch (error) {
    spinner.fail('Failed to resume session');
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Stop a hive mind session
 */
async function stopSession(args, flags) {
  const sessionId = args[0];

  if (!sessionId) {
    console.error(chalk.red('Error: Please provide a session ID'));
    console.log('Usage: claude-flow hive-mind stop <session-id>');
    console.log('Run "claude-flow hive-mind sessions" to see available sessions');
    return;
  }

  const spinner = ora('Stopping Hive Mind session...').start();

  try {
    const sessionManager = new HiveMindSessionManager();

    // Get session details
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      spinner.fail(`Session ${sessionId} not found`);
      console.log('\nRun "claude-flow hive-mind sessions" to see available sessions');
      sessionManager.close();
      return;
    }

    // Stop the session
    await sessionManager.stopSession(sessionId);

    spinner.succeed('Session stopped successfully!');

    // Display session summary
    console.log('\n' + chalk.bold('🛑 Stopped Session Summary:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('Session ID:'), sessionId);
    console.log(chalk.cyan('Swarm Name:'), session.swarm_name || 'Unknown');
    console.log(chalk.cyan('Final Status:'), 'Stopped');
    console.log(
      chalk.cyan('Active Agents:'),
      session.statistics ? session.statistics.activeAgents : 0,
    );
    console.log(chalk.gray('─'.repeat(50)));

    console.log('\n' + chalk.yellow('💡 Session has been stopped and all processes cleaned up.'));
    console.log(
      chalk.gray('To resume this session later, use: claude-flow hive-mind resume ' + sessionId),
    );

    sessionManager.close();
  } catch (error) {
    spinner.fail('Failed to stop session');
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Generate prompt for restored session
 */
function generateRestoredSessionPrompt(session) {
  // Get all agents, not just active ones
  const allAgents = session.agents || [];
  const activeAgents = allAgents.filter((a) => a.status === 'active' || a.status === 'busy');
  const idleAgents = allAgents.filter((a) => a.status === 'idle');
  
  // Get all tasks categorized by status
  const allTasks = session.tasks || [];
  const completedTasks = allTasks.filter((t) => t.status === 'completed');
  const inProgressTasks = allTasks.filter((t) => t.status === 'in_progress');
  const pendingTasks = allTasks.filter((t) => t.status === 'pending');
  
  // Calculate session duration
  const sessionStart = new Date(session.created_at);
  const sessionPaused = session.paused_at ? new Date(session.paused_at) : new Date();
  const duration = Math.round((sessionPaused - sessionStart) / 1000 / 60); // minutes
  
  // Get more checkpoint history
  const checkpointHistory = session.checkpoints || [];
  
  // Get more activity logs
  const activityLogs = session.recentLogs || [];
  
  // Format agent details with their current tasks
  const formatAgentDetails = (agents) => {
    if (!agents.length) return 'No agents found';
    return agents.map(agent => {
      const agentTasks = allTasks.filter(t => t.agent_id === agent.id);
      const currentTask = agentTasks.find(t => t.status === 'in_progress');
      return `• ${agent.name} (${agent.type}) - ${agent.status}${currentTask ? `\n  └─ Working on: ${currentTask.description}` : ''}`;
    }).join('\n');
  };
  
  // Format task details with more information
  const formatTaskDetails = (tasks, limit = 15) => {
    if (!tasks.length) return 'No tasks found';
    const displayTasks = tasks.slice(0, limit);
    return displayTasks.map(task => {
      const agent = allAgents.find(a => a.id === task.agent_id);
      return `• [${task.priority?.toUpperCase() || 'NORMAL'}] ${task.description}${agent ? ` (Assigned to: ${agent.name})` : ''}${task.created_at ? ` - Created: ${new Date(task.created_at).toLocaleTimeString()}` : ''}`;
    }).join('\n') + (tasks.length > limit ? `\n... and ${tasks.length - limit} more tasks` : '');
  };
  
  // Format checkpoint details
  const formatCheckpoints = (checkpoints, limit = 5) => {
    if (!checkpoints.length) return 'No checkpoints found';
    const displayCheckpoints = checkpoints.slice(0, limit);
    return displayCheckpoints.map(cp => 
      `• ${cp.checkpoint_name} - ${new Date(cp.created_at).toLocaleString()}`
    ).join('\n');
  };
  
  // Format activity logs with more detail
  const formatActivityLogs = (logs, limit = 20) => {
    if (!logs.length) return 'No activity logs found';
    const displayLogs = logs.slice(0, limit);
    return displayLogs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      const agent = log.agent_id ? allAgents.find(a => a.id === log.agent_id) : null;
      return `[${timestamp}] ${log.message}${agent ? ` (by ${agent.name})` : ''}${log.data ? ` - ${JSON.stringify(log.data)}` : ''}`;
    }).join('\n');
  };
  
  // Extract metadata if available
  const metadata = session.metadata || {};
  const metadataStr = Object.keys(metadata).length > 0 ? 
    Object.entries(metadata).map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n') : 
    'No metadata available';

  return `🔄 RESUMING HIVE MIND SESSION
═══════════════════════════════════

You are resuming a Hive Mind session with comprehensive context:

📋 SESSION DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Session ID: ${session.id}
📌 Swarm ID: ${session.swarm_id}
📌 Swarm Name: ${session.swarm_name}
🎯 Objective: ${session.objective}
📊 Overall Progress: ${session.statistics.completionPercentage}% complete
⏱️ Session Duration: ${duration} minutes
📅 Created: ${new Date(session.created_at).toLocaleString()}
⏸️ Paused: ${session.paused_at ? new Date(session.paused_at).toLocaleString() : 'N/A'}
▶️ Resumed: ${new Date().toLocaleString()}
🔄 Status: ${session.status}

📊 TASK STATISTICS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Total Tasks: ${session.statistics.totalTasks}
• Completed: ${completedTasks.length} (${session.statistics.totalTasks > 0 ? Math.round((completedTasks.length / session.statistics.totalTasks) * 100) : 0}%)
• In Progress: ${inProgressTasks.length}
• Pending: ${pendingTasks.length}

👥 SWARM COMPOSITION (${allAgents.length} agents):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Active Agents (${activeAgents.length}):
${formatAgentDetails(activeAgents)}

Idle Agents (${idleAgents.length}):
${formatAgentDetails(idleAgents)}

📝 COMPLETED TASKS (${completedTasks.length}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${formatTaskDetails(completedTasks, 10)}

🔄 IN-PROGRESS TASKS (${inProgressTasks.length}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${formatTaskDetails(inProgressTasks)}

⏳ PENDING TASKS (${pendingTasks.length}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${formatTaskDetails(pendingTasks)}

💾 CHECKPOINT HISTORY (${checkpointHistory.length} total):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${formatCheckpoints(checkpointHistory)}

📊 SESSION METADATA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${metadataStr}

💾 LAST CHECKPOINT DATA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${session.checkpoint_data ? JSON.stringify(session.checkpoint_data, null, 2) : 'No checkpoint data available'}

📜 ACTIVITY LOG (Last ${Math.min(20, activityLogs.length)} entries):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${formatActivityLogs(activityLogs, 20)}

🎯 RESUMPTION PROTOCOL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. **RESTORE CONTEXT**:
   - Review all checkpoint data and activity history above
   - Use mcp__claude-flow__memory_usage to retrieve collective memory
   - Check agent statuses and reassign tasks if needed
   - Verify all in-progress tasks are still valid

2. **CONTINUE EXECUTION**:
   - Resume in-progress tasks with their assigned agents
   - Process pending tasks based on priority (CRITICAL > HIGH > NORMAL > LOW)
   - Maintain agent coordination through memory sharing
   - Update progress tracking after each task completion

3. **COORDINATION REQUIREMENTS**:
   - Use mcp__claude-flow__memory_usage for all cross-agent communication
   - Apply consensus mechanisms for important decisions
   - Maintain swarm topology: ${session.swarm?.topology || 'unknown'}
   - Keep session checkpoint data updated regularly

4. **MEMORY CONTEXT**:
   - Session memory namespace: session-${session.id}
   - Swarm memory namespace: swarm-${session.swarm_id}
   - Use these namespaces to access historical decisions and context

Resume the hive mind operation with full context awareness and continue working towards the objective.`;
}

/**
 * Launch Claude Code with context
 */
async function launchClaudeWithContext(prompt, flags, sessionId) {
  try {
    // ALWAYS save the prompt file first (fix for issue #330)
    // Ensure sessions directory exists
    const sessionsDir = path.join('.hive-mind', 'sessions');
    await mkdirAsync(sessionsDir, { recursive: true });
    const promptFile = path.join(sessionsDir, `hive-mind-resume-${sessionId}-${Date.now()}.txt`);
    await writeFile(promptFile, prompt);
    console.log(chalk.green(`\n✓ Session context saved to: ${promptFile}`));

    const { spawn: childSpawn, execSync } = await import('child_process');
    let claudeAvailable = false;

    try {
      execSync('which claude', { stdio: 'ignore' });
      claudeAvailable = true;
    } catch {
      console.log(chalk.yellow('\n⚠️  Claude Code CLI not found'));
      console.log(chalk.gray('Install Claude Code: npm install -g @anthropic-ai/claude-code'));
      console.log(chalk.gray(`Run with: claude < ${promptFile}`));
      return;
    }

    if (claudeAvailable && !flags.dryRun) {
      // Debug logging to track spawn calls
      console.log(chalk.blue('\n🔍 Debug: About to spawn Claude Code process...'));
      console.log(chalk.gray(`  Session ID: ${sessionId}`));
      console.log(chalk.gray(`  Process ID: ${process.pid}`));
      
      // Remove --print to allow interactive session (same as initial spawn)
      const claudeArgs = [prompt];

      // Add --dangerously-skip-permissions by default for hive-mind operations
      // unless explicitly disabled with --no-auto-permissions
      if (!flags['no-auto-permissions']) {
        claudeArgs.push('--dangerously-skip-permissions');
        console.log(
          chalk.yellow(
            '🔓 Using --dangerously-skip-permissions by default for seamless hive-mind execution',
          ),
        );
      }

      console.log(chalk.blue('🔍 Debug: Spawning with args:'), claudeArgs.slice(0, 1).map(a => a.substring(0, 50) + '...'));
      
      // Use 'inherit' for interactive session (same as initial spawn)
      const claudeProcess = childSpawn('claude', claudeArgs, {
        stdio: 'inherit',
        shell: false,
      });
      
      console.log(chalk.blue('🔍 Debug: Claude process spawned with PID:'), claudeProcess.pid);

      // Track child process PID in session (same as initial spawn)
      const sessionManager = new HiveMindSessionManager();
      if (claudeProcess.pid) {
        const sessions = await sessionManager.getActiveSessions();
        const currentSession = sessions.find(s => s.id === sessionId);
        if (currentSession) {
          await sessionManager.addChildPid(currentSession.id, claudeProcess.pid);
        }
      }

      // Set up SIGINT handler for automatic session pausing (same as initial spawn)
      let isExiting = false;
      const sigintHandler = async () => {
        if (isExiting) return;
        isExiting = true;

        console.log('\n\n' + chalk.yellow('⏸️  Pausing session and terminating Claude Code...'));
        
        try {
          // Terminate Claude Code process if still running
          if (claudeProcess && !claudeProcess.killed) {
            claudeProcess.kill('SIGTERM');
          }
          
          // Clean up and close session manager
          sessionManager.close();
          
          console.log(chalk.green('✓') + ' Session paused successfully');
          console.log(chalk.cyan('\nTo resume this session, run:'));
          console.log(chalk.bold(`  claude-flow hive-mind resume ${sessionId}`));
          console.log();
          
          process.exit(0);
        } catch (error) {
          console.error(chalk.red('Error during shutdown:'), error.message);
          process.exit(1);
        }
      };

      process.on('SIGINT', sigintHandler);
      process.on('SIGTERM', sigintHandler);

      // Handle process exit (same as initial spawn)
      claudeProcess.on('exit', async (code, signal) => {
        if (!isExiting) {
          console.log('\n' + chalk.yellow('Claude Code has exited'));
          
          // Clean up signal handlers
          process.removeListener('SIGINT', sigintHandler);
          process.removeListener('SIGTERM', sigintHandler);
          
          // Close session manager
          sessionManager.close();
          
          process.exit(code || 0);
        }
      });

      console.log(chalk.green('\n✓ Claude Code launched with restored session context'));
      console.log(chalk.gray(`  Prompt file saved at: ${promptFile}`));
    }
  } catch (error) {
    console.error(chalk.red('Failed to launch Claude Code:'), error.message);
  }
}

/**
 * Get MCP wrapper instance
 */
async function getMcpWrapper() {
  const { MCPToolWrapper } = await import('./hive-mind/mcp-wrapper.js');
  return new MCPToolWrapper();
}

// Export for testing
export { showHiveMindHelp, initHiveMind, spawnSwarm, showStatus };
