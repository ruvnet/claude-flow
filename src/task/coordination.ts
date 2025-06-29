/**
 * Task Coordination Layer - Integrates with TodoWrite/TodoRead and Memory for orchestration
 * Provides seamless coordination between task management and Claude Code batch tools
 */

import { EventEmitter } from 'events';
import { TaskEngine, WorkflowTask, TaskExecution } from './engine.js';
import { generateId } from '../utils/helpers.js';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  dependencies?: string[];
  estimatedTime?: string;
  assignedAgent?: string;
  batchOptimized?: boolean;
  parallelExecution?: boolean;
  memoryKey?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryEntry {
  key: string;
  value: any;
  timestamp: Date;
  namespace?: string;
  tags?: string[];
  expiresAt?: Date;
}

export interface CoordinationContext {
  sessionId: string;
  agentId?: string;
  workflowId?: string;
  batchId?: string;
  parentTaskId?: string;
  coordinationMode: 'centralized' | 'distributed' | 'hierarchical' | 'mesh' | 'hybrid';
}

export class TaskCoordinator extends EventEmitter {
  private todoItems = new Map<string, TodoItem>();
  private memoryStore = new Map<string, MemoryEntry>();
  private coordinationSessions = new Map<string, CoordinationContext>();
  private batchOperations = new Map<string, BatchOperation>();
  private agentCoordination = new Map<string, AgentCoordinationState>();

  constructor(
    private taskEngine: TaskEngine,
    private memoryManager?: any
  ) {
    super();
    this.setupCoordinationHandlers();
  }

  private setupCoordinationHandlers(): void {
    this.taskEngine.on('task:created', this.handleTaskCreated.bind(this));
    this.taskEngine.on('task:started', this.handleTaskStarted.bind(this));
    this.taskEngine.on('task:completed', this.handleTaskCompleted.bind(this));
    this.taskEngine.on('task:failed', this.handleTaskFailed.bind(this));
    this.taskEngine.on('task:cancelled', this.handleTaskCancelled.bind(this));
  }

  /**
   * Create TodoWrite-style task breakdown for complex operations
   */
  async createTaskTodos(
    objective: string,
    context: CoordinationContext,
    options: {
      strategy?: 'research' | 'development' | 'analysis' | 'testing' | 'optimization' | 'maintenance';
      maxTasks?: number;
      batchOptimized?: boolean;
      parallelExecution?: boolean;
      memoryCoordination?: boolean;
    } = {}
  ): Promise<TodoItem[]> {
    const sessionId = context.sessionId;
    this.coordinationSessions.set(sessionId, context);

    // AI-powered task breakdown based on objective and strategy
    const todos = await this.generateTaskBreakdown(objective, options);

    // Store todos in coordination system
    for (const todo of todos) {
      this.todoItems.set(todo.id, todo);
      
      // Store in memory for cross-agent coordination
      if (options.memoryCoordination && this.memoryManager) {
        await this.storeInMemory(`todo:${todo.id}`, todo, {
          namespace: 'task_coordination',
          tags: ['todo', 'task_breakdown', sessionId]
        });
      }
    }

    // Emit coordination event
    this.emit('todos:created', { sessionId, todos, context });

    return todos;
  }

  /**
   * Update TodoRead-style progress tracking
   */
  async updateTodoProgress(
    todoId: string,
    status: 'pending' | 'in_progress' | 'completed',
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const todo = this.todoItems.get(todoId);
    if (!todo) {
      throw new Error(`Todo ${todoId} not found`);
    }

    const previousStatus = todo.status;
    todo.status = status;
    todo.metadata = { ...todo.metadata, ...metadata, updatedAt: new Date() };

    // Update in memory for coordination
    if (this.memoryManager) {
      await this.storeInMemory(`todo:${todoId}`, todo, {
        namespace: 'task_coordination',
        tags: ['todo', 'progress_update']
      });
    }

    // Create corresponding task if moving to in_progress
    if (status === 'in_progress' && previousStatus === 'pending') {
      await this.createTaskFromTodo(todo);
    }

    this.emit('todo:updated', { todoId, status, previousStatus, todo });
  }

