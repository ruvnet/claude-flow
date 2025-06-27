import { SwarmCoordinator, SwarmAgent, SwarmTask, SwarmObjective } from '@/coordination/swarm-coordinator';
import { EventEmitter } from 'events';
import { createDeferred, waitForEvent } from '@test/helpers/test-utils';

// Mock dependencies
jest.mock('@/core/logger');
jest.mock('@/coordination/swarm-monitor');
jest.mock('@/coordination/advanced-scheduler');
jest.mock('@/memory/manager');

describe('SwarmCoordinator', () => {
  let coordinator: SwarmCoordinator;
  
  beforeEach(() => {
    coordinator = new SwarmCoordinator({
      maxAgents: 5,
      maxConcurrentTasks: 3,
      taskTimeout: 5000,
      enableMonitoring: true,
      enableWorkStealing: true,
      maxRetries: 2
    });
  });
  
  afterEach(async () => {
    await coordinator.shutdown();
  });
  
  describe('constructor and initialization', () => {
    it('should initialize with default config', () => {
      const defaultCoordinator = new SwarmCoordinator();
      expect(defaultCoordinator).toBeInstanceOf(SwarmCoordinator);
      expect(defaultCoordinator).toBeInstanceOf(EventEmitter);
    });
    
    it('should merge custom config with defaults', () => {
      const customCoordinator = new SwarmCoordinator({
        maxAgents: 20,
        taskTimeout: 10000
      });
      
      // Access private config through reflection or public method
      const config = (customCoordinator as any).config;
      expect(config.maxAgents).toBe(20);
      expect(config.taskTimeout).toBe(10000);
      expect(config.enableMonitoring).toBe(true); // Default value
    });
    
    it('should start background workers on initialization', async () => {
      await coordinator.start();
      
      const isRunning = (coordinator as any).isRunning;
      expect(isRunning).toBe(true);
    });
  });
  
  describe('Agent Management', () => {
    describe('createAgent', () => {
      it('should create a new agent', () => {
        const agent = coordinator.createAgent({
          name: 'Test Agent',
          type: 'researcher',
          capabilities: ['search', 'analyze']
        });
        
        expect(agent).toMatchObject({
          id: expect.stringMatching(/^agent-/),
          name: 'Test Agent',
          type: 'researcher',
          status: 'idle',
          capabilities: ['search', 'analyze'],
          metrics: {
            tasksCompleted: 0,
            tasksFailed: 0,
            totalDuration: 0,
            lastActivity: expect.any(Date)
          }
        });
      });
      
      it('should emit agent:created event', async () => {
        const eventPromise = waitForEvent(coordinator, 'agent:created');
        
        const agent = coordinator.createAgent({
          name: 'Event Test Agent',
          type: 'developer'
        });
        
        const event = await eventPromise;
        expect(event).toEqual({ agent });
      });
      
      it('should enforce max agents limit', () => {
        // Create max agents
        for (let i = 0; i < 5; i++) {
          coordinator.createAgent({
            name: `Agent ${i}`,
            type: 'researcher'
          });
        }
        
        // Try to create one more
        expect(() => coordinator.createAgent({
          name: 'Excess Agent',
          type: 'developer'
        })).toThrow(/maximum.*agents/i);
      });
      
      it('should store agent in internal map', () => {
        const agent = coordinator.createAgent({
          name: 'Mapped Agent',
          type: 'analyzer'
        });
        
        const retrievedAgent = coordinator.getAgent(agent.id);
        expect(retrievedAgent).toEqual(agent);
      });
    });
    
    describe('getAgent', () => {
      it('should retrieve existing agent', () => {
        const agent = coordinator.createAgent({
          name: 'Retrieve Test',
          type: 'coordinator'
        });
        
        const retrieved = coordinator.getAgent(agent.id);
        expect(retrieved).toEqual(agent);
      });
      
      it('should return undefined for non-existent agent', () => {
        const agent = coordinator.getAgent('non-existent-id');
        expect(agent).toBeUndefined();
      });
    });
    
    describe('getAllAgents', () => {
      it('should return all agents', () => {
        const agents = [
          coordinator.createAgent({ name: 'Agent 1', type: 'researcher' }),
          coordinator.createAgent({ name: 'Agent 2', type: 'developer' }),
          coordinator.createAgent({ name: 'Agent 3', type: 'analyzer' })
        ];
        
        const allAgents = coordinator.getAllAgents();
        expect(allAgents).toHaveLength(3);
        expect(allAgents).toEqual(expect.arrayContaining(agents));
      });
      
      it('should return empty array when no agents', () => {
        const agents = coordinator.getAllAgents();
        expect(agents).toEqual([]);
      });
    });
    
    describe('updateAgentStatus', () => {
      let agent: SwarmAgent;
      
      beforeEach(() => {
        agent = coordinator.createAgent({
          name: 'Status Test Agent',
          type: 'developer'
        });
      });
      
      it('should update agent status', () => {
        coordinator.updateAgentStatus(agent.id, 'busy');
        
        const updated = coordinator.getAgent(agent.id);
        expect(updated?.status).toBe('busy');
      });
      
      it('should emit agent:status-changed event', async () => {
        const eventPromise = waitForEvent(coordinator, 'agent:status-changed');
        
        coordinator.updateAgentStatus(agent.id, 'completed');
        
        const event = await eventPromise;
        expect(event).toEqual({
          agentId: agent.id,
          oldStatus: 'idle',
          newStatus: 'completed'
        });
      });
      
      it('should update lastActivity timestamp', async () => {
        const before = agent.metrics.lastActivity;
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        coordinator.updateAgentStatus(agent.id, 'busy');
        const updated = coordinator.getAgent(agent.id);
        
        expect(updated?.metrics.lastActivity.getTime()).toBeGreaterThan(before.getTime());
      });
    });
    
    describe('removeAgent', () => {
      it('should remove agent and return true', () => {
        const agent = coordinator.createAgent({
          name: 'Remove Test',
          type: 'reviewer'
        });
        
        const removed = coordinator.removeAgent(agent.id);
        expect(removed).toBe(true);
        
        const retrieved = coordinator.getAgent(agent.id);
        expect(retrieved).toBeUndefined();
      });
      
      it('should return false for non-existent agent', () => {
        const removed = coordinator.removeAgent('non-existent');
        expect(removed).toBe(false);
      });
      
      it('should emit agent:removed event', async () => {
        const agent = coordinator.createAgent({
          name: 'Remove Event Test',
          type: 'developer'
        });
        
        const eventPromise = waitForEvent(coordinator, 'agent:removed');
        
        coordinator.removeAgent(agent.id);
        
        const event = await eventPromise;
        expect(event).toEqual({ agentId: agent.id });
      });
      
      it('should not remove agent with active task', () => {
        const agent = coordinator.createAgent({
          name: 'Busy Agent',
          type: 'developer'
        });
        
        // Assign a task to the agent
        const task: SwarmTask = {
          id: 'task-1',
          type: 'development',
          description: 'Active task',
          priority: 1,
          dependencies: [],
          status: 'running',
          assignedTo: agent.id,
          createdAt: new Date(),
          retryCount: 0,
          maxRetries: 3
        };
        
        agent.currentTask = task;
        coordinator.updateAgentStatus(agent.id, 'busy');
        
        expect(() => coordinator.removeAgent(agent.id)).toThrow(/active task/i);
      });
    });
  });
  
  describe('Task Management', () => {
    let agent: SwarmAgent;
    
    beforeEach(() => {
      agent = coordinator.createAgent({
        name: 'Task Test Agent',
        type: 'developer',
        capabilities: ['code', 'test']
      });
    });
    
    describe('createTask', () => {
      it('should create a new task', () => {
        const task = coordinator.createTask({
          type: 'development',
          description: 'Implement feature X',
          priority: 2
        });
        
        expect(task).toMatchObject({
          id: expect.stringMatching(/^task-/),
          type: 'development',
          description: 'Implement feature X',
          priority: 2,
          status: 'pending',
          dependencies: [],
          createdAt: expect.any(Date),
          retryCount: 0,
          maxRetries: 2 // From config
        });
      });
      
      it('should create task with dependencies', () => {
        const task1 = coordinator.createTask({
          type: 'research',
          description: 'Research requirements'
        });
        
        const task2 = coordinator.createTask({
          type: 'development',
          description: 'Implement based on research',
          dependencies: [task1.id]
        });
        
        expect(task2.dependencies).toEqual([task1.id]);
      });
      
      it('should emit task:created event', async () => {
        const eventPromise = waitForEvent(coordinator, 'task:created');
        
        const task = coordinator.createTask({
          type: 'analysis',
          description: 'Analyze data'
        });
        
        const event = await eventPromise;
        expect(event).toEqual({ task });
      });
      
      it('should add task to scheduler if running', async () => {
        await coordinator.start();
        
        const task = coordinator.createTask({
          type: 'testing',
          description: 'Run tests'
        });
        
        // Verify task is tracked
        const retrieved = coordinator.getTask(task.id);
        expect(retrieved).toEqual(task);
      });
    });
    
    describe('assignTask', () => {
      let task: SwarmTask;
      
      beforeEach(() => {
        task = coordinator.createTask({
          type: 'development',
          description: 'Test assignment'
        });
      });
      
      it('should assign task to agent', () => {
        coordinator.assignTask(task.id, agent.id);
        
        const updatedTask = coordinator.getTask(task.id);
        const updatedAgent = coordinator.getAgent(agent.id);
        
        expect(updatedTask?.assignedTo).toBe(agent.id);
        expect(updatedTask?.status).toBe('running');
        expect(updatedAgent?.currentTask?.id).toBe(task.id);
        expect(updatedAgent?.status).toBe('busy');
      });
      
      it('should emit task:assigned event', async () => {
        const eventPromise = waitForEvent(coordinator, 'task:assigned');
        
        coordinator.assignTask(task.id, agent.id);
        
        const event = await eventPromise;
        expect(event).toEqual({
          taskId: task.id,
          agentId: agent.id
        });
      });
      
      it('should throw if task not found', () => {
        expect(() => coordinator.assignTask('non-existent').toBe( agent.id))
          .toThrow(/task.*not found/i);
      });
      
      it('should throw if agent not found', () => {
        expect(() => coordinator.assignTask(task.id).toBe( 'non-existent'))
          .toThrow(/agent.*not found/i);
      });
      
      it('should throw if agent is busy', () => {
        coordinator.updateAgentStatus(agent.id, 'busy');
        
        expect(() => coordinator.assignTask(task.id).toBe( agent.id))
          .toThrow(/agent.*busy/i);
      });
      
      it('should throw if task already assigned', () => {
        coordinator.assignTask(task.id, agent.id);
        
        const agent2 = coordinator.createAgent({
          name: 'Second Agent',
          type: 'developer'
        });
        
        expect(() => coordinator.assignTask(task.id).toBe( agent2.id))
          .toThrow(/already assigned/i);
      });
    });
    
    describe('completeTask', () => {
      let task: SwarmTask;
      
      beforeEach(() => {
        task = coordinator.createTask({
          type: 'development',
          description: 'Complete test'
        });
        coordinator.assignTask(task.id, agent.id);
      });
      
      it('should mark task as completed', () => {
        const result = { success: true, output: 'Task completed' };
        
        coordinator.completeTask(task.id, result);
        
        const updated = coordinator.getTask(task.id);
        expect(updated?.status).toBe('completed');
        expect(updated?.result).toEqual(result);
        expect(updated?.completedAt).toBeDefined();
      });
      
      it('should update agent metrics on success', () => {
        coordinator.completeTask(task.id, { success: true });
        
        const updatedAgent = coordinator.getAgent(agent.id);
        expect(updatedAgent?.metrics.tasksCompleted).toBe(1);
        expect(updatedAgent?.metrics.totalDuration).toBeGreaterThan(0);
        expect(updatedAgent?.status).toBe('idle');
        expect(updatedAgent?.currentTask).toBeUndefined();
      });
      
      it('should emit task:completed event', async () => {
        const eventPromise = waitForEvent(coordinator, 'task:completed');
        
        coordinator.completeTask(task.id, { success: true });
        
        const event = await eventPromise;
        expect(event).toMatchObject({
          taskId: task.id,
          result: { success: true }
        });
      });
    });
    
    describe('failTask', () => {
      let task: SwarmTask;
      
      beforeEach(() => {
        task = coordinator.createTask({
          type: 'testing',
          description: 'Fail test'
        });
        coordinator.assignTask(task.id, agent.id);
      });
      
      it('should mark task as failed', () => {
        const error = 'Connection timeout';
        
        coordinator.failTask(task.id, error);
        
        const updated = coordinator.getTask(task.id);
        expect(updated?.status).toBe('failed');
        expect(updated?.error).toBe(error);
        expect(updated?.completedAt).toBeDefined();
      });
      
      it('should update agent metrics on failure', () => {
        coordinator.failTask(task.id, 'Error occurred');
        
        const updatedAgent = coordinator.getAgent(agent.id);
        expect(updatedAgent?.metrics.tasksFailed).toBe(1);
        expect(updatedAgent?.status).toBe('idle');
      });
      
      it('should retry task if retries available', () => {
        coordinator.failTask(task.id, 'Temporary error');
        
        const updated = coordinator.getTask(task.id);
        expect(updated?.retryCount).toBe(1);
        expect(updated?.status).toBe('pending'); // Re-queued
        expect(updated?.assignedTo).toBeUndefined();
      });
      
      it('should not retry if max retries reached', () => {
        // Fail multiple times
        coordinator.failTask(task.id, 'Error 1');
        coordinator.assignTask(task.id, agent.id);
        coordinator.failTask(task.id, 'Error 2');
        coordinator.assignTask(task.id, agent.id);
        coordinator.failTask(task.id, 'Error 3');
        
        const updated = coordinator.getTask(task.id);
        expect(updated?.status).toBe('failed');
        expect(updated?.retryCount).toBe(2);
      });
      
      it('should emit task:failed event', async () => {
        const eventPromise = waitForEvent(coordinator, 'task:failed');
        
        coordinator.failTask(task.id, 'Test error');
        
        const event = await eventPromise;
        expect(event).toMatchObject({
          taskId: task.id,
          error: 'Test error',
          willRetry: true
        });
      });
    });
  });
  
  describe('Objective Management', () => {
    describe('createObjective', () => {
      it('should create a new objective', () => {
        const objective = coordinator.createObjective({
          description: 'Build feature X',
          strategy: 'development'
        });
        
        expect(objective).toMatchObject({
          id: expect.stringMatching(/^objective-/),
          description: 'Build feature X',
          strategy: 'development',
          tasks: [],
          status: 'planning',
          createdAt: expect.any(Date)
        });
      });
      
      it('should emit objective:created event', async () => {
        const eventPromise = waitForEvent(coordinator, 'objective:created');
        
        const objective = coordinator.createObjective({
          description: 'Research AI models',
          strategy: 'research'
        });
        
        const event = await eventPromise;
        expect(event).toEqual({ objective });
      });
    });
    
    describe('executeObjective', () => {
      it('should start executing an objective', async () => {
        await coordinator.start();
        
        const objective = coordinator.createObjective({
          description: 'Complete analysis',
          strategy: 'analysis'
        });
        
        // Create tasks for the objective
        const tasks = [
          coordinator.createTask({ type: 'research', description: 'Gather data' }),
          coordinator.createTask({ type: 'analysis', description: 'Analyze data' })
        ];
        
        objective.tasks = tasks;
        
        await coordinator.executeObjective(objective.id);
        
        const updated = coordinator.getObjective(objective.id);
        expect(updated?.status).toBe('executing');
      });
      
      it('should decompose objective into tasks', async () => {
        await coordinator.start();
        
        const objective = coordinator.createObjective({
          description: 'Build authentication system',
          strategy: 'development'
        });
        
        // Mock task decomposition
        const decomposeSpy = jest.spyOn(coordinator as any, 'decomposeObjective')
          .mockReturnValue([
            { type: 'development', description: 'Create user model' },
            { type: 'development', description: 'Implement login' },
            { type: 'testing', description: 'Write tests' }
          ]);
        
        await coordinator.executeObjective(objective.id);
        
        expect(decomposeSpy).toHaveBeenCalledWith(objective);
        
        const updated = coordinator.getObjective(objective.id);
        expect(updated?.tasks).toHaveLength(3);
      });
    });
  });
  
  describe('Work Stealing', () => {
    it('should redistribute tasks from failed agents', async () => {
      await coordinator.start();
      
      const agent1 = coordinator.createAgent({ name: 'Agent 1', type: 'developer' });
      const agent2 = coordinator.createAgent({ name: 'Agent 2', type: 'developer' });
      
      const task = coordinator.createTask({
        type: 'development',
        description: 'Task to steal'
      });
      
      // Assign to agent1 and simulate failure
      coordinator.assignTask(task.id, agent1.id);
      coordinator.updateAgentStatus(agent1.id, 'failed');
      
      // Trigger work stealing
      await (coordinator as any).performWorkStealing();
      
      // Task should be reassigned
      const updatedTask = coordinator.getTask(task.id);
      expect(updatedTask?.assignedTo).toBe(agent2.id);
    });
    
    it('should balance load between agents', async () => {
      await coordinator.start();
      
      const agents = [
        coordinator.createAgent({ name: 'Agent 1', type: 'researcher' }),
        coordinator.createAgent({ name: 'Agent 2', type: 'researcher' }),
        coordinator.createAgent({ name: 'Agent 3', type: 'researcher' })
      ];
      
      // Create multiple tasks
      const tasks = Array(6).fill(null).map((_, i) => 
        coordinator.createTask({
          type: 'research',
          description: `Task ${i}`
        })
      );
      
      // Initially assign all to agent 1
      tasks.forEach(task => {
        if (agents[0].status === 'idle') {
          coordinator.assignTask(task.id, agents[0].id);
          coordinator.completeTask(task.id, { success: true });
        }
      });
      
      // Trigger load balancing
      await (coordinator as any).balanceLoad();
      
      // Check that tasks are distributed
      const busyAgents = agents.filter(a => a.status === 'busy').length;
      expect(busyAgents).toBeGreaterThan(1);
    });
  });
  
  describe('Health Monitoring', () => {
    it('should perform health checks on agents', async () => {
      await coordinator.start();
      
      const agent = coordinator.createAgent({ name: 'Health Test', type: 'developer' });
      const task = coordinator.createTask({ type: 'development', description: 'Long task' });
      
      coordinator.assignTask(task.id, agent.id);
      
      // Simulate task timeout
      const taskStartTime = task.startedAt!;
      task.startedAt = new Date(Date.now() - 10000); // 10 seconds ago
      
      await (coordinator as any).performHealthCheck();
      
      // Task should be marked as failed due to timeout
      const updatedTask = coordinator.getTask(task.id);
      expect(updatedTask?.status).toBe('failed');
      expect(updatedTask?.error).toContain('timeout');
    });
    
    it('should restart failed agents', async () => {
      await coordinator.start();
      
      const agent = coordinator.createAgent({ name: 'Restart Test', type: 'analyzer' });
      coordinator.updateAgentStatus(agent.id, 'failed');
      
      await (coordinator as any).restartFailedAgents();
      
      const updated = coordinator.getAgent(agent.id);
      expect(updated?.status).toBe('idle');
    });
  });
  
  describe('Shutdown', () => {
    it('should clean up resources on shutdown', async () => {
      await coordinator.start();
      
      // Create some agents and tasks
      const agent = coordinator.createAgent({ name: 'Shutdown Test', type: 'developer' });
      const task = coordinator.createTask({ type: 'development', description: 'Test' });
      coordinator.assignTask(task.id, agent.id);
      
      await coordinator.shutdown();
      
      expect((coordinator as any).isRunning).toBe(false);
      
      // Background workers should be cleared
      const workers = (coordinator as any).backgroundWorkers;
      expect(workers.size).toBe(0);
    });
    
    it('should emit shutdown event', async () => {
      await coordinator.start();
      
      const eventPromise = waitForEvent(coordinator, 'shutdown');
      
      await coordinator.shutdown();
      
      await expect(eventPromise).resolves.toBeDefined();
    });
  });
  
  describe('Edge Cases and Error Handling', () => {
    it('should handle concurrent task assignments', async () => {
      await coordinator.start();
      
      const agents = Array(3).fill(null).map((_, i) => 
        coordinator.createAgent({ name: `Agent ${i}`, type: 'developer' })
      );
      
      const task = coordinator.createTask({ type: 'development', description: 'Concurrent test' });
      
      // Try to assign the same task to multiple agents concurrently
      const assignments = agents.map(agent => 
        coordinator.assignTask(task.id, agent.id).catch(() => null)
      );
      
      const results = await Promise.all(assignments);
      const successfulAssignments = results.filter(r => r !== null).length;
      
      expect(successfulAssignments).toBe(1);
    });
    
    it('should handle circular task dependencies', () => {
      const task1 = coordinator.createTask({ type: 'dev', description: 'Task 1' });
      const task2 = coordinator.createTask({ 
        type: 'dev', 
        description: 'Task 2',
        dependencies: [task1.id]
      });
      
      // Try to add circular dependency
      expect(() => {
        task1.dependencies.push(task2.id);
        (coordinator as any).validateTaskDependencies(task1);
      }).toThrow(/circular.*dependency/i);
    });
  });
});
