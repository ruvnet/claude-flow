#!/usr/bin/env node
/**
 * Hive Mind Interactive Wizard
 *
 * Interactive setup and management wizard for Hive Mind swarms
 * with guided workflows and visual feedback.
 */

import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import figlet from 'figlet';
import gradient from 'gradient-string';
import { HiveMind } from '../../../hive-mind/core/HiveMind.js';
import { DatabaseManager } from '../../../hive-mind/core/DatabaseManager.js';
import { formatSuccess, formatError, formatInfo, formatWarning } from '../../formatter.js';

type WizardAction =
  | 'create_swarm'
  | 'manage_agents'
  | 'submit_task'
  | 'view_status'
  | 'configure_memory'
  | 'run_simulation'
  | 'export_data'
  | 'switch_swarm'
  | 'exit';

export const wizardCommand = new Command('wizard')
  .description('Interactive Hive Mind setup and management wizard')
  .option('--skip-intro', 'Skip the intro animation', false)
  .action(async (options) => {
    try {
      // Show intro
      if (!options.skipIntro) {
        await showIntro();
      }

      // Main wizard loop
      let exit = false;
      while (!exit) {
        const action = await selectAction();

        switch (action) {
          case 'create_swarm':
            await createSwarmWizard();
            break;
          case 'manage_agents':
            await manageAgentsWizard();
            break;
          case 'submit_task':
            await submitTaskWizard();
            break;
          case 'view_status':
            await viewStatusWizard();
            break;
          case 'configure_memory':
            await configureMemoryWizard();
            break;
          case 'run_simulation':
            await runSimulationWizard();
            break;
          case 'export_data':
            await exportDataWizard();
            break;
          case 'switch_swarm':
            await switchSwarmWizard();
            break;
          case 'exit':
            exit = true;
            break;
        }

        if (!exit) {
          await inquirer
            .prompt([
              {
                type: 'confirm',
                name: 'continue',
                message: 'Continue with another action?',
                default: true,
              },
            ])
            .then((answers) => {
              exit = !answers.continue;
            });
        }
      }

      console.log('\n' + chalk.bold.yellow('👋 Thank you for using Hive Mind!'));
    } catch (error) {
      console.error(formatError('Wizard error: ' + (error as Error).message));
      process.exit(1);
    }
  });

async function showIntro() {
  console.clear();
  const title = figlet.textSync('Hive Mind', {
    font: 'Big',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });

  console.log(gradient.rainbow(title));
  console.log(chalk.bold.yellow('\n🐝 Welcome to the Hive Mind Interactive Wizard! 🐝\n'));
  console.log(chalk.gray('Collective intelligence for autonomous task orchestration\n'));

  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function selectAction(): Promise<WizardAction> {
  const db = await DatabaseManager.getInstance();
  const activeSwarm = await db.getActiveSwarmId();

  console.log('\n' + chalk.bold('🎯 What would you like to do?'));
  if (activeSwarm) {
    console.log(chalk.gray(`Active swarm: ${activeSwarm}`));
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Select an action:',
      choices: [
        { name: '🆕 Create New Swarm', value: 'create_swarm' },
        { name: '🤖 Manage Agents', value: 'manage_agents', disabled: !activeSwarm },
        { name: '📋 Submit Task', value: 'submit_task', disabled: !activeSwarm },
        { name: '📊 View Status', value: 'view_status', disabled: !activeSwarm },
        { name: '💾 Configure Memory', value: 'configure_memory', disabled: !activeSwarm },
        { name: '🎮 Run Simulation', value: 'run_simulation', disabled: !activeSwarm },
        { name: '📤 Export Data', value: 'export_data', disabled: !activeSwarm },
        { name: '🔄 Switch Swarm', value: 'switch_swarm' },
        new inquirer.Separator(),
        { name: '🚪 Exit', value: 'exit' },
      ],
    },
  ]);

  return action;
}

