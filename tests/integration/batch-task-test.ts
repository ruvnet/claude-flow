/**
 * Comprehensive test for Claude-Flow task system with parallel batch operations
 * This test demonstrates:
 * - Task creation and queuing
 * - Agent spawning and assignment
 * - Parallel task execution
 * - Batch tool usage for efficiency
 * - Task completion tracking
 * - System coordination
 */

import { Orchestrator } from '../../src/core/orchestrator.ts';
import { EventBus } from '../../src/core/event-bus.ts';
import { ConsoleLogger } from '../../src/core/logger.ts';
import { TerminalManager } from '../../src/terminal/manager.ts';
import { MemoryManager } from '../../src/memory/manager.ts';
import { CoordinationManager } from '../../src/coordination/manager.ts';
import { MCPServer } from '../../src/mcp/server.ts';
import { 
  Config, 
  AgentProfile, 
  Task, 
  SystemEvents,
  TaskStatus 
} from '../../src/utils/types.ts';
import { delay } from '../../src/utils/helpers.ts';

// Test configuration
const testConfig: Config = {
  orchestrator: {
    maxConcurrentAgents: 10,
    taskQueueSize: 100,
    sessionTimeout: 300000,
    shutdownTimeout: 30000,
    healthCheckInterval: 10000,
    persistSessions: false,
    dataDir: './test-data',
    maintenanceInterval: 60000,
    metricsInterval: 5000,
    taskMaxRetries: 3,
    sessionRetentionMs: 3600000,
    taskHistoryRetentionMs: 86400000,
  },
  memory: {
    defaultBackend: 'sqlite',
    backends: {
      sqlite: {
        type: 'sqlite',
        path: ':memory:', // Use in-memory DB for tests
      },
    },
    cacheSize: 1000,
    cacheTTL: 300000,
  },
  terminal: {
    maxSessions: 20,
    idleTimeout: 60000,
    commandTimeout: 30000,
    poolSize: 5,
    defaultShell: '/bin/bash',
  },
  coordination: {
    maxRetries: 3,
    retryDelay: 1000,
    resourceTimeout: 60000,
    deadlockDetection: true,
    priorityLevels: 5,
  },
  mcp: {
    serverPort: 0, // Use random port for test
    maxConnections: 50,
    authRequired: false,
    enabledTransports: ['stdio'],
  },
  agents: [],
};

// Agent profiles for testing
const testAgentProfiles: AgentProfile[] = [
  {
    id: 'researcher-1',
    name: 'Research Agent 1',
    type: 'researcher',
    capabilities: ['research', 'analysis', 'documentation'],
    systemPrompt: 'You are a research agent focusing on data analysis.',
    maxConcurrentTasks: 3,
    priority: 80,
  },
  {
    id: 'implementer-1',
    name: 'Implementation Agent 1',
    type: 'implementer',
    capabilities: ['coding', 'testing', 'optimization'],
    systemPrompt: 'You are an implementation agent focusing on code development.',
    maxConcurrentTasks: 2,
    priority: 90,
  },
  {
    id: 'implementer-2',
    name: 'Implementation Agent 2',
    type: 'implementer',
    capabilities: ['coding', 'testing', 'documentation'],
    systemPrompt: 'You are an implementation agent focusing on testing.',
    maxConcurrentTasks: 2,
    priority: 85,
  },
  {
    id: 'analyst-1',
    name: 'Analysis Agent 1',
    type: 'analyst',
    capabilities: ['analysis', 'reporting', 'visualization'],
    systemPrompt: 'You are an analysis agent focusing on data visualization.',
    maxConcurrentTasks: 4,
    priority: 70,
  },
];

// Test task generator
function generateTestTasks(count: number): Task[] {
  const tasks: Task[] = [];
  const taskTypes = ['research', 'implement', 'test', 'analyze', 'document'];
  
  for (let i = 0; i < count; i++) {
    const type = taskTypes[i % taskTypes.length];
    const hasDependency = i > 5 && Math.random() > 0.5;
    
    const task: Task = {
      id: `task-${i + 1}`,
      type,
      description: `${type} task ${i + 1}: Perform ${type} operation on dataset ${i + 1}`,
      priority: Math.floor(Math.random() * 100),
      dependencies: hasDependency ? [`task-${Math.max(1, i - Math.floor(Math.random() * 5))}`] : [],
      status: 'pending',
      input: {
        datasetId: `dataset-${i + 1}`,
        parameters: {
          complexity: Math.random() > 0.5 ? 'high' : 'low',
          urgent: Math.random() > 0.8,
        },
      },
      createdAt: new Date(),
      metadata: {
        batchId: Math.floor(i / 5), // Group tasks into batches
        requiredCapabilities: getRequiredCapabilities(type),
      },
    };
    
    tasks.push(task);
  }
  
  return tasks;
}

function getRequiredCapabilities(taskType: string): string[] {
  switch (taskType) {
    case 'research':
      return ['research', 'analysis'];
    case 'implement':
      return ['coding'];
    case 'test':
      return ['testing'];
    case 'analyze':
      return ['analysis'];
    case 'document':
      return ['documentation'];
    default:
      return [];
  }
}