  /**
   * Read all todos for coordination (TodoRead equivalent)
   */
  async readTodos(
    sessionId?: string,
    filter?: {
      status?: TodoItem['status'][];
      priority?: TodoItem['priority'][];
      assignedAgent?: string;
      tags?: string[];
      batchOptimized?: boolean;
    }
  ): Promise<TodoItem[]> {
    let todos = Array.from(this.todoItems.values());

    // Filter by session if provided
    if (sessionId) {
      const sessionTodos = await this.getSessionTodos(sessionId);
      todos = todos.filter(todo => sessionTodos.some(st => st.id === todo.id));
    }

    // Apply filters
    if (filter) {
      if (filter.status) {
        todos = todos.filter(todo => filter.status!.includes(todo.status));
      }
      if (filter.priority) {
        todos = todos.filter(todo => filter.priority!.includes(todo.priority));
      }
      if (filter.assignedAgent) {
        todos = todos.filter(todo => todo.assignedAgent === filter.assignedAgent);
      }
      if (filter.tags) {
        todos = todos.filter(todo => 
          todo.tags?.some(tag => filter.tags!.includes(tag))
        );
      }
      if (filter.batchOptimized !== undefined) {
        todos = todos.filter(todo => todo.batchOptimized === filter.batchOptimized);
      }
    }

    return todos;
  }

  /**
   * Store data in Memory for cross-agent coordination
   */
  async storeInMemory(
    key: string,
    value: any,
    options: {
      namespace?: string;
      tags?: string[];
      expiresAt?: Date;
    } = {}
  ): Promise<void> {
    const entry: MemoryEntry = {
      key,
      value,
      timestamp: new Date(),
      ...(options.namespace !== undefined && { namespace: options.namespace }),
      ...(options.tags !== undefined && { tags: options.tags }),
      ...(options.expiresAt !== undefined && { expiresAt: options.expiresAt })
    };

    this.memoryStore.set(key, entry);

    // Store in external memory manager if available
    if (this.memoryManager) {
      const memoryKey = options.namespace ? `${options.namespace}:${key}` : key;
      await this.memoryManager.store(memoryKey, value, {
        tags: options.tags,
        expiresAt: options.expiresAt
      });
    }

    this.emit('memory:stored', { key, entry });
  }

