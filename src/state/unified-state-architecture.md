# Unified State Management Architecture

## Overview
This document defines the unified state management architecture for Claude-Flow, consolidating fragmented state across the codebase into a single source of truth while maintaining the event-driven nature of the system.

## Current State Analysis

### Problems Identified
1. **Fragmented State**: Each component maintains its own state Maps/objects
   - SwarmCoordinator: agents, objectives, tasks
   - SessionManager: sessions, sessionProfiles  
   - AgentManager: agent states, pools, clusters
   - MemoryManager: memory banks
   - TaskEngine: workflows, executions

2. **No Single Source of Truth**: State is duplicated across components
3. **Synchronization Issues**: Event-based updates can lead to race conditions
4. **Persistence Inconsistency**: Each component handles persistence differently
5. **Difficult State Debugging**: No centralized way to inspect system state

## Unified State Architecture

### Core Principles
1. **Single Source of Truth**: All state lives in a centralized store
2. **Event-Driven Updates**: Maintain compatibility with existing event system
3. **Immutable Updates**: State changes are immutable for predictability
4. **Persistence Layer**: Unified persistence with snapshots and recovery
5. **Type Safety**: Full TypeScript support with strict typing

### State Structure

```typescript
interface UnifiedSystemState {
  // System metadata
  version: string;
  lastUpdated: Date;
  
  // Core domains
  swarm: SwarmState;
  agents: AgentState;
  tasks: TaskState;
  sessions: SessionState;
  memory: MemoryState;
  orchestration: OrchestrationState;
  
  // System health
  health: SystemHealthState;
  metrics: SystemMetricsState;
  
  // Configuration
  config: SystemConfigState;
}

interface SwarmState {
  activeSwarms: Map<string, SwarmObjective>;
  swarmAgents: Map<string, SwarmAgent>;
  swarmTasks: Map<string, SwarmTask>;
  coordinators: Map<string, SwarmCoordinator>;
}

interface AgentState {
  agents: Map<string, Agent>;
  pools: Map<string, AgentPool>;
  clusters: Map<string, AgentCluster>;
  templates: Map<string, AgentTemplate>;
  metrics: Map<string, AgentMetrics>;
}

interface TaskState {
  tasks: Map<string, Task>;
  workflows: Map<string, Workflow>;
  executions: Map<string, TaskExecution>;
  dependencies: Map<string, TaskDependency[]>;
  schedule: Map<string, TaskSchedule>;
}

interface SessionState {
  sessions: Map<string, AgentSession>;
  profiles: Map<string, AgentProfile>;
  persistence: SessionPersistence;
}

interface MemoryState {
  banks: Map<string, MemoryBank>;
  entries: Map<string, MemoryEntry>;
  indexes: Map<string, MemoryIndex>;
  cache: MemoryCache;
}
```

### State Manager Implementation

```typescript
// Core state manager
export class UnifiedStateManager extends EventEmitter {
  private state: UnifiedSystemState;
  private history: StateChange[];
  private subscribers: Map<string, StateSubscriber>;
  private persistenceManager: StatePersistenceManager;
  private snapshotManager: StateSnapshotManager;
  
  // State operations
  public getState(): Readonly<UnifiedSystemState>;
  public dispatch(action: StateAction): void;
  public subscribe(path: string, callback: StateChangeCallback): Unsubscribe;
  public transaction(operations: StateOperation[]): void;
  
  // Persistence
  public snapshot(): Promise<StateSnapshot>;
  public restore(snapshot: StateSnapshot): Promise<void>;
  public persist(): Promise<void>;
}

// Action types
export interface StateAction {
  type: string;
  payload: any;
  metadata?: {
    timestamp: Date;
    source: string;
    correlationId?: string;
  };
}

// State selectors
export class StateSelectors {
  static getAgent(state: UnifiedSystemState, agentId: string): Agent | undefined;
  static getActiveSwarms(state: UnifiedSystemState): SwarmObjective[];
  static getTasksByStatus(state: UnifiedSystemState, status: TaskStatus): Task[];
  static getSystemHealth(state: UnifiedSystemState): SystemHealthStatus;
}
```

### Integration Strategy

#### 1. State Store Adapter Pattern
Create adapters for existing components to use the unified store:

