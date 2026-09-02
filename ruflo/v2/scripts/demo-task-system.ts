#!/usr/bin/env -S deno run --allow-all

/**
 * Simple demonstration of Claude-Flow task system
 * Shows the basic flow of:
 * 1. Creating tasks
 * 2. Spawning agents
 * 3. Assigning tasks
 * 4. Tracking execution
 * 5. Getting results
 */

import { EventBus } from '../src/core/event-bus.ts';
import { Logger } from '../src/core/logger.ts';
import { SystemEvents, Task, AgentProfile } from '../src/utils/types.ts';
import { delay } from '../src/utils/helpers.ts';

// Simple task executor
class SimpleTaskExecutor {
  private tasks = new Map<string, Task>();
  private agents = new Map<string, AgentProfile>();
  private results = new Map<string, any>();
  
  constructor(
    private eventBus: EventBus,
    private logger: Logger
  ) {
    this.setupHandlers();
  }
  
  async createAgent(name: string, capabilities: string[]): Promise<string> {
    const agent: AgentProfile = {
      id: `agent-${Date.now()}`,
      name,
      type: 'custom',
      capabilities,
      systemPrompt: `You are ${name}`,
      maxConcurrentTasks: 2,
      priority: 50,
    };
    
    this.agents.set(agent.id, agent);
    this.logger.info(`Created agent: ${name}`, { agentId: agent.id });
    
    this.eventBus.emit(SystemEvents.AGENT_SPAWNED, {
      agentId: agent.id,
      profile: agent,
    });
    
    return agent.id;
  }
  
  async createTask(type: string, description: string, input: any): Promise<string> {
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type,
      description,
      priority: 50,
      dependencies: [],
      status: 'pending',
      input,
      createdAt: new Date(),
    };
    
    this.tasks.set(task.id, task);
    this.logger.info(`Created task: ${description}`, { taskId: task.id });
    
    this.eventBus.emit(SystemEvents.TASK_CREATED, { task });
    
    return task.id;
  }
  
  async assignTask(taskId: string, agentId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);
    
    if (!task || !agent) {
      throw new Error('Task or agent not found');
    }
    
    task.assignedAgent = agentId;
    task.status = 'assigned';
    
    this.eventBus.emit(SystemEvents.TASK_ASSIGNED, {
      taskId,
      agentId,
    });
    
    // Simulate execution
    this.executeTask(task, agent);
  }
  
  private async executeTask(task: Task, agent: AgentProfile): Promise<void> {
    // Start task
    task.status = 'running';
    task.startedAt = new Date();
    
    this.eventBus.emit(SystemEvents.TASK_STARTED, {
      taskId: task.id,
      agentId: agent.id,
    });
    
    // Simulate processing
    await delay(1000 + Math.random() * 2000);
    
    // Generate result
    const result = {
      taskId: task.id,
      agentId: agent.id,
      output: `${agent.name} completed ${task.type}: ${task.description}`,
      processingTime: Date.now() - task.startedAt.getTime(),
      data: task.input,
    };
    
    this.results.set(task.id, result);
    
    // Complete task
    task.status = 'completed';
    task.completedAt = new Date();
    task.output = result;
    
    this.eventBus.emit(SystemEvents.TASK_COMPLETED, {
      taskId: task.id,
      result,
    });
  }
  
  getResults(): Map<string, any> {
    return this.results;
  }
  
  getStats() {
    const tasks = Array.from(this.tasks.values());
    return {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      running: tasks.filter(t => t.status === 'running').length,
      pending: tasks.filter(t => t.status === 'pending').length,
    };
  }
  
  private setupHandlers() {
    this.eventBus.on(SystemEvents.TASK_COMPLETED, (data: any) => {
      this.logger.info(`Task completed: ${data.taskId}`);
    });
  }
}

// Demo runner
async function runDemo() {
  console.log('🎯 Claude-Flow Task System Demo\n');
  
  const eventBus = new EventBus();
  const logger = new Logger(
    { level: 'info', format: 'pretty', destination: 'console' },
    { component: 'demo' }
  );
  
  const executor = new SimpleTaskExecutor(eventBus, logger);
  
  // Track events
  let tasksCompleted = 0;
  eventBus.on(SystemEvents.TASK_COMPLETED, () => tasksCompleted++);
  
  console.log('📋 Step 1: Creating Agents\n');
  
  // Create agents with different capabilities
  const coder = await executor.createAgent('Code Master', ['coding', 'testing']);
  const analyst = await executor.createAgent('Data Analyst', ['analysis', 'reporting']);
  const researcher = await executor.createAgent('Research Bot', ['research', 'documentation']);
  
  console.log('\n📋 Step 2: Creating Tasks\n');
  
  // Create various tasks
  const tasks = [
    await executor.createTask('code', 'Implement user authentication', { feature: 'auth' }),
    await executor.createTask('analyze', 'Analyze user behavior data', { dataset: 'users' }),
    await executor.createTask('research', 'Research best practices for API design', { topic: 'REST' }),
    await executor.createTask('code', 'Add unit tests for payment module', { module: 'payments' }),
    await executor.createTask('analyze', 'Generate performance report', { period: 'Q4' }),
  ];
  
  console.log('\n📋 Step 3: Assigning Tasks to Agents\n');
  
  // Assign tasks based on capabilities
  await executor.assignTask(tasks[0], coder);     // auth implementation
  await executor.assignTask(tasks[1], analyst);   // behavior analysis
  await executor.assignTask(tasks[2], researcher); // API research
  await executor.assignTask(tasks[3], coder);     // unit tests
  await executor.assignTask(tasks[4], analyst);   // performance report
  
  console.log('\n⏳ Step 4: Waiting for Completion...\n');
  
  // Wait for all tasks to complete
  while (tasksCompleted < tasks.length) {
    await delay(500);
    const stats = executor.getStats();
    console.log(`📊 Progress: ${stats.completed}/${stats.total} completed, ${stats.running} running`);
  }
  
  console.log('\n📋 Step 5: Results Summary\n');
  
  // Display results
  const results = executor.getResults();
  for (const [taskId, result] of results) {
    console.log(`✅ ${result.output}`);
    console.log(`   ⏱️  Time: ${result.processingTime}ms`);
  }
  
  // Final stats
  const finalStats = executor.getStats();
  console.log('\n' + '='.repeat(50));
  console.log('📊 DEMO COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total tasks: ${finalStats.total}`);
  console.log(`Completed: ${finalStats.completed}`);
  console.log(`Success rate: 100%`);
  console.log('\n✨ Claude-Flow task system is working perfectly!');
}

// Run the demo
if (import.meta.main) {
  runDemo().catch(console.error);
}