  /**
   * Retrieve data from Memory for coordination
   */
  async retrieveFromMemory(
    key: string,
    namespace?: string
  ): Promise<any | null> {
    const memoryKey = namespace ? `${namespace}:${key}` : key;
    
    // Try external memory manager first
    if (this.memoryManager) {
      try {
        const value = await this.memoryManager.retrieve(memoryKey);
        if (value !== null) return value;
      } catch (error) {
        // Fall back to local store
      }
    }

    // Use local store
    const entry = this.memoryStore.get(key);
    if (!entry) return null;

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.memoryStore.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Query Memory with filters for coordination
   */
  async queryMemory(query: {
    namespace?: string;
    tags?: string[];
    keyPattern?: string;
    since?: Date;
    limit?: number;
  }): Promise<MemoryEntry[]> {
    let entries = Array.from(this.memoryStore.values());

    // Apply filters
    if (query.namespace) {
      entries = entries.filter(entry => entry.namespace === query.namespace);
    }
    if (query.tags) {
      entries = entries.filter(entry => 
        entry.tags?.some(tag => query.tags!.includes(tag))
      );
    }
    if (query.keyPattern) {
      const pattern = new RegExp(query.keyPattern);
      entries = entries.filter(entry => pattern.test(entry.key));
    }
    if (query.since) {
      entries = entries.filter(entry => entry.timestamp >= query.since!);
    }

    // Sort by timestamp (newest first)
    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    if (query.limit) {
      entries = entries.slice(0, query.limit);
    }

    return entries;
  }

  /**
   * Launch parallel agents using Task tool pattern
   */
  async launchParallelAgents(
    tasks: Array<{
      agentType: string;
      objective: string;
      mode?: string;
      configuration?: Record<string, unknown>;
      memoryKey?: string;
      batchOptimized?: boolean;
    }>,
    coordinationContext: CoordinationContext
  ): Promise<string[]> {
    const batchId = generateId('batch');
    const agentIds: string[] = [];

    const batchOperation: BatchOperation = {
      id: batchId,
      type: 'parallel_agents',
      tasks,
      startedAt: new Date(),
      status: 'running',
      results: new Map(),
      errors: new Map()
    };

    this.batchOperations.set(batchId, batchOperation);

    // Store batch operation in memory for coordination
    await this.storeInMemory(`batch:${batchId}`, batchOperation, {
      namespace: 'coordination',
      tags: ['batch_operation', 'parallel_agents']
    });

    // Launch each agent
    for (const task of tasks) {
      try {
        const agentId = await this.launchAgent(task, coordinationContext, batchId);
        agentIds.push(agentId);
        
        // Store agent coordination state
        this.agentCoordination.set(agentId, {
          agentId,
          batchId,
          objective: task.objective,
          status: 'running',
          startedAt: new Date(),
          ...(task.memoryKey !== undefined && { memoryKey: task.memoryKey }),
          coordinationContext
        });

      } catch (error) {
        batchOperation.errors.set(task.agentType, error as Error);
      }
    }

    this.emit('agents:launched', { batchId, agentIds, tasks });

    return agentIds;
  }

  /**
   * Coordinate batch operations for maximum efficiency
   */
  async coordinateBatchOperations(
    operations: Array<{
      type: 'read' | 'write' | 'edit' | 'search' | 'analyze';
      targets: string[];
      configuration?: Record<string, unknown>;
    }>,
    context: CoordinationContext
  ): Promise<Map<string, any>> {
    const batchId = generateId('batch_ops');
    const results = new Map<string, any>();

    // Group operations by type for maximum efficiency
    const groupedOps = new Map<string, Array<any>>();
    
    for (const op of operations) {
      if (!groupedOps.has(op.type)) {
        groupedOps.set(op.type, []);
      }
      groupedOps.get(op.type)!.push(op);
    }

    // Store batch coordination info
    await this.storeInMemory(`batch_ops:${batchId}`, {
      operations,
      groupedOps: Object.fromEntries(groupedOps),
      context,
      startedAt: new Date()
    }, {
      namespace: 'coordination',
      tags: ['batch_operations', 'efficiency']
    });

    // Execute operations in parallel by type
    const promises: Promise<void>[] = [];

    for (const [type, ops] of groupedOps) {
      promises.push(this.executeBatchOperationType(type, ops, batchId, results));
    }

    await Promise.all(promises);

    this.emit('batch:completed', { batchId, results, context });

    return results;
  }

  /**
   * Swarm coordination patterns based on mode
   */
  async coordinateSwarm(
    objective: string,
    context: CoordinationContext,
    agents: Array<{
      type: string;
      role: string;
      capabilities: string[];
    }>
  ): Promise<void> {
    const swarmId = generateId('swarm');
    
    // Store swarm configuration
    await this.storeInMemory(`swarm:${swarmId}`, {
      objective,
      context,
      agents,
      startedAt: new Date(),
      coordinationPattern: context.coordinationMode
    }, {
      namespace: 'swarm_coordination',
      tags: ['swarm', context.coordinationMode]
    });

    switch (context.coordinationMode) {
      case 'centralized':
        await this.coordinateCentralizedSwarm(swarmId, objective, agents);
        break;
      case 'distributed':
        await this.coordinateDistributedSwarm(swarmId, objective, agents);
        break;
      case 'hierarchical':
        await this.coordinateHierarchicalSwarm(swarmId, objective, agents);
        break;
      case 'mesh':
        await this.coordinateMeshSwarm(swarmId, objective, agents);
        break;
      case 'hybrid':
        await this.coordinateHybridSwarm(swarmId, objective, agents);
        break;
    }
  }

  // Private helper methods

  private async generateTaskBreakdown(
    objective: string,
    options: any
  ): Promise<TodoItem[]> {
    // AI-powered task breakdown based on strategy
    const strategy = options.strategy || 'development';
    const todos: TodoItem[] = [];

    // Strategy-specific task patterns
    switch (strategy) {
      case 'research':
        todos.push(
          {
            id: generateId('todo'),
            content: 'Gather initial information and sources',
            status: 'pending',
            priority: 'high',
            batchOptimized: true,
            parallelExecution: true,
            memoryKey: 'research_sources',
            tags: ['research', 'information_gathering']
          },
          {
            id: generateId('todo'),
            content: 'Analyze and synthesize findings',
            status: 'pending',
            priority: 'medium',
            dependencies: ['research_sources'],
            batchOptimized: true,
            memoryKey: 'research_analysis',
            tags: ['research', 'analysis']
          }
        );
        break;

      case 'development':
        todos.push(
          {
            id: generateId('todo'),
            content: 'Design system architecture',
            status: 'pending',
            priority: 'high',
            memoryKey: 'system_architecture',
            tags: ['development', 'architecture']
          },
          {
            id: generateId('todo'),
            content: 'Implement core functionality',
            status: 'pending',
            priority: 'high',
            dependencies: ['system_architecture'],
            batchOptimized: true,
            parallelExecution: true,
            memoryKey: 'core_implementation',
            tags: ['development', 'implementation']
          },
          {
            id: generateId('todo'),
            content: 'Write comprehensive tests',
            status: 'pending',
            priority: 'medium',
            dependencies: ['core_implementation'],
            batchOptimized: true,
            memoryKey: 'test_suite',
            tags: ['development', 'testing']
          }
        );
        break;

      case 'analysis':
        todos.push(
          {
            id: generateId('todo'),
            content: 'Collect and preprocess data',
            status: 'pending',
            priority: 'high',
            batchOptimized: true,
            parallelExecution: true,
            memoryKey: 'analysis_data',
            tags: ['analysis', 'data_collection']
          },
          {
            id: generateId('todo'),
            content: 'Perform statistical analysis',
            status: 'pending',
            priority: 'high',
            dependencies: ['analysis_data'],
            batchOptimized: true,
            memoryKey: 'statistical_results',
            tags: ['analysis', 'statistics']
          },
          {
            id: generateId('todo'),
            content: 'Generate insights and reports',
            status: 'pending',
            priority: 'medium',
            dependencies: ['statistical_results'],
            memoryKey: 'analysis_insights',
            tags: ['analysis', 'reporting']
          }
        );
        break;

      default:
        // Generic breakdown
        todos.push(
          {
            id: generateId('todo'),
            content: `Analyze requirements for: ${objective}`,
            status: 'pending',
            priority: 'high',
            memoryKey: 'requirements_analysis',
            tags: ['generic', 'requirements']
          },
          {
            id: generateId('todo'),
            content: `Execute main tasks for: ${objective}`,
            status: 'pending',
            priority: 'high',
            dependencies: ['requirements_analysis'],
            batchOptimized: true,
            parallelExecution: true,
            memoryKey: 'main_execution',
            tags: ['generic', 'execution']
          },
          {
            id: generateId('todo'),
            content: `Validate and finalize results`,
            status: 'pending',
            priority: 'medium',
            dependencies: ['main_execution'],
            memoryKey: 'validation_results',
            tags: ['generic', 'validation']
          }
        );
    }

    return todos;
  }

  private async createTaskFromTodo(todo: TodoItem): Promise<WorkflowTask> {
    const taskData = {
      type: todo.tags?.[0] || 'general',
      description: todo.content,
      priority: this.priorityToNumber(todo.priority),
      assignedAgent: todo.assignedAgent,
      tags: todo.tags || [],
      metadata: {
        todoId: todo.id,
        ...(todo.batchOptimized !== undefined && { batchOptimized: todo.batchOptimized }),
        ...(todo.parallelExecution !== undefined && { parallelExecution: todo.parallelExecution }),
        ...(todo.memoryKey !== undefined && { memoryKey: todo.memoryKey })
      }
    };

    return await this.taskEngine.createTask(taskData);
  }

  private priorityToNumber(priority: 'high' | 'medium' | 'low'): number {
    switch (priority) {
      case 'high': return 80;
      case 'medium': return 50;
      case 'low': return 20;
      default: return 50;
    }
  }

  private async launchAgent(
    task: any,
    context: CoordinationContext,
    batchId: string
  ): Promise<string> {
    const agentId = generateId('agent');
    
    // Store agent launch info in memory
    await this.storeInMemory(`agent:${agentId}`, {
      ...task,
      agentId,
      batchId,
      context,
      launchedAt: new Date()
    }, {
      namespace: 'agent_coordination',
      tags: ['agent_launch', task.agentType]
    });

    return agentId;
  }

  private async executeBatchOperationType(
    type: string,
    operations: any[],
    batchId: string,
    results: Map<string, any>
  ): Promise<void> {
    // Simulate batch operation execution
    // In real implementation, this would use actual tools
    
    for (const op of operations) {
      try {
        const result = await this.simulateBatchOperation(type, op);
        results.set(`${type}_${op.targets.join('_')}`, result);
      } catch (error) {
        results.set(`${type}_${op.targets.join('_')}_error`, error);
      }
    }
  }

  private async simulateBatchOperation(type: string, operation: any): Promise<any> {
    // Simulate operation based on type
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      type,
      targets: operation.targets,
      result: `Simulated ${type} operation completed`,
      timestamp: new Date()
    };
  }