```typescript
// Example: SwarmCoordinator adapter
export class SwarmStateAdapter {
  constructor(
    private stateManager: UnifiedStateManager,
    private eventBus: IEventBus
  ) {
    this.setupEventHandlers();
  }
  
  // Adapter methods that maintain existing API
  getAgent(id: string): SwarmAgent | undefined {
    const state = this.stateManager.getState();
    return state.swarm.swarmAgents.get(id);
  }
  
  setAgentStatus(id: string, status: AgentStatus): void {
    this.stateManager.dispatch({
      type: 'swarm/updateAgentStatus',
      payload: { id, status }
    });
  }
}
```

#### 2. Event-State Bridge
Bridge between existing event system and state updates:

```typescript
export class EventStateBridge {
  constructor(
    private stateManager: UnifiedStateManager,
    private eventBus: IEventBus
  ) {
    this.setupEventMappings();
  }
  
  private setupEventMappings() {
    // Map events to state actions
    this.eventBus.on('agent:created', (data) => {
      this.stateManager.dispatch({
        type: 'agents/add',
        payload: data
      });
    });
    
    // Emit events on state changes
    this.stateManager.subscribe('agents', (change) => {
      this.eventBus.emit('state:agents:changed', change);
    });
  }
}
```

### State Synchronization

#### 1. Optimistic Updates
```typescript
export class OptimisticStateManager {
  applyOptimisticUpdate(action: StateAction): void {
    // Apply change immediately
    this.dispatch(action);
    
    // Verify with backend
    this.verifyUpdate(action).catch(error => {
      // Rollback on failure
      this.rollback(action);
    });
  }
}
```

#### 2. Conflict Resolution
```typescript
export class StateConflictResolver {
  resolveConflict(
    localState: State,
    remoteState: State,
    strategy: ConflictStrategy
  ): State {
    switch (strategy) {
      case 'local-wins':
        return localState;
      case 'remote-wins':
        return remoteState;
      case 'merge':
        return this.mergeStates(localState, remoteState);
      case 'custom':
        return this.customResolve(localState, remoteState);
    }
  }
}
```

### Persistence Layer

```typescript
export class StatePersistenceManager {
  private backends: Map<string, PersistenceBackend>;
  
  async persist(state: UnifiedSystemState): Promise<void> {
    // Persist to multiple backends
    await Promise.all([
      this.backends.get('sqlite')?.save(state),
      this.backends.get('file')?.save(state),
      this.backends.get('memory')?.save(state)
    ]);
  }
  
  async restore(): Promise<UnifiedSystemState> {
    // Restore from primary backend
    const state = await this.backends.get('sqlite')?.load();
    if (!state) {
      throw new Error('Failed to restore state');
    }
    return state;
  }
}
```

## Migration Plan

### Phase 1: Create Core Infrastructure
1. Implement UnifiedStateManager
2. Define complete state types
3. Create persistence layer
4. Set up state snapshots

### Phase 2: Create Adapters
1. SwarmStateAdapter
2. AgentStateAdapter
3. TaskStateAdapter
4. SessionStateAdapter
5. MemoryStateAdapter

### Phase 3: Integrate Components
1. Update SwarmCoordinator to use adapter
2. Update AgentManager to use adapter
3. Update TaskEngine to use adapter
4. Update SessionManager to use adapter
5. Update MemoryManager to use adapter

### Phase 4: Remove Duplicate State
1. Remove local state from components
2. Consolidate persistence logic
3. Unify event handling
4. Clean up redundant code

### Phase 5: Add Advanced Features
1. State time-travel debugging
2. State analytics and monitoring
3. Distributed state synchronization
4. State migration tools

## Benefits

1. **Single Source of Truth**: All state in one place
2. **Predictable Updates**: Immutable state changes
3. **Better Debugging**: State history and time-travel
4. **Consistent Persistence**: Unified save/restore
5. **Type Safety**: Full TypeScript support
6. **Performance**: Optimized state queries
7. **Testability**: Easy to test state logic
8. **Scalability**: Ready for distributed systems

## Implementation Priority

1. High Priority:
   - Core state manager
   - Swarm and agent state
   - Basic persistence

2. Medium Priority:
   - Task and session state
   - Event-state bridge
   - State adapters

3. Low Priority:
   - Advanced debugging tools
   - Distributed synchronization
   - Analytics integration