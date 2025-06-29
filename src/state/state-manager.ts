/**
 * Unified State Management System
 * Consolidates all system state into a single, centralized store
 */

import { EventEmitter } from 'node:events';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import type {
  UnifiedSystemState,
  StateAction,
  StateActionMetadata,
  StateChange,
  StateSnapshot,
  StateSubscriber,
  StateChangeCallback,
  StateChangeFilter,
  StateOperation,
  StateTransaction,
  Unsubscribe,
  StateSelector,
  SwarmState,
  AgentState,
  TaskState,
  SessionState,
  MemoryState,
  OrchestrationState,
  SystemHealthState,
  SystemMetricsState,
  SystemConfigState
} from './types.js';

export class UnifiedStateManager extends EventEmitter {
  private logger: Logger;
  private state: UnifiedSystemState;
  private history: StateChange[] = [];
  private subscribers: Map<string, StateSubscriber> = new Map();
  private snapshots: Map<string, StateSnapshot> = new Map();
  private isInitialized: boolean = false;
  private readonly maxHistorySize: number = 1000;

  constructor(initialState?: Partial<UnifiedSystemState>) {
    super();
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'UnifiedStateManager' });

    this.state = this.createInitialState(initialState);
    this.logger.info('Unified state manager initialized', { 
      sessionId: this.state.sessionId,
      version: this.state.version 
    });
  }

  private createInitialState(partial?: Partial<UnifiedSystemState>): UnifiedSystemState {
    const now = new Date();
    const sessionId = generateId();

    return {
      version: '1.0.0',
      lastUpdated: now,
      sessionId,
      swarm: {
        activeSwarms: new Map(),
        swarmAgents: new Map(),
        swarmTasks: new Map(),
        coordinators: new Map()
      },
      agents: {
        agents: new Map(),
        pools: new Map(),
        clusters: new Map(),
        templates: new Map(),
        metrics: new Map()
      },
      tasks: {
        tasks: new Map(),
        workflows: new Map(),
        executions: new Map(),
        dependencies: new Map(),
        schedule: new Map(),
        queue: {
          pending: [],
          active: [],
          completed: [],
          failed: []
        }
      },
      sessions: {
        sessions: new Map(),
        profiles: new Map(),
        persistence: {
          sessions: [],
          taskQueue: [],
          metrics: {
            completedTasks: 0,
            failedTasks: 0,
            totalTaskDuration: 0
          },
          savedAt: now
        },
        activeCount: 0,
        totalCreated: 0
      },
      memory: {
        banks: new Map(),
        entries: new Map(),
        indexes: new Map(),
        cache: {
          size: 0,
          maxSize: 100 * 1024 * 1024, // 100MB
          hitRate: 0,
          entries: 0
        },
        totalEntries: 0,
        totalSize: 0
      },
      orchestration: {
        status: 'idle',
        activeOrchestrators: new Map(),
        mcpServers: new Map(),
        terminals: new Map()
      },
      health: {
        overall: 'healthy',
        components: new Map(),
        lastCheck: now,
        issues: []
      },
      metrics: {
        performance: {
          avgResponseTime: 0,
          throughput: 0,
          errorRate: 0,
          successRate: 100
        },
        resource: {
          cpuUsage: 0,
          memoryUsage: 0,
          diskUsage: 0,
          networkIO: 0
        },
        business: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          activeAgents: 0,
          totalAgents: 0
        },
        lastUpdated: now
      },
      config: {
        version: '1.0.0',
        environment: 'development',
        features: new Map(),
        limits: {
          maxAgents: 50,
          maxTasks: 1000,
          maxMemoryMB: 512,
          maxSessions: 100
        },
        settings: {
          autoScale: true,
          persistenceEnabled: true,
          monitoringEnabled: true,
          debugMode: false
        }
      },
      ...partial
    };
  }

  /**
   * Get the current state (immutable copy)
   */
  public getState(): Readonly<UnifiedSystemState> {
    return Object.freeze(this.deepClone(this.state));
  }

  /**
   * Dispatch a state action
   */
  public dispatch(action: StateAction): void {
    this.logger.debug('Dispatching state action', { type: action.type, hasPayload: !!action.payload });
    
    const timestamp = new Date();
    const actionWithMetadata: StateAction = {
      ...action,
      metadata: {
        timestamp,
        source: 'UnifiedStateManager',
        ...action.metadata
      }
    };

    // Apply the action to state
    const previousState = this.deepClone(this.state);
    this.applyAction(actionWithMetadata);

    // Create state change record
    const change: StateChange = {
      id: generateId(),
      timestamp,
      action: actionWithMetadata,
      previousValue: previousState,
      newValue: this.deepClone(this.state),
      path: this.getActionPath(action)
    };

    // Add to history
    this.addToHistory(change);

    // Notify subscribers
    this.notifySubscribers(change);

    // Emit event
    this.emit('stateChanged', change);
    this.emit(`action:${action.type}`, change);

    this.logger.debug('State action processed', { 
      actionType: action.type, 
      changeId: change.id,
      historySize: this.history.length
    });
  }

  /**
   * Subscribe to state changes
   */
  public subscribe(path: string, callback: StateChangeCallback, filter?: StateChangeFilter): Unsubscribe {
    const subscriberId = generateId();
    const subscriber: StateSubscriber = {
      id: subscriberId,
      path,
      callback,
      filter
    };

    this.subscribers.set(subscriberId, subscriber);
    this.logger.debug('State subscriber added', { subscriberId, path, hasFilter: !!filter });

    return () => {
      this.subscribers.delete(subscriberId);
      this.logger.debug('State subscriber removed', { subscriberId, path });
    };
  }

  /**
   * Execute multiple operations in a transaction
   */
  public transaction(operations: StateOperation[], metadata?: Partial<StateActionMetadata>): void {
    const transactionId = generateId();
    const transactionAction: StateAction = {
      type: 'transaction',
      payload: {
        id: transactionId,
        operations
      },
      metadata: {
        timestamp: new Date(),
        source: 'UnifiedStateManager',
        correlationId: transactionId,
        ...metadata
      }
    };

    this.dispatch(transactionAction);
  }

  /**
   * Create a state snapshot
   */
  public async snapshot(reason: string = 'manual'): Promise<StateSnapshot> {
    const snapshotId = generateId();
    const timestamp = new Date();
    const stateClone = this.deepClone(this.state);
    
    const snapshot: StateSnapshot = {
      id: snapshotId,
      timestamp,
      state: stateClone,
      metadata: {
        reason,
        automatic: false,
        size: JSON.stringify(stateClone).length
      }
    };

    this.snapshots.set(snapshotId, snapshot);
    this.logger.info('State snapshot created', { 
      snapshotId, 
      reason, 
      size: snapshot.metadata.size,
      totalSnapshots: this.snapshots.size
    });

    return snapshot;
  }

  /**
   * Restore from a state snapshot
   */
  public async restore(snapshot: StateSnapshot): Promise<void> {
    this.logger.info('Restoring state from snapshot', { snapshotId: snapshot.id });
    
    const previousState = this.deepClone(this.state);
    this.state = this.deepClone(snapshot.state);
    this.state.lastUpdated = new Date();

    const change: StateChange = {
      id: generateId(),
      timestamp: new Date(),
      action: {
        type: 'restore',
        payload: { snapshotId: snapshot.id },
        metadata: {
          timestamp: new Date(),
          source: 'UnifiedStateManager',
          reason: 'snapshot restoration'
        }
      },
      previousValue: previousState,
      newValue: this.deepClone(this.state),
      path: []
    };

    this.addToHistory(change);
    this.notifySubscribers(change);
    this.emit('stateRestored', { snapshot, change });

    this.logger.info('State restored successfully', { snapshotId: snapshot.id });
  }

  /**
   * Get state using a selector function
   */
  public select<T>(selector: StateSelector<T>): T {
    return selector(this.getState());
  }

  /**
   * Get state history
   */
  public getHistory(): readonly StateChange[] {
    return Object.freeze([...this.history]);
  }

  /**
   * Get available snapshots
   */
  public getSnapshots(): readonly StateSnapshot[] {
    return Object.freeze([...this.snapshots.values()]);
  }

  /**
   * Clear history (keep last N entries)
   */
  public clearHistory(keepLast: number = 100): void {
    if (this.history.length > keepLast) {
      const removed = this.history.length - keepLast;
      this.history = this.history.slice(-keepLast);
      this.logger.info('State history cleared', { removed, remaining: this.history.length });
    }
  }

  /**
   * Apply a state action to the current state
   */
  private applyAction(action: StateAction): void {
    this.state.lastUpdated = new Date();

    switch (action.type) {
      case 'swarm/addAgent':
        this.state.swarm.swarmAgents.set(action.payload.id, action.payload);
        break;
      
      case 'swarm/updateAgent':
        const existingAgent = this.state.swarm.swarmAgents.get(action.payload.id);
        if (existingAgent) {
          this.state.swarm.swarmAgents.set(action.payload.id, { ...existingAgent, ...action.payload.updates });
        }
        break;
      
      case 'swarm/removeAgent':
        this.state.swarm.swarmAgents.delete(action.payload.id);
        break;
      
      case 'swarm/addObjective':
        this.state.swarm.activeSwarms.set(action.payload.id, action.payload);
        break;
      
      case 'swarm/updateObjective':
        const existingObjective = this.state.swarm.activeSwarms.get(action.payload.id);
        if (existingObjective) {
          this.state.swarm.activeSwarms.set(action.payload.id, { ...existingObjective, ...action.payload.updates });
        }
        break;
      
      case 'swarm/addTask':
        this.state.swarm.swarmTasks.set(action.payload.id, action.payload);
        this.state.tasks.queue.pending.push(action.payload.id);
        break;
      
      case 'swarm/updateTask':
        const existingTask = this.state.swarm.swarmTasks.get(action.payload.id);
        if (existingTask) {
          this.state.swarm.swarmTasks.set(action.payload.id, { ...existingTask, ...action.payload.updates });
          this.updateTaskQueue(action.payload.id, action.payload.updates.status);
        }
        break;
      
      case 'transaction':
        // Apply all operations in the transaction
        action.payload.operations.forEach((op: StateOperation) => {
          this.applyOperation(op);
        });
        break;
      
      default:
        this.logger.warn('Unknown action type', { type: action.type });
    }
  }

  /**
   * Apply a single state operation
   */
  private applyOperation(operation: StateOperation): void {
    const { type, path, value, updater } = operation;
    
    switch (type) {
      case 'set':
        this.setValueAtPath(this.state, path, value);
        break;
      
      case 'update':
        if (updater) {
          const currentValue = this.getValueAtPath(this.state, path);
          const newValue = updater(currentValue);
          this.setValueAtPath(this.state, path, newValue);
        }
        break;
      
      case 'delete':
        this.deleteValueAtPath(this.state, path);
        break;
      
      case 'merge':
        const currentValue = this.getValueAtPath(this.state, path);
        if (typeof currentValue === 'object' && typeof value === 'object') {
          const mergedValue = { ...currentValue, ...value };
          this.setValueAtPath(this.state, path, mergedValue);
        }
        break;
    }
  }

  /**
   * Update task queue based on status change
   */
  private updateTaskQueue(taskId: string, newStatus?: string): void {
    if (!newStatus) return;

    const queue = this.state.tasks.queue;
    
    // Remove from current queue
    queue.pending = queue.pending.filter(id => id !== taskId);
    queue.active = queue.active.filter(id => id !== taskId);
    queue.completed = queue.completed.filter(id => id !== taskId);
    queue.failed = queue.failed.filter(id => id !== taskId);
    
    // Add to appropriate queue
    switch (newStatus) {
      case 'pending':
        queue.pending.push(taskId);
        break;
      case 'running':
        queue.active.push(taskId);
        break;
      case 'completed':
        queue.completed.push(taskId);
        break;
      case 'failed':
        queue.failed.push(taskId);
        break;
    }
  }

  /**
   * Get the path affected by an action
   */
  private getActionPath(action: StateAction): string[] {
    const parts = action.type.split('/');
    if (parts.length >= 2) {
      return [parts[0]]; // Return domain (e.g., 'swarm', 'agents')
    }
    return [];
  }

  /**
   * Add change to history
   */
  private addToHistory(change: StateChange): void {
    this.history.push(change);
    
    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }

  /**
   * Notify all matching subscribers
   */
  private notifySubscribers(change: StateChange): void {
    for (const subscriber of this.subscribers.values()) {
      if (this.shouldNotifySubscriber(subscriber, change)) {
        try {
          subscriber.callback(change);
        } catch (error) {
          this.logger.error('Subscriber callback error', { 
            subscriberId: subscriber.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
  }

  /**
   * Check if subscriber should be notified
   */
  private shouldNotifySubscriber(subscriber: StateSubscriber, change: StateChange): boolean {
    // Check path matching
    if (subscriber.path !== '*' && !change.path.includes(subscriber.path)) {
      return false;
    }

    // Apply filter if present
    if (subscriber.filter) {
      const { actionTypes, paths, sources } = subscriber.filter;
      
      if (actionTypes && !actionTypes.includes(change.action.type)) {
        return false;
      }
      
      if (paths && !paths.some(path => change.path.includes(path))) {
        return false;
      }
      
      if (sources && change.action.metadata?.source && !sources.includes(change.action.metadata.source)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Deep clone an object
   */
  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime()) as unknown as T;
    }

    if (obj instanceof Map) {
      const cloned = new Map();
      for (const [key, value] of obj) {
        cloned.set(key, this.deepClone(value));
      }
      return cloned as unknown as T;
    }

    if (obj instanceof Set) {
      const cloned = new Set();
      for (const value of obj) {
        cloned.add(this.deepClone(value));
      }
      return cloned as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as unknown as T;
    }

    const cloned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }

  /**
   * Get value at path
   */
  private getValueAtPath(obj: any, path: string[]): any {
    let current = obj;
    for (const key of path) {
      if (current == null) return undefined;
      current = current[key];
    }
    return current;
  }

  /**
   * Set value at path
   */
  private setValueAtPath(obj: any, path: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (current[key] == null || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    current[path[path.length - 1]] = value;
  }

  /**
   * Delete value at path
   */
  private deleteValueAtPath(obj: any, path: string[]): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (current[key] == null) return;
      current = current[key];
    }
    delete current[path[path.length - 1]];
  }
}

/**
 * Global state manager instance
 */
let globalStateManager: UnifiedStateManager | null = null;

/**
 * Get or create the global state manager
 */
export function getStateManager(): UnifiedStateManager {
  if (!globalStateManager) {
    globalStateManager = new UnifiedStateManager();
  }
  return globalStateManager;
}

/**
 * Initialize the global state manager with custom configuration
 */
export function initializeStateManager(initialState?: Partial<UnifiedSystemState>): UnifiedStateManager {
  globalStateManager = new UnifiedStateManager(initialState);
  return globalStateManager;
}

/**
 * Reset the global state manager (for testing)
 */
export function resetStateManager(): void {
  globalStateManager = null;
}