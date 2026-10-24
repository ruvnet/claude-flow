import { getErrorMessage } from '../../utils/error-handler.js';
import { promises as fs } from 'node:fs';
/**
 * Enhanced Swarm Command - Integration with new comprehensive swarm system
 */

import { SwarmCoordinator } from '../../swarm/coordinator.js';
import { TaskExecutor } from '../../swarm/executor.js';
import { SwarmMemoryManager } from '../../swarm/memory.js';
import { generateId } from '../../utils/helpers.js';
import { success, error, warning, info } from "../cli-core.js";
import type { CommandContext } from "../cli-core.js";
import type { SwarmStrategy, SwarmMode, AgentType } from '../../swarm/types.js';
import { spawn, execSync } from 'child_process';
import * as readline from 'readline';

async function launchClaudeCodeWithSwarm(objective: string, options: any): Promise<void> {
  console.log('\n🤖 Launching Claude Code with swarm configuration...\n');
  
  // Build the swarm prompt with interactive approval if requested
  let swarmPrompt = `You are orchestrating a Claude Flow Swarm with advanced MCP tool coordination.

🎯 OBJECTIVE: ${objective}

🐝 SWARM CONFIGURATION:
- Strategy: ${options.strategy}
- Mode: ${options.mode}
- Max Agents: ${options.maxAgents}
- Timeout: ${options.timeout} minutes
- Parallel Execution: ${options.parallel ? 'MANDATORY (Always use BatchTool)' : 'Optional'}
- Review Mode: ${options.review}
- Testing Mode: ${options.testing}`;

  if (options.interactive || options.approvalRequired) {
    swarmPrompt += `\n- Interactive Mode: ENABLED
- Approval Required: YES
- Reviewer: ${options.reviewer}

⚠️ INTERACTIVE APPROVAL MODE:
Before executing any changes, you MUST:
1. Present a detailed plan of all proposed changes
2. Show example code/configurations that will be created
3. Wait for explicit approval from the reviewer (${options.reviewer})
4. Only proceed with implementation after receiving "APPROVED" confirmation

If the reviewer requests modifications:
- Update the plan according to feedback
- Present the revised plan for approval
- Iterate until approved or cancelled`;
  }

  swarmPrompt += `\n
🚨 CRITICAL: PARALLEL EXECUTION IS MANDATORY! 🚨

📋 CLAUDE-FLOW SWARM BATCHTOOL INSTRUCTIONS

⚡ THE GOLDEN RULE:
If you need to do X operations, they should be in 1 message, not X messages.

🎯 MANDATORY PATTERNS FOR CLAUDE-FLOW SWARMS:

1️⃣ **SWARM INITIALIZATION** - Everything in ONE BatchTool:
\`\`\`javascript
[Single Message with Multiple Tools]:
  // Spawn ALL agents at once
  mcp__claude-flow__agent_spawn {"type": "coordinator", "name": "SwarmLead"}
  mcp__claude-flow__agent_spawn {"type": "researcher", "name": "DataAnalyst"}
  mcp__claude-flow__agent_spawn {"type": "coder", "name": "BackendDev"}
  mcp__claude-flow__agent_spawn {"type": "coder", "name": "FrontendDev"}
  mcp__claude-flow__agent_spawn {"type": "tester", "name": "QAEngineer"}
  
  // Initialize ALL memory keys
  mcp__claude-flow__memory_store {"key": "swarm/objective", "value": "${objective}"}
  mcp__claude-flow__memory_store {"key": "swarm/config", "value": ${JSON.stringify(options)}}
  
  // Create task hierarchy
  mcp__claude-flow__task_create {"name": "${objective}", "type": "parent", "id": "main"}
  mcp__claude-flow__task_create {"name": "Research Phase", "parent": "main"}
  mcp__claude-flow__task_create {"name": "Design Phase", "parent": "main"}
  mcp__claude-flow__task_create {"name": "Implementation", "parent": "main"}
  
  // Initialize comprehensive todo list
  TodoWrite {"todos": [
    {"id": "1", "content": "Initialize ${options.maxAgents} agent swarm", "status": "completed", "priority": "high"},
    {"id": "2", "content": "Analyze: ${objective}", "status": "in_progress", "priority": "high"},
    {"id": "3", "content": "Design architecture", "status": "pending", "priority": "high"},
    {"id": "4", "content": "Implement solution", "status": "pending", "priority": "high"},
    {"id": "5", "content": "Test and validate", "status": "pending", "priority": "medium"}
  ]}
\`\`\`

2️⃣ **TASK COORDINATION** - Batch ALL assignments:
\`\`\`javascript
[Single Message]:
  // Assign all tasks
  mcp__claude-flow__task_assign {"taskId": "research-1", "agentId": "researcher-1"}
  mcp__claude-flow__task_assign {"taskId": "design-1", "agentId": "architect-1"}
  mcp__claude-flow__task_assign {"taskId": "code-1", "agentId": "coder-1"}
  mcp__claude-flow__task_assign {"taskId": "code-2", "agentId": "coder-2"}
  
  // Communicate to all agents
  mcp__claude-flow__agent_communicate {"to": "all", "message": "Begin phase 1"}
  
  // Update multiple task statuses
  mcp__claude-flow__task_update {"taskId": "research-1", "status": "in_progress"}
  mcp__claude-flow__task_update {"taskId": "design-1", "status": "pending"}
\`\`\`

3️⃣ **MEMORY COORDINATION** - Store/retrieve in batches:
\`\`\`javascript
[Single Message]:
  // Store multiple findings
  mcp__claude-flow__memory_store {"key": "research/requirements", "value": {...}}
  mcp__claude-flow__memory_store {"key": "research/constraints", "value": {...}}
  mcp__claude-flow__memory_store {"key": "architecture/decisions", "value": {...}}
  
  // Retrieve related data
  mcp__claude-flow__memory_retrieve {"key": "research/*"}
  mcp__claude-flow__memory_search {"pattern": "architecture"}
\`\`\`

4️⃣ **FILE & CODE OPERATIONS** - Parallel execution:
\`\`\`javascript
[Single Message]:
  // Read multiple files
  Read {"file_path": "/src/index.js"}
  Read {"file_path": "/src/config.js"}
  Read {"file_path": "/package.json"}
  
  // Write multiple files
  Write {"file_path": "/src/api/auth.js", "content": "..."}
  Write {"file_path": "/src/api/users.js", "content": "..."}
  Write {"file_path": "/tests/auth.test.js", "content": "..."}
  
  // Update memory with results
  mcp__claude-flow__memory_store {"key": "code/api/auth", "value": "implemented"}
  mcp__claude-flow__memory_store {"key": "code/api/users", "value": "implemented"}
\`\`\`

5️⃣ **MONITORING & STATUS** - Combined checks:
\`\`\`javascript
[Single Message]:
  mcp__claude-flow__swarm_monitor {}
  mcp__claude-flow__swarm_status {}
  mcp__claude-flow__agent_list {"status": "active"}
  mcp__claude-flow__task_status {"includeCompleted": false}
  TodoRead {}
\`\`\`

❌ NEVER DO THIS (Sequential = SLOW):
\`\`\`
Message 1: mcp__claude-flow__agent_spawn
Message 2: mcp__claude-flow__agent_spawn
Message 3: TodoWrite (one todo)
Message 4: Read file
Message 5: mcp__claude-flow__memory_store
\`\`\`

✅ ALWAYS DO THIS (Batch = FAST):
\`\`\`
Message 1: [All operations in one message]
\`\`\`

💡 BATCHTOOL BEST PRACTICES:
- Group by operation type (all spawns, all reads, all writes)
- Use TodoWrite with 5-10 todos at once
- Combine file operations when analyzing codebases
- Store multiple memory items per message
- Never send more than one message for related operations

🤖 ${options.strategy.toUpperCase()} STRATEGY - INTELLIGENT TASK ANALYSIS:
The swarm will analyze "${objective}" and automatically determine the best approach.

ANALYSIS APPROACH:
1. Task Decomposition: Break down the objective into subtasks
2. Skill Matching: Identify required capabilities and expertise
3. Agent Selection: Spawn appropriate agent types based on needs
4. Workflow Design: Create optimal execution flow

MCP TOOL PATTERN:
- Start with memory_store to save the objective analysis
- Use task_create to build a hierarchical task structure
- Spawn agents with agent_spawn based on detected requirements
- Monitor with swarm_monitor and adjust strategy as needed

🎯 ${options.mode.toUpperCase()} MODE - ${options.mode === 'centralized' ? 'SINGLE COORDINATOR' : options.mode.toUpperCase()}:
${options.mode === 'centralized' ? `All decisions flow through one coordinator agent.

COORDINATION PATTERN:
- Spawn a single COORDINATOR as the first agent
- All other agents report to the coordinator
- Coordinator assigns tasks and monitors progress
- Use agent_assign for task delegation
- Use swarm_monitor for oversight

BENEFITS:
- Clear chain of command
- Consistent decision making
- Simple communication flow
- Easy progress tracking

BEST FOR:
- Small to medium projects
- Well-defined objectives
- Clear task dependencies` : `${options.mode} coordination pattern selected.`}

🤖 RECOMMENDED AGENT COMPOSITION (Auto-detected):
⚡ SPAWN ALL AGENTS IN ONE BATCH - Copy this entire block:

\`\`\`
[BatchTool - Single Message]:
  mcp__claude-flow__agent_spawn {"type": "coordinator", "name": "SwarmLead"}
  mcp__claude-flow__agent_spawn {"type": "researcher", "name": "RequirementsAnalyst"}
  mcp__claude-flow__agent_spawn {"type": "architect", "name": "SystemDesigner"}
  mcp__claude-flow__memory_store {"key": "swarm/objective", "value": "${objective}"}
  mcp__claude-flow__task_create {"name": "Analyze Requirements", "assignTo": "RequirementsAnalyst"}
  mcp__claude-flow__task_create {"name": "Design Architecture", "assignTo": "SystemDesigner", "dependsOn": ["Analyze Requirements"]}
  TodoWrite {"todos": [
    {"id": "1", "content": "Initialize swarm coordination", "status": "completed", "priority": "high"},
    {"id": "2", "content": "Analyze objective requirements", "status": "in_progress", "priority": "high"},
    {"id": "3", "content": "Design system architecture", "status": "pending", "priority": "high"},
    {"id": "4", "content": "Spawn additional agents as needed", "status": "pending", "priority": "medium"}
  ]}
\`\`\`

📋 MANDATORY PARALLEL WORKFLOW:

1. **INITIAL SPAWN (Single BatchTool Message):**
   - Spawn ALL agents at once
   - Create ALL initial todos at once
   - Store initial memory state
   - Create task hierarchy
   
   Example:
   \`\`\`
   [BatchTool]:
     mcp__claude-flow__agent_spawn (coordinator)
     mcp__claude-flow__agent_spawn (architect)
     mcp__claude-flow__agent_spawn (coder-1)
     mcp__claude-flow__agent_spawn (coder-2)
     mcp__claude-flow__agent_spawn (tester)
     mcp__claude-flow__memory_store { key: "init", value: {...} }
     mcp__claude-flow__task_create { name: "Main", subtasks: [...] }
     TodoWrite { todos: [5-10 todos at once] }
   \`\`\`

2. **TASK EXECUTION (Parallel Batches):**
   - Assign multiple tasks in one batch
   - Update multiple statuses together
   - Store multiple results simultaneously
   
3. **MONITORING (Combined Operations):**
   - Check all agent statuses together
   - Retrieve multiple memory items
   - Update all progress markers

🔧 AVAILABLE MCP TOOLS FOR SWARM COORDINATION:

📊 MONITORING & STATUS:
- mcp__claude-flow__swarm_status - Check current swarm status and agent activity
- mcp__claude-flow__swarm_monitor - Real-time monitoring of swarm execution
- mcp__claude-flow__agent_list - List all active agents and their capabilities
- mcp__claude-flow__task_status - Check task progress and dependencies

🧠 MEMORY & KNOWLEDGE:
- mcp__claude-flow__memory_store - Store knowledge in swarm collective memory
- mcp__claude-flow__memory_retrieve - Retrieve shared knowledge from memory
- mcp__claude-flow__memory_search - Search collective memory by pattern
- mcp__claude-flow__memory_sync - Synchronize memory across agents

🤖 AGENT MANAGEMENT:
- mcp__claude-flow__agent_spawn - Spawn specialized agents for tasks
- mcp__claude-flow__agent_assign - Assign tasks to specific agents
- mcp__claude-flow__agent_communicate - Send messages between agents
- mcp__claude-flow__agent_coordinate - Coordinate agent activities

📋 TASK ORCHESTRATION:
- mcp__claude-flow__task_create - Create new tasks with dependencies
- mcp__claude-flow__task_assign - Assign tasks to agents
- mcp__claude-flow__task_update - Update task status and progress
- mcp__claude-flow__task_complete - Mark tasks as complete with results

🎛️ COORDINATION MODES:
1. CENTRALIZED (default): Single coordinator manages all agents
   - Use when: Clear hierarchy needed, simple workflows
   - Tools: agent_assign, task_create, swarm_monitor

2. DISTRIBUTED: Multiple coordinators share responsibility
   - Use when: Large scale tasks, fault tolerance needed
   - Tools: agent_coordinate, memory_sync, task_update

3. HIERARCHICAL: Tree structure with team leads
   - Use when: Complex projects with sub-teams
   - Tools: agent_spawn (with parent), task_create (with subtasks)

4. MESH: Peer-to-peer agent coordination
   - Use when: Maximum flexibility, self-organizing teams
   - Tools: agent_communicate, memory_store/retrieve

⚡ EXECUTION WORKFLOW - ALWAYS USE BATCHTOOL:

1. SPARC METHODOLOGY WITH PARALLEL EXECUTION:
   
   S - Specification Phase (Single BatchTool):
   \`\`\`
   [BatchTool]:
     mcp__claude-flow__memory_store { key: "specs/requirements", value: {...} }
     mcp__claude-flow__task_create { name: "Requirement 1" }
     mcp__claude-flow__task_create { name: "Requirement 2" }
     mcp__claude-flow__task_create { name: "Requirement 3" }
     mcp__claude-flow__agent_spawn { type: "researcher", name: "SpecAnalyst" }
   \`\`\`
   
   P - Pseudocode Phase (Single BatchTool):
   \`\`\`
   [BatchTool]:
     mcp__claude-flow__memory_store { key: "pseudocode/main", value: {...} }
     mcp__claude-flow__task_create { name: "Design API" }
     mcp__claude-flow__task_create { name: "Design Data Model" }
     mcp__claude-flow__agent_communicate { to: "all", message: "Review design" }
   \`\`\`
   
   A - Architecture Phase (Single BatchTool):
   \`\`\`
   [BatchTool]:
     mcp__claude-flow__agent_spawn { type: "architect", name: "LeadArchitect" }
     mcp__claude-flow__memory_store { key: "architecture/decisions", value: {...} }
     mcp__claude-flow__task_create { name: "Backend", subtasks: [...] }
     mcp__claude-flow__task_create { name: "Frontend", subtasks: [...] }
   \`\`\`
   
   R - Refinement Phase (Single BatchTool):
   \`\`\`
   [BatchTool]:
     mcp__claude-flow__swarm_monitor {}
     mcp__claude-flow__task_update { taskId: "1", progress: 50 }
     mcp__claude-flow__task_update { taskId: "2", progress: 75 }
     mcp__claude-flow__memory_store { key: "learnings/iteration1", value: {...} }
   \`\`\`
   
   C - Completion Phase (Single BatchTool):
   \`\`\`
   [BatchTool]:
     mcp__claude-flow__task_complete { taskId: "1", results: {...} }
     mcp__claude-flow__task_complete { taskId: "2", results: {...} }
     mcp__claude-flow__memory_retrieve { pattern: "**/*" }
     TodoWrite { todos: [{content: "Final review", status: "completed"}] }
   \`\`\`

🤝 AGENT TYPES & THEIR MCP TOOL USAGE:

COORDINATOR:
- Primary tools: swarm_monitor, agent_assign, task_create
- Monitors overall progress and assigns work
- Uses memory_store for decisions and memory_retrieve for context

RESEARCHER:
- Primary tools: memory_search, memory_store
- Gathers information and stores findings
- Uses agent_communicate to share discoveries

CODER:
- Primary tools: task_update, memory_retrieve, memory_store
- Implements solutions and updates progress
- Retrieves specs from memory, stores code artifacts

ANALYST:
- Primary tools: memory_search, swarm_monitor
- Analyzes data and patterns
- Stores insights and recommendations

TESTER:
- Primary tools: task_status, agent_communicate
- Validates implementations
- Reports issues via task_update

📝 EXAMPLE MCP TOOL USAGE PATTERNS:

1. Starting a swarm:
   mcp__claude-flow__agent_spawn {"type": "coordinator", "name": "SwarmLead"}
   mcp__claude-flow__memory_store {"key": "objective", "value": "${objective}"}
   mcp__claude-flow__task_create {"name": "Main Objective", "type": "parent"}

2. Spawning worker agents:
   mcp__claude-flow__agent_spawn {"type": "researcher", "capabilities": ["web-search"]}
   mcp__claude-flow__agent_spawn {"type": "coder", "capabilities": ["python", "testing"]}
   mcp__claude-flow__task_assign {"taskId": "task-123", "agentId": "agent-456"}

3. Coordinating work:
   mcp__claude-flow__agent_communicate {"to": "agent-123", "message": "Begin phase 2"}
   mcp__claude-flow__memory_store {"key": "phase1/results", "value": {...}}
   mcp__claude-flow__task_update {"taskId": "task-123", "progress": 75}

4. Monitoring progress:
   mcp__claude-flow__swarm_monitor {}
   mcp__claude-flow__task_status {"includeCompleted": true}
   mcp__claude-flow__agent_list {"status": "active"}

💾 MEMORY PATTERNS:

Use hierarchical keys for organization:
- "specs/requirements" - Store specifications
- "architecture/decisions" - Architecture choices
- "code/modules/[name]" - Code artifacts
- "tests/results/[id]" - Test outcomes
- "docs/api/[endpoint]" - Documentation

🚀 BEGIN SWARM EXECUTION:

Start by spawning a coordinator agent and creating the initial task structure. Use the MCP tools to orchestrate the swarm, coordinate agents, and track progress. Remember to store important decisions and artifacts in collective memory for other agents to access.

The swarm should be self-documenting - use memory_store to save all important information, decisions, and results throughout the execution.`;

  // Check if claude command exists
  try {
    execSync('which claude', { stdio: 'pipe' });
  } catch {
    error('Claude command not found. Please ensure Claude is installed and in your PATH.');
    console.log('\nTo install Claude, run:');
    console.log('  npm install -g @anthropic/claude-cli');
    return;
  }
  
  // If interactive mode, set up approval workflow
  if (options.interactive || options.approvalRequired) {
    console.log(`\n📋 Interactive Approval Mode Enabled`);
    console.log(`👤 Reviewer: ${options.reviewer}`);
    console.log(`\n⚠️  Claude will present a plan before making any changes.`);
    console.log(`You must explicitly approve with "APPROVED" or request modifications.\n`);
  }
  
  // Launch Claude with the swarm prompt
  const args = ['--text', swarmPrompt];
  
  console.log('Launching Claude...\n');
  
  const claudeProcess = spawn('claude', args, {
    stdio: 'inherit',
    env: { ...process.env }
  });
  
  claudeProcess.on('error', (err) => {
    error(`Failed to launch Claude: ${err.message}`);
  });
  
  claudeProcess.on('exit', (code) => {
    if (code !== 0) {
      error(`Claude exited with code ${code}`);
    } else {
      success('Claude session completed successfully');
    }
  });
}

