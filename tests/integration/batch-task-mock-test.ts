/**
 * Mock-based test for Claude-Flow batch task system
 * This test uses mocked components to demonstrate the task system without full dependencies
 */

import { EventBus } from '../../src/core/event-bus.ts';
import { Logger, ILogger } from '../../src/core/logger.ts';
import { IEventBus } from '../../src/core/event-bus.ts';
import { Task, SystemEvents, AgentProfile } from '../../src/utils/types.ts';
import { delay } from '../../src/utils/helpers.ts';

// Simulate task processing
class MockTaskProcessor {
  private eventBus: IEventBus;
  private logger: ILogger;
  private activeTasks = new Map<string, Task>();
  private agents = new Map<string, AgentProfile>();
  private taskQueues = new Map<string, Task[]>(); // agentId -> tasks
  
  constructor(eventBus: IEventBus, logger: ILogger) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.setupEventHandlers();
  }
  
  // Spawn a mock agent
  async spawnAgent(profile: AgentProfile): Promise<string> {
    this.agents.set(profile.id, profile);
    this.taskQueues.set(profile.id, []);
    
    this.eventBus.emit(SystemEvents.AGENT_SPAWNED, {
      agentId: profile.id,
      profile,
      sessionId: `session-${profile.id}`,
    });
    
    // Start agent worker
    this.startAgentWorker(profile.id);
    
    return `session-${profile.id}`;
  }
  
  // Assign task to best available agent
  async assignTask(task: Task): Promise<void> {
    const agent = this.selectBestAgent(task);
    if (!agent) {
      throw new Error('No suitable agent available');
    }
    
    task.assignedAgent = agent.id;
    task.status = 'assigned';
    
    const queue = this.taskQueues.get(agent.id)!;
    queue.push(task);
    
    this.eventBus.emit(SystemEvents.TASK_CREATED, { task });
    this.eventBus.emit(SystemEvents.TASK_ASSIGNED, {
      taskId: task.id,
      agentId: agent.id,
    });
    
    this.logger.info(`Task ${task.id} assigned to agent ${agent.id}`);
  }
  
  // Select best agent based on capabilities and load
  private selectBestAgent(task: Task): AgentProfile | undefined {
    const requiredCaps = (task.metadata?.requiredCapabilities as string[]) || [];
    let bestAgent: AgentProfile | undefined;
    let minLoad = Infinity;
    
    for (const [agentId, profile] of this.agents) {
      // Check capabilities
      const hasRequiredCaps = requiredCaps.every(cap => 
        profile.capabilities.includes(cap)
      );
      
      if (!hasRequiredCaps) continue;
      
      // Check load
      const queue = this.taskQueues.get(agentId)!;
      const load = queue.length;
      
      if (load < profile.maxConcurrentTasks && load < minLoad) {
        minLoad = load;
        bestAgent = profile;
      }
    }
    
    return bestAgent;
  }
  
  // Simulate agent processing tasks
  private async startAgentWorker(agentId: string): Promise<void> {
    const profile = this.agents.get(agentId)!;
    const queue = this.taskQueues.get(agentId)!;
    
    while (this.agents.has(agentId)) {
      if (queue.length === 0) {
        await delay(100);
        continue;
      }
      
      // Process tasks up to max concurrent limit
      const tasksToProcess = queue.splice(0, profile.maxConcurrentTasks);
      
      // Process tasks in parallel
      await Promise.all(tasksToProcess.map(task => 
        this.processTask(task, agentId)
      ));
    }
  }
  
  // Simulate task processing
  private async processTask(task: Task, agentId: string): Promise<void> {
    try {
      // Start task
      task.status = 'running';
      task.startedAt = new Date();
      this.activeTasks.set(task.id, task);
      
      this.eventBus.emit(SystemEvents.TASK_STARTED, {
        taskId: task.id,
        agentId,
      });
      
      // Simulate processing time based on complexity
      const complexity = (task.input.parameters as any)?.complexity || 'low';
      const baseTime = complexity === 'high' ? 2000 : 1000;
      const processingTime = baseTime + Math.random() * 1000;
      
      await delay(processingTime);
      
      // Simulate occasional failures
      if (Math.random() < 0.1) {
        throw new Error('Simulated task failure');
      }
      
      // Complete task
      task.status = 'completed';
      task.completedAt = new Date();
      task.output = {
        result: `Processed ${task.type} task`,
        processingTime,
        agentId,
        metrics: {
          dataProcessed: Math.floor(Math.random() * 1000),
          itemsAnalyzed: Math.floor(Math.random() * 100),
        },
      };
      
      this.eventBus.emit(SystemEvents.TASK_COMPLETED, {
        taskId: task.id,
        result: task.output,
      });
      
    } catch (error) {
      task.status = 'failed';
      task.completedAt = new Date();
      task.error = error as Error;
      
      this.eventBus.emit(SystemEvents.TASK_FAILED, {
        taskId: task.id,
        error,
      });
    } finally {
      this.activeTasks.delete(task.id);
    }
  }
  
  private setupEventHandlers(): void {
    this.eventBus.on(SystemEvents.AGENT_TERMINATED, (data: any) => {
      const { agentId } = data;
      this.agents.delete(agentId);
      this.taskQueues.delete(agentId);
    });
  }
  
  getMetrics() {
    const totalQueued = Array.from(this.taskQueues.values())
      .reduce((sum, queue) => sum + queue.length, 0);
    
    return {
      activeAgents: this.agents.size,
      activeTasks: this.activeTasks.size,
      queuedTasks: totalQueued,
    };
  }
}