  // Swarm coordination patterns

  private async coordinateCentralizedSwarm(swarmId: string, objective: string, agents: any[]): Promise<void> {
    // Single coordinator manages all agents
    await this.storeInMemory(`swarm:${swarmId}:pattern`, {
      type: 'centralized',
      coordinator: 'main',
      agentAssignments: agents.map(agent => ({
        agentId: agent.type,
        role: agent.role,
        coordinator: 'main'
      }))
    });
  }

  private async coordinateDistributedSwarm(swarmId: string, objective: string, agents: any[]): Promise<void> {
    // Multiple coordinators for different aspects
    const coordinators = ['research_coord', 'impl_coord', 'test_coord'];
    
    await this.storeInMemory(`swarm:${swarmId}:pattern`, {
      type: 'distributed',
      coordinators,
      agentAssignments: agents.map((agent, index) => ({
        agentId: agent.type,
        role: agent.role,
        coordinator: coordinators[index % coordinators.length]
      }))
    });
  }

  private async coordinateHierarchicalSwarm(swarmId: string, objective: string, agents: any[]): Promise<void> {
    // Tree structure with team leads
    await this.storeInMemory(`swarm:${swarmId}:pattern`, {
      type: 'hierarchical',
      hierarchy: {
        master: 'main_coordinator',
        teamLeads: ['frontend_lead', 'backend_lead', 'devops_lead'],
        teams: {
          frontend_lead: agents.filter(a => a.type.includes('frontend')),
          backend_lead: agents.filter(a => a.type.includes('backend')),
          devops_lead: agents.filter(a => a.type.includes('devops'))
        }
      }
    });
  }