export async function swarmAction(ctx: CommandContext) {
  // First check if help is requested
  if (ctx.flags.help || ctx.flags.h) {
    showSwarmHelp();
    return;
  }
  
  // The objective should be all the non-flag arguments joined together
  const objective = ctx.args.join(' ').trim();
  
  if (!objective) {
    error("Usage: swarm <objective>");
    showSwarmHelp();
    return;
  }
  
  const options = parseSwarmOptions(ctx.flags);
  const swarmId = generateId('swarm');
  
  // Handle JSON output mode
  const isJsonOutput = options.outputFormat === 'json';
  const isNonInteractive = isJsonOutput || options.noInteractive;
  
  // For JSON output, force executor mode since Claude Code doesn't return structured JSON
  if (isJsonOutput && !options.executor) {
    options.executor = true;
    options.claude = false;
  }
  
  if (options.dryRun) {
    showDryRunConfiguration(swarmId, objective, options);
    return;
  }
  
  // If UI mode is requested, launch the UI
  if (options.ui) {
    await launchSwarmUI(objective, options);
    return;
  }
  
  // If claude flag is set (or not executor flag), launch Claude Code with swarm prompt
  if (options.claude || !options.executor) {
    await launchClaudeCodeWithSwarm(objective, options);
    return;
  }
  
  // Only show messages if not in JSON output mode
  if (!isJsonOutput) {
    success(`🐝 Initializing Advanced Swarm: ${swarmId}`);
    console.log(`📋 Objective: ${objective}`);
    console.log(`🎯 Strategy: ${options.strategy}`);
    console.log(`🏗️  Mode: ${options.mode}`);
    console.log(`🤖 Max Agents: ${options.maxAgents}`);
  }
  
  try {
    // Initialize comprehensive swarm system
    const coordinator = new SwarmCoordinator({
      name: `Swarm-${swarmId}`,
      description: objective,
      mode: options.mode,
      strategy: options.strategy,
      maxAgents: options.maxAgents,
      maxTasks: options.maxTasks,
      maxDuration: options.timeout * 60 * 1000,
      taskTimeoutMinutes: options.taskTimeoutMinutes,
      qualityThreshold: options.qualityThreshold,
      reviewRequired: options.review,
      testingRequired: options.testing,
      // Configure quiet logging unless verbose
      coordinationStrategy: {
        name: 'advanced',
        description: 'Advanced coordination with all features',
        agentSelection: options.agentSelection,
        taskScheduling: options.taskScheduling,
        loadBalancing: options.loadBalancing,
        faultTolerance: options.faultTolerance,
        communication: options.communication
      },
      monitoring: {
        metricsEnabled: options.monitor,
        loggingEnabled: true,
        tracingEnabled: options.verbose,
        metricsInterval: 5000,
        heartbeatInterval: 60000, // Increased to 60 seconds for long Claude executions
        healthCheckInterval: 120000, // Increased to 2 minutes
        retentionPeriod: 24 * 60 * 60 * 1000,
        maxLogSize: 100 * 1024 * 1024,
        maxMetricPoints: 10000,
        alertingEnabled: true,
        alertThresholds: {
          errorRate: 0.1,
          responseTime: 10000,
          memoryUsage: 0.8,
          cpuUsage: 0.8
        },
        exportEnabled: false,
        exportFormat: 'json',
        // exportPath: './metrics' // Commented out - not in type definition
      }
    });
    
    await coordinator.initialize();
    
    // Enable JSON output collection if requested
    if (isJsonOutput) {
      coordinator.enableJsonOutput(objective);
    }
    
    // Initialize Task Executor with enhanced options
    const executor = new TaskExecutor({
      maxConcurrentTasks: 10,
      maxRetries: options.maxRetries,
      retryDelay: 1000,
      timeout: options.taskTimeout,
      enableCaching: true,
      cacheSize: 100,
      cacheTTL: 300000, // 5 minutes
      executionMode: options.parallel ? 'parallel' : 'sequential',
      resourceLimits: {
        maxMemory: 512,
        maxCpuPercent: 80,
        maxDiskIOps: 100,
        maxNetworkBandwidthMbps: 100
      },
      queueOptions: {
        concurrency: 5,
        priorityLevels: 4,
        maxQueueSize: 1000,
        processDelay: 100
      },
      monitoring: {
        collectMetrics: true,
        logExecutions: true,
        trackResourceUsage: true
      }
    });
    
    await executor.initialize();
    
    // Initialize Memory Manager with enhanced configuration
    const memory = new SwarmMemoryManager({
      namespace: options.memoryNamespace,
      persistence: options.persistence,
      encryption: options.encryption,
      maxMemorySize: 100 * 1024 * 1024, // 100MB
      compressionEnabled: true,
      compressionThreshold: 1024, // 1KB
      indexingEnabled: true,
      searchEnabled: true,
      versioningEnabled: true,
      maxVersions: 10,
      ttlEnabled: true,
      defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
      garbageCollectionInterval: 60 * 60 * 1000, // 1 hour
      replicationEnabled: options.distributed,
      replicationFactor: 3,
      consistencyLevel: 'eventual',
      conflictResolution: 'last-write-wins'
    });
    
    await memory.initialize();
    
    // Create a directory for this swarm run
    const swarmDir = `.claude-flow/swarm-runs/${swarmId}`;
    await fs.mkdir(swarmDir, { recursive: true });

    // Create objective
    const objectiveId = await coordinator.createObjective(
      `Swarm-${swarmId}`,
      objective,
      options.strategy,
      {
        minAgents: 1,
        maxAgents: options.maxAgents,
        agentTypes: getRequiredAgentTypes(options.strategy),
        estimatedDuration: options.timeout * 60 * 1000,
        maxDuration: options.timeout * 60 * 1000 * 2,
        qualityThreshold: options.qualityThreshold,
        reviewCoverage: options.review ? 1.0 : 0.0,
        testCoverage: options.testing ? 0.8 : 0.0,
        reliabilityTarget: 0.95
      }
    );
    
    console.log(`\n📝 Objective created: ${objectiveId}`);

    // Register agents based on strategy and requirements
    const agentTypes = getRequiredAgentTypes(options.strategy);
    const agents: string[] = [];
    
    for (let i = 0; i < Math.min(options.maxAgents, agentTypes.length * 2); i++) {
      const agentType = agentTypes[i % agentTypes.length];
      const agentName = `${agentType}-${Math.floor(i / agentTypes.length) + 1}`;
      
      const agentId = await coordinator.registerAgent(
        agentName,
        agentType,
        getAgentCapabilities(agentType)
      );
      
      agents.push(agentId);
      console.log(`  🤖 Registered ${agentType}: ${agentName} (${agentId})`);
    }

    // Write swarm configuration
    await fs.writeFile(`${swarmDir}/config.json`, JSON.stringify({
      swarmId,
      objectiveId,
      objective,
      strategy: options.strategy,
      mode: options.mode,
      agents,
      options,
      startTime: new Date().toISOString(),
      coordinator: {
        initialized: true,
        swarmId: coordinator.getSwarmId()
      }
    }, null, 2));

    // Set up event monitoring if requested (or always in background mode)
    if (options.monitor || options.background) {
      setupSwarmMonitoring(coordinator, executor, memory, swarmDir);
    }
    
    // Set up incremental status updates (always enabled)
    await setupIncrementalUpdates(coordinator, swarmDir);

    // Execute the objective
    if (!isJsonOutput) {
      console.log(`\n🚀 Swarm execution started...`);
    }
    
    // Start the objective execution
    await coordinator.executeObjective(objectiveId);

    if (options.background && process.env['CLAUDE_SWARM_NO_BG']) {
      // We're running inside the background script
      // Save state and continue with normal execution
      await fs.writeFile(`${swarmDir}/coordinator.json`, JSON.stringify({
        coordinatorRunning: true,
        pid: process.pid,
        startTime: new Date().toISOString(),
        status: coordinator.getStatus(),
        swarmId: coordinator.getSwarmId()
      }, null, 2));
      
      console.log(`\n🌙 Running in background mode`);
      console.log(`📁 Results: ${swarmDir}`);
      
      // Wait for completion in background with minimal output
      if (!isJsonOutput) {
        console.log(`\n⏳ Processing tasks...`);
      }
      
      // Background mode uses simple polling, no detailed progress
      await waitForSwarmCompletion(coordinator, objectiveId, options);
      
      // Show final results or output JSON
      if (isJsonOutput) {
        await outputJsonResults(coordinator, options);
      } else {
        await showSwarmResults(coordinator, executor, memory, swarmDir);
      }
      
    } else if (!options.background) {
      // Wait for completion in foreground with detailed progress
      if (!options.verbose && !isJsonOutput) {
        console.log(`\n⏳ Processing tasks...`);
        
        // Track task states for detailed display
        let lastTaskUpdate = '';
        let taskStartTime = Date.now();
        
        // Create a more informative progress display
        const progressInterval = setInterval(() => {
          const status = coordinator.getSwarmStatus();
          const tasks = coordinator.getTasks();
          const agents = coordinator.getAgents();
          const objective = coordinator.getObjectives().find(o => o.id === objectiveId);
          
          const activeTasks = tasks.filter(t => (t.status as string) === 'in_progress');
          const activeAgents = agents.filter(a => (a.status as string) === 'active');
          
          // Build status string
          let statusLine = `Tasks: ${status.tasks.completed}/${status.tasks.total} | `;
          statusLine += `Agents: ${activeAgents.length}/${status.agents.total} | `;
          statusLine += `Progress: ${objective?.progress || 0}%`;
          
          // Show current active task if any
          if (activeTasks.length > 0) {
            const currentTask = activeTasks[0];
            const taskInfo = `Current: ${currentTask.description || currentTask.name}`;
            if (taskInfo !== lastTaskUpdate) {
              lastTaskUpdate = taskInfo;
              taskStartTime = Date.now();
            }
            const taskDuration = Math.floor((Date.now() - taskStartTime) / 1000);
            statusLine += ` | ${taskInfo} (${taskDuration}s)`;
          }
          
          // Clear the line and print status
          process.stdout.write(`\r${' '.repeat(100)}\r${statusLine}`);
          
        }, 1000);
        
        await waitForSwarmCompletion(coordinator, objectiveId, options);
        
        clearInterval(progressInterval);
        process.stdout.write('\r' + ' '.repeat(100) + '\r'); // Clear the progress line
      } else {
        // Verbose mode - show all events
        await waitForSwarmCompletion(coordinator, objectiveId, options);
      }
      
      // Show final results or output JSON
      if (isJsonOutput) {
        await outputJsonResults(coordinator, options);
      } else {
        await showSwarmResults(coordinator, executor, memory, swarmDir);
      }
      
    } else {
      // Background mode requested - launch in background
      console.log(`\n🌙 Launching swarm in background mode...`);
      console.log(`📁 Results will be saved to: ${swarmDir}`);
      console.log(`📊 Monitor progress: claude-flow swarm status ${swarmId}`);
      
      // Save initial state for background monitoring
      await fs.writeFile(`${swarmDir}/background.json`, JSON.stringify({
        swarmId,
        objectiveId,
        pid: process.pid,
        startTime: new Date().toISOString(),
        command: process.argv.join(' ')
      }, null, 2));
      
      // Use the swarm-background script
      const scriptPath = new URL(import.meta.url).pathname;
      const projectRoot = scriptPath.substring(0, scriptPath.indexOf('/src/'));
      const bgScriptPath = `${projectRoot}/bin/claude-flow-swarm-background`;
      
      const bgCommand = new Deno.Command(bgScriptPath, {
        args: [objective, ...buildBackgroundArgs(options)],
        stdout: 'piped',
        stderr: 'piped',
        stdin: 'null'
      });
      
      const bgProcess = bgCommand.spawn();
      
      // Just confirm launch and exit
      success('Swarm launched in background successfully!');
      
      // Don't wait for the background process
      bgProcess.unref?.();
    }
    
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    error(`Swarm execution failed: ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  }
}

function parseSwarmOptions(flags: any) {
  // Handle boolean true value for strategy
  let strategy = flags.strategy;
  if (strategy === true || strategy === 'true') {
    strategy = 'auto';
  }
  
  // Determine mode - if parallel flag is set, override mode to 'parallel'
  let mode = flags.mode as SwarmMode || 'centralized';
  if (flags.parallel) {
    mode = 'parallel' as SwarmMode;
  }
  
  return {
    strategy: strategy as SwarmStrategy || 'auto',
    mode: mode,
    maxAgents: parseInt(flags.maxAgents || flags['max-agents'] || '5'),
    maxTasks: parseInt(flags.maxTasks || flags['max-tasks'] || '100'),
    timeout: parseInt(flags.timeout || '60'), // minutes
    taskTimeout: parseInt(flags.taskTimeout || flags['task-timeout'] || '300000'), // ms
    taskTimeoutMinutes: parseInt(flags.taskTimeoutMinutes || flags['task-timeout-minutes'] || '59'), // minutes
    maxRetries: parseInt(flags.maxRetries || flags['max-retries'] || '3'),
    qualityThreshold: parseFloat(flags.qualityThreshold || flags['quality-threshold'] || '0.8'),
    
    // Execution options
    parallel: flags.parallel || false,
    background: flags.background || false,
    distributed: flags.distributed || false,
    
    // Quality options
    review: flags.review || false,
    testing: flags.testing || false,
    
    // Interactive approval options
    interactive: flags.interactive || false,
    approvalRequired: flags.approvalRequired || flags['approval-required'] || false,
    reviewer: flags.reviewer || process.env.USER || 'user',
    
    // Monitoring options
    monitor: flags.monitor || false,
    verbose: flags.verbose || flags.v || false,
    streamOutput: flags.streamOutput || flags['stream-output'] || false,
    
    // Memory options
    memoryNamespace: flags.memoryNamespace || flags['memory-namespace'] || 'swarm',
    persistence: flags.persistence !== false,
    
    // Security options
    encryption: flags.encryption || false,
    
    // Coordination strategy options
    agentSelection: flags.agentSelection || flags['agent-selection'] || 'capability-based',
    taskScheduling: flags.taskScheduling || flags['task-scheduling'] || 'priority',
    loadBalancing: flags.loadBalancing || flags['load-balancing'] || 'work-stealing',
    faultTolerance: flags.faultTolerance || flags['fault-tolerance'] || 'retry',
    communication: flags.communication || 'event-driven',
    
    // UI and debugging
    ui: flags.ui || false,
    dryRun: flags.dryRun || flags['dry-run'] || flags.d || false,
    
    // Claude Code options
    claude: flags.claude || false,
    executor: flags.executor || false,
    
    // JSON output options
    outputFormat: flags.outputFormat || flags['output-format'] || 'text',
    outputFile: flags.outputFile || flags['output-file'],
    noInteractive: flags.noInteractive || flags['no-interactive'] || false
  };
}

function getRequiredAgentTypes(strategy: SwarmStrategy): AgentType[] {
  switch (strategy) {
    case 'research':
      return ['researcher', 'analyst', 'documenter'];
    case 'development':
      return ['coder', 'tester', 'reviewer', 'documenter'];
    case 'analysis':
      return ['analyst', 'researcher', 'documenter'];
    case 'testing':
      return ['tester', 'coder', 'reviewer'];
    case 'optimization':
      return ['analyst', 'coder', 'monitor'];
    case 'maintenance':
      return ['coder', 'monitor', 'tester'];
    default: // auto
      return ['coordinator', 'coder', 'researcher', 'analyst'];
  }
}

function getAgentCapabilities(agentType: AgentType) {
  const baseCapabilities = {
    maxConcurrentTasks: 3,
    maxMemoryUsage: 256 * 1024 * 1024, // 256MB
    maxExecutionTime: 300000, // 5 minutes
    reliability: 0.8,
    speed: 1.0,
    quality: 0.8
  };

  switch (agentType) {
    case 'coordinator':
      return {
        ...baseCapabilities,
        codeGeneration: false,
        codeReview: true,
        testing: false,
        documentation: true,
        research: true,
        analysis: true,
        webSearch: false,
        apiIntegration: true,
        fileSystem: true,
        terminalAccess: true,
        languages: ['typescript', 'javascript'],
        frameworks: ['deno', 'node'],
        domains: ['coordination', 'management'],
        tools: ['git', 'npm', 'deno'],
        reliability: 0.95
      };
      
    case 'coder':
      return {
        ...baseCapabilities,
        codeGeneration: true,
        codeReview: true,
        testing: true,
        documentation: true,
        research: false,
        analysis: false,
        webSearch: false,
        apiIntegration: true,
        fileSystem: true,
        terminalAccess: true,
        languages: ['typescript', 'javascript', 'python', 'rust'],
        frameworks: ['deno', 'node', 'react', 'express'],
        domains: ['software-development', 'web-development'],
        tools: ['git', 'npm', 'deno', 'docker'],
        quality: 0.9
      };
      
    case 'researcher':
      return {
        ...baseCapabilities,
        codeGeneration: false,
        codeReview: false,
        testing: false,
        documentation: true,
        research: true,
        analysis: true,
        webSearch: true,
        apiIntegration: true,
        fileSystem: true,
        terminalAccess: false,
        languages: [],
        frameworks: [],
        domains: ['research', 'data-analysis'],
        tools: ['browser', 'search-engines'],
        reliability: 0.85
      };
      
    case 'analyst':
      return {
        ...baseCapabilities,
        codeGeneration: false,
        codeReview: true,
        testing: false,
        documentation: true,
        research: true,
        analysis: true,
        webSearch: false,
        apiIntegration: true,
        fileSystem: true,
        terminalAccess: true,
        languages: ['python', 'r', 'sql'],
        frameworks: ['pandas', 'numpy'],
        domains: ['data-analysis', 'statistics'],
        tools: ['jupyter', 'data-tools'],
        quality: 0.9
      };
      
    case 'tester':
      return {
        ...baseCapabilities,
        codeGeneration: false,
        codeReview: true,
        testing: true,
        documentation: true,
        research: false,
        analysis: false,
        webSearch: false,
        apiIntegration: true,
        fileSystem: true,
        terminalAccess: true,
        languages: ['typescript', 'javascript'],
        frameworks: ['jest', 'vitest', 'playwright'],
        domains: ['testing', 'quality-assurance'],
        tools: ['test-runners', 'coverage-tools'],
        reliability: 0.9
      };
      
    case 'reviewer':
      return {
        ...baseCapabilities,
        codeGeneration: false,
        codeReview: true,
        testing: true,
        documentation: true,
        research: false,
        analysis: true,
        webSearch: false,
        apiIntegration: false,
        fileSystem: true,
        terminalAccess: false,
        languages: ['typescript', 'javascript', 'python'],
        frameworks: [],
        domains: ['code-review', 'quality-assurance'],
        tools: ['static-analysis', 'linters'],
        quality: 0.95
      };
      
    default:
      return baseCapabilities;
  }
}

let globalMetricsInterval: NodeJS.Timeout | undefined;
let globalStatusInterval: NodeJS.Timeout | undefined;

async function setupIncrementalUpdates(
  coordinator: SwarmCoordinator,
  swarmDir: string
): Promise<void> {
  const statusFile = `${swarmDir}/status.json`;
  const tasksDir = `${swarmDir}/tasks`;
  
  // Create tasks directory
  await fs.mkdir(tasksDir, { recursive: true });
  
  // Initialize with first status update
  try {
    const initialStatus = coordinator.getSwarmStatus();
    const initialTasks = coordinator.getTasks();
    const initialAgents = coordinator.getAgents();
    const initialObjective = coordinator.getObjectives()[0];
    
    await fs.writeFile(statusFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      swarmStatus: initialStatus,
      objective: initialObjective ? {
        id: initialObjective.id,
        name: initialObjective.name,
        status: initialObjective.status,
        progress: initialObjective.progress || 0
      } : null,
      agents: {
        total: initialAgents.length,
        active: initialAgents.filter(a => (a.status as string) === 'active').length,
        list: initialAgents.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          status: a.status,
          currentTask: a.currentTask,
          tasksCompleted: (a as any).completedTasks?.length || 0
        }))
      },
      tasks: {
        total: initialTasks.length,
        completed: initialTasks.filter(t => (t.status as string) === 'completed').length,
        inProgress: initialTasks.filter(t => (t.status as string) === 'in_progress').length,
        pending: initialTasks.filter(t => (t.status as string) === 'pending').length,
        failed: initialTasks.filter(t => (t.status as string) === 'failed').length
      }
    }, null, 2));
    
    // Create initial progress file
    const initialProgressText = `Swarm Progress
==============
Timestamp: ${new Date().toISOString()}
Objective: ${initialObjective?.name || 'Unknown'}
Status: ${initialObjective?.status || 'Unknown'}

Tasks Summary:
- Total: ${initialTasks.length}
- Completed: ${initialTasks.filter(t => (t.status as string) === 'completed').length}
- In Progress: ${initialTasks.filter(t => (t.status as string) === 'in_progress').length}
- Pending: ${initialTasks.filter(t => (t.status as string) === 'pending').length}
- Failed: ${initialTasks.filter(t => (t.status as string) === 'failed').length}

Agents Summary:
- Total: ${initialAgents.length}
- Active: ${initialAgents.filter(a => (a.status as string) === 'active').length}
`;
    
    await fs.writeFile(`${swarmDir}/progress.txt`, initialProgressText);
    
  } catch (err) {
    console.error('Failed to write initial status:', err);
  }
  
  // Set up periodic updates (every 5 seconds)
  globalStatusInterval = setInterval(async () => {
    try {
      const status = coordinator.getSwarmStatus();
      const tasks = coordinator.getTasks();
      const agents = coordinator.getAgents();
      const objective = coordinator.getObjectives()[0];
      
      // Update main status file
      await fs.writeFile(statusFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        swarmStatus: status,
        objective: objective ? {
          id: objective.id,
          name: objective.name,
          status: objective.status,
          progress: objective.progress || 0
        } : null,
        agents: {
          total: agents.length,
          active: agents.filter(a => (a.status as string) === 'active').length,
          list: agents.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            status: a.status,
            currentTask: a.currentTask,
            tasksCompleted: (a as any).completedTasks?.length || 0
          }))
        },
        tasks: {
          total: tasks.length,
          completed: tasks.filter(t => (t.status as string) === 'completed').length,
          inProgress: tasks.filter(t => (t.status as string) === 'in_progress').length,
          pending: tasks.filter(t => (t.status as string) === 'pending').length,
          failed: tasks.filter(t => (t.status as string) === 'failed').length
        }
      }, null, 2));
      
      // Update individual task files for completed tasks
      for (const task of tasks) {
        if ((task.status as string) === 'completed' || (task.status as string) === 'failed') {
          const taskFile = `${tasksDir}/${task.id}.json`;
          await fs.writeFile(taskFile, JSON.stringify({
            ...task,
            completedAt: new Date().toISOString()
          }, null, 2));
        }
      }
      
      // Update progress text file
      const progressText = `Swarm Progress
==============
Timestamp: ${new Date().toISOString()}
Objective: ${objective?.name || 'Unknown'}
Status: ${objective?.status || 'Unknown'}
Progress: ${objective?.progress || 0}%

Tasks Summary:
- Total: ${tasks.length}
- Completed: ${tasks.filter(t => (t.status as string) === 'completed').length}
- In Progress: ${tasks.filter(t => (t.status as string) === 'in_progress').length}
- Pending: ${tasks.filter(t => (t.status as string) === 'pending').length}
- Failed: ${tasks.filter(t => (t.status as string) === 'failed').length}

Agents Summary:
- Total: ${agents.length}
- Active: ${agents.filter(a => (a.status as string) === 'active').length}

Recent Tasks:
${tasks.slice(-5).map(t => `- [${t.status}] ${t.name || t.description}`).join('\n')}
`;
      
      await fs.writeFile(`${swarmDir}/progress.txt`, progressText);
      
    } catch (err) {
      // Silently ignore errors to not disrupt execution
    }
  }, 5000);
}

function setupSwarmMonitoring(
  coordinator: SwarmCoordinator,
  executor: TaskExecutor,
  memory: SwarmMemoryManager,
  swarmDir: string
): void {
  console.log('\n📊 Monitoring enabled - collecting metrics...');
  
  const metricsFile = `${swarmDir}/metrics.json`;
  const metricsHistory: any[] = [];
  
  // Collect metrics every 10 seconds
  globalMetricsInterval = setInterval(async () => {
    const timestamp = new Date().toISOString();
    const swarmStatus = coordinator.getSwarmStatus();
    const executorStats = executor.getStats();
    const memoryStats = memory.getStats();
    
    const metrics = {
      timestamp,
      swarm: {
        status: swarmStatus.status,
        objectives: swarmStatus.objectives,
        agents: swarmStatus.agents,
        tasks: swarmStatus.tasks,
        uptime: coordinator.getUptime()
      },
      executor: executorStats,
      memory: memoryStats
    };
    
    metricsHistory.push(metrics);
    
    // Keep only last 1000 entries
    if (metricsHistory.length > 1000) {
      metricsHistory.shift();
    }
    
    // Write to file
    try {
      await fs.writeFile(metricsFile, JSON.stringify(metricsHistory, null, 2));
    } catch (err) {
      // Ignore write errors
    }
  }, 10000);
}

async function waitForSwarmCompletion(
  coordinator: SwarmCoordinator,
  objectiveId: string,
  options: any
): Promise<void> {
  const maxDuration = options.timeout * 60 * 1000;
  const startTime = Date.now();
  
  while (true) {
    const objective = coordinator.getObjectives().find(o => o.id === objectiveId);
    const swarmStatus = coordinator.getStatus();
    
    if (!objective) {
      throw new Error('Objective not found');
    }
    
    // Check if completed
    if (objective.status === 'completed' || objective.status === 'failed') {
      break;
    }
    
    // Check if swarm is stuck or failed
    if (swarmStatus === 'failed' || swarmStatus === 'error') {
      throw new Error(`Swarm failed with status: ${swarmStatus}`);
    }
    
    // Check timeout
    if (Date.now() - startTime > maxDuration) {
      warning(`Swarm execution timeout after ${options.timeout} minutes`);
      break;
    }
    
    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Clean up intervals
  if (globalMetricsInterval) {
    clearInterval(globalMetricsInterval);
    globalMetricsInterval = undefined;
  }
  if (globalStatusInterval) {
    clearInterval(globalStatusInterval);
    globalStatusInterval = undefined;
  }
}

async function showSwarmResults(
  coordinator: SwarmCoordinator,
  executor: TaskExecutor,
  memory: SwarmMemoryManager,
  swarmDir: string
): Promise<void> {
  const swarmStatus = coordinator.getSwarmStatus();
  const executorStats = executor.getStats();
  const memoryStats = memory.getStats();
  
  const results = {
    swarmId: coordinator.getSwarmId(),
    status: swarmStatus,
    executor: executorStats,
    memory: memoryStats,
    completedAt: new Date().toISOString(),
    duration: coordinator.getUptime()
  };
  
  await fs.writeFile(`${swarmDir}/results.json`, JSON.stringify(results, null, 2));
  
  // Show summary
  success(`\n✅ Swarm completed successfully!`);
  console.log(`\n📊 Final Results:`);
  console.log(`  • Objectives: ${swarmStatus.objectives}`);
  console.log(`  • Tasks Completed: ${swarmStatus.tasks.completed}`);
  console.log(`  • Tasks Failed: ${swarmStatus.tasks.failed}`);
  console.log(`  • Success Rate: ${(swarmStatus.tasks.completed / (swarmStatus.tasks.completed + swarmStatus.tasks.failed) * 100).toFixed(1)}%`);
  console.log(`  • Agents Used: ${swarmStatus.agents.total}`);
  console.log(`  • Memory Entries: ${memoryStats.totalEntries}`);
  console.log(`  • Execution Time: ${(coordinator.getUptime() / 1000).toFixed(1)}s`);
  console.log(`  • Results saved to: ${swarmDir}`);
  
  // Check for created files
  try {
    // Look for any files created during the swarm execution
    const createdFiles: string[] = [];
    const checkDir = async (dir: string, depth = 0) => {
      if (depth > 3) return; // Limit recursion depth
      
      try {
        for await (const entry of Deno.readDir(dir)) {
          if (entry.isFile && !entry.name.startsWith('.') && 
              !dir.includes('swarm-runs') && !dir.includes('node_modules')) {
            const fullPath = `${dir}/${entry.name}`;
            const stat = await fs.stat(fullPath);
            // Check if file was created recently (within swarm execution time)
            const executionStartTime = Date.now() - coordinator.getUptime();
            if (stat.mtime && stat.mtime.getTime() > executionStartTime) {
              createdFiles.push(fullPath);
            }
          } else if (entry.isDirectory && !entry.name.startsWith('.') && 
                     !entry.name.includes('node_modules') && !entry.name.includes('swarm-runs')) {
            await checkDir(`${dir}/${entry.name}`, depth + 1);
          }
        }
      } catch (e) {
        // Ignore permission errors
      }
    };
    
    // Check current directory and common output directories
    await checkDir('.');
    await checkDir('./examples').catch(() => {});
    await checkDir('./output').catch(() => {});
    
    if (createdFiles.length > 0) {
      console.log(`\n📁 Files created:`);
      createdFiles.forEach(file => {
        console.log(`  • ${file}`);
      });
    }
  } catch (e) {
    // Ignore errors in file checking
  }
}

async function launchSwarmUI(objective: string, options: any): Promise<void> {
  try {
    const scriptPath = new URL(import.meta.url).pathname;
    const projectRoot = scriptPath.substring(0, scriptPath.indexOf('/src/'));
    const uiScriptPath = `${projectRoot}/src/cli/simple-commands/swarm-ui.js`;
    
    // Check if the UI script exists
    try {
      await fs.stat(uiScriptPath);
    } catch {
      warning('Swarm UI script not found. Falling back to standard mode.');
      return;
    }
    
    const command = new Deno.Command('node', {
      args: [uiScriptPath, objective, ...buildUIArgs(options)],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    
    const process = command.spawn();
    const { code } = await process.status;
    
    if (code !== 0) {
      error(`Swarm UI exited with code ${code}`);
    }
  } catch (err) {
    warning(`Failed to launch swarm UI: ${(err as Error).message}`);
    console.log('Falling back to standard mode...');
  }
}

function buildUIArgs(options: any): string[] {
  const args: string[] = [];
  
  if (options.strategy !== 'auto') args.push('--strategy', options.strategy);
  if (options.mode !== 'centralized') args.push('--mode', options.mode);
  if (options.maxAgents !== 5) args.push('--max-agents', options.maxAgents.toString());
  if (options.parallel) args.push('--parallel');
  if (options.distributed) args.push('--distributed');
  if (options.monitor) args.push('--monitor');
  if (options.verbose) args.push('--verbose');
  if (options.interactive) args.push('--interactive');
  if (options.approvalRequired) args.push('--approval-required');
  if (options.reviewer !== 'user') args.push('--reviewer', options.reviewer);
  
  return args;
}

function buildBackgroundArgs(options: any): string[] {
  const args: string[] = [];
  
  if (options.strategy !== 'auto') args.push('--strategy', options.strategy);
  if (options.mode !== 'centralized') args.push('--mode', options.mode);
  if (options.maxAgents !== 5) args.push('--max-agents', options.maxAgents.toString());
  if (options.maxTasks !== 100) args.push('--max-tasks', options.maxTasks.toString());
  if (options.timeout !== 60) args.push('--timeout', options.timeout.toString());
  if (options.parallel) args.push('--parallel');
  if (options.distributed) args.push('--distributed');
  if (options.review) args.push('--review');
  if (options.testing) args.push('--testing');
  if (options.monitor) args.push('--monitor');
  if (options.verbose) args.push('--verbose');
  if (options.memoryNamespace !== 'swarm') args.push('--memory-namespace', options.memoryNamespace);
  if (options.encryption) args.push('--encryption');
  if (options.interactive) args.push('--interactive');
  if (options.approvalRequired) args.push('--approval-required');
  if (options.reviewer !== 'user') args.push('--reviewer', options.reviewer);
  
  return args;
}

function showDryRunConfiguration(swarmId: string, objective: string, options: any): void {
  warning('DRY RUN - Advanced Swarm Configuration:');
  console.log(`🆔 Swarm ID: ${swarmId}`);
  console.log(`📋 Objective: ${objective}`);
  console.log(`🎯 Strategy: ${options.strategy}`);
  console.log(`🏗️  Mode: ${options.mode}`);
  console.log(`🤖 Max Agents: ${options.maxAgents}`);
  console.log(`📊 Max Tasks: ${options.maxTasks}`);
  console.log(`⏰ Timeout: ${options.timeout} minutes`);
  console.log(`🔄 Parallel: ${options.parallel}`);
  console.log(`🌐 Distributed: ${options.distributed}`);
  console.log(`🔍 Monitoring: ${options.monitor}`);
  console.log(`👥 Review Mode: ${options.review}`);
  console.log(`🧪 Testing: ${options.testing}`);
  console.log(`🧠 Memory Namespace: ${options.memoryNamespace}`);
  console.log(`💾 Persistence: ${options.persistence}`);
  console.log(`🔒 Encryption: ${options.encryption}`);
  console.log(`📊 Quality Threshold: ${options.qualityThreshold}`);
  
  if (options.interactive || options.approvalRequired) {
    console.log(`\n🔸 Interactive Approval:`);
    console.log(`  • Enabled: ${options.interactive || options.approvalRequired}`);
    console.log(`  • Reviewer: ${options.reviewer}`);
  }
  
  console.log(`\n🎛️  Coordination Strategy:`);
  console.log(`  • Agent Selection: ${options.agentSelection}`);
  console.log(`  • Task Scheduling: ${options.taskScheduling}`);
  console.log(`  • Load Balancing: ${options.loadBalancing}`);
  console.log(`  • Fault Tolerance: ${options.faultTolerance}`);
  console.log(`  • Communication: ${options.communication}`);
}

function showSwarmHelp(): void {
  console.log(`
🐝 Claude Flow Advanced Swarm System

USAGE:
  claude-flow swarm <objective> [options]

EXAMPLES:
  claude-flow swarm "Build a REST API" --strategy development
  claude-flow swarm "Research cloud architecture" --strategy research --ui
  claude-flow swarm "Analyze data trends" --strategy analysis --parallel
  claude-flow swarm "Optimize performance" --distributed --monitor
  claude-flow swarm "Create GitHub issues for bugs" --interactive --reviewer @username

STRATEGIES:
  auto           Automatically determine best approach (default)
  research       Research and information gathering
  development    Software development and coding
  analysis       Data analysis and insights
  testing        Quality assurance and testing
  optimization   Performance optimization
  maintenance    Code maintenance and refactoring

MODES:
  centralized    Single coordinator managing all agents (default)
  distributed    Multiple coordinators with shared responsibility
  hierarchical   Tree structure with team leads
  mesh           Peer-to-peer agent coordination
  parallel       Force parallel execution mode

OPTIONS:
  --strategy <type>      Swarm strategy to use (default: auto)
  --mode <type>          Coordination mode (default: centralized)
  --max-agents <n>       Maximum number of agents (default: 5)
  --max-tasks <n>        Maximum concurrent tasks (default: 100)
  --timeout <min>        Execution timeout in minutes (default: 60)
  
  --parallel             Enable parallel task execution
  --distributed          Enable distributed coordination
  --background           Run swarm in background mode
  
  --review               Enable code review mode
  --testing              Enable testing mode
  --monitor              Enable real-time monitoring
  --verbose, -v          Show detailed execution logs
  
  --interactive          Enable interactive approval mode
  --approval-required    Require approval before executing changes
  --reviewer <name>      Set reviewer name (default: current user)
  
  --ui                   Launch interactive web UI
  --dry-run, -d          Show configuration without executing
  
  --memory-namespace <ns> Memory namespace (default: swarm)
  --encryption           Enable memory encryption
  --help, -h             Show this help message

INTERACTIVE APPROVAL MODE:
  When --interactive or --approval-required is set:
  - Claude will present a detailed plan before making changes
  - You must explicitly approve with "APPROVED"
  - You can request modifications to the plan
  - Implementation only proceeds after approval

ADVANCED OPTIONS:
  --agent-selection <strategy>   Agent selection strategy
  --task-scheduling <strategy>   Task scheduling algorithm
  --load-balancing <strategy>    Load balancing method
  --fault-tolerance <strategy>   Fault tolerance approach
  --quality-threshold <n>        Quality threshold (0-1)

For more information, see: https://github.com/ruvnet/claude-flow
`);
}

/**
 * Output JSON results for non-interactive mode
 */
async function outputJsonResults(coordinator: SwarmCoordinator, options: any): Promise<void> {
  try {
    // Get the final status from coordinator
    const swarmStatus = coordinator.getSwarmStatus();
    const finalStatus = swarmStatus.status === 'completed' ? 'completed' : 
                       swarmStatus.status === 'failed' ? 'failed' : 
                       swarmStatus.status === 'timeout' ? 'timeout' : 'cancelled';
    
    // Get JSON output from coordinator
    const jsonOutput = coordinator.getJsonOutput(finalStatus);
    
    if (!jsonOutput) {
      // Fallback: create basic JSON structure if aggregator wasn't enabled
      const basicOutput = {
        swarmId: coordinator.getSwarmId(),
        status: finalStatus,
        timestamp: new Date().toISOString(),
        error: 'JSON output aggregation was not properly enabled'
      };
      const fallbackJson = JSON.stringify(basicOutput, null, 2);
      
      if (options.outputFile) {
        await fs.writeFile(options.outputFile, fallbackJson);
      } else {
        console.log(fallbackJson);
      }
      return;
    }
    
    // Output to file or stdout
    if (options.outputFile) {
      await coordinator.saveJsonOutput(options.outputFile, finalStatus);
    } else {
      // Output to stdout for command capture
      console.log(jsonOutput);
    }
    
  } catch (error) {
    // Even if there's an error, output a JSON structure
    const errorOutput = {
      swarmId: coordinator.getSwarmId(),
      status: 'failed',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      details: 'Failed to generate JSON output'
    };
    
    const errorJson = JSON.stringify(errorOutput, null, 2);
    
    if (options.outputFile) {
      try {
        await fs.writeFile(options.outputFile, errorJson);
      } catch (writeError) {
        console.error(errorJson);
      }
    } else {
      console.log(errorJson);
    }
  }
}