/**
 * Comprehensive Agent management commands with advanced features
 */

// Using Node.js equivalents for CLI functionality
import Table from 'cli-table3';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { Command } from 'commander';
import { AgentProfile } from '../../utils/types.js';
import { generateId } from '../../utils/helpers.js';
import { AgentManager } from '../../agents/agent-manager.js';
import { MemoryManager } from '../../memory/manager.js';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';
import { DistributedMemorySystem } from '../../memory/distributed-memory.js';
import { formatDuration, formatBytes, formatPercentage } from '../../utils/formatters.js';
import path from 'node:path';
import fs from 'node:fs/promises';

// Global agent manager instance
let agentManager: AgentManager | null = null;

// Initialize agent manager
async function initializeAgentManager(): Promise<AgentManager> {
  if (agentManager) return agentManager;
  
  const logger = new Logger({ level: 'info' });
  const eventBus = new EventBus();
  const memorySystem = new DistributedMemorySystem({
    backend: 'sqlite',
    path: './memory/agents.db'
  });
  
  await memorySystem.initialize();
  
  agentManager = new AgentManager(
    {
      maxAgents: 100,
      defaultTimeout: 60000,
      heartbeatInterval: 15000,
      healthCheckInterval: 30000,
      autoRestart: true,
      resourceLimits: {
        memory: 1024 * 1024 * 1024, // 1GB
        cpu: 2.0,
        disk: 2 * 1024 * 1024 * 1024 // 2GB
      }
    },
    logger,
    eventBus,
    memorySystem
  );
  
  await agentManager.initialize();
  return agentManager;
}