async function createSwarmWizard() {
  console.log('\n' + chalk.bold('🆕 Create New Hive Mind Swarm'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Swarm name:',
      default: `hive-mind-${Date.now()}`,
      validate: (input) => input.length > 0 || 'Name is required',
    },
    {
      type: 'list',
      name: 'topology',
      message: 'Select swarm topology:',
      choices: [
        { name: '🏛️ Hierarchical - Queen-led with clear command structure', value: 'hierarchical' },
        { name: '🕸️ Mesh - Fully connected peer-to-peer network', value: 'mesh' },
        { name: '🔄 Ring - Circular communication pattern', value: 'ring' },
        { name: '⭐ Star - Central hub with radiating connections', value: 'star' },
      ],
    },
    {
      type: 'list',
      name: 'queenMode',
      message: 'Queen coordination mode:',
      choices: [
        { name: '👑 Centralized - Single Queen controls all decisions', value: 'centralized' },
        { name: '🤝 Distributed - Multiple Queens share leadership', value: 'distributed' },
      ],
    },
    {
      type: 'number',
      name: 'maxAgents',
      message: 'Maximum number of agents:',
      default: 8,
      validate: (input) => (input > 0 && input <= 100) || 'Must be between 1 and 100',
    },
    {
      type: 'number',
      name: 'consensusThreshold',
      message: 'Consensus threshold (0.5 - 1.0):',
      default: 0.66,
      validate: (input) => (input >= 0.5 && input <= 1.0) || 'Must be between 0.5 and 1.0',
    },
    {
      type: 'confirm',
      name: 'autoSpawn',
      message: 'Auto-spawn initial agents?',
      default: true,
    },
  ]);

  // Advanced options
  const { showAdvanced } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'showAdvanced',
      message: 'Configure advanced options?',
      default: false,
    },
  ]);

  if (showAdvanced) {
    const advanced = await inquirer.prompt([
      {
        type: 'number',
        name: 'memoryTTL',
        message: 'Default memory TTL (seconds):',
        default: 86400,
      },
      {
        type: 'checkbox',
        name: 'enabledFeatures',
        message: 'Enable features:',
        choices: [
          { name: 'Neural Learning', value: 'neural', checked: true },
          { name: 'Performance Monitoring', value: 'monitoring', checked: true },
          { name: 'Auto-scaling', value: 'autoscale', checked: false },
          { name: 'Fault Tolerance', value: 'faultTolerance', checked: true },
          { name: 'Predictive Task Assignment', value: 'predictive', checked: false },
        ],
      },
    ]);

    Object.assign(answers, advanced);
  }

  // Create swarm
  const spinner = require('ora')('Creating Hive Mind swarm...').start();

  try {
    const hiveMind = new HiveMind({
      name: answers.name,
      topology: answers.topology,
      maxAgents: answers.maxAgents,
      queenMode: answers.queenMode,
      memoryTTL: answers.memoryTTL || 86400,
      consensusThreshold: answers.consensusThreshold,
      autoSpawn: answers.autoSpawn,
      enabledFeatures: answers.enabledFeatures || ['neural', 'monitoring', 'faultTolerance'],
      createdAt: new Date(),
    });

    const swarmId = await hiveMind.initialize();

    spinner.succeed(formatSuccess('Hive Mind created successfully!'));
    console.log(formatInfo(`Swarm ID: ${swarmId}`));

    if (answers.autoSpawn) {
      const agents = await hiveMind.autoSpawnAgents();
      console.log(formatSuccess(`Spawned ${agents.length} initial agents`));
    }
  } catch (error) {
    spinner.fail(formatError('Failed to create swarm'));
    throw error;
  }
}

async function manageAgentsWizard() {
  console.log('\n' + chalk.bold('🤖 Manage Agents'));

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '➕ Spawn New Agent', value: 'spawn' },
        { name: '📊 View Agent List', value: 'list' },
        { name: '🔧 Modify Agent', value: 'modify' },
        { name: '🗑️ Remove Agent', value: 'remove' },
        { name: '🔄 Rebalance Agents', value: 'rebalance' },
      ],
    },
  ]);

  const db = await DatabaseManager.getInstance();
  const swarmId = await db.getActiveSwarmId();
  const hiveMind = await HiveMind.load(swarmId!);

  switch (action) {
    case 'spawn':
      await spawnAgentInteractive(hiveMind);
      break;
    case 'list':
      await listAgentsInteractive(hiveMind);
      break;
    case 'modify':
      await modifyAgentInteractive(hiveMind);
      break;
    case 'remove':
      await removeAgentInteractive(hiveMind);
      break;
    case 'rebalance':
      await rebalanceAgentsInteractive(hiveMind);
      break;
  }
}

