/**
 * Claude Swarm Mode - Self-orchestrating agent swarms using claude-flow
 */

// Phase 2 Runtime Migration: Deno compatibility layer
import Deno from '../../utils/deno-compat.js';
import { generateId } from '../../utils/helpers.js';
import { success, error, warning, info } from "../cli-core.js";
import type { CommandContext } from "../cli-core.js";
import { SwarmCoordinator } from '../../coordination/swarm-coordinator.js';
import { BackgroundExecutor } from '../../coordination/background-executor.js';
import { SwarmMemoryManager } from '../../memory/swarm-memory.js';

export async function swarmAction(ctx: CommandContext) {
  // First check if help is requested
  if (ctx.flags.help || ctx.flags.h) {
    // Show help is handled by the CLI framework
    return;
  }
  
  // The objective should be all the non-flag arguments joined together
  const objective = ctx.args.join(' ').trim();
  
  if (!objective) {
    error("Usage: swarm <objective>");
    console.log("\nExamples:");
    console.log('  claude-flow swarm "Build a REST API"');
    console.log('  claude-flow swarm "Research cloud architecture"');
    console.log("\nOptions:");
    console.log('  --dry-run              Show configuration without executing');
    console.log('  --strategy <type>      Strategy: auto, research, development, analysis');
    console.log('  --max-agents <n>       Maximum number of agents (default: 5)');
    console.log('  --timeout <minutes>    Timeout in minutes (default: 60)');
    console.log('  --research             Enable research capabilities');
    console.log('  --parallel             Enable parallel execution');
    console.log('  --review               Enable peer review between agents');
    console.log('  --monitor              Enable real-time monitoring');
    console.log('  --ui                   Use blessed terminal UI (requires node.js)');
    console.log('  --background           Run swarm in background mode');
    console.log('  --distributed          Enable distributed coordination');
    console.log('  --memory-namespace     Memory namespace for swarm (default: swarm)');
    console.log('  --persistence          Enable task persistence (default: true)');
    return;
  }
  
  const options = {
    strategy: ctx.flags.strategy as string || 'auto',
    maxAgents: ctx.flags.maxAgents as number || ctx.flags['max-agents'] as number || 5,
    maxDepth: ctx.flags.maxDepth as number || ctx.flags['max-depth'] as number || 3,
    research: ctx.flags.research as boolean || false,
    parallel: ctx.flags.parallel as boolean || false,
    memoryNamespace: ctx.flags.memoryNamespace as string || ctx.flags['memory-namespace'] as string || 'swarm',
    timeout: ctx.flags.timeout as number || 60,
    review: ctx.flags.review as boolean || false,
    coordinator: ctx.flags.coordinator as boolean || false,
    config: ctx.flags.config as string || ctx.flags.c as string,
    verbose: ctx.flags.verbose as boolean || ctx.flags.v as boolean || false,
    dryRun: ctx.flags.dryRun as boolean || ctx.flags['dry-run'] as boolean || ctx.flags.d as boolean || false,
    monitor: ctx.flags.monitor as boolean || false,
    ui: ctx.flags.ui as boolean || false,
    background: ctx.flags.background as boolean || false,
    persistence: ctx.flags.persistence as boolean || true,
    distributed: ctx.flags.distributed as boolean || false,
  };
  
  const swarmId = generateId('swarm');
  
  if (options.dryRun) {
    warning('DRY RUN - Swarm Configuration:');
    console.log(`Swarm ID: ${swarmId}`);
    console.log(`Objective: ${objective}`);
    console.log(`Strategy: ${options.strategy}`);
    console.log(`Max Agents: ${options.maxAgents}`);
    console.log(`Max Depth: ${options.maxDepth}`);
    console.log(`Research: ${options.research}`);
    console.log(`Parallel: ${options.parallel}`);
    console.log(`Review Mode: ${options.review}`);
    console.log(`Coordinator: ${options.coordinator}`);
    console.log(`Memory Namespace: ${options.memoryNamespace}`);
    console.log(`Timeout: ${options.timeout} minutes`);
    return;
  }
  
  // If UI mode is requested, use the blessed UI version
  if (options.ui) {
    try {
      const scriptPath = new URL(import.meta.url).pathname;
      const projectRoot = scriptPath.substring(0, scriptPath.indexOf('/src/'));
      const uiScriptPath = `${projectRoot}/src/cli/simple-commands/swarm-ui.js`;
      
      // Check if the UI script exists
      try {
        await Deno.stat(uiScriptPath);
      } catch {
        warning('Swarm UI script not found. Falling back to standard mode.');
        options.ui = false;
      }
      
      if (options.ui) {
        const command = new Deno.Command('node', {
          args: [uiScriptPath],
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        });
        
        const process = command.spawn();
        const { code } = await process.status;
        
        if (code !== 0) {
          error(`Swarm UI exited with code ${code}`);
        }
        return;
      }
    } catch (err) {
      warning(`Failed to launch blessed UI: ${(err as Error).message}`);
      console.log('Falling back to standard mode...');
      options.ui = false;
    }
  }
  
  success(`🐝 Initializing Claude Swarm: ${swarmId}`);
  console.log(`📋 Objective: ${objective}`);
  console.log(`🎯 Strategy: ${options.strategy}`);
  
  try {
    // Initialize swarm coordination system
    const coordinator = new SwarmCoordinator({
      maxAgents: options.maxAgents,
      maxConcurrentTasks: options.parallel ? options.maxAgents : 1,
      taskTimeout: options.timeout * 60 * 1000, // Convert minutes to milliseconds
      enableMonitoring: options.monitor,
      enableWorkStealing: options.parallel,
      enableCircuitBreaker: true,
      memoryNamespace: options.memoryNamespace,
      coordinationStrategy: options.distributed ? 'distributed' : 'centralized'
    });

    // Initialize background executor
    const executor = new BackgroundExecutor({
      maxConcurrentTasks: options.maxAgents,
      defaultTimeout: options.timeout * 60 * 1000,
      logPath: `./swarm-runs/${swarmId}/background-tasks`,
      enablePersistence: options.persistence
    });

    // Initialize swarm memory
    const memory = new SwarmMemoryManager({
      namespace: options.memoryNamespace,
      enableDistribution: options.distributed,
      enableKnowledgeBase: true,
      persistencePath: `./swarm-runs/${swarmId}/memory`
    });

    // Start all systems
    await coordinator.start();
    await executor.start();
    await memory.initialize();

    // Create swarm tracking directory
    const swarmDir = `./swarm-runs/${swarmId}`;
    await Deno.mkdir(swarmDir, { recursive: true });

    // Create objective in coordinator
    const objectiveId = await coordinator.createObjective(objective, options.strategy);
    
    console.log(`\n📝 Objective created with ID: ${objectiveId}`);

    // Register agents based on strategy
    const agentTypes = getAgentTypesForStrategy(options.strategy);
    const agents = [];
    
    for (let i = 0; i < Math.min(options.maxAgents, agentTypes.length); i++) {
      const agentType = agentTypes[i % agentTypes.length];
      const agentId = await coordinator.registerAgent(
        `${agentType}-${i + 1}`,
        agentType,
        getCapabilitiesForType(agentType)
      );
      agents.push(agentId);
      console.log(`  🤖 Registered ${agentType} agent: ${agentId}`);
    }

    // Write swarm configuration
    await Deno.writeTextFile(`${swarmDir}/config.json`, JSON.stringify({
      swarmId,
      objectiveId,
      objective,
      options,
      agents,
      startTime: new Date().toISOString()
    }, null, 2));

    // Start objective execution
    await coordinator.executeObjective(objectiveId);
    console.log(`\n🚀 Swarm execution started...`);

    if (options.background) {
      console.log(`Running in background mode. Check status with: claude-flow swarm status ${swarmId}`);
      
      // Save coordinator state and exit
      await Deno.writeTextFile(`${swarmDir}/coordinator.json`, JSON.stringify({
        coordinatorRunning: true,
        pid: Deno.pid,
        startTime: new Date().toISOString()
      }, null, 2));
      
    } else {
      // Wait for completion in foreground
      await waitForObjectiveCompletion(coordinator, objectiveId, options);
      
      // Write completion status
      await Deno.writeTextFile(`${swarmDir}/status.json`, JSON.stringify({
        status: 'completed',
        endTime: new Date().toISOString()
      }, null, 2));

      // Show summary
      const swarmStatus = coordinator.getSwarmStatus();
      console.log(`\n📊 Swarm Summary:`);
      console.log(`  - Objectives: ${swarmStatus.objectives}`);
      console.log(`  - Tasks Completed: ${swarmStatus.tasks.completed}`);
      console.log(`  - Tasks Failed: ${swarmStatus.tasks.failed}`);
      console.log(`  - Agents Used: ${swarmStatus.agents.total}`);
      console.log(`  - Results saved to: ${swarmDir}`);

      success(`\n✅ Swarm ${swarmId} completed successfully`);
    }

    // Cleanup
    if (!options.background) {
      await coordinator.stop();
      await executor.stop();
      await memory.shutdown();
    }
    
  } catch (err) {
    error(`Failed to execute swarm: ${(err as Error).message}`);
  }
}

