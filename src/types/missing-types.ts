/**
 * Missing types required by coordination and swarm modules
 */

// Import commonly used types from swarm
import type { SwarmStrategy, SwarmMode } from '../swarm/types.js';

// Re-export them
export type { SwarmStrategy, SwarmMode };

// Message type for coordination
export interface Message {
  id: string;
  type: string;
  source?: string;
  target?: string;
  data: any;
  timestamp: Date;
}

// Task result type
export interface TaskResult {
  taskId: string;
  agentId?: string;
  result: any;
  timestamp: Date;
  success: boolean;
  error?: string;
}

// Work stealing suggestion type
export interface WorkStealingSuggestion {
  from: string;
  to: string;
}

// Work stealing coordinator interface
export interface WorkStealingCoordinator {
  registerWorker(workerId: string, capacity: number): void;
  updateLoads(loads: Map<string, number>): void;
  suggestWorkStealing(): WorkStealingSuggestion[];
  getWorkerLoads(): Map<string, number>;
  removeWorker(workerId: string): void;
}

// Circuit breaker interface
export interface CircuitBreaker {
  canExecute(id: string): boolean;
  recordSuccess(id: string): void;
  recordFailure(id: string): void;
  getState(id: string): 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  reset(id: string): void;
}

// Stub implementations for testing
export class StubWorkStealingCoordinator implements WorkStealingCoordinator {
  private workers = new Map<string, number>();
  private loads = new Map<string, number>();

  registerWorker(workerId: string, capacity: number): void {
    this.workers.set(workerId, capacity);
    this.loads.set(workerId, 0);
  }

  updateLoads(loads: Map<string, number>): void {
    for (const [workerId, load] of Array.from(loads.entries())) {
      this.loads.set(workerId, load);
    }
  }

  suggestWorkStealing(): WorkStealingSuggestion[] {
    const suggestions: WorkStealingSuggestion[] = [];
    const sortedWorkers = Array.from(this.loads.entries())
      .sort((a, b) => b[1] - a[1]); // Sort by load descending
    
    // Find overloaded workers and suggest work stealing
    for (let i = 0; i < sortedWorkers.length; i++) {
      const [overloadedId, overloadedLoad] = sortedWorkers[i];
      if (overloadedLoad > 0.8) { // Overloaded threshold
        for (let j = sortedWorkers.length - 1; j > i; j--) {
          const [underloadedId, underloadedLoad] = sortedWorkers[j];
          if (underloadedLoad < 0.3) { // Underloaded threshold
            suggestions.push({
              from: overloadedId,
              to: underloadedId
            });
            break;
          }
        }
      }
    }
    
    return suggestions;
  }

  getWorkerLoads(): Map<string, number> {
    return new Map(this.loads);
  }

  removeWorker(workerId: string): void {
    this.workers.delete(workerId);
    this.loads.delete(workerId);
  }
}

export class StubCircuitBreaker implements CircuitBreaker {
  private states = new Map<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'>();
  private failures = new Map<string, number>();

  canExecute(id: string): boolean {
    const state = this.states.get(id) || 'CLOSED';
    return state !== 'OPEN';
  }

  recordSuccess(id: string): void {
    this.states.set(id, 'CLOSED');
    this.failures.set(id, 0);
  }

  recordFailure(id: string): void {
    const currentFailures = this.failures.get(id) || 0;
    this.failures.set(id, currentFailures + 1);
    
    if (currentFailures >= 5) {
      this.states.set(id, 'OPEN');
    }
  }

  getState(id: string): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.states.get(id) || 'CLOSED';
  }

  reset(id: string): void {
    this.states.set(id, 'CLOSED');
    this.failures.set(id, 0);
  }
}

// Background executor config
export interface BackgroundExecutorConfig {
  maxConcurrentTasks: number;
  defaultTimeout: number;
  logPath: string;
  enablePersistence: boolean;
  checkInterval: number;
  cleanupInterval: number;
  maxRetries: number;
}

// Swarm execution request interface
export interface SwarmExecutionRequest {
  objective: string;
  strategy: SwarmStrategy;
  coordinator?: any;
  options?: any;
  monitor?: boolean;
  ui?: boolean;
  review?: boolean;
  research?: boolean;
  output?: string;
}

// MCP Orchestration types
export interface MCPOrchestrationConfig {
  enabledFeatures?: string[];
  maxConcurrentRequests?: number;
  timeout?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMultiplier: number;
  };
}

export interface OrchestrationComponents {
  eventBus?: any;
  terminalManager?: any;
  memoryManager?: any;
  coordinationManager?: any;
  mcpServer?: any;
  logger?: any;
}

// Claude API Configuration interface
export interface ClaudeAPIConfig {
  id: string;
  baseURL: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

// Claude API interface - execution interface with methods
export interface ClaudeAPI {
  sendMessage(message: string): Promise<string>;
  complete(prompt: string, options?: any): Promise<string>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}