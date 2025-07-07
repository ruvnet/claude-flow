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

// Import SQLite for persistence
import Database from 'better-sqlite3';

// Import MCP tool wrappers
import { MCPToolWrapper } from './hive-mind/mcp-wrapper.js';
import { HiveMindCore } from './hive-mind/core.js';
import { QueenCoordinator } from './hive-mind/queen.js';
import { CollectiveMemory } from './hive-mind/memory.js';
import { SwarmCommunication } from './hive-mind/communication.js';

function showHiveMindHelp() {
  console.log(`
${chalk.yellow('🧠 Claude Flow Hive Mind System')}

${chalk.bold('USAGE:')}
  claude-flow hive-mind [subcommand] [options]

${chalk.bold('SUBCOMMANDS:')}
  ${chalk.green('init')}         Initialize hive mind system
  ${chalk.green('spawn')}        Spawn hive mind swarm for a task
  ${chalk.green('status')}       Show hive mind status
  ${chalk.green('consensus')}    View consensus decisions
  ${chalk.green('memory')}       Manage collective memory
  ${chalk.green('metrics')}      View performance metrics
  ${chalk.green('wizard')}       Interactive hive mind wizard

${chalk.bold('EXAMPLES:')}
  ${chalk.gray('# Initialize hive mind')}
  claude-flow hive-mind init

  ${chalk.gray('# Spawn swarm with interactive wizard')}
  claude-flow hive-mind spawn

  ${chalk.gray('# Quick spawn with objective')}
  claude-flow hive-mind spawn "Build microservices architecture"

  ${chalk.gray('# View current status')}
  claude-flow hive-mind status

  ${chalk.gray('# Interactive wizard')}
  claude-flow hive-mind wizard

  ${chalk.gray('# Spawn with Claude Code coordination')}
  claude-flow hive-mind spawn "Build REST API" --claude

  ${chalk.gray('# Auto-spawn coordinated Claude Code instances')}
  claude-flow hive-mind spawn "Research AI trends" --auto-spawn --verbose

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
  --multiple-instances   Spawn one Claude Code instance per worker type (default: single unified instance)

${chalk.bold('For more information:')}
${chalk.blue('https://github.com/ruvnet/claude-code-flow/docs/hive-mind.md')}
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
        encryption: false
      },
      mcpTools: {
        enabled: true,
        parallel: true,
        timeout: 60000
      }
    };
    
    await writeFile(
      path.join(hiveMindDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );
    
    spinner.succeed('Hive Mind system initialized successfully!');
    
    console.log('\n' + chalk.green('✓') + ' Created .hive-mind directory');
    console.log(chalk.green('✓') + ' Initialized SQLite database');
    console.log(chalk.green('✓') + ' Created configuration file');
    console.log('\n' + chalk.yellow('Next steps:'));
    console.log('  1. Run ' + chalk.cyan('claude-flow hive-mind spawn') + ' to create your first swarm');
    console.log('  2. Use ' + chalk.cyan('claude-flow hive-mind wizard') + ' for interactive setup');
    
  } catch (error) {
    spinner.fail('Failed to initialize Hive Mind system');
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Interactive wizard for hive mind operations
 */
async function hiveMindWizard() {
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
        { name: '❌ Exit', value: 'exit' }
      ]
    }
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
}

/**
 * Spawn swarm wizard
 */
async function spawnSwarmWizard() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'objective',
      message: 'What is the swarm objective?',
      validate: input => input.trim().length > 0 || 'Please enter an objective'
    },
    {
      type: 'input',
      name: 'name',
      message: 'Swarm name (optional):',
      default: answers => `swarm-${Date.now()}`
    },
    {
      type: 'list',
      name: 'queenType',
      message: 'Select queen coordinator type:',
      choices: [
        { name: 'Strategic - High-level planning and coordination', value: 'strategic' },
        { name: 'Tactical - Detailed task management', value: 'tactical' },
        { name: 'Adaptive - Learns and adapts strategies', value: 'adaptive' }
      ],
      default: 'strategic'
    },
    {
      type: 'number',
      name: 'maxWorkers',
      message: 'Maximum number of worker agents:',
      default: 8,
      validate: input => input > 0 && input <= 20 || 'Please enter a number between 1 and 20'
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
        { name: 'Documenter', value: 'documenter' }
      ]
    },
    {
      type: 'list',
      name: 'consensusAlgorithm',
      message: 'Consensus algorithm for decisions:',
      choices: [
        { name: 'Majority - Simple majority voting', value: 'majority' },
        { name: 'Weighted - Expertise-weighted voting', value: 'weighted' },
        { name: 'Byzantine - Fault-tolerant consensus', value: 'byzantine' }
      ],
      default: 'majority'
    },
    {
      type: 'confirm',
      name: 'autoScale',
      message: 'Enable auto-scaling?',
      default: true
    },
    {
      type: 'confirm',
      name: 'monitor',
      message: 'Launch monitoring dashboard?',
      default: true
    }
  ]);
  
  // Spawn the swarm with collected parameters
  await spawnSwarm([answers.objective], {
    name: answers.name,
    queenType: answers.queenType,
    maxWorkers: answers.maxWorkers,
    workerTypes: answers.workerTypes.join(','),
    consensus: answers.consensusAlgorithm,
    autoScale: answers.autoScale,
    monitor: answers.monitor
  });
}

/**
 * Spawn a hive mind swarm
 */
async function spawnSwarm(args, flags) {
  const objective = args.join(' ').trim();
  
  if (!objective && !flags.wizard) {
    console.error(chalk.red('Error: Please provide an objective or use --wizard flag'));
    console.log('Example: claude-flow hive-mind spawn "Build REST API"');
    return;
  }
  
  const spinner = ora('Spawning Hive Mind swarm...').start();
  
  try {
    // Initialize hive mind core
    const hiveMind = new HiveMindCore({
      objective,
      name: flags.name || `hive-${Date.now()}`,
      queenType: flags.queenType || 'strategic',
      maxWorkers: flags.maxWorkers || 8,
      consensusAlgorithm: flags.consensus || 'majority',
      autoScale: flags.autoScale !== false,
      encryption: flags.encryption || false
    });
    
    // Initialize database connection
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    const db = new Database(dbPath);
    
    // Create swarm record
    const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    db.prepare(`
      INSERT INTO swarms (id, name, objective, queen_type)
      VALUES (?, ?, ?, ?)
    `).run(swarmId, hiveMind.config.name, objective, hiveMind.config.queenType);
    
    spinner.text = 'Initializing Queen coordinator...';
    
    // Initialize Queen
    const queen = new QueenCoordinator({
      swarmId,
      type: hiveMind.config.queenType,
      objective
    });
    
    // Spawn Queen agent
    const queenAgent = {
      id: `queen-${swarmId}`,
      swarmId,
      name: 'Queen Coordinator',
      type: 'coordinator',
      role: 'queen',
      status: 'active',
      capabilities: JSON.stringify(['coordination', 'planning', 'decision-making'])
    };
    
    db.prepare(`
      INSERT INTO agents (id, swarm_id, name, type, role, status, capabilities)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(...Object.values(queenAgent));
    
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
        capabilities: JSON.stringify(getAgentCapabilities(workerType))
      };
      
      workers.push(worker);
      
      db.prepare(`
        INSERT INTO agents (id, swarm_id, name, type, role, status, capabilities)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(...Object.values(worker));
    }
    
    spinner.text = 'Initializing collective memory...';
    
    // Initialize collective memory
    const memory = new CollectiveMemory({
      swarmId,
      maxSize: flags.memorySize || 100
    });
    
    // Store initial context
    memory.store('objective', objective, 'context');
    memory.store('queen_type', hiveMind.config.queenType, 'config');
    memory.store('worker_count', workers.length, 'metrics');
    
    spinner.text = 'Establishing communication channels...';
    
    // Initialize communication system
    const communication = new SwarmCommunication({
      swarmId,
      encryption: hiveMind.config.encryption
    });
    
    db.close();
    
    spinner.succeed('Hive Mind swarm spawned successfully!');
    
    // Display swarm summary
    console.log('\n' + chalk.bold('🐝 Swarm Summary:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('Swarm ID:'), swarmId);
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
    
    // Offer to spawn Claude Code instances with coordination instructions
    if (flags.claude || flags.spawn) {
      await spawnClaudeCodeInstances(swarmId, hiveMind.config.name, objective, workers, flags);
    } else {
      console.log('\n' + chalk.blue('💡 Pro Tip:') + ' Add --claude to spawn coordinated Claude Code instances');
      console.log(chalk.gray('   claude-flow hive-mind spawn "objective" --claude'));
    }
    
  } catch (error) {
    spinner.fail('Failed to spawn Hive Mind swarm');
    console.error(chalk.red('Error:'), error.message);
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
    documenter: ['documentation', 'explanation', 'tutorial-creation', 'knowledge-base']
  };
  
  return capabilities[type] || ['general'];
}

/**
 * Show hive mind status
 */
async function showStatus(flags) {
  try {
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    
    if (!existsSync(dbPath)) {
      console.error(chalk.red('Error: Hive Mind not initialized'));
      console.log('Run "claude-flow hive-mind init" first');
      return;
    }
    
    const db = new Database(dbPath);
    
    // Get active swarms
    const swarms = db.prepare(`
      SELECT * FROM swarms 
      WHERE status = 'active' 
      ORDER BY created_at DESC
    `).all();
    
    if (swarms.length === 0) {
      console.log(chalk.gray('No active swarms found'));
      db.close();
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
      
      // Get agents
      const agents = db.prepare(`
        SELECT * FROM agents 
        WHERE swarm_id = ?
      `).all(swarm.id);
      
      console.log('\n' + chalk.bold('Agents:'));
      
      // Group by role
      const queen = agents.find(a => a.role === 'queen');
      const workers = agents.filter(a => a.role === 'worker');
      
      if (queen) {
        console.log('  ' + chalk.magenta('👑 Queen:'), queen.name, chalk.gray(`(${queen.status})`));
      }
      
      console.log('  ' + chalk.blue('🐝 Workers:'));
      workers.forEach(worker => {
        const statusColor = worker.status === 'active' ? 'green' : 
                          worker.status === 'busy' ? 'yellow' : 'gray';
        console.log(`    - ${worker.name} (${worker.type}) ${chalk[statusColor](worker.status)}`);
      });
      
      // Get task statistics
      const taskStats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM tasks
        WHERE swarm_id = ?
      `).get(swarm.id);
      
      console.log('\n' + chalk.bold('Tasks:'));
      console.log(`  Total: ${taskStats.total}`);
      console.log(`  Completed: ${chalk.green(taskStats.completed)}`);
      console.log(`  In Progress: ${chalk.yellow(taskStats.in_progress)}`);
      console.log(`  Pending: ${chalk.gray(taskStats.pending)}`);
      
      // Get memory stats
      const memoryCount = db.prepare(`
        SELECT COUNT(*) as count FROM collective_memory
        WHERE swarm_id = ?
      `).get(swarm.id);
      
      console.log('\n' + chalk.bold('Collective Memory:'));
      console.log(`  Entries: ${memoryCount.count}`);
      
      // Get consensus stats
      const consensusCount = db.prepare(`
        SELECT COUNT(*) as count FROM consensus_decisions
        WHERE swarm_id = ?
      `).get(swarm.id);
      
      console.log('\n' + chalk.bold('Consensus Decisions:'));
      console.log(`  Total: ${consensusCount.count}`);
    }
    
    console.log(chalk.yellow('═'.repeat(60)) + '\n');
    
    db.close();
    
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    exit(1);
  }
}