async function spawnAgentInteractive(hiveMind: HiveMind) {
  const agentTypes = [
    { name: '🎯 Coordinator - Task management and delegation', value: 'coordinator' },
    { name: '🔬 Researcher - Information gathering and analysis', value: 'researcher' },
    { name: '💻 Coder - Code generation and implementation', value: 'coder' },
    { name: '📊 Analyst - Data analysis and insights', value: 'analyst' },
    { name: '🏗️ Architect - System design and planning', value: 'architect' },
    { name: '🧪 Tester - Quality assurance and testing', value: 'tester' },
    { name: '👁️ Reviewer - Code and design review', value: 'reviewer' },
    { name: '⚡ Optimizer - Performance optimization', value: 'optimizer' },
    { name: '📝 Documenter - Documentation generation', value: 'documenter' },
    { name: '📡 Monitor - System monitoring and alerts', value: 'monitor' },
    { name: '🎨 Specialist - Custom specialized agent', value: 'specialist' },
  ];

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'Select agent type:',
      choices: agentTypes,
    },
    {
      type: 'input',
      name: 'name',
      message: 'Agent name (optional):',
      default: (answers: any) => `${answers.type}-${Date.now()}`,
    },
    {
      type: 'number',
      name: 'count',
      message: 'How many agents to spawn?',
      default: 1,
      validate: (input) => (input > 0 && input <= 10) || 'Must be between 1 and 10',
    },
  ]);

  const spinner = require('ora')(`Spawning ${answers.count} ${answers.type} agent(s)...`).start();

  try {
    const agents = [];
    for (let i = 0; i < answers.count; i++) {
      const agent = await hiveMind.spawnAgent({
        type: answers.type,
        name: answers.count > 1 ? `${answers.name}-${i}` : answers.name,
      });
      agents.push(agent);
    }

    spinner.succeed(formatSuccess(`Spawned ${agents.length} agent(s) successfully!`));
  } catch (error) {
    spinner.fail(formatError('Failed to spawn agents'));
    throw error;
  }
}

async function submitTaskWizard() {
  console.log('\n' + chalk.bold('📋 Submit Task to Hive Mind'));

  const db = await DatabaseManager.getInstance();
  const swarmId = await db.getActiveSwarmId();
  const hiveMind = await HiveMind.load(swarmId!);

  const templates = [
    { name: '🔍 Research Task', value: 'research' },
    { name: '💻 Development Task', value: 'development' },
    { name: '📊 Analysis Task', value: 'analysis' },
    { name: '🧪 Testing Task', value: 'testing' },
    { name: '📝 Documentation Task', value: 'documentation' },
    { name: '✏️ Custom Task', value: 'custom' },
  ];

  const { template } = await inquirer.prompt([
    {
      type: 'list',
      name: 'template',
      message: 'Select task template:',
      choices: templates,
    },
  ]);

  let taskDescription = '';
  const taskConfig: any = {};

  if (template === 'custom') {
    const answers = await inquirer.prompt([
      {
        type: 'editor',
        name: 'description',
        message: 'Enter task description:',
      },
    ]);
    taskDescription = answers.description;
  } else {
    // Use predefined templates
    const templates = {
      research: {
        prompt: 'What would you like to research?',
        prefix: 'Research and analyze: ',
      },
      development: {
        prompt: 'What would you like to develop?',
        prefix: 'Develop and implement: ',
      },
      analysis: {
        prompt: 'What would you like to analyze?',
        prefix: 'Analyze and provide insights on: ',
      },
      testing: {
        prompt: 'What would you like to test?',
        prefix: 'Test and validate: ',
      },
      documentation: {
        prompt: 'What would you like to document?',
        prefix: 'Create documentation for: ',
      },
    };

    const tmpl = templates[template as keyof typeof templates];
    const { detail } = await inquirer.prompt([
      {
        type: 'input',
        name: 'detail',
        message: tmpl.prompt,
      },
    ]);

    taskDescription = tmpl.prefix + detail;
  }

  // Task configuration
  const config = await inquirer.prompt([
    {
      type: 'list',
      name: 'priority',
      message: 'Task priority:',
      choices: [
        { name: '🟢 Low', value: 'low' },
        { name: '🟡 Medium', value: 'medium' },
        { name: '🟠 High', value: 'high' },
        { name: '🔴 Critical', value: 'critical' },
      ],
      default: 'medium',
    },
    {
      type: 'list',
      name: 'strategy',
      message: 'Execution strategy:',
      choices: [
        { name: '🤖 Adaptive (AI-optimized)', value: 'adaptive' },
        { name: '⚡ Parallel (Multiple agents)', value: 'parallel' },
        { name: '📍 Sequential (Step-by-step)', value: 'sequential' },
        { name: '🤝 Consensus (Requires agreement)', value: 'consensus' },
      ],
      default: 'adaptive',
    },
    {
      type: 'confirm',
      name: 'monitor',
      message: 'Monitor task progress?',
      default: true,
    },
  ]);

  const spinner = require('ora')('Submitting task...').start();

  try {
    const task = await hiveMind.submitTask({
      description: taskDescription,
      priority: config.priority,
      strategy: config.strategy,
    });

    spinner.succeed(formatSuccess('Task submitted successfully!'));
    console.log(formatInfo(`Task ID: ${task.id}`));

    if (config.monitor) {
      console.log('\n' + chalk.bold('Monitoring task progress...'));
      // TODO: Implement real-time monitoring
    }
  } catch (error) {
    spinner.fail(formatError('Failed to submit task'));
    throw error;
  }
}

