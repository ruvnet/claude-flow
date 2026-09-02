/**
 * V3 Claude-Flow Memory Entry Fixtures
 *
 * Test data for memory and AgentDB testing
 * Following London School principle of explicit test data
 */

/**
 * Memory entry interface
 */
export interface MemoryEntry {
  key: string;
  value: unknown;
  metadata: MemoryMetadata;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

/**
 * Memory metadata interface
 */
export interface MemoryMetadata {
  type: 'short-term' | 'long-term' | 'semantic' | 'episodic';
  tags: string[];
  source?: string;
  confidence?: number;
  ttl?: number;
}

/**
 * Vector search query interface
 */
export interface VectorQuery {
  embedding: number[];
  topK: number;
  threshold?: number;
  filters?: Record<string, unknown>;
}

/**
 * Search result interface
 */
export interface SearchResult {
  key: string;
  value: unknown;
  score: number;
  metadata: MemoryMetadata;
}

/**
 * Pre-defined memory entries for testing
 */
export const memoryEntries: Record<string, MemoryEntry> = {
  agentPattern: {
    key: 'pattern:agent:queen-coordinator',
    value: {
      pattern: 'orchestration',
      successRate: 0.95,
      avgDuration: 150,
    },
    metadata: {
      type: 'semantic',
      tags: ['agent', 'pattern', 'queen'],
      source: 'learning-module',
      confidence: 0.92,
    },
    embedding: generateMockEmbedding(384, 'orchestration'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-15T12:00:00Z'),
  },

  securityRule: {
    key: 'rule:security:path-traversal',
    value: {
      rule: 'block-path-traversal',
      patterns: ['../', '~/', '/etc/'],
      severity: 'critical',
    },
    metadata: {
      type: 'long-term',
      tags: ['security', 'rule', 'validation'],
      source: 'security-module',
      confidence: 1.0,
    },
    embedding: generateMockEmbedding(384, 'security'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },

  taskMemory: {
    key: 'task:memory:impl-001',
    value: {
      taskId: 'impl-001',
      context: 'implementing security module',
      decisions: ['use argon2 for hashing', 'implement path validation'],
    },
    metadata: {
      type: 'episodic',
      tags: ['task', 'implementation', 'security'],
      ttl: 86400000, // 24 hours
    },
    embedding: generateMockEmbedding(384, 'implementation'),
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    expiresAt: new Date('2024-01-16T10:00:00Z'),
  },

  sessionContext: {
    key: 'session:context:session-001',
    value: {
      sessionId: 'session-001',
      user: 'developer',
      activeAgents: ['queen-coordinator', 'coder'],
      currentTask: 'security-implementation',
    },
    metadata: {
      type: 'short-term',
      tags: ['session', 'context'],
      ttl: 3600000, // 1 hour
    },
    createdAt: new Date('2024-01-15T14:00:00Z'),
    updatedAt: new Date('2024-01-15T14:30:00Z'),
    expiresAt: new Date('2024-01-15T15:30:00Z'),
  },

  learningTrajectory: {
    key: 'learning:trajectory:traj-001',
    value: {
      trajectoryId: 'traj-001',
      steps: [
        { action: 'analyze', result: 'success', reward: 0.8 },
        { action: 'implement', result: 'success', reward: 0.9 },
        { action: 'test', result: 'success', reward: 1.0 },
      ],
      totalReward: 2.7,
    },
    metadata: {
      type: 'long-term',
      tags: ['learning', 'trajectory', 'reinforcement'],
      source: 'reasoningbank',
      confidence: 0.88,
    },
    embedding: generateMockEmbedding(384, 'learning'),
    createdAt: new Date('2024-01-10T00:00:00Z'),
    updatedAt: new Date('2024-01-15T00:00:00Z'),
  },
};

/**
 * Pre-defined search results for testing
 */
export const searchResults: Record<string, SearchResult[]> = {
  securityPatterns: [
    {
      key: 'pattern:security:input-validation',
      value: { pattern: 'validate all inputs', effectiveness: 0.99 },
      score: 0.95,
      metadata: { type: 'semantic', tags: ['security', 'pattern'] },
    },
    {
      key: 'pattern:security:output-encoding',
      value: { pattern: 'encode all outputs', effectiveness: 0.97 },
      score: 0.88,
      metadata: { type: 'semantic', tags: ['security', 'pattern'] },
    },
    {
      key: 'pattern:security:least-privilege',
      value: { pattern: 'minimal permissions', effectiveness: 0.95 },
      score: 0.82,
      metadata: { type: 'semantic', tags: ['security', 'pattern'] },
    },
  ],

  agentPatterns: [
    {
      key: 'pattern:agent:coordination',
      value: { pattern: 'hierarchical coordination', successRate: 0.92 },
      score: 0.91,
      metadata: { type: 'semantic', tags: ['agent', 'pattern'] },
    },
    {
      key: 'pattern:agent:communication',
      value: { pattern: 'async messaging', successRate: 0.89 },
      score: 0.85,
      metadata: { type: 'semantic', tags: ['agent', 'pattern'] },
    },
  ],

  emptyResults: [],
};

/**
 * Generate mock embedding vector
 * Creates deterministic embeddings based on seed string
 */
export function generateMockEmbedding(dimensions: number, seed: string): number[] {
  const seedHash = hashString(seed);
  return Array.from({ length: dimensions }, (_, i) => {
    const value = Math.sin(seedHash + i * 0.1) * 0.5 + 0.5;
    return Math.round(value * 10000) / 10000; // 4 decimal places
  });
}

/**
 * Simple string hash function for deterministic embeddings
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Factory function to create memory entry with overrides
 */
export function createMemoryEntry(
  base: keyof typeof memoryEntries,
  overrides?: Partial<MemoryEntry>
): MemoryEntry {
  return {
    ...memoryEntries[base],
    ...overrides,
    key: overrides?.key ?? memoryEntries[base].key,
    createdAt: overrides?.createdAt ?? new Date(),
    updatedAt: overrides?.updatedAt ?? new Date(),
  };
}

/**
 * Factory function to create vector query
 */
export function createVectorQuery(overrides?: Partial<VectorQuery>): VectorQuery {
  return {
    embedding: overrides?.embedding ?? generateMockEmbedding(384, 'query'),
    topK: overrides?.topK ?? 10,
    threshold: overrides?.threshold ?? 0.7,
    filters: overrides?.filters,
  };
}

/**
 * Create batch of memory entries for performance testing
 */
export function createMemoryBatch(count: number, type: MemoryMetadata['type'] = 'semantic'): MemoryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `batch:entry:${i}`,
    value: { index: i, data: `test data ${i}` },
    metadata: {
      type,
      tags: [`batch`, `entry-${i}`],
    },
    embedding: generateMockEmbedding(384, `batch-${i}`),
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Invalid memory entries for error testing
 */
export const invalidMemoryEntries = {
  emptyKey: {
    key: '',
    value: { data: 'test' },
    metadata: { type: 'short-term' as const, tags: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  nullValue: {
    key: 'valid-key',
    value: null,
    metadata: { type: 'short-term' as const, tags: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  invalidEmbeddingDimension: {
    key: 'valid-key',
    value: { data: 'test' },
    metadata: { type: 'semantic' as const, tags: [] },
    embedding: [0.1, 0.2], // Wrong dimension
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  expiredEntry: {
    key: 'expired-key',
    value: { data: 'expired' },
    metadata: { type: 'short-term' as const, tags: [], ttl: -1000 },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    expiresAt: new Date('2024-01-01T00:01:00Z'),
  },
};

/**
 * AgentDB specific test data
 */
export const agentDBTestData = {
  // HNSW index configuration
  hnswConfig: {
    M: 16,
    efConstruction: 200,
    efSearch: 50,
    dimensions: 384,
  },

  // Expected performance metrics
  performanceTargets: {
    searchSpeedupMin: 150,
    searchSpeedupMax: 12500,
    memoryReduction: 0.50,
    insertionTime: 1, // ms
    searchTime: 0.1, // ms for 1M vectors
  },

  // Quantization configurations
  quantizationConfigs: {
    scalar4bit: { bits: 4, compressionRatio: 8 },
    scalar8bit: { bits: 8, compressionRatio: 4 },
    product: { subvectors: 8, bits: 8, compressionRatio: 32 },
  },
};