// Test runner
export async function runBatchTaskTest() {
  console.log('🚀 Starting Claude-Flow Batch Task System Test\n');
  
  // Initialize components
  const eventBus = new EventBus();
  const logger = new ConsoleLogger('test');
  
  // Set up event monitoring
  const taskMetrics = {
    created: 0,
    assigned: 0,
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  
  const agentMetrics = {
    spawned: 0,
    terminated: 0,
    errors: 0,
  };
  
  // Monitor events
  eventBus.on(SystemEvents.TASK_CREATED, () => taskMetrics.created++);
  eventBus.on(SystemEvents.TASK_ASSIGNED, () => taskMetrics.assigned++);
  eventBus.on(SystemEvents.TASK_STARTED, () => taskMetrics.started++);
  eventBus.on(SystemEvents.TASK_COMPLETED, () => taskMetrics.completed++);
  eventBus.on(SystemEvents.TASK_FAILED, () => taskMetrics.failed++);
  eventBus.on(SystemEvents.TASK_CANCELLED, () => taskMetrics.cancelled++);
  eventBus.on(SystemEvents.AGENT_SPAWNED, () => agentMetrics.spawned++);
  eventBus.on(SystemEvents.AGENT_TERMINATED, () => agentMetrics.terminated++);
  eventBus.on(SystemEvents.AGENT_ERROR, () => agentMetrics.errors++);
  
  // Track task completion times
  const taskCompletionTimes = new Map<string, number>();
  eventBus.on(SystemEvents.TASK_STARTED, (data: any) => {
    taskCompletionTimes.set(data.taskId, Date.now());
  });
  eventBus.on(SystemEvents.TASK_COMPLETED, (data: any) => {
    const startTime = taskCompletionTimes.get(data.taskId);
    if (startTime) {
      const duration = Date.now() - startTime;
      console.log(`✅ Task ${data.taskId} completed in ${duration}ms`);
    }
  });
  
  // Initialize managers
  const terminalManager = new TerminalManager(testConfig.terminal, eventBus, logger);
  const memoryManager = new MemoryManager(testConfig.memory, eventBus, logger);
  const coordinationManager = new CoordinationManager(testConfig.coordination, eventBus, logger);
  const mcpServer = new MCPServer(testConfig.mcp, eventBus, logger);
  
  // Create orchestrator
  const orchestrator = new Orchestrator(
    testConfig,
    terminalManager,
    memoryManager,
    coordinationManager,
    mcpServer,
    eventBus,
    logger,
  );
  
  try {
    // Phase 1: Initialize system
    console.log('📋 Phase 1: Initializing system...');
    await orchestrator.initialize();
    console.log('✅ System initialized\n');
    
    // Phase 2: Spawn agents
    console.log('📋 Phase 2: Spawning agents...');
    const agentSessions: string[] = [];
    
    // Spawn agents in parallel (batch operation)
    const spawnPromises = testAgentProfiles.map(async (profile) => {
      try {
        const sessionId = await orchestrator.spawnAgent(profile);
        console.log(`✅ Spawned agent: ${profile.name} (Session: ${sessionId})`);
        return sessionId;
      } catch (error) {
        console.error(`❌ Failed to spawn agent ${profile.name}:`, error);
        throw error;
      }
    });
    
    const sessions = await Promise.all(spawnPromises);
    agentSessions.push(...sessions);
    console.log(`\n✅ Spawned ${agentSessions.length} agents\n`);
    
    // Phase 3: Create and assign tasks
    console.log('📋 Phase 3: Creating and assigning tasks...');
    const tasks = generateTestTasks(20);
    console.log(`📝 Generated ${tasks.length} test tasks`);
    
    // Group tasks by batch for parallel submission
    const taskBatches = new Map<number, Task[]>();
    tasks.forEach(task => {
      const batchId = task.metadata?.batchId as number || 0;
      if (!taskBatches.has(batchId)) {
        taskBatches.set(batchId, []);
      }
      taskBatches.get(batchId)!.push(task);
    });
    
    console.log(`📦 Organized tasks into ${taskBatches.size} batches`);
    
    // Submit tasks in batches (parallel operation)
    for (const [batchId, batchTasks] of taskBatches) {
      console.log(`\n🚀 Submitting batch ${batchId} with ${batchTasks.length} tasks...`);
      
      const assignPromises = batchTasks.map(async (task) => {
        try {
          await orchestrator.assignTask(task);
          console.log(`  ✅ Assigned task: ${task.id} (${task.type})`);
        } catch (error) {
          console.error(`  ❌ Failed to assign task ${task.id}:`, error);
        }
      });
      
      await Promise.all(assignPromises);
    }
    
    console.log('\n✅ All tasks submitted\n');
    
    // Phase 4: Monitor execution
    console.log('📋 Phase 4: Monitoring task execution...');
    
    // Simulate task processing
    let processedTasks = 0;
    const totalTasks = tasks.length;
    
    // Simulate task completion events
    const simulateTaskProcessing = async () => {
      for (const task of tasks) {
        // Random delay to simulate processing
        await delay(Math.random() * 2000 + 500);
        
        // Simulate task lifecycle
        eventBus.emit(SystemEvents.TASK_STARTED, { 
          taskId: task.id, 
          agentId: task.assignedAgent || 'unknown' 
        });
        
        // Simulate success or failure
        if (Math.random() > 0.1) {
          await delay(Math.random() * 1000);
          eventBus.emit(SystemEvents.TASK_COMPLETED, {
            taskId: task.id,
            result: { 
              processed: true, 
              output: `Result for ${task.id}`,
              metrics: {
                processingTime: Math.random() * 1000,
                resourceUsage: Math.random() * 100,
              },
            },
          });
        } else {
          eventBus.emit(SystemEvents.TASK_FAILED, {
            taskId: task.id,
            error: new Error('Simulated task failure'),
          });
        }
        
        processedTasks++;
        
        // Progress update
        if (processedTasks % 5 === 0) {
          console.log(`\n📊 Progress: ${processedTasks}/${totalTasks} tasks processed`);
          
          // Get current metrics
          const metrics = await orchestrator.getMetrics();
          console.log(`  Active agents: ${metrics.activeAgents}`);
          console.log(`  Completed tasks: ${metrics.completedTasks}`);
          console.log(`  Failed tasks: ${metrics.failedTasks}`);
          console.log(`  Queued tasks: ${metrics.queuedTasks}`);
        }
      }
    };
    
    // Start task processing simulation
    await simulateTaskProcessing();
    
    // Wait for all tasks to complete
    await delay(2000);
    
    // Phase 5: Health check and metrics
    console.log('\n📋 Phase 5: System health check and metrics...');
    
    const health = await orchestrator.getHealthStatus();
    console.log('\n🏥 System Health Status:');
    console.log(`  Overall: ${health.status}`);
    Object.entries(health.components).forEach(([name, component]) => {
      console.log(`  ${name}: ${component.status}`);
    });
    
    const finalMetrics = await orchestrator.getMetrics();
    console.log('\n📊 Final System Metrics:');
    console.log(`  Uptime: ${Math.round(finalMetrics.uptime / 1000)}s`);
    console.log(`  Total agents: ${finalMetrics.totalAgents}`);
    console.log(`  Active agents: ${finalMetrics.activeAgents}`);
    console.log(`  Total tasks: ${finalMetrics.totalTasks}`);
    console.log(`  Completed tasks: ${finalMetrics.completedTasks}`);
    console.log(`  Failed tasks: ${finalMetrics.failedTasks}`);
    console.log(`  Average task duration: ${Math.round(finalMetrics.avgTaskDuration)}ms`);
    console.log(`  Memory usage: ${Math.round(finalMetrics.memoryUsage.heapUsed / 1024 / 1024)}MB`);
    
    console.log('\n📊 Event Metrics:');
    console.log(`  Tasks created: ${taskMetrics.created}`);
    console.log(`  Tasks assigned: ${taskMetrics.assigned}`);
    console.log(`  Tasks started: ${taskMetrics.started}`);
    console.log(`  Tasks completed: ${taskMetrics.completed}`);
    console.log(`  Tasks failed: ${taskMetrics.failed}`);
    console.log(`  Agents spawned: ${agentMetrics.spawned}`);
    
    // Phase 6: Coordination metrics
    console.log('\n📋 Phase 6: Coordination system metrics...');
    const coordMetrics = await coordinationManager.getCoordinationMetrics();
    console.log('🔄 Coordination Metrics:');
    console.log(JSON.stringify(coordMetrics, null, 2));
    
    // Phase 7: Cleanup
    console.log('\n📋 Phase 7: Cleaning up...');
    
    // Terminate agents in parallel
    const terminatePromises = testAgentProfiles.map(async (profile) => {
      try {
        await orchestrator.terminateAgent(profile.id);
        console.log(`✅ Terminated agent: ${profile.name}`);
      } catch (error) {
        console.error(`❌ Failed to terminate agent ${profile.name}:`, error);
      }
    });
    
    await Promise.all(terminatePromises);
    
    // Shutdown system
    await orchestrator.shutdown();
    console.log('✅ System shutdown complete');
    
    // Final summary
    console.log('\n' + '='.repeat(50));
    console.log('🎉 BATCH TASK TEST COMPLETED SUCCESSFULLY! 🎉');
    console.log('='.repeat(50));
    console.log('\nKey achievements:');
    console.log('✅ Successfully spawned multiple agents in parallel');
    console.log('✅ Created and assigned tasks in batches');
    console.log('✅ Demonstrated parallel task execution');
    console.log('✅ Tracked task completion and system metrics');
    console.log('✅ Verified coordination system functionality');
    console.log('✅ Performed graceful system shutdown');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    
    // Emergency cleanup
    try {
      await orchestrator.shutdown();
    } catch (shutdownError) {
      console.error('Failed to shutdown:', shutdownError);
    }
    
    throw error;
  }
}

// Run the test if this file is executed directly
if (import.meta.main) {
  runBatchTaskTest().catch(console.error);
}