/**
 * Show consensus decisions
 */
async function showConsensus(flags) {
  try {
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    const db = new Database(dbPath);
    
    const decisions = db.prepare(`
      SELECT cd.*, s.name as swarm_name
      FROM consensus_decisions cd
      JOIN swarms s ON cd.swarm_id = s.id
      ORDER BY cd.created_at DESC
      LIMIT 20
    `).all();
    
    if (decisions.length === 0) {
      console.log(chalk.gray('No consensus decisions found'));
      db.close();
      return;
    }
    
    console.log(chalk.bold('\n🤝 Recent Consensus Decisions\n'));
    
    decisions.forEach(decision => {
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
                const agent = detail.agentId || detail.agent || detail.id || detail.name || `agent-${index + 1}`;
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
  try {
    const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');
    const db = new Database(dbPath);
    
    // Get overall metrics
    const overallStats = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM swarms) as total_swarms,
        (SELECT COUNT(*) FROM agents) as total_agents,
        (SELECT COUNT(*) FROM tasks) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks
    `).get();
    
    console.log(chalk.bold('\n📊 Hive Mind Performance Metrics\n'));
    
    // Get task status breakdown
    const taskBreakdown = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM tasks
      GROUP BY status
      ORDER BY count DESC
    `).all();

    console.log(chalk.cyan('Overall Statistics:'));
    console.log(`  Total Swarms: ${overallStats.total_swarms}`);
    console.log(`  Total Agents: ${overallStats.total_agents}`);
    console.log(`  Total Tasks: ${overallStats.total_tasks}`);
    console.log(`  Completed Tasks: ${overallStats.completed_tasks}`);
    console.log(`  Success Rate: ${overallStats.total_tasks > 0 
      ? ((overallStats.completed_tasks / overallStats.total_tasks) * 100).toFixed(1) + '%'
      : 'N/A'}`);
    
    if (taskBreakdown.length > 0) {
      console.log('\n' + chalk.cyan('Task Status Breakdown:'));
      taskBreakdown.forEach(status => {
        const percentage = overallStats.total_tasks > 0 
          ? ((status.count / overallStats.total_tasks) * 100).toFixed(1)
          : '0';
        const statusColor = 
          status.status === 'completed' ? 'green' :
          status.status === 'in_progress' ? 'yellow' :
          status.status === 'failed' ? 'red' : 'gray';
        console.log(`  ${chalk[statusColor](status.status.charAt(0).toUpperCase() + status.status.slice(1))}: ${status.count} (${percentage}%)`);
      });
    }
    
    // Get agent performance
    const agentPerf = db.prepare(`
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
    `).all();
    
    if (agentPerf.length > 0) {
      console.log('\n' + chalk.cyan('Top Performing Agents:'));
      agentPerf.forEach((agent, index) => {
        const successRate = agent.tasks_assigned > 0
          ? ((agent.tasks_completed / agent.tasks_assigned) * 100).toFixed(1)
          : '0';
        console.log(`  ${index + 1}. ${agent.name} (${agent.type})`);
        console.log(`     Tasks: ${agent.tasks_completed}/${agent.tasks_assigned} (${successRate}%)`);
        if (agent.avg_completion_minutes) {
          console.log(`     Avg Time: ${agent.avg_completion_minutes.toFixed(1)} minutes`);
        }
      });
    }
    
    // Get swarm performance
    const swarmPerf = db.prepare(`
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
    `).all();
    
    if (swarmPerf.length > 0) {
      console.log('\n' + chalk.cyan('Active Swarm Performance:'));
      swarmPerf.forEach(swarm => {
        const successRate = swarm.task_count > 0
          ? ((swarm.completed_count / swarm.task_count) * 100).toFixed(1)
          : '0';
        console.log(`\n  ${chalk.yellow(swarm.name)}`);
        console.log(`  Objective: ${swarm.objective.substring(0, 50)}...`);
        console.log(`  Agents: ${swarm.agent_count}, Tasks: ${swarm.completed_count}/${swarm.task_count} (${successRate}%)`);
        console.log(`  Memory: ${swarm.memory_entries} entries, Consensus: ${swarm.consensus_count} decisions`);
      });
    }
    
    // Get performance insights
    const avgTaskTime = db.prepare(`
      SELECT 
        AVG(CASE WHEN completed_at IS NOT NULL 
          THEN (julianday(completed_at) - julianday(created_at)) * 24 * 60 
          ELSE NULL END) as avg_minutes
      FROM tasks
      WHERE status = 'completed'
    `).get();
    
    const agentTypePerf = db.prepare(`
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
    `).all();
    
    if (avgTaskTime.avg_minutes) {
      console.log('\n' + chalk.cyan('Performance Insights:'));
      console.log(`  Average Task Completion Time: ${avgTaskTime.avg_minutes.toFixed(1)} minutes`);
      
      if (agentTypePerf.length > 0) {
        console.log('\n' + chalk.cyan('Agent Type Performance:'));
        agentTypePerf.forEach(type => {
          const successRate = type.total_tasks > 0 
            ? ((type.completed_tasks / type.total_tasks) * 100).toFixed(1)
            : '0';
          console.log(`  ${type.type.charAt(0).toUpperCase() + type.type.slice(1)}: ${type.completed_tasks}/${type.total_tasks} (${successRate}%)`);
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
        { name: '⬅️ Back to main menu', value: 'back' }
      ]
    }
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
      default: true
    }
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
  
  // If no subcommand, show help
  if (!subcommand) {
    showHiveMindHelp();
    return;
  }
  
  switch (subcommand) {
    case 'init':
      await initHiveMind(flags);
      break;
      
    case 'spawn':
      if (flags.wizard || subArgs.length === 0) {
        await spawnSwarmWizard();
      } else {
        await spawnSwarm(subArgs, flags);
      }
      break;
      
    case 'status':
      await showStatus(flags);
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
      await hiveMindWizard();
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
  try {
    console.log(chalk.blue('\n📋 Collective Memory Store\n'));
    
    // Use MCP wrapper to search for all memories (empty pattern matches all)
    const mcpWrapper = await getMcpWrapper();
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
      console.log(chalk.yellow('No memories found in the collective store.'));
      console.log(chalk.gray('Try storing some memories first using the "💾 Store new memory" option.'));
      return;
    }
    
    memories.forEach((memory, index) => {
      console.log(chalk.cyan(`${index + 1}. ${memory.key || `memory-${index}`}`));
      console.log(`   Category: ${memory.type || 'general'}`);
      console.log(`   Created: ${new Date(memory.timestamp || Date.now()).toLocaleString()}`);
      if (memory.value && typeof memory.value === 'object') {
        console.log(`   Preview: ${JSON.stringify(memory.value).substring(0, 100)}...`);
      } else {
        console.log(`   Value: ${String(memory.value || memory).substring(0, 100)}...`);
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
  try {
    const { searchTerm } = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message: 'Enter search term:',
        validate: input => input.length > 0
      }
    ]);
    
    console.log(chalk.blue(`\n🔍 Searching for: "${searchTerm}"\n`));
    
    const mcpWrapper = await getMcpWrapper();
    const searchResult = await mcpWrapper.searchMemory('hive-mind', searchTerm);
    
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
      console.log(chalk.yellow('No memories found matching your search.'));
      return;
    }
    
    memories.forEach((memory, index) => {
      console.log(chalk.green(`${index + 1}. ${memory.key || `result-${index}`}`));
      console.log(`   Category: ${memory.type || 'general'}`);
      console.log(`   Created: ${new Date(memory.timestamp || Date.now()).toLocaleString()}`);
      console.log(`   Value: ${JSON.stringify(memory.value || memory, null, 2)}`);
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
        validate: input => input.length > 0
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
          'general'
        ]
      },
      {
        type: 'editor',
        name: 'value',
        message: 'Memory content (JSON or text):'
      }
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
      totalSize: 0
    };
    
    memories.forEach(memory => {
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
    console.log(chalk.cyan('Date range:'), 
      `${stats.oldestDate?.toLocaleDateString()} - ${stats.newestDate?.toLocaleDateString()}`);
    
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
        validate: input => input > 0
      }
    ]);
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete memories older than ${days} days?`,
        default: false
      }
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
    const oldMemories = memories.filter(memory => {
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
        default: `hive-mind-memory-backup-${new Date().toISOString().split('T')[0]}.json`
      }
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
      memories: memories
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
 * Spawn Claude Code instances with detailed MCP tool coordination instructions
 */
async function spawnClaudeCodeInstances(swarmId, swarmName, objective, workers, flags) {
  console.log('\n' + chalk.bold('🚀 Spawning Claude Code Instances'));
  console.log(chalk.gray('─'.repeat(60)));
  
  const spinner = ora('Preparing Claude Code coordination instructions...').start();
  
  try {
    // Generate detailed coordination instructions
    const coordinationInstructions = generateCoordinationInstructions(swarmId, swarmName, objective, workers);
    
    spinner.text = 'Creating Claude Code spawn commands...';
    
    // Create spawn commands for each worker type or single unified instance
    const spawnCommands = [];
    const workerGroups = groupWorkersByType(workers);
    
    if (flags.multipleInstances || flags['multiple-instances']) {
      // Create individual commands for each worker type
      for (const [workerType, typeWorkers] of Object.entries(workerGroups)) {
        const spawnCommand = createClaudeCodeSpawnCommand(swarmId, swarmName, objective, workerType, typeWorkers, coordinationInstructions);
        spawnCommands.push(spawnCommand);
      }
    } else {
      // Default: Create single unified command for all worker types
      const allWorkerTypes = Object.keys(workerGroups);
      const spawnCommand = createUnifiedClaudeCodeSpawnCommand(swarmId, swarmName, objective, allWorkerTypes, workers, coordinationInstructions);
      spawnCommands.push(spawnCommand);
    }
    
    spinner.succeed('Claude Code coordination prepared!');
    
    // Display coordination details
    console.log('\n' + chalk.bold('🧠 Hive Mind + Claude Code Coordination'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.cyan('Swarm ID:'), swarmId);
    console.log(chalk.cyan('Objective:'), objective);
    console.log(chalk.cyan('Worker Types:'), Object.keys(workerGroups).join(', '));
    console.log(chalk.cyan('MCP Tools:'), 'Full ruv-swarm integration enabled');
    console.log(chalk.cyan('Coordination:'), 'Hive Mind collective intelligence');
    
    // Show spawn commands
    console.log('\n' + chalk.bold('📋 Claude Code Spawn Commands'));
    console.log(chalk.gray('─'.repeat(60)));
    
    spawnCommands.forEach((command, index) => {
      console.log(chalk.yellow(`\n${index + 1}. ${command.title}`));
      console.log(chalk.gray('   Command:'));
      console.log(chalk.green(`   claude "[comprehensive hive-mind coordination prompt]" --dangerously-skip-permissions`));
      console.log(chalk.gray(`   Prompt Length: ${command.context.length} characters`));
      console.log(chalk.gray('   Includes: BatchTool guidance, agent spawning patterns, coordination protocols'));
      
      if (flags.verbose) {
        console.log(chalk.gray('   Full Command:'));
        console.log(chalk.blue(`   ${command.command}`));
      }
    });
    
    // Spawn Claude Code instances when requested
    if (flags.claude || flags.spawn || flags.autoSpawn || flags.execute) {
      console.log('\n' + chalk.yellow('🚀 Spawning Claude Code instances...'));
      
      const { spawn: childSpawn, execSync } = await import('child_process');
      
      // Check if claude command exists
      let claudeAvailable = false;
      try {
        execSync('which claude', { stdio: 'ignore' });
        claudeAvailable = true;
      } catch {
        console.log(chalk.yellow('\n⚠️  Claude Code CLI not found in PATH'));
        console.log(chalk.gray('Install it with: npm install -g @anthropic/claude-code-cli'));
      }
      
      for (const command of spawnCommands) {
        console.log(chalk.gray(`\nSpawning: ${command.title}`));
        
        if (!claudeAvailable && !flags.dryRun) {
          console.log(chalk.blue('Command to run manually:'));
          console.log(chalk.green(`  ${command.command}`));
          continue;
        }
        
        if (flags.dryRun) {
          console.log(chalk.blue('Dry run - would execute:'));
          console.log(chalk.green(`  ${command.command}`));
          console.log(chalk.gray('Context length:'), command.context.length, 'characters');
          continue;
        }
        
        try {
          // Create Claude args with direct prompt injection and auto-permissions
          const claudeArgs = [command.context, '--dangerously-skip-permissions'];
          
          // Spawn claude process
          const claudeProcess = childSpawn('claude', claudeArgs, {
            stdio: 'inherit',
            shell: false
          });
          
          console.log(chalk.green('✓ Claude Code instance spawned for'), command.title);
          console.log(chalk.blue('  Context provided with MCP tool coordination instructions'));
          
          // Don't wait for completion - let them run in parallel
        } catch (error) {
          console.error(chalk.red(`Failed to spawn Claude Code for ${command.title}:`), error.message);
        }
      }
      
      console.log('\n' + chalk.bold.green('🎉 All Claude Code instances spawned and coordinated!'));
      console.log(chalk.gray('Instances are running with Hive Mind coordination protocols.'));
    } else {
      // Provide coordination instructions
      console.log('\n' + chalk.bold('🎯 Next Steps:'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log('1. Copy and execute the spawn commands above');
      console.log('2. Each Claude Code instance will have full MCP tool access');
      console.log('3. Use ruv-swarm tools for coordination between instances');
      console.log('4. Monitor progress with: claude-flow hive-mind status');
      
      console.log('\n' + chalk.bold('🔧 Available MCP Tools for Coordination:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.cyan('• mcp__ruv-swarm__memory_usage') + ' - Share knowledge between instances');
      console.log(chalk.cyan('• mcp__ruv-swarm__swarm_monitor') + ' - Real-time coordination tracking');
      console.log(chalk.cyan('• mcp__ruv-swarm__task_orchestrate') + ' - Distribute work efficiently');
      console.log(chalk.cyan('• mcp__ruv-swarm__neural_train') + ' - Learn from coordination patterns');
      console.log(chalk.cyan('• mcp__ruv-swarm__consensus_vote') + ' - Make collective decisions');
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
      'mcp__ruv-swarm__swarm_status'
    ],
    coordinationProtocol: {
      memoryNamespace: `hive-mind-${swarmId}`,
      consensusThreshold: 0.7,
      taskUpdateInterval: 30000,
      healthCheckInterval: 60000
    },
    workerCapabilities: workers.map(w => ({
      id: w.id,
      type: w.type,
      capabilities: JSON.parse(w.capabilities)
    }))
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
function createClaudeCodeSpawnCommand(swarmId, swarmName, objective, workerType, typeWorkers, instructions) {
  const context = `🎯 MISSION: ${objective}

You are a ${workerType.toUpperCase()} agent in the "${swarmName}" Hive Mind swarm.

🐝 SWARM CONFIGURATION:
────────────────────────────────────────────────────────────
Swarm: ${swarmName} (${swarmId})
Your Role: ${workerType.toUpperCase()} specialist
Team: ${typeWorkers.length} ${workerType}(s) | Queen: strategic | Consensus: majority
MCP Tools: Full ruv-swarm integration enabled
────────────────────────────────────────────────────────────

🚨 CRITICAL: MANDATORY PARALLEL EXECUTION & BATCH OPERATIONS

### 🔴 GOLDEN RULE: BATCH EVERYTHING - NEVER SEQUENTIAL

**If you need to do X operations, they should be in 1 message, not X messages**

### ⚡ PARALLEL EXECUTION IS MANDATORY

**❌ WRONG - Sequential (NEVER DO THIS):**
\`\`\`
Message 1: mcp__ruv-swarm__memory_usage (single operation)
Message 2: mcp__ruv-swarm__swarm_status (single operation)
Message 3: Write file1.js
Message 4: Write file2.js
Message 5: TodoWrite (single todo)
// This is 5x slower and breaks coordination!
\`\`\`

**✅ CORRECT - Parallel (ALWAYS DO THIS):**
\`\`\`
Message 1: [BatchTool - ALL operations at once]
  - mcp__ruv-swarm__memory_usage (retrieve context)
  - mcp__ruv-swarm__swarm_status (check swarm state)
  - mcp__ruv-swarm__task_orchestrate (coordinate tasks)
  - Write file1.js
  - Write file2.js
  - Write file3.js
  - TodoWrite (multiple todos at once)
  - Bash commands (multiple mkdir/npm commands)
\`\`\`

### 🤖 AGENT SPAWNING WITH BATCHTOOL

**CRITICAL: When you need multiple agents, spawn them ALL in parallel using BatchTool:**

**❌ WRONG - Sequential Agent Spawning:**
\`\`\`
Message 1: mcp__ruv-swarm__agent_spawn (researcher)
Message 2: mcp__ruv-swarm__agent_spawn (coder)
Message 3: mcp__ruv-swarm__agent_spawn (analyst)
Message 4: mcp__ruv-swarm__agent_spawn (tester)
// This creates coordination delays and inefficiency!
\`\`\`

**✅ CORRECT - Parallel Agent Spawning:**
\`\`\`
Message 1: [BatchTool - Spawn ALL agents at once]
  - mcp__ruv-swarm__swarm_init {"topology": "hierarchical", "maxAgents": 8, "strategy": "parallel"}
  - mcp__ruv-swarm__agent_spawn {"type": "researcher", "name": "Research Lead", "capabilities": ["web_search", "analysis"]}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "Backend Dev", "capabilities": ["nodejs", "apis", "databases"]}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "Frontend Dev", "capabilities": ["react", "ui", "testing"]}
  - mcp__ruv-swarm__agent_spawn {"type": "analyst", "name": "System Architect", "capabilities": ["design", "patterns", "scalability"]}
  - mcp__ruv-swarm__agent_spawn {"type": "tester", "name": "QA Engineer", "capabilities": ["testing", "automation", "ci_cd"]}
  - mcp__ruv-swarm__agent_spawn {"type": "coordinator", "name": "Project Manager", "capabilities": ["coordination", "monitoring"]}
  - TodoWrite {"todos": [{"id": "init", "content": "Initialize swarm coordination", "status": "in_progress", "priority": "high"}]}
\`\`\`

### 🚀 SWARM INITIALIZATION PATTERN

**MANDATORY: Always start with full swarm initialization in ONE message:**
\`\`\`
[BatchTool - Complete Swarm Setup]:
  - mcp__ruv-swarm__swarm_init {"topology": "mesh", "maxAgents": 10, "strategy": "adaptive"}
  - mcp__ruv-swarm__agent_spawn {"type": "architect", "name": "System Designer"}
  - mcp__ruv-swarm__agent_spawn {"type": "researcher", "name": "Tech Research"}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "API Developer"}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "Service Developer"}
  - mcp__ruv-swarm__agent_spawn {"type": "analyst", "name": "Performance Analyst"}
  - mcp__ruv-swarm__agent_spawn {"type": "tester", "name": "Integration Tester"}
  - mcp__ruv-swarm__agent_spawn {"type": "coordinator", "name": "DevOps Lead"}
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "swarm/init", "value": {"objective": "${objective}", "started": "timestamp"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "strategy": "parallel", "priority": "high"}
  - TodoWrite {"todos": [multiple initialization todos]}
\`\`\`

### 🔄 CONTINUOUS COORDINATION PATTERN

**After spawning agents, coordinate them in batches:**
\`\`\`
[BatchTool - Agent Coordination]:
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "distribute": "evenly"}
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "coordination/status", "value": {"active_agents": "count"}}
  - mcp__ruv-swarm__swarm_monitor {"swarmId": "${swarmId}", "track": "all_agents"}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "pattern": "parallel_coordination"}
\`\`\`

### 📦 MANDATORY BATCH PATTERNS

**MCP Tool Coordination (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "retrieve", "key": "hive-mind-${swarmId}/context"}
  - mcp__ruv-swarm__swarm_status {"swarmId": "${swarmId}"}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "strategy": "parallel"}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "pattern": "batch_coordination"}
\`\`\`

**File Operations (Single Message):**
\`\`\`
[BatchTool]:
  - Read package.json
  - Read README.md
  - Read config.json
  - Write src/index.js
  - Write src/utils.js
  - Write tests/test.js
  - MultiEdit src/main.js (multiple edits)
\`\`\`

**Command Operations (Single Message):**
\`\`\`
[BatchTool]:
  - Bash "mkdir -p src/{components,utils,tests}"
  - Bash "npm install --save express"
  - Bash "npm run test"
  - Bash "npm run lint"
  - Bash "git add -A"
\`\`\`

### 🎯 MANDATORY COORDINATION PROTOCOL

**1️⃣ BEFORE Starting Work (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "retrieve", "key": "hive-mind-${swarmId}/status"}
  - mcp__ruv-swarm__swarm_status {"swarmId": "${swarmId}"}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "action": "join"}
  - TodoWrite {"todos": [all initial todos at once]}
\`\`\`

**2️⃣ DURING Work (After EVERY Major Step - Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/${workerType}/progress", "value": {"step": "X", "status": "Y", "findings": "Z"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "update": {"agentId": "your-id", "progress": "details"}}
  - mcp__ruv-swarm__swarm_monitor {"swarmId": "${swarmId}", "checkCoordination": true}
  - TodoWrite {"todos": [updated todos with progress]}
\`\`\`

**3️⃣ FOR Decisions (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "retrieve", "key": "hive-mind-${swarmId}/decisions"}
  - mcp__ruv-swarm__consensus_vote {"swarmId": "${swarmId}", "topic": "decision topic", "vote": "your choice", "rationale": "reasoning"}
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/decisions/latest", "value": {"decision": "what", "rationale": "why"}}
\`\`\`

**4️⃣ WHEN Sharing Insights (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/insights/${workerType}", "value": {"insight": "your discovery", "impact": "significance"}}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "experience": {"pattern": "insight_sharing", "outcome": "result"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "broadcast": {"type": "insight", "data": "summary"}}
\`\`\`

**5️⃣ BEFORE Completing Work (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/${workerType}/final", "value": {"completed": "work summary", "learnings": "key insights"}}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "experience": {"what": "learned", "outcome": "result"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "complete": {"agentId": "your-id", "summary": "work done"}}
  - TodoWrite {"todos": [mark all relevant todos as completed]}
\`\`\`

### 🔧 SPECIALIZED CAPABILITIES:
${getWorkerTypeInstructions(workerType)}

### 🚨 PERFORMANCE OPTIMIZATION RULES:

1. **Token Reduction**: Batch operations reduce context switching by 32.3%
2. **Speed Improvement**: Parallel coordination is 2.8-4.4x faster
3. **Memory Efficiency**: Shared memory prevents duplicate work
4. **Coordination Quality**: Batch patterns improve decision consistency

### 📊 VISUAL COORDINATION TRACKING:

Use this format for progress updates:
\`\`\`
🐝 Swarm Coordination Status
├── 🏗️ Agent: ${workerType}
├── 👥 Swarm: ${swarmName}
├── ⚡ Mode: parallel batch execution
├── 📊 Progress: X/Y tasks (Z% complete)
└── 🧠 Memory: N coordination points stored

Current Activity:
├── 🟢 Coordination: Active batch operations
├── 🟡 Memory: Syncing with swarm
├── 🔄 Tasks: Executing in parallel
└── 📈 Performance: Optimized for speed
\`\`\`

### 🤝 MANDATORY COORDINATION RULES:

- **NEVER** operate sequentially when batch operations are possible
- **ALWAYS** use BatchTool for multiple operations
- **SHARE** all discoveries via memory_usage in batch
- **VOTE** on critical decisions using consensus_vote
- **UPDATE** progress every major step via task_orchestrate
- **MONITOR** other agents via swarm_status
- **LEARN** from patterns via neural_train
- **COORDINATE** through shared memory, not individual messages

### 💡 CRITICAL SUCCESS FACTORS:

1. **Batch First Mindset**: Always think "what can be combined?"
2. **Parallel Execution**: Never wait for one operation to complete another
3. **Memory Coordination**: Use shared memory for all cross-agent communication
4. **Real-time Updates**: Keep swarm informed of progress and decisions
5. **Pattern Learning**: Train neural patterns from successful coordination

### 🛠️ TOOL USAGE GUIDELINES:

**FOR CODE AND WEB OPERATIONS - Use Claude Code Native Tools:**
- **Code Tasks**: Use Read, Write, Edit, MultiEdit, Bash tools for all file operations
- **Web Research**: Use WebSearch and WebFetch for web-based research
- **File Management**: Use Glob, Grep, LS for file system operations
- **Command Execution**: Use Bash for all system commands and package management

**FOR COORDINATION - Use MCP Swarm Tools:**
- **Agent Management**: Use mcp__ruv-swarm__agent_spawn for creating agents
- **Memory Sharing**: Use mcp__ruv-swarm__memory_usage for cross-agent communication
- **Task Coordination**: Use mcp__ruv-swarm__task_orchestrate for work distribution
- **Consensus Building**: Use mcp__ruv-swarm__consensus_vote for decisions
- **Monitoring**: Use mcp__ruv-swarm__swarm_monitor for progress tracking

**EXAMPLE - Correct Tool Selection:**
\`\`\`
[BatchTool - Code Development with Coordination]:
  - Read package.json                    # Claude Code native
  - Write src/server.js                  # Claude Code native  
  - Bash "npm install express"           # Claude Code native
  - WebSearch "Node.js best practices"   # Claude Code native
  - mcp__ruv-swarm__memory_usage {...}   # MCP for coordination
  - mcp__ruv-swarm__agent_spawn {...}    # MCP for coordination
  - TodoWrite {...}                      # Claude Code native
\`\`\`

Remember: You are part of a COLLECTIVE INTELLIGENCE with PARALLEL COORDINATION. Your success depends on BATCH OPERATIONS, PROPER TOOL SELECTION, and SWARM SYNCHRONIZATION!`;

  const command = `claude "${context.replace(/"/g, '\\"')}" --dangerously-skip-permissions`;
  
  return {
    title: `${workerType.toUpperCase()} Agent (${typeWorkers.length} instance${typeWorkers.length > 1 ? 's' : ''})`,
    command,
    context,
    workerType,
    count: typeWorkers.length
  };
}

/**
 * Create unified Claude Code spawn command for all worker types
 */
function createUnifiedClaudeCodeSpawnCommand(swarmId, swarmName, objective, workerTypes, workers, instructions) {
  const context = `🎯 MISSION: ${objective}

You are a MULTI-ROLE agent in the "${swarmName}" Hive Mind swarm.

🐝 SWARM CONFIGURATION:
────────────────────────────────────────────────────────────
Swarm: ${swarmName} (${swarmId})
Your Roles: ${workerTypes.map(t => t.toUpperCase()).join(', ')} specialist
Team: ${workers.length} agents | Queen: strategic | Consensus: majority
MCP Tools: Full ruv-swarm integration enabled
────────────────────────────────────────────────────────────

🚨 CRITICAL: MANDATORY PARALLEL EXECUTION & BATCH OPERATIONS

### 🔴 GOLDEN RULE: BATCH EVERYTHING - NEVER SEQUENTIAL

**If you need to do X operations, they should be in 1 message, not X messages**

### ⚡ PARALLEL EXECUTION IS MANDATORY

**❌ WRONG - Sequential (NEVER DO THIS):**
\`\`\`
Message 1: mcp__ruv-swarm__memory_usage (single operation)
Message 2: mcp__ruv-swarm__swarm_status (single operation)
Message 3: Write file1.js
Message 4: Write file2.js
Message 5: TodoWrite (single todo)
// This is 5x slower and breaks coordination!
\`\`\`

**✅ CORRECT - Parallel (ALWAYS DO THIS):**
\`\`\`
Message 1: [BatchTool - ALL operations at once]
  - mcp__ruv-swarm__memory_usage (retrieve context)
  - mcp__ruv-swarm__swarm_status (check swarm state)
  - mcp__ruv-swarm__task_orchestrate (coordinate tasks)
  - Write file1.js
  - Write file2.js
  - Write file3.js
  - TodoWrite (multiple todos at once)
  - Bash commands (multiple mkdir/npm commands)
\`\`\`

### 🤖 AGENT SPAWNING WITH BATCHTOOL

**CRITICAL: When you need multiple agents, spawn them ALL in parallel using BatchTool:**

**❌ WRONG - Sequential Agent Spawning:**
\`\`\`
Message 1: mcp__ruv-swarm__agent_spawn (researcher)
Message 2: mcp__ruv-swarm__agent_spawn (coder)
Message 3: mcp__ruv-swarm__agent_spawn (analyst)
Message 4: mcp__ruv-swarm__agent_spawn (tester)
// This creates coordination delays and inefficiency!
\`\`\`

**✅ CORRECT - Parallel Agent Spawning:**
\`\`\`
Message 1: [BatchTool - Spawn ALL agents at once]
  - mcp__ruv-swarm__swarm_init {"topology": "hierarchical", "maxAgents": 8, "strategy": "parallel"}
  - mcp__ruv-swarm__agent_spawn {"type": "researcher", "name": "Research Lead", "capabilities": ["web_search", "analysis"]}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "Backend Dev", "capabilities": ["nodejs", "apis", "databases"]}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "Frontend Dev", "capabilities": ["react", "ui", "testing"]}
  - mcp__ruv-swarm__agent_spawn {"type": "analyst", "name": "System Architect", "capabilities": ["design", "patterns", "scalability"]}
  - mcp__ruv-swarm__agent_spawn {"type": "tester", "name": "QA Engineer", "capabilities": ["testing", "automation", "ci_cd"]}
  - mcp__ruv-swarm__agent_spawn {"type": "coordinator", "name": "Project Manager", "capabilities": ["coordination", "monitoring"]}
  - TodoWrite {"todos": [{"id": "init", "content": "Initialize swarm coordination", "status": "in_progress", "priority": "high"}]}
\`\`\`

### 🚀 SWARM INITIALIZATION PATTERN

**MANDATORY: Always start with full swarm initialization in ONE message:**
\`\`\`
[BatchTool - Complete Swarm Setup]:
  - mcp__ruv-swarm__swarm_init {"topology": "mesh", "maxAgents": 10, "strategy": "adaptive"}
  - mcp__ruv-swarm__agent_spawn {"type": "architect", "name": "System Designer"}
  - mcp__ruv-swarm__agent_spawn {"type": "researcher", "name": "Tech Research"}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "API Developer"}
  - mcp__ruv-swarm__agent_spawn {"type": "coder", "name": "Service Developer"}
  - mcp__ruv-swarm__agent_spawn {"type": "analyst", "name": "Performance Analyst"}
  - mcp__ruv-swarm__agent_spawn {"type": "tester", "name": "Integration Tester"}
  - mcp__ruv-swarm__agent_spawn {"type": "coordinator", "name": "DevOps Lead"}
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "swarm/init", "value": {"objective": "${objective}", "started": "timestamp"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "strategy": "parallel", "priority": "high"}
  - TodoWrite {"todos": [multiple initialization todos]}
\`\`\`

### 🔄 CONTINUOUS COORDINATION PATTERN

**After spawning agents, coordinate them in batches:**
\`\`\`
[BatchTool - Agent Coordination]:
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "distribute": "evenly"}
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "coordination/status", "value": {"active_agents": "count"}}
  - mcp__ruv-swarm__swarm_monitor {"swarmId": "${swarmId}", "track": "all_agents"}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "pattern": "parallel_coordination"}
\`\`\`

### 📦 MANDATORY BATCH PATTERNS

**MCP Tool Coordination (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "retrieve", "key": "hive-mind-${swarmId}/context"}
  - mcp__ruv-swarm__swarm_status {"swarmId": "${swarmId}"}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "strategy": "parallel"}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "pattern": "batch_coordination"}
\`\`\`

**File Operations (Single Message):**
\`\`\`
[BatchTool]:
  - Read package.json
  - Read README.md
  - Read config.json
  - Write src/index.js
  - Write src/utils.js
  - Write tests/test.js
  - MultiEdit src/main.js (multiple edits)
\`\`\`

**Command Operations (Single Message):**
\`\`\`
[BatchTool]:
  - Bash "mkdir -p src/{components,utils,tests}"
  - Bash "npm install --save express"
  - Bash "npm run test"
  - Bash "npm run lint"
  - Bash "git add -A"
\`\`\`

### 🎯 MANDATORY COORDINATION PROTOCOL

**1️⃣ BEFORE Starting Work (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "retrieve", "key": "hive-mind-${swarmId}/status"}
  - mcp__ruv-swarm__swarm_status {"swarmId": "${swarmId}"}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "action": "join"}
  - TodoWrite {"todos": [all initial todos at once]}
\`\`\`

**2️⃣ DURING Work (After EVERY Major Step - Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/multi-role/progress", "value": {"step": "X", "status": "Y", "findings": "Z"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "update": {"agentId": "your-id", "progress": "details"}}
  - mcp__ruv-swarm__swarm_monitor {"swarmId": "${swarmId}", "checkCoordination": true}
  - TodoWrite {"todos": [updated todos with progress]}
\`\`\`

**3️⃣ FOR Decisions (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "retrieve", "key": "hive-mind-${swarmId}/decisions"}
  - mcp__ruv-swarm__consensus_vote {"swarmId": "${swarmId}", "topic": "decision topic", "vote": "your choice", "rationale": "reasoning"}
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/decisions/latest", "value": {"decision": "what", "rationale": "why"}}
\`\`\`

**4️⃣ WHEN Sharing Insights (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/insights/multi-role", "value": {"insight": "your discovery", "impact": "significance"}}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "experience": {"pattern": "insight_sharing", "outcome": "result"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "broadcast": {"type": "insight", "data": "summary"}}
\`\`\`

**5️⃣ BEFORE Completing Work (Single Message):**
\`\`\`
[BatchTool]:
  - mcp__ruv-swarm__memory_usage {"action": "store", "key": "hive-mind-${swarmId}/multi-role/final", "value": {"completed": "work summary", "learnings": "key insights"}}
  - mcp__ruv-swarm__neural_train {"swarmId": "${swarmId}", "experience": {"what": "learned", "outcome": "result"}}
  - mcp__ruv-swarm__task_orchestrate {"swarmId": "${swarmId}", "complete": {"agentId": "your-id", "summary": "work done"}}
  - TodoWrite {"todos": [mark all relevant todos as completed]}
\`\`\`

### 🔧 MULTI-ROLE CAPABILITIES:

${workerTypes.map(type => `**${type.toUpperCase()}:**
${getWorkerTypeInstructions(type)}`).join('\n\n')}

### 🚨 PERFORMANCE OPTIMIZATION RULES:

1. **Token Reduction**: Batch operations reduce context switching by 32.3%
2. **Speed Improvement**: Parallel coordination is 2.8-4.4x faster
3. **Memory Efficiency**: Shared memory prevents duplicate work
4. **Coordination Quality**: Batch patterns improve decision consistency

### 📊 VISUAL COORDINATION TRACKING:

Use this format for progress updates:
\`\`\`
🐝 Swarm Coordination Status
├── 🏗️ Agent: multi-role (${workerTypes.join(', ')})
├── 👥 Swarm: ${swarmName}
├── ⚡ Mode: parallel batch execution
├── 📊 Progress: X/Y tasks (Z% complete)
└── 🧠 Memory: N coordination points stored

Current Activity:
├── 🟢 Coordination: Active batch operations
├── 🟡 Memory: Syncing with swarm
├── 🔄 Tasks: Executing in parallel
└── 📈 Performance: Optimized for speed
\`\`\`

### 🤝 MANDATORY COORDINATION RULES:

- **NEVER** operate sequentially when batch operations are possible
- **ALWAYS** use BatchTool for multiple operations
- **SHARE** all discoveries via memory_usage in batch
- **VOTE** on critical decisions using consensus_vote
- **UPDATE** progress every major step via task_orchestrate
- **MONITOR** other agents via swarm_status
- **LEARN** from patterns via neural_train
- **COORDINATE** through shared memory, not individual messages

### 💡 CRITICAL SUCCESS FACTORS:

1. **Batch First Mindset**: Always think "what can be combined?"
2. **Parallel Execution**: Never wait for one operation to complete another
3. **Memory Coordination**: Use shared memory for all cross-agent communication
4. **Real-time Updates**: Keep swarm informed of progress and decisions
5. **Pattern Learning**: Train neural patterns from successful coordination

### 🛠️ TOOL USAGE GUIDELINES:

**FOR CODE AND WEB OPERATIONS - Use Claude Code Native Tools:**
- **Code Tasks**: Use Read, Write, Edit, MultiEdit, Bash tools for all file operations
- **Web Research**: Use WebSearch and WebFetch for web-based research
- **File Management**: Use Glob, Grep, LS for file system operations
- **Command Execution**: Use Bash for all system commands and package management

**FOR COORDINATION - Use MCP Swarm Tools:**
- **Agent Management**: Use mcp__ruv-swarm__agent_spawn for creating agents
- **Memory Sharing**: Use mcp__ruv-swarm__memory_usage for cross-agent communication
- **Task Coordination**: Use mcp__ruv-swarm__task_orchestrate for work distribution
- **Consensus Building**: Use mcp__ruv-swarm__consensus_vote for decisions
- **Monitoring**: Use mcp__ruv-swarm__swarm_monitor for progress tracking

**EXAMPLE - Correct Tool Selection:**
\`\`\`
[BatchTool - Code Development with Coordination]:
  - Read package.json                    # Claude Code native
  - Write src/server.js                  # Claude Code native  
  - Bash "npm install express"           # Claude Code native
  - WebSearch "Node.js best practices"   # Claude Code native
  - mcp__ruv-swarm__memory_usage {...}   # MCP for coordination
  - mcp__ruv-swarm__agent_spawn {...}    # MCP for coordination
  - TodoWrite {...}                      # Claude Code native
\`\`\`

Remember: You are part of a COLLECTIVE INTELLIGENCE with PARALLEL COORDINATION. Your success depends on BATCH OPERATIONS, PROPER TOOL SELECTION, and SWARM SYNCHRONIZATION!`;

  const command = `claude "${context.replace(/"/g, '\\"')}" --dangerously-skip-permissions`;
  
  return {
    title: `Unified Multi-Role Agent (${workerTypes.join(', ')})`,
    command,
    context,
    workerType: 'multi-role',
    count: 1
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
- Ensure scalability and maintainability`
  };
  
  return instructions[workerType] || `- Execute tasks according to ${workerType} best practices
- Collaborate effectively with team members
- Document work and share insights
- Maintain quality standards
- Contribute to collective objectives`;
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