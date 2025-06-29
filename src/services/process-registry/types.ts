/**
 * Process Registry Type Definitions
 * 
 * Central types for process tracking and management in Claude-Flow
 */

export interface ProcessRegistry {
  // Core registry operations
  register(process: ProcessInfo): Promise<string>;
  unregister(processId: string): Promise<void>;
  query(filter: ProcessFilter): Promise<ProcessInfo[]>;
  
  // Health and monitoring
  heartbeat(processId: string): Promise<void>;
  getHealth(processId: string): Promise<HealthStatus>;
  
  // Lifecycle management
  terminate(processId: string, signal?: string): Promise<void>;
  restart(processId: string): Promise<void>;
  
  // Registry management
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ProcessInfo {
  id: string;
  name: string;
  type: 'swarm' | 'agent' | 'task' | 'service';
  pid: number;
  parentId?: string;
  startTime: Date;
  status: ProcessStatus;
  command: string[];
  environment: Record<string, string>;
  resources: {
    memory: number;
    cpu: number;
  };
  healthCheck: {
    endpoint?: string;
    interval: number;
    timeout: number;
    retries: number;
  };
  metadata?: Record<string, any>;
}

export type ProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'unresponsive';

export interface ProcessFilter {
  id?: string;
  name?: string;
  type?: ProcessInfo['type'];
  status?: ProcessStatus;
  parentId?: string;
  since?: Date;
}

export interface HealthStatus {
  processId: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastHeartbeat: Date;
  consecutiveFailures: number;
  diagnostics?: {
    memory?: number;
    cpu?: number;
    errors?: string[];
  };
}

export interface RegistryRecovery {
  backup(): Promise<void>;
  restore(backupPath: string): Promise<void>;
  validate(): Promise<RegistryValidationResult>;
  repair(): Promise<void>;
}

export interface RegistryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  processCount: number;
  orphanedProcesses: string[];
}

export interface ProcessMetrics {
  processId: string;
  timestamp: Date;
  memory: number;
  cpu: number;
  uptime: number;
  errorCount: number;
}