// Test runner
export async function runMockBatchTest() {
  console.log('🧪 Running Mock Batch Task Test\n');
  
  const eventBus = new EventBus();
  const logger = new Logger({ level: 'info', format: 'json', destination: 'console' }, { component: 'mock-test' });
  const processor = new MockTaskProcessor(eventBus, logger);
  
  // Track metrics
  const metrics = {
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalProcessingTime: 0,
  };
  
  const taskStartTimes = new Map<string, number>();
  
  // Set up event tracking
  eventBus.on(SystemEvents.TASK_CREATED, () => metrics.tasksCreated++);
  eventBus.on(SystemEvents.TASK_STARTED, (data: any) => {
    taskStartTimes.set(data.taskId, Date.now());
  });
  eventBus.on(SystemEvents.TASK_COMPLETED, (data: any) => {
    metrics.tasksCompleted++;
    const startTime = taskStartTimes.get(data.taskId);
    if (startTime) {
      metrics.totalProcessingTime += Date.now() - startTime;
    }
  });
  eventBus.on(SystemEvents.TASK_FAILED, () => metrics.tasksFailed++);
  
  try {
    // Phase 1: Create agents
    console.log('📋 Creating agents...');
    const agents: AgentProfile[] = [
      {
        id: 'fast-agent-1',
        name: 'Fast Agent 1',
        type: 'implementer',
        capabilities: ['coding', 'testing'],
        systemPrompt: 'Fast processing agent',
        maxConcurrentTasks: 3,
        priority: 90,
      },
      {
        id: 'fast-agent-2',
        name: 'Fast Agent 2',
        type: 'implementer',
        capabilities: ['coding', 'optimization'],
        systemPrompt: 'Fast processing agent',
        maxConcurrentTasks: 3,
        priority: 90,
      },
      {
        id: 'research-agent',
        name: 'Research Agent',
        type: 'researcher',
        capabilities: ['research', 'analysis'],
        systemPrompt: 'Research agent',
        maxConcurrentTasks: 2,
        priority: 80,
      },
      {
        id: 'analyst-agent',
        name: 'Analyst Agent',
        type: 'analyst',
        capabilities: ['analysis', 'reporting'],
        systemPrompt: 'Analysis agent',
        maxConcurrentTasks: 4,
        priority: 70,
      },
    ];
    
    // Spawn agents in parallel
    await Promise.all(agents.map(agent => processor.spawnAgent(agent)));
    console.log(`✅ Spawned ${agents.length} agents\n`);
    
    // Phase 2: Create test tasks
    console.log('📋 Creating test tasks...');
    const taskBatches: Task[][] = [];
    
    // Batch 1: Coding tasks
    taskBatches.push([
      {
        id: 'code-1',
        type: 'implement',
        description: 'Implement feature A',
        priority: 90,
        dependencies: [],
        status: 'pending',
        input: { feature: 'A', parameters: { complexity: 'high' } },
        createdAt: new Date(),
        metadata: { requiredCapabilities: ['coding'] },
      },
      {
        id: 'code-2',
        type: 'implement',
        description: 'Implement feature B',
        priority: 85,
        dependencies: [],
        status: 'pending',
        input: { feature: 'B', parameters: { complexity: 'low' } },
        createdAt: new Date(),
        metadata: { requiredCapabilities: ['coding'] },
      },
      {
        id: 'code-3',
        type: 'implement',
        description: 'Optimize module C',
        priority: 80,
        dependencies: [],
        status: 'pending',
        input: { module: 'C', parameters: { complexity: 'high' } },
        createdAt: new Date(),
        metadata: { requiredCapabilities: ['coding', 'optimization'] },
      },
    ]);
    
    // Batch 2: Research tasks
    taskBatches.push([
      {
        id: 'research-1',
        type: 'research',
        description: 'Research algorithm X',
        priority: 95,
        dependencies: [],
        status: 'pending',
        input: { topic: 'algorithm X', parameters: { complexity: 'high' } },
        createdAt: new Date(),
        metadata: { requiredCapabilities: ['research'] },
      },
      {
        id: 'research-2',
        type: 'research',
        description: 'Analyze dataset Y',
        priority: 75,
        dependencies: [],
        status: 'pending',
        input: { dataset: 'Y', parameters: { complexity: 'low' } },
        createdAt: new Date(),
        metadata: { requiredCapabilities: ['research', 'analysis'] },
      },
    ]);
    
    // Batch 3: Analysis tasks
    taskBatches.push([
      {
        id: 'analyze-1',
        type: 'analyze',
        description: 'Analyze performance metrics',
        priority: 70,
        dependencies: [],
        status: 'pending',
        input: { metrics: 'performance', parameters: { complexity: 'low' } },
        createdAt: new Date(),
        metadata: { requiredCapabilities: ['analysis'] },
      },
      {
        id: 'report-1',
        type: 'report',
        description: 'Generate weekly report',
        priority: 60,
        dependencies: [],
        status: 'pending',
        input: { type: 'weekly', parameters: { complexity: 'low' } },
        createdAt: new Date(),
        metadata: { requiredCapabilities: ['reporting'] },
      },
    ]);
    
    console.log(`✅ Created ${taskBatches.length} task batches\n`);
    
    // Phase 3: Submit tasks in batches
    console.log('📋 Submitting tasks in batches...');
    const startTime = Date.now();
    
    for (let i = 0; i < taskBatches.length; i++) {
      const batch = taskBatches[i];
      console.log(`\n🚀 Submitting batch ${i + 1} (${batch.length} tasks)...`);
      
      // Submit all tasks in batch in parallel
      await Promise.all(batch.map(async task => {
        try {
          await processor.assignTask(task);
          console.log(`  ✅ Assigned: ${task.id} - ${task.description}`);
        } catch (error) {
          console.error(`  ❌ Failed to assign ${task.id}:`, error);
        }
      }));
      
      // Show current metrics
      const currentMetrics = processor.getMetrics();
      console.log(`  📊 Current state: ${currentMetrics.activeTasks} active, ${currentMetrics.queuedTasks} queued`);
    }
    
    console.log('\n⏳ Waiting for all tasks to complete...');
    
    // Monitor progress
    const progressInterval = setInterval(() => {
      const current = processor.getMetrics();
      console.log(`📊 Progress: ${metrics.tasksCompleted}/${metrics.tasksCreated} completed, ${current.activeTasks} active`);
    }, 1000);
    
    // Wait for all tasks to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const checkInterval = 100;
    let elapsed = 0;
    
    while (metrics.tasksCompleted + metrics.tasksFailed < metrics.tasksCreated && elapsed < timeout) {
      await delay(checkInterval);
      elapsed += checkInterval;
    }
    
    clearInterval(progressInterval);
    
    const totalTime = Date.now() - startTime;
    
    // Phase 4: Display results
    console.log('\n' + '='.repeat(50));
    console.log('📊 FINAL RESULTS');
    console.log('='.repeat(50));
    console.log(`\n⏱️  Total execution time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`📋 Tasks created: ${metrics.tasksCreated}`);
    console.log(`✅ Tasks completed: ${metrics.tasksCompleted}`);
    console.log(`❌ Tasks failed: ${metrics.tasksFailed}`);
    console.log(`⚡ Average task time: ${(metrics.totalProcessingTime / metrics.tasksCompleted).toFixed(0)}ms`);
    console.log(`🚀 Throughput: ${(metrics.tasksCompleted / (totalTime / 1000)).toFixed(2)} tasks/second`);
    
    // Agent utilization
    console.log('\n👥 Agent Performance:');
    const agentMetrics = processor.getMetrics();
    console.log(`  Active agents: ${agentMetrics.activeAgents}`);
    console.log(`  Tasks per agent: ${(metrics.tasksCreated / agents.length).toFixed(1)}`);
    
    console.log('\n✅ Mock batch test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run if main
if (import.meta.main) {
  runMockBatchTest().catch(console.error);
}