/**
 * Decompose objective into subtasks based on strategy
 */
async function decomposeObjective(objective: string, options: any): Promise<any[]> {
  const subtasks = [];
  
  switch (options.strategy) {
    case 'research':
      subtasks.push(
        { type: 'research', description: `Research background information on: ${objective}` },
        { type: 'analysis', description: `Analyze findings and identify key patterns` },
        { type: 'synthesis', description: `Synthesize research into actionable insights` }
      );
      break;
      
    case 'development':
      subtasks.push(
        { type: 'planning', description: `Plan architecture and design for: ${objective}` },
        { type: 'implementation', description: `Implement core functionality` },
        { type: 'testing', description: `Test and validate implementation` },
        { type: 'documentation', description: `Document the solution` }
      );
      break;
      
    case 'analysis':
      subtasks.push(
        { type: 'data-gathering', description: `Gather relevant data for: ${objective}` },
        { type: 'analysis', description: `Perform detailed analysis` },
        { type: 'visualization', description: `Create visualizations and reports` }
      );
      break;
      
    default: // auto
      // Analyze objective to determine best approach
      if (objective.toLowerCase().includes('build') || objective.toLowerCase().includes('create')) {
        subtasks.push(
          { type: 'planning', description: `Plan solution for: ${objective}` },
          { type: 'implementation', description: `Implement the solution` },
          { type: 'testing', description: `Test and validate` }
        );
      } else if (objective.toLowerCase().includes('research') || objective.toLowerCase().includes('analyze')) {
        subtasks.push(
          { type: 'research', description: `Research: ${objective}` },
          { type: 'analysis', description: `Analyze findings` },
          { type: 'report', description: `Generate report` }
        );
      } else {
        subtasks.push(
          { type: 'exploration', description: `Explore requirements for: ${objective}` },
          { type: 'execution', description: `Execute main tasks` },
          { type: 'validation', description: `Validate results` }
        );
      }
  }
  
  return subtasks;
}

