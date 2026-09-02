// Re-export all types for convenience
// export * from '../core/types.js'; // File not found
// export * from '../agents/types.js'; // File not found
// export * from '../integrations/types.js'; // File not found
// export * from '../memory/types.js'; // File not found
export * from '../swarm/types.js';
// export * from '../workflows/types.js'; // File not found

// Memory-specific types that may be referenced
export interface MemoryEntry {
  id: string;
  key: string;
  value: any;
  data?: any; // For backward compatibility
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  partition?: string;
}

// Task types for swarm
export type TaskId = string;
export type TaskStatus = 'pending' | 'active' | 'completed' | 'failed';

// Component monitoring types
export enum ComponentStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  ERROR = 'error',
  UNKNOWN = 'unknown',
}

// Alert types for monitoring
export interface AlertData {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: Date;
  component?: string;
  metadata?: Record<string, any>;
}
