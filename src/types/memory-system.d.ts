/**
 * Unified Memory System Type Definitions
 * Resolves conflicts between different memory entry types and provides adapters
 */

import { AgentId, AgentState } from '../swarm/types.js';

// ===== CORE MEMORY TYPES =====

/**
 * Generic memory data wrapper
 * Provides type-safe storage for any data type
 */
export interface MemoryData<T> {
  id: string;
  data: T;
  metadata: MemoryMetadata;
  version: number;
  checksum?: string;
}

/**
 * Memory metadata common to all entries
 */
export interface MemoryMetadata {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy?: string;
  tags: string[];
  ttl?: number; // Time to live in milliseconds
  expiresAt?: Date;
  partition?: string;
  namespace?: string;
}

// ===== AGENT MEMORY TYPES =====

/**
 * Memory entry for agent session data
 * Used for storing agent observations, insights, decisions
 */
export interface AgentMemoryEntry {
  id: string;
  agentId: string;
  sessionId: string;
  type: 'observation' | 'insight' | 'decision' | 'artifact' | 'error';
  content: string;
  context: Record<string, unknown>;
  timestamp: Date;
  tags: string[];
  version: number;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Query interface for agent memory
 */
export interface AgentMemoryQuery {
  agentId?: string;
  sessionId?: string;
  type?: AgentMemoryEntry['type'];
  tags?: string[];
  startTime?: Date;
  endTime?: Date;
  search?: string;
  limit?: number;
  offset?: number;
  namespace?: string;
}

// ===== SWARM MEMORY TYPES =====

/**
 * Memory entry for distributed swarm memory system
 * Used for shared state, knowledge, and coordination
 */
export interface SwarmMemoryEntry {
  id: string;
  key: string;
  value: any;
  
  // Metadata
  type: string;
  tags: string[];
  
  // Ownership
  owner: AgentId;
  accessLevel: AccessLevel;
  
  // Lifecycle
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  
  // Versioning
  version: number;
  previousVersions?: SwarmMemoryEntry[];
  
  // Relationships
  references: string[];
  dependencies: string[];
}

export type AccessLevel = 
  | 'private'     // Only owner can access
  | 'team'        // Team members can access
  | 'swarm'       // All swarm agents can access
  | 'public'      // Publicly accessible
  | 'system';     // System-level access

// ===== REGISTRY TYPES =====

/**
 * Generic registry entry interface
 */
export interface RegistryEntry<T> {
  id: string;
  data: T;
  createdAt: Date;
  lastUpdated: Date;
  tags: string[];
  metadata: Record<string, any>;
}

/**
 * Agent registry specific entry
 */
export interface AgentRegistryEntry extends RegistryEntry<AgentState> {
  agent: AgentState;
}

// ===== ADAPTER INTERFACES =====

/**
 * Generic adapter interface for type conversion
 */
export interface MemoryAdapter<T> {
  /**
   * Convert domain object to memory entry
   */
  toMemoryEntry(data: T, metadata?: Partial<MemoryMetadata>): SwarmMemoryEntry;
  
  /**
   * Convert memory entry back to domain object
   */
  fromMemoryEntry(entry: SwarmMemoryEntry): T | null;
  
  /**
   * Validate if memory entry can be converted
   */
  canConvert(entry: SwarmMemoryEntry): boolean;
}

/**
 * Agent registry adapter implementation
 */
export class AgentRegistryAdapter implements MemoryAdapter<AgentRegistryEntry> {
  toMemoryEntry(data: AgentRegistryEntry, metadata?: Partial<MemoryMetadata>): SwarmMemoryEntry {
    return {
      id: data.id,
      key: `agent:${data.agent.id.id}`,
      value: data,
      type: 'agent-registry',
      tags: [...data.tags, 'agent', data.agent.type, data.agent.status],
      owner: data.agent.id,
      accessLevel: 'swarm',
      createdAt: data.createdAt,
      updatedAt: data.lastUpdated,
      version: 1,
      references: [],
      dependencies: []
    };
  }

  fromMemoryEntry(entry: SwarmMemoryEntry): AgentRegistryEntry | null {
    if (!this.canConvert(entry)) return null;
    
    const data = entry.value as AgentRegistryEntry;
    return {
      id: entry.id,
      agent: data.agent,
      data: data.agent,
      createdAt: entry.createdAt,
      lastUpdated: entry.updatedAt,
      tags: data.tags || entry.tags,
      metadata: data.metadata || {}
    };
  }

  canConvert(entry: SwarmMemoryEntry): boolean {
    return entry.type === 'agent-registry' && 
           entry.value && 
           typeof entry.value === 'object' &&
           'agent' in entry.value;
  }
}

/**
 * Memory storage interface with adapter support
 */
export interface IMemoryStorage {
  /**
   * Store data with automatic type conversion
   */
  store<T>(key: string, data: T, adapter: MemoryAdapter<T>): Promise<void>;
  