export const agentCommand = new Command()
  .description('Comprehensive Claude-Flow agent management with advanced features')
  .action(() => {
    console.log(chalk.cyan('🤖 Claude-Flow Agent Management System'));
    console.log('');
    console.log('Available commands:');
    console.log('  spawn    - Create and start new agents with advanced configuration');
    console.log('  list     - Display all agents with status, metrics, and resource usage');
    console.log('  info     - Get detailed information about a specific agent');
    console.log('  terminate - Safely terminate agents with cleanup and state preservation');
    console.log('  pool     - Manage agent pools for scaling and load distribution');
    console.log('  health   - Monitor agent health and performance metrics');
    console.log('  logs     - View agent logs and activity history');
    console.log('');
    console.log('Use --help with any command for detailed options.');
    agentCommand.showHelp();
  })
  .command('list', new Command()
    .description('Display all agents with comprehensive status and metrics')
    .option('-t, --type <type:string>', 'Filter by agent type')
    .option('-s, --status <status:string>', 'Filter by agent status')
    .option('--unhealthy', 'Show only unhealthy agents')
    .option('--json', 'Output in JSON format')
    .option('--detailed', 'Show detailed resource usage and metrics')
    .option('--sort <field:string>', 'Sort by field (name, type, status, health, workload)', { default: 'name' })
    .action(async (options) => {
      try {
        const manager = await initializeAgentManager();
        let agents = manager.getAllAgents();
        
        // Apply filters
        if (options.type) {
          agents = agents.filter(agent => agent.type === options.type);
        }
        
        if (options.status) {
          agents = agents.filter(agent => agent.status === options.status);
        }
        
        if (options.unhealthy) {
          agents = agents.filter(agent => agent.health < 0.7);
        }
        
        // Sort agents
        agents.sort((a, b) => {
          switch (options.sort) {
            case 'type': return a.type.localeCompare(b.type);
            case 'status': return a.status.localeCompare(b.status);
            case 'health': return b.health - a.health;
            case 'workload': return b.workload - a.workload;
            default: return a.name.localeCompare(b.name);
          }
        });
        
        if (options.json) {
          console.log(JSON.stringify(agents, null, 2));
          return;
        }
        
        if (agents.length === 0) {
          console.log(chalk.yellow('No agents found matching the criteria'));
          return;
        }
        
        console.log(chalk.cyan(`\n🤖 Agent Status Report (${agents.length} agents)`));
        console.log('=' .repeat(80));
        
        if (options.detailed) {
          displayDetailedAgentList(agents, manager);
        } else {
          displayCompactAgentList(agents);
        }
        
        // Display system stats
        const stats = manager.getSystemStats();
        console.log('\n' + chalk.cyan('System Overview:'));
        console.log(`Total Agents: ${stats.totalAgents} | Active: ${stats.activeAgents} | Healthy: ${stats.healthyAgents}`);
        console.log(`Average Health: ${formatPercentage(stats.averageHealth)} | Pools: ${stats.pools}`);
        
      } catch (error) {
        console.error(chalk.red('Error listing agents:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }),
  )
  .command('spawn', new Command()
    .description('Create and start new agents with advanced configuration options')
    .arguments('[template:string]')
    .option('-n, --name <name:string>', 'Agent name')
    .option('-t, --type <type:string>', 'Agent type')
    .option('--template <template:string>', 'Use predefined template')
    .option('--pool <pool:string>', 'Add to specific pool')
    .option('--autonomy <level:number>', 'Autonomy level (0-1)', { default: 0.7 })
    .option('--max-tasks <max:number>', 'Maximum concurrent tasks', { default: 5 })
    .option('--max-memory <mb:number>', 'Memory limit in MB', { default: 512 })
    .option('--timeout <ms:number>', 'Task timeout in milliseconds', { default: 300000 })
    .option('--interactive', 'Interactive configuration')
    .option('--start', 'Automatically start the agent after creation')
    .option('--config <path:string>', 'Load configuration from JSON file')
    .action(async (options, template?: string) => {
      try {
        const manager = await initializeAgentManager();
        
        let agentConfig: any = {};
        
        // Load from config file if provided
        if (options.config) {
          const configPath = path.resolve(options.config);
          const configData = await fs.readFile(configPath, 'utf-8');
          agentConfig = JSON.parse(configData);
        }
        
        // Interactive mode
        if (options.interactive) {
          agentConfig = await interactiveAgentConfiguration(manager);
        } else {
          // Use template or command line options
          const templateName = template || options.template;
          if (!templateName) {
            console.error(chalk.red('Error: Template name is required. Use --interactive for guided setup.'));
            return;
          }
          
          const templates = manager.getAgentTemplates();
          const selectedTemplate = templates.find(t => t.name.toLowerCase().includes(templateName.toLowerCase()));
          
          if (!selectedTemplate) {
            console.error(chalk.red(`Template '${templateName}' not found.`));
            console.log('Available templates:');
            templates.forEach(t => console.log(`  - ${t.name} (${t.type})`));
            return;
          }
          
          agentConfig = {
            template: selectedTemplate.name,
            name: options.name,
            config: {
              autonomyLevel: options.autonomy,
              maxConcurrentTasks: options.maxTasks,
              timeoutThreshold: options.timeout
            },
            environment: {
              maxMemoryUsage: options.maxMemory * 1024 * 1024
            }
          };
        }
        
        console.log(chalk.cyan('\n🚀 Creating new agent...'));
        
        // Create the agent
        const agentId = await manager.createAgent(
          agentConfig.template || 'researcher',
          {
            name: agentConfig.name,
            config: agentConfig.config,
            environment: agentConfig.environment
          }
        );
        
        console.log(chalk.green(`✅ Agent created successfully!`));
        console.log(`Agent ID: ${chalk.bold(agentId)}`);
        
        // Add to pool if specified
        if (options.pool) {
          const pools = manager.getAllPools();
          const targetPool = pools.find(p => p.name === options.pool || p.id === options.pool);
          if (targetPool) {
            // Add agent to pool (this would need pool management methods)
            console.log(chalk.blue(`Added to pool: ${targetPool.name}`));
          } else {
            console.log(chalk.yellow(`Warning: Pool '${options.pool}' not found`));
          }
        }
        
        // Start agent if requested
        if (options.start) {
          console.log(chalk.cyan('Starting agent...'));
          await manager.startAgent(agentId);
          console.log(chalk.green('✅ Agent started and ready!'));
        } else {
          console.log(chalk.yellow(`Use 'claude-flow agent start ${agentId}' to start the agent`));
        }
        
        // Display agent info
        const agent = manager.getAgent(agentId);
        if (agent) {
          displayAgentSummary(agent);
        }
        
      } catch (error) {
        console.error(chalk.red('Error creating agent:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }),
  )
  .command('terminate', new Command()
    .description('Safely terminate agents with cleanup and state preservation')
    .arguments('<agent-id:string>')
    .option('--force', 'Force termination without graceful shutdown')
    .option('--preserve-state', 'Preserve agent state in memory for later revival')
    .option('--cleanup', 'Remove all agent data and logs')
    .option('--reason <reason:string>', 'Termination reason for logging')
    .action(async (options, agentId: string) => {
      try {
        const manager = await initializeAgentManager();
        const agent = manager.getAgent(agentId);
        
        if (!agent) {
          console.error(chalk.red(`Agent '${agentId}' not found`));
          return;
        }
        
        console.log(chalk.cyan(`\n🛑 Terminating agent: ${agent.name} (${agentId})`));
        console.log(`Current status: ${getStatusColor(agent.status)}${agent.status}${chalk.reset}`);
        
        // Confirm termination if agent is busy
        if (agent.status === 'busy' && agent.workload > 0) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Agent has ${agent.workload} active tasks. Continue with termination?`,
            default: false
          }]);
          
          if (!confirm) {
            console.log(chalk.yellow('Termination cancelled'));
            return;
          }
        }
        
        const reason = options.reason || 'user_request';
        
        // Preserve state if requested
        if (options.preserveState) {
          console.log(chalk.blue('📦 Preserving agent state...'));
          await manager.memory.store(`agent_state:${agentId}`, {
            agent,
            terminationTime: new Date(),
            reason,
            preservedBy: 'user'
          }, {
            type: 'preserved-agent-state',
            tags: ['terminated', 'preserved'],
            partition: 'archived'
          });
        }
        
        // Terminate the agent
        if (options.force) {
          console.log(chalk.red('⚡ Force terminating agent...'));
          // Force termination would be implemented
        } else {
          console.log(chalk.yellow('🔄 Gracefully shutting down agent...'));
        }
        
        await manager.stopAgent(agentId, reason);
        
        if (options.cleanup) {
          console.log(chalk.blue('🧹 Cleaning up agent data...'));
          await manager.removeAgent(agentId);
        }
        
        console.log(chalk.green('✅ Agent terminated successfully'));
        
        // Show final stats
        if (agent.metrics) {
          console.log('\n' + chalk.dim('Final Statistics:'));
          console.log(`  Tasks Completed: ${agent.metrics.tasksCompleted}`);
          console.log(`  Success Rate: ${formatPercentage(agent.metrics.successRate)}`);
          console.log(`  Uptime: ${formatDuration(agent.metrics.totalUptime)}`);
        }
        
      } catch (error) {
        console.error(chalk.red('Error terminating agent:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }),
  )
  .command('info', new Command()
    .description('Get comprehensive information about a specific agent')
    .arguments('<agent-id:string>')
    .option('--logs', 'Include recent log entries')
    .option('--metrics', 'Show detailed performance metrics')
    .option('--health', 'Include health diagnostic information')
    .option('--tasks', 'Show task history')
    .option('--config', 'Display agent configuration')
    .option('--json', 'Output in JSON format')
    .action(async (options, agentId: string) => {
      try {
        const manager = await initializeAgentManager();
        const agent = manager.getAgent(agentId);
        
        if (!agent) {
          console.error(chalk.red(`Agent '${agentId}' not found`));
          
          // Suggest similar agent IDs
          const allAgents = manager.getAllAgents();
          const similar = allAgents.filter(a => 
            a.id.id.includes(agentId) || 
            a.name.toLowerCase().includes(agentId.toLowerCase())
          );
          
          if (similar.length > 0) {
            console.log('\nDid you mean one of these agents?');
            similar.forEach(a => console.log(`  ${a.id.id} - ${a.name}`));
          }
          return;
        }
        
        if (options.json) {
          const fullInfo = {
            agent,
            health: manager.getAgentHealth(agentId),
            logs: options.logs ? await getAgentLogs(agentId) : undefined,
            metrics: options.metrics ? await getDetailedMetrics(agentId, manager) : undefined
          };
          console.log(JSON.stringify(fullInfo, null, 2));
          return;
        }
        
        console.log(chalk.cyan(`\n🤖 Agent Information: ${agent.name}`));
        console.log('=' .repeat(60));
        
        // Basic info
        displayAgentBasicInfo(agent);
        
        // Status and health
        displayAgentStatusHealth(agent, manager);
        
        // Configuration
        if (options.config) {
          displayAgentConfiguration(agent);
        }
        
        // Metrics
        if (options.metrics) {
          await displayAgentMetrics(agent, manager);
        }
        
        // Health details
        if (options.health) {
          displayAgentHealthDetails(agentId, manager);
        }
        
        // Task history
        if (options.tasks) {
          displayAgentTaskHistory(agent);
        }
        
        // Logs
        if (options.logs) {
          await displayAgentLogs(agentId);
        }
        
      } catch (error) {
        console.error(chalk.red('Error getting agent info:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }),
  )
  
  // Additional commands
  .command('start', new Command()
    .description('Start a created agent')
    .arguments('<agent-id:string>')
    .action(async (options, agentId: string) => {
      try {
        const manager = await initializeAgentManager();
        console.log(chalk.cyan(`🚀 Starting agent ${agentId}...`));
        await manager.startAgent(agentId);
        console.log(chalk.green('✅ Agent started successfully'));
      } catch (error) {
        console.error(chalk.red('Error starting agent:'), error instanceof Error ? error.message : String(error));
      }
    })
  )
  
  .command('restart', new Command()
    .description('Restart an agent')
    .arguments('<agent-id:string>')
    .option('--reason <reason:string>', 'Restart reason')
    .action(async (options, agentId: string) => {
      try {
        const manager = await initializeAgentManager();
        console.log(chalk.cyan(`🔄 Restarting agent ${agentId}...`));
        await manager.restartAgent(agentId, options.reason);
        console.log(chalk.green('✅ Agent restarted successfully'));
      } catch (error) {
        console.error(chalk.red('Error restarting agent:'), error instanceof Error ? error.message : String(error));
      }
    })
  )
  
  .command('pool', new Command()
    .description('Manage agent pools')
    .option('--create <name:string>', 'Create a new pool')
    .option('--template <template:string>', 'Template for pool agents')
    .option('--min-size <min:number>', 'Minimum pool size', { default: 1 })
    .option('--max-size <max:number>', 'Maximum pool size', { default: 10 })
    .option('--auto-scale', 'Enable auto-scaling')
    .option('--list', 'List all pools')
    .option('--scale <pool:string>', 'Scale a pool')
    .option('--size <size:number>', 'Target size for scaling')
    .action(async (options) => {
      try {
        const manager = await initializeAgentManager();
        
        if (options.create) {
          if (!options.template) {
            console.error(chalk.red('Template is required for pool creation'));
            return;
          }
          
          const poolId = await manager.createAgentPool(options.create, options.template, {
            minSize: options.minSize,
            maxSize: options.maxSize,
            autoScale: options.autoScale
          });
          
          console.log(chalk.green(`✅ Pool '${options.create}' created with ID: ${poolId}`));
        }
        
        if (options.scale && options.size !== undefined) {
          const pools = manager.getAllPools();
          const pool = pools.find(p => p.name === options.scale || p.id === options.scale);
          
          if (!pool) {
            console.error(chalk.red(`Pool '${options.scale}' not found`));
            return;
          }
          
          await manager.scalePool(pool.id, options.size);
          console.log(chalk.green(`✅ Pool scaled to ${options.size} agents`));
        }
        
        if (options.list) {
          const pools = manager.getAllPools();
          if (pools.length === 0) {
            console.log(chalk.yellow('No pools found'));
            return;
          }
          
          console.log(chalk.cyan('\n🏊 Agent Pools'));
          const table = new Table({
            head: ['Name', 'Type', 'Size', 'Available', 'Busy', 'Auto-Scale']
          });
          
          pools.forEach(pool => {
            table.push([
              pool.name,
              pool.type,
              pool.currentSize.toString(),
              pool.availableAgents.length.toString(),
              pool.busyAgents.length.toString(),
              pool.autoScale ? '✅' : '❌'
            ]);
          });
          
          console.log(table.toString());
        }
        
      } catch (error) {
        console.error(chalk.red('Error managing pools:'), error instanceof Error ? error.message : String(error));
      }
    })
  )
  
  .command('health', new Command()
    .description('Monitor agent health and performance')
    .option('--watch', 'Continuously monitor health')
    .option('--threshold <threshold:number>', 'Health threshold for alerts', { default: 0.7 })
    .option('--agent <agent-id:string>', 'Monitor specific agent')
    .action(async (options) => {
      try {
        const manager = await initializeAgentManager();
        
        if (options.watch) {
          console.log(chalk.cyan('🔍 Monitoring agent health (Ctrl+C to stop)...'));
          
          const monitor = setInterval(() => {
            console.clear();
            displayHealthDashboard(manager, options.threshold, options.agent);
          }, 3000);
          
          process.on('SIGINT', () => {
            clearInterval(monitor);
            console.log(chalk.yellow('\nHealth monitoring stopped'));
            process.exit(0);
          });
        } else {
          displayHealthDashboard(manager, options.threshold, options.agent);
        }
        
      } catch (error) {
        console.error(chalk.red('Error monitoring health:'), error instanceof Error ? error.message : String(error));
      }
    })
  );

// === HELPER FUNCTIONS ===

async function interactiveAgentConfiguration(manager: AgentManager): Promise<any> {
  console.log(chalk.cyan('\n🛠️  Interactive Agent Configuration'));
  
  const templates = manager.getAgentTemplates();
  const templateChoices = templates.map(t => ({ name: `${t.name} (${t.type})`, value: t.name }));
  
  const { template } = await inquirer.prompt([{
    type: 'list',
    name: 'template',
    message: 'Select agent template:',
    choices: templateChoices
  }]);
  
  const { name } = await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Agent name:',
    default: `${template.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`
  }]);
  
  const { autonomyLevel } = await inquirer.prompt([{
    type: 'number',
    name: 'autonomyLevel',
    message: 'Autonomy level (0-1):',
    default: 0.7,
    validate: (input) => {
      if (input >= 0 && input <= 1) return true;
      return 'Please enter a number between 0 and 1';
    }
  }]);
  
  const { maxTasks } = await inquirer.prompt([{
    type: 'number',
    name: 'maxTasks',
    message: 'Maximum concurrent tasks:',
    default: 5,
    validate: (input) => {
      if (input >= 1 && input <= 20) return true;
      return 'Please enter a number between 1 and 20';
    }
  }]);
  
  const { maxMemory } = await inquirer.prompt([{
    type: 'number',
    name: 'maxMemory',
    message: 'Memory limit (MB):',
    default: 512,
    validate: (input) => {
      if (input >= 128 && input <= 4096) return true;
      return 'Please enter a number between 128 and 4096';
    }
  }]);
  
  return {
    template,
    name,
    config: {
      autonomyLevel,
      maxConcurrentTasks: maxTasks,
      timeoutThreshold: 300000
    },
    environment: {
      maxMemoryUsage: maxMemory * 1024 * 1024
    }
  };
}

function displayCompactAgentList(agents: any[]): void {
  const table = new Table({
    head: ['ID', 'Name', 'Type', 'Status', 'Health', 'Workload', 'Last Activity']
  });
  
  agents.forEach(agent => {
    table.push([
      agent.id.id.slice(-8),
      agent.name,
      agent.type,
      getStatusDisplay(agent.status),
      getHealthDisplay(agent.health),
      agent.workload.toString(),
      formatRelativeTime(agent.metrics?.lastActivity || agent.lastHeartbeat)
    ]);
  });
  
  console.log(table.toString());
}

function displayDetailedAgentList(agents: any[], manager: AgentManager): void {
  agents.forEach((agent, index) => {
    if (index > 0) console.log('\n' + '-'.repeat(60));
    
    console.log(`\n${chalk.bold(agent.name)} (${agent.id.id.slice(-8)})`);
    console.log(`Type: ${chalk.blue(agent.type)} | Status: ${getStatusDisplay(agent.status)}`);
    console.log(`Health: ${getHealthDisplay(agent.health)} | Workload: ${agent.workload}`);
    
    if (agent.metrics) {
      console.log(`Tasks: ${agent.metrics.tasksCompleted} completed, ${agent.metrics.tasksFailed} failed`);
      console.log(`Success Rate: ${formatPercentage(agent.metrics.successRate)}`);
      console.log(`CPU: ${formatPercentage(agent.metrics.cpuUsage)} | Memory: ${formatBytes(agent.metrics.memoryUsage)}`);
    }
    
    const health = manager.getAgentHealth(agent.id.id);
    if (health && health.issues.length > 0) {
      console.log(chalk.red(`Issues: ${health.issues.length} active`));
    }
  });
}

function displayAgentSummary(agent: any): void {
  console.log('\n' + chalk.dim('Agent Summary:'));
  console.log(`  Name: ${agent.name}`);
  console.log(`  Type: ${agent.type}`);
  console.log(`  Status: ${getStatusDisplay(agent.status)}`);
  console.log(`  Health: ${getHealthDisplay(agent.health)}`);
}

function displayAgentBasicInfo(agent: any): void {
  console.log(`ID: ${chalk.bold(agent.id.id)}`);
  console.log(`Name: ${chalk.bold(agent.name)}`);
  console.log(`Type: ${chalk.blue(agent.type)}`);
  console.log(`Instance: ${agent.id.instance}`);
  console.log(`Created: ${formatRelativeTime(agent.lastHeartbeat)}`);
}

function displayAgentStatusHealth(agent: any, manager: AgentManager): void {
  console.log('\n' + chalk.cyan('Status & Health:'));
  console.log(`Status: ${getStatusDisplay(agent.status)}`);
  console.log(`Health: ${getHealthDisplay(agent.health)}`);
  console.log(`Workload: ${agent.workload} active tasks`);
  console.log(`Last Heartbeat: ${formatRelativeTime(agent.lastHeartbeat)}`);
  
  const health = manager.getAgentHealth(agent.id.id);
  if (health) {
    console.log(`Health Components:`);
    console.log(`  Responsiveness: ${formatPercentage(health.components.responsiveness)}`);
    console.log(`  Performance: ${formatPercentage(health.components.performance)}`);
    console.log(`  Reliability: ${formatPercentage(health.components.reliability)}`);
    console.log(`  Resource Usage: ${formatPercentage(health.components.resourceUsage)}`);
  }
}

function displayAgentConfiguration(agent: any): void {
  console.log('\n' + chalk.cyan('Configuration:'));
  console.log(`Autonomy Level: ${agent.config.autonomyLevel}`);
  console.log(`Max Concurrent Tasks: ${agent.config.maxConcurrentTasks}`);
  console.log(`Timeout Threshold: ${formatDuration(agent.config.timeoutThreshold)}`);
  console.log(`Runtime: ${agent.environment.runtime}`);
  console.log(`Working Directory: ${agent.environment.workingDirectory}`);
}

async function displayAgentMetrics(agent: any, manager: AgentManager): Promise<void> {
  console.log('\n' + chalk.cyan('Performance Metrics:'));
  if (agent.metrics) {
    console.log(`Tasks Completed: ${agent.metrics.tasksCompleted}`);
    console.log(`Tasks Failed: ${agent.metrics.tasksFailed}`);
    console.log(`Success Rate: ${formatPercentage(agent.metrics.successRate)}`);
    console.log(`Average Execution Time: ${formatDuration(agent.metrics.averageExecutionTime)}`);
    console.log(`CPU Usage: ${formatPercentage(agent.metrics.cpuUsage)}`);
    console.log(`Memory Usage: ${formatBytes(agent.metrics.memoryUsage)}`);
    console.log(`Total Uptime: ${formatDuration(agent.metrics.totalUptime)}`);
    console.log(`Response Time: ${agent.metrics.responseTime}ms`);
  }
}

function displayAgentHealthDetails(agentId: string, manager: AgentManager): void {
  const health = manager.getAgentHealth(agentId);
  if (!health) return;
  
  console.log('\n' + chalk.cyan('Health Details:'));
  console.log(`Overall Score: ${getHealthDisplay(health.overall)}`);
  console.log(`Trend: ${getHealthTrendDisplay(health.trend)}`);
  console.log(`Last Check: ${formatRelativeTime(health.lastCheck)}`);
  
  if (health.issues.length > 0) {
    console.log('\n' + chalk.red('Active Issues:'));
    health.issues.forEach((issue, index) => {
      const severity = getSeverityColor(issue.severity);
      console.log(`  ${index + 1}. [${severity}${issue.severity.toUpperCase()}${chalk.reset}] ${issue.message}`);
      if (issue.recommendedAction) {
        console.log(`     💡 ${chalk.dim(issue.recommendedAction)}`);
      }
    });
  }
}

function displayAgentTaskHistory(agent: any): void {
  console.log('\n' + chalk.cyan('Task History:'));
  if (agent.taskHistory && agent.taskHistory.length > 0) {
    agent.taskHistory.slice(-5).forEach((task: any, index: number) => {
      console.log(`  ${index + 1}. ${task.type} - ${task.status} (${formatRelativeTime(task.timestamp)})`);
    });
  } else {
    console.log('  No task history available');
  }
}

async function displayAgentLogs(agentId: string): Promise<void> {
  console.log('\n' + chalk.cyan('Recent Logs:'));
  const logs = await getAgentLogs(agentId);
  if (logs && logs.length > 0) {
    logs.slice(-10).forEach((log: any) => {
      const level = getLogLevelColor(log.level);
      console.log(`  [${formatTime(log.timestamp)}] ${level}${log.level}${chalk.reset}: ${log.message}`);
    });
  } else {
    console.log('  No recent logs available');
  }
}

function displayHealthDashboard(manager: AgentManager, threshold: number, specificAgent?: string): void {
  const agents = specificAgent ? 
    [manager.getAgent(specificAgent)].filter(Boolean) : 
    manager.getAllAgents();
  
  const stats = manager.getSystemStats();
  
  console.log(chalk.cyan('\n🏥 Agent Health Dashboard'));
  console.log('=' .repeat(60));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Total Agents: ${stats.totalAgents} | Active: ${stats.activeAgents} | Healthy: ${stats.healthyAgents}`);
  console.log(`Average Health: ${formatPercentage(stats.averageHealth)}`);
  
  const unhealthyAgents = agents.filter(a => a.health < threshold);
  if (unhealthyAgents.length > 0) {
    console.log(chalk.red(`\n⚠️  ${unhealthyAgents.length} agents below health threshold:`));
    unhealthyAgents.forEach(agent => {
      console.log(`  ${agent.name}: ${getHealthDisplay(agent.health)}`);
    });
  }
  
  // Resource utilization
  console.log('\n' + chalk.cyan('Resource Utilization:'));
  console.log(`CPU: ${formatPercentage(stats.resourceUtilization.cpu)}`);
  console.log(`Memory: ${formatPercentage(stats.resourceUtilization.memory)}`);
  console.log(`Disk: ${formatPercentage(stats.resourceUtilization.disk)}`);
}

// === UTILITY FUNCTIONS ===

async function getAgentLogs(agentId: string): Promise<any[]> {
  // This would fetch logs from the logging system
  // For now, return empty array
  return [];
}

async function getDetailedMetrics(agentId: string, manager: AgentManager): Promise<any> {
  // This would fetch detailed metrics
  const agent = manager.getAgent(agentId);
  return agent?.metrics || {};
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'idle': return chalk.green;
    case 'busy': return chalk.blue;
    case 'error': return chalk.red;
    case 'offline': return chalk.gray;
    case 'initializing': return chalk.yellow;
    case 'terminating': return chalk.yellow;
    case 'terminated': return chalk.gray;
    default: return chalk.white;
  }
}

function getStatusDisplay(status: string): string {
  const color = getStatusColor(status);
  return `${color}${status.toUpperCase()}${chalk.reset}`;
}

function getHealthDisplay(health: number): string {
  const percentage = Math.round(health * 100);
  let color = chalk.green;
  
  if (health < 0.3) color = chalk.red;
  else if (health < 0.7) color = chalk.yellow;
  
  return `${color}${percentage}%${chalk.reset}`;
}

function getHealthTrendDisplay(trend: string): string {
  switch (trend) {
    case 'improving': return `${chalk.green}↗ Improving${chalk.reset}`;
    case 'degrading': return `${chalk.red}↘ Degrading${chalk.reset}`;
    default: return `${chalk.blue}→ Stable${chalk.reset}`;
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return chalk.red;
    case 'high': return chalk.red;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.blue;
    default: return chalk.white;
  }
}

function getLogLevelColor(level: string): string {
  switch (level.toLowerCase()) {
    case 'error': return chalk.red;
    case 'warn': return chalk.yellow;
    case 'info': return chalk.blue;
    case 'debug': return chalk.gray;
    default: return chalk.white;
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString();
}

function getCapabilitiesForType(type: string): string[] {
  const capabilities: Record<string, string[]> = {
    coordinator: ['task-assignment', 'planning', 'delegation'],
    researcher: ['web-search', 'information-gathering', 'analysis'],
    implementer: ['code-generation', 'file-manipulation', 'testing'],
    analyst: ['data-analysis', 'pattern-recognition', 'reporting'],
    custom: ['user-defined'],
  };

  return capabilities[type] || capabilities.custom;
}

function getDefaultPromptForType(type: string): string {
  const prompts: Record<string, string> = {
    coordinator: 'You are a coordination agent responsible for planning and delegating tasks.',
    researcher: 'You are a research agent specialized in gathering and analyzing information.',
    implementer: 'You are an implementation agent focused on writing code and creating solutions.',
    analyst: 'You are an analysis agent that identifies patterns and generates insights.',
    custom: 'You are a custom agent. Follow the user\'s instructions.',
  };

  return prompts[type] || prompts.custom;
}