async function viewStatusWizard() {
  const { view } = await inquirer.prompt([
    {
      type: 'list',
      name: 'view',
      message: 'What would you like to view?',
      choices: [
        { name: '📊 Overall Status', value: 'overall' },
        { name: '🤖 Agent Details', value: 'agents' },
        { name: '📋 Task Queue', value: 'tasks' },
        { name: '💾 Memory Usage', value: 'memory' },
        { name: '📈 Performance Metrics', value: 'performance' },
        { name: '📡 Communications', value: 'communications' },
      ],
    },
  ]);

  // Execute the status command with appropriate flags
  const statusCmd = require('./status').statusCommand;
  const args = ['status'];

  switch (view) {
    case 'agents':
      args.push('--detailed');
      break;
    case 'tasks':
      args.push('--tasks');
      break;
    case 'memory':
      args.push('--memory');
      break;
    case 'performance':
      args.push('--performance');
      break;
  }

  await statusCmd.parseAsync(args);
}

// Helper functions for other wizard actions
async function listAgentsInteractive(hiveMind: HiveMind) {
  const agents = await hiveMind.getAgents();

  console.log('\n' + chalk.bold('🤖 Agent List:'));
  agents.forEach((agent) => {
    const statusEmoji = agent.status === 'busy' ? '🔴' : '🟢';
    console.log(`${statusEmoji} ${agent.name} (${agent.type}) - ${agent.status}`);
  });
}

async function modifyAgentInteractive(hiveMind: HiveMind) {
  // Implementation for modifying agents
  console.log(formatInfo('Agent modification coming soon...'));
}

async function removeAgentInteractive(hiveMind: HiveMind) {
  // Implementation for removing agents
  console.log(formatInfo('Agent removal coming soon...'));
}

async function rebalanceAgentsInteractive(hiveMind: HiveMind) {
  const spinner = require('ora')('Rebalancing agents...').start();

  try {
    await hiveMind.rebalanceAgents();
    spinner.succeed(formatSuccess('Agents rebalanced successfully!'));
  } catch (error) {
    spinner.fail(formatError('Failed to rebalance agents'));
    throw error;
  }
}

async function configureMemoryWizard() {
  console.log(formatInfo('Memory configuration coming soon...'));
}

async function runSimulationWizard() {
  console.log(formatInfo('Simulation mode coming soon...'));
}

async function exportDataWizard() {
  console.log(formatInfo('Data export coming soon...'));
}

async function switchSwarmWizard() {
  const db = await DatabaseManager.getInstance();
  const swarms = await db.getAllSwarms();

  if (swarms.length === 0) {
    console.log(formatWarning('No swarms found. Create one first!'));
    return;
  }

  const { swarmId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'swarmId',
      message: 'Select swarm:',
      choices: swarms.map((s) => ({
        name: `${s.name} (${s.topology}) - ${s.agentCount} agents`,
        value: s.id,
      })),
    },
  ]);

  await db.setActiveSwarm(swarmId);
  console.log(formatSuccess('Switched to swarm: ' + swarmId));
}