  /**
   * Retrieve data with automatic type conversion
   */
  retrieve<T>(key: string, adapter: MemoryAdapter<T>): Promise<T | null>;
  
  /**
   * Query entries with optional adapter
   */
  query<T>(query: MemoryQuery, adapter?: MemoryAdapter<T>): Promise<T[]>;
  
  /**
   * Delete entry
   */
  delete(key: string): Promise<boolean>;
}

/**
 * Unified memory query interface
 */
export interface MemoryQuery {
  namespace?: string;
  partition?: string;
  type?: string;
  tags?: string[];
  owner?: string | AgentId;
  accessLevel?: AccessLevel;
  createdAfter?: Date;
  updatedAfter?: Date;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ===== FACTORY FUNCTIONS =====

/**
 * Create a memory data wrapper
 */
export function createMemoryData<T>(
  data: T,
  metadata?: Partial<MemoryMetadata>
): MemoryData<T> {
  const now = new Date();
  return {
    id: generateMemoryId(),
    data,
    version: 1,
    metadata: {
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
      tags: [],
      ...metadata
    }
  };
}

/**
 * Convert between different memory entry types
 */
export function convertMemoryEntry(
  from: AgentMemoryEntry | SwarmMemoryEntry,
  toType: 'agent' | 'swarm'
): AgentMemoryEntry | SwarmMemoryEntry {
  if (toType === 'agent' && isSwarmMemoryEntry(from)) {
    // Convert SwarmMemoryEntry to AgentMemoryEntry
    return {
      id: from.id,
      agentId: from.owner.id,
      sessionId: 'converted',
      type: 'observation',
      content: JSON.stringify(from.value),
      context: { originalKey: from.key },
      timestamp: from.createdAt,
      tags: from.tags,
      version: from.version,
      metadata: {
        originalType: 'swarm',
        accessLevel: from.accessLevel
      }
    };
  } else if (toType === 'swarm' && isAgentMemoryEntry(from)) {
    // Convert AgentMemoryEntry to SwarmMemoryEntry
    return {
      id: from.id,
      key: `agent:${from.agentId}:${from.id}`,
      value: {
        content: from.content,
        context: from.context,
        type: from.type
      },
      type: 'agent-memory',
      tags: from.tags,
      owner: { id: from.agentId, swarmId: 'default' },
      accessLevel: 'private',
      createdAt: from.timestamp,
      updatedAt: from.timestamp,
      version: from.version,
      references: [],
      dependencies: []
    };
  }
  
  return from;
}

// ===== TYPE GUARDS =====

export function isAgentMemoryEntry(obj: any): obj is AgentMemoryEntry {
  return obj && 
    typeof obj.id === 'string' &&
    typeof obj.agentId === 'string' &&
    typeof obj.sessionId === 'string' &&
    typeof obj.content === 'string';
}

export function isSwarmMemoryEntry(obj: any): obj is SwarmMemoryEntry {
  return obj && 
    typeof obj.id === 'string' &&
    typeof obj.key === 'string' &&
    'value' in obj &&
    typeof obj.owner === 'object';
}

export function isMemoryData<T>(obj: any): obj is MemoryData<T> {
  return obj &&
    typeof obj.id === 'string' &&
    'data' in obj &&
    typeof obj.metadata === 'object' &&
    typeof obj.version === 'number';
}

// ===== UTILITY FUNCTIONS =====

/**
 * Generate unique memory ID
 */
function generateMemoryId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `mem_${timestamp}_${random}`;
}

/**
 * Merge memory entries (for conflict resolution)
 */
export function mergeMemoryEntries(
  local: SwarmMemoryEntry,
  remote: SwarmMemoryEntry
): SwarmMemoryEntry {
  // Last-write-wins strategy by default
  return local.updatedAt > remote.updatedAt ? local : remote;
}

/**
 * Check memory entry access permissions
 */
export function canAccess(
  entry: SwarmMemoryEntry,
  agentId: AgentId,
  level?: AccessLevel
): boolean {
  // Owner always has access
  if (entry.owner.id === agentId.id) return true;
  
  // Check access level hierarchy
  const levels: AccessLevel[] = ['public', 'swarm', 'team', 'private', 'system'];
  const entryLevel = levels.indexOf(entry.accessLevel);
  const requiredLevel = levels.indexOf(level || 'public');
  
  return entryLevel <= requiredLevel;
}

// ===== CONSTANTS =====

export const MEMORY_CONSTANTS = {
  MAX_ENTRY_SIZE: 1024 * 1024, // 1MB
  MAX_VERSION_HISTORY: 10,
  DEFAULT_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 hour
  MAX_TAGS: 50,
  MAX_KEY_LENGTH: 255,
} as const;