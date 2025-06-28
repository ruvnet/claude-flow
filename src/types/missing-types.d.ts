/**
 * Type declarations for missing types identified in TS2304 errors
 */

// MCP-related types
export interface MCPServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): string;
  handleRequest(request: any): Promise<any>;
}

export interface MCPPerformanceMonitor {
  startTracking(operation: string): void;
  endTracking(operation: string): void;
  getMetrics(): Record<string, any>;
  reset(): void;
}

export interface MCPLifecycleManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  registerComponent(component: any): void;
  getState(): string;
}

export interface MCPProtocolManager {
  registerProtocol(name: string, handler: any): void;
  handleMessage(message: any): Promise<any>;
  getProtocols(): string[];
}

export interface MCPOrchestrationIntegration {
  integrate(config: MCPOrchestrationConfig): void;
  getComponents(): OrchestrationComponents;
  executeTask(task: any): Promise<any>;
}

export interface MCPOrchestrationConfig {
  enableSwarm?: boolean;
  enableMemory?: boolean;
  enableTasks?: boolean;
  maxConcurrency?: number;
}

export interface OrchestrationComponents {
  swarmCoordinator?: any;
  memoryManager?: any;
  taskExecutor?: any;
  optimizedExecutor?: OptimizedExecutor;
}

export interface OptimizedExecutor {
  execute(task: any): Promise<any>;
  optimize(config: any): void;
  getMetrics(): Record<string, any>;
}

// Swarm-related types
export type SwarmStrategy = 'research' | 'development' | 'analysis' | 'testing' | 'optimization' | 'maintenance';
export type SwarmMode = 'centralized' | 'distributed' | 'hierarchical' | 'mesh' | 'hybrid';

// UI/Monitoring types
export interface ComponentStatus {
  status: 'healthy' | 'degraded' | 'error';
  load: number;
  uptime: number;
  errors: number;
  lastError?: string;
}

export interface AlertData {
  id: string;
  type: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  component: string;
  timestamp: number;
  acknowledged: boolean;
}

// Task/Todo types
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  createdAt?: Date;
  updatedAt?: Date;
}

// Other utility types
export interface Message {
  type: string;
  payload: any;
  timestamp?: Date;
  source?: string;
}

export interface ClaudeConnectionPool {
  getConnection(): Promise<any>;
  releaseConnection(connection: any): void;
  getPoolSize(): number;
  shutdown(): Promise<void>;
}

export interface ClaudeAPI {
  sendMessage(message: string): Promise<string>;
  complete(prompt: string, options?: any): Promise<string>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export interface AsyncFileManager {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
}

// Command-related types (for Cliffy compatibility)
export { Command } from '@cliffy/command';

// Color utility type
export interface Colors {
  red(text: string): string;
  green(text: string): string;
  blue(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  magenta(text: string): string;
  gray(text: string): string;
  bold(text: string): string;
  dim(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  stripColors(text: string): string;
}

// Re-export existsSync type
export { existsSync } from 'fs';