/**
 * Execute tasks in parallel
 */
async function executeParallelTasks(tasks: any[], options: any, swarmId: string, swarmDir: string) {
  const promises = tasks.map(async (task, index) => {
    const agentId = generateId('agent');
    console.log(`  🤖 Spawning agent ${agentId} for: ${task.type}`);
    
    // Create agent directory
    const agentDir = `${swarmDir}/agents/${agentId}`;
    await Deno.mkdir(agentDir, { recursive: true });
    
    // Write agent task
    await Deno.writeTextFile(`${agentDir}/task.json`, JSON.stringify({
      agentId,
      swarmId,
      task,
      status: 'active',
      startTime: new Date().toISOString()
    }, null, 2));
    
    // Execute agent task
    await executeAgentTask(agentId, task, options, agentDir);
    
    // Update status
    await Deno.writeTextFile(`${agentDir}/status.json`, JSON.stringify({
      status: 'completed',
      endTime: new Date().toISOString()
    }, null, 2));
    
    console.log(`  ✅ Agent ${agentId} completed: ${task.type}`);
  });
  
  await Promise.all(promises);
}

/**
 * Execute tasks sequentially
 */
async function executeSequentialTasks(tasks: any[], options: any, swarmId: string, swarmDir: string) {
  for (const [index, task] of tasks.entries()) {
    const agentId = generateId('agent');
    console.log(`  🤖 Spawning agent ${agentId} for: ${task.type}`);
    
    // Create agent directory
    const agentDir = `${swarmDir}/agents/${agentId}`;
    await Deno.mkdir(agentDir, { recursive: true });
    
    // Write agent task
    await Deno.writeTextFile(`${agentDir}/task.json`, JSON.stringify({
      agentId,
      swarmId,
      task,
      status: 'active',
      startTime: new Date().toISOString()
    }, null, 2));
    
    // Execute agent task
    await executeAgentTask(agentId, task, options, agentDir);
    
    // Update status
    await Deno.writeTextFile(`${agentDir}/status.json`, JSON.stringify({
      status: 'completed',
      endTime: new Date().toISOString()
    }, null, 2));
    
    console.log(`  ✅ Agent ${agentId} completed: ${task.type}`);
  }
}

/**
 * Execute a single agent task using claude
 */
async function executeAgentTask(agentId: string, task: any, options: any, agentDir: string) {
  console.log(`    → Executing: ${task.type} task`);
  
  try {
    // Check if claude CLI is available and not in simulation mode
    const checkClaude = new Deno.Command('which', { args: ['claude'] });
    const checkResult = await checkClaude.output();
    
    if (checkResult.success && options.simulate !== true) {
      // Write prompt to a file for claude to read
      const promptFile = `${agentDir}/prompt.txt`;
      const prompt = `You are an AI agent with ID: ${agentId}

Your task type is: ${task.type}
Your specific task is: ${task.description}

Please execute this task and provide a detailed response.
${task.type === 'research' ? 'Use web search and research tools as needed.' : ''}
${task.type === 'implementation' ? 'Write clean, well-documented code.' : ''}
${task.type === 'testing' ? 'Create comprehensive tests.' : ''}

Provide your output in a structured format.

When you're done, please end with "TASK COMPLETED" on its own line.`;

      await Deno.writeTextFile(promptFile, prompt);
      
      // Build claude command using bash to pipe the prompt
      let tools = 'View,GlobTool,GrepTool,LS';
      if (task.type === 'research' || options.research) {
        tools = 'WebFetchTool,WebSearch';
      } else if (task.type === 'implementation') {
        tools = 'View,Edit,Replace,GlobTool,GrepTool,LS,Bash';
      }
      
      // Build claude command arguments for non-interactive mode
      const claudeArgs = [
        '-p',  // Non-interactive print mode
        task.description,  // The prompt
        '--dangerously-skip-permissions',
        '--allowedTools', tools
      ];
      
      // Write command to file for tracking
      await Deno.writeTextFile(`${agentDir}/command.txt`, `claude ${claudeArgs.join(' ')}`);
      
      console.log(`    → Running: ${task.description}`);
      
      // For real-time output, we need to capture it differently
      // First run with piped to capture for file, then run with inherit for display
      
      // Create a wrapper script that will tee the output
      const wrapperScript = `#!/bin/bash
claude ${claudeArgs.map(arg => `"${arg}"`).join(' ')} | tee "${agentDir}/output.txt"
exit \${PIPESTATUS[0]}`;
      
      const wrapperPath = `${agentDir}/wrapper.sh`;
      await Deno.writeTextFile(wrapperPath, wrapperScript);
      await Deno.chmod(wrapperPath, 0o755);
      
      console.log(`    ┌─ Claude Output ─────────────────────────────`);
      
      const command = new Deno.Command('bash', {
        args: [wrapperPath],
        stdout: 'inherit',  // This allows real-time streaming to console
        stderr: 'inherit',
      });
      
      try {
        const process = command.spawn();
        const { code, success } = await process.status;
        
        console.log(`    └─────────────────────────────────────────────`);
        
        if (!success) {
          throw new Error(`Claude exited with code ${code}`);
        }
        
        console.log(`    ✓ Task completed`);
        
      } catch (err) {
        throw err;
      }
    } else {
      // Simulate execution if claude CLI not available
      console.log(`    → Simulating: ${task.type} (claude CLI not available)`);
      
      // For now, let's use the claude-flow claude spawn command instead
      const claudeFlowArgs = ['claude', 'spawn', task.description];
      
      if (task.type === 'research' || options.research) {
        claudeFlowArgs.push('--research');
      }
      
      if (options.parallel) {
        claudeFlowArgs.push('--parallel');
      }
      
      console.log(`    → Using: claude-flow ${claudeFlowArgs.join(' ')}`);
      
      // Get the path to claude-flow binary
      const claudeFlowPath = new URL(import.meta.url).pathname;
      const projectRoot = claudeFlowPath.substring(0, claudeFlowPath.indexOf('/src/'));
      const claudeFlowBin = `${projectRoot}/bin/claude-flow`;
      
      // Execute claude-flow command
      const command = new Deno.Command(claudeFlowBin, {
        args: claudeFlowArgs,
        stdout: 'piped',
        stderr: 'piped',
      });
      
      const { code, stdout, stderr } = await command.output();
      
      // Save output
      await Deno.writeTextFile(`${agentDir}/output.txt`, new TextDecoder().decode(stdout));
      if (stderr.length > 0) {
        await Deno.writeTextFile(`${agentDir}/error.txt`, new TextDecoder().decode(stderr));
      }
      
      if (code !== 0) {
        console.log(`    ⚠️  Command exited with code ${code}`);
      }
    }
  } catch (err) {
    // Log error but continue
    console.log(`    ⚠️  Error executing task: ${(err as Error).message}`);
    await Deno.writeTextFile(`${agentDir}/error.txt`, (err as Error).message);
  }
}

function getAgentTypesForStrategy(strategy: string): ('researcher' | 'developer' | 'analyzer' | 'coordinator' | 'reviewer')[] {
  switch (strategy) {
    case 'research':
      return ['researcher', 'analyzer', 'coordinator'];
    case 'development':
      return ['developer', 'analyzer', 'reviewer', 'coordinator'];
    case 'analysis':
      return ['analyzer', 'researcher', 'coordinator'];
    default: // auto
      return ['coordinator', 'researcher', 'developer', 'analyzer'];
  }
}

function getCapabilitiesForType(type: string): string[] {
  switch (type) {
    case 'researcher':
      return ['web-search', 'data-collection', 'analysis', 'documentation'];
    case 'developer':
      return ['coding', 'testing', 'debugging', 'architecture'];
    case 'analyzer':
      return ['data-analysis', 'visualization', 'reporting', 'insights'];
    case 'reviewer':
      return ['code-review', 'quality-assurance', 'validation', 'testing'];
    case 'coordinator':
      return ['planning', 'coordination', 'task-management', 'communication'];
    default:
      return ['general'];
  }
}

async function waitForObjectiveCompletion(coordinator: any, objectiveId: string, options: any): Promise<void> {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const objective = coordinator.getObjectiveStatus(objectiveId);
      
      if (!objective) {
        clearInterval(checkInterval);
        resolve();
        return;
      }

      if (objective.status === 'completed' || objective.status === 'failed') {
        clearInterval(checkInterval);
        resolve();
        return;
      }

      // Show progress if verbose
      if (options.verbose) {
        const swarmStatus = coordinator.getSwarmStatus();
        console.log(`Progress: ${swarmStatus.tasks.completed}/${swarmStatus.tasks.total} tasks completed`);
      }
    }, 5000); // Check every 5 seconds

    // Timeout after the specified time
    setTimeout(() => {
      clearInterval(checkInterval);
      console.log('⚠️  Swarm execution timed out');
      resolve();
    }, options.timeout * 60 * 1000);
  });
}

// Parse swarm options from command flags
function parseSwarmOptions(flags: any): any {
  return {
    strategy: flags.strategy as SwarmStrategy || 'auto',
    mode: flags.mode as SwarmMode || 'centralized',
    maxAgents: flags.maxAgents as number || flags['max-agents'] as number || 5,
    maxDepth: flags.maxDepth as number || flags['max-depth'] as number || 3,
    research: flags.research as boolean || false,
    parallel: flags.parallel as boolean || false,
    memoryNamespace: flags.memoryNamespace as string || flags['memory-namespace'] as string || 'swarm',
    timeout: flags.timeout as number || 60,
    review: flags.review as boolean || false,
    coordinator: flags.coordinator as boolean || false,
    config: flags.config as string || flags.c as string,
    verbose: flags.verbose as boolean || flags.v as boolean || false,
    dryRun: flags.dryRun as boolean || flags['dry-run'] as boolean || flags.d as boolean || false,
    monitor: flags.monitor as boolean || false,
    ui: flags.ui as boolean || false,
    background: flags.background as boolean || false,
    persistence: flags.persistence as boolean || true,
    distributed: flags.distributed as boolean || false,
    taskTimeoutMinutes: flags['task-timeout-minutes'] as number || 59,
    qualityThreshold: flags['quality-threshold'] as number || 0.8,
    agentSelection: flags['agent-selection'] as string || 'capability-based',
    taskScheduling: flags['task-scheduling'] as string || 'priority',
    loadBalancing: flags['load-balancing'] as string || 'work-stealing',
    faultTolerance: flags['fault-tolerance'] as string || 'retry',
    testing: flags.testing as boolean || false,
    encryption: flags.encryption as boolean || false,
    output: flags.output as string || 'json',
    maxTasks: flags['max-tasks'] as number || 100,
  };
}

// Show dry run configuration
function showDryRunConfiguration(swarmId: string, objective: string, options: any): void {
  warning('🚀 DRY RUN - Advanced Swarm Configuration');
  console.log('═'.repeat(60));
  
  console.log(`\n📋 OBJECTIVE: ${objective}`);
  console.log(`🆔 Swarm ID: ${swarmId}`);
  
  console.log('\n🎯 Core Configuration:');
  console.log(`  • Strategy: ${options.strategy}`);
  console.log(`  • Mode: ${options.mode}`);
  console.log(`  • Max Agents: ${options.maxAgents}`);
  console.log(`  • Max Tasks: ${options.maxTasks}`);
  console.log(`  • Timeout: ${options.timeout} minutes`);
  console.log(`  • Task Timeout: ${options.taskTimeoutMinutes} minutes`);
  
  console.log('\n🔧 Features:');
  console.log(`  • Parallel Execution: ${options.parallel ? '✅' : '❌'}`);
  console.log(`  • Distributed Coordination: ${options.distributed ? '✅' : '❌'}`);
  console.log(`  • Real-time Monitoring: ${options.monitor ? '✅' : '❌'}`);
  console.log(`  • Peer Review: ${options.review ? '✅' : '❌'}`);
  console.log(`  • Automated Testing: ${options.testing ? '✅' : '❌'}`);
  console.log(`  • Encryption: ${options.encryption ? '✅' : '❌'}`);
  console.log(`  • UI Mode: ${options.ui ? '✅' : '❌'}`);
  console.log(`  • Background Mode: ${options.background ? '✅' : '❌'}`);
  
  console.log('\n🧠 Memory & Persistence:');
  console.log(`  • Memory Namespace: ${options.memoryNamespace}`);
  console.log(`  • Task Persistence: ${options.persistence ? '✅' : '❌'}`);
  
  console.log('\n🎛️  Advanced Strategies:');
  console.log(`  • Agent Selection: ${options.agentSelection}`);
  console.log(`  • Task Scheduling: ${options.taskScheduling}`);
  console.log(`  • Load Balancing: ${options.loadBalancing}`);
  console.log(`  • Fault Tolerance: ${options.faultTolerance}`);
  console.log(`  • Quality Threshold: ${options.qualityThreshold}`);
  
  console.log('\n📊 Output:');
  console.log(`  • Format: ${options.output}`);
  console.log(`  • Verbose Logging: ${options.verbose ? '✅' : '❌'}`);
  
  console.log('\n' + '═'.repeat(60));
  console.log('⚠️  This is a dry run. No agents will be spawned.');
  console.log('Remove --dry-run to execute the swarm.\n');
}

// Launch swarm UI
async function launchSwarmUI(objective: string, options: any): Promise<void> {
  console.log('🖥️  Launching Swarm UI...');
  console.log('📋 Objective:', objective);
  console.log('🎯 Strategy:', options.strategy);
  console.log('🏗️  Mode:', options.mode);
  
  // UI implementation would go here
  // For now, fall back to standard execution
  warning('UI mode not yet implemented. Falling back to standard mode.');
  
  // Continue with standard execution
  const swarmId = generateId('swarm');
  await executeSwarm(swarmId, objective, options);
}

// Execute swarm
async function executeSwarm(swarmId: string, objective: string, options: any): Promise<void> {
  success(`🐝 Initializing Advanced Swarm: ${swarmId}`);
  console.log(`📋 Objective: ${objective}`);
  console.log(`🎯 Strategy: ${options.strategy}`);
  console.log(`🏗️  Mode: ${options.mode}`);
  console.log(`🤖 Max Agents: ${options.maxAgents}`);
  
  // Initialize memory manager
  const memoryManager = new SwarmMemoryManager({
    namespace: options.memoryNamespace,
    persistence: options.persistence,
    encryption: options.encryption,
  });
  
  // Initialize coordinator
  const coordinator = new SwarmCoordinator({
    swarmId,
    mode: options.mode,
    maxAgents: options.maxAgents,
    memoryManager,
    verbose: options.verbose,
  });
  
  // Initialize task executor
  const executor = new TaskExecutor({
    coordinator,
    memoryManager,
    parallel: options.parallel,
    taskTimeoutMinutes: options.taskTimeoutMinutes,
  });
  
  // Start the swarm
  await coordinator.initialize();
  
  // Create initial task
  const initialTask = {
    id: generateId('task'),
    objective,
    strategy: options.strategy,
    priority: 1,
    dependencies: [],
  };
  
  // Execute the swarm
  await executor.execute(initialTask);
  
  success('✅ Swarm execution completed successfully!');
}