  private async coordinateMeshSwarm(swarmId: string, objective: string, agents: any[]): Promise<void> {
    // Peer-to-peer coordination
    await this.storeInMemory(`swarm:${swarmId}:pattern`, {
      type: 'mesh',
      peerConnections: agents.map(agent => ({
        agentId: agent.type,
        peers: agents.filter(a => a.type !== agent.type).map(a => a.type)
      }))
    });
  }

  private async coordinateHybridSwarm(swarmId: string, objective: string, agents: any[]): Promise<void> {
    // Mixed patterns based on requirements
    await this.storeInMemory(`swarm:${swarmId}:pattern`, {
      type: 'hybrid',
      phases: [
        { phase: 'planning', pattern: 'centralized' },
        { phase: 'execution', pattern: 'distributed' },
        { phase: 'integration', pattern: 'hierarchical' }
      ]
    });
  }

  private async getSessionTodos(sessionId: string): Promise<TodoItem[]> {
    const entries = await this.queryMemory({
      namespace: 'task_coordination',
      tags: ['todo', sessionId]
    });

    return entries.map(entry => entry.value as TodoItem);
  }

  // Event handlers

  private async handleTaskCreated(data: { task: WorkflowTask }): Promise<void> {
    // Update corresponding todo if exists
    const todoId = data.task.metadata?.['todoId'];
    if (todoId) {
      await this.updateTodoProgress(todoId as string, 'in_progress', {
        taskId: data.task.id,
        createdAt: data.task.createdAt
      });
    }
  }

  private async handleTaskStarted(data: { taskId: string; agentId: string }): Promise<void> {
    // Store task start in memory for coordination
    await this.storeInMemory(`task_execution:${data.taskId}`, {
      status: 'started',
      agentId: data.agentId,
      startedAt: new Date()
    }, {
      namespace: 'task_execution',
      tags: ['task_start', data.agentId]
    });
  }

  private async handleTaskCompleted(data: { taskId: string; result: unknown }): Promise<void> {
    // Update todo and store results
    const task = (await this.taskEngine.getTaskStatus(data.taskId))?.task;
    const todoId = task?.metadata?.['todoId'];
    
    if (todoId) {
      await this.updateTodoProgress(todoId as string, 'completed', {
        completedAt: new Date(),
        result: data.result
      });
    }

    // Store completion in memory
    await this.storeInMemory(`task_execution:${data.taskId}`, {
      status: 'completed',
      result: data.result,
      completedAt: new Date()
    }, {
      namespace: 'task_execution',
      tags: ['task_completion']
    });
  }

  private async handleTaskFailed(data: { taskId: string; error: Error }): Promise<void> {
    // Store failure info
    await this.storeInMemory(`task_execution:${data.taskId}`, {
      status: 'failed',
      error: data.error.message,
      failedAt: new Date()
    }, {
      namespace: 'task_execution',
      tags: ['task_failure']
    });
  }

  private async handleTaskCancelled(data: { taskId: string; reason: string }): Promise<void> {
    // Store cancellation info
    await this.storeInMemory(`task_execution:${data.taskId}`, {
      status: 'cancelled',
      reason: data.reason,
      cancelledAt: new Date()
    }, {
      namespace: 'task_execution',
      tags: ['task_cancellation']
    });
  }
}

// Supporting interfaces

interface BatchOperation {
  id: string;
  type: string;
  tasks: any[];
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  results: Map<string, any>;
  errors: Map<string, Error>;
}

interface AgentCoordinationState {
  agentId: string;
  batchId?: string;
  objective: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  memoryKey?: string;
  coordinationContext: CoordinationContext;
  lastHeartbeat?: